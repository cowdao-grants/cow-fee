import { ethers } from "ethers";
import { dripItAll } from "./ts/drip/dripItAll";
import { readConfig } from "./ts/utils/readConfig";

const main = async () => {
  const [config, provider] = await readConfig();
  console.log("Config options:\n", config.options);

  const wallet = new ethers.Wallet(config.privateKey, provider);
  console.log("Wallet address:", wallet.address);

  await dripItAll(config, wallet, provider);
  process.exit(0);
};

main();
