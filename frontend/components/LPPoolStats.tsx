"use client";

import { useState, useEffect } from "react";

interface LPPoolStatsProps {
  lpPrice: string;
  liquidity: string;
  spread: string;
  lastTxFee: string | null;
  lastTxHash: string | null;
  lastTxTimestamp: number | null;
  isLoading: boolean;
  error: string | null;
}

interface ProfitData {
  hasData: boolean;
  totalProfit: number;
  totalProfitPercent: number;
  arbTradeCount: number;
  recentTrades?: Array<{
    profit: number; // Changed from changeFromPrev
    profitPercent: number;
    timestamp: string;
    txHash: string;
    direction: string;
  }>;
}

export default function LPPoolStats({
  lpPrice,
  liquidity,
  spread,
  lastTxFee,
  lastTxHash,
  lastTxTimestamp,
  isLoading,
  error,
}: LPPoolStatsProps) {
  // ArbExecutor toggle
  const [arbExecutorActive, setArbExecutorActive] = useState(true);
  const [isToggling, setIsToggling] = useState(false);
  const [profitData, setProfitData] = useState<ProfitData | null>(null);

  // Calculate time ago for last transaction
  const timeAgo = lastTxTimestamp
    ? `${Math.floor((Date.now() / 1000 - lastTxTimestamp) / 60)}m ago`
    : "";

  // Get last trade profit - skip entries with 0 or undefined change
  const lastTradeProfit =
    profitData?.recentTrades?.find(
      (trade) => trade.profit !== undefined && trade.profit !== 0
    )?.profit || 0;

  // Handle toggle
  const handleToggle = async () => {
    setIsToggling(true);

    try {
      const response = await fetch("/api/arbexecutor/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !arbExecutorActive }),
      });

      const data = await response.json();

      if (data.success) {
        setArbExecutorActive(!arbExecutorActive);
        console.log("✅ ArbExecutor toggled:", data.message);
      } else {
        throw new Error(data.message);
      }
    } catch (err: any) {
      console.error("Failed to toggle ArbExecutor:", err);
      alert(`Failed to toggle ArbExecutor: ${err.message}`);
    } finally {
      setIsToggling(false);
    }
  };

  // Fetch ArbExecutor status
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await fetch("/api/arbexecutor/toggle");
        const data = await response.json();
        setArbExecutorActive(data.active);
      } catch (err) {
        console.error("Failed to fetch ArbExecutor status:", err);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  // Fetch profit data
  useEffect(() => {
    const fetchProfits = async () => {
      try {
        const response = await fetch("/api/arbexecutor/profits");
        const data = await response.json();
        if (data.success) {
          setProfitData(data);
        }
      } catch (err) {
        console.error("Failed to fetch profits:", err);
      }
    };

    fetchProfits();
    const interval = setInterval(fetchProfits, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 border-2 border-blue-100">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <span className="text-3xl">💱</span>
          Liquidity Pool Stats
        </h2>

        {/* ArbExecutor Toggle */}
        <div className="flex items-center gap-3 bg-slate-50 px-4 py-2 rounded-lg border border-slate-200">
          <div className="text-right">
            <div className="text-sm font-semibold text-slate-700">
              🤖 ArbExecutor
            </div>
            <div
              className={`text-xs ${
                arbExecutorActive ? "text-green-600" : "text-red-600"
              }`}
            >
              {arbExecutorActive ? "✅ Active" : "❌ Inactive"}
            </div>
          </div>

          <button
            onClick={handleToggle}
            disabled={isToggling}
            className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
              arbExecutorActive ? "bg-green-500" : "bg-red-400"
            } ${isToggling ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <span
              className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                arbExecutorActive ? "translate-x-7" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Status Banner */}
      {!arbExecutorActive && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-300 rounded-lg">
          <div className="flex items-center gap-2">
            <span className="text-amber-700 text-sm font-medium">
              ⚠️ ArbExecutor is paused. Arbitrage opportunities will not be
              captured automatically.
            </span>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
          <span className="text-slate-600 font-medium">LP Price</span>
          {isLoading ? (
            <span className="text-xl font-bold text-blue-400">Loading...</span>
          ) : (
            <span className="text-2xl font-bold text-blue-700">${lpPrice}</span>
          )}
        </div>

        <div className="flex justify-between items-center p-3 bg-slate-50 rounded-lg">
          <span className="text-slate-600 font-medium">Total Liquidity</span>
          {isLoading ? (
            <span className="text-xl font-bold text-slate-400">Loading...</span>
          ) : (
            <span className="text-2xl font-bold text-slate-700">
              ${liquidity}
            </span>
          )}
        </div>

        {/* LAST TRANSACTION FEE */}
        {lastTxFee && (
          <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg border-2 border-blue-200">
            <div>
              <span className="text-slate-600 font-medium">Last Trade Fee</span>
              <p className="text-xs text-slate-500 mt-0.5">
                Fee you paid {timeAgo}
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-blue-700">
                {lastTxFee}%
              </div>
              {lastTxHash && (
                <a
                  href={`https://sepolia.arbiscan.io/tx/${lastTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                >
                  View tx ↗
                </a>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-between items-center p-3 bg-purple-50 rounded-lg">
          <span className="text-slate-600 font-medium">Spread (LP vs NAV)</span>
          {isLoading ? (
            <span className="text-xl font-bold text-purple-400">
              Loading...
            </span>
          ) : (
            <span className="text-2xl font-bold text-purple-700">
              {parseFloat(spread) > 0 ? "+" : ""}
              {spread}%
            </span>
          )}
        </div>

        {/* PROFIT DATA */}
        {profitData?.hasData && (
          <>
            <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg border-2 border-green-200">
              <span className="text-slate-600 font-medium">Total Profit</span>
              <div className="text-right">
                <div
                  className={`text-2xl font-bold ${
                    profitData.totalProfit >= 0
                      ? "text-green-700"
                      : "text-red-700"
                  }`}
                >
                  {profitData.totalProfit >= 0 ? "+" : ""}$
                  {profitData.totalProfit.toFixed(6)}
                </div>
                <div className="text-sm text-green-600">
                  ({profitData.totalProfitPercent >= 0 ? "+" : ""}
                  {profitData.totalProfitPercent.toFixed(4)}%)
                </div>
              </div>
            </div>

            <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
              <span className="text-slate-600 font-medium">
                Profit Last Trade
              </span>
              <div
                className={`text-2xl font-bold ${
                  lastTradeProfit >= 0 ? "text-green-700" : "text-red-700"
                }`}
              >
                {lastTradeProfit >= 0 ? "+" : ""}${lastTradeProfit.toFixed(6)}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="mt-2 text-xs text-slate-500 text-center">
        Auto-refreshes every 10 seconds
      </div>
    </div>
  );
}
