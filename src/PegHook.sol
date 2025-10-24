pragma solidity ^0.8.26;

import {BaseHook} from "v4-periphery/src/utils/BaseHook.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {LPFeeLibrary} from "v4-core/src/libraries/LPFeeLibrary.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {console2} from "forge-std/console2.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {PegFeeMath, PegDebug} from "./lib/PegFeeMath.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Currency} from "v4-core/src/types/Currency.sol";

// ---------- ERC20 metadata & token ordering ----------
interface IERC20Metadata {
    function decimals() external view returns (uint8);
    function totalSupply() external view returns (uint256);
}

interface IERC4626 {
    function totalAssets() external view returns (uint256);
    function asset() external view returns (address);
}

library TokenOrder {
    function sort(address a, address b) internal pure returns (address token0, address token1) {
        require(a != b, "Identical");
        require(a != address(0) && b != address(0), "Zero");
        (token0, token1) = a < b ? (a, b) : (b, a);
    }
}

contract PegHook is BaseHook {
    using LPFeeLibrary for uint24;
    using PoolIdLibrary for PoolKey;

    // ---- Fee parameters (unchanged) ----
    uint24  public constant MIN_FEE = 500;
    uint24  public constant BASE_FEE = 3000;
    uint24  public constant MAX_FEE = 100_000;
    uint256 public constant DEADZONE_BPS = 25;
    uint256 public constant ARB_TRIGGER_BPS = 5_000;
    uint256 public constant SLOPE_TOWARD = 150;
    uint256 public constant SLOPE_AWAY   = 1200;

    //uint256 public priceHumanNAV = 100000;

    //Vault variables 
    IERC4626 public immutable vault;
    bool     public immutable sharesIsToken0;
    address  public immutable assetToken; // underlying (e.g., USDC)
    uint8    public immutable assetDec;
    uint8    public immutable shareDec;

 

    // Your two token addresses (unsorted)
    address public constant A = 0x288D991A64Ed02171d0beC0DC788ad76421e1169;
    address public constant B = 0xaD60cee051579E1143e3DC425573f57Ac05A1315;
    //address public constant A = 0xb32Da9C3d9d0bD24b647af261818739AE303648d;
    //address public constant B = 0x69eCF8893845A267102f3b489A515dA697F7049e;
    //address public constant A = 0x26a0379254f298B5d7aB19828F48B5651FA10188;
    //address public constant B = 0x6FC20bE23a51Db17e3ecad4cd48F7b91833fff88;

    // Sorted & cached
    address public immutable token0;
    address public immutable token1;
    uint8   public immutable decimals0;
    uint8   public immutable decimals1;
    //uint256 tickSpacing = 60;

    event FeeChosen(uint24 rawFee, uint24 withFlag, bool toward, uint256 devBps);
    error MustUseDynamicFee();

    constructor(IPoolManager _poolManager, address vault_) BaseHook(_poolManager) {

        // Vault ERC4626
        vault = IERC4626(vault_);
        assetToken = IERC4626(vault_).asset();

        // sort and store
        (address t0, address t1) = TokenOrder.sort(A, B);
        token0 = t0;
        token1 = t1;

        // figure out which side is the share token
        require(token0 == vault_ || token1 == vault_, "vault != token0/1");
        sharesIsToken0 = (token0 == vault_);

        // read decimals once at deployment
        shareDec = IERC20Metadata(vault_).decimals();      // yBTC decimals (likely 18)
        assetDec = IERC20Metadata(assetToken).decimals();  // USDC decimals (likely 6)
        decimals0 = IERC20Metadata(t0).decimals();
        decimals1 = IERC20Metadata(t1).decimals();

    
        console2.log("shareDec:", shareDec);
        console2.log("assetDec:", assetDec);
        console2.log("token0:", t0);
        console2.log("token1:", t1);
        console2.log("decimals0:", decimals0);
        console2.log("decimals1:", decimals1);
    }

    // ---- permissions (unchanged) ----
    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: false,
            beforeAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterAddLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function _beforeInitialize(address, PoolKey calldata key, uint160)
        internal pure override
        returns (bytes4)
    {
        if (!key.fee.isDynamicFee()) revert MustUseDynamicFee();
        return this.beforeInitialize.selector;
    }

    function _beforeSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {
        (uint24 fee, PegDebug memory dbg) = _computePegFee(key, params.zeroForOne);
        uint24 feeWithFlag = fee | LPFeeLibrary.OVERRIDE_FEE_FLAG;
        emit FeeChosen(fee, feeWithFlag, dbg.toward, dbg.devBps);
        return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, feeWithFlag);
    }

    function previewFee(PoolKey calldata key, bool zeroForOne)
        external view returns (uint24 fee, PegDebug memory dbg)
    {
        return _computePegFee(key, zeroForOne);
    }

    function decodePriceHuman(
        uint160 sqrtP
    ) internal view returns (uint256 priceHuman, uint256 priceRawE18) {
        uint256 s   = uint256(sqrtP);
        uint256 Q96 = 1 << 96;

        // Compute Pq96 = s^2 / 2^96 (keep it big to avoid losing tiny values)
        uint256 Pq96 = FullMath.mulDiv(s, s, Q96); // Q96 fixed-point

        // ---- Human price (token1 per token0), rounded to nearest integer ----
        if (decimals0 >= decimals1) {
            // (Pq96 * 10^(decimals0-decimals1)) / 2^96, rounded
            uint256 scale = _pow10(decimals0 - decimals1);
            uint256 num   = Pq96 * scale;
            priceHuman    = (num + (Q96 / 2)) / Q96;
        } else {
            // (Pq96 / 2^96) / 10^(decimals1-decimals0), rounded
            uint256 den   = Q96 * _pow10(decimals1 - decimals0);
            priceHuman    = (Pq96 + (den / 2)) / den;
        }

        // ---- Raw price scaled to 1e18: (Pq96 * 1e18) / 2^96 ----
        // (scale BEFORE divide so tiny values don’t floor to 0)
        priceRawE18 = FullMath.mulDiv(Pq96, 1e18, Q96);
    }

    // (num / 10^numDec) / (den / 10^denDec) * 1e18
    function _ratio1e18(
        uint256 num, uint8 numDec,
        uint256 den, uint8 denDec
    ) internal pure returns (uint256 r) {
        require(num > 0 && den > 0, "zero input");

        // We want: r = (num / 10^numDec) / (den / 10^denDec) * 1e18
        //        = num * 10^(18 + denDec - numDec) / den

        int256 exp = int256(uint256(18))
                + int256(uint256(denDec))
                - int256(uint256(numDec));

        if (exp >= 0) {
            uint256 scale = 10 ** uint256(exp);
            r = FullMath.mulDiv(num, scale, den);
        } else {
            uint256 scale = 10 ** uint256(-exp);
            // Move negative exponent to denominator to keep precision
            // r = num / den / scale, but done safely:
            // (num * 1) / (den * scale)
            r = FullMath.mulDiv(num, 1, den * scale);
        }
        require(r > 0, "ratio=0");
    }

    function _nav1e18FromVault() internal view returns (uint256 out) {
        uint256 assets = vault.totalAssets();
        uint256 shares = IERC20Metadata(address(vault)).totalSupply();
        require(assets > 0 && shares > 0, "empty vault");

        out = sharesIsToken0
            ? _ratio1e18(assets, assetDec, shares, shareDec)
            : _ratio1e18(shares, shareDec, assets, assetDec);

        //console2.log("nav1e18 (strict):", out);
        return out;
    }

    // Lenient: safe for preview/UI (returns 0 if empty)
    function nav1e18() public view returns (uint256) {
        uint256 assets = vault.totalAssets();
        uint256 shares = IERC20Metadata(address(vault)).totalSupply();
        if (assets == 0 || shares == 0) return 0;

        return sharesIsToken0
            ? _ratio1e18(assets, assetDec, shares, shareDec)
            : _ratio1e18(shares, shareDec, assets, assetDec);
    }

    // // ---- Core fee computation (shared) ----
    // function _computePegFee(PoolKey calldata key, bool zeroForOne)
    //     internal view
    //     returns (uint24 fee, PegDebug memory dbg)
    // {
    
    //     (uint256 nav1e18) = _nav1e18FromVault();
    //     console2.log("nav1e18: ", nav1e18);
    //     (uint160 sqrtP,,,) = StateLibrary.getSlot0(poolManager, key.toId());

    //     (uint256 priceHumanLP, ) = decodePriceHuman(sqrtP);
    //     uint256 priceHumanLPe18 = priceHumanLP * 1e18;
    //     uint256 priceHumanNAVe18 = priceHumanNAV * 1e18;
    //     bool toward = _isTowardPeg(zeroForOne, priceHumanLPe18, priceHumanNAVe18);

    //     (fee, dbg) = PegFeeMath.compute(
    //         priceHumanLPe18,
    //         priceHumanNAVe18,
    //         toward,
    //         BASE_FEE,
    //         MIN_FEE,
    //         MAX_FEE,
    //         DEADZONE_BPS,
    //         SLOPE_TOWARD,
    //         SLOPE_AWAY,
    //         ARB_TRIGGER_BPS
    //     );
    // }

    function _computePegFee(PoolKey calldata key, bool zeroForOne)
        internal view
        returns (uint24 fee, PegDebug memory dbg)
    {
        // 1) Live NAV from the vault, scaled 1e18, oriented as token1 per token0
        uint256 navPrice1e18 = _nav1e18FromVault();
        console2.log("nav1e18: ", navPrice1e18);

        // 2) Current pool price; use the full-precision 1e18-scaled value
        (uint160 sqrtP,,,) = StateLibrary.getSlot0(poolManager, key.toId());
        (, uint256 lpPrice1e18) = decodePriceHuman(sqrtP); // lpPrice1e18 = token1/token0 @ 1e18 scale

        // 3) Decide direction (toward/away) relative to NAV
        bool toward = _isTowardPeg(zeroForOne, lpPrice1e18, navPrice1e18);

        // 4) Compute dynamic fee
        (fee, dbg) = PegFeeMath.compute(
            lpPrice1e18,
            navPrice1e18,
            toward,
            BASE_FEE,
            MIN_FEE,
            MAX_FEE,
            DEADZONE_BPS,
            SLOPE_TOWARD,
            SLOPE_AWAY,
            ARB_TRIGGER_BPS
        );
    }


    /// priceHuman* must be token1 per token0 (same orientation), scaled to same units (e.g. 1e18)
    function _isTowardPeg(
        bool zeroForOne,
        uint256 lpPrice1e18,
        uint256 navPrice1e18
    ) internal pure returns (bool) { 
        if (lpPrice1e18 < navPrice1e18) {
            // LP below peg → need price ↑ → oneForZero (zeroForOne == false)
            return !zeroForOne;
        } else if (lpPrice1e18 > navPrice1e18) {
            // LP above peg → need price ↓ → zeroForOne (token0->token1)
            return zeroForOne;
        } else {
            // at peg: treat either direction as toward
            return true;
        }
    }

    // Build a PoolKey with DYNAMIC_FEE for a given tickSpacing
    function keyDynamic(int24 tickSpacing) public view returns (PoolKey memory key) {
        key = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            hooks: IHooks(address(this)),
            fee: 0x800000, // DYNAMIC
            tickSpacing: tickSpacing
        });
    }



    function currentPrices(PoolKey calldata key)
        external
        view
        returns (uint256 priceHumanLP, uint256 priceRawE18, uint160 sqrtP)
    {
        (sqrtP,,,) = StateLibrary.getSlot0(poolManager, key.toId());
        (priceHumanLP, priceRawE18) = decodePriceHuman(sqrtP);
    }


    // ---------- internals ----------
    function _pow10(uint8 x) private pure returns (uint256 r) {
        if (x == 0) return 1;
        if (x == 6)  return 1e6;
        if (x == 8)  return 1e8;
        if (x == 18) return 1e18;
        r = 1; unchecked { for (uint8 i; i < x; ++i) r *= 10; }
    }

    // Babylonian sqrt (256-bit)
    function _sqrt(uint256 x) private pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) >> 1;
        y = x;
        while (z < y) { y = z; z = (x / z + z) >> 1; }
    }
}