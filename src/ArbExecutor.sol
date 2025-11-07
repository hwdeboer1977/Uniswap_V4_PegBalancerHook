// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * ArbExecutor (Uniswap v4)
 * - Canonicalizes PoolKey (token0 < token1 by address) at construction & updates.
 * - Three atomic arb strategies:
 *   1) LP < NAV  : buy yToken in LP -> instant redeem in vault (single-step)
 *   2) LP < NAV  : buy yToken in LP -> queue redeem -> complete later (two-step)
 *   3) LP > NAV  : deposit BASE in vault -> sell yToken in LP (single-step)
 * - Owner-only execution + pause switch + simple nonReentrant guard.
 * - Exposes poolId() to match against live pool, and poolKey() in canonical order.
 *
 * Notes
 * - Router conforms to a lightweight test router interface that accepts PoolKey.
 * - No external libraries (OZ) required; simple checks for ERC20 approvals.
 */

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

// ----------------------
// Minimal interfaces
// ----------------------
interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function decimals() external view returns (uint8);
    function allowance(address owner, address spender) external view returns (uint256);
}

// ERC4646 vault by OpenZeppelin
interface IERC4626 {
    function asset() external view returns (address);
    function totalAssets() external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
    function convertToAssets(uint256 shares) external view returns (uint256 assets);
    function convertToShares(uint256 assets) external view returns (uint256 shares);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
}

// Vault interface with two-step withdrawal
interface IAsyncVault is IERC4626 {
    // Your vault's actual interface - no return value, no owner param
    function initiateWithdraw(uint256 shares) external;

    
    // For checking pending withdrawal state
    function pendingShares(address account) external view returns (uint256);
    function pendingUnlockAt(address account) external view returns (uint256);
    function unlockedSharesOf(address account) external view returns (uint256);
}

