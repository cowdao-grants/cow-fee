import { BigNumber, ethers } from "ethers";
import { executeTransaction, TransactionParams } from "./executeTransaction";
import { SupportedChainId } from "@cowprotocol/cow-sdk";

// Mock ethers
jest.mock("ethers", () => {
  const originalEthers = jest.requireActual("ethers");
  return {
    ...originalEthers,
    ethers: {
      ...originalEthers.ethers,
      providers: {
        ...originalEthers.ethers.providers,
        JsonRpcProvider: jest.fn(),
      },
    },
  };
});

// Mock the misc module
jest.mock("./misc", () => ({
  TimeoutError: class TimeoutError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "TimeoutError";
    }
  },
  withTimeout: jest.fn(),
  toPlainObject: (obj: any) => obj,
}));

// Mock the gasPriceFetchers module
jest.mock("./gasPriceFetchers", () => ({
  getGasPriceFetcherForNetwork: jest.fn(),
}));

// Import after mocking
import { TimeoutError, withTimeout } from "./misc";
import { getGasPriceFetcherForNetwork } from "./gasPriceFetchers";

const mockTxHash = "0x1234567890abcdef";

describe("executeTransaction", () => {
  let mockSigner: any;
  let mockProvider: any;
  let mockTransaction: any;
  let mockReceipt: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();

    // Mock provider
    mockProvider = {
      waitForTransaction: jest.fn(),
      getFeeData: jest.fn(),
      getGasPrice: jest.fn(),
    };

    // Mock signer with getFeeData and getGasPrice methods
    mockSigner = {
      sendTransaction: jest.fn(),
      provider: mockProvider,
      getFeeData: jest.fn(),
      getGasPrice: jest.fn(),
    };

    // Mock transaction
    mockTransaction = {
      hash: mockTxHash,
      wait: jest.fn(),
    };

    // Mock receipt
    mockReceipt = {
      transactionHash: mockTxHash,
      status: 1,
    };

    // Mock getGasPriceFetcherForNetwork to return undefined by default (use provider.getFeeData)
    (getGasPriceFetcherForNetwork as jest.Mock).mockReturnValue(undefined);
  });

  describe("executeTransaction - Success cases", () => {
    it("should execute a transaction successfully with EIP-1559 gas pricing", async () => {
      (withTimeout as jest.Mock).mockResolvedValue(mockReceipt);

      mockSigner.getFeeData.mockResolvedValue({
        maxFeePerGas: BigNumber.from("20000000000"), // 20 gwei
        maxPriorityFeePerGas: BigNumber.from("2000000000"), // 2 gwei
        gasPrice: null,
      });

      mockSigner.sendTransaction.mockResolvedValue(mockTransaction);

      const params: TransactionParams = {
        chainId: SupportedChainId.MAINNET,
        signer: mockSigner,
        txRequest: {
          to: "0x1234567890123456789012345678901234567890",
          value: BigNumber.from("1000000000000000000"), // 1 ETH
        },
        operationName: "Test Transaction",
      };

      const result = await executeTransaction(params);

      expect(result).toBe(mockTxHash);
      expect(mockSigner.sendTransaction).toHaveBeenCalledWith({
        to: "0x1234567890123456789012345678901234567890",
        value: BigNumber.from("1000000000000000000"),
        maxFeePerGas: BigNumber.from("20000000000"),
        maxPriorityFeePerGas: BigNumber.from("2000000000"),
        gasPrice: undefined,
      });
    });

    it("should execute a transaction successfully with legacy gas pricing", async () => {
      (withTimeout as jest.Mock).mockResolvedValue(mockReceipt);

      mockSigner.getFeeData.mockResolvedValue({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: BigNumber.from("20000000000"), // 20 gwei
      });

      mockSigner.sendTransaction.mockResolvedValue(mockTransaction);

      const params: TransactionParams = {
        chainId: SupportedChainId.MAINNET,
        signer: mockSigner,
        txRequest: {
          to: "0x1234567890123456789012345678901234567890",
          value: BigNumber.from("1000000000000000000"), // 1 ETH
        },
        operationName: "Test Transaction",
      };

      const result = await executeTransaction(params);

      expect(result).toBe(mockTxHash);
      expect(mockSigner.sendTransaction).toHaveBeenCalledWith({
        to: "0x1234567890123456789012345678901234567890",
        value: BigNumber.from("1000000000000000000"),
        gasPrice: BigNumber.from("20000000000"),
        maxFeePerGas: undefined,
        maxPriorityFeePerGas: undefined,
      });
    });

    it("should handle transaction replacement successfully", async () => {
      (withTimeout as jest.Mock).mockRejectedValue(new Error("timeout"));

      mockSigner.getFeeData.mockResolvedValue({
        maxFeePerGas: BigNumber.from("20000000000"),
        maxPriorityFeePerGas: BigNumber.from("2000000000"),
        gasPrice: null,
      });

      mockSigner.sendTransaction.mockResolvedValue(mockTransaction);

      // Mock replacement transaction
      const replacementReceipt = {
        transactionHash: "0xabcdef1234567890",
        status: 1,
      };

      mockProvider.waitForTransaction.mockResolvedValue(replacementReceipt);

      const params: TransactionParams = {
        chainId: SupportedChainId.MAINNET,
        signer: mockSigner,
        txRequest: {
          to: "0x1234567890123456789012345678901234567890",
          value: BigNumber.from("1000000000000000000"),
        },
        operationName: "Test Transaction",
      };

      // Mock the replacement error
      const replacementError = new Error("replacement transaction");
      (replacementError as any).replacement = { hash: "0xabcdef1234567890" };

      // First call throws replacement error, second call succeeds
      (withTimeout as jest.Mock)
        .mockRejectedValueOnce(replacementError)
        .mockResolvedValueOnce(mockReceipt);

      const result = await executeTransaction(params);

      expect(result).toBe("0xabcdef1234567890");
      expect(mockProvider.waitForTransaction).toHaveBeenCalledWith(
        "0xabcdef1234567890"
      );
    });

    it("should handle nonce already used error", async () => {
      (withTimeout as jest.Mock).mockRejectedValueOnce(
        new Error("nonce has already been used")
      );

      mockSigner.getFeeData.mockResolvedValue({
        maxFeePerGas: BigNumber.from("20000000000"),
        maxPriorityFeePerGas: BigNumber.from("2000000000"),
        gasPrice: null,
      });

      mockSigner.sendTransaction.mockResolvedValue(mockTransaction);

      const params: TransactionParams = {
        chainId: SupportedChainId.MAINNET,
        signer: mockSigner,
        txRequest: {
          to: "0x1234567890123456789012345678901234567890",
          value: BigNumber.from("1000000000000000000"),
        },
        operationName: "Test Transaction",
      };

      const result = await executeTransaction(params);

      expect(result).toBeNull();
    });
  });

  describe("executeTransaction - Gas price increase scenarios", () => {
    it("should increase gas price on timeout and retry", async () => {
      mockSigner.getFeeData.mockResolvedValue({
        maxFeePerGas: BigNumber.from("20000000000"), // 20 gwei
        maxPriorityFeePerGas: BigNumber.from("2000000000"), // 2 gwei
        gasPrice: null,
      });
      const timeoutError = new TimeoutError("Transaction timeout", 5000);

      mockSigner.sendTransaction.mockResolvedValue(mockTransaction);

      // First call times out, second call succeeds
      (withTimeout as jest.Mock)
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce(mockReceipt);

      const params: TransactionParams = {
        chainId: SupportedChainId.MAINNET,
        signer: mockSigner,
        txRequest: {
          to: "0x1234567890123456789012345678901234567890",
          value: BigNumber.from("1000000000000000000"),
        },
        operationName: "Test Transaction",
      };

      const result = await executeTransaction(params);

      expect(result).toBe(mockTxHash);
      expect(mockSigner.sendTransaction).toHaveBeenCalledTimes(2);

      // Check that gas price was increased by 10%
      const calls = mockSigner.sendTransaction.mock.calls;
      const firstCall = calls[0][0];
      const secondCall = calls[1][0];

      expect(firstCall.maxFeePerGas).toEqual(BigNumber.from("20000000000"));
      expect(secondCall.maxFeePerGas).toEqual(BigNumber.from("22000000000")); // +10%
    });

    it("should respect maximum gas price increase", async () => {
      mockSigner.getFeeData.mockResolvedValue({
        maxFeePerGas: BigNumber.from("20000000000"), // 20 gwei
        maxPriorityFeePerGas: BigNumber.from("2000000000"), // 2 gwei
        gasPrice: null,
      });

      mockSigner.sendTransaction.mockResolvedValue(mockTransaction);

      // All calls timeout
      const timeoutError = new TimeoutError("Transaction timeout", 5000);
      (withTimeout as jest.Mock).mockRejectedValue(timeoutError);

      const params: TransactionParams = {
        chainId: SupportedChainId.MAINNET,
        signer: mockSigner,
        txRequest: {
          to: "0x1234567890123456789012345678901234567890",
          value: BigNumber.from("1000000000000000000"),
        },
        operationName: "Test Transaction",
        maxGasIncreasePercentage: 50, // 50% max increase
      };

      // Should eventually reach max gas price and wait longer
      await expect(executeTransaction(params)).rejects.toThrow();
    });
  });

  describe("executeTransaction - Error handling", () => {
    it("should throw error for failed transaction", async () => {
      const failedReceipt = {
        transactionHash: mockTxHash,
        status: 0, // Failed
      };
      (withTimeout as jest.Mock).mockResolvedValue(failedReceipt);

      mockSigner.getFeeData.mockResolvedValue({
        maxFeePerGas: BigNumber.from("20000000000"),
        maxPriorityFeePerGas: BigNumber.from("2000000000"),
        gasPrice: null,
      });

      mockSigner.sendTransaction.mockResolvedValue(mockTransaction);

      const params: TransactionParams = {
        chainId: SupportedChainId.MAINNET,
        signer: mockSigner,
        txRequest: {
          to: "0x1234567890123456789012345678901234567890",
          value: BigNumber.from("1000000000000000000"),
        },
        operationName: "Test Transaction",
      };

      await expect(executeTransaction(params)).rejects.toThrow(
        "Test Transaction transaction failed: 0x1234567890abcdef"
      );
    });

    it("should throw error for non-timeout errors", async () => {
      const nonTimeoutError = new Error("Network error");
      (withTimeout as jest.Mock).mockRejectedValue(nonTimeoutError);

      mockSigner.getFeeData.mockResolvedValue({
        maxFeePerGas: BigNumber.from("20000000000"),
        maxPriorityFeePerGas: BigNumber.from("2000000000"),
        gasPrice: null,
      });

      mockSigner.sendTransaction.mockResolvedValue(mockTransaction);

      const params: TransactionParams = {
        chainId: SupportedChainId.MAINNET,
        signer: mockSigner,
        txRequest: {
          to: "0x1234567890123456789012345678901234567890",
          value: BigNumber.from("1000000000000000000"),
        },
        operationName: "Test Transaction",
      };

      await expect(executeTransaction(params)).rejects.toThrow("Network error");
    });
  });

  describe("executeTransaction - Custom parameters", () => {
    it("should use custom gas increase percentage", async () => {
      mockSigner.getFeeData.mockResolvedValue({
        maxFeePerGas: BigNumber.from("20000000000"), // 20 gwei
        maxPriorityFeePerGas: BigNumber.from("2000000000"), // 2 gwei
        gasPrice: null,
      });

      mockSigner.sendTransaction.mockResolvedValue(mockTransaction);

      // First call times out, second call succeeds
      const timeoutError = new TimeoutError("Transaction timeout", 5000);
      (withTimeout as jest.Mock)
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce(mockReceipt);

      const params: TransactionParams = {
        chainId: SupportedChainId.MAINNET,
        signer: mockSigner,
        txRequest: {
          to: "0x1234567890123456789012345678901234567890",
          value: BigNumber.from("1000000000000000000"),
        },
        operationName: "Test Transaction",
        maxGasIncreasePercentage: 20, // 20% max increase
      };

      const result = await executeTransaction(params);

      expect(result).toBe(mockTxHash);
      expect(mockSigner.sendTransaction).toHaveBeenCalledTimes(2);

      // Check that gas price was increased by 10% (step), not 20%
      const calls = mockSigner.sendTransaction.mock.calls;
      const firstCall = calls[0][0];
      const secondCall = calls[1][0];

      expect(firstCall.maxFeePerGas).toEqual(BigNumber.from("20000000000"));
      expect(secondCall.maxFeePerGas).toEqual(BigNumber.from("22000000000")); // +10% step
    });

    it("should use custom timeout values", async () => {
      (withTimeout as jest.Mock).mockResolvedValue(mockReceipt);

      mockSigner.getFeeData.mockResolvedValue({
        maxFeePerGas: BigNumber.from("20000000000"),
        maxPriorityFeePerGas: BigNumber.from("2000000000"),
        gasPrice: null,
      });

      mockSigner.sendTransaction.mockResolvedValue(mockTransaction);

      const params: TransactionParams = {
        chainId: SupportedChainId.MAINNET,
        signer: mockSigner,
        txRequest: {
          to: "0x1234567890123456789012345678901234567890",
          value: BigNumber.from("1000000000000000000"),
        },
        operationName: "Test Transaction",
        timeoutBeforeIncreasingGasPrice: 60000, // 1 minute
        waitTimeForMaxGasPrice: 7200000, // 2 hours
      };

      const result = await executeTransaction(params);

      expect(result).toBe(mockTxHash);
      expect(withTimeout).toHaveBeenCalledWith(
        mockTransaction.wait(),
        60000,
        "Test Transaction"
      );
    });
  });

  describe("Legacy gas pricing", () => {
    it("should handle legacy gas pricing when EIP-1559 is not available", async () => {
      (withTimeout as jest.Mock).mockResolvedValue(mockReceipt);

      mockSigner.getFeeData.mockResolvedValue({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: BigNumber.from("20000000000"), // 20 gwei
      });

      mockSigner.sendTransaction.mockResolvedValue(mockTransaction);

      const params: TransactionParams = {
        chainId: SupportedChainId.MAINNET,
        signer: mockSigner,
        txRequest: {
          to: "0x1234567890123456789012345678901234567890",
          value: BigNumber.from("1000000000000000000"),
        },
        operationName: "Test Transaction",
      };

      const result = await executeTransaction(params);

      expect(result).toBe(mockTxHash);
      expect(mockSigner.sendTransaction).toHaveBeenCalledWith({
        to: "0x1234567890123456789012345678901234567890",
        value: BigNumber.from("1000000000000000000"),
        gasPrice: BigNumber.from("20000000000"),
        maxFeePerGas: undefined,
        maxPriorityFeePerGas: undefined,
      });
    });

    it("should increase legacy gas price on timeout", async () => {
      mockSigner.getFeeData.mockResolvedValue({
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
        gasPrice: BigNumber.from("20000000000"), // 20 gwei
      });

      mockSigner.sendTransaction.mockResolvedValue(mockTransaction);

      // First call times out, second call succeeds
      const timeoutError = new TimeoutError("Transaction timeout", 5000);
      (withTimeout as jest.Mock)
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce(mockReceipt);

      const params: TransactionParams = {
        chainId: SupportedChainId.MAINNET,
        signer: mockSigner,
        txRequest: {
          to: "0x1234567890123456789012345678901234567890",
          value: BigNumber.from("1000000000000000000"),
        },
        operationName: "Test Transaction",
      };

      const result = await executeTransaction(params);

      expect(result).toBe(mockTxHash);
      expect(mockSigner.sendTransaction).toHaveBeenCalledTimes(2);

      // Check that gas price was increased by 10%
      const calls = mockSigner.sendTransaction.mock.calls;
      const firstCall = calls[0][0];
      const secondCall = calls[1][0];

      expect(firstCall.gasPrice).toEqual(BigNumber.from("20000000000"));
      expect(secondCall.gasPrice).toEqual(BigNumber.from("22000000000")); // +10%
    });
  });

  describe("Chain-specific gas price fetcher", () => {
    it("should use chain-specific gas price fetcher when available", async () => {
      (withTimeout as jest.Mock).mockResolvedValue(mockReceipt);

      const customGasPriceFetcher = jest.fn().mockResolvedValue({
        maxFeePerGas: ethers.utils.parseUnits("30", "gwei"), // 30 gwei
        maxPriorityFeePerGas: ethers.utils.parseUnits("3", "gwei"), // 3 gwei
      });

      (getGasPriceFetcherForNetwork as jest.Mock).mockReturnValue(
        customGasPriceFetcher
      );

      mockSigner.sendTransaction.mockResolvedValue(mockTransaction);

      const params: TransactionParams = {
        chainId: SupportedChainId.POLYGON,
        signer: mockSigner,
        txRequest: {
          to: "0x1234567890123456789012345678901234567890",
          value: BigNumber.from("1000000000000000000"),
        },
        operationName: "Test Transaction",
      };

      const result = await executeTransaction(params);

      expect(result).toBe(mockTxHash);
      expect(getGasPriceFetcherForNetwork).toHaveBeenCalledWith(
        SupportedChainId.POLYGON
      );
      expect(customGasPriceFetcher).toHaveBeenCalled();
      expect(mockSigner.getFeeData).not.toHaveBeenCalled();
      expect(mockSigner.sendTransaction).toHaveBeenCalledWith({
        to: "0x1234567890123456789012345678901234567890",
        value: BigNumber.from("1000000000000000000"),
        maxFeePerGas: BigNumber.from("30000000000"),
        maxPriorityFeePerGas: BigNumber.from("3000000000"),
        gasPrice: undefined,
      });
    });

    it("should use chain-specific fetcher that returns legacy gas price", async () => {
      (withTimeout as jest.Mock).mockResolvedValue(mockReceipt);

      const customGasPriceFetcher = jest.fn().mockResolvedValue({
        gasPrice: BigNumber.from("25000000000"), // 25 gwei
      });

      (getGasPriceFetcherForNetwork as jest.Mock).mockReturnValue(
        customGasPriceFetcher
      );

      mockSigner.sendTransaction.mockResolvedValue(mockTransaction);

      const params: TransactionParams = {
        chainId: SupportedChainId.GNOSIS_CHAIN,
        signer: mockSigner,
        txRequest: {
          to: "0x1234567890123456789012345678901234567890",
          value: BigNumber.from("1000000000000000000"),
        },
        operationName: "Test Transaction",
      };

      const result = await executeTransaction(params);

      expect(result).toBe(mockTxHash);
      expect(getGasPriceFetcherForNetwork).toHaveBeenCalledWith(
        SupportedChainId.GNOSIS_CHAIN
      );
      expect(customGasPriceFetcher).toHaveBeenCalled();
      expect(mockSigner.sendTransaction).toHaveBeenCalledWith({
        to: "0x1234567890123456789012345678901234567890",
        value: BigNumber.from("1000000000000000000"),
        gasPrice: BigNumber.from("25000000000"),
        maxFeePerGas: undefined,
        maxPriorityFeePerGas: undefined,
      });
    });

    it("should fallback to provider.getFeeData when chain-specific fetcher fails", async () => {
      (withTimeout as jest.Mock).mockResolvedValue(mockReceipt);

      const customGasPriceFetcher = jest
        .fn()
        .mockRejectedValue(new Error("Custom fetcher failed"));

      (getGasPriceFetcherForNetwork as jest.Mock).mockReturnValue(
        customGasPriceFetcher
      );

      mockSigner.getFeeData.mockResolvedValue({
        maxFeePerGas: BigNumber.from("20000000000"), // 20 gwei
        maxPriorityFeePerGas: BigNumber.from("2000000000"), // 2 gwei
        gasPrice: null,
      });

      mockSigner.sendTransaction.mockResolvedValue(mockTransaction);

      const params: TransactionParams = {
        chainId: SupportedChainId.POLYGON,
        signer: mockSigner,
        txRequest: {
          to: "0x1234567890123456789012345678901234567890",
          value: BigNumber.from("1000000000000000000"),
        },
        operationName: "Test Transaction",
      };

      const result = await executeTransaction(params);

      expect(result).toBe(mockTxHash);
      expect(getGasPriceFetcherForNetwork).toHaveBeenCalledWith(
        SupportedChainId.POLYGON
      );
      expect(customGasPriceFetcher).toHaveBeenCalled();
      expect(mockSigner.getFeeData).toHaveBeenCalled();
      expect(mockSigner.sendTransaction).toHaveBeenCalledWith({
        to: "0x1234567890123456789012345678901234567890",
        value: BigNumber.from("1000000000000000000"),
        maxFeePerGas: BigNumber.from("20000000000"),
        maxPriorityFeePerGas: BigNumber.from("2000000000"),
        gasPrice: undefined,
      });
    });
  });
});
