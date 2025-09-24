import { BigNumber, ContractTransaction, ethers } from "ethers";
import {
  TransactionReceipt,
  TransactionRequest,
} from "@ethersproject/abstract-provider";
import { TimeoutError, withTimeout } from "./misc";

const GAS_INCREASE_STEP = 10; // +10% increase per retry
const MAX_GAS_INCREASE = 100; // +100% of original gas price
const WAIT_TIME_FOR_MAX_GAS_PRICE_MILLIS = 3600 * 1000; // 1 hour
const TIMEOUT_BEFORE_INCREASING_GAS_PRICE_MILLIS = 5 * 60 * 1000; // 5 min

export interface TransactionParams {
  /**
   * The signer to use for the transaction
   */
  signer: ethers.Signer;

  /**
   * The transaction request to execute
   */
  txRequest: TransactionRequest;

  /**
   * The name of the operation to execute. Only used for logging.
   */
  operationName: string;

  /**
   * The maximum gas increase percentage. Default is 200% of the original gas price.
   */
  maxGasIncreasePercentage?: number;

  /**
   * The wait time for the max gas price in milliseconds. Default is 1 hour.
   */
  waitTimeForMaxGasPrice?: number;

  /**
   * The timeout in milliseconds before increasing the gas price. Default is 5 minutes.
   */
  timeoutBeforeIncreasingGasPrice?: number;
}

type GasPriceData = GasPriceDataEIP1559 | GasPriceDataLegacy;

interface GasPriceDataEIP1559 {
  maxFeePerGas: BigNumber;
  maxPriorityFeePerGas: BigNumber;
}

interface GasPriceDataLegacy {
  gasPrice: BigNumber;
}

/**
 * Executes a transaction with automatic gas price increases, timeout handling, and transaction replacement handling.
 * It will use EIP-1559 if the transaction request includes a maxFeePerGas, otherwise it will use legacy gas price (for networks that don't support EIP-1559).
 *
 * @param params - Transaction parameters including signer, request, and operation name
 * @returns The transaction receipt
 * @throws Error if transaction fails or times out after maximum retries
 */
export async function executeTransaction(
  params: TransactionParams
): Promise<string | null> {
  const {
    signer,
    txRequest: baseTxRequest,
    operationName,
    maxGasIncreasePercentage = MAX_GAS_INCREASE,
    waitTimeForMaxGasPrice = WAIT_TIME_FOR_MAX_GAS_PRICE_MILLIS,
    timeoutBeforeIncreasingGasPrice = TIMEOUT_BEFORE_INCREASING_GAS_PRICE_MILLIS,
  } = params;

  // Get initial fee estimation
  const originalGasPrice = await getGasPriceData(signer);

  // Calculate the maximum gas price we are willing to pay
  const maxGasPrice = increaseByPercentage(
    isGasPriceDataEIP1559(originalGasPrice)
      ? originalGasPrice.maxFeePerGas
      : originalGasPrice.gasPrice,
    maxGasIncreasePercentage
  );

  let currentGasPrice = { ...originalGasPrice };
  let txRequest: TransactionRequest = applyGasPriceToTx(
    baseTxRequest,
    currentGasPrice
  );

  let tx: ContractTransaction;
  while (true) {
    try {
      // Send the transaction
      tx = await signer.sendTransaction(txRequest);

      // Wait for the transaction to be mined (or timeout to increase gas price)
      const receipt = await waitForTransactionWithTimeout(
        tx,
        timeoutBeforeIncreasingGasPrice,
        operationName
      );

      return receipt.transactionHash;
    } catch (error) {
      // Handle transaction replacement error
      const replacedTxReceipt = await handleTransactionReplacementError(
        error,
        signer.provider!,
        operationName
      );
      if (replacedTxReceipt) {
        return replacedTxReceipt.transactionHash;
      }

      // Handle nonce has already been used (it happens if the previous transaction was mined before we send a new one with updated gas price)
      if (hasNonceAlreadyBeenUsed(error, signer)) {
        console.log(
          `Nonce has already been used. A previous transaction has been minded`
        );
        return null;
      }

      // Re-throw the error if it's not a timeout error
      if (!(error instanceof TimeoutError)) {
        throw error;
      }

      // Increase gas price
      const { currentGasPrice: updatedGasPrice, usingMaximumGasPrice } =
        increaseGasPrice({
          currentGasPrice,
          baseTxRequest: txRequest,
          maxGasPrice,
        });

      // Use a new transaction request with the updated gas price
      txRequest = applyGasPriceToTx(baseTxRequest, updatedGasPrice);
      currentGasPrice = updatedGasPrice;

      if (usingMaximumGasPrice) {
        // Maximum gas price reached. Wait for longer with no more retries
        return handleMaximumGasPriceReached(
          tx!,
          signer.provider!,
          currentGasPrice,
          waitTimeForMaxGasPrice,
          operationName
        );
      } else {
        // Re-try with increased gas price
        console.log(
          `Retrying with increased gas price`,
          formatGasPrice(currentGasPrice)
        );
      }
    }
  }
}

