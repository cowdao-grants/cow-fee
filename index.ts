import { ethers } from 'ethers';
import { formatUnits } from 'ethers/lib/utils';
import { getTokensToSwap, swapTokens } from './ts/cowfee';
import { IConfig, networkSpecificConfigs } from './ts/common';
import { Command, Option } from '@commander-js/extra-typings';
import { moduleAbi } from './ts/abi';
import { WebClient } from '@slack/web-api';

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
    .requiredOption('--module <module>', 'COWFeeModule address')
    .addOption(
      new Option(
        '--token-list-strategy <strategy>',
        'Strategy to use to get the list of tokens to swap on'
      )
        .choices(['explorer', 'chain'] as const)
        .default('explorer' as 'explorer' | 'chain')
    )
    .addOption(
      new Option(
        '--lookback-range <n>',
        'Last <n> number of blocks to check the `Trade` events for'
      )
        .default(1000)
        .argParser((x) => +x)
    )
    .addOption(
      new Option(
        '--slack <channel>',
        'The slack conversation ID to send a summary of the drip operation to (requires SLACK_TOKEN env var)'
      ).argParser((channel) => {
        return {
          channel: channel,
          token: readEnv('SLACK_TOKEN'),
        };
      })
    );
  program.parse();

  const options = program.opts();

  const {
    network: selectedNetwork,
    maxOrders,
    buyAmountSlippageBps,
    module,
    lookbackRange,
    tokenListStrategy,
  } = options;
  const network = selectedNetwork || 'mainnet';

  const { rpcUrl: defaultRpcUrl } =
    networkSpecificConfigs[network as keyof typeof networkSpecificConfigs];
  const rpcUrl = options.rpcUrl || defaultRpcUrl;
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

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
      tokenListStrategy,
      lookbackRange,
      targetSafe,
      slackConfig: options.slack,
    },
    provider,
  ];
};

export const dripItAll = async () => {
  const [config, provider] = await readConfig();
  console.log(config.options);

  const signer = new ethers.Wallet(config.privateKey, provider);

  const tokensToSwap = await getTokensToSwap(config, provider);
  console.log(
    'tokensToSwap',
    tokensToSwap.map((token) => [
      token.symbol,
      token.address,
      formatUnits(token.balance, token.decimals),
      token.buyAmount,
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

  if (config.slackConfig) {
    const client = new WebClient(config.slackConfig.token);
    let expectedBuy = tokensToSwap.reduce(
      (sum, toSwap) => sum.add(toSwap.buyAmount),
      ethers.BigNumber.from(0)
    );
    const result = await client.chat.postMessage({
      text: `Fee collection for chain ${
        config.network
      } initiated. Expecting proceeds of ${expectedBuy.toString()} (${
        config.buyToken
      })\n\nFollow the progress at ${
        networkSpecificConfigs[config.network].explorer
      }/address/${config.gpv2Settlement}`,
      channel: config.slackConfig.channel,
    });
    console.log(`Successfully sent message ${result.ts} to slack`);
  }
};

const main = async () => {
  await dripItAll();
};

main();
