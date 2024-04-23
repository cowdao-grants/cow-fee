import { BigNumber, ContractTransaction, ethers } from 'ethers';
import { IConfig, networkSpecificConfigs } from './common';
import { getTokenBalances } from './explorer-apis';
import { multicall3Abi, erc20Abi, moduleAbi } from './abi';
import { formatUnits, parseEther, parseUnits } from 'ethers/lib/utils';
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
import { MetadataApi } from '@cowprotocol/app-data';

const ABI_CODER = new ethers.utils.AbiCoder();

const getMulticall3 = (provider: ethers.providers.JsonRpcProvider) => {
  return new ethers.Contract(
    '0xcA11bde05977b3631167028862bE2a173976CA11',
    multicall3Abi,
    provider
  );
};

const getBalances = async (
  provider: ethers.providers.JsonRpcProvider,
  address: string,
  tokens: string[]
): Promise<BigNumber[]> => {
  const Multicall3 = getMulticall3(provider);
  const balanceOfCalldata = new ethers.utils.Interface(
    erc20Abi
  ).encodeFunctionData('balanceOf', [address]);
  const cds = tokens.map((token) => ({
    target: token,
    callData: balanceOfCalldata,
  }));
  const balancesRet = await Multicall3.tryAggregate(false, cds);
  const balances = balancesRet.map((r: any) =>
    r.success ? ABI_CODER.decode(['uint'], r.returnData)[0] : BigNumber.from(0)
  ) as BigNumber[];
  return balances;
};

const getAllowances = async (
  provider: ethers.providers.JsonRpcProvider,
  owner: string,
  spender: string,
  tokens: string[]
): Promise<BigNumber[]> => {
  const Multicall3 = getMulticall3(provider);
  const allowanceCalldata = new ethers.utils.Interface(
    erc20Abi
  ).encodeFunctionData('allowance', [owner, spender]);
  const allowancesRet = await Multicall3.tryAggregate(
    false,
    tokens.map((token) => ({
      target: token,
      callData: allowanceCalldata,
    }))
  );
  const allowances = allowancesRet.map((r: any) =>
    r.success ? ABI_CODER.decode(['uint'], r.returnData)[0] : BigNumber.from(0)
  ) as BigNumber[];
  return allowances;
};

