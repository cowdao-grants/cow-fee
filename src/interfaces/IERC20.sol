// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8;

interface IERC20 {
    function approve(address, uint256) external;
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external;
}
