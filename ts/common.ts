export const networkSpecificConfigs = {
  mainnet: {
    // NOTE: replace with deployed address
    module: '0x90E75f390332356426B60FB440DF23f860F6A113',
    rpcUrl: 'https://eth.llamarpc.com',
    gpv2Settlement: '0x9008D19f58AAbD9eD0D60971565AA8510560ab41',
    vaultRelayer: '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110',
    buyToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    receiver: '0x423cEc87f19F0778f549846e0801ee267a917935',
  },
  gnosis: {
    // NOTE: replace with deployed address
    module: '0x90E75f390332356426B60FB440DF23f860F6A113',
    rpcUrl: 'https://1rpc.io/gnosis',
    gpv2Settlement: '0x9008D19f58AAbD9eD0D60971565AA8510560ab41',
    vaultRelayer: '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110',
    buyToken: '0x6A023CCd1ff6F2045C3309768eAd9E68F978f6e1',
    // NOTE: needs to be changed for gnosis
    receiver: '0x423cEc87f19F0778f549846e0801ee267a917935',
  },
};

export interface IConfig {
  privateKey: string;
  args: object;
  maxOrders: number;
  minValue: number;
  module: string;
  gpv2Settlement: string;
  vaultRelayer: string;
  rpcUrl: string;
  network: keyof typeof networkSpecificConfigs;
  buyToken: string;
  minEthOut: number;
  receiver: string;
}
