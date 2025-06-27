import { OrderBookApi, SupportedChainId } from "@cowprotocol/cow-sdk";
import { BigNumber, ContractTransaction, ethers } from "ethers";
import {
  TransactionReceipt,
  TransactionRequest,
} from "@ethersproject/abstract-provider";
import { multicall3Abi } from "./abi";
import readline from "readline";

const GAS_INCREASE_STEP = 10; // +10% increase per retry
const MAX_GAS_INCREASE = 100; // +100% of original gas price
const WAIT_TIME_FOR_MAX_GAS_PRICE = 100 * 1000; // 1 hour
const TIMEOUT_BEFORE_INCREASING_GAS_PRICE = 1 * 1000; // 5 min

interface NetworkDetails {
  rpcUrl: string;
  explorer: string;
}

export const SUPPORTED_NETWORKS = [
  "mainnet",
  "gnosis",
  "arbitrum",
  "base",
  "sepolia",
  "avalanche",
  "polygon",
] as const;

export const networkSpecificConfigs: Record<
  (typeof SUPPORTED_NETWORKS)[number],
  NetworkDetails
> = {
  mainnet: {
    rpcUrl: "https://eth.llamarpc.com",
    explorer: "https://explorer.cow.fi",
  },
  gnosis: {
    rpcUrl: "https://1rpc.io/gnosis",
    explorer: "https://explorer.cow.fi/gc",
  },
  arbitrum: {
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    explorer: "https://explorer.cow.fi/arb1",
  },
  base: {
    rpcUrl: "https://base.llamarpc.com",
    explorer: "https://explorer.cow.fi/base",
  },
  sepolia: {
    rpcUrl: "https://sepolia.drpc.org",
    explorer: "https://explorer.cow.fi/sepolia",
  },
  avalanche: {
    rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
    explorer: "https://explorer.cow.fi/avax",
  },
  polygon: {
    rpcUrl: "https://polygon-rpc.com",
    explorer: "https://explorer.cow.fi/pol",
  },
};

export interface IConfig {
  chainId: SupportedChainId;
  privateKey: string;
  options: object;
  maxOrders: number;
  module: string;
  gpv2Settlement: string;
  vaultRelayer: string;
  rpcUrl: string;
  network: (typeof SUPPORTED_NETWORKS)[number];
  wrappedNativeToken: string;
  minOut: bigint;
  targetSafe: string;
  receiver: string;
  buyAmountSlippageBps: number;
  keeper: string;
  appData: string;
  tokenListStrategy: "explorer" | "chain";
  lookbackRange: number;
  confirmDrip: boolean;
}

export function toChainId(network: keyof typeof networkSpecificConfigs) {
  switch (network) {
    case "mainnet": {
      return SupportedChainId.MAINNET;
    }
    case "gnosis": {
      return SupportedChainId.GNOSIS_CHAIN;
    }
    case "arbitrum": {
      return SupportedChainId.ARBITRUM_ONE;
    }
    case "base": {
      return SupportedChainId.BASE;
    }
    case "sepolia": {
      return SupportedChainId.SEPOLIA;
    }
    case "avalanche": {
      return SupportedChainId.AVALANCHE;
    }
    case "polygon": {
      return SupportedChainId.POLYGON;
    }
    default: {
      throw new Error(`Unsupported network ${network}`);
    }
  }
}

export const validatedProvider = async function (
  network: (typeof SUPPORTED_NETWORKS)[number],
  userRpcUrl: string | undefined
): Promise<[string, ethers.providers.JsonRpcProvider, number]> {
  const { rpcUrl: defaultRpcUrl } = networkSpecificConfigs[network];
  const rpcUrl = userRpcUrl || defaultRpcUrl;
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

  // Check if the RPC provider chain matches the expected network
  const providerChainId = (await provider.getNetwork()).chainId;
  const expectedChainId = toChainId(network);
  if (providerChainId !== expectedChainId) {
    throw new Error(
      `Provider chain ID ${providerChainId} does not match expected chain ID ${expectedChainId} for network ${network}`
    );
  }
  return [rpcUrl, provider, expectedChainId];
};

export const getOrderbookApi = (chainId: SupportedChainId) => {
  return new OrderBookApi({
    chainId,
    limiterOpts: {
      tokensPerInterval: 5,
      interval: "second",
    },
    backoffOpts: {
      numOfAttempts: 5,
      maxDelay: Infinity,
      jitter: "none",
    },
  });
};

export const getMulticall3 = (provider: ethers.providers.JsonRpcProvider) => {
  return new ethers.Contract(
    "0xcA11bde05977b3631167028862bE2a173976CA11",
    multicall3Abi,
    provider
  );
};

// Singleton readline interface
let readLineInterface: readline.Interface | null = null;

function getReadLineInterface() {
  if (!readLineInterface) {
    readLineInterface = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }
  return readLineInterface;
}

function closeReadLineInterface() {
  if (readLineInterface) {
    readLineInterface.close();
    readLineInterface = null;
  }
}

export async function confirmMessage(message: string) {
  const rl = getReadLineInterface();

  return new Promise<boolean>((resolve) => {
    rl.question(message, (answer: string) => {
      closeReadLineInterface();
      resolve(answer.toLowerCase() === "yes" || answer.toLowerCase() === "y");
    });
  });
}

