"use client";

import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import {
  CONTRACTS,
  HOOK_ABI,
  ARBITRUM_SEPOLIA_CHAIN_ID,
  POOL_CONFIG,
  SOFT_PEG_CONFIG,
  getRpcUrl,
} from "@/constants/contracts";

interface LPPoolStats {
  lpPrice: string;
  priceRawE18: string;
  sqrtPriceX96: string;
  liquidity: string;
  spread: string;
  lastTxFee: string | null; // NEW: Last transaction fee
  lastTxHash: string | null; // NEW: Transaction hash
  lastTxTimestamp: number | null; // NEW: Transaction timestamp
  isLoading: boolean;
  error: string | null;
}

const retry = async <T>(
  fn: () => Promise<T>,
  tries = 3,
  delayMs = 400
): Promise<T> => {
  let last: any;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      last = e;
      const is429 = /429|Too many requests/i.test(e?.message || "");
      await new Promise((r) =>
        setTimeout(r, is429 ? delayMs * (i + 1) : delayMs)
      );
    }
  }
  throw last;
};

export function useLPPoolStats(
  navPrice = "1.0000",
  account: string | null = null
): LPPoolStats {
  const [stats, setStats] = useState<LPPoolStats>({
    lpPrice: "0.00",
    priceRawE18: "0",
    sqrtPriceX96: "0",
    liquidity: "0",
    spread: "0.00",
    lastTxFee: null, // NEW
    lastTxHash: null, // NEW
    lastTxTimestamp: null, // NEW
    isLoading: true,
    error: null,
  });

  const fetchLPStats = useCallback(async () => {
    try {
      setStats((s) => ({ ...s, isLoading: true, error: null }));

      // Optional: if wallet present, warn when on the wrong chain (don’t block reads)
      if (typeof window !== "undefined" && (window as any).ethereum) {
        try {
          const wp = new ethers.BrowserProvider((window as any).ethereum);
          const net = await wp.getNetwork();
          const cid = Number(net.chainId);
          if (cid !== ARBITRUM_SEPOLIA_CHAIN_ID) {
            setStats((s) => ({
              ...s,
              error: `Wallet on chain ${cid}; expected ${ARBITRUM_SEPOLIA_CHAIN_ID}`,
            }));
          }
        } catch {
          /* ignore */
        }
      }

      // Validate addresses
      const bad: string[] = [];
      if (!CONTRACTS.HOOK || !ethers.isAddress(CONTRACTS.HOOK))
        bad.push("HOOK");
      if (!ethers.isAddress(POOL_CONFIG.currency0))
        bad.push("POOL_CONFIG.currency0");
      if (!ethers.isAddress(POOL_CONFIG.currency1))
        bad.push("POOL_CONFIG.currency1");
      if (!ethers.isAddress(POOL_CONFIG.hooks)) bad.push("POOL_CONFIG.hooks");
      if (bad.length) {
        setStats((s) => ({
          ...s,
          isLoading: false,
          error: `Invalid address(es): ${bad.join(", ")}`,
        }));
        return;
      }

      // Read provider (your RPC)
      const read = new ethers.JsonRpcProvider(getRpcUrl());

      // Ensure hook exists on this chain
      const hookCode = await retry(() => read.getCode(CONTRACTS.HOOK!));
      if (hookCode === "0x") {
        setStats((s) => ({
          ...s,
          isLoading: false,
          error: "Hook not deployed on this RPC's chain",
        }));
        return;
      }

      const hook = new ethers.Contract(CONTRACTS.HOOK!, HOOK_ABI, read);

      // ethers v6 returns tuple as array with named fields as well
      const res: any = await retry(() => hook.currentPrices(POOL_CONFIG));

      const priceHumanLP = res[0] ?? res.priceHumanLP;
      const priceRawE18 = res[1] ?? res.priceRawE18;
      const sqrtP = res[2] ?? res.sqrtP;

      // Convert to numbers/strings
      const lpPriceValue = parseFloat(ethers.formatUnits(priceRawE18, 18));
      const navPriceValue = parseFloat(navPrice);

      const spreadPct = ((lpPriceValue - navPriceValue) / navPriceValue) * 100;

      const devBps =
        lpPriceValue > navPriceValue
          ? ((lpPriceValue - navPriceValue) * 10_000) / navPriceValue
          : ((navPriceValue - lpPriceValue) * 10_000) / navPriceValue;

      // ====================================================================
      // Calculate dynamic fee matching PegFeeMath.sol logic exactly
      // ====================================================================

      // // Parameters from your PegFeeMath.sol
      // const BASE_FEE = 3000; // 0.30% in basis points
      // const MIN_FEE = 500; // 0.05%
      // const MAX_FEE = 100000; // 10%
      // const DEADZONE_BPS = 25; // 0.25%
      // const SLOPE_TOWARD = 150; // -0.015% per 1% deviation
      // const SLOPE_AWAY = 1200; // +0.12% per 1% deviation
      // const ARB_TRIGGER_BPS = 5000; // 50%

      // let feeInBps = BASE_FEE;

      // // Check if in arb zone (extreme deviation)
      // if (devBps >= ARB_TRIGGER_BPS) {
      //   // If LP > NAV (away from peg), max fee
      //   // If LP < NAV (toward peg when buying back), min fee
      //   feeInBps = lpPriceValue > navPriceValue ? MAX_FEE : MIN_FEE;
      // } else if (devBps > DEADZONE_BPS) {
      //   // Beyond deadzone, apply slope adjustment
      //   const beyondBps = devBps - DEADZONE_BPS;

      //   // Determine direction:
      //   // When someone SELLS yUSDC, LP price drops below NAV (LP < NAV)
      //   // When someone BUYS yUSDC, LP price rises above NAV (LP > NAV)
      //   // We charge higher fees for trades that move AWAY from peg

      //   // For the CURRENT display, we show the fee for a trade moving AWAY
      //   // (since that's the destabilizing direction)
      //   const isLPAboveNAV = lpPriceValue > navPriceValue;

      //   if (isLPAboveNAV) {
      //     // LP is already above NAV, buying more yUSDC pushes it further away
      //     // Apply AWAY slope (higher fee)
      //     const magnitude = (SLOPE_AWAY * beyondBps) / 100;
      //     feeInBps = BASE_FEE + magnitude;
      //   } else {
      //     // LP is below NAV, selling more yUSDC pushes it further away
      //     // Apply AWAY slope (higher fee)
      //     const magnitude = (SLOPE_AWAY * beyondBps) / 100;
      //     feeInBps = BASE_FEE + magnitude;
      //   }

      //   // Clamp to min/max
      //   feeInBps = Math.max(MIN_FEE, Math.min(MAX_FEE, feeInBps));
      // }
      // // else: within deadzone, keep BASE_FEE

      // const currentFee = feeInBps / 10000; // Convert bps to percentage

      // TODO: real liquidity pull (needs pool manager reads). Placeholder for now.
      const liquidity = "—";

      // ====================================================================
      // NEW: Fetch last transaction fee from event logs (if account provided)
      // ====================================================================
      let lastTxFee: string | null = null;
      let lastTxHash: string | null = null;
      let lastTxTimestamp: number | null = null;

      if (account && ethers.isAddress(account)) {
        try {
          const latestBlock = await read.getBlockNumber();
          const fromBlock = Math.max(0, latestBlock - 1000);

          // Query for FeeChosen events
          const filter = hook.filters.FeeChosen?.();

          if (filter) {
            const events = await hook.queryFilter(
              filter,
              fromBlock,
              latestBlock
            );

            if (events.length > 0) {
              const lastEvent = events[events.length - 1];
              const eventArgs = lastEvent.args;

              // rawFee is in basis points (e.g., 3000 = 30.00%)
              if (eventArgs?.rawFee !== undefined) {
                const feeBps = Number(eventArgs.rawFee);
                lastTxFee = (feeBps / 10000).toFixed(2);
              }

              lastTxHash = lastEvent.transactionHash;

              try {
                const receipt = await read.getTransactionReceipt(
                  lastEvent.transactionHash
                );
                if (receipt) {
                  const block = await read.getBlock(receipt.blockNumber);
                  lastTxTimestamp = block?.timestamp || null;
                }
              } catch {}
            }
          }
        } catch (eventErr) {
          console.warn("Failed to fetch last transaction fee:", eventErr);
        }
      }

      setStats({
        lpPrice: lpPriceValue.toFixed(4),
        priceRawE18: priceRawE18.toString(),
        sqrtPriceX96: sqrtP.toString(),
        liquidity,
        spread: spreadPct.toFixed(2),
        lastTxFee, // NEW
        lastTxHash, // NEW
        lastTxTimestamp, // NEW
        isLoading: false,
        error: null,
      });
    } catch (err: any) {
      console.error("Error fetching LP stats:", err);
      const msg = /429|Too many requests/i.test(err?.message || "")
        ? "RPC rate-limited. Add NEXT_PUBLIC_ALCHEMY_API_KEY or set NEXT_PUBLIC_RPC_URL."
        : err?.reason || err?.message || "Failed to fetch LP data";
      setStats((s) => ({ ...s, isLoading: false, error: msg }));
    }
  }, [navPrice, account]);

  useEffect(() => {
    fetchLPStats();
    const id = setInterval(fetchLPStats, 10_000);
    return () => clearInterval(id);
  }, [fetchLPStats]);

  return stats;
}
