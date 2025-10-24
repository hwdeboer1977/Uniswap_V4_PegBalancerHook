// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * Mock wBTC (18 decimals)
 * Mints initialSupply to `recipient` in constructor.
 * Owner can mint more for testing.
 */
contract MockWBTC is ERC20, Ownable {
    constructor(address recipient, uint256 initialSupply)
        ERC20("Wrappend BTC", "wBTC")
        Ownable(msg.sender)
    {
        _mint(recipient, initialSupply);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
