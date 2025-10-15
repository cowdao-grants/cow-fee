import { BigNumber, ethers } from "ethers";

import { Command, Option } from "@commander-js/extra-typings";
import { moduleAbi } from "../abi";
import { IConfig, SUPPORTED_NETWORKS } from "../config";
import { validatedProvider } from "./misc";

export async function readConfig(): Promise<
  [IConfig, ethers.providers.JsonRpcProvider]
> {
  const readEnv = (key: string) => {
    const value = process.env[key];
    if (!value) {
      throw new Error(`Missing env var ${key}`);
    }
    return value;
  };

  const privateKey = readEnv("PRIVATE_KEY");

  const program = new Command()
    .name("cow-fee")
    .addOption(new Option("--network <network>").choices(SUPPORTED_NETWORKS))
    .addOption(new Option("--rpc-url <rpc-url>"))
    .addOption(new Option(
        "--max-fee-per-gas <gwei>",
        "Override maxFeePerGas transaction parameter"
    )
      .argParser(x => ethers.utils.parseUnits(x, 'gwei'))
      ) 
    .addOption(new Option(
        "--max-priority-fee-per-gas <gwei>",
        "Override maxPriorityFeePerGas transaction parameter"
    )
      .argParser(x => ethers.utils.parseUnits(x, 'gwei'))
      )
    .addOption(
      new Option(
        "--max-orders <max-orders>",
        "Maximum number of orders to place in single drip call"
      )
        .default(250)
        .argParser((x) => +x)
    )
    .addOption(
      new Option(
        "--buy-amount-slippage-bps <buy-amount-slippage-bps>",
        "Tolerance to add to the quoted buyAmount"
      )
        .default(100)
        .argParser((x) => +x)
    )
    .requiredOption("--module <module>", "COWFeeModule address")
    .addOption(
      new Option(
        "--token-list-strategy <strategy>",
        "Strategy to use to get the list of tokens to swap on"
      )
        .choices(["explorer", "chain"] as const)
        .default("explorer" as "explorer" | "chain")
    )
    .addOption(
      new Option(
        "--lookback-range <n>",
        "Last <n> number of blocks to check the `Trade` events for"
      )
        .default(1000)
        .argParser((x) => +x)
    )
    .addOption(
      new Option(
        "-c, --confirm-drip",
        "Ask for confirmation before dripping"
      ).default(false)
    );

  program.parse();

  const options = program.opts();

  const {
    network: selectedNetwork,
    maxFeePerGas,
    maxPriorityFeePerGas,
    maxOrders,
    buyAmountSlippageBps,
    module,
    lookbackRange,
    tokenListStrategy,
    confirmDrip,
  } = options;
  const network = selectedNetwork || "mainnet";

  const [rpcUrl, provider, chainId] = await validatedProvider(
    network,
    options.rpcUrl
  );

  const moduleContract = new ethers.Contract(module, moduleAbi, provider);
  const [
    receiver,
    wrappedNativeToken,
    vaultRelayer,
    gpv2Settlement,
    keeper,
    appData,
    targetSafe,
    minOut,
  ] = await Promise.all([
    moduleContract.receiver(),
    moduleContract.wrappedNativeToken(),
    moduleContract.vaultRelayer(),
    moduleContract.settlement(),
    moduleContract.keeper(),
    moduleContract.appData(),
    moduleContract.targetSafe(),
    moduleContract.minOut(),
  ]);
  const wallet = new ethers.Wallet(privateKey);
  const walletAddress = await wallet.getAddress();
  if (walletAddress.toLowerCase() !== keeper.toLowerCase()) {
    throw new Error(
      `The provided private key belongs to ${walletAddress}, which doesn't match the keeper (${keeper})`
    );
  }

  return [
    {
      chainId,
      privateKey,
      options,
      maxOrders,
      module,
      gpv2Settlement,
      vaultRelayer,
      rpcUrl,
      maxFeePerGas,
      maxPriorityFeePerGas,
      network,
      wrappedNativeToken,
      minOut,
      receiver,
      buyAmountSlippageBps,
      keeper,
      appData,
      tokenListStrategy,
      lookbackRange,
      targetSafe,
      confirmDrip,
    },
    provider,
  ];
}
