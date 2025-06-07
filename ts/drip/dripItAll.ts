import { ethers } from "ethers";
import { formatUnits } from "ethers/lib/utils";

import { erc20Abi, moduleAbi } from "../abi";
import { IConfig, networkSpecificConfigs } from "../config";

import { getEthToWrap } from "./getEthToWrap";
import { getTokensToSwap } from "./getTokensToSwap";
import { swapTokens } from "./swapTokens";
import { drip } from "./drip";

const WETH_DECIMALS = 18;

export async function dripItAll(
  config: IConfig,
  signer: ethers.Signer,
  provider: ethers.providers.JsonRpcProvider
): Promise<void> {
  const ethToWrap = await getEthToWrap(config, provider);
  console.log("ETH to wrap:", formatUnits(ethToWrap, WETH_DECIMALS));

  const tokensToSwap = await getTokensToSwap(config, provider);
  console.log(
    "Tokens to swap:",
    tokensToSwap.map((token) => ({
      symbol: token.symbol,
      address: token.address,
      balance: formatUnits(token.balance, token.decimals),
      buyAmount: formatUnits(token.buyAmount, WETH_DECIMALS),
      needsApproval: token.needsApproval,
    }))
  );

  const moduleContract = new ethers.Contract(config.module, moduleAbi, signer);
  if (tokensToSwap.length > 0) {
    // Drip the tokens
    for (let i = 0; i < tokensToSwap.length; i += config.maxOrders) {
      const toSwap = tokensToSwap.slice(i, i + config.maxOrders);
      try {
        await swapTokens(moduleContract, config, signer, toSwap);
      } catch (err) {
        console.error("Error dripping:", err);
      }
      break;
    }
  } else if (ethToWrap.gt(0)) {
    // Handles the case where there's no tokens to swap, but we still have to drip to wrap ETH
    await drip({
      moduleContract,
      signer,
      toApprove: [],
      toDrip: [],
      confirmDrip: config.confirmDrip,
    });
  }

  let expectedBuy = tokensToSwap.reduce(
    (sum, toSwap) => sum.add(toSwap.buyAmount),
    ethers.BigNumber.from(0)
  );
  const buyTokenContract = new ethers.Contract(
    config.wrappedNativeToken,
    erc20Abi,
    provider
  );

  const expectedToReceive = expectedBuy.add(ethToWrap);
  const decimals = await buyTokenContract.decimals();
  const expectedUnits = ethers.utils.formatUnits(expectedToReceive, decimals);
  const expectedUnitsFormatted = parseFloat(expectedUnits).toFixed(2);
  console.log(
    `Fee collection for chain ${config.network} initiated (${
      tokensToSwap.length
    } orders). Expecting proceeds of ${expectedUnitsFormatted} ${await buyTokenContract.symbol()}!\n\nFollow the progress at ${
      networkSpecificConfigs[config.network].explorer
    }/address/${config.gpv2Settlement}`
  );
}
