pragma solidity 0.8.25;

interface ISafe {
    enum Operation {
        Call,
        DelegateCall
    }

    function execTransactionFromModuleReturnData(address to, uint256 value, bytes memory data, Operation operation)
        external
        returns (bool success, bytes memory returnData);

    function enableModule(address module) external;
}

interface IGPv2Settlement {
    struct OrderData {
        address sellToken;
        address buyToken;
        address receiver;
        uint256 sellAmount;
        uint256 buyAmount;
        uint32 validTo;
        bytes32 appData;
        uint256 feeAmount;
        bytes32 kind;
        bool partiallyFillable;
        bytes32 sellTokenBalance;
        bytes32 buyTokenBalance;
    }

    struct TradeData {
        uint256 sellTokenIndex;
        uint256 buyTokenIndex;
        address receiver;
        uint256 sellAmount;
        uint256 buyAmount;
        uint32 validTo;
        bytes32 appData;
        uint256 feeAmount;
        uint256 flags;
        uint256 executedAmount;
        bytes signature;
    }

    struct InteractionData {
        address to;
        uint256 value;
        bytes callData;
    }

    function settle(
        address[] memory tokens,
        uint256[] memory clearingPrices,
        TradeData[] memory trades,
        InteractionData[][3] memory interactions
    ) external;

    function setPreSignature(bytes calldata orderUid, bool signed) external;

    function domainSeparator() external view returns (bytes32);
}

interface IERC20 {
    function approve(address, uint256) external;
}

IGPv2Settlement constant settlement = IGPv2Settlement(0x9008D19f58AAbD9eD0D60971565AA8510560ab41);
address constant vaultRelayer = 0xC92E8bdf79f0507f65a392b0ab4667716BFE0110;
bytes32 constant ORDER_TYPE_HASH = hex"d5a25ba2e97094ad7d83dc28a6572da797d6b3e7fc6663bd93efb789fc17e489";
bytes32 constant ERC20_BALANCE_HASH = keccak256("erc20");
bytes32 constant SELL_KIND_HASH = keccak256("sell");

