// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import {ArbExecutor} from "../src/ArbExecutor.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

// forge script script/06_ArbExecutor.s.sol --rpc-url arbitrum_sepolia --private-key 0xYOUR_PRIVATE_KEY --broadcast -vvvv --via-ir

// 1. set -a; source .env.anvil; set +a
// 2. forge script script/06_ArbExecutor.s.sol --rpc-url http://127.0.0.1:8545 --private-key 0xYOUR_PRIVATE_KEY --broadcast -vvvv --via-ir

interface IERC4626Like {
    function asset() external view returns (address);
}

contract DeployArbExecutor is Script {
    function run() external {
        // --- Read env ---
        address BASE_TOKEN      = vm.envAddress("TOKEN0_ADDRESS");       // e.g. WBTC or USDC
        address YTOKEN          = vm.envAddress("TOKEN1_ADDRESS");       // yBTC (ERC4626 share token)
        address VAULT_ADDR      = vm.envAddress("VAULT_ADDRESS");        // ERC4626 vault
        address V4_ROUTER       = vm.envAddress("ARBITRUM_SEPOLIA_ROUTER");   // TestSwapRouter address

        // PoolKey (must match your initialized v4 pool)
        address POOL_CURRENCY0  = vm.envAddress("TOKEN0_ADDRESS");
        address POOL_CURRENCY1  = vm.envAddress("TOKEN1_ADDRESS");
        // fee is uint24; tickSpacing is int24 (use positive value)
        uint24  POOL_FEE        = 8388608; // DYNAMIC_FEE_FLAG (0x800000)
        int24   POOL_TICK_SP    = int24(int256(vm.envInt("POOL_TICK_SPACING")));
        address POOL_HOOKS      = vm.envAddress("HOOK_ADDR");

        // --- Sanity checks ---
        console2.log("=== Deployment Configuration ===");
        console2.log("BASE_TOKEN:", BASE_TOKEN);
        console2.log("YTOKEN:", YTOKEN);
        console2.log("VAULT_ADDR:", VAULT_ADDR);
        console2.log("V4_ROUTER:", V4_ROUTER);
        console2.log("POOL_HOOKS:", POOL_HOOKS);
        console2.log("");

        // Verify vault asset matches base token
        address vaultAsset = IERC4626Like(VAULT_ADDR).asset();
        require(vaultAsset == BASE_TOKEN, "Vault.asset() != BASE_TOKEN");
        console2.log("Vault asset matches BASE_TOKEN");

        // Currency ordering check (optional but helpful)
        require(
            (POOL_CURRENCY0 == BASE_TOKEN && POOL_CURRENCY1 == YTOKEN) ||
            (POOL_CURRENCY0 == YTOKEN     && POOL_CURRENCY1 == BASE_TOKEN),
            "PoolKey currencies must be BASE/YTOKEN"
        );
        console2.log("Pool currencies validated");

        // Build PoolKey using proper v4-core types
        PoolKey memory key = PoolKey({
            currency0:   Currency.wrap(POOL_CURRENCY0),
            currency1:   Currency.wrap(POOL_CURRENCY1),
            fee:         POOL_FEE,
            tickSpacing: POOL_TICK_SP,
            hooks:       IHooks(POOL_HOOKS)
        });

        console2.log("");
        console2.log("=== PoolKey Configuration ===");
        console2.log("currency0:", Currency.unwrap(key.currency0));
        console2.log("currency1:", Currency.unwrap(key.currency1));
        console2.log("fee (uint24):", uint256(key.fee));
        console2.log("tickSpacing (int24):", int256(key.tickSpacing));
        console2.log("hooks:", address(key.hooks));

        // --- Broadcast deployment ---
        vm.startBroadcast();
        
        ArbExecutor exec = new ArbExecutor(
            BASE_TOKEN,
            YTOKEN,
            VAULT_ADDR,
            V4_ROUTER,
            POOL_FEE,
            POOL_TICK_SP,
            IHooks(POOL_HOOKS)
        );
        
        vm.stopBroadcast();

        console2.log("");
        console2.log("=== Deployment Success ===");
        console2.log("ArbExecutor deployed at:", address(exec));
        console2.log("");
        console2.log("=== Contract Details ===");
        console2.log("Owner:", exec.owner());
        console2.log("Paused:", exec.paused());
        console2.log("BASE token:", address(exec.BASE()));
        console2.log("Y_TOKEN:", address(exec.Y_TOKEN()));
        console2.log("VAULT:", address(exec.VAULT()));
        console2.log("Router:", address(exec.router()));
        
        console2.log("");
        console2.log("=== Next Steps ===");
        console2.log("1. Fund the ArbExecutor with BASE tokens");
        console2.log("2. Call arbBuyThenRedeem() when LP < NAV");
        console2.log("3. Call arbMintThenSell() when LP > NAV");
        console2.log("4. Use sweep() to rescue any stuck tokens");
    }
}