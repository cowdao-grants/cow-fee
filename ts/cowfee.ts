import { BigNumber, ethers } from "ethers";

import { TransactionRequest } from "@ethersproject/abstract-provider";

import {
  IConfig,
  confirmMessage,
  getMulticall3,
  getOrderbookApi,
  executeTransaction,
} from "./common";
import { getTokenBalances } from "./explorer-apis";
import { erc20Abi, moduleAbi } from "./abi";

import {
  BuyTokenDestination,
  OrderBookApi,
  OrderKind,
  OrderQuoteResponse,
  OrderQuoteSideKindSell,
  SellTokenSource,
  SigningScheme,
} from "@cowprotocol/cow-sdk";
import { MetadataApi } from "@cowprotocol/app-data";

const ABI_CODER = new ethers.utils.AbiCoder();

const getBalances = async (
  provider: ethers.providers.JsonRpcProvider,
  address: string,
  tokens: string[]
): Promise<BigNumber[]> => {
  const Multicall3 = getMulticall3(provider);
  const balanceOfCalldata = new ethers.utils.Interface(
    erc20Abi
  ).encodeFunctionData("balanceOf", [address]);
  const cds = tokens.map((token) => ({
    target: token,
    callData: balanceOfCalldata,
  }));
  const balancesRet = await Multicall3.tryAggregate(false, cds);
  const balances = balancesRet.map((r: any) =>
    r.success ? ABI_CODER.decode(["uint"], r.returnData)[0] : BigNumber.from(0)
  ) as BigNumber[];
  return balances;
};

const getAllowances = async (
  provider: ethers.providers.JsonRpcProvider,
  owner: string,
  spender: string,
  tokens: string[]
): Promise<BigNumber[]> => {
  const Multicall3 = getMulticall3(provider);
  const allowanceCalldata = new ethers.utils.Interface(
    erc20Abi
  ).encodeFunctionData("allowance", [owner, spender]);
  const allowancesRet = await Multicall3.tryAggregate(
    false,
    tokens.map((token) => ({
      target: token,
      callData: allowanceCalldata,
    }))
  );
  const allowances = allowancesRet.map((r: any) =>
    r.success ? ABI_CODER.decode(["uint"], r.returnData)[0] : BigNumber.from(0)
  ) as BigNumber[];
  return allowances;
};

export const getTokensToSwap = async (
  config: IConfig,
  provider: ethers.providers.JsonRpcProvider
) => {
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
};

export async function getEthToWrap(
  config: IConfig,
  provider: ethers.providers.JsonRpcProvider
) {
  const ethBalance = await provider.getBalance(config.gpv2Settlement);
  return ethBalance.gte(config.minOut) ? ethBalance : BigNumber.from(0);
}

// get COWFeeModule appData
export const getAppData = async () => {
  const appDataDoc = {
    appCode: "CoWFeeModule",
    environment: "prod",
    version: "1.1.0",
    metadata: {},
  };
  const metadataApi = new MetadataApi();
  const { cid, appDataHex, appDataContent } = await metadataApi.getAppDataInfo(
    appDataDoc
  );
  return { cid, appDataHex, appDataContent };
};

export const getDripParams = async (
  config: IConfig,
  signerWithProvider: ethers.Signer,
  toSwap: Awaited<ReturnType<typeof getTokensToSwap>>
) => {
  const { appDataHex, appDataContent } = await getAppData();
  if (appDataHex.toLowerCase() !== config.appData.toLowerCase()) {
    throw new Error(`appData mismatch: ${appDataHex} != ${config.appData}`);
  }

  const moduleContract = new ethers.Contract(
    config.module,
    moduleAbi,
    signerWithProvider
  );
};

