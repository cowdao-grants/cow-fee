import { Command, Option } from '@commander-js/extra-typings';
import Safe, { EthersAdapter } from '@safe-global/protocol-kit';
import { networkSpecificConfigs } from './ts/common';
import { ethers } from 'ethers';
import SafeApiKit from '@safe-global/api-kit';

type Network = 'mainnet' | 'gnosis';

const getProvider = (network: Network) => {
  const provider = new ethers.providers.JsonRpcProvider(
    networkSpecificConfigs[network].rpcUrl
  );
  return provider;
};

const serviceUrlForNetwork = (network: Network): string => {
  return `https://safe-transaction-${network}.safe.global`;
};

const proposeTransaction = async (
  network: Network,
  safe: string,
  tx: {
    to: string;
    data: string;
  }
) => {
  const pk = process.env.PRIVATE_KEY;
  if (pk === undefined) {
    throw new Error('PRIVATE_KEY not set');
  }
  const signer = new ethers.Wallet(pk, getProvider(network));
  const ethAdapter = new EthersAdapter({
    ethers,
    signerOrProvider: signer,
  });

  const safeSdk = await Safe.create({
    safeAddress: safe,
    ethAdapter,
  });

  const safeService = new SafeApiKit({
    txServiceUrl: serviceUrlForNetwork(network),
    ethAdapter,
  });
  const nextNonce = await safeService.getNextNonce(safe);
  const safeTx = await safeSdk.createTransaction({
    safeTransactionData: { ...tx, value: '0', nonce: nextNonce },
  });
  const safeTxHash = await safeSdk.getTransactionHash(safeTx);
  const senderSignature = await safeSdk.signTransactionHash(safeTxHash);
  await safeService.proposeTransaction({
    safeAddress: safe,
    safeTransactionData: safeTx.data,
    safeTxHash,
    senderAddress: await signer.getAddress(),
    senderSignature: senderSignature.data,
  });
};

const ABI_CODER = new ethers.utils.AbiCoder();

const enableModule = async (network: Network, safe: string, module: string) => {
  const functionSig = ethers.utils.id('enableModule(address)').slice(0, 10);
  const data = ethers.utils.solidityPack(
    ['bytes4', 'bytes'],
    [functionSig, ABI_CODER.encode(['address'], [module])]
  );
  return proposeTransaction(network, safe, { to: safe, data });
};

const disableModule = async (
  network: Network,
  safe: string,
  module: string,
  previousModule: string
) => {
  const functionSig = ethers.utils
    .id('disableModule(address,address)')
    .slice(0, 10);
  const data = ethers.utils.solidityPack(
    ['bytes4', 'bytes'],
    [
      functionSig,
      ABI_CODER.encode(['address', 'address'], [previousModule, module]),
    ]
  );
  return proposeTransaction(network, safe, { to: safe, data });
};

const main = async () => {
  const program = new Command()
    .name('module-ops')
    .addOption(
      new Option('--network <network>', 'Network')
        .choices(['gnosis', 'mainnet'] as const)
        .default('mainnet' as Network)
    )
    .addOption(
      new Option('--safe <safe>', 'Safe address').makeOptionMandatory()
    )
    .addOption(
      new Option('--module <module>', 'Module address').makeOptionMandatory()
    )
    .addCommand(
      new Command().name('enable-module').action(async (str, options) => {
        const { network, safe, module } = program.opts();
        await enableModule(network, safe, module);
      })
    )
    .addCommand(
      new Command()
        .name('disable-module')
        .addOption(
          new Option(
            '--previous-module <previous-module>',
            'previous module'
          ).makeOptionMandatory()
        )
        .action(async (str, options) => {
          const { previousModule } = options.opts();
          const { network, safe, module } = program.opts();
          await disableModule(network, safe, module, previousModule);
        })
    );

  program.parse();
};

main();
