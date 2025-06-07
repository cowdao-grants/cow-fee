import { BigNumber, ethers } from "ethers";

import {
  OrderQuoteResponse,
  OrderQuoteSideKindSell,
} from "@cowprotocol/cow-sdk";
import { IConfig } from "../config";
import { getOrderbookApi } from "../utils/misc";
import { getTokenBalances } from "../drip/getTokenBalances";
import { getBalances } from "./getBalances";
import { getAllowances } from "./getAllowances";

export interface GetTokensToSwapResult {
  buyAmount: BigNumber;
  balance: BigNumber;
  allowance: BigNumber;
  needsApproval: boolean;
  address: string;
  symbol: string;
  decimals: number;
}

export async function getTokensToSwap(
  config: IConfig,
  provider: ethers.providers.JsonRpcProvider
): Promise<GetTokensToSwapResult[]> {
  const unfiltered = await getTokenBalances(
    config.gpv2Settlement,
    config.network,
    config.tokenListStrategy,
    config
  );

  // populate the balances and allowances
  const tokenAddresses = unfiltered.map((token) => token.address);
  const [balances, allowances] = await Promise.all([
    getBalances(provider, config.gpv2Settlement, tokenAddresses),
    getAllowances(
      provider,
      config.gpv2Settlement,
      config.vaultRelayer,
      tokenAddresses
    ),
  ]);
  // minValue filter again with _real_ balance
  const unfilteredWithBalanceAndAllowance = unfiltered.map((token, idx) => ({
    ...token,
    balance: balances[idx],
    allowance: allowances[idx],
    needsApproval: allowances[idx].lt(balances[idx]),
  }));

  // filter shitcoins with no liquidity by using the quotes api
  const orderBookApi = getOrderbookApi(config.chainId);
  const quotes = await Promise.allSettled(
    unfilteredWithBalanceAndAllowance.map((token) =>
      orderBookApi.getQuote({
        sellToken: token.address,
        sellAmountBeforeFee: token.balance.toString(),
        kind: OrderQuoteSideKindSell.SELL,
        buyToken: config.wrappedNativeToken,
        from: config.gpv2Settlement,
      })
    )
  );
  console.log(
    "Total tokens pre-filter:",
    unfilteredWithBalanceAndAllowance.length
  );
  const quotesFiltered = unfilteredWithBalanceAndAllowance
    .map((token, i) => ({
      ...token,
      buyAmount: BigNumber.from(
        (quotes[i].status === "fulfilled" &&
          (quotes[i] as PromiseFulfilledResult<OrderQuoteResponse>).value.quote
            .buyAmount) ||
          0
      )
        .mul(10000 - config.buyAmountSlippageBps)
        .div(10000),
    }))
    .filter((_, i) => quotes[i].status === "fulfilled");
  console.log(
    "Total tokens after filtering by quotes api:",
    quotesFiltered.length
  );

  // filter by min eth out
  const minOutFiltered = quotesFiltered.filter((token) =>
    BigNumber.from(token.buyAmount).gt(config.minOut)
  );
  console.log("Total tokens after filtering by minOut:", minOutFiltered.length);
  return minOutFiltered;
}
