import axios from 'axios';
import { IConfig, getMulticall3, getOrderbookApi } from './common';
import { BigNumber, ethers } from 'ethers';
import { erc20Abi, settlementAbi } from './abi';

interface ITokenInfo {
  address: string;
  symbol: string;
  decimals: number;
  balance?: string;
}

interface IEthplorerResponse {
  tokens: {
    tokenInfo: {
      address: string;
      name: string;
      decimals: string;
      symbol: string;
      price: { rate: number };
    };
    rawBalance: string;
  }[];
}

const getTokenInfosFromEthPlorer = async (
  address: string
): Promise<ITokenInfo[]> => {
  const { data } = await axios.get<IEthplorerResponse>(
    `https://api.ethplorer.io/getAddressInfo/${address}?apiKey=freekey`
  );

  return data.tokens.map((token) => ({
    address: token.tokenInfo.address,
    decimals: +token.tokenInfo.decimals,
    symbol: token.tokenInfo.symbol,
    balance: token.rawBalance,
  }));
};

interface IBlockscoutResponse {
  token: {
    address: string;
    decimals: string;
    exchange_rate: string;
    symbol: string;
    type: string;
  };
  value: string;
}

const getTokenInfosFromBlockscout = async (
  address: string
): Promise<ITokenInfo[]> => {
  const { data } = await axios.get<IBlockscoutResponse[]>(
    `https://gnosis.blockscout.com/api/v2/addresses/${address}/token-balances`
  );

  return data
    .filter((token) => token.token.type === 'ERC-20')
    .map((token) => ({
      address: token.token.address,
      decimals: +token.token.decimals,
      symbol: token.token.symbol,
      balance: token.value,
    }));
};

interface IDefillamaPriceResponse {
  coins: {
    'coingecko:ethereum': {
      price: number;
    };
  };
}

const getEthPrice = async () => {
  const { data } = await axios.get<IDefillamaPriceResponse>(
    'https://coins.llama.fi/prices/current/coingecko:ethereum'
  );
  return data.coins['coingecko:ethereum'].price;
};

const ABI_CODER = new ethers.utils.AbiCoder();

const getDecimals = async (
  provider: ethers.providers.JsonRpcProvider,
  tokens: string[]
): Promise<number[]> => {
  const Multicall3 = getMulticall3(provider);
  const decimalsCalldata = new ethers.utils.Interface(
    erc20Abi
  ).encodeFunctionData('decimals');
  const cds = tokens.map((token) => ({
    target: token,
    callData: decimalsCalldata,
  }));
  const decimalsRet = await Multicall3.tryAggregate(false, cds);
  const decimals = decimalsRet.map((r: any, idx: number) => {
    if (!r.success) return 0;

    try {
      return ABI_CODER.decode(['uint8'], r.returnData)[0];
    } catch (err) {
      console.log('errror decoding', r.returnData, tokens[idx]);
    }
  }) as number[];
  return decimals;
};

// Chunks the range [start,end] into subranges of length `chunkSize`
// (or shorter for the last chunk).
const chunkRange = (start: number, end: number, chunkSize: number): [number, number][] => {
    const chunks: [number, number][] = [];
    for (let i = start; i <= end; i += chunkSize) {
        const chunk = Math.min(i + chunkSize - 1, end);
        chunks.push([i, chunk]);
    }
    return chunks;
}

export const getTokenInfosFromChain = async (
  config: IConfig
): Promise<ITokenInfo[]> => {
  // Fetch logs for at most this many blocks at once to avoid exceeding
  // the node response size limits
  const LOG_FILTER_RANGE = 1000;
  const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
  const settlement = new ethers.Contract(
    config.gpv2Settlement,
    settlementAbi,
    provider
  );
  const tradeFilter = settlement.filters.Trade();
  const currentBlock = await provider.getBlockNumber();

  const chunks = chunkRange(currentBlock - config.lookbackRange, currentBlock, LOG_FILTER_RANGE);
  const logRanges = await Promise.all(chunks.map(async ([start, end]) => {
      return await settlement.queryFilter(
        tradeFilter,
        start,
        end,
      )
  }));
  const logs = logRanges.flat();

  const allTokens = Array.from(
    new Set(
      logs.map((log) => [log.args!.sellToken, log.args!.buyToken]).flat()
    ).values()
  ).filter(
    (x) =>
      x.toLowerCase() !==
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'.toLowerCase()
  );

  const allDecimals = await getDecimals(provider, allTokens);
  const allTokenInfo: ITokenInfo[] = allTokens.map((token, idx) => {
    const decimals = allDecimals[idx];
    return {
      address: token,
      decimals,
      symbol: '',
    };
  });
  return allTokenInfo;
};

export const getTokenBalances = async (
  address: string,
  network: IConfig['network'],
  strategy: 'explorer' | 'chain',
  config: IConfig
): Promise<ITokenInfo[]> => {
  switch (strategy) {
    case 'explorer': {
      switch (network) {
        case 'mainnet': {
          return getTokenInfosFromEthPlorer(address);
        }
        case 'gnosis': {
          return getTokenInfosFromBlockscout(address);
        }
      }
    }
    case 'chain': {
      return getTokenInfosFromChain(config);
    }
  }
};
