import { OrderBookApi, SupportedChainId } from "@cowprotocol/cow-sdk";
import { ethers } from "ethers";
import { multicall3Abi } from "./abi";
import readline from "readline";

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
  "lens",
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
  lens: {
    rpcUrl: "https://rpc.lens.xyz",
    explorer: "https://explorer.cow.fi/lens",
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
    case "lens": {
      return SupportedChainId.LENS;
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