function isGasPriceDataEIP1559(
  gasPriceData: GasPriceData
): gasPriceData is GasPriceDataEIP1559 {
  return (
    "maxFeePerGas" in gasPriceData && "maxPriorityFeePerGas" in gasPriceData
  );
}

async function getGasPriceData(
  provider: ethers.providers.JsonRpcProvider | ethers.Signer
): Promise<GasPriceData> {
  const feeData = await provider.getFeeData();

  if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
    return {
      maxFeePerGas: feeData.maxFeePerGas,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
    };
  }

  return {
    gasPrice: feeData.gasPrice || (await provider.getGasPrice()),
  };
}

function increaseByPercentage(value: BigNumber, percentage: number): BigNumber {
  return value.mul(100 + percentage).div(100);
}

interface GasPriceIncreaseResult {
  currentGasPrice: GasPriceData;
  usingMaximumGasPrice: boolean;
}

/**
 * Increase gas price by a percentage, capped to the maximum gas price
 * @param params - Parameters for the gas price increase
 * @returns The updated gas price and transaction request
 */
function increaseGasPrice(params: {
  currentGasPrice: GasPriceData;
  baseTxRequest: TransactionRequest;
  maxGasPrice: BigNumber;
}): GasPriceIncreaseResult {
  const { currentGasPrice, baseTxRequest, maxGasPrice } = params;

  let updatedGasPrice: GasPriceData;
  let usingMaximumGasPrice: boolean;
  if (isGasPriceDataEIP1559(currentGasPrice)) {
    const maxFeePerGas = increaseByPercentage(
      currentGasPrice.maxFeePerGas,
      GAS_INCREASE_STEP
    );

    // Increase max fee and max priority fee by the step percentage (capped to maxGasPrice)
    updatedGasPrice = {
      maxFeePerGas: maxFeePerGas.gt(maxGasPrice) ? maxGasPrice : maxFeePerGas,
      maxPriorityFeePerGas: increaseByPercentage(
        currentGasPrice.maxPriorityFeePerGas,
        GAS_INCREASE_STEP
      ),
    };
    usingMaximumGasPrice = updatedGasPrice.maxFeePerGas.eq(maxGasPrice);
  } else {
    // Increase legacy gas price by the step percentage
    const gasPrice = increaseByPercentage(
      currentGasPrice.gasPrice,
      GAS_INCREASE_STEP
    );
    usingMaximumGasPrice = gasPrice.gte(maxGasPrice);
    updatedGasPrice = {
      gasPrice: usingMaximumGasPrice ? maxGasPrice : gasPrice,
    };
  }

  return {
    currentGasPrice: updatedGasPrice,
    usingMaximumGasPrice,
  };
}

function throwIfFailed(receipt: TransactionReceipt, operationName: string) {
  if (receipt.status === 0) {
    throw new Error(
      `${operationName} transaction failed: ${receipt.transactionHash}`
    );
  }
}

/**
 * Handles a transaction replacement error by waiting for the replacement transaction to be mined.
 * @param error - The error to handle
 * @param signer - The signer to use to wait for the replacement transaction
 * @param operationName - The name of the operation to execute. Only used for logging.
 * @returns The receipt of the replacement transaction if the error is a transaction replacement error, otherwise undefined
 */