// Matches our TestSwapRouter used in scripts
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
    // --------
    // Errors
    // --------
    error NotOwner();             // caller is not owner
    error Paused();               // contract paused
    error Deadline();             // past deadline
    error BadConfig();            // zero addresses or invalid params
    error MinOut();               // slippage/amountOut checks failed
    error NoProfit();             // PnL <= 0
    error PoolKeyMismatch();      // provided key doesn't match BASE/Y pair
    error RequestNotFound();      // no pending withdrawal
    error NotRequestOwner();      // reserved for per-user flows (not used here)
    error WithdrawalNotUnlocked();// pending withdrawal not yet unlocked

    // --------
    // Events
    // --------
    event ExecutedBuyThenRedeem(uint256 baseSpent, uint256 yBought, uint256 baseOut, int256 pnlBase);
    event ExecutedMintThenSell(uint256 baseIn, uint256 yMinted, uint256 baseOut, int256 pnlBase);
    event ExecutedBuyAndQueue(uint256 baseSpent, uint256 yBought, uint256 unlockAt);
    event CompletedQueuedRedeem(uint256 requestId, uint256 baseOut, int256 pnlBase);
    event OwnerUpdated(address indexed previousOwner, address indexed newOwner);
    event RouterUpdated(address indexed newRouter);
    event PausedSet(bool on);
    event PoolKeyUpdated(PoolKey key);
    event ApprovalsRefreshed();

    // --------
    // Storage
    // --------
    IERC20   public immutable BASE;      // vault asset (e.g. USDC / WBTC)
    IERC20   public immutable Y_TOKEN;   // vault share token (e.g. yUSDC)
    IAsyncVault public immutable VAULT;  // ERC-4626 vault with async withdraw
    ITestSwapRouter public router;       // v4 TestSwapRouter (or compatible)

    PoolKey private _poolKey;            // always stored in canonical order
    
    address public owner;                // admin address
    bool    public paused;               // global pause

    // simple nonReentrancy
    uint256 private _locked;             // 0 = unlocked, 1 = locked

    // --------
    // Modifiers
    // --------
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier notPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier nonReentrant() {
        require(_locked == 0, "REENTRANCY");
        _locked = 1;
        _;
        _locked = 0;
    }

    // -----------------
    // Canonical helpers
    // -----------------
    function _normalize(address a, address b) internal pure returns (address c0, address c1) {
        (c0, c1) = a < b ? (a, b) : (b, a);
    }

    // Create a PoolKey for Uniswap v4 with the two token addresses sorted (token0 < token1 by address) so the key is canonical/consistent.
    function _buildCanonicalPoolKey(
        address a,
        address b,
        uint24 fee,
        int24 tickSpacing,
        IHooks hooks
    ) internal pure returns (PoolKey memory k) {
        (address c0, address c1) = _normalize(a, b);
        k = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: hooks
        });
    }

    // Check that the given PoolKey actually corresponds to the pair our arb bot expects: BASE and Y_TOKEN—in either order.
    function _poolContainsBaseAndY(PoolKey memory k) internal view returns (bool) {
        address c0 = Currency.unwrap(k.currency0);
        address c1 = Currency.unwrap(k.currency1);
        address base = address(BASE);
        address y = address(Y_TOKEN);
        return (c0 == base && c1 == y) || (c0 == y && c1 == base);
    }

    // -----------
    // Constructor
    // -----------
    constructor(
        address _base,
        address _yToken,
        address _vault,
        address _router,
        uint24  _fee,
        int24   _tickSpacing,
        IHooks  _hooks
    ) {
        // Basic config checks (no zero addresses)
        if (_base == address(0) || _yToken == address(0) || _vault == address(0) || _router == address(0)) revert BadConfig();

        owner  = msg.sender;
        BASE   = IERC20(_base);
        Y_TOKEN= IERC20(_yToken);
        VAULT  = IAsyncVault(_vault);
        router = ITestSwapRouter(_router);

        // Build and store canonical PoolKey
        _poolKey = _buildCanonicalPoolKey(_base, _yToken, _fee, _tickSpacing, _hooks);
        if (!_poolContainsBaseAndY(_poolKey)) revert PoolKeyMismatch();

        // Max approvals (gas-optimized execution)
        _refreshApprovals();
    }

    // -------------------
    // Admin / maintenance
    // -------------------
    function setOwner(address n) external onlyOwner {
        if (n == address(0)) revert BadConfig(); // or a dedicated ZeroAddress() error
        address prev = owner;
        owner = n;
        emit OwnerUpdated(prev, n);
    }

    function setPaused(bool on) external onlyOwner {
        paused = on;
        emit PausedSet(on);
    }

    function setRouter(address r) external onlyOwner {
        // Update router and refresh approvals to the new spender
        if (r == address(0)) revert BadConfig();
        router = ITestSwapRouter(r);
        // re-approve in case router changed
        _approve(BASE, r);
        _approve(Y_TOKEN, r);
        emit RouterUpdated(r);
    }

    /// @notice Set a new PoolKey from token addresses + params; enforced canonical order.
    function setPoolKeyFromTokens(
        address a,
        address b,
        uint24  fee,
        int24   tickSpacing,
        IHooks  hooks
    ) external onlyOwner {
        PoolKey memory k = _buildCanonicalPoolKey(a, b, fee, tickSpacing, hooks);
        if (!_poolContainsBaseAndY(k)) revert PoolKeyMismatch();
        _poolKey = k;
        emit PoolKeyUpdated(k);
    }

    /// @notice Re-approve vault & router spend (MAX).
    function refreshApprovals() external onlyOwner {
        _refreshApprovals();
    }

    function _refreshApprovals() internal {
        // For depositing BASE into vault
        _approve(BASE, address(VAULT));
        
        // For withdrawing: vault needs to pull yToken from us
        _approve(Y_TOKEN, address(VAULT));
        
        // For swapping on router
        _approve(BASE, address(router));
        _approve(Y_TOKEN, address(router));
        
        emit ApprovalsRefreshed();
    }

    function _approve(IERC20 token, address spender) internal {
        // set to max; some tokens require first setting to 0, but we assume standard ERC20 here
        require(token.approve(spender, type(uint256).max), "approve failed");
    }

    // -----------------------
    // Views (introspection)
    // -----------------------
    /// Canonical PoolKey (Currency, Currency, uint24, int24, IHooks) — matches our test types
    function poolKey()
        external
        view
        returns (Currency currency0, Currency currency1, uint24 fee, int24 tickSpacing, IHooks hooks)
    {
        currency0   = _poolKey.currency0;
        currency1   = _poolKey.currency1;
        fee         = _poolKey.fee;
        tickSpacing = _poolKey.tickSpacing;
        hooks       = _poolKey.hooks;
    }

    /// bytes32 PoolId (unwrap the PoolId type)
    function poolId() external view returns (bytes32) {
        PoolId pid = PoolIdLibrary.toId(_poolKey);
        return PoolId.unwrap(pid);
    }

    /// Check if there's a pending withdrawal and when it unlocks
    function getPendingWithdrawal() external view returns (
        uint256 shares,
        uint256 unlockAt,
        bool isReady
    ) {
        shares = VAULT.pendingShares(address(this));
        unlockAt = VAULT.pendingUnlockAt(address(this));
        isReady = (unlockAt > 0 && block.timestamp >= unlockAt);
    }


    // ---------------
    // Arb strategies
    // ---------------

    /**
     * @notice LP > NAV:
     *  - Deposit BASE into vault to mint yToken
     *  - Sell yToken in LP for BASE
     *  - Expect positive PnL in BASE
     */
    function arbMintThenSell(
        uint256 maxBaseToMint,
        uint256 minYShares,
        uint256 minQuoteOut,
        uint256 deadline
    ) external onlyOwner notPaused nonReentrant returns (int256 pnlBase) {
        if (block.timestamp > deadline) revert Deadline();
        if (maxBaseToMint == 0) revert BadConfig();
        if (!_poolContainsBaseAndY(_poolKey)) revert PoolKeyMismatch();

        uint256 baseBefore = BASE.balanceOf(address(this));

        // 1) Mint yToken by depositing BASE into the vault
        uint256 yMinted = VAULT.deposit(maxBaseToMint, address(this));
        if (yMinted < minYShares) revert MinOut();

        // 2) Sell yToken -> BASE in LP
        bool zeroForOne = (_poolKey.currency0 == Currency.wrap(address(Y_TOKEN)));

        // Execute swap and measure BASE balance change
        router.swapExactTokensForTokens({
            amountIn:     yMinted,
            amountOutMin: minQuoteOut,
            zeroForOne:   zeroForOne,       // yToken -> BASE
            poolKey:      _poolKey,
            hookData:     "",
            receiver:     address(this),
            deadline:     deadline
        });

        // 3) PnL in BASE (measured by balance change)
        uint256 baseAfter = BASE.balanceOf(address(this));
        pnlBase = int256(baseAfter) - int256(baseBefore);
        if (pnlBase <= 0) revert NoProfit();
        
        uint256 baseOut = uint256(int256(baseBefore) + pnlBase); // baseAfter effectively

        emit ExecutedMintThenSell(maxBaseToMint, yMinted, baseOut, pnlBase);
    }

    /**
     * @notice LP < NAV (instant redeem):
     *  - Spend BASE in LP to buy yToken
     *  - Instantly redeem yToken in vault for BASE
     *  - Expect positive PnL in BASE
     */
    function arbBuyThenRedeem(
        uint256 maxQuoteIn,
        uint256 minYOut,
        uint256 minBaseOut,
        uint256 deadline
    ) external onlyOwner notPaused nonReentrant returns (int256 pnlBase) {
        // Basic checks: deadline, inputs, and pool assets
        if (block.timestamp > deadline) revert Deadline();
        if (maxQuoteIn == 0) revert BadConfig();
        if (!_poolContainsBaseAndY(_poolKey)) revert PoolKeyMismatch();

        uint256 baseBefore = BASE.balanceOf(address(this));

        // BASE -> yToken direction depends on token0/token1
        bool zeroForOne = (_poolKey.currency0 == Currency.wrap(address(BASE)));

        // Execute swap and get yToken balance directly
        uint256 yBalBefore = Y_TOKEN.balanceOf(address(this));
        
        router.swapExactTokensForTokens({
            amountIn:     maxQuoteIn,
            amountOutMin: minYOut,
            zeroForOne:   zeroForOne,       // BASE -> yToken
            poolKey:      _poolKey,
            hookData:     "",
            receiver:     address(this),
            deadline:     deadline
        });
        
        uint256 yBalAfter = Y_TOKEN.balanceOf(address(this));
        uint256 yOut = yBalAfter - yBalBefore;
        
        if (yOut < minYOut) revert MinOut();

        // Instant redeem (will revert if vault requires two-step)
        uint256 baseOut = VAULT.redeem(yOut, address(this), address(this));
        if (baseOut < minBaseOut) revert MinOut();

        uint256 baseAfter = BASE.balanceOf(address(this));
        pnlBase = int256(baseAfter) - int256(baseBefore);
        if (pnlBase <= 0) revert NoProfit();

        emit ExecutedBuyThenRedeem(maxQuoteIn, yOut, baseOut, pnlBase);
    }

    /**
     * @notice LP < NAV (Step 1 of 2 - async):
     *  - Spend BASE in LP to buy yToken
     *  - Initiate withdrawal request in vault
     */
    function arbBuyAndQueue(
        uint256 maxQuoteIn,
        uint256 minYOut,
        uint256 deadline
    ) external onlyOwner notPaused nonReentrant returns (uint256 unlockAt) {
        if (block.timestamp > deadline) revert Deadline();
        if (maxQuoteIn == 0) revert BadConfig();
        if (!_poolContainsBaseAndY(_poolKey)) revert PoolKeyMismatch();

        // 1) BASE -> yToken direction
        bool zeroForOne = (_poolKey.currency0 == Currency.wrap(address(BASE)));

        // 2) Execute swap and measure yToken balance change
        uint256 yBalBefore = Y_TOKEN.balanceOf(address(this));
        
        router.swapExactTokensForTokens({
            amountIn:     maxQuoteIn,
            amountOutMin: minYOut,
            zeroForOne:   zeroForOne,
            poolKey:      _poolKey,
            hookData:     "",
            receiver:     address(this),
            deadline:     deadline
        });
        
        uint256 yBalAfter = Y_TOKEN.balanceOf(address(this));
        uint256 yOut = yBalAfter - yBalBefore;
        
        if (yOut < minYOut) revert MinOut();

        // 3) Initiate withdrawal from vault
        // Note: vault uses msg.sender internally, only one pending request allowed
        VAULT.initiateWithdraw(yOut);
        
        // 4) Get unlock time from vault
        unlockAt = VAULT.pendingUnlockAt(address(this));

        emit ExecutedBuyAndQueue(maxQuoteIn, yOut, unlockAt);
    }

    /**
     * @notice LP < NAV (Step 2 of 2 - async):
     *  - Complete the withdrawal request
     *  - Calculate and return profit
     */
    function completeQueuedRedeem(
        uint256 minBaseOut
    ) external onlyOwner notPaused nonReentrant returns (int256 pnlBase) {
        // Check if there's a pending withdrawal and it's ready
        uint256 unlockAt = VAULT.pendingUnlockAt(address(this));
        if (unlockAt == 0) revert RequestNotFound();
        if (block.timestamp < unlockAt) revert WithdrawalNotUnlocked();

        uint256 baseBefore = BASE.balanceOf(address(this));

        // Complete the withdrawal (vault uses msg.sender to identify the request)
        uint256 pendingShares = VAULT.pendingShares(address(this));
        uint256 assetsExpected = VAULT.convertToAssets(pendingShares);
        
        VAULT.withdraw(assetsExpected, address(this), address(this));
        uint256 baseAfter = BASE.balanceOf(address(this));
        uint256 baseOut = baseAfter - baseBefore; // Measure actual assets received

        if (baseOut < minBaseOut) revert MinOut();

        // Calculate PnL
        pnlBase = int256(baseAfter) - int256(baseBefore);
        if (pnlBase <= 0) revert NoProfit();

        emit CompletedQueuedRedeem(0, baseOut, pnlBase);
    }

    // -------------
    // Asset rescue
    // -------------
    function sweep(address token, address to, uint256 amount) external onlyOwner {
        require(IERC20(token).transfer(to, amount), "sweep failed");
    }
}
