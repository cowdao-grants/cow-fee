import { ethers } from 'ethers';
import { formatUnits } from 'ethers/lib/utils';
import { getTokensToSwap, swapTokens } from './ts/cowfee';
import { IConfig, networkSpecificConfigs } from './ts/common';
import { Command, Option } from '@commander-js/extra-typings';

const readConfig = (): IConfig => {
  const readEnv = (key: string) => {
    const value = process.env[key];
    if (!value) {
      throw new Error(`Missing env var ${key}`);
    }
    return value;
  };

  const privateKey = readEnv('PRIVATE_KEY');

  const program = new Command()
    .name('cow-fee')
    .addOption(
      new Option('--network <network>').choices(['mainnet', 'gnosis'] as const)
    )
    .addOption(new Option('--rpc-url <rpc-url>'))
    .addOption(
      new Option(
        '--min-value <min-value>',
        'Minimum USD value of token to swap'
      )
        .default(1000)
        .argParser((x) => +x)
    )
    .addOption(
      new Option(
        '--max-orders <max-orders>',
        'Maximum number of orders to place in single drip call'
      )
        .default(250)
        .argParser((x) => +x)
    )
    .addOption(
      new Option(
        '--min-out <min-out>',
        'Minimum amount of to-token to receive per swap'
      )
        .default(0.02)
        .argParser((x) => +x)
    );
  program.parse();

  const options = program.opts();

  const { network: selectedNetwork, maxOrders, minValue, minOut } = options;
  const network = selectedNetwork || 'mainnet';

  const {
    rpcUrl: defaultRpcUrl,
    module,
    gpv2Settlement,
    vaultRelayer,
    buyToken,
    buyTokenDecimals,
    receiver,
  } = networkSpecificConfigs[network as keyof typeof networkSpecificConfigs];
  const rpcUrl = options.rpcUrl || defaultRpcUrl;

  return {
    privateKey,
    options,
    maxOrders,
    minValue,
    module,
    gpv2Settlement,
    vaultRelayer,
    rpcUrl,
    network,
    buyToken,
    minOut,
    receiver,
    buyTokenDecimals,
  };
};

export const dripItAll = async () => {
  // await getAppData().then(console.log);

  const config = readConfig();
  console.log(config.options);
  const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
  const signer = new ethers.Wallet(config.privateKey, provider);

  const tokensToSwap = await getTokensToSwap(config, provider);
  console.log(
    'tokensToSwap',
    tokensToSwap.map((token) => [
      token.symbol,
      token.address,
      formatUnits(token.balance, token.decimals),
      token.rate,
      token.usdValue,
      token.tokenOut,
      token.needsApproval,
    ])
  );

  for (let i = 0; i < tokensToSwap.length; i += config.maxOrders) {
    const toSwap = tokensToSwap.slice(i, i + config.maxOrders);
    try {
      await swapTokens(config, signer, toSwap);
    } catch (err) {
      console.error(err);
    }
    break;
  }
};

const main = async () => {
  await dripItAll();
};

main();
