// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockStableCoin — SilkFlow demo token ("Silk USD" / sUSD)
/// @notice ERC-20 with 6 decimals and an OPEN faucet. For local demo/testnet use
///         only; anyone can mint. Do NOT use in production.
contract MockStableCoin is ERC20 {
    constructor() ERC20("Silk USD", "sUSD") {}

    /// @notice 6-decimal settlement unit, matching real USD stablecoins.
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Open faucet: mint `amount` (in base units, 1 sUSD = 1e6) to `to`.
    function mint(address to, uint256 amount) public {
        require(to != address(0), "MockStableCoin: mint to zero address");
        _mint(to, amount);
    }
}