class TimeoutError extends Error {
  constructor(operationName: string, timeoutMs: number) {
    super(`${operationName} timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * Creates a promise that rejects after the specified timeout
 * @param timeoutMs - Timeout in milliseconds
 * @param operationName - Name of the operation that timed out
 *
 * @returns A promise that rejects after the timeout
 */
export function createTimeoutPromise(
  timeoutMs: number,
  operationName: string
): Promise<never> {
  return new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new TimeoutError(operationName, timeoutMs)),
      timeoutMs
    );
  });
}

export function formatGasPrice(gasPrice: GasPriceData) {
  if (isGasPriceDataEIP1559(gasPrice)) {
    return `maxFeePerGas=${gasPrice.maxFeePerGas.toString()}, maxPriorityFeePerGas=${gasPrice.maxPriorityFeePerGas.toString()}`;
  }
  return `gasPrice=${gasPrice.gasPrice.toString()}`;
}

export async function waitForTransactionWithTimeout(
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

/**
 * Wraps a promise with a timeout, rejecting if the original promise doesn't resolve in time
 *
 * @param promise - The promise to wrap with a timeout
 * @param timeoutMs - Timeout in milliseconds
 * @param operationName - Name of the operation for the timeout error message
 *
 * @returns A promise that resolves with the original promise result or rejects on timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName: string
): Promise<T> {
  return Promise.race([
    promise,
    createTimeoutPromise(timeoutMs, operationName),
  ]);
}

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
   * The wait time for the max gas price. Default is 1 hour.
   */
  waitTimeForMaxGasPrice?: number;

  /**
   * The timeout before increasing the gas price. Default is 5 minutes.
   */
  timeoutBeforeIncreasingGasPrice?: number;
}

type GasPriceData = GasPriceDataEIP1559 | GasPriceDataLegacy;

function isGasPriceDataEIP1559(
  gasPriceData: GasPriceData
): gasPriceData is GasPriceDataEIP1559 {
  return (
    "maxFeePerGas" in gasPriceData && "maxPriorityFeePerGas" in gasPriceData
  );
}

interface GasPriceDataEIP1559 {
  maxFeePerGas: BigNumber;
  maxPriorityFeePerGas: BigNumber;
}

interface GasPriceDataLegacy {
  gasPrice: BigNumber;
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

interface GasPriceIncreaseResult {
  currentGasPrice: GasPriceData;
  baseTxRequest: TransactionRequest;
  usingMaximumGasPrice: boolean;
}

function increaseByPercentage(value: BigNumber, percentage: number): BigNumber {
  return value.mul(100 + percentage).div(100);
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

    // Increase max fee and max priority fee by 10% (capped to maxGasPrice)
    updatedGasPrice = {
      maxFeePerGas: maxFeePerGas.gt(maxGasPrice) ? maxGasPrice : maxFeePerGas,
      maxPriorityFeePerGas: increaseByPercentage(
        currentGasPrice.maxPriorityFeePerGas,
        GAS_INCREASE_STEP
      ),
    };
    usingMaximumGasPrice = updatedGasPrice.maxFeePerGas.eq(maxGasPrice);

    // Delete legacy fields (if they exist). This is an EIP-1559 transaction. They should not be present anyways, since the RPC provider should be consistent (either always EIP-1559 or always legacy)
    delete baseTxRequest.gasPrice;

    // Update transaction request with new gas price
    baseTxRequest.maxFeePerGas = updatedGasPrice.maxFeePerGas;
    baseTxRequest.maxPriorityFeePerGas = updatedGasPrice.maxPriorityFeePerGas;
  } else {
    // Increase legacy gas price by 10%
    const gasPrice = increaseByPercentage(
      currentGasPrice.gasPrice,
      GAS_INCREASE_STEP
    );
    updatedGasPrice = {
      gasPrice: gasPrice.gt(maxGasPrice) ? maxGasPrice : gasPrice,
    };
    usingMaximumGasPrice = updatedGasPrice.gasPrice.eq(maxGasPrice);

    // Delete EIP-1559 fields (if they exist). This is a legacy transaction. They should not be present anyways, since the RPC provider should be consistent (either always EIP-1559 or always legacy)
    delete baseTxRequest.maxFeePerGas;
    delete baseTxRequest.maxPriorityFeePerGas;

    // Add new bumped legacy gas price
    baseTxRequest.gasPrice = updatedGasPrice.gasPrice;
  }

  return {
    currentGasPrice: updatedGasPrice,
    baseTxRequest,
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
    txRequest,
    operationName,
    maxGasIncreasePercentage = MAX_GAS_INCREASE,
    waitTimeForMaxGasPrice = WAIT_TIME_FOR_MAX_GAS_PRICE,
    timeoutBeforeIncreasingGasPrice = TIMEOUT_BEFORE_INCREASING_GAS_PRICE,
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
  const baseTxRequest: TransactionRequest = {
    ...txRequest,
    ...currentGasPrice,
  };

  let tx: ContractTransaction;
  while (true) {
    try {
      // Send the transaction
      tx = await signer.sendTransaction(baseTxRequest);

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
      const {
        currentGasPrice: updatedGasPrice,
        baseTxRequest: updatedTxRequest,
        usingMaximumGasPrice,
      } = increaseGasPrice({
        currentGasPrice,
        baseTxRequest,
        maxGasPrice,
      });

      // Prepare for next iteration
      currentGasPrice = updatedGasPrice;
      Object.assign(baseTxRequest, updatedTxRequest);

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
