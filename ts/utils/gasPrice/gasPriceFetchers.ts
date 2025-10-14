import { BigNumber, ethers } from "ethers";
import {
  CustomGasPriceFetcher,
  GasPriceDataEIP1559,
} from "../executeTransaction";
import { SupportedChainId } from "@cowprotocol/cow-sdk";

/**
 * Gas Station API response type
 */
interface GasStationResponse {
  safeLow: {
    maxPriorityFee: number;
    maxFee: number;
  };
  standard: {
    maxPriorityFee: number;
    maxFee: number;
  };
  fast: {
    maxPriorityFee: number;
    maxFee: number;
  };
  estimatedBaseFee: number;
  blockTime: number;
  blockNumber: number;
}

/**
 * Creates a gas price fetcher using a Gas Station API
 * @param speed - The speed tier to use: "safeLow", "standard", or "fast"
 * @param apiUrl - The gas station API URL (e.g., "https://gasstation.polygon.technology/v2")
 * @returns A custom gas price fetcher that throws an error if the API request fails
 */
export function createGasPriceFetcher(
  speed: "safeLow" | "standard" | "fast",
  apiUrl: string
): CustomGasPriceFetcher {
  return async (_provider: ethers.providers.Provider) => {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(
        `Gas station API returned ${response.status}: ${response.statusText}`
      );
    }

    const data: GasStationResponse = await response.json();
    const gasPrices = data[speed];

    // Convert from gwei to wei (multiply by 10^9)
    const maxFeePerGas = BigNumber.from(Math.ceil(gasPrices.maxFee * 1e9));
    const maxPriorityFeePerGas = BigNumber.from(
      Math.ceil(gasPrices.maxPriorityFee * 1e9)
    );

    console.log(
      `Gas price (${speed}): maxFee=${gasPrices.maxFee} gwei, maxPriorityFee=${gasPrices.maxPriorityFee} gwei`
    );

    const gasPriceData: GasPriceDataEIP1559 = {
      maxFeePerGas,
      maxPriorityFeePerGas,
    };

    return gasPriceData;
  };
}

/**
 * Creates a custom gas price fetcher from a JSON RPC endpoint
 * @param apiUrl - The API endpoint URL
 * @param parseResponse - Function to parse the API response into gas price data
 * @returns A custom gas price fetcher
 */
export function createCustomGasPriceFetcher(
  apiUrl: string,
  parseResponse: (data: any) =>
    | {
        maxFeePerGas: BigNumber;
        maxPriorityFeePerGas: BigNumber;
      }
    | {
        gasPrice: BigNumber;
      }
): CustomGasPriceFetcher {
  return async (provider: ethers.providers.Provider) => {
    try {
      const response = await fetch(apiUrl);
      if (!response.ok) {
        throw new Error(
          `Custom gas price API returned ${response.status}: ${response.statusText}`
        );
      }

      const data = await response.json();
      return parseResponse(data);
    } catch (error) {
      console.error(`Failed to fetch gas prices from custom API: ${error}`);
      console.log("Falling back to provider.getFeeData()");

      // Fallback to default provider behavior
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
  };
}

/**
 * Network-specific gas price fetchers mapped by chain ID
 */
export const networkGasPriceFetchers: Partial<
  Record<SupportedChainId, CustomGasPriceFetcher>
> = {
  // Polygon mainnet
  [SupportedChainId.POLYGON]: createGasPriceFetcher(
    "fast",
    "https://gasstation.polygon.technology/v2"
  ),
};

/**
 * Gets the appropriate gas price fetcher for a given chain ID
 * @param chainId - The chain ID
 * @returns The gas price fetcher for the network, or undefined to use the default
 */
export function getGasPriceFetcherForNetwork(
  chainId: SupportedChainId
): CustomGasPriceFetcher | undefined {
  return networkGasPriceFetchers[chainId];
}
