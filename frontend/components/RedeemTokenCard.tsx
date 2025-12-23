"use client";

import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import {
  CONTRACTS,
  VAULT_ABI,
  getRpcUrl,
  ARBITRUM_SEPOLIA_CHAIN_ID,
  ARBITRUM_SEPOLIA, // chain params for wallet_addEthereumChain
} from "@/constants/contracts";

interface RedeemTokenCardProps {
  account: string | null;
  navPrice: string;
  onSuccess?: () => void;
}

export default function RedeemTokenCard({
  account,
  navPrice,
  onSuccess,
}: RedeemTokenCardProps) {
  const [amount, setAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const [pendingShares, setPendingShares] = useState("0");
  const [unlockTime, setUnlockTime] = useState<number>(0);
  const [redemptionPeriod, setRedemptionPeriod] = useState<number>(0);

  // ---- helpers ----
  const retry = async <T,>(
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

  const ensureWalletOnArbSepolia = useCallback(
    async (provider: ethers.BrowserProvider) => {
      const net = await provider.getNetwork();
      const cid = Number(net.chainId);
      if (cid === ARBITRUM_SEPOLIA_CHAIN_ID) return;
      try {
        await (window as any).ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: ARBITRUM_SEPOLIA.chainId }],
        });
      } catch (e: any) {
        if (e?.code === 4902) {
          await (window as any).ethereum.request({
            method: "wallet_addEthereumChain",
            params: [ARBITRUM_SEPOLIA],
          });
        } else {
          throw new Error(
            `Please switch to Arbitrum Sepolia (current: ${cid})`
          );
        }
      }
    },
    []
  );

  // ---- READ pending withdrawal (via RPC) ----
  const fetchPendingWithdrawal = useCallback(async () => {
    if (!account) return;
    try {
      setError(null);
      if (!CONTRACTS.VAULT || !ethers.isAddress(CONTRACTS.VAULT)) {
        setError("Invalid VAULT address (env)");
        return;
      }
      const read = new ethers.JsonRpcProvider(getRpcUrl());
      const code = await retry(() => read.getCode(CONTRACTS.VAULT!));
      if (code === "0x") {
        setError("Vault not deployed on this RPC's chain");
        return;
      }
      const vault = new ethers.Contract(CONTRACTS.VAULT!, VAULT_ABI, read);

      const [pending, unlockAt, period, decimals] = await Promise.all([
        retry(() => vault.pendingShares(account)),
        retry(() => vault.pendingUnlockAt(account)),
        retry(() => vault.redemptionPeriod()),
        retry(() => vault.decimals()),
      ]);

      setPendingShares(ethers.formatUnits(pending, decimals));
      setUnlockTime(Number(unlockAt)); // seconds
      setRedemptionPeriod(Number(period)); // seconds
    } catch (err) {
      console.error("Error fetching pending withdrawal:", err);
      // keep UI visible; no hard error shown here
    }
  }, [account]);

  useEffect(() => {
    fetchPendingWithdrawal();
  }, [fetchPendingWithdrawal]);

  // ---- INITIATE WITHDRAW (uses signer) ----
  const handleInitiateWithdraw = async () => {
    try {
      setIsLoading(true);
      setError(null);
      setTxHash(null);

      if (!account) throw new Error("Please connect your wallet");
      if (!amount || Number(amount) <= 0)
        throw new Error("Please enter a valid amount");
      if (!CONTRACTS.VAULT || !ethers.isAddress(CONTRACTS.VAULT)) {
        throw new Error("Invalid VAULT address (env)");
      }

      // Read decimals via RPC (no wallet quirks)
      const read = new ethers.JsonRpcProvider(getRpcUrl());
      const vaultRead = new ethers.Contract(CONTRACTS.VAULT!, VAULT_ABI, read);
      const decimals: number = await retry(() => vaultRead.decimals());
      const sharesInWei = ethers.parseUnits(amount, decimals);

      // Use wallet for tx
      if (typeof window === "undefined" || !(window as any).ethereum) {
        throw new Error("No wallet found");
      }
      const browserProvider = new ethers.BrowserProvider(
        (window as any).ethereum
      );
      await ensureWalletOnArbSepolia(browserProvider);

      const signer = await browserProvider.getSigner();
      const vault = vaultRead.connect(signer);

      const tx = await vault.initiateWithdraw(sharesInWei);
      const receipt = await tx.wait();

      setTxHash(receipt.hash);
      setAmount("");

      // refresh pending info + balances
      await fetchPendingWithdrawal();
      onSuccess?.();
    } catch (e: any) {
      console.error("Initiate withdraw error:", e);
      if (e?.code === 4001) setError("User rejected the transaction");
      else if (/429|Too many requests/i.test(e?.message || ""))
        setError(
          "RPC rate-limited; set NEXT_PUBLIC_ALCHEMY_API_KEY or NEXT_PUBLIC_RPC_URL."
        );
      else setError(e?.reason || e?.message || "Failed to initiate withdrawal");
    } finally {
      setIsLoading(false);
    }
  };

  // ---- INITIATE WITHDRAW (uses signer) ----
  const finalizeWithdraw = async () => {
    try {
      setIsLoading(true);
      setError(null);
      setTxHash(null);

      if (!account) throw new Error("Please connect your wallet");
      if (!amount || Number(amount) <= 0)
        throw new Error("Please enter a valid amount");
      if (!CONTRACTS.VAULT || !ethers.isAddress(CONTRACTS.VAULT)) {
        throw new Error("Invalid VAULT address (env)");
      }

      // Read decimals via RPC (no wallet quirks)
      const read = new ethers.JsonRpcProvider(getRpcUrl());
      const vaultRead = new ethers.Contract(CONTRACTS.VAULT!, VAULT_ABI, read);
      const decimals: number = await retry(() => vaultRead.decimals());
      const sharesInWei = ethers.parseUnits(amount, decimals);

      // Use wallet for tx
      if (typeof window === "undefined" || !(window as any).ethereum) {
        throw new Error("No wallet found");
      }
      const browserProvider = new ethers.BrowserProvider(
        (window as any).ethereum
      );
      await ensureWalletOnArbSepolia(browserProvider);

      const signer = await browserProvider.getSigner();
      const vault = vaultRead.connect(signer);

      const tx = await vault.withdraw(sharesInWei, account, account);
      const receipt = await tx.wait();

      setTxHash(receipt.hash);
      setAmount("");

      // refresh pending info + balances
      await fetchPendingWithdrawal();
      onSuccess?.();
    } catch (e: any) {
      console.error("Initiate withdraw error:", e);
      if (e?.code === 4001) setError("User rejected the transaction");
      else if (/429|Too many requests/i.test(e?.message || ""))
        setError(
          "RPC rate-limited; set NEXT_PUBLIC_ALCHEMY_API_KEY or NEXT_PUBLIC_RPC_URL."
        );
      else setError(e?.reason || e?.message || "Failed to initiate withdrawal");
    } finally {
      setIsLoading(false);
    }
  };

  // ---- Derived UI state ----
  const cashToReceive =
    amount && parseFloat(amount) > 0
      ? (parseFloat(amount) * Math.max(parseFloat(navPrice) || 0, 0)).toFixed(2)
      : "0.00";

  const nowSec = Math.floor(Date.now() / 1000);
  const isUnlocked = unlockTime > 0 && nowSec >= unlockTime;
  const timeUntilUnlock = unlockTime > 0 ? Math.max(0, unlockTime - nowSec) : 0;
  const hoursUntilUnlock = Math.floor(timeUntilUnlock / 3600);
  const minutesUntilUnlock = Math.floor((timeUntilUnlock % 3600) / 60);

  const explorerBase = "https://sepolia.arbiscan.io";

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 border-2 border-orange-200">
      <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
        <span className="text-2xl">💰</span>
        Redeem Token (Vault)
      </h3>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
          {error}
        </div>
      )}

      {txHash && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-600">
          <div className="font-semibold mb-1">✓ Withdrawal initiated!</div>
          <a
            href={`${explorerBase}/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline break-all"
          >
            View transaction
          </a>
        </div>
      )}

      {parseFloat(pendingShares) > 0 && (
        <div
          className={`mb-4 p-3 rounded-lg border text-sm ${
            isUnlocked
              ? "bg-green-50 border-green-200"
              : "bg-amber-50 border-amber-200"
          }`}
        >
          <div className="font-semibold mb-1">
            {isUnlocked ? "✓ Withdrawal Ready!" : "⏳ Pending Withdrawal"}
          </div>
          <div className="text-slate-700">
            <div>Amount: {parseFloat(pendingShares).toFixed(4)} yUSDC</div>
            {!isUnlocked && (
              <div>
                Unlocks in: {hoursUntilUnlock}h {minutesUntilUnlock}m
              </div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">
            Amount (yUSDC)
          </label>
          <input
            type="number"
            placeholder="Enter token amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isLoading || !account}
            className="w-full px-4 py-3 border-2 border-slate-300 rounded-lg focus:outline-none focus:border-orange-500 text-lg disabled:bg-slate-100 disabled:cursor-not-allowed"
          />
        </div>

        <div className="bg-orange-50 rounded-lg p-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-600">NAV Price:</span>
            <span className="font-bold text-orange-700">${navPrice}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Redeem Fee:</span>
            <span className="font-bold text-orange-600">0.00%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Redemption Period:</span>
            <span className="font-bold text-orange-600">
              {Math.floor(redemptionPeriod / 3600)}h
            </span>
          </div>
          <div className="flex justify-between pt-2 border-t border-orange-200">
            <span className="text-slate-600">You will receive:</span>
            <span className="font-bold text-orange-700">~${cashToReceive}</span>
          </div>
        </div>

        <button
          onClick={handleInitiateWithdraw}
          disabled={isLoading || !account || !amount}
          className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 px-6 rounded-lg transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
        >
          {isLoading ? "Processing…" : "Initiate Withdrawal"}
        </button>

        <button
          onClick={finalizeWithdraw}
          disabled={isLoading || !account || !amount}
          className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-3 px-6 rounded-lg transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
        >
          {isLoading ? "Processing…" : "Finalize Withdrawal"}
        </button>

        <div className="text-xs text-slate-500 text-center">
          {!account
            ? "Connect wallet to redeem tokens"
            : "Step 1: Initiate withdrawal (timelock starts)"}
        </div>
      </div>
    </div>
  );
}
