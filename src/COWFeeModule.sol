// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.25;

import { ISafe } from "./interfaces/ISafe.sol";
import { IGPv2Settlement } from "./interfaces/IGPv2Settlement.sol";
import { IERC20 } from "./interfaces/IERC20.sol";
import { GPv2Order } from "./libraries/GPv2Order.sol";

IGPv2Settlement constant settlement = IGPv2Settlement(0x9008D19f58AAbD9eD0D60971565AA8510560ab41);
address constant vaultRelayer = 0xC92E8bdf79f0507f65a392b0ab4667716BFE0110;
bytes32 constant ORDER_TYPE_HASH = hex"d5a25ba2e97094ad7d83dc28a6572da797d6b3e7fc6663bd93efb789fc17e489";
bytes32 constant ERC20_BALANCE_HASH = keccak256("erc20");
bytes32 constant SELL_KIND_HASH = keccak256("sell");

contract COWFeeModule {
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

    modifier onlyKeeper() {
        if (msg.sender != keeper) {
            revert OnlyKeeper();
        }
        _;
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

        GPv2Order.Data memory order = GPv2Order.Data({
            sellToken: IERC20(address(0)),
            buyToken: IERC20(toToken),
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
            order.sellToken = IERC20(swapToken.token);
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
        uint256 remainder = block.timestamp % 1 hours;
        return uint32((block.timestamp - remainder) + 2 hours);
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

    function _computePreSignature(GPv2Order.Data memory order) internal view returns (bytes memory) {
        bytes32 orderDigest = GPv2Order.hash(order, domainSeparator);
        return abi.encodePacked(orderDigest, address(settlement), order.validTo);
    }
}
