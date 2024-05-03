import axios from 'axios';
import {
  IConfig,
  chunkedMulticall,
  getLogger,
  getMulticall3,
  getOrderbookApi,
} from './common';
import { BigNumber, ethers } from 'ethers';
import { erc20Abi, settlementAbi } from './abi';

const logger = getLogger('explorer-apis');

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
  logger.info('getting token info with ethplorer api');
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
  logger.info('get token info with blockscout api');
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
  tokens: string[],
  multicallSize: number
): Promise<number[]> => {
  const Multicall3 = getMulticall3(provider);
  const decimalsCalldata = new ethers.utils.Interface(
    erc20Abi
  ).encodeFunctionData('decimals');
  const cds = tokens.map((token) => ({
    target: token,
    callData: decimalsCalldata,
  }));
  const decimalsRet = await chunkedMulticall(provider, cds, multicallSize);
  const decimals = decimalsRet.map((r: any, idx: number) => {
    if (!r.success) return 0;

    try {
      return ABI_CODER.decode(['uint8'], r.returnData)[0];
    } catch (err) {
      logger.info('errror decoding', r.returnData, tokens[idx]);
    }
  }) as number[];
  return decimals;
};

export const getTokenInfosFromChain = async (
  config: IConfig
): Promise<ITokenInfo[]> => {
  logger.info('getting token info from chain');
  const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
  const settlement = new ethers.Contract(
    config.gpv2Settlement,
    settlementAbi,
    provider
  );
  const tradeFilter = settlement.filters.Trade();
  const currentBlock = await provider.getBlockNumber();
  const fromBlock = currentBlock - config.lookbackRange;
  logger.info(`querying trades from ${fromBlock} to ${currentBlock}`);
  const logs = await settlement.queryFilter(
    tradeFilter,
    currentBlock - config.lookbackRange,
    currentBlock
  );
  logger.info(`Found ${logs.length} trades`);
  const allTokens = Array.from(
    new Set(
      logs.map((log) => [log.args!.sellToken, log.args!.buyToken]).flat()
    ).values()
  ).filter(
    (x) =>
      x.toLowerCase() !==
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'.toLowerCase()
  );
  logger.info(`Found ${allTokens.length} unique tokens`);

  logger.info(`Getting decimals for ${allTokens.length} tokens`);
  const allDecimals = await getDecimals(
    provider,
    allTokens,
    config.multicallSize
  );
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
