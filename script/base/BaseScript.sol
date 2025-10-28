// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {IPermit2} from "permit2/src/interfaces/IPermit2.sol";

import {IUniswapV4Router04} from "hookmate/interfaces/router/IUniswapV4Router04.sol";
import {AddressConstants} from "hookmate/constants/AddressConstants.sol";

/// @notice Shared configuration between scripts
contract BaseScript is Script {
    IPermit2 immutable permit2 = IPermit2(0x000000000022D473030F116dDEE9F6B43aC78BA3);
    IPoolManager immutable poolManager;
    IPositionManager immutable positionManager;
    IUniswapV4Router04 immutable swapRouter;
    address immutable deployerAddress;

    /////////////////////////////////////
    // --- Configure These ---
    /////////////////////////////////////

    // USDC on Sepolia Arbitrum Fork
    IERC20 internal constant token0 = IERC20(0xEa812481b0bd91417AE75687eEEA13FEE1B23Cf8);
    IERC20 internal constant token1 = IERC20(0x41de4987ba19D073383c99EB3068B3e29A5C710e);
    
    // USDC on Sepolia Arbitrum
    //IERC20 internal constant token0 = IERC20(0xb32Da9C3d9d0bD24b647af261818739AE303648d);
    //IERC20 internal constant token1 = IERC20(0x69eCF8893845A267102f3b489A515dA697F7049e);
    
    // WBTC on Sepolia Arbitrum
    //IERC20 internal constant token0 = IERC20(0x26a0379254f298B5d7aB19828F48B5651FA10188);
    //IERC20 internal constant token1 = IERC20(0x6FC20bE23a51Db17e3ecad4cd48F7b91833fff88);
    
    //IHooks constant hookContract = IHooks(address(0));
    IHooks constant hookContract = IHooks(0xf7D8f9B115a5568a6F55f43BB6eFd81717F0A080);

    // load from .env (Foundry auto-loads .env in repo root)
    // HOOK_ADDR=0x... in your .env
    //IHooks constant hookContract = IHooks(vm.envAddress("HOOK_ADDR"));

    /////////////////////////////////////

    Currency immutable currency0;
    Currency immutable currency1;

    

    constructor() {
        poolManager = IPoolManager(AddressConstants.getPoolManagerAddress(block.chainid));
        positionManager = IPositionManager(payable(AddressConstants.getPositionManagerAddress(block.chainid)));
        swapRouter = IUniswapV4Router04(payable(AddressConstants.getV4SwapRouterAddress(block.chainid)));

        deployerAddress = getDeployer();

        (currency0, currency1) = getCurrencies();
    

        vm.label(address(token0), "Token0");
        vm.label(address(token1), "Token1");


        vm.label(address(deployerAddress), "Deployer");
        vm.label(address(poolManager), "PoolManager");
        vm.label(address(positionManager), "PositionManager");
        vm.label(address(swapRouter), "SwapRouter");
        vm.label(address(hookContract), "HookContract");
    }

    function getCurrencies() public pure returns (Currency, Currency) {
        require(address(token0) != address(token1));

        if (token0 < token1) {
            return (Currency.wrap(address(token0)), Currency.wrap(address(token1)));
        } else {
            return (Currency.wrap(address(token1)), Currency.wrap(address(token0)));
        }
    }




    function getDeployer() public returns (address) {
        address[] memory wallets = vm.getWallets();

        require(wallets.length > 0, "No wallets found");

        return wallets[0];
    }
}
