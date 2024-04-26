# cow-fee

## Development

Module contract code is located [here](./src/COWFeeModule.sol). The test for it
is located [here](./test/COWFeeModule.t.sol).

The driver script is located at [`index.ts`](./index.ts). All other code is in the [`ts`](./ts)
directory. It uses [`Ethplorer`](https://ethplorer.io) and [`Blockscout`](https://gnosis.blockscout.com) APIs
to determine the different tokens held by the Settlement contract. It then filters them on the basis of:

1. Swap output value, see `--min-out` param.

The program after filtering and determining which tokens to swap, posts the swap orders on the CoW OrderBook API.
For all the orders that got successfully posted, it determines which of those orders require approval
and sends a tx to call [`COWFeeModule::drip`](./src/COWFeeModule.sol) with tokens that need to be approved, and
tokens that need to be swapped specifiying both the sell and buy amounts.

There are additional methods:

1. `COWFeeModule::approve` -- will max approve all the specified tokens to be spent by the vault relayer.
2. `COWFeeModule::revoke` -- will revoke the given tokens for given spenders.

## Usage

Private key for keeper needs to set with `PRIVATE_KEY` environment
variable.

```
Usage: cow-fee [options]

Options:
  --network <network>                                   (choices: "mainnet", "gnosis")
  --rpc-url <rpc-url>
  --max-orders <max-orders>                            Maximum number of orders to place in single drip call (default: 250)
  --min-out <min-out>                                  Minimum amount of to-token to receive per swap (default: 0.02)
  --buy-amount-slippage-bps <buy-amount-slippage-bps>  Tolerance to add to the quoted buyAmount (default: 100)
  --module <module>                                    COWFeeModule address
  --token-list-strategy <strategy>                     Strategy to use to get the list of tokens to swap on (choices: "explorer", "chain", default: "explorer")
  --lookback-range <n>                                 Last <n> number of blocks to check the `Trade` events for (default: 1000)
  -h, --help                                           display help for command
```

### Directly

```sh
yarn ts-node index.ts \
  --network mainnet \
  --max-orders 250 \
  --min-out 0.1 \
  --rpc-url https://eth.llamarpc.com \
  --buy-amount-slippage-bps 100 \
  --module <module-address> \
  --token-list-strategy explorer \
  --lookback-range 1000
```

### Docker

```sh
# build the docker file
docker build -t cow-fee .
# run the container
docker run --rm \
  -e PRIVATE_KEY=$PRIVATE_KEY \
  cow-fee \
  --network mainnet \
  --max-orders 250 \
  --min-out 0.1 \
  --rpc-url https://eth.llamarpc.com \
  --buy-amount-slippage-bps 100 \
  --module <module-address> \
  --token-list-strategy explorer \
  --lookback-range 1000
```

### module-ops

```
Usage: module-ops [options] [command]

Options:
  --network <network>       Network (choices: "gnosis", "mainnet", default: "mainnet")
  --safe <safe>             Safe address
  --module <module>         Module address
  -h, --help                display help for command

Commands:
  enable-module
  disable-module [options]
  help [command]            display help for command
```

#### Enable module

```
yarn ts-node module-ops.ts \
  --network mainnet \
  --safe <safe> \
  --module <module> \
  enable-module
```

#### Disable Module

```
yarn ts-node module-ops.ts \
  --network mainnet \
  --safe <safe> \
  --module <module> \
  disable-module \
  --previous-module <prev-module>
```
