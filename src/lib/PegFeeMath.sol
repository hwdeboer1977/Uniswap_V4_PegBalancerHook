// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

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

library PegFeeMath {
    function compute(
        uint256 priceHumanLPe18,
        uint256 priceHumanNAVe18,
        bool toward,
        uint24 BASE_FEE,         // 3000
        uint24 min_fee,          // 500
        uint24 max_fee,          // 100_000
        uint256 deadzone_bps,    // 25
        uint256 slope_toward,    // 150  (−0.015% per +1%)
        uint256 slope_away,      // 1200 (+0.12%  per +1%)
        uint256 arb_trigger_bps  // 5000 (50%), set 0 to disable
    ) internal pure returns (uint24 fee, PegDebug memory dbg) {
        // Fail-safe if NAV is unavailable
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

        // Deviation in basis points, consistently normalized by NAV
        uint256 devBps = priceHumanLPe18 > priceHumanNAVe18
            ? ((priceHumanLPe18 - priceHumanNAVe18) * 10_000) / priceHumanNAVe18
            : ((priceHumanNAVe18 - priceHumanLPe18) * 10_000) / priceHumanNAVe18;

        bool arbZone = (arb_trigger_bps != 0) && (devBps >= arb_trigger_bps);

        uint256 rawUnclamped256; // fee before MIN/MAX clamp
        uint256 clamped256;      // fee after MIN/MAX clamp

        if (arbZone) {
            // Extreme incentives in arb zone
            rawUnclamped256 = toward ? min_fee : max_fee;
        } else if (devBps > deadzone_bps) {
            // Smooth response: slope is "bps change per +1% (=100 bps) of deviation beyond deadzone"
            uint256 beyondBps = devBps - deadzone_bps;              // deviation beyond deadzone (in bps)
            uint256 slope = toward ? slope_toward : slope_away;     // (fee bps) per 1% (=100 bps) beyond deadzone
            uint256 magnitude256 = (slope * beyondBps) / 100;       // scale by 100 bps-per-1%

            if (toward) {
                rawUnclamped256 = BASE_FEE > magnitude256 ? uint256(BASE_FEE) - magnitude256 : 0;
            } else {
                rawUnclamped256 = uint256(BASE_FEE) + magnitude256;
            }
        } else {
            rawUnclamped256 = BASE_FEE;
        }

        // Clamp once
        if (rawUnclamped256 < min_fee) clamped256 = min_fee;
        else if (rawUnclamped256 > max_fee) clamped256 = max_fee;
        else clamped256 = rawUnclamped256;

        fee = uint24(clamped256);

        dbg = PegDebug({
            baseFee: BASE_FEE,
            // For debug, show true *raw* (pre-clamp), capped only to uint24 range for storage
            unclampedFee: uint24(rawUnclamped256 > type(uint24).max ? type(uint24).max : rawUnclamped256),
            clampedFee: fee,
            priceHumanLPe18: priceHumanLPe18,
            priceHumanNAVe18: priceHumanNAVe18,
            devBps: devBps,
            // Keep your original pctUnits field: whole % points beyond deadzone (for logging)
            pctUnits: (devBps > deadzone_bps) ? (devBps - deadzone_bps) / 100 : 0,
            toward: toward,
            arbZone: arbZone
        });
    }
}
