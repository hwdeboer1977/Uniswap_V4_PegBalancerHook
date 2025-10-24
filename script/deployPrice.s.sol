// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import "../src/TestPriceHelpers.sol"; // adjust path if needed

contract DeployAndCall is Script {
    function run() external {
        // Deploy
        vm.startBroadcast();
        TestPriceHelpers helper = new TestPriceHelpers();
        vm.stopBroadcast();

        // Example A: token0=WETH(18), token1=USDC(6), human price = 2000 (USDC per 1 WETH)
        {
            uint8 dec0 = 18;
            uint8 dec1 = 6;

            // Encode from human amounts: 2000 token1 per 1 token0
            uint160 sqrtP = helper.encodeFromHumanAmounts(2000, 1, dec0, dec1);
            console2.log("sqrtP (2000 USDC per 1 WETH):", uint256(sqrtP));

            // Decode to human & rawE18 (raw scaled by 1e18 to avoid zero)
            (uint256 priceHuman, uint256 priceRawE18) = helper.decodePriceHuman(sqrtP, dec0, dec1);
            console2.log("priceHuman:", priceHuman);   // ~2000
            console2.log("priceRawE18:", priceRawE18); // ~2e9  (i.e., 2e-9 scaled by 1e18)
        }

        // Example B: parity (price = 1) with equal decimals
        {
            uint8 dec0 = 18;
            uint8 dec1 = 18;
            uint160 sqrtP = helper.encodeFromHumanAmounts(1, 1, dec0, dec1);
            (uint256 priceHuman, uint256 priceRawE18) = helper.decodePriceHuman(sqrtP, dec0, dec1);
            console2.log("parity sqrtP:", uint256(sqrtP));
            console2.log("parity priceHuman:", priceHuman); // 1
            console2.log("parity priceRawE18:", priceRawE18); // 1e18
        }
    }
}
