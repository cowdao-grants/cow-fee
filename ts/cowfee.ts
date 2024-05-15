import { BigNumber, ContractTransaction, ethers } from 'ethers';
import {
  IConfig,
  getMulticall3,
  getOrderbookApi,
  networkSpecificConfigs,
} from './common';
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

export const getTokensToSwap = async (
  config: IConfig,
  provider: ethers.providers.JsonRpcProvider
) => {
  const unfiltered = await getTokenBalances(
    config.gpv2Settlement,
    config.network,
    config.tokenListStrategy,
    config
  );

  // populate the balances and allowances
  const tokenAddresses = unfiltered.map((token) => token.address);
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
  const unfilteredWithBalanceAndAllowance = unfiltered.map((token, idx) => ({
    ...token,
    balance: balances[idx],
    allowance: allowances[idx],
    needsApproval: allowances[idx].lt(balances[idx]),
  }));

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
  const quotesFiltered = unfilteredWithBalanceAndAllowance
    .map((token, i) => ({
      ...token,
      tokenOut: BigNumber.from(
        (quotes[i].status === 'fulfilled' &&
          (quotes[i] as PromiseFulfilledResult<OrderQuoteResponse>).value.quote
            .buyAmount) ||
        0
      ),
    }))
    .filter((_, i) => quotes[i].status === 'fulfilled');

  // filter by min eth out
  const minOutFiltered = quotesFiltered.filter((token) =>
    BigNumber.from(token.tokenOut).gt(config.minOut)
  );
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

  const toSwapWithBuyAmount = toSwap
    .map((token) => {
      const buyAmount = token.tokenOut
        .mul(10000 - config.buyAmountSlippageBps)
        .div(10000);
      return {
        ...token,
        buyAmount: buyAmount.eq(0) ? BigNumber.from(1) : buyAmount,
      };
    })
    .filter((token) => {
      return token.buyAmount.gt(config.minOut);
    });

  // create orders
  const orders = await Promise.allSettled(
    toSwapWithBuyAmount.map((token) =>
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
  const toActuallySwap = toSwapWithBuyAmount.filter(
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
  console.log('dripTx', dripTx.hash);
  const dripTxReceipt = await dripTx.wait();
  if (dripTxReceipt.status === 0)
    throw new Error(`drip failed: ${dripTxReceipt.transactionHash}`);
};
