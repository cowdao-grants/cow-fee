import { BigNumber, ContractTransaction, ethers } from 'ethers';
import { default as minimist } from 'minimist';
import axios from 'axios';
import {
  BuyTokenDestination,
  OrderBookApi,
  OrderKind,
  OrderQuoteResponse,
  OrderQuoteSideKindSell,
  SellTokenSource,
  SigningScheme,
  SupportedChainId,
} from '@cowprotocol/cow-sdk';
import { readFileSync } from 'fs';
import { formatUnits, parseEther } from 'ethers/lib/utils';

const multicall3Abi = [
  {
    inputs: [
      { internalType: 'bool', name: 'requireSuccess', type: 'bool' },
      {
        components: [
          { internalType: 'address', name: 'target', type: 'address' },
          { internalType: 'bytes', name: 'callData', type: 'bytes' },
        ],
        internalType: 'struct Multicall3.Call[]',
        name: 'calls',
        type: 'tuple[]',
      },
    ],
    name: 'tryAggregate',
    outputs: [
      {
        components: [
          { internalType: 'bool', name: 'success', type: 'bool' },
          { internalType: 'bytes', name: 'returnData', type: 'bytes' },
        ],
        internalType: 'struct Multicall3.Result[]',
        name: 'returnData',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
];

const erc20Abi = [
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'owner', type: 'address' },
      { internalType: 'address', name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
];

const moduleAbi = [
  {
    type: 'function',
    name: 'approve',
    inputs: [
      {
        name: '_tokens',
        type: 'address[]',
        internalType: 'address[]',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'drip',
    inputs: [
      {
        name: '_swapTokens',
        type: 'tuple[]',
        internalType: 'struct CoWFeeModule.SwapToken[]',
        components: [
          {
            name: 'token',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'sellAmount',
            type: 'uint256',
            internalType: 'uint256',
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'nextValidTo',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint32',
        internalType: 'uint32',
      },
    ],
    stateMutability: 'view',
  },
];

const networkSpecificConfigs = {
  mainnet: {
    module: '',
    rpcUrl: 'https://eth.llamarpc.com',
    gpv2Settlement: '0x9008D19f58AAbD9eD0D60971565AA8510560ab41',
    vaultRelayer: '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110',
    buyToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  },
};

interface IConfig {
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
}

interface IEthplorerResponse {
  tokens: {
    tokenInfo: {
      address: string;
      name: string;
      decimals: string;
      symbol: string;
      price: { rate: number };
    };
    rawBalance: string;
  }[];
}

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
  const { rpcUrl, module, gpv2Settlement, vaultRelayer, buyToken } =
    networkSpecificConfigs[network as keyof typeof networkSpecificConfigs];
  const maxOrders = +args.maxOrders || 250;
  const minValue = +args.minValue || 1000;
  const minEthOut = +args.minEthOut || 0.02;

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
  };
};

const toChainId = (network: keyof typeof networkSpecificConfigs) => {
  switch (network) {
    case 'mainnet': {
      return SupportedChainId.MAINNET;
    }
    default: {
      throw new Error(`Unsupported network ${network}`);
    }
  }
};

const getOrderbookApi = (config: IConfig) => {
  return new OrderBookApi({
    chainId: toChainId(config.network),
    limiterOpts: {
      tokensPerInterval: 5,
      interval: 'second',
    },
    backoffOpts: {
      numOfAttempts: 5,
      maxDelay: Infinity,
      jitter: 'none',
    },
  });
};

const getTokensToSwap = async (
  config: IConfig,
  provider: ethers.providers.JsonRpcProvider
) => {
  if (config.network !== 'mainnet') {
    throw new Error('Only mainnet is supported');
  }

  const { data } = await axios.get<IEthplorerResponse>(
    `https://api.ethplorer.io/getAddressInfo/${config.gpv2Settlement}?apiKey=freekey`
  );
  // const data: IEthplorerResponse = JSON.parse(
  //   readFileSync('response.json').toString()
  // );

  const minValueFiltered = data.tokens
    .map((token) => {
      const usdValue =
        +ethers.utils.formatUnits(token.rawBalance, +token.tokenInfo.decimals) *
        token.tokenInfo.price.rate;
      return { ...token, usdValue };
    })
    .filter((token) => token.usdValue >= config.minValue);

  const Multicall3 = new ethers.Contract(
    '0xcA11bde05977b3631167028862bE2a173976CA11',
    multicall3Abi,
    provider
  );
  const balanceOfCalldata = new ethers.utils.Interface(
    erc20Abi
  ).encodeFunctionData('balanceOf', [config.gpv2Settlement]);
  const cds = minValueFiltered.map((token) => ({
    target: token.tokenInfo.address,
    callData: balanceOfCalldata,
  }));
  const balancesRet = await Multicall3.tryAggregate(false, cds);
  const balances = balancesRet.map((r: any) =>
    r.success ? ABI_CODER.decode(['uint'], r.returnData)[0] : BigNumber.from(0)
  ) as BigNumber[];

  const allowanceCalldata = new ethers.utils.Interface(
    erc20Abi
  ).encodeFunctionData('allowance', [
    config.gpv2Settlement,
    config.vaultRelayer,
  ]);
  const allowancesRet = await Multicall3.tryAggregate(
    false,
    minValueFiltered.map((token) => ({
      target: token.tokenInfo.address,
      callData: allowanceCalldata,
    }))
  );
  const allowances = allowancesRet.map((r: any) =>
    r.success ? ABI_CODER.decode(['uint'], r.returnData)[0] : BigNumber.from(0)
  ) as BigNumber[];

  const minValueFilteredWithBalance = minValueFiltered
    .map((token, idx) => ({
      ...token,
      balance: balances[idx],
      usdValue:
        +formatUnits(balances[idx], +token.tokenInfo.decimals) *
        token.tokenInfo.price.rate,
      allowance: allowances[idx],
      needsApproval: allowances[idx].lt(balances[idx]),
    }))
    .sort((a, b) => b.usdValue - a.usdValue);

  const orderBookApi = getOrderbookApi(config);
  const quotes = await Promise.allSettled(
    minValueFilteredWithBalance.map((token) =>
      orderBookApi.getQuote({
        sellToken: token.tokenInfo.address,
        sellAmountBeforeFee: token.balance.toString(),
        kind: OrderQuoteSideKindSell.SELL,
        buyToken: config.buyToken,
        from: config.gpv2Settlement,
      })
    )
  );
  const quotesFiltered = minValueFilteredWithBalance
    .map((token, i) => ({
      ...token,
      tokenOut:
        (quotes[i].status === 'fulfilled' &&
          (quotes[i] as PromiseFulfilledResult<OrderQuoteResponse>).value.quote
            .buyAmount) ||
        0,
    }))
    .filter((_, i) => quotes[i].status === 'fulfilled');

  const minOut = parseEther(config.minEthOut.toString());
  const minOutFiltered = quotesFiltered.filter((token) =>
    BigNumber.from(token.tokenOut).gt(minOut)
  );
  return minOutFiltered;
};

const swapTokens = async (
  config: IConfig,
  signerWithProvider: ethers.Signer,
  toSwap: Awaited<ReturnType<typeof getTokensToSwap>>
) => {
  const orderBookApi = getOrderbookApi(config);
  const moduleContract = new ethers.Contract(
    config.module,
    moduleAbi,
    signerWithProvider
  );
  const nextValidTo = await moduleContract.nextValidTo();

  const orders = await Promise.allSettled(
    toSwap.map((token) =>
      orderBookApi.sendOrder({
        sellToken: token.tokenInfo.address,
        buyToken: config.buyToken,
        sellAmount: token.balance.toString(),
        buyAmount: '1',
        validTo: nextValidTo,
        appData: 'CoWFeeModule',
        feeAmount: '0',
        kind: OrderKind.SELL,
        partiallyFillable: true,
        sellTokenBalance: SellTokenSource.ERC20,
        buyTokenBalance: BuyTokenDestination.ERC20,
        signingScheme: SigningScheme.PRESIGN,
        signature: '',
      })
    )
  );
  const toActuallySwap = toSwap.filter(
    (x, idx) => orders[idx].status === 'fulfilled'
  );
  const toApprove = toActuallySwap
    .filter((token) => token.needsApproval)
    .map((token) => token.tokenInfo.address);
  const toDrip = toActuallySwap.map((token) => ({
    token: token.tokenInfo.address,
    sellAmount: token.balance,
  }));

  const approveTx: ContractTransaction = await moduleContract.approve(
    toApprove
  );
  const approveReceipt = await approveTx.wait();
  if (approveReceipt.status === 0)
    throw new Error(`approval failed: ${approveReceipt.transactionHash}`);

  const dripTx: ContractTransaction = await moduleContract.drip(toDrip);
  const dripTxReceipt = await dripTx.wait();
  if (dripTxReceipt.status === 0)
    throw new Error(`drip failed: ${dripTxReceipt.transactionHash}`);
};

const main = async () => {
  const config = readConfig();
  const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
  const signer = new ethers.Wallet(config.privateKey, provider);

  const tokensToSwap = await getTokensToSwap(config, provider);

  for (let i = 0; i < tokensToSwap.length; i += config.maxOrders) {
    const toSwap = tokensToSwap.slice(i, i + config.maxOrders);
    try {
      await swapTokens(config, signer, toSwap);
    } catch (err) {
      console.error(err);
    }
  }
};

main();
