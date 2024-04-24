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
  minValue: number;
  module: string;
  gpv2Settlement: string;
  vaultRelayer: string;
  rpcUrl: string;
  network: keyof typeof networkSpecificConfigs;
  buyToken: string;
  minOut: number;
  receiver: string;
  buyTokenDecimals: number;
  buyAmountSlippage: number;
  keeper: string;
  appData: string;
}
