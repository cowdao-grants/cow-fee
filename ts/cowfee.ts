import { BigNumber, ContractTransaction, ethers } from 'ethers';
import {
  IConfig,
  chunkedMulticall,
  getLogger,
  getMulticall3,
  getOrderbookApi,
  networkSpecificConfigs,
} from './common';
import { getTokenBalances } from './token-fetcher';
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

const logger = getLogger('cowfee');
const ABI_CODER = new ethers.utils.AbiCoder();

const getBalances = async (
  provider: ethers.providers.JsonRpcProvider,
  address: string,
  tokens: string[],
  multicallSize: number
): Promise<BigNumber[]> => {
  const Multicall3 = getMulticall3(provider);
  const balanceOfCalldata = new ethers.utils.Interface(
    erc20Abi
  ).encodeFunctionData('balanceOf', [address]);
  const cds = tokens.map((token) => ({
    target: token,
    callData: balanceOfCalldata,
  }));
  const balancesRet = await chunkedMulticall(provider, cds, multicallSize);
  const balances = balancesRet.map((r: any) =>
    r.success ? ABI_CODER.decode(['uint'], r.returnData)[0] : BigNumber.from(0)
  ) as BigNumber[];
  return balances;
};

const getAllowances = async (
  provider: ethers.providers.JsonRpcProvider,
  owner: string,
  spender: string,
  tokens: string[],
  multicallSize: number
): Promise<BigNumber[]> => {
  const Multicall3 = getMulticall3(provider);
  const allowanceCalldata = new ethers.utils.Interface(
    erc20Abi
  ).encodeFunctionData('allowance', [owner, spender]);
  const allowancesRet = await chunkedMulticall(
    provider,
    tokens.map((token) => ({
      target: token,
      callData: allowanceCalldata,
    })),
    multicallSize
  );
  const allowances = allowancesRet.map((r: any) =>
    r.success ? ABI_CODER.decode(['uint'], r.returnData)[0] : BigNumber.from(0)
  ) as BigNumber[];
  return allowances;
};

export const getTokensToSwap = async (
  config: IConfig,
  provider: ethers.providers.JsonRpcProvider
) => {
  const unfiltered = await getTokenBalances(config);

  // populate the balances and allowances
  const tokenAddresses = unfiltered.map((token) => token.address);
  logger.info(
    `Getting token balances and allowances for ${tokenAddresses.length} tokens`
  );
  const [balances, allowances] = await Promise.all([
    getBalances(
      provider,
      config.gpv2Settlement,
      tokenAddresses,
      config.multicallSize
    ),
    getAllowances(
      provider,
      config.gpv2Settlement,
      config.vaultRelayer,
      tokenAddresses,
      config.multicallSize
    ),
  ]);
  logger.info('got balances and allowances');

  // minValue filter again with _real_ balance
  const unfilteredWithBalanceAndAllowance = unfiltered.map((token, idx) => ({
    ...token,
    balance: balances[idx],
    allowance: allowances[idx],
    needsApproval: allowances[idx].lt(balances[idx]),
  }));


  logger.info(
    `Getting quotes for ${unfilteredWithBalanceAndAllowance.length} tokens`
  );
  // filter shitcoins with no liquidity by using the quotes api
  const orderBookApi = getOrderbookApi(config);
  const quotes = await Promise.allSettled(
    unfilteredWithBalanceAndAllowance.map((token) =>
      orderBookApi.getQuote({
        sellToken: token.address,
        sellAmountBeforeFee: token.balance.toString(),
        kind: OrderQuoteSideKindSell.SELL,
        buyToken: config.buyToken,
        from: config.gpv2Settlement,
      })
    )
  );
  console.log(
    'total tokens prefilter',
    unfilteredWithBalanceAndAllowance.length
  );
  const quotesFiltered = unfilteredWithBalanceAndAllowance
    .map((token, i) => ({
      ...token,
      buyAmount: BigNumber.from(
        (quotes[i].status === 'fulfilled' &&
          (quotes[i] as PromiseFulfilledResult<OrderQuoteResponse>).value.quote
            .buyAmount) ||
        0
      )
        .mul(10000 - config.buyAmountSlippageBps)
        .div(10000),
    }))
    .filter((_, i) => quotes[i].status === 'fulfilled');
  console.log(
    'total tokens after filtering by quotes api',
    quotesFiltered.length
  );

  // filter by min eth out
  const minOutFiltered = quotesFiltered.filter((token) =>
    BigNumber.from(token.buyAmount).gt(config.minOut)
  );
  console.log('total tokens after filtering by minOut', minOutFiltered.length);
  return minOutFiltered;
};

// get COWFeeModule appData
export const getAppData = async () => {
  const metadataApi = new MetadataApi();
  const appCode = 'CoWFeeModule';
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
  if (appDataHex.toLowerCase() !== config.appData.toLowerCase()) {
    throw new Error(`appData mismatch: ${appDataHex} != ${config.appData}`);
  }

  // create orders
  const orders = await Promise.allSettled(
    toSwap.map((token) =>
      orderBookApi.sendOrder({
        sellToken: token.address,
        buyToken: config.buyToken,
        sellAmount: token.balance.toString(),
        buyAmount: token.buyAmount.toString(),
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
  logger.info(
    orders
      .filter((x) => x.status === 'rejected')
      .map((x) => (x as PromiseRejectedResult).reason),
    'failed orders'
  );
  logger.info(
    orders
      .filter((x) => x.status === 'fulfilled')
      .map((x) => (x as PromiseFulfilledResult<string>).value),
    'orderIds'
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
    buyAmount: token.buyAmount,
  }));

  // drip it
  const dripTx: ContractTransaction = await moduleContract.drip(
    toApprove,
    toDrip
  );
  logger.info(dripTx.hash, 'dripTx');
  const dripTxReceipt = await dripTx.wait();
  if (dripTxReceipt.status === 0)
    throw new Error(`drip failed: ${dripTxReceipt.transactionHash}`);
};
