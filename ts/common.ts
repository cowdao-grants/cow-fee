import { OrderBookApi, SupportedChainId } from "@cowprotocol/cow-sdk";
import { ethers } from "ethers";
import { multicall3Abi } from "./abi";

export const networkSpecificConfigs = {
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
};

export interface IConfig {
  privateKey: string;
  options: object;
  maxOrders: number;
  module: string;
  gpv2Settlement: string;
  vaultRelayer: string;
  rpcUrl: string;
  network: keyof typeof networkSpecificConfigs;
  wrappedNativeToken: string;
  minOut: bigint;
  targetSafe: string;
  receiver: string;
  buyAmountSlippageBps: number;
  keeper: string;
  appData: string;
  tokenListStrategy: "explorer" | "chain";
  lookbackRange: number;
}

const toChainId = (network: keyof typeof networkSpecificConfigs) => {
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
    default: {
      throw new Error(`Unsupported network ${network}`);
    }
  }
};

export const getOrderbookApi = (config: IConfig) => {
  return new OrderBookApi({
    chainId: toChainId(config.network),
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
