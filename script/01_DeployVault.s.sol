// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {Vault} from "../src/Vault.sol"; // adjust path if needed

// forge script script/01_DeployVault.s.sol:DeployVault --rpc-url arbitrum_sepolia --broadcast -vv

// 1. set -a; source .env.anvil; set +a
// 2. forge script script/01_DeployVault.s.sol:DeployVault --rpc-url http://127.0.0.1:8545 --broadcast -vvvv --via-ir


contract DeployVault is Script {
    // Env vars (set these in .env or pass with --broadcast --sig)
    // TOKEN: address of the underlying (mock or real) token to deposit in vault
    // OWNER: owner/admin address for the vault
    // REDEEM_PERIOD: initial redemption period (seconds), e.g. 0 for tests
    address internal tokenVault;
    address internal owner;
    uint256 internal redeemPeriod;

    function setUp() public {
        tokenVault          = vm.envAddress("TOKEN_VAULT");
        owner         = vm.envAddress("WALLET_ADDRESS");
        redeemPeriod = vm.envOr("REDEEM_PERIOD", uint256(0));
    }

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);

        Vault vault = new Vault(tokenVault, owner, redeemPeriod);

        vm.stopBroadcast();

        console2.log("Vault deployed to:", address(vault));
        console2.log("  TOKEN_VAULT (asset):   ", tokenVault);
        console2.log("  Owner:          ", owner);
        console2.log("  RedeemPeriod:   ", redeemPeriod);
    }
}
