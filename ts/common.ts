export const networkSpecificConfigs = {
  mainnet: {
    // NOTE: replace with deployed address
    module: '0x4c04377f90Eb1E42D845AB21De874803B8773669',
    rpcUrl: 'https://eth.llamarpc.com',
    gpv2Settlement: '0x9008D19f58AAbD9eD0D60971565AA8510560ab41',
  },
  gnosis: {
    // NOTE: replace with deployed address
    module: '0x4c04377f90Eb1E42D845AB21De874803B8773669',
    rpcUrl: 'https://1rpc.io/gnosis',
    gpv2Settlement: '0x9008D19f58AAbD9eD0D60971565AA8510560ab41',
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
}
