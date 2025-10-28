// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Run on Sepolia Arbitrum:
// 1. set -a; source .env; set +a
// 2. forge script script/00_DeployMockTokens.s.sol:DeployMockTokens --rpc-url arbitrum_sepolia --broadcast -vvvv

// Run on anvil:
// 1. anvil --fork-url <RPC LINK>
// Use --dump-state state.json for dumping the state

// 2. set -a; source .env.anvil; set +a
// 3. forge script script/00_DeployMockTokens.s.sol:DeployMockTokens --rpc-url http://127.0.0.1:8545 --broadcast -vvvv --via-ir
// Store token addresses in .env.anvil: 
import "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MockWBTC} from "../src/MockWBTC.sol";

contract DeployMockTokens is Script {
    function run() external {
        // --- Env ---
        // PRIVATE_KEY: uint256 private key of deployer
        // RECIPIENT: address receiving initial supply (e.g., your EOA)
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address recipient = vm.envAddress("WALLET_ADDRESS");

        uint256 usdcHuman = uint256(100_000_000);
        uint256 wbtcHuman = uint256(1000);

        uint256 usdcInitial = usdcHuman * 10 ** 6;      // 6 decimals
        uint256 wbtcInitial = wbtcHuman * 10 ** 18;     // 18 decimals

        vm.startBroadcast(pk);

        MockUSDC usdc = new MockUSDC(recipient, usdcInitial);
        MockWBTC wbtc = new MockWBTC(recipient, wbtcInitial);

        vm.stopBroadcast();

        console2.log("Deployer:", vm.addr(pk));
        console2.log("USDC:    ", address(usdc));
        console2.log("wBTC:    ", address(wbtc));

    }
}
