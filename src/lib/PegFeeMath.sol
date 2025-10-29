// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Debug payload returned alongside fee decisions, useful for tracing behavior in tests/UIs
struct PegDebug {
    uint24 baseFee;
    uint24 unclampedFee;
    uint24 clampedFee;
    uint256 priceHumanLPe18;
    uint256 priceHumanNAVe18;
    uint256 devBps;
    uint256 pctUnits;
    bool toward;
    bool arbZone;
}

// Pure math for peg-aware dynamic fee computation
library PegFeeMath {
    function compute(
        uint256 priceHumanLPe18, // Current LP price (1e18 scaled)
        uint256 priceHumanNAVe18, // Current NAV price (1e18 scaled)
        bool toward,                // Whether swap direction is toward the peg
        uint24 BASE_FEE,         // 3000
        uint24 min_fee,          // 500
        uint24 max_fee,          // 100_000
        uint256 deadzone_bps,    // 25
        uint256 slope_toward,    // 150  (−0.015% per +1%)
        uint256 slope_away,      // 1200 (+0.12%  per +1%)
        uint256 arb_trigger_bps  // 5000 (50%), set 0 to disable
    ) internal pure returns (uint24 fee, PegDebug memory dbg) {
        // Fail-safe if NAV is unavailable → fall back to BASE_FEE and mark no arb zone
        if (priceHumanNAVe18 == 0) {
            fee = BASE_FEE;
            dbg = PegDebug({
                baseFee: BASE_FEE,
                unclampedFee: BASE_FEE,
                clampedFee: BASE_FEE,
                priceHumanLPe18: priceHumanLPe18,
                priceHumanNAVe18: priceHumanNAVe18,
                devBps: 0,
                pctUnits: 0,
                toward: toward,
                arbZone: false
            });
            return (fee, dbg);
        }

        // Compute absolute deviation in bps, normalized by NAV (consistent orientation)
        uint256 devBps = priceHumanLPe18 > priceHumanNAVe18
            ? ((priceHumanLPe18 - priceHumanNAVe18) * 10_000) / priceHumanNAVe18
            : ((priceHumanNAVe18 - priceHumanLPe18) * 10_000) / priceHumanNAVe18;

        // Arb zone if enabled and deviation crosses threshold
        bool arbZone = (arb_trigger_bps != 0) && (devBps >= arb_trigger_bps);

        uint256 rawUnclamped256; // Fee before applying min/max limits
        uint256 clamped256;      // Fee after applying min/max limits

        if (arbZone) {
            // In extreme deviations, push fee to edges:
            // - If swap helps the peg (toward), incentivize with min fee
            // - If swap hurts the peg (away), penalize with max fee
            rawUnclamped256 = toward ? min_fee : max_fee;
        } else if (devBps > deadzone_bps) {
            // Linear response outside deadzone:
            // magnitude = slope * (deviation beyond deadzone) / 100 (since 100 bps = 1%)
            uint256 beyondBps = devBps - deadzone_bps;              // portion beyond deadzone
            uint256 slope = toward ? slope_toward : slope_away;     // choose slope by direction
            uint256 magnitude256 = (slope * beyondBps) / 100;       // scale: per-1% steps

            if (toward) {
                // Toward peg → reduce fee from BASE_FEE, but do not go negative
                rawUnclamped256 = BASE_FEE > magnitude256 ? uint256(BASE_FEE) - magnitude256 : 0;
            } else {
                // Away from peg → increase fee from BASE_FEE
                rawUnclamped256 = uint256(BASE_FEE) + magnitude256;
            }
        } else {
            // Within deadzone → keep BASE_FEE
            rawUnclamped256 = BASE_FEE;
        }

        // Single clamp pass to [min_fee, max_fee]
        if (rawUnclamped256 < min_fee) clamped256 = min_fee;
        else if (rawUnclamped256 > max_fee) clamped256 = max_fee;
        else clamped256 = rawUnclamped256;

        // Final fee as uint24 (Uniswap fee field width)
        fee = uint24(clamped256);

        // Populate debug info (keep unclamped visible, capped to uint24 bounds for storage only)
        dbg = PegDebug({
            baseFee: BASE_FEE,
            // Cap displayed unclamped to uint24 range purely for struct compatibility
            unclampedFee: uint24(rawUnclamped256 > type(uint24).max ? type(uint24).max : rawUnclamped256),
            clampedFee: fee,
            priceHumanLPe18: priceHumanLPe18,
            priceHumanNAVe18: priceHumanNAVe18,
            devBps: devBps,
            // Keep your original pctUnits field: whole %-points beyond deadzone (for logging)
            pctUnits: (devBps > deadzone_bps) ? (devBps - deadzone_bps) / 100 : 0,
            toward: toward,
            arbZone: arbZone
        });
    }
}
