"use client";

import { useState } from "react";
import { ethers } from "ethers";
import {
  CONTRACTS,
  VAULT_ABI,
  ERC20_ABI,
  ARBITRUM_SEPOLIA_CHAIN_ID,
  getRpcUrl,
  ARBITRUM_SEPOLIA, // chain params object from your constants
} from "@/constants/contracts";

interface MintTokenCardProps {
  account: string | null;
  navPrice: string;
  onSuccess?: () => void;
}

export default function MintTokenCard({
  account,
  navPrice,
  onSuccess,
}: MintTokenCardProps) {
  const [amount, setAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  async function ensureWalletOnArbSepolia(provider: ethers.BrowserProvider) {
    const net = await provider.getNetwork();
    const chainId = Number(net.chainId);
    if (chainId === ARBITRUM_SEPOLIA_CHAIN_ID) return;

    // try polite switch
    try {
      await (window as any).ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: ARBITRUM_SEPOLIA.chainId }],
      });
    } catch (e: any) {
      // if not added, add then switch
      if (e?.code === 4902) {
        await (window as any).ethereum.request({
          method: "wallet_addEthereumChain",
          params: [ARBITRUM_SEPOLIA],
        });
      } else {
        throw new Error(
          `Please switch to Arbitrum Sepolia (current: ${chainId})`
        );
      }
    }
  }

  const handleMint = async () => {
    try {
      setIsLoading(true);
      setError(null);
      setTxHash(null);

      if (!account) {
        throw new Error("Please connect your wallet");
      }
      if (!amount || Number(amount) <= 0) {
        throw new Error("Please enter a valid amount");
      }
      if (!CONTRACTS.USDC || !ethers.isAddress(CONTRACTS.USDC)) {
        throw new Error("Invalid USDC address (check env)");
      }
      if (!CONTRACTS.VAULT || !ethers.isAddress(CONTRACTS.VAULT)) {
        throw new Error("Invalid VAULT address (check env)");
      }

      // --- Reads via your own RPC (stable & CORS-safe) ---
      const readProvider = new ethers.JsonRpcProvider(getRpcUrl());

      // Sanity: ensure contracts actually exist on this chain
      const [codeUSDC, codeVault] = await Promise.all([
        readProvider.getCode(CONTRACTS.USDC),
        readProvider.getCode(CONTRACTS.VAULT),
      ]);
      if (codeUSDC === "0x")
        throw new Error("USDC not deployed on this RPC’s chain");
      if (codeVault === "0x")
        throw new Error("Vault not deployed on this RPC’s chain");

      // Get decimals via read provider (avoid wallet RPC quirks)
      const usdcRead = new ethers.Contract(
        CONTRACTS.USDC,
        ERC20_ABI,
        readProvider
      );

      const usdcDecimals: number = await usdcRead.decimals();
      console.log("USDC symbol:", usdcDecimals); // should succeed

      // Parse amount
      const amountInWei = ethers.parseUnits(amount, usdcDecimals);

      // --- Now interact with wallet (signer) ---
      if (typeof window === "undefined" || !(window as any).ethereum) {
        throw new Error("No wallet found");
      }
      const browserProvider = new ethers.BrowserProvider(
        (window as any).ethereum
      );

      // Ensure the wallet is on the right chain (attempt switch/add)
      await ensureWalletOnArbSepolia(browserProvider);

      const signer = await browserProvider.getSigner();

      const usdc = new ethers.Contract(CONTRACTS.USDC, ERC20_ABI, signer);
      const vault = new ethers.Contract(CONTRACTS.VAULT, VAULT_ABI, signer);

      // Check allowance
      const allowance: bigint = await usdc.allowance(account, CONTRACTS.VAULT);

      if (allowance < amountInWei) {
        // Approve Max to minimize subsequent approvals; change to amountInWei if you prefer strict
        const approveAmount = ethers.MaxUint256;
        const approveTx = await usdc.approve(CONTRACTS.VAULT, approveAmount);
        const approveRcpt = await approveTx.wait();
        setTxHash(approveRcpt.hash);
      }

      // Deposit to vault (receiver = user’s account)
      const depositTx = await vault.deposit(amountInWei, account);
      const receipt = await depositTx.wait();

      setTxHash(receipt.hash);
      setAmount("");

      onSuccess?.();
    } catch (e: any) {
      console.error("Mint error:", e);
      // nice errors for common cases
      if (e?.code === 4001) setError("User rejected the transaction");
      else if (/insufficient funds/i.test(e?.message))
        setError("Insufficient funds for gas");
      else if (/chain/i.test(e?.message) && /switch/i.test(e?.message))
        setError(e.message);
      else setError(e?.reason || e?.message || "Failed to mint tokens");
    } finally {
      setIsLoading(false);
    }
  };

  const tokensToReceive =
    amount && parseFloat(amount) > 0
      ? (
          parseFloat(amount) / Math.max(parseFloat(navPrice) || 0, 1e-12)
        ).toFixed(4)
      : "0.0000";

  // Arbitrum Sepolia explorer link
  const explorerBase = "https://sepolia.arbiscan.io"; // Arbitrum Sepolia uses arbiscan: https://sepolia.arbiscan.io

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 border-2 border-green-200">
      <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
        <span className="text-2xl">🏦</span>
        Mint Token (Vault)
      </h3>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
          {error}
        </div>
      )}

      {txHash && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-600">
          <div className="font-semibold mb-1">✓ Transaction submitted</div>
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

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">
            Amount (USDC)
          </label>
          <input
            type="number"
            placeholder="Enter amount in USDC"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isLoading || !account}
            className="w-full px-4 py-3 border-2 border-slate-300 rounded-lg focus:outline-none focus:border-green-500 text-lg disabled:bg-slate-100 disabled:cursor-not-allowed"
          />
        </div>

        <div className="bg-green-50 rounded-lg p-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-600">NAV Price:</span>
            <span className="font-bold text-green-700">${navPrice}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Mint Fee:</span>
            <span className="font-bold text-green-600">0.00%</span>
          </div>
          <div className="flex justify-between pt-2 border-t border-green-200">
            <span className="text-slate-600">You will receive:</span>
            <span className="font-bold text-green-700">
              ~{tokensToReceive} yUSDC
            </span>
          </div>
        </div>

        <button
          onClick={handleMint}
          disabled={isLoading || !account || !amount}
          className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
        >
          {isLoading ? "Processing…" : "Mint Tokens"}
        </button>

        <div className="text-xs text-slate-500 text-center">
          {!account
            ? "Connect wallet to mint tokens"
            : "Create new tokens at NAV price with zero fees"}
        </div>
      </div>
    </div>
  );
}
