import {
  BuyTokenDestination,
  OrderBookApi,
  OrderKind,
  SellTokenSource,
  SigningScheme,
} from "@cowprotocol/cow-sdk";
import { IConfig } from "../config";
import { GetTokensToSwapResult } from "./getTokensToSwap";

export async function postOrders(
  orderBookApi: OrderBookApi,
  appDataHex: string,
  nextValidTo: number,
  appDataContent: string,
  config: IConfig,
  toSwap: Awaited<GetTokensToSwapResult[]>
) {
  // create orders
  const orders = await Promise.allSettled(
    toSwap.map((token) =>
      orderBookApi.sendOrder({
        sellToken: token.address,
        buyToken: config.wrappedNativeToken,
        sellAmount: token.balance.toString(),
        buyAmount: token.buyAmount.toString(),
        validTo: nextValidTo,
        appData: appDataContent,
        appDataHash: appDataHex,
        feeAmount: "0",
        kind: OrderKind.SELL,
        partiallyFillable: true,
        sellTokenBalance: SellTokenSource.ERC20,
        buyTokenBalance: BuyTokenDestination.ERC20,
        signingScheme: SigningScheme.PRESIGN,
        signature: "0x",
        from: config.gpv2Settlement,
        receiver: config.receiver,
      })
    )
  );

  const failedOrders = orders.filter((x) => x.status === "rejected");

  const successfullyPostedOrders = orders
    .filter((x) => x.status === "fulfilled")
    .map((x) => (x as PromiseFulfilledResult<string>).value);

  // filter swaps to only include successfully posted orders
  const toActuallySwap = toSwap.filter(
    (x, idx) => orders[idx].status === "fulfilled"
  );

  return { failedOrders, successfullyPostedOrders, toActuallySwap };
}
