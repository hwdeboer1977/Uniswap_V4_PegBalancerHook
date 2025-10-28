// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// On testnet
// set -a; source .env; set +a
// forge script script/01b_DepositVault.s.sol:DepositVault --rpc-url arbitrum_sepolia --broadcast -vv


// On Anvil
// 1. set -a; source .env.anvil; set +a
// 2. forge script script/01b_DepositVault.s.sol:DepositVault --rpc-url http://127.0.0.1:8545 --broadcast -vvvv --via-ir

interface IERC4626 {
    function asset() external view returns (address);
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
}

contract DepositVault is Script {
    address internal VAULT;
    address internal ASSET;      // USDC here
    uint256 internal RAW_AMOUNT; // e.g. 1e9 = 1,000 USDC if 6 decimals
    address internal RECEIVER;
    uint256 internal PK;

    function setUp() public {
        // Use PRIVATE_KEY consistently (not WALLET_SECRET)
        PK         = vm.envUint("PRIVATE_KEY");
        VAULT      = vm.envAddress("VAULT_ADDRESS");
        ASSET      = vm.envAddress("TOKEN_VAULT");     // USDC, WBTC etc address
        RAW_AMOUNT = vm.envUint("RAW_AMOUNT");   // raw units (USDC has 6 decimals)

        // Optional custom receiver; otherwise default to signer EOA
        bool receiverSet = vm.envOr("RECEIVER_SET", false);
        RECEIVER = receiverSet ? vm.envAddress("RECEIVER") : vm.addr(PK);
        console2.log("Receiver? ", RECEIVER);
        
        require(RECEIVER != address(0), "receiver=0");
        require(VAULT != address(0) && ASSET != address(0), "VAULT/ASSET not set");
        require(RAW_AMOUNT > 0, "RAW_AMOUNT=0");
    }

    function run() external {
        address eoa = vm.addr(PK);
        IERC4626 vault = IERC4626(VAULT);
        IERC20 asset = IERC20(ASSET);

        // Sanity: vault.asset() must equal ASSET (USDC)
        require(vault.asset() == ASSET, "vault.asset mismatch");

        // Check balance & approve
        require(asset.balanceOf(eoa) >= RAW_AMOUNT, "insufficient funds");

        vm.startBroadcast(PK);

        if (asset.allowance(eoa, VAULT) < RAW_AMOUNT) {
            asset.approve(VAULT, RAW_AMOUNT);
        }

        uint256 shares = vault.deposit(RAW_AMOUNT, RECEIVER);

        // console2.log("Deployer:", deployerAddress);
        // console2.log("Token1 balance:", IERC20(Currency.unwrap(currency1)).balanceOf(deployerAddress));

        vm.stopBroadcast();

        console2.log("Deposit done");
        console2.log("Vault:   ", VAULT);
        console2.log("Asset:   ", ASSET);
        console2.log("From:    ", eoa);
        console2.log("To (receiver):", RECEIVER);
        console2.log("Assets in (raw):", RAW_AMOUNT);
        console2.log("Shares out:     ", shares);
    }
}
