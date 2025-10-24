// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// If you're on the Uniswap V4 template, this path works:
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
// If not, switch to your local FullMath import.

contract TestPriceHelpers {
    uint256 constant Q96  = 1 << 96;
    uint256 constant Q192 = 1 << 192;

    /// @notice Encode sqrtPriceX96 from human whole-token amounts
    /// @dev price_raw = (amount1 * 10^dec1) / (amount0 * 10^dec0)
    ///      sqrtP     = sqrt(price_raw * 2^192)
    function encodeFromHumanAmounts(
        uint256 amount1Whole,  // token1 per token0: numerator (whole tokens)
        uint256 amount0Whole,  // denominator (whole tokens)
        uint8 dec0,            // decimals(token0)
        uint8 dec1             // decimals(token1)
    ) external pure returns (uint160 sqrtP) {
        require(amount0Whole > 0 && amount1Whole > 0, "zero amount");

        uint256 num = amount1Whole * _pow10(dec1); // token1_raw
        uint256 den = amount0Whole * _pow10(dec0); // token0_raw

        // ratioX192 = (num/den) * 2^192
        uint256 ratioX192 = FullMath.mulDiv(num, Q192, den);

        uint256 sp = _sqrt(ratioX192);             // = sqrt(price_raw) * 2^96
        require(sp <= type(uint160).max, "sqrtP overflow");
        sqrtP = uint160(sp);
    }

    /// @notice Decode directly to human price to avoid tiny raw underflow
    /// @return priceHuman token1 per token0 (whole tokens)
    /// @return priceRawE18 price_raw scaled by 1e18 (for logging/compare)
    function decodePriceHuman(
        uint160 sqrtP,
        uint8 dec0,
        uint8 dec1
    ) external pure returns (uint256 priceHuman, uint256 priceRawE18) {
        uint256 s   = uint256(sqrtP);

        // Compute Pq96 = s^2 / 2^96 (keep it big to avoid losing tiny values)
        uint256 Pq96 = FullMath.mulDiv(s, s, Q96); // Q96 fixed-point

        // ---- Human price (token1 per token0), rounded to nearest integer ----
        if (dec0 >= dec1) {
            // (Pq96 * 10^(dec0-dec1)) / 2^96, rounded
            uint256 scale = _pow10(dec0 - dec1);
            uint256 num   = Pq96 * scale;
            priceHuman    = (num + (Q96 / 2)) / Q96;
        } else {
            // (Pq96 / 2^96) / 10^(dec1-dec0), rounded
            uint256 den   = Q96 * _pow10(dec1 - dec0);
            priceHuman    = (Pq96 + (den / 2)) / den;
        }

        // ---- Raw price scaled to 1e18: (Pq96 * 1e18) / 2^96 ----
        // (scale BEFORE divide so tiny values don’t floor to 0)
        priceRawE18 = FullMath.mulDiv(Pq96, 1e18, Q96);
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
