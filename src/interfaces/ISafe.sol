// SPDX-License-Identifier: GPL-3.0-or-later
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
