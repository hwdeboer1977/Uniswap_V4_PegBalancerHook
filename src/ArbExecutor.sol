// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/console2.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
/*
  Minimal ARB_EXECUTOR for Uniswap v4 eco:
  - Uses TestSwapRouter (same as in swap.s.sol)
  - Atomic 2-leg arbs:
      * LP < NAV  : buy yToken in LP -> redeem yToken in vault -> end with more BASE
      * LP > NAV  : deposit BASE -> mint yToken in vault -> sell yToken in LP -> end with more BASE
  - Owner-only execution. Add your own auth if you want multiple keepers.
*/

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function decimals() external view returns (uint8);
    function allowance(address, address) external returns(uint256);
}

interface IERC4626 {
    function asset() external view returns (address);
    function totalAssets() external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
}

/* --------
   TestSwapRouter Interface (matches swap.s.sol)
   -------- */
interface ITestSwapRouter {
    /// @notice Swap exact input tokens for output tokens
    /// @param amountIn Exact amount of input tokens to swap
    /// @param amountOutMin Minimum amount of output tokens (slippage protection)
    /// @param zeroForOne Direction of swap (true: token0->token1, false: token1->token0)
    /// @param poolKey Pool key containing currency0, currency1, fee, tickSpacing, hooks
    /// @param hookData Additional data to pass to hooks
    /// @param receiver Address to receive output tokens
    /// @param deadline Transaction deadline (unix timestamp)
    /// @return amountOut Amount of output tokens received
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        bool zeroForOne,
        PoolKey calldata poolKey,
        bytes calldata hookData,
        address receiver,
        uint256 deadline
    ) external returns (uint256 amountOut);
}

