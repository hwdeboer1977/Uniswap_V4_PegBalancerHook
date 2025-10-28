// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";


// Sepolia Arbitrum
// forge test test/ArbExecutor.t.sol -vvvv --rpc-url arbitrum_sepolia 

// set -a; source .env.anvil; set +a
// Note: our scripts worked because they all ran against your Anvil node and in the same live chain state
// forge test spins up an isolated in-memory VM (no contracts deployed).
// So run against same Anvil node
// forge test test/ArbExecutor.t.sol -vvvv --fork-url http://127.0.0.1:8545

// Uniswap V4 imports
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {LPFeeLibrary} from "v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import { PoolKey as CorePoolKey } from "v4-core/src/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "v4-core/src/types/PoolId.sol";

// Periphery
import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {BaseScript} from "../script/base/BaseScript.sol";

import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {IUniswapV4Router04} from "hookmate/interfaces/router/IUniswapV4Router04.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ArbExecutor} from "../src/ArbExecutor.sol";





contract ArbExecutorTest is Test {
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    /////////////////////////////////////
    // --- Deployed Contract Addresses ---
    /////////////////////////////////////
    
    // Core V4 contracts (state variables)
    IPoolManager public poolManager;
    IPositionManager public positionManager;
    PoolSwapTest public swapRouter;      // declare as state variable
    IUniswapV4Router04 public router;
    ArbExecutor public executor;
    IERC20Metadata public base;

    // My vault 
    IERC4626 public vault;


    // Your tokens
    IERC20 public token0; // USDC
    IERC20 public token1; // WBTC
    Currency public currency0;
    Currency public currency1;
    
    // Your hook
    IHooks public hookContract;
    
    // Pool configuration
    PoolKey public poolKey;
    
    /////////////////////////////////////
    // --- Test Accounts ---
    /////////////////////////////////////
    
    address public deployer;

    /////////////////////////////////////
    // --- Setup ---
    /////////////////////////////////////
    
    function setUp() public {
        // Fork Anvil (should already be running with deployed contracts)
        // If running fresh fork:
        // vm.createSelectFork("http://127.0.0.1:8545");
        
        // --- Load deployed contract addresses ---
        poolManager = IPoolManager(vm.envAddress("ARBITRUM_SEPOLIA_PM"));
        positionManager = IPositionManager(vm.envAddress("ARBITRUM_SEPOLIA_POSM"));
        //swapRouter = PoolSwapTest(vm.envAddress("ARBITRUM_SEPOLIA_ROUTER"));
        swapRouter = new PoolSwapTest(poolManager); // instantiate the state variable (not a local)
        // instantiate once (e.g., in setUp / run constructor)
        router = IUniswapV4Router04(payable(vm.envAddress("ARBITRUM_SEPOLIA_ROUTER")));



            
        address t0 = vm.envAddress("TOKEN0_ADDRESS");
        address t1 = vm.envAddress("TOKEN1_ADDRESS");
        require(t0 != address(0) && t1 != address(0), "missing token addrs");

        token0 = IERC20(t0);
        token1 = IERC20(t1);

        require(t0.code.length > 0 && t1.code.length > 0, "token not a contract");
        
            
        hookContract = IHooks(vm.envAddress("HOOK_ADDR"));
        bytes memory hookData = new bytes(0);

        // Convert to Currency type
        currency0 = Currency.wrap(address(token0));
        currency1 = Currency.wrap(address(token1));

        // Dynamic fee
        uint24 lpFee = LPFeeLibrary.DYNAMIC_FEE_FLAG; // 0x800000
        
        // --- Setup PoolKey ---
        poolKey = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: lpFee, // e.g., 3000 or DYNAMIC_FEE_FLAG
            tickSpacing: int24(int256(vm.envUint("TICK_SPACING"))), // e.g., 60
            hooks: hookContract
        });

        vault = IERC4626(vm.envAddress("VAULT_ADDRESS"));
        require(address(vault).code.length > 0, "vault not deployed");
        address asset = vault.asset();
        bool assetIsC1 = (asset == Currency.unwrap(poolKey.currency1));
        bool assetIsC0 = (asset == Currency.unwrap(poolKey.currency0));
        require(assetIsC0 || assetIsC1, "vault.asset not part of pool");
            
        // --- Setup test accounts ---
        deployer = vm.envAddress("WALLET_ADDRESS");

        // attach to deployed executor
        address execAddr = vm.envAddress("ARB_EXECUTOR"); // 0x5b73...
        executor = ArbExecutor(execAddr);

        // base = the ERC-4626 asset (matches what ArbExecutor expects as BASE)
        address baseAddr = vault.asset();
        base = IERC20Metadata(baseAddr);

        // (optional sanity)
        //console2.log("Executor owner:", executor.owner());
        console2.log("Executor address:", address(executor));
        console2.log("Base (vault asset):", baseAddr);

        // seed executor with BASE so it can trade
        uint8 decBase = base.decimals();
        uint256 seed = 100 * (10 ** decBase);
        vm.startPrank(deployer);

        IERC20(baseAddr).approve(address(vault), type(uint256).max);
        IERC20(baseAddr).transfer(address(executor), seed);
        // Mints y-shares straight to the executor
        uint256 sharesMinted = vault.deposit(seed, address(executor));
        vm.stopPrank();

        console2.log("Executor BASE balance:", base.balanceOf(address(executor)));
        console2.log("executor y balance:", IERC20(address(vault)).balanceOf(address(executor)));

        //requi --- Initial balances check ---
        console2.log("=== Setup Complete ===");
        console2.log("Pool Manager:", address(poolManager));
        console2.log("Position Manager:", address(positionManager));
        console2.log("Swap Router:", address(swapRouter));
        console2.log("Token0 (USDC):", address(token0));
        console2.log("Token1 (WBTC):", address(token1));
        console2.log("Hook:", address(hookContract));
        console2.log("");
        console2.log("Token0 balance:", token0.balanceOf(deployer));
        console2.log("Token1 balance:", token1.balanceOf(deployer));
    }
    
    /////////////////////////////////////
    // --- Helper Functions ---
    /////////////////////////////////////
    

    /// @notice Log pool state
    function _logPoolState() internal view {
        // (uint160 sqrtPriceX96, int24 tick,,) = poolManager.getSlot0(poolKey.toId());
        // console2.log("Current sqrtPriceX96:", sqrtPriceX96);
        // console2.log("Current tick:", uint256(int256(tick)));
    }
    
    /////////////////////////////////////
    // --- Basic Tests ---
    /////////////////////////////////////
    
    function test_Setup() public view {
        // Verify contracts are deployed
        assertTrue(address(poolManager) != address(0), "PoolManager not set");
        assertTrue(address(token0) != address(0), "Token0 not set");
        assertTrue(address(token1) != address(0), "Token1 not set");
        
        // Verify pool exists
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolKey.toId());
        assertTrue(sqrtPriceX96 > 0, "Pool not initialized");
        
        console2.log("All contracts deployed and pool initialized");
    }
    
    function test_CheckBalances() public view {
        uint256 balance0 = token0.balanceOf(deployer);
        uint256 balance1 = token1.balanceOf(deployer);
        
        console2.log("Deployer Token0 balance:", balance0 / 1e6, "USDC");
        console2.log("Deployer Token1 balance:", balance1 / 1e18, "WBTC");
        
        assertTrue(balance0 > 0, "No Token0 balance");
        assertTrue(balance1 > 0, "No Token1 balance");
    }
    
    function test_PoolState() public view {
        _logPoolState();
        
        (uint160 sqrtPriceX96, int24 tick,,) = poolManager.getSlot0(poolKey.toId());
        
        assertTrue(sqrtPriceX96 > 0, "Invalid price");
        assertTrue(tick != 0 || sqrtPriceX96 == 79228162514264337593543950336, "Invalid tick");
        
        console2.log("Pool state is valid");
    }
    
    function test_SimpleSwap() public {
      
        uint256 swapAmount = 1e6; // 1 USDC
       
        
        console2.log("=== Before Swap ===");
        console2.log("Owner Token0:", token0.balanceOf(deployer) / 1e6);
        console2.log("Owner Token1:", token1.balanceOf(deployer) / 1e6);
        _logPoolState();
    
    
        bytes memory hookData = new bytes(0);

        // choose direction & price bound (NOT slippage)
        bool zeroForOne = true;                  // token0 -> token1
        uint256 amountIn = 10e6;                 // 10 USDC if token0 has 6 decimals
        uint160 sqrtPriceLimitX96 = zeroForOne
            ? TickMath.getSqrtPriceAtTick(TickMath.MIN_TICK + 1)
            : TickMath.getSqrtPriceAtTick(TickMath.MAX_TICK - 1);

        // Perform swap: Token0 -> Token1
        vm.startPrank(deployer);

        // approve input token 
        token0.approve(address(swapRouter), type(uint256).max);
        token1.approve(address(swapRouter), type(uint256).max);

        //METHOD 1: PoolSwapTest
        // pack params + settings
        SwapParams memory params = SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: int256(amountIn),     // positive => exact-in
            sqrtPriceLimitX96: sqrtPriceLimitX96
        });

        PoolSwapTest.TestSettings memory settings = PoolSwapTest.TestSettings({
            takeClaims: false,
            settleUsingBurn: false
        });

        // do the swap
        swapRouter.swap(poolKey, params, settings, "");
        
        console2.log("=== After Swap ===");
        console2.log("Owner Token0:", token0.balanceOf(deployer) / 1e6);
        console2.log("Owner Token1:", token1.balanceOf(deployer) / 1e18);
        _logPoolState();
        
        // Verify swap worked
        assertTrue(token0.balanceOf(deployer) < swapAmount * 2, "Token0 not spent");
        assertTrue(token1.balanceOf(deployer) > 0, "Token1 not received");
        
        console2.log("Swap successful");
    }

    function test_SimpleSwap2() public {
        bool zeroForOne = true;
        uint256 amountIn = 100e6;

        address owner   = vm.envAddress("WALLET_ADDRESS");
        address tokenIn = Currency.unwrap(zeroForOne ? poolKey.currency0 : poolKey.currency1);

        // approve router as spender of the *input* token from the *owner*
        vm.startPrank(owner);
        IERC20(tokenIn).approve(address(router), type(uint256).max);
        vm.stopPrank();

        // call the hookmate router
        vm.prank(owner);
        BalanceDelta delta = router.swapExactTokensForTokens(
            amountIn,
            0,                 // amountOutMin: set a real value for slippage control
            zeroForOne,
            poolKey,
            "",
            owner,
            block.timestamp + 60
        );

        uint256 amountOut = zeroForOne
            ? uint256(int256(-delta.amount1()))
            : uint256(int256(-delta.amount0()));

        console2.log("amountOut:", amountOut);
    }
    
    ///////////////////////////////////
    //--- Arbitrage Tests (Add Your Logic) ---//
    ///////////////////////////////////

    function test_SwapThenDetectArb() public {
        // 1) Read pre-swap price
        (uint160 preSqrt,,,) = poolManager.getSlot0(poolKey.toId());
        console2.log(preSqrt);
        uint256 preP = _price1per0_1e18(preSqrt, 6, 6);
        console2.log("pre:", preP);

        // 2) Do a swap that moves price
        bool zeroForOne = true;
        address owner = vm.envAddress("WALLET_ADDRESS");
        address tokenIn = Currency.unwrap(zeroForOne ? poolKey.currency0 : poolKey.currency1);
        vm.startPrank(owner);
        IERC20(tokenIn).approve(address(router), type(uint256).max);
        router.swapExactTokensForTokens(
            100e6,  // amountIn
            0,      // min out (dev only)
            zeroForOne,
            poolKey,
            "",
            owner,
            block.timestamp + 60
        );
        vm.stopPrank();

        // 3) Read post-swap price (same test -> persists)
        (uint160 postSqrt,,,) = poolManager.getSlot0(poolKey.toId());
        uint256 postP = _price1per0_1e18(postSqrt, 6, 18);
        console2.log("post:", postP);

        assertTrue(postP != preP, "price didn't move");
    }


    function test_executor() public {

        // Test
        address owner = vm.envAddress("WALLET_ADDRESS");
        vm.startPrank(owner);
        uint256 deadline =  block.timestamp + 3000;
    

        bytes32 EXPECTED_PID = 0x3ec5f6e4f673e4d4afcd6b73428f4b06594ee62bc9b9a3dbba4f9fc1d2a06af4;
        // Build the v4-core PoolKey from the executor’s public tuple getter
        (Currency c0, Currency c1, uint24 fee, int24 ts, IHooks hooksAddr) = executor.poolKey();

        CorePoolKey memory coreKey = CorePoolKey({
            currency0:  c0,
            currency1:  c1,
            fee:        fee,
            tickSpacing: ts,
            hooks:      hooksAddr
        });

        // Derive PoolId
        PoolId pid = PoolIdLibrary.toId(coreKey);

        console2.logAddress(Currency.unwrap(c0));
        console2.logAddress(Currency.unwrap(c1));
        console2.logUint(uint256(fee));
        console2.logInt(int256(ts));
        console2.logAddress(address(hooksAddr));
        console2.logBytes32(PoolId.unwrap(pid));
        // ---- Read slot0 WITHOUT using IPoolManager.Slot0 ----
        // getSlot0 returns (uint160 sqrtPriceX96, int24 tick, ..., ...)
        // so just destructure primitives:
        (uint160 sqrtPriceX96, int24 tick, , ) = StateLibrary.getSlot0(poolManager, pid);
        console2.log("slot0.sqrtPriceX96", sqrtPriceX96);
        console2.log("slot0.tick",        tick);
        require(sqrtPriceX96 != 0, "pool not initialized (sqrtPriceX96=0)");
    
        executor.arbMintThenSell(10e7, 10e7, 0, deadline);


        // function arbMintThenSell(
        // uint256 maxBaseToMint,
        // uint256 minYShares,
        // uint256 minQuoteOut,
        // uint256 deadline

    }


    function test_ArbOpportunity() public {
        // Grab decimals dynamically
        address a0 = Currency.unwrap(poolKey.currency0);
        address a1 = Currency.unwrap(poolKey.currency1);
        uint8 dec0 = _decimals(a0);
        uint8 dec1 = _decimals(a1);

        _logPortfolio(deployer, "before");

        // 1) Spot price (token1 per token0, 1e18-scaled)
        (uint160 sqrtP,,,) = poolManager.getSlot0(poolKey.toId());
        require(sqrtP != 0, "pool not initialized");
        uint256 priceLPe18 = _price1per0_1e18(sqrtP, dec0, dec1); // LP: token1 per token0 (1e18)
        uint256 invPriceLPe18 = (1e36) / priceLPe18; // LP: token0 per token1 (1e18)
        console2.log("LP price (token1/token0, 1e18):", priceLPe18);
        console2.log("LP price (token0/token1, 1e18):", invPriceLPe18);

        // 2) Reference & threshold
        //uint256 priceNAVe18 = vm.envOr("PRICE_NAV_e18", uint256(105e16)); // 0.105 * 1e18
        uint256 priceNAVe18 = vm.envOr("PRICE_NAV_e18", uint256(95e16)); // 0.95 * 1e18
        uint256 threshBps   = vm.envOr("THRESHOLD_BPS", uint256(50));    // 0.50%
        uint256 diff   = priceLPe18 > priceNAVe18 ? priceLPe18 - priceNAVe18 : priceNAVe18 - priceLPe18;
        uint256 devBps = (diff * 10_000) / priceNAVe18;
        console2.log("LP:", priceLPe18, "NAV:", priceNAVe18);
        console2.log("dev(bps):", devBps);
        if (devBps < threshBps) return;

        // 3) Direction
        // P_lp = token1/token0 (1e18-scaled), P_nav likewise.
        // Buy t1 on LP when P_lp > P_nav (since C_lp < C_nav), else sell t1 on LP.
        bool zeroForOne = (priceLPe18 > priceNAVe18); // true => token0->token1 on LP; // buy token1 if LP < NAV

        // 4) Approve input token (scale amountIn by dec0/dec1)
        uint256 amountIn = 10 * (10 ** uint256(zeroForOne ? dec0 : dec1)); // "10 units" of input token
        address tokenInAddr = zeroForOne ? a0 : a1;
        IERC20 tokenIn = IERC20(tokenInAddr);
        vm.startPrank(deployer);
        tokenIn.approve(address(swapRouter), type(uint256).max);
        vm.stopPrank();

        // 5) Balances user before
        uint256 b0Before = IERC20(a0).balanceOf(deployer);
        uint256 b1Before = IERC20(a1).balanceOf(deployer);

        // 6) Swap
        uint160 priceLimit = _noLimit(zeroForOne);
        SwapParams memory params = SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: int256(amountIn),
            sqrtPriceLimitX96: priceLimit
        });
        PoolSwapTest.TestSettings memory settings = PoolSwapTest.TestSettings({
            takeClaims: false,
            settleUsingBurn: false
        });
        vm.startPrank(deployer);
        swapRouter.swap(poolKey, params, settings, "");
        vm.stopPrank();

        // 7) Balances user after swap
        uint256 b0After = IERC20(a0).balanceOf(deployer);
        uint256 b1After = IERC20(a1).balanceOf(deployer);

        int256 d0 = int256(b0After) - int256(b0Before);  // token0 delta (dec0)
        int256 d1 = int256(b1After) - int256(b1Before);  // token1 delta (dec1)
        console2.log("token0:", d0);
        console2.log("token1:", d1);

        // 8) PnL in token0 units, 1e18-scaled
        // token0 per token1 (1e18) = 1e36 / priceNAVe18  (since NAV is token1/token0 in 1e18)
        uint256 token0PerToken1_1e18 = (1e36) / priceNAVe18;

        // d0_value = d0 * 1e18 / 10^dec0
        int256 d0_value_1e18 = (d0 * int256(1e18)) / int256(10 ** uint256(dec0));
        // d1_value = d1 * (token0PerToken1_1e18) / 10^dec1
        int256 d1_value_1e18 = (d1 * int256(token0PerToken1_1e18)) / int256(10 ** uint256(dec1));

        // cycle PnL in token0 units (1e18-scaled)
        int256 pnlCycle_1e18 = _pnlCycle(zeroForOne, d0, d1, dec0, dec1, priceNAVe18);
        console2.log("Cycle PnL (token0, 1e18):", pnlCycle_1e18);
        console2.log("Cycle PnL (token0, human):", pnlCycle_1e18 / int256(1e18));
        assertTrue(pnlCycle_1e18 > 0, "Two-leg arb not profitable at this size");

        // If LP < NAV we bought token1 on LP → mint shares with token1
        if (zeroForOne) {
            uint256 t1Bal = IERC20(a1).balanceOf(deployer);
            uint256 toDeposit = _min(t1Bal, 10 * (10 ** uint256(dec1))); // deposit up to 10 token1 units
            if (toDeposit > 0) {
                address assetAddr = vault.asset();
                uint8 decAsset = _decimals(assetAddr);

                vm.startPrank(deployer);
                IERC20(assetAddr).approve(address(vault), type(uint256).max);
                console2.log("allowance->vault:", IERC20(assetAddr).allowance(deployer, address(vault)));
                uint256 shares = vault.deposit(toDeposit, deployer);
                vm.stopPrank();
                console2.log("Vault minted shares:", shares);
            }
        } else {
            // LP > NAV we sold token1 on LP → redeem some existing shares for token1
            uint256 shareBal = IERC20(address(vault)).balanceOf(deployer);
            uint256 toRedeem = shareBal / 10; // redeem 10% of shares (example sizing)
            if (toRedeem > 0) {
                vm.prank(deployer);
                uint256 assetsOut = vault.redeem(toRedeem, deployer, deployer);
                console2.log("Vault redeemed assets (token1):", assetsOut);
            }
        }
        // Balances user after swap
        uint256 b0AfterDef = IERC20(a0).balanceOf(deployer);
        uint256 b1AfterDef = IERC20(a1).balanceOf(deployer);
        console2.log("b0AfterDef:", b0AfterDef);
        console2.log("b1AfterDef:", b1AfterDef);

         _logPortfolio(deployer, "after");

    }

    // --- helpers: price math (token1 per token0, 1e18-scaled) ---
    function _decimals(address token) internal view returns (uint8 d) {
        // Many mocks implement IERC20Metadata; default to 18 if not
        try IERC20Metadata(token).decimals() returns (uint8 got) { d = got; }
        catch { d = 18; }
    }

    
    // === NEW: one-shot portfolio logger (LP price, NAV, balances, totals) ===
    function _logPortfolio(address owner, string memory tag) internal view {
        address a0 = Currency.unwrap(poolKey.currency0);
        address a1 = Currency.unwrap(poolKey.currency1);
        uint8 dec0 = _decimals(a0);
        uint8 dec1 = _decimals(a1);

        // LP price (t1 per t0, 1e18)
        (uint160 sqrtP,,,) = poolManager.getSlot0(poolKey.toId());
        uint256 t1PerT0_1e18 = _price1per0_1e18(sqrtP, dec0, dec1);
        uint256 t0PerT1_1e18 = (t1PerT0_1e18 == 0) ? 0 : (1e36 / t1PerT0_1e18);

        // Vault NAV (ERC4626)
        address assetAddr = vault.asset();
        uint8 decAsset = _decimals(assetAddr);
        uint8 decShare = _decimals(address(vault));
        uint256 assets = vault.totalAssets();
        uint256 shares = vault.totalSupply();
        uint256 nav_assetPerShare_1e18 = (shares == 0)
            ? 0
            : FullMath.mulDiv(assets, 10**(18 + decShare), shares * 10**decAsset);
        uint256 nav_sharePerAsset_1e18 = (assets == 0)
            ? 0
            : FullMath.mulDiv(shares, 10**(18 + decAsset), assets * 10**decShare);

        // Balances
        uint256 b0 = IERC20(a0).balanceOf(owner);
        uint256 b1 = IERC20(a1).balanceOf(owner);
        uint256 s  = IERC20(address(vault)).balanceOf(owner);
        uint256 assetsFromShares = vault.convertToAssets(s);

        // Totals valued in token0 / token1 (1e18)
        int256 totT0_1e18 =
            int256(FullMath.mulDiv(b0, 1e18, 10**dec0)) +
            int256(FullMath.mulDiv(b1, t0PerT1_1e18, 10**dec1)) +
            int256(FullMath.mulDiv(assetsFromShares, (assetAddr == a1 ? t0PerT1_1e18 : 1e18), 10**decAsset));

        int256 totT1_1e18 =
            int256(FullMath.mulDiv(b1, 1e18, 10**dec1)) +
            int256(FullMath.mulDiv(b0, t1PerT0_1e18, 10**dec0)) +
            int256(FullMath.mulDiv(assetsFromShares, (assetAddr == a0 ? t1PerT0_1e18 : 1e18), 10**decAsset));

        // Logs
        console2.log(string.concat("== Portfolio (", tag, ") =="));
        console2.log("LP t1/t0 (1e18):", t1PerT0_1e18);
        console2.log("LP t0/t1 (1e18):", t0PerT1_1e18);
        console2.log("NAV asset/share (t0 per t1, 1e18):", nav_assetPerShare_1e18);
        console2.log("NAV share/asset (t1 per t0, 1e18):", nav_sharePerAsset_1e18);
        console2.log("token0:", b0);
        console2.log("shares:", s);
        console2.log("assets:", assetsFromShares);
        console2.log("Total (token0, 1e18):", totT0_1e18); 
        console2.log("human:", totT0_1e18 / int256(1e18));
        console2.log("Total (token1, 1e18):", totT1_1e18); 
        console2.log("human:", totT1_1e18 / int256(1e18));
    }


    function _pnlCycle(
    bool zeroForOne,
    int256 d0, int256 d1,
    uint8 dec0, uint8 dec1,
    uint256 priceNAVe18
    ) internal pure returns (int256 pnl_1e18) {
        if (zeroForOne) {
            // LP < NAV: bought token1 with token0 on LP
            // Second leg (redeem at NAV): token0_from_vault = d1 * (token0 per token1)
            // token0 per token1 (1e18) = 1e36 / priceNAVe18
            uint256 token0PerToken1_1e18 = (1e36) / priceNAVe18;

            // Scale d0,d1 to 1e18
            int256 d0_1e18 = (d0 * int256(1e18)) / int256(10 ** uint256(dec0));
            int256 d1_0_1e18 = (d1 * int256(token0PerToken1_1e18)) / int256(10 ** uint256(dec1));

            // Net cycle PnL in token0 units (1e18-scale)
            pnl_1e18 = d0_1e18 + d1_0_1e18;
        } else {
            // LP > NAV: sold token1 for token0 on LP
            // Second leg (mint at NAV): token1_from_vault = d0 * (token1 per token0)
            // token1 per token0 (1e18) = priceNAVe18
            int256 token1_from_vault = (d0 * int256(priceNAVe18)) / int256(10 ** uint256(dec0)); // 1e18 scale

            // Scale d1 to 1e18
            int256 d1_1e18 = (d1 * int256(1e18)) / int256(10 ** uint256(dec1));

            // Net cycle PnL in token1 units (1e18-scale). Convert to token0 units for comparison:
            // token0 per token1 (1e18) = 1e36 / priceNAVe18
            int256 pnl_token1_1e18 = d1_1e18 + token1_from_vault;
            pnl_1e18 = (pnl_token1_1e18 * int256((1e36) / priceNAVe18)) / int256(1e18);
        }
    }

    /// token1 per token0, scaled to 1e18
    function _price1per0_1e18(uint160 sqrtPriceX96, uint8 dec0, uint8 dec1)
        internal pure returns (uint256)
    {
        // ratioX96 = price * 2^96  (no precision loss for price < 1)
        uint256 ratioX96 = FullMath.mulDiv(uint256(sqrtPriceX96), uint256(sqrtPriceX96), 1 << 96);
        // (ratioX96 * 10^dec1 * 1e18) / (2^96 * 10^dec0)
        return FullMath.mulDiv(ratioX96, (10 ** dec1) * 1e18, (1 << 96) * (10 ** dec0));
    }

    function _noLimit(bool zeroForOne) internal pure returns (uint160) {
        return zeroForOne
            ? TickMath.getSqrtPriceAtTick(TickMath.MIN_TICK + 1)
            : TickMath.getSqrtPriceAtTick(TickMath.MAX_TICK - 1);
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }



}