# cow-fee

## Development

Module contract code is located [here](./src/COWFeeModule.sol). The test for it
is located [here](./test/COWFeeModule.t.sol).

The driver script is located at [`index.ts`](./index.ts). All other code is in the [`ts`](./ts)
directory. It can use either [`Ethplorer`](https://ethplorer.io), [`Blockscout`](https://gnosis.blockscout.com) APIs or it can directly get the information on-chain using Settlement `Trade` events to determine the different tokens held by the Settlement contract. It then filters them on the basis of:

1. Swap output value, see module setup.

The program after filtering and determining which tokens to swap, posts the swap orders on the CoW OrderBook API.
For all the orders that got successfully posted, it determines which of those orders require approval
and sends a tx to call [`COWFeeModule::drip`](./src/COWFeeModule.sol) with tokens that need to be approved, and
tokens that need to be swapped specifiying both the sell and buy amounts.

There are additional methods:

1. `COWFeeModule::approve` -- will max approve all the specified tokens to be spent by the vault relayer.
2. `COWFeeModule::revoke` -- will revoke the given tokens for given spenders.

## Usage

### Environment setup

Copy the `.env.example` to `.env` and set the applicable configuration variables for the testing / deployment environment.

### Deploy module

Run the script to deploy the module:

```sh
# Dry run the deployment
forge script ./script/DeployCOWFeeModule.s.sol \
  --rpc-url <rpc>

# Deploy and verify the contract
#   Make sure to set the ETHERSCAN_API_KEY environment variable
forge script ./script/DeployCOWFeeModule.s.sol \
  --rpc-url <rpc> \
  --broadcast --verify
```

### Verify module
To verify the module if the contract is already deployed:
```sh
forge verify-contract <fee-module-address> COWFeeModule --chain-id <chain-id> --etherscan-api-key $ETHERSCAN_API_KEY --constructor-args $(cast abi-encode "constructor(address,address,address,address,bytes32,address,uint256)" <settlement> <target-safe> <wrapped-native-token> <keeper> <app-data> <receiver> <min-out>)
```

### Enable module
The deployment creates the module, but this module needs to be enabled on the target safe.

One way to do this is to use the [Transaction Builder UI](https://app.safe.global/share/safe-app?appUrl=https%3A%2F%2Fapps-portal.safe.global%2Ftx-builder) on the target safe.
1. Select the target safe.
2. Click on `Use Implementation ABI` to load the ABI automatically.
3. Select `enableModule` from the dropdown of available functions.
4. Enter the module address and click on `Add new transaction`
5. Send batch


### Keeper

Private key for keeper needs to set with `PRIVATE_KEY` environment
variable.

```
Usage: cow-fee [options]

Options:
  --network <network>                                   (choices: "mainnet", "gnosis", "arbitrum", "base", "sepolia")
  --rpc-url <rpc-url>
  --max-orders <max-orders>                            Maximum number of orders to place in single drip call (default: 250)
  --buy-amount-slippage-bps <buy-amount-slippage-bps>  Tolerance to add to the quoted buyAmount (default: 100)
  --module <module>                                    COWFeeModule address
  --token-list-strategy <strategy>                     Strategy to use to get the list of tokens to swap on (choices: "explorer", "chain", default: "explorer")
  --lookback-range <n>                                 Last <n> number of blocks to check the `Trade` events for (default: 1000)
  -h, --help                                           display help for command
```

#### Directly

```sh
source .env

yarn ts-node index.ts \
  --network mainnet \
  --max-orders 250 \
  --rpc-url $RPC_URL \
  --buy-amount-slippage-bps 100 \
  --module <module-address> \
  --token-list-strategy chain \
  --lookback-range 1000
```

#### Docker

```sh
source .env

# build the docker file
docker build -t cow-fee .

# run the container
docker run --rm \
  -e PRIVATE_KEY=$PRIVATE_KEY \
  cow-fee \
  --network mainnet \
  --max-orders 250 \
  --rpc-url $RPC_URL \
  --buy-amount-slippage-bps 100 \
  --module <module-address> \
  --token-list-strategy chain \
  --lookback-range 1000
```

### Module operations with cast

#### Enable module

```
cast calldata "enableModule(address)" <module-address>
```

use this calldata to send a transaction from a safe to itself to enable the module on that safe.

#### Disable module

Use the safe UI settings page to disable the module.

### Tests

```sh
forge test -vvv --rpc-url wss://mainnet.gateway.tenderly.co
```
