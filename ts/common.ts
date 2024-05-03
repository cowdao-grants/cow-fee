import { OrderBookApi, SupportedChainId } from '@cowprotocol/cow-sdk';
import { ethers } from 'ethers';
import { multicall3Abi } from './abi';
import pino from 'pino';

export const networkSpecificConfigs = {
  mainnet: {
    // NOTE: replace with deployed address
    module: '0x29023DE63D7075B4cC2CE30B55f050f9c67548d4',
    rpcUrl: 'https://eth.llamarpc.com',
  },
  gnosis: {
    // NOTE: replace with deployed address
    module: '0x4c04377f90Eb1E42D845AB21De874803B8773669',
    rpcUrl: 'https://1rpc.io/gnosis',
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
  buyToken: string;
  minOut: bigint;
  targetSafe: string;
  receiver: string;
  buyAmountSlippageBps: number;
  keeper: string;
  appData: string;
  lookbackRange: number;
  multicallSize: number;
}

const toChainId = (network: keyof typeof networkSpecificConfigs) => {
  switch (network) {
    case 'mainnet': {
      return SupportedChainId.MAINNET;
    }
    case 'gnosis': {
      return SupportedChainId.GNOSIS_CHAIN;
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
      interval: 'second',
    },
    backoffOpts: {
      numOfAttempts: 5,
      maxDelay: Infinity,
      jitter: 'none',
    },
  });
};

export const getMulticall3 = (provider: ethers.providers.JsonRpcProvider) => {
  return new ethers.Contract(
    '0xcA11bde05977b3631167028862bE2a173976CA11',
    multicall3Abi,
    provider
  );
};

export const chunkedMulticall = async (
  provider: ethers.providers.JsonRpcProvider,
  calls: { target: string; callData: string }[],
  chunkSize: number
) => {
  const mcall = getMulticall3(provider);
  const nChunks = Math.ceil(calls.length / chunkSize);
  const ret = [];
  for (let i = 0; i < nChunks; i++) {
    const start = i * chunkSize;
    const end = start + chunkSize;
    const chunk = calls.slice(start, end);
    ret.push(...(await mcall.tryAggregate(false, chunk)));
  }
  return ret;
};

const logger = pino();
export const getLogger = (name: string) => {
  return logger.child({ name, level: process.env.LOG_LEVEL || 'info' });
};

export const logMemory = () => {
  logger.debug(process.memoryUsage(), 'memory snapshot');
};
