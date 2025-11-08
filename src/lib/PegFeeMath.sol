// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";


// Debug payload returned alongside fee decisions, useful for tracing behavior in tests/UIs
struct PegDebug {
    uint24 baseFee;
    uint24 unclampedFee;
    uint24 clampedFee;
    uint256 priceHumanLpe18;
    uint256 priceHumanNave18;
    uint256 devBps;
    uint256 pctUnits;
    bool toward;
    bool arbZone;
}

// Pure math for peg-aware dynamic fee computation
library PegFeeMath {
    function compute(
        uint256 priceHumanLpe18, // Current LP price (1e18 scaled)
        uint256 priceHumanNave18, // Current NAV price (1e18 scaled)
        bool toward,                // Whether swap direction is toward the peg
        uint24 baseFee,         // 3000
        uint24 minFee,          // 500
        uint24 maxFee,          // 100_000
        uint256 deadzoneBps,    // 25
        uint256 slopeToward,    // 150  (−0.015% per +1%)
        uint256 slopeAway,      // 1200 (+0.12%  per +1%)
        uint256 arbTriggerBps  // 5000 (50%), set 0 to disable
    ) internal pure returns (uint24 fee, PegDebug memory dbg) {
        // Fail-safe if NAV is unavailable → fall back to BASE_FEE and mark no arb zone
        if (priceHumanNave18 == 0) {
            fee = baseFee;
            dbg = PegDebug({
                baseFee: baseFee,
                unclampedFee: baseFee,
                clampedFee: baseFee,
                priceHumanLpe18: priceHumanLpe18,
                priceHumanNave18: priceHumanNave18,
                devBps: 0,
                pctUnits: 0,
                toward: toward,
                arbZone: false
            });
            return (fee, dbg);
        }

        // Compute absolute deviation in bps, normalized by NAV (consistent orientation)
        uint256 devBps = priceHumanLpe18 > priceHumanNave18
            ? ((priceHumanLpe18 - priceHumanNave18) * 10_000) / priceHumanNave18
            : ((priceHumanNave18 - priceHumanLpe18) * 10_000) / priceHumanNave18;

        // Arb zone if enabled and deviation crosses threshold
        bool arbZone = (arbTriggerBps != 0) && (devBps >= arbTriggerBps);

        uint256 rawUnclamped256; // Fee before applying min/max limits
        uint256 clamped256;      // Fee after applying min/max limits

        if (arbZone) {
            // In extreme deviations, push fee to edges:
            // - If swap helps the peg (toward), incentivize with min fee
            // - If swap hurts the peg (away), penalize with max fee
            rawUnclamped256 = toward ? minFee : maxFee;
        } else if (devBps > deadzoneBps) {
            // Linear response outside deadzone:
            // magnitude = slope * (deviation beyond deadzone) / 100 (since 100 bps = 1%)
            uint256 beyondBps = devBps - deadzoneBps;              // portion beyond deadzone
            uint256 slope = toward ? slopeToward : slopeAway;     // choose slope by direction
            uint256 magnitude256 = (slope * beyondBps) / 100;       // scale: per-1% steps

            if (toward) {
                // Toward peg → reduce fee from BASE_FEE, but do not go negative
                rawUnclamped256 = baseFee > magnitude256 ? uint256(baseFee) - magnitude256 : 0;
            } else {
                // Away from peg → increase fee from BASE_FEE
                rawUnclamped256 = uint256(baseFee) + magnitude256;
            }
        } else {
            // Within deadzone → keep baseFee
            rawUnclamped256 = baseFee;
        }

        // Single clamp pass to [minFee, maxFee]
        if (rawUnclamped256 < minFee) clamped256 = minFee;
        else if (rawUnclamped256 > maxFee) clamped256 = maxFee;
        else clamped256 = rawUnclamped256;

        // Final fee as uint24 (Uniswap fee field width)
        fee = SafeCast.toUint24(clamped256);

        // Populate debug info (keep unclamped visible, capped to uint24 bounds for storage only)
        dbg = PegDebug({
            baseFee: baseFee,
            // Cap displayed unclamped to uint24 range purely for struct compatibility
            unclampedFee: uint24(rawUnclamped256 > type(uint24).max ? type(uint24).max : rawUnclamped256),
            clampedFee: fee,
            priceHumanLpe18: priceHumanLpe18,
            priceHumanNave18: priceHumanNave18,
            devBps: devBps,
            // Keep your original pctUnits field: whole %-points beyond deadzone (for logging)
            pctUnits: (devBps > deadzoneBps) ? (devBps - deadzoneBps) / 100 : 0,
            toward: toward,
            arbZone: arbZone 
        });
    }
}
