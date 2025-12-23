import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const BALANCE_LOG_FILE = path.join(
  process.cwd(),
  "backend",
  "balance_log.json"
);

export async function GET() {
  try {
    // Check if file exists
    if (!fs.existsSync(BALANCE_LOG_FILE)) {
      return NextResponse.json({
        success: true,
        hasData: false,
        message:
          "No trading data yet. Start the ArbExecutor to begin tracking.",
        totalProfit: 0,
        totalProfitPercent: 0,
        currentBalance: 0,
        startingBalance: 0,
        totalTrades: 0,
        recentTrades: [],
      });
    }

    // Read the balance log
    const data = fs.readFileSync(BALANCE_LOG_FILE, "utf-8");
    const log = JSON.parse(data);

    if (!log.balanceHistory || log.balanceHistory.length === 0) {
      return NextResponse.json({
        success: true,
        hasData: false,
        message: "No trading history yet",
        totalProfit: 0,
        totalProfitPercent: 0,
        currentBalance: 0,
        startingBalance: 0,
        totalTrades: 0,
        recentTrades: [],
      });
    }

    // Get the most recent entry for current total profit
    const latestEntry = log.balanceHistory[log.balanceHistory.length - 1];

    const startBalance = log.startingBalance || 0;
    const currentBalance =
      latestEntry.totalValueUSDC || log.currentBalance || 0;
    const totalProfit = latestEntry.totalProfit || 0;
    const totalProfitPercent = latestEntry.totalProfitPercent || 0;

    // Get arbitrage trades only (exclude SWAP_DETECTED)
    const arbTrades = log.balanceHistory.filter(
      (entry) =>
        entry.txHash &&
        entry.direction &&
        entry.direction !== "SWAP_DETECTED" &&
        entry.changeFromPrev !== undefined
    );

    // Get recent arbitrage trades (last 10)
    const recentTrades = arbTrades
      .slice(-10)
      .reverse()
      .map((trade) => ({
        timestamp: trade.timestamp,
        txHash: trade.txHash,
        direction: trade.direction,
        profit: trade.changeFromPrev || 0,
        profitPercent: trade.changePercentFromPrev || 0,
        totalValue: trade.totalValueUSDC,
        totalProfit: trade.totalProfit || 0,
        totalProfitPercent: trade.totalProfitPercent || 0,
      }));

    // Calculate time-based stats
    const startTime = new Date(log.startTime);
    const lastUpdateTime = new Date(latestEntry.timestamp);
    const hoursRunning = Math.max(
      0.01,
      (lastUpdateTime - startTime) / (1000 * 60 * 60)
    );
    const profitPerHour = totalProfit / hoursRunning;

    // Win rate calculation
    const tradesWithChange = arbTrades.filter(
      (e) => e.changeFromPrev !== undefined && e.changeFromPrev !== null
    );
    const winningTrades = tradesWithChange.filter(
      (e) => e.changeFromPrev > 0
    ).length;
    const losingTrades = tradesWithChange.filter(
      (e) => e.changeFromPrev < 0
    ).length;
    const winRate =
      tradesWithChange.length > 0
        ? (winningTrades / tradesWithChange.length) * 100
        : 0;

    const avgProfitPerTrade =
      arbTrades.length > 0 ? totalProfit / arbTrades.length : 0;

    return NextResponse.json({
      success: true,
      hasData: true,
      startTime: log.startTime,
      lastUpdateTime: lastUpdateTime.toISOString(),
      hoursRunning: hoursRunning.toFixed(2),
      startBalance,
      currentBalance,
      totalProfit,
      totalProfitPercent,
      totalTrades: log.totalTrades || 0,
      arbTradeCount: arbTrades.length,
      winningTrades,
      losingTrades,
      winRate,
      avgProfitPerTrade,
      profitPerHour,
      recentTrades,
    });
  } catch (error: any) {
    console.error("Error reading profit data:", error);
    return NextResponse.json(
      {
        success: false,
        message: error.message,
        hasData: false,
        totalProfit: 0,
        totalProfitPercent: 0,
      },
      { status: 500 }
    );
  }
}
