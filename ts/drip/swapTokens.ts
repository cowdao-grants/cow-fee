import { ethers } from "ethers";

import { IConfig } from "../config";
import { getOrderbookApi } from "../utils/misc";
import { GetTokensToSwapResult } from "./getTokensToSwap";
import { getAppData } from "./getAppData";
import { postOrders } from "./postOrders";
import { drip } from "./drip";

export const swapTokens = async (
  moduleContract: ethers.Contract,
  config: IConfig,
  signerWithProvider: ethers.Signer,
  toSwap: Awaited<GetTokensToSwapResult[]>
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
    maxFeePerGas: config.maxFeePerGas,
    maxPriorityFeePerGas: config.maxPriorityFeePerGas,
  });
};
