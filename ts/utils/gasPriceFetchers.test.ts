import { BigNumber } from "ethers";
import { SupportedChainId } from "@cowprotocol/cow-sdk";
import {
  createGasPriceFetcher,
  getGasPriceFetcherForNetwork,
} from "./gasPriceFetchers";

// Mock fetch
global.fetch = jest.fn();

describe("gasPriceFetchers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
  });

  describe("createGasPriceFetcher", () => {
    const mockPolygonResponse = {
      safeLow: {
        maxPriorityFee: 28.876203545,
        maxFee: 58.494393377,
      },
      standard: {
        maxPriorityFee: 30.99231378,
        maxFee: 60.610503612,
      },
      fast: {
        maxPriorityFee: 33.704470949,
        maxFee: 63.322660781,
      },
      estimatedBaseFee: 29.618189832,
      blockTime: 2,
      blockNumber: 77676729,
    };

    it("should fetch gas prices from Polygon gas station API with fast speed", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockPolygonResponse,
      });

      const fetcher = createGasPriceFetcher(
        "fast",
        "https://gasstation.polygon.technology/v2"
      );
      const result = await fetcher();

      expect(global.fetch).toHaveBeenCalledWith(
        "https://gasstation.polygon.technology/v2"
      );
      expect(result).toEqual({
        maxFeePerGas: BigNumber.from(Math.ceil(63.322660781 * 1e9)),
        maxPriorityFeePerGas: BigNumber.from(Math.ceil(33.704470949 * 1e9)),
      });
    });

    it("should fetch gas prices with standard speed", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockPolygonResponse,
      });

      const fetcher = createGasPriceFetcher(
        "standard",
        "https://gasstation.polygon.technology/v2"
      );
      const result = await fetcher();

      expect(result).toEqual({
        maxFeePerGas: BigNumber.from(Math.ceil(60.610503612 * 1e9)),
        maxPriorityFeePerGas: BigNumber.from(Math.ceil(30.99231378 * 1e9)),
      });
    });

    it("should fetch gas prices with safeLow speed", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockPolygonResponse,
      });

      const fetcher = createGasPriceFetcher(
        "safeLow",
        "https://gasstation.polygon.technology/v2"
      );
      const result = await fetcher();

      expect(result).toEqual({
        maxFeePerGas: BigNumber.from(Math.ceil(58.494393377 * 1e9)),
        maxPriorityFeePerGas: BigNumber.from(Math.ceil(28.876203545 * 1e9)),
      });
    });

    it("should use custom API URL when provided", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => mockPolygonResponse,
      });

      const customUrl = "https://custom-gas-api.example.com/v2";
      const fetcher = createGasPriceFetcher("fast", customUrl);
      await fetcher();

      expect(global.fetch).toHaveBeenCalledWith(customUrl);
    });

    it("should throw error on API error", async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      const fetcher = createGasPriceFetcher(
        "fast",
        "https://gasstation.polygon.technology/v2"
      );

      await expect(fetcher()).rejects.toThrow(
        "Gas station API returned 500: Internal Server Error"
      );
    });

    it("should throw error on network error", async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error("Network error"));

      const fetcher = createGasPriceFetcher(
        "fast",
        "https://gasstation.polygon.technology/v2"
      );

      await expect(fetcher()).rejects.toThrow("Network error");
    });
  });

  describe("getGasPriceFetcherForNetwork", () => {
    it("should return Polygon fetcher for Polygon chain ID", () => {
      const fetcher = getGasPriceFetcherForNetwork(SupportedChainId.POLYGON);
      expect(fetcher).toBeDefined();
    });

    it("should return undefined for unsupported chain IDs", () => {
      const fetcher = getGasPriceFetcherForNetwork(SupportedChainId.MAINNET); // Ethereum mainnet
      expect(fetcher).toBeUndefined();
    });
  });
});