export const swapTokens = async (
  moduleContract: ethers.Contract,
  config: IConfig,
  signerWithProvider: ethers.Signer,
  toSwap: Awaited<ReturnType<typeof getTokensToSwap>>
): Promise<void> => {
  const orderBookApi = getOrderbookApi(config.chainId);

  const nextValidTo = await moduleContract.nextValidTo();
  const { appDataHex, appDataContent } = await getAppData();
  if (appDataHex.toLowerCase() !== config.appData.toLowerCase()) {
    throw new Error(`appData mismatch: ${appDataHex} != ${config.appData}`);
  }

  const { failedOrders, successfullyPostedOrders, toActuallySwap } =
    await postOrders(
      orderBookApi,
      appDataHex,
      nextValidTo,
      appDataContent,
      config,
      toSwap
    );

  console.log("Successfully posted orders:\n", successfullyPostedOrders);
  if (failedOrders.length > 0) {
    console.error(
      `Failed posting orders:\n"`,
      failedOrders.map((x) => (x as PromiseRejectedResult).reason)
    );
  }

  if (toActuallySwap.length === 0) {
    console.log("No tokens to swap, skipping approvals and drip");
    return;
  }

  const toApprove = toActuallySwap
    .filter((token) => token.needsApproval)
    .map((token) => token.address);

  const toDrip = toActuallySwap.map((token) => ({
    token: token.address,
    sellAmount: token.balance,
    buyAmount: token.buyAmount,
  }));

  await drip({
    moduleContract,
    signer: signerWithProvider,
    toApprove,
    toDrip,
    confirmDrip: config.confirmDrip,
  });
};

async function postOrders(
  orderBookApi: OrderBookApi,
  appDataHex: string,
  nextValidTo: number,
  appDataContent: string,
  config: IConfig,
  toSwap: Awaited<ReturnType<typeof getTokensToSwap>>
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

/**
 * Get the transaction parameters for the drip transaction
 * @param params - The parameters for the drip transaction
 *
 * @returns The transaction parameters
 */
async function getDripTx(params: DripParams): Promise<TransactionRequest> {
  const {
    moduleContract,
    signer: signerWithProvider,
    toApprove,
    toDrip,
  } = params;

  // On Gnosis chain we ran into an error where ethers would choose a nonce that was way too high
  const nonce = await signerWithProvider.getTransactionCount();

  // Estimate gas prices
  let feeData = await signerWithProvider.getFeeData();
  if (!feeData.maxFeePerGas) {
    throw new Error("Failed to get max fee per gas from network");
  }

  // Get transaction parameters and calldata
  const txBaseRequest: TransactionRequest = {
    from: await signerWithProvider.getAddress(),
    to: moduleContract.address,
    maxFeePerGas: feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || undefined,
    data: moduleContract.interface.encodeFunctionData("drip", [
      toApprove,
      toDrip,
    ]),
    value: BigNumber.from(0),
    nonce,
  };

  console.log("\nDrip transaction parameters:", {
    from: txBaseRequest.from,
    to: txBaseRequest.to,
    maxFeePerGas: txBaseRequest.maxFeePerGas?.toString() || "undefined",
    maxPriorityFeePerGas:
      txBaseRequest.maxPriorityFeePerGas?.toString() || "undefined",
    value: txBaseRequest.value?.toString() || "0",
    nonce: txBaseRequest.nonce,
  });

  // Estimate gas for the transaction
  const gasLimit = await signerWithProvider
    .estimateGas(txBaseRequest)
    .catch((error) => {
      console.error(
        "Error estimating gas. Please review the transaction parameters"
      );
      throw new Error("Error estimating gas", { cause: error });
    });

  console.log("Estimated gas limit:", gasLimit.toString());

  return {
    ...txBaseRequest,
    gasLimit,
  };
}

export interface DripParams {
  moduleContract: ethers.Contract;
  signer: ethers.Signer;
  toApprove: string[];
  toDrip: { token: string; sellAmount: BigNumber; buyAmount: BigNumber }[];
  confirmDrip: boolean;
}

export async function drip(params: DripParams) {
  const { signer, confirmDrip } = params;

  const txBaseRequest = await getDripTx(params);

  const confirmation = confirmDrip
    ? await confirmMessage("\nDo you want to send this transaction? (yes/no): ")
    : true;

  if (!confirmation) {
    console.log("All right! Transaction cancelled");
    return;
  }

  await executeTransaction({
    signer: signer,
    txRequest: txBaseRequest,
    operationName: "Drip",
  });
}
