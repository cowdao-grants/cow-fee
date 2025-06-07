import { BigNumber, ethers } from "ethers";

import { erc20Abi } from "../abi";

import { getMulticall3 } from "../utils/misc";

const ABI_CODER = new ethers.utils.AbiCoder();

export const getBalances = async (
  provider: ethers.providers.JsonRpcProvider,
  address: string,
  tokens: string[]
): Promise<BigNumber[]> => {
  const Multicall3 = getMulticall3(provider);
  const balanceOfCalldata = new ethers.utils.Interface(
    erc20Abi
  ).encodeFunctionData("balanceOf", [address]);
  const cds = tokens.map((token) => ({
    target: token,
    callData: balanceOfCalldata,
  }));
  const balancesRet = await Multicall3.tryAggregate(false, cds);
  const balances = balancesRet.map((r: any) =>
    r.success ? ABI_CODER.decode(["uint"], r.returnData)[0] : BigNumber.from(0)
  ) as BigNumber[];
  return balances;
};
