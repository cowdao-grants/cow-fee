import { ethers } from "ethers";
import axios from "axios";
import { SUPPORTED_NETWORKS, toChainId, validatedProvider } from "./ts/common";
import { Command, Option, Argument } from "@commander-js/extra-typings";
import { erc20Abi, moduleAbi } from "./ts/abi";
import { SupportedChainId } from "@cowprotocol/cow-sdk";

const FEE_MODULE_CONTRACT_NAME = "COWFeeModule";

// The fee-withdrawal multisig is the same on all supported networks and has an
// instance of CoWFeeModule registered under it.
const FEE_WITHDRAWAL_MULTISIG = "0x423cEc87f19F0778f549846e0801ee267a917935";

interface IConfig {
  options: object;
  args: string[];
  network: (typeof SUPPORTED_NETWORKS)[number];
  rpcUrl: string;
  module: string;
  chainId: SupportedChainId;
}

interface ModuleParameters {
  receiver: string;
  wrappedNativeToken: string;
  vaultRelayer: string;
  gpv2Settlement: string;
  keeper: string;
  appData: string;
  targetSafe: string;
  minOut: string;
}

const readConfig = async (): Promise<
  [IConfig, ethers.providers.JsonRpcProvider]
> => {
  const program = new Command()
    .name("compare-to-module")
    .addOption(new Option("--network <network>").choices(SUPPORTED_NETWORKS))
    .addOption(new Option("--rpc-url <rpc-url>"))
    .addArgument(
      new Argument(
        "<module>",
        "the address of the module to compare with the currently registered one"
      )
    );
  program.parse();

  const options = program.opts();
  const args = program.args;

  if (args.length !== 1) {
    throw new Error(
      "This script expects exactly one positional parameter with the address of the module to compare"
    );
  }

  const module = ethers.utils.getAddress(program.args[0]);
  const network = options.network ?? "mainnet";
  const [rpcUrl, provider, chainId] = await validatedProvider(
    network,
    options.rpcUrl
  );

  return [
    {
      options,
      args,
      module,
      rpcUrl,
      network,
      chainId,
    },
    provider,
  ];
};

const getModuleParams = async function (
  module: string,
  provider: ethers.providers.JsonRpcProvider
): Promise<ModuleParameters> {
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

  return {
    receiver,
    wrappedNativeToken,
    vaultRelayer,
    gpv2Settlement,
    keeper,
    appData,
    targetSafe,
    minOut: ethers.utils.formatEther(minOut),
  };
};

interface SafeApiModule {
  value: string;
  name: string;
}
interface SafeApiResponse {
  modules: SafeApiModule[] | null;
}

const getRegisteredModule = async function (
  chainId: SupportedChainId
): Promise<string | null> {
  // See https://safe-client.safe.global/api#/safes/safesGetSafeV1
  const request = await axios.get(
    `https://safe-client.safe.global/v1/chains/${chainId}/safes/${FEE_WITHDRAWAL_MULTISIG}`
  );
  const response: SafeApiResponse = request.data;
  const feeModules = (response.modules ?? []).filter(
    (module) => module.name === FEE_MODULE_CONTRACT_NAME
  );
  if (feeModules.length !== 1) {
    console.error(
      `The team multisig at ${FEE_WITHDRAWAL_MULTISIG} has ${
        feeModules.length === 0 ? "no" : "more than one"
      } fee module. No comparison will be presented.`
    );
    return null;
  } else {
    return ethers.utils.getAddress(feeModules[0].value);
  }
};

const compare = async function (
  inputModuleParams: ModuleParameters,
  chainId: number,
  provider: ethers.providers.JsonRpcProvider
) {
  const registeredModule = await getRegisteredModule(chainId);

  if (registeredModule === null) {
    return;
  }

  const registeredModuleParams = await getModuleParams(
    registeredModule,
    provider
  );

  for (const [key, registeredValue] of Object.entries(registeredModuleParams)) {
    const inputValue = inputModuleParams[key as keyof ModuleParameters];
    if (inputValue !== registeredValue) {
      console.log(`Parameter ${key} differs:`);
      console.log(`  New value:              ${inputValue}`);
      console.log(`  Value currently in use: ${registeredValue}`);
    }
  }
};

const main = async () => {
  const [config, provider] = await readConfig();

  const inputModuleParams = await getModuleParams(config.module, provider);
  console.log("Module parameters:\n", inputModuleParams);

  const tokenContract = new ethers.Contract(
    inputModuleParams.wrappedNativeToken,
    erc20Abi,
    provider
  );
  const [tokenName, tokenSymbol] = await Promise.all([
    tokenContract.name(),
    tokenContract.symbol(),
  ]);
  console.log(
    `The wrapped native token is "${tokenName}". The min out is ${inputModuleParams.minOut} ${tokenSymbol}`
  );
  console.log();

  await compare(inputModuleParams, config.chainId, provider);
};

main();
