import { BigNumber, ethers } from "ethers";

import { IConfig } from "../config";

export async function getEthToWrap(
  config: IConfig,
  provider: ethers.providers.JsonRpcProvider
) {
  const ethBalance = await provider.getBalance(config.gpv2Settlement);
  return ethBalance.gte(config.minOut) ? ethBalance : BigNumber.from(0);
}