contract CoWFeeModule {
    error OnlyKeeper();

    // not public to save deployment costs
    ISafe immutable receiver;
    address immutable toToken;
    address immutable keeper;
    bytes32 immutable domainSeparator;
    bytes32 immutable appData;

    struct Revocation {
        address token;
        address spender;
    }

    struct SwapToken {
        address token;
        uint256 sellAmount;
    }

    constructor(address _receiver, address _toToken, address _keeper, bytes32 _appData) {
        receiver = ISafe(_receiver);
        toToken = _toToken;
        keeper = _keeper;
        domainSeparator = settlement.domainSeparator();
        appData = _appData;
    }

    /// @notice Approve given tokens of settlement contract to vault relayer
    function approve(address[] calldata _tokens) external onlyKeeper {
        IGPv2Settlement.InteractionData[] memory approveInteractions =
            new IGPv2Settlement.InteractionData[](_tokens.length);

        for (uint256 i = 0; i < _tokens.length;) {
            address token = _tokens[i];
            approveInteractions[i] = IGPv2Settlement.InteractionData({
                to: token,
                value: 0,
                callData: abi.encodeCall(IERC20.approve, (vaultRelayer, type(uint256).max))
            });

            unchecked {
                ++i;
            }
        }

        _execInteractions(approveInteractions);
    }

    /// @notice Revoke approvals for given tokens to given contracts
    function revoke(Revocation[] calldata _revocations) external onlyKeeper {
        IGPv2Settlement.InteractionData[] memory revokeInteractions =
            new IGPv2Settlement.InteractionData[](_revocations.length);
        for (uint256 i = 0; i < _revocations.length;) {
            Revocation calldata revocation = _revocations[i];
            revokeInteractions[i] = IGPv2Settlement.InteractionData({
                to: revocation.token,
                value: 0,
                callData: abi.encodeCall(IERC20.approve, (revocation.spender, 0))
            });

            unchecked {
                ++i;
            }
        }
        _execInteractions(revokeInteractions);
    }

    /// @notice Commit presignatures for sell orders of given tokens of given amounts
    function drip(SwapToken[] calldata _swapTokens) external onlyKeeper {
        IGPv2Settlement.InteractionData[] memory dripInteractions =
            new IGPv2Settlement.InteractionData[](_swapTokens.length);

        IGPv2Settlement.OrderData memory order = IGPv2Settlement.OrderData({
            sellToken: address(0),
            buyToken: toToken,
            receiver: address(receiver),
            sellAmount: 0,
            buyAmount: 1,
            validTo: nextValidTo(),
            appData: appData,
            feeAmount: 0,
            kind: SELL_KIND_HASH,
            partiallyFillable: true,
            sellTokenBalance: ERC20_BALANCE_HASH,
            buyTokenBalance: ERC20_BALANCE_HASH
        });

        for (uint256 i = 0; i < dripInteractions.length;) {
            SwapToken calldata swapToken = _swapTokens[i];
            order.sellToken = swapToken.token;
            order.sellAmount = swapToken.sellAmount;
            bytes memory preSignature = _computePreSignature(order);

            dripInteractions[i] = IGPv2Settlement.InteractionData({
                to: address(settlement),
                value: 0,
                callData: abi.encodeCall(IGPv2Settlement.setPreSignature, (preSignature, true))
            });

            unchecked {
                ++i;
            }
        }

        _execInteractions(dripInteractions);
    }

    /// @notice The `validTo` that the orders will be createad with
    /// @dev deterministic so the script can push the orders before dripping onchain
    function nextValidTo() public view returns (uint32) {
        uint256 remainder = block.timestamp % 2 hours;
        return (block.timestamp - remainder) + 2 hours;
    }

    function _execFromModule(address _to, bytes memory _cd) internal returns (bytes memory) {
        (bool success, bytes memory returnData) =
            receiver.execTransactionFromModuleReturnData(_to, 0, _cd, ISafe.Operation.Call);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(returnData, 0x20), mload(returnData))
            }
        }
        return returnData;
    }

    function _execInteractions(IGPv2Settlement.InteractionData[] memory _interactions) internal {
        address[] memory tokens = new address[](0);
        uint256[] memory clearingPrices = new uint256[](0);
        IGPv2Settlement.TradeData[] memory trades = new IGPv2Settlement.TradeData[](0);
        IGPv2Settlement.InteractionData[][3] memory interactions =
            [new IGPv2Settlement.InteractionData[](0), _interactions, new IGPv2Settlement.InteractionData[](0)];
        bytes memory cd = abi.encodeCall(IGPv2Settlement.settle, (tokens, clearingPrices, trades, interactions));
        _execFromModule(address(settlement), cd);
    }

    function _computePreSignature(IGPv2Settlement.OrderData memory order) internal view returns (bytes memory) {
        bytes32 orderDigest = _computeOrderHash(order);
        return abi.encodePacked(orderDigest, address(settlement), order.validTo);
    }

    // copied over from GPv2Order.sol
    function _computeOrderHash(IGPv2Settlement.OrderData memory order) internal view returns (bytes32 orderDigest) {
        bytes32 structHash;

        // NOTE: Compute the EIP-712 order struct hash in place. As suggested
        // in the EIP proposal, noting that the order struct has 10 fields, and
        // including the type hash `(12 + 1) * 32 = 416` bytes to hash.
        // <https://github.com/ethereum/EIPs/blob/master/EIPS/eip-712.md#rationale-for-encodedata>
        // solhint-disable-next-line no-inline-assembly
        assembly {
            let dataStart := sub(order, 32)
            let temp := mload(dataStart)
            mstore(dataStart, ORDER_TYPE_HASH)
            structHash := keccak256(dataStart, 416)
            mstore(dataStart, temp)
        }

        bytes32 domainSeparator_ = domainSeparator;
        // NOTE: Now that we have the struct hash, compute the EIP-712 signing
        // hash using scratch memory past the free memory pointer. The signing
        // hash is computed from `"\x19\x01" || domainSeparator || structHash`.
        // <https://docs.soliditylang.org/en/v0.7.6/internals/layout_in_memory.html#layout-in-memory>
        // <https://github.com/ethereum/EIPs/blob/master/EIPS/eip-712.md#specification>
        // solhint-disable-next-line no-inline-assembly
        assembly {
            let freeMemoryPointer := mload(0x40)
            mstore(freeMemoryPointer, "\x19\x01")
            mstore(add(freeMemoryPointer, 2), domainSeparator_)
            mstore(add(freeMemoryPointer, 34), structHash)
            orderDigest := keccak256(freeMemoryPointer, 66)
        }
    }

    modifier onlyKeeper() {
        if (msg.sender != keeper) {
            revert OnlyKeeper();
        }
        _;
    }
}
