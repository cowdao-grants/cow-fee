export const multicall3Abi = [
  {
    inputs: [
      { internalType: "bool", name: "requireSuccess", type: "bool" },
      {
        components: [
          { internalType: "address", name: "target", type: "address" },
          { internalType: "bytes", name: "callData", type: "bytes" },
        ],
        internalType: "struct Multicall3.Call[]",
        name: "calls",
        type: "tuple[]",
      },
    ],
    name: "tryAggregate",
    outputs: [
      {
        components: [
          { internalType: "bool", name: "success", type: "bool" },
          { internalType: "bytes", name: "returnData", type: "bytes" },
        ],
        internalType: "struct Multicall3.Result[]",
        name: "returnData",
        type: "tuple[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
];

export const erc20Abi = [
  {
    inputs: [{ internalType: "address", name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "owner", type: "address" },
      { internalType: "address", name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    constant: true,
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "symbol",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [],
    name: "name",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "pure",
    type: "function",
  },
];

export const moduleAbi = [
  {
    type: "function",
    name: "appData",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      {
        name: "_tokens",
        type: "address[]",
        internalType: "address[]",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "drip",
    inputs: [
      {
        name: "_approveTokens",
        type: "address[]",
        internalType: "address[]",
      },
      {
        name: "_swapTokens",
        type: "tuple[]",
        internalType: "struct COWFeeModule.SwapToken[]",
        components: [
          {
            name: "token",
            type: "address",
            internalType: "address",
          },
          {
            name: "sellAmount",
            type: "uint256",
            internalType: "uint256",
          },
          {
            name: "buyAmount",
            type: "uint256",
            internalType: "uint256",
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "nextValidTo",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint32",
        internalType: "uint32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "receiver",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract ISafe",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "targetSafe",
    inputs: [],
    outputs: [{ name: "", type: "address", internalType: "contract ISafe" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "wrappedNativeToken",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "keeper",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "settlement",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IGPv2Settlement",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "vaultRelayer",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "minOut",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
];

export const settlementAbi = [
  {
    inputs: [],
    name: "vaultRelayer",
    outputs: [
      { internalType: "contract GPv2VaultRelayer", name: "", type: "address" },
    ],
    stateMutability: "view",
    type: "function",
  },
  { stateMutability: "payable", type: "receive" },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "owner",
        type: "address",
      },
      {
        indexed: false,
        internalType: "contract IERC20",
        name: "sellToken",
        type: "address",
      },
      {
        indexed: false,
        internalType: "contract IERC20",
        name: "buyToken",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "sellAmount",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "buyAmount",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "feeAmount",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "bytes",
        name: "orderUid",
        type: "bytes",
      },
    ],
    name: "Trade",
    type: "event",
  },
];
