"use client";

import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import {
  CONTRACTS,
  ARBITRUM_SEPOLIA_CHAIN_ID,
  getRpcUrl,
} from "@/constants/contracts";

interface VaultStats {
  totalAssets: string;
  totalShares: string;
  sharePrice: string;
  assetsPerShare: string;
  isLoading: boolean;
  error: string | null;
}

// Match your Vault surface
const VAULT_ABI = [
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function idleAssets() view returns (uint256)", // optional in UI
  "function externalNav() view returns (uint256)", // optional in UI
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function convertToShares(uint256 assets) view returns (uint256)",
] as const;

// small retry helper (handles 429 bursts)
async function withRetry<T>(
  fn: () => Promise<T>,
  tries = 3,
  delayMs = 400
): Promise<T> {
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
}

export function useVaultStats(): VaultStats {
  const [stats, setStats] = useState<VaultStats>({
    totalAssets: "0.00",
    totalShares: "0.00",
    sharePrice: "1.0000",
    assetsPerShare: "1.0000",
    isLoading: true,
    error: null,
  });

  const fetchVaultStats = useCallback(async () => {
    try {
      setStats((s) => ({ ...s, isLoading: true, error: null }));

      // Validate vault address early
      if (!CONTRACTS.VAULT || !ethers.isAddress(CONTRACTS.VAULT)) {
        setStats((s) => ({
          ...s,
          isLoading: false,
          error: "Invalid VAULT address (env)",
        }));
        return;
      }

      // Optional: if a wallet is present, warn when on a wrong chain
      if (typeof window !== "undefined" && (window as any).ethereum) {
        try {
          const walletProvider = new ethers.BrowserProvider(
            (window as any).ethereum
          );
          const net = await walletProvider.getNetwork();
          const cid = Number(net.chainId);
          if (cid !== ARBITRUM_SEPOLIA_CHAIN_ID) {
            // Do not abort reads; just surface the message
            setStats((s) => ({
              ...s,
              error: `Wallet on chain ${cid}; expected ${ARBITRUM_SEPOLIA_CHAIN_ID}`,
            }));
          }
        } catch {
          /* ignore wallet errors for read-only flow */
        }
      }

      // Use your own RPC for all reads
      const readProvider = new ethers.JsonRpcProvider(getRpcUrl());

      // Ensure vault contract exists on this chain
      const code = await withRetry(() =>
        readProvider.getCode(CONTRACTS.VAULT!)
      );
      if (code === "0x") {
        setStats((s) => ({
          ...s,
          isLoading: false,
          error: "Vault not deployed on this RPC's chain",
        }));
        return;
      }

      const vault = new ethers.Contract(
        CONTRACTS.VAULT!,
        VAULT_ABI,
        readProvider
      );

      // Pull core stats
      const [totalAssets, totalSupply, decimals] = await Promise.all([
        withRetry(() => vault.totalAssets()),
        withRetry(() => vault.totalSupply()),
        withRetry(() => vault.decimals()),
      ]);

      // Format
      const formattedAssets = ethers.formatUnits(totalAssets, decimals);
      const formattedShares = ethers.formatUnits(totalSupply, decimals);

      // Share price (prefer convertToAssets(1 share); fall back to ratio)
      let sharePrice = "1.0000";
      let assetsPerShare = "1.0000";

      if (totalSupply > 0n) {
        try {
          const oneShare = ethers.parseUnits("1", decimals);
          const assetsForOneShare = await withRetry(() =>
            vault.convertToAssets(oneShare)
          );
          sharePrice = ethers.formatUnits(assetsForOneShare, decimals);
          assetsPerShare = sharePrice;
        } catch {
          // fallback: totalAssets / totalSupply scaled by decimals
          const scale = 10n ** BigInt(decimals);
          const priceScaled =
            (BigInt(totalAssets) * scale) / BigInt(totalSupply);
          sharePrice = ethers.formatUnits(priceScaled, decimals);
          assetsPerShare = sharePrice;
        }
      }

      setStats({
        totalAssets: (+formattedAssets).toFixed(2),
        totalShares: (+formattedShares).toFixed(2),
        sharePrice: (+sharePrice).toFixed(4),
        assetsPerShare: (+assetsPerShare).toFixed(4),
        isLoading: false,
        error: null,
      });
    } catch (err: any) {
      console.error("Error fetching vault stats:", err);
      const msg = /429|Too many requests/i.test(err?.message || "")
        ? "RPC rate-limited. Add NEXT_PUBLIC_ALCHEMY_API_KEY or set NEXT_PUBLIC_RPC_URL."
        : err?.reason || err?.message || "Failed to fetch vault data";
      setStats((s) => ({ ...s, isLoading: false, error: msg }));
    }
  }, []);

  useEffect(() => {
    fetchVaultStats();
    const id = setInterval(fetchVaultStats, 10_000);
    return () => clearInterval(id);
  }, [fetchVaultStats]);

  return stats;
}
