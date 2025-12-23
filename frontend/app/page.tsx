"use client";

import { useState } from "react";
import LPPoolStats from "@/components/LPPoolStats";
import VaultStats from "@/components/VaultStats";
import UserBalance from "@/components/UserBalance";
import ScenariosPreview from "@/components/ScenariosPreview"; // NEW IMPORT
import BuyTokenCard from "@/components/BuyTokenCard";
import MintTokenCard from "@/components/MintTokenCard";
import RedeemTokenCard from "@/components/RedeemTokenCard";
import WalletConnect from "@/components/WalletConnect";
import { useTokenBalances } from "@/hooks/useTokenBalances";
import { useVaultStats } from "@/hooks/useVaultStats";
import { useLPPoolStats } from "@/hooks/useLPPoolStats";

export default function Home() {
  const [account, setAccount] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const {
    usdc,
    yusdc,
    isLoading: balancesLoading,
    error: balancesError,
  } = useTokenBalances(account);
  const {
    totalAssets,
    totalShares,
    sharePrice,
    assetsPerShare,
    isLoading: vaultLoading,
    error: vaultError,
  } = useVaultStats();

  const {
    lpPrice,
    liquidity,
    lastTxFee, // Last trade fee (NEW)
    lastTxHash, // Transaction link (NEW)
    lastTxTimestamp, // When it happened (NEW)
    spread,
    isLoading: lpLoading,
    error: lpError,
  } = useLPPoolStats(sharePrice, account);

  const handleTransactionSuccess = () => {
    // Trigger a refresh of balances
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-5xl font-bold text-slate-800 mb-2">
            PegBalancerHook Uniswap V4
          </h1>
          <p className="text-lg text-slate-600">
            Interactive Dashboard - Buy, Mint & Redeem Tokens
          </p>
        </div>

        {/* Wallet Connect */}
        <div className="mb-8">
          <WalletConnect onAccountChange={setAccount} />
        </div>

        {/* Top Section - Stats */}
        <div className="mb-8" key={refreshKey}>
          {/* User Balance - Full Width */}
          <div className="mb-6">
            <UserBalance
              usdcBalance={usdc}
              yusdcBalance={yusdc}
              isLoading={balancesLoading}
              error={balancesError}
            />
          </div>

          {/* SCENARIOS PREVIEW - Links to /scenarios page */}
          <div className="mb-6">
            <ScenariosPreview />
          </div>

          {/* LP and Vault Stats - Side by Side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <LPPoolStats
              lpPrice={lpPrice}
              liquidity={liquidity}
              spread={spread}
              lastTxFee={lastTxFee} // NEW
              lastTxHash={lastTxHash} // NEW
              lastTxTimestamp={lastTxTimestamp} // NEW
              isLoading={lpLoading}
              error={lpError}
            />
            <VaultStats
              totalAssets={totalAssets}
              totalShares={totalShares}
              sharePrice={sharePrice}
              assetsPerShare={assetsPerShare}
              isLoading={vaultLoading}
              error={vaultError}
            />
          </div>
        </div>

        {/* Bottom Section - Action Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <BuyTokenCard
            account={account}
            lpPrice={lpPrice}
            onSuccess={handleTransactionSuccess}
          />
          <MintTokenCard
            account={account}
            navPrice={sharePrice}
            onSuccess={handleTransactionSuccess}
          />
          <RedeemTokenCard
            account={account}
            navPrice={sharePrice}
            onSuccess={handleTransactionSuccess}
          />
        </div>

        {/* Footer Info */}
        <div className="mt-8 bg-white rounded-xl shadow-lg p-6">
          <h3 className="text-xl font-bold text-slate-800 mb-4">
            How It Works
          </h3>
          <div className="grid md:grid-cols-3 gap-6 text-sm text-slate-700">
            <div>
              <h4 className="font-bold text-blue-600 mb-2">💱 Buy on LP</h4>
              <p>
                Trade at current market price with dynamic fees. When LP price
                deviates from NAV beyond the deadzone, fees adjust to encourage
                price convergence.
              </p>
            </div>
            <div>
              <h4 className="font-bold text-green-600 mb-2">
                🏦 Mint from Vault
              </h4>
              <p>
                Create new tokens at NAV price with zero fees. This provides
                guaranteed fair entry when LP price is at a premium.
              </p>
            </div>
            <div>
              <h4 className="font-bold text-orange-600 mb-2">
                💰 Redeem to Vault
              </h4>
              <p>
                Burn tokens to receive cash at NAV price with zero fees. This
                provides guaranteed fair exit when LP price is at a discount.
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
