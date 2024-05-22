import { ethers } from 'ethers';
import { formatUnits } from 'ethers/lib/utils';
import { getTokensToSwap, swapTokens } from './ts/cowfee';
import {
  IConfig,
  getLogger,
  networkSpecificConfigs,
} from './ts/common';
import { Command, Option } from '@commander-js/extra-typings';
import { erc20Abi, moduleAbi, settlementAbi } from './ts/abi';

const readConfig = async (): Promise<
  [IConfig, ethers.providers.JsonRpcProvider]
> => {
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
        '--max-orders <max-orders>',
        'Maximum number of orders to place in single drip call'
      )
        .default(250)
        .argParser((x) => +x)
    )
    .addOption(
      new Option(
        '--buy-amount-slippage-bps <buy-amount-slippage-bps>',
        'Tolerance to add to the quoted buyAmount'
      )
        .default(100)
        .argParser((x) => +x)
    )
    .addOption(new Option('--module <module>', 'COWFeeModule address'))
    .addOption(
      new Option(
        '--lookback-range <n>',
        'Last <n> number of blocks to check the `Trade` events for'
      )
        .default(1000)
        .argParser((x) => +x)
    )
    .addOption(
      new Option('--multicall-size <n>', 'max number of calls in a multicall')
        .default(100)
        .argParser((x) => +x)
    )
    .addOption(
      new Option(
        '--query-logs-size <n>',
        'max block range to use for eth_queryLogs'
      )
        .default(50000)
        .argParser((x) => +x)
    );
  program.parse();

  const options = program.opts();

  const {
    network: selectedNetwork,
    maxOrders,
    buyAmountSlippageBps,
    module: selectedModule,
    lookbackRange,
    multicallSize,
    queryLogsSize,
  } = options;
  const network = selectedNetwork || 'mainnet';

  const { rpcUrl: defaultRpcUrl, module: defaultModule } =
    networkSpecificConfigs[network as keyof typeof networkSpecificConfigs];
  const rpcUrl = options.rpcUrl || defaultRpcUrl;
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const module = selectedModule || defaultModule;

  const moduleContract = new ethers.Contract(module, moduleAbi, provider);
  const [
    receiver,
    toToken,
    vaultRelayer,
    gpv2Settlement,
    keeper,
    appData,
    targetSafe,
    minOut,
  ] = await Promise.all([
    moduleContract.receiver(),
    moduleContract.toToken(),
    moduleContract.vaultRelayer(),
    moduleContract.settlement(),
    moduleContract.keeper(),
    moduleContract.appData(),
    moduleContract.targetSafe(),
    moduleContract.minOut(),
  ]);
  if (
    (await new ethers.Wallet(privateKey).getAddress()).toLowerCase() !==
    keeper.toLowerCase()
  ) {
    throw new Error('Keeper key mismatch');
  }

  return [
    {
      privateKey,
      options,
      maxOrders,
      module,
      gpv2Settlement,
      vaultRelayer,
      rpcUrl,
      network,
      buyToken: toToken,
      minOut,
      receiver,
      buyAmountSlippageBps,
      keeper,
      appData,
      lookbackRange,
      targetSafe,
      multicallSize,
      queryLogsSize,
    },
    provider,
  ];
};

const logger = getLogger('index');

export const dripItAll = async () => {
  // await getAppData().then(console.log);

  const [config, provider] = await readConfig();
  logger.info(config.options, 'config options');
  const signer = new ethers.Wallet(config.privateKey, provider);

  process.on('warning', (e) => console.warn(e.stack));
  const tokensToSwap = await getTokensToSwap(config, provider);
  logger.info(
    tokensToSwap.map((token) => [
      token.symbol,
      token.address,
      formatUnits(token.balance, token.decimals),
      token.buyAmount,
      token.needsApproval,
    ]),
    'tokensToSwap'
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