contract ArbExecutor {
    error NotOwner();
    error Deadline();
    error NoProfit();
    error MinOut();

    IERC20    public immutable BASE;        // WBTC or USDC (vault asset / LP quote)
    IERC20    public immutable Y_TOKEN;     // yBTC (ERC-4626 share token)
    IERC4626  public immutable VAULT;       // yBTC vault
    ITestSwapRouter public router;          // TestSwapRouter (pluggable)

    // v4 PoolKey (as used by your pool)
    PoolKey public poolKey;

    address public owner;
    bool    public paused;

    event ExecutedBuyThenRedeem(uint256 baseSpent, uint256 yBought, uint256 baseOut, int256 pnlBase);
    event ExecutedMintThenSell(uint256 baseIn, uint256 yMinted, uint256 baseOut, int256 pnlBase);
    event OwnerUpdated(address indexed newOwner);
    event Paused(bool on);
    event RouterUpdated(address indexed newRouter);
    event PoolKeyUpdated(PoolKey key);

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }
            
    function _onlyOwner() internal {
        if (msg.sender != owner) revert NotOwner();
    }
           
        
    modifier notPaused() {
        _notPaused();
        _;
    }
            
    function _notPaused() internal view {
        if (paused) revert("paused");
    }

    constructor(
        address _base,
        address _yToken,
        address _vault,
        address _router,
        PoolKey memory _poolKey
    ) {
        owner = msg.sender;
        BASE   = IERC20(_base);
        Y_TOKEN = IERC20(_yToken);
        VAULT  = IERC4626(_vault);
        router = ITestSwapRouter(_router);
        poolKey = _poolKey;

        // Max approvals to vault and router (gas-optimized execution)
        require(BASE.approve(_vault, type(uint256).max), "BASE vault approval failed");
        require(Y_TOKEN.approve(_vault, type(uint256).max), "Y_TOKEN vault approval failed");
        require(BASE.approve(_router, type(uint256).max), "BASE router approval failed");
        require(Y_TOKEN.approve(_router, type(uint256).max), "Y_TOKEN router approval failed");
    }

    /* =========
       Admin
       ========= */
    function setOwner(address n) external onlyOwner { owner = n; emit OwnerUpdated(n); }
    function setPaused(bool on) external onlyOwner { paused = on; emit Paused(on); }
    function setRouter(address r) external onlyOwner { router = ITestSwapRouter(r); emit RouterUpdated(r); }
    function setPoolKey(PoolKey calldata k) external onlyOwner { poolKey = k; emit PoolKeyUpdated(k); }

    /* ===============================
       LP < NAV : buy y -> redeem y
       =============================== */
    /// @param maxQuoteIn  maximum BASE you will spend to buy yToken in LP
    /// @param minYOut     minimum yToken expected from the LP swap (set 0 if you rely on minBaseOut)
    /// @param minBaseOut  minimum BASE you must receive from redeem; protects PnL
    /// @param deadline    unix timestamp
    function arbBuyThenRedeem(
        uint256 maxQuoteIn,
        uint256 minYOut,
        uint256 minBaseOut,
        uint256 deadline
    ) external onlyOwner notPaused returns (int256 pnlBase) {
        if (block.timestamp > deadline) revert Deadline();

        uint256 baseBefore = BASE.balanceOf(address(this));
        console2.log("Balance BASE before:", baseBefore);

        // 1) Swap BASE -> yToken in the LP
        // Determine swap direction based on pool token ordering
        bool zeroForOne = (poolKey.currency0 == Currency.wrap(address(BASE)));
        
        // Sanity check: ensure pool contains both tokens
        require(
            (poolKey.currency0 == Currency.wrap(address(BASE)) && poolKey.currency1 == Currency.wrap(address(Y_TOKEN))) ||
            (poolKey.currency0 == Currency.wrap(address(Y_TOKEN)) && poolKey.currency1 == Currency.wrap(address(BASE))),
            "poolKey mismatch"
        );

        bytes memory hookData = new bytes(0); // Empty hook data

        uint256 yOut = router.swapExactTokensForTokens({
            amountIn: maxQuoteIn,
            amountOutMin: minYOut,
            zeroForOne: zeroForOne,
            poolKey: poolKey,
            hookData: hookData,
            receiver: address(this),
            deadline: deadline
        });

        console2.log("yToken received from swap:", yOut);

        // 2) Redeem yToken at the vault to receive BASE
        uint256 baseOut = VAULT.redeem(yOut, address(this), address(this));
        if (baseOut < minBaseOut) revert MinOut();

        console2.log("BASE received from redeem:", baseOut);

        // 3) Compute PnL in BASE
        uint256 baseAfter = BASE.balanceOf(address(this));
        pnlBase = int256(baseAfter) - int256(baseBefore);
        if (pnlBase <= 0) revert NoProfit();

        console2.log("PnL (BASE):", uint256(pnlBase));

        emit ExecutedBuyThenRedeem(maxQuoteIn, yOut, baseOut, pnlBase);
    }

    /* =================================
       LP > NAV : mint y -> sell y
       ================================= */
    /// @param maxBaseToMint  amount of BASE to deposit into the vault
    /// @param minYShares     minimum yToken shares expected from vault (post fee)
    /// @param minQuoteOut    minimum BASE to receive from selling yToken in LP
    /// @param deadline       unix timestamp
    function arbMintThenSell(
        uint256 maxBaseToMint,
        uint256 minYShares,
        uint256 minQuoteOut,
        uint256 deadline
    ) external onlyOwner notPaused returns (int256 pnlBase) {
        // Check deadline
        if (block.timestamp > deadline) revert Deadline();
        
        uint256 baseBefore = BASE.balanceOf(address(this));
        console2.log("Balance BASE before:", baseBefore);

        // 1) Deposit BASE -> mint yToken
        uint256 yMinted = VAULT.deposit(maxBaseToMint, address(this));
        if (yMinted < minYShares) revert MinOut();
        
        uint256 yieldAfterMint = Y_TOKEN.balanceOf(address(this));
        console2.log("Balance yToken after mint:", yieldAfterMint);

        // Verify router approval (should already be set in constructor)
        uint256 allowanceY = Y_TOKEN.allowance(address(this), address(router));
        console2.log("Allowance (yToken -> router):", allowanceY);

        // 2) Swap yToken -> BASE in the LP
        // Determine swap direction: we're selling yToken for BASE
        bool zeroForOne = (poolKey.currency0 == Currency.wrap(address(Y_TOKEN)));

        // Sanity check: pool ordering must be (BASE, yToken) or (yToken, BASE)
        require(
            (poolKey.currency0 == Currency.wrap(address(BASE)) && poolKey.currency1 == Currency.wrap(address(Y_TOKEN))) ||
            (poolKey.currency0 == Currency.wrap(address(Y_TOKEN)) && poolKey.currency1 == Currency.wrap(address(BASE))),
            "poolKey mismatch"
        );

        bytes memory hookData = new bytes(0); // Empty hook data

        uint256 baseOut = router.swapExactTokensForTokens({
            amountIn: yMinted,
            amountOutMin: minQuoteOut,
            zeroForOne: zeroForOne,
            poolKey: poolKey,
            hookData: hookData,
            receiver: address(this),
            deadline: deadline
        });

        console2.log("BASE received from swap:", baseOut);

        // 3) Compute PnL in BASE
        uint256 baseAfter = BASE.balanceOf(address(this));
        pnlBase = int256(baseAfter) - int256(baseBefore);
        if (pnlBase <= 0) revert NoProfit();

        console2.log("PnL (BASE):", uint256(pnlBase));

        emit ExecutedMintThenSell(maxBaseToMint, yMinted, baseOut, pnlBase);
    }

    /* =========
       Rescue
       ========= */
    function sweep(address token, address to, uint256 amount) external onlyOwner {
        require(IERC20(token).transfer(to, amount), "sweep failed");
    }
}