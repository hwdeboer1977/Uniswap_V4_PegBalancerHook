// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {BaseScript} from "./base/BaseScript.sol";

import {PegHook} from "../src/PegHook.sol";

import "forge-std/Script.sol";

// Testnet
// forge script script/02_DeployHook.s.sol  --rpc-url arbitrum_sepolia --private-key 0xYOUR_PRIVATE_KEY --broadcast


// Anvil:
// 1. set -a; source .env.anvil; set +a
// 2. forge script script/02_DeployHook.s.sol --rpc-url http://127.0.0.1:8545 --private-key 0xYOUR_PRIVATE_KEY --broadcast -vvvv --via-ir

// This code follows https://github.com/uniswapfoundation/v4-template

// 1. Update addresses in BaseScript.sol, PegHook.sol
// 2. Update address vault in DeployHook.s.sol (this script)
// 3. Run this deployscript 
// 4. Update hook address in BaseScript._sol
// 5. Run other scripts to add liquidity, swap tokens etc

/// @notice Mines the address and deploys the Peghook.sol Hook contract
contract DeployHookScript is BaseScript {
    function run() public {

        
        address vault = 0x41de4987ba19D073383c99EB3068B3e29A5C710e;
        //address vault = 0xb32Da9C3d9d0bD24b647af261818739AE303648d;
        //address vault = 0x6FC20bE23a51Db17e3ecad4cd48F7b91833fff88;
        //address vault = vm.envOr("TOKEN_VAULT", address(0));
        require(vault != address(0), "Set TOKEN_VAULT in .env");

        // hook contracts must have specific flags encoded in the address
        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG |
            Hooks.BEFORE_SWAP_FLAG
        );

        // Mine a salt that will produce a hook address with the correct flags
        bytes memory constructorArgs = abi.encode(poolManager, vault);
        (address hookAddress, bytes32 salt) =
            HookMiner.find(CREATE2_FACTORY, flags, type(PegHook).creationCode, constructorArgs);

        // Deploy the hook using CREATE2
        vm.startBroadcast();
        PegHook peghook = new PegHook{salt: salt}(poolManager, vault);
        vm.stopBroadcast();

        console.log("Hook address: ", hookAddress);
        require(address(peghook) == hookAddress, "DeployHookScript: Hook Address Mismatch");
    }
}
