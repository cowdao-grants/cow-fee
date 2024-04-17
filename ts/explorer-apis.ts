import axios from 'axios';
import { IConfig } from './common';

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

export const getTokenBalances = async (
  address: string,
  network: IConfig['network']
): Promise<ITokenInfo[]> => {
  switch (network) {
    case 'mainnet': {
      return getTokenInfosFromEthPlorer(address);
    }
    case 'gnosis': {
      return getTokenInfosFromBlockscout(address);
    }
  }
};
