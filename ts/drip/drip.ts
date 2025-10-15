import { BigNumber, ethers } from "ethers";

import { TransactionRequest } from "@ethersproject/abstract-provider";
import { confirmMessage } from "../utils/readline";
import { executeTransaction } from "../utils/executeTransaction";

export interface DripParams {
  moduleContract: ethers.Contract;
  signer: ethers.Signer;
  toApprove: string[];
  toDrip: { token: string; sellAmount: BigNumber; buyAmount: BigNumber }[];
  confirmDrip: boolean;
  maxFeePerGas?: BigNumber;
  maxPriorityFeePerGas?: BigNumber;
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
    maxFeePerGas: params.maxFeePerGas || feeData.maxFeePerGas,
    maxPriorityFeePerGas: params.maxPriorityFeePerGas || feeData.maxPriorityFeePerGas || undefined,
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
