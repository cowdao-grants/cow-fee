import { BigNumber, ethers } from "ethers";

import { erc20Abi } from "../abi";

import { getMulticall3 } from "../utils/misc";

const ABI_CODER = new ethers.utils.AbiCoder();

export const getAllowances = async (
  provider: ethers.providers.JsonRpcProvider,
  owner: string,
  spender: string,
  tokens: string[]
): Promise<BigNumber[]> => {
  const Multicall3 = getMulticall3(provider);
  const allowanceCalldata = new ethers.utils.Interface(
    erc20Abi
  ).encodeFunctionData("allowance", [owner, spender]);
  const allowancesRet = await Multicall3.tryAggregate(
    false,
    tokens.map((token) => ({
      target: token,
      callData: allowanceCalldata,
    }))
  );
  const allowances = allowancesRet.map((r: any) =>
    r.success ? ABI_CODER.decode(["uint"], r.returnData)[0] : BigNumber.from(0)
  ) as BigNumber[];
  return allowances;
};
