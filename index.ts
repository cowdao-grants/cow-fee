import { ethers } from 'ethers';
import { default as minimist } from 'minimist';
import { formatUnits } from 'ethers/lib/utils';
import { getTokensToSwap, swapTokens } from './ts/cowfee';
import { IConfig, networkSpecificConfigs } from './ts/common';

const ABI_CODER = new ethers.utils.AbiCoder();

const readConfig = (): IConfig => {
  const readEnv = (key: string) => {
    const value = process.env[key];
    if (!value) {
      throw new Error(`Missing env var ${key}`);
    }
    return value;
  };

  const privateKey = readEnv('PRIVATE_KEY');

  const args = minimist(process.argv.slice(2));
  const network = args.network || 'mainnet';
  if (!Object.keys(networkSpecificConfigs).includes(network)) {
    throw new Error(`Invalid network ${network}`);
  }
  const {
    rpcUrl: defaultRpcUrl,
    module,
    gpv2Settlement,
    vaultRelayer,
    buyToken,
    receiver,
  } = networkSpecificConfigs[network as keyof typeof networkSpecificConfigs];
  const maxOrders = +args.maxOrders || 250;
  const minValue = +args.minValue || 1000;
  const minEthOut = +args.minEthOut || 0.02;
  const rpcUrl = args['rpc-url'] || defaultRpcUrl;

  return {
    privateKey,
    args,
    maxOrders,
    minValue,
    module,
    gpv2Settlement,
    vaultRelayer,
    rpcUrl,
    network,
    buyToken,
    minEthOut,
    receiver,
  };
};

export const dripItAll = async () => {
  // await getAppData().then(console.log);

  const config = readConfig();
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