const toChainId = (network: keyof typeof networkSpecificConfigs) => {
  switch (network) {
    case 'mainnet': {
      return SupportedChainId.MAINNET;
    }
    case 'gnosis': {
      return SupportedChainId.GNOSIS_CHAIN;
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

export const getTokensToSwap = async (
  config: IConfig,
  provider: ethers.providers.JsonRpcProvider
) => {
  const unfiltered = await getTokenBalances(
    config.gpv2Settlement,
    config.network
  );

  // simple filter over balances provided by the explorer api
  // to cut down on quotes needed
  const minValueFiltered = unfiltered
    .map((token) => {
      // if balance not found, return minValue so it can make the filter and
      // be checked against actual balance
      const usdValue = !!token.balance
        ? +ethers.utils.formatUnits(token.balance, token.decimals) * token.rate
        : config.minValue;
      return { ...token, usdValue };
    })
    .filter((x) => x.usdValue >= config.minValue);

  // populate the balances and allowances
  const tokenAddresses = minValueFiltered.map((token) => token.address);
  const [balances, allowances] = await Promise.all([
    getBalances(provider, config.gpv2Settlement, tokenAddresses),
    getAllowances(
      provider,
      config.gpv2Settlement,
      config.vaultRelayer,
      tokenAddresses
    ),
  ]);
  // minValue filter again with _real_ balance
  const minValueFilteredWithBalanceAndAllowance = minValueFiltered
    .map((token, idx) => ({
      ...token,
      balance: balances[idx],
      usdValue: +formatUnits(balances[idx], token.decimals) * token.rate,
      allowance: allowances[idx],
      needsApproval: allowances[idx].lt(balances[idx]),
    }))
    .filter((x) => x.usdValue >= config.minValue)
    .sort((a, b) => b.usdValue - a.usdValue);

  // filter shitcoins with no liquidity by using the quotes api
  const orderBookApi = getOrderbookApi(config);
  const quotes = await Promise.allSettled(
    minValueFilteredWithBalanceAndAllowance.map((token) =>
      orderBookApi.getQuote({
        sellToken: token.address,
        sellAmountBeforeFee: token.balance.toString(),
        kind: OrderQuoteSideKindSell.SELL,
        buyToken: config.buyToken,
        from: config.gpv2Settlement,
      })
    )
  );
  const quotesFiltered = minValueFilteredWithBalanceAndAllowance
    .map((token, i) => ({
      ...token,
      tokenOut:
        (quotes[i].status === 'fulfilled' &&
          (quotes[i] as PromiseFulfilledResult<OrderQuoteResponse>).value.quote
            .buyAmount) ||
        0,
    }))
    .filter((_, i) => quotes[i].status === 'fulfilled');

  // filter by min eth out
  // const minOut = parseEther(config.minOut.toString());
  const minOut = parseUnits(config.minOut.toString(), config.buyTokenDecimals);
  const minOutFiltered = quotesFiltered.filter((token) =>
    BigNumber.from(token.tokenOut).gt(minOut)
  );
  return minOutFiltered;
};

// get COWFeeModule appData
export const getAppData = async () => {
  const metadataApi = new MetadataApi();
  const appCode = 'COWFeeModule';
  const environment = 'prod';
  const appDataDoc = await metadataApi.generateAppDataDoc({
    appCode,
    environment,
    metadata: {},
  });
  const { cid, appDataHex, appDataContent } = await metadataApi.appDataToCid(
    appDataDoc
  );
  return { cid, appDataHex, appDataContent };
};

export const swapTokens = async (
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

  // deterministic next valid to
  const nextValidTo = await moduleContract.nextValidTo();
  const { appDataHex, appDataContent } = await getAppData();

  // create orders
  const orders = await Promise.allSettled(
    toSwap.map((token) =>
      orderBookApi.sendOrder({
        sellToken: token.address,
        buyToken: config.buyToken,
        sellAmount: token.balance.toString(),
        buyAmount: '1',
        validTo: nextValidTo,
        appData: appDataContent,
        appDataHash: appDataHex,
        feeAmount: '0',
        kind: OrderKind.SELL,
        partiallyFillable: true,
        sellTokenBalance: SellTokenSource.ERC20,
        buyTokenBalance: BuyTokenDestination.ERC20,
        signingScheme: SigningScheme.PRESIGN,
        signature: '0x',
        from: config.gpv2Settlement,
        receiver: config.receiver,
      })
    )
  );
  console.log(
    'failed',
    orders
      .filter((x) => x.status === 'rejected')
      .map((x) => (x as PromiseRejectedResult).reason)
  );
  console.log(
    'orderIds',
    orders
      .filter((x) => x.status === 'fulfilled')
      .map((x) => (x as PromiseFulfilledResult<string>).value)
  );
  // only execute drip for successfully created orders
  const toActuallySwap = toSwap.filter(
    (x, idx) => orders[idx].status === 'fulfilled'
  );

  // if it filtered out to 0 tokens, dont execute empty approvals and drip
  // shouldn't really happen, likely some bug
  if (toActuallySwap.length === 0) return;

  // only execute approvals for tokens that need it
  const toApprove = toActuallySwap
    .filter((token) => token.needsApproval)
    .map((token) => token.address);
  const toDrip = toActuallySwap.map((token) => ({
    token: token.address,
    sellAmount: token.balance,
  }));

  // drip it
  const dripTx: ContractTransaction = await moduleContract.drip(
    toApprove,
    toDrip
  );
  console.log('dripTx', dripTx.hash);
  const dripTxReceipt = await dripTx.wait();
  if (dripTxReceipt.status === 0)
    throw new Error(`drip failed: ${dripTxReceipt.transactionHash}`);
};
