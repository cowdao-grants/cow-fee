// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8;

import {IERC20} from "./IERC20.sol";

interface IWrappedNativeToken is IERC20 {
    function deposit() external payable;
}
