// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.25;

import { ISafe } from "./interfaces/ISafe.sol";
import { IGPv2Settlement } from "./interfaces/IGPv2Settlement.sol";
import { IERC20 } from "./interfaces/IERC20.sol";
import { GPv2Order } from "./libraries/GPv2Order.sol";

contract COWFeeModule {
    error OnlyKeeper();

    // not public to save deployment costs
    ISafe public immutable targetSafe;
    address public immutable toToken;
    address public immutable keeper;
    bytes32 public immutable domainSeparator;
    bytes32 public immutable appData;
    IGPv2Settlement public immutable settlement;
    address public immutable vaultRelayer;
    address public immutable receiver;

    struct Revocation {
        address token;
        address spender;
    }

    struct SwapToken {
        address token;
        uint256 sellAmount;
        uint256 buyAmount;
    }

    modifier onlyKeeper() {
        if (msg.sender != keeper) {
            revert OnlyKeeper();
        }
        _;
    }

    constructor(
        address _settlement,
        address _targetSafe,
        address _toToken,
        address _keeper,
        bytes32 _appData,
        address _receiver
    ) {
        settlement = IGPv2Settlement(_settlement);
        vaultRelayer = settlement.vaultRelayer();
        targetSafe = ISafe(_targetSafe);
        toToken = _toToken;
        keeper = _keeper;
        domainSeparator = settlement.domainSeparator();
        appData = _appData;
        receiver = _receiver;
    }

    /// @notice Approve given tokens of settlement contract to vault relayer
    function approve(address[] calldata _tokens) external onlyKeeper {
        _approve(_tokens);
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

    /// @notice Commit presignatures for sell orders of given tokens of given amounts.
    ///         Optionally, also approve the tokens to be spent to the vault relayer.
    function drip(address[] calldata _approveTokens, SwapToken[] calldata _swapTokens) external onlyKeeper {
        _approve(_approveTokens);

        IGPv2Settlement.InteractionData[] memory dripInteractions =
            new IGPv2Settlement.InteractionData[](_swapTokens.length);

        GPv2Order.Data memory order = GPv2Order.Data({
            sellToken: IERC20(address(0)),
            buyToken: IERC20(toToken),
            receiver: receiver,
            sellAmount: 0,
            buyAmount: 0,
            validTo: nextValidTo(),
            appData: appData,
            feeAmount: 0,
            kind: GPv2Order.KIND_SELL,
            partiallyFillable: true,
            sellTokenBalance: GPv2Order.BALANCE_ERC20,
            buyTokenBalance: GPv2Order.BALANCE_ERC20
        });

        for (uint256 i = 0; i < dripInteractions.length;) {
            SwapToken calldata swapToken = _swapTokens[i];
            order.sellToken = IERC20(swapToken.token);
            order.sellAmount = swapToken.sellAmount;
            order.buyAmount = swapToken.buyAmount;
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

    function _approve(address[] calldata _tokens) internal {
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

    function _execFromModule(address _to, bytes memory _cd) internal returns (bytes memory) {
        (bool success, bytes memory returnData) =
            targetSafe.execTransactionFromModuleReturnData(_to, 0, _cd, ISafe.Operation.Call);
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
