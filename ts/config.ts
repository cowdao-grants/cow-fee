import { SupportedChainId } from "@cowprotocol/cow-sdk";
import { BigNumber, ethers } from "ethers";

interface NetworkDetails {
  rpcUrl: string;
  explorer: string;
  chainId: SupportedChainId;
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
  "bnb",
  "linea",
  "plasma",
] as const;

export const networkSpecificConfigs: Record<
  (typeof SUPPORTED_NETWORKS)[number],
  NetworkDetails
> = {
  mainnet: {
    rpcUrl: "https://eth.llamarpc.com",
    explorer: "https://explorer.cow.fi",
    chainId: SupportedChainId.MAINNET,
  },
  gnosis: {
    rpcUrl: "https://1rpc.io/gnosis",
    explorer: "https://explorer.cow.fi/gc",
    chainId: SupportedChainId.GNOSIS_CHAIN,
  },
  arbitrum: {
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    explorer: "https://explorer.cow.fi/arb1",
    chainId: SupportedChainId.ARBITRUM_ONE,
  },
  base: {
    rpcUrl: "https://base.llamarpc.com",
    explorer: "https://explorer.cow.fi/base",
    chainId: SupportedChainId.BASE,
  },
  sepolia: {
    rpcUrl: "https://sepolia.drpc.org",
    explorer: "https://explorer.cow.fi/sepolia",
    chainId: SupportedChainId.SEPOLIA,
  },
  avalanche: {
    rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
    explorer: "https://explorer.cow.fi/avax",
    chainId: SupportedChainId.AVALANCHE,
  },
  polygon: {
    rpcUrl: "https://polygon-rpc.com",
    explorer: "https://explorer.cow.fi/pol",
    chainId: SupportedChainId.POLYGON,
  },
  lens: {
    rpcUrl: "https://rpc.lens.xyz",
    explorer: "https://explorer.cow.fi/lens",
    chainId: SupportedChainId.LENS,
  },
  bnb: {
    rpcUrl: "https://bsc-dataseed.bnbchain.org",
    explorer: "https://explorer.cow.fi/bnb",
    chainId: SupportedChainId.BNB,
  },
  linea: {
    rpcUrl: "https://rpc.linea.build",
    explorer: "https://explorer.cow.fi/linea",
    chainId: SupportedChainId.LINEA,
  },
  plasma: {
    rpcUrl: "https://rpc.plasma.to",
    explorer: "https://explorer.cow.fi/plasma",
    chainId: SupportedChainId.PLASMA,
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
  maxFeePerGas?: BigNumber;
  maxPriorityFeePerGas?: BigNumber;
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
