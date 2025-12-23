"use client";

import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import {
  CONTRACTS,
  ERC20_ABI,
  ARBITRUM_SEPOLIA_CHAIN_ID,
  getRpcUrl,
} from "@/constants/contracts";

interface TokenBalances {
  usdc: string;
  yusdc: string;
  isLoading: boolean;
  error: string | null;
}

const BALANCE_ABI = ["function balanceOf(address) view returns (uint256)"];

// naive retry helper
async function withRetry<T>(
  fn: () => Promise<T>,
  tries = 3,
  delayMs = 400
): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      // if it looks like a 429, back off slightly longer
      const is429 =
        e?.code === "UNKNOWN_ERROR" &&
        /429|Too many requests/i.test(e?.message || "");
      await new Promise((r) =>
        setTimeout(r, is429 ? delayMs * (i + 1) : delayMs)
      );
    }
  }
  throw lastErr;
}

export function useTokenBalances(account: string | null): TokenBalances {
  const [state, setState] = useState<TokenBalances>({
    usdc: "0.00",
    yusdc: "0.00",
    isLoading: false,
    error: null,
  });

  const fetchBalances = useCallback(async () => {
    if (!account) {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: null,
        usdc: "0.00",
        yusdc: "0.00",
      }));
      return;
    }
    if (!CONTRACTS?.USDC || !ethers.isAddress(CONTRACTS.USDC)) {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: "Invalid USDC address (env)",
      }));
      return;
    }
    if (!CONTRACTS?.yUSDC || !ethers.isAddress(CONTRACTS.yUSDC)) {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: "Invalid yUSDC address (env)",
      }));
      return;
    }

    try {
      setState((s) => ({ ...s, isLoading: true, error: null }));

      // 1) Check user is on Arbitrum Sepolia via wallet
      if (typeof window === "undefined" || !window.ethereum) {
        setState((s) => ({ ...s, isLoading: false, error: "No wallet found" }));
        return;
      }
      const walletProvider = new ethers.BrowserProvider(window.ethereum);
      const net = await walletProvider.getNetwork();
      const chainId = Number(net.chainId);
      if (chainId !== ARBITRUM_SEPOLIA_CHAIN_ID) {
        setState((s) => ({
          ...s,
          isLoading: false,
          error: `Please switch to Arbitrum Sepolia (current: ${chainId})`,
        }));
        return;
      }

      // 2) Do ALL READS via your own RPC (avoids wallet’s rate-limited public RPC)
      const readProvider = new ethers.JsonRpcProvider(getRpcUrl());

      // 3) Ensure contracts exist on this chain (with retry to handle 429)
      const [codeUSDC, codeYUSDC] = await Promise.all([
        withRetry(() => readProvider.getCode(CONTRACTS.USDC)),
        withRetry(() => readProvider.getCode(CONTRACTS.yUSDC)),
      ]);
      if (codeUSDC === "0x")
        throw new Error("USDC not deployed on this RPC's chain");
      if (codeYUSDC === "0x")
        throw new Error("yUSDC not deployed on this RPC's chain");

      // 4) Build contracts on the read provider
      const usdc = new ethers.Contract(CONTRACTS.USDC, ERC20_ABI, readProvider);
      const yusdc = new ethers.Contract(
        CONTRACTS.yUSDC,
        BALANCE_ABI,
        readProvider
      );

      // 5) Read with retry (handles occasional 429 from shared endpoints)
      const [usdcBal, yusdcBal, usdcDec] = await Promise.all([
        withRetry(() => usdc.balanceOf(account)),
        withRetry(() => yusdc.balanceOf(account)),
        withRetry(() => usdc.decimals()),
      ]);

      const usdcFmt = ethers.formatUnits(usdcBal, usdcDec);
      const yusdcFmt = ethers.formatUnits(yusdcBal, usdcDec);

      setState({
        usdc: (+usdcFmt).toFixed(2),
        yusdc: (+yusdcFmt).toFixed(4),
        isLoading: false,
        error: null,
      });
    } catch (err: any) {
      console.error("Error fetching balances:", err);
      const msg = /429|Too many requests/i.test(err?.message || "")
        ? "RPC rate-limited. Add your own Alchemy/Infura key in NEXT_PUBLIC_ALCHEMY_API_KEY."
        : err?.reason || err?.message || "Failed to fetch balances";
      setState((s) => ({ ...s, isLoading: false, error: msg }));
    }
  }, [account]);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);
  return state;
}
