// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8;

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

    function vaultRelayer() external view returns (address);
}
