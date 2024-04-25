import axios from 'axios';
import { IConfig, getMulticall3, getOrderbookApi } from './common';
import { BigNumber, ethers } from 'ethers';
import { erc20Abi, settlementAbi } from './abi';

interface ITokenInfo {
  address: string;
  symbol: string;
  rate: number;
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
    rate: token.tokenInfo.price.rate,
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
      rate: +token.token.exchange_rate,
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

export const getTokenInfosFromChain = async (
  config: IConfig
): Promise<ITokenInfo[]> => {
  const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
  const settlement = new ethers.Contract(
    config.gpv2Settlement,
    settlementAbi,
    provider
  );
  const tradeFilter = settlement.filters.Trade();
  const currentBlock = await provider.getBlockNumber();
  const logs = await settlement.queryFilter(
    tradeFilter,
    currentBlock - config.lookbackRange,
    currentBlock
  );
  const allTokens = Array.from(
    new Set(
      logs.map((log) => [log.args!.sellToken, log.args!.buyToken]).flat()
    ).values()
  ).filter(
    (x) =>
      x.toLowerCase() !==
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'.toLowerCase()
  );
  const orderbookApi = getOrderbookApi(config);
  const naitvePrices = await Promise.allSettled(
    allTokens.map((token) => orderbookApi.getNativePrice(token))
  );

  const multiplier = config.network === 'gnosis' ? 1 : await getEthPrice();
  const allDecimals = await getDecimals(provider, allTokens);

  const allTokenInfo: ITokenInfo[] = allTokens.map((token, idx) => {
    const nativePriceResponse = naitvePrices[idx];
    let price: number = 0;
    const decimals = allDecimals[idx];
    const denominator = 10 ** (18 - decimals);

    if (nativePriceResponse.status === 'fulfilled') {
      price =
        ((nativePriceResponse.value.price || 0) * multiplier) / denominator;
    } else {
      // console.log('failure', token, nativePriceResponse.reason);
    }

    return {
      address: token,
      rate: price,
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
