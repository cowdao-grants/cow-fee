import { OrderBookApi, SupportedChainId } from "@cowprotocol/cow-sdk";
import { ethers } from "ethers";
import { multicall3Abi } from "../abi";
import { networkSpecificConfigs, SUPPORTED_NETWORKS } from "../config";

export class TimeoutError extends Error {
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

export const validatedProvider = async function (
  network: (typeof SUPPORTED_NETWORKS)[number],
  userRpcUrl: string | undefined
): Promise<[string, ethers.providers.JsonRpcProvider, number]> {
  const { rpcUrl: defaultRpcUrl, chainId: expectedChainId } =
    networkSpecificConfigs[network];
  const rpcUrl = userRpcUrl || defaultRpcUrl;
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

  // Check if the RPC provider chain matches the expected network
  const providerChainId = (await provider.getNetwork()).chainId;

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
