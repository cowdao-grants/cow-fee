# cow-fee

## Development

Module contract code is located [here](./src/COWFeeModule.sol). The test for it
is located [here](./test/COWFeeModule.t.sol).

The driver script is located at [`index.ts`](./index.ts). All other code is in the [`ts`](./ts)
directory. It uses [`Ethplorer`](https://ethplorer.io) and [`Blockscout`](https://gnosis.blockscout.com) APIs
to determine the different tokens held by the Settlement contract. It then filters them on the basis of:

1. Their $ value, see `--min-value` param.
2. Swap output value, see `--min-out` param.

The program after filtering and determining which tokens to swap, posts the swap orders on the CoW OrderBook API.
For all the orders that got successfully posted, it determines which of those orders require approval
and sends a tx to call [`COWFeeModule::approve`](./src/COWFeeModule.sol).

After the approval tx is confirmed, it sends another tx to call [`COWFeeModule::drip`](./src/COWFeeModule.sol)
that sets the PreSignatures for all those orders.

## Usage

Private key for keeper needs to set with `PRIVATE_KEY` environment
variable.

```
Usage: cow-fee [options]

Options:
  --network <network>                           (choices: "mainnet", "gnosis")
  --rpc-url <rpc-url>
  --min-value <min-value>                      Minimum USD value of token to swap (default: 1000)
  --max-orders <max-orders>                    Maximum number of orders to place in single drip call (default: 250)
  --min-out <min-out>                          Minimum amount of to-token to receive per swap (default: 0.02)
  --buy-amount-slippage <buy-amount-slippage>  Tolerance to add to the quoted buyAmount (default: 100)
  --module <module>                            COWFeeModule address
  -h, --help                                   display help for command
```

### Directly

```sh
yarn ts-node index.ts \
  --network mainnet \
  --max-orders 250 \
  --min-value 1000 \
  --min-out 0.1 \
  --rpc-url https://eth.llamarpc.com \
  --buy-amount-slippage 100 \
  --module <module-address>
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
  --min-value 1000 \
  --min-out 0.1 \
  --rpc-url https://eth.llamarpc.com \
  --buy-amount-slippage 100 \
  --module <module-address>
```