async function handleTransactionReplacementError(
  error: unknown,
  provider: ethers.providers.Provider,
  operationName: string
): Promise<TransactionReceipt | undefined> {
  const replacementTxHash = getReplacementTxHash(error);
  if (replacementTxHash) {
    console.log(`Transaction was replaced with: ${replacementTxHash}`);
    const receipt = await provider.waitForTransaction(replacementTxHash);
    console.log(`${operationName} transaction was mined:`, replacementTxHash);
    return receipt;
  }

  return undefined;
}

/**
 * Extracts the hash of the replacement transaction from the error (if the error is a transaction replacement error)
 * @param error - The error to handle
 * @returns The transaction hash of the replacement transaction if the error is a transaction replacement error, otherwise undefined
 */
function getReplacementTxHash(error: unknown): string | undefined {
  if (
    error instanceof Error &&
    "replacement" in error &&
    typeof error.replacement === "object" &&
    error.replacement !== null &&
    "hash" in error.replacement &&
    typeof error.replacement.hash === "string"
  ) {
    return error.replacement.hash;
  }

  return undefined;
}

function hasNonceAlreadyBeenUsed(error: unknown, signer: ethers.Signer) {
  return (
    error instanceof Error &&
    error.message.includes("nonce has already been used")
  );
}

async function handleMaximumGasPriceReached(
  tx: ContractTransaction,
  provider: ethers.providers.Provider,
  currentGasPrice: GasPriceData,
  waitTimeForMaxGasPrice: number,
  operationName: string
): Promise<string> {
  // If we reached the maximum. Wait for longer with no more retries.
  console.log(
    `Transaction still pending after reaching max gas price. Waiting for ${
      waitTimeForMaxGasPrice / 1000
    } seconds before giving up...`,
    formatGasPrice(currentGasPrice)
  );
  try {
    const receipt = await waitForTransactionWithTimeout(
      tx,
      waitTimeForMaxGasPrice,
      `Final ${operationName}`
    );

    return receipt.transactionHash;
  } catch (finalError: unknown) {
    // Handle transaction replacement error
    const replacedTxReceipt = await handleTransactionReplacementError(
      finalError,
      provider,
      operationName
    );

    if (replacedTxReceipt) {
      return replacedTxReceipt.transactionHash;
    } else {
      console.log(`${operationName} failed after maximum wait time`);
      // Re-throw the error if it's not a transaction replacement error
      throw finalError;
    }
  }
}

function formatGasPrice(gasPrice: GasPriceData) {
  if (isGasPriceDataEIP1559(gasPrice)) {
    return `maxFeePerGas=${gasPrice.maxFeePerGas.toString()}, maxPriorityFeePerGas=${gasPrice.maxPriorityFeePerGas.toString()}`;
  }
  return `gasPrice=${gasPrice.gasPrice.toString()}`;
}

async function waitForTransactionWithTimeout(
  tx: ContractTransaction,
  timeoutMs: number,
  operationName: string
): Promise<TransactionReceipt> {
  console.log(`Waiting for ${operationName} transaction:`, tx.hash);
  const receipt = await withTimeout(tx.wait(), timeoutMs, operationName);

  throwIfFailed(receipt, operationName);

  console.log(`${operationName} transaction was mined:`, tx.hash);

  return receipt;
}

export function applyGasPriceToTx(
  txRequest: TransactionRequest,
  gasPrice: GasPriceData
): TransactionRequest {
  if (isGasPriceDataEIP1559(gasPrice)) {
    return {
      ...txRequest,
      maxFeePerGas: gasPrice.maxFeePerGas,
      maxPriorityFeePerGas: gasPrice.maxPriorityFeePerGas,
      gasPrice: undefined,
    };
  } else {
    return {
      ...txRequest,
      gasPrice: gasPrice.gasPrice,
      maxFeePerGas: undefined,
      maxPriorityFeePerGas: undefined,
    };
  }
}
