import fs from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// File to store balance history
const BALANCE_LOG_FILE = join(__dirname, "balance_log.json");

/**
 * Initialize balance log file if it doesn't exist
 */
async function initBalanceLog() {
  try {
    await fs.access(BALANCE_LOG_FILE);
  } catch {
    const initialData = {
      startTime: new Date().toISOString(),
      startingBalance: null,
      currentBalance: null,
      totalTrades: 0,
      balanceHistory: [],
    };
    await fs.writeFile(BALANCE_LOG_FILE, JSON.stringify(initialData, null, 2));
  }
}

/**
 * Load balance log from file
 */
async function loadBalanceLog() {
  await initBalanceLog();
  const data = await fs.readFile(BALANCE_LOG_FILE, "utf-8");
  return JSON.parse(data);
}

/**
 * Save balance log to file
 */
async function saveBalanceLog(logData) {
  // Custom replacer to handle BigInt
  const replacer = (key, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };

  await fs.writeFile(BALANCE_LOG_FILE, JSON.stringify(logData, replacer, 2));
}

/**
 * Log balance after a trade
 * @param {Object} balanceData - Balance information
 * @param {number} balanceData.balUSDC - USDC balance
 * @param {number} balanceData.balYUSDC - yUSDC balance
 * @param {number} balanceData.sharePrice - Share price (NAV)
 * @param {number} balanceData.totalBal - Total value in USDC
 * @param {string} balanceData.txHash - Transaction hash (optional)
 * @param {string} balanceData.direction - Trade direction (optional)
 */
export async function logBalance(balanceData) {
  const log = await loadBalanceLog();

  // Convert all values to plain numbers (in case BigInt or other types are passed)
  const balUSDC = Number(balanceData.balUSDC);
  const balYUSDC = Number(balanceData.balYUSDC);
  const sharePrice = Number(balanceData.sharePrice);
  const totalBal = Number(balanceData.totalBal);

  const entry = {
    timestamp: new Date().toISOString(),
    balUSDC: balUSDC,
    balYUSDC: balYUSDC,
    sharePrice: sharePrice,
    totalValueUSDC: totalBal,
    txHash: balanceData.txHash || null,
    direction: balanceData.direction || null,
    // ADD THESE LINES:
    swapRawFee: balanceData.swapRawFee || null,
    swapFeePercent: balanceData.swapFeePercent || null,
    swapFeeWithFlag: balanceData.swapFeeWithFlag || null,
    swapToward:
      balanceData.swapToward !== undefined ? balanceData.swapToward : null,
    swapDevBps: balanceData.swapDevBps || null,
  };

  // Set starting balance if this is the first entry
  if (log.startingBalance === null) {
    log.startingBalance = totalBal;
    console.log(`\n📊 Starting Balance: $${totalBal.toFixed(6)}`);
  }

  // Calculate change from previous balance
  if (log.balanceHistory.length > 0) {
    const prevBalance =
      log.balanceHistory[log.balanceHistory.length - 1].totalValueUSDC;
    const change = totalBal - prevBalance;
    const changePercent = (change / prevBalance) * 100;

    entry.changeFromPrev = change;
    entry.changePercentFromPrev = changePercent;

    console.log(
      `\n💰 Balance Change: ${change >= 0 ? "+" : ""}$${change.toFixed(6)} (${
        changePercent >= 0 ? "+" : ""
      }${changePercent.toFixed(4)}%)`
    );
  }

  // Calculate total profit from start
  const totalProfit = totalBal - log.startingBalance;
  const totalProfitPercent = (totalProfit / log.startingBalance) * 100;

  entry.totalProfit = totalProfit;
  entry.totalProfitPercent = totalProfitPercent;

  log.balanceHistory.push(entry);
  log.currentBalance = totalBal;
  log.totalTrades += 1;

  await saveBalanceLog(log);

  console.log(
    `📈 Total Profit: ${totalProfit >= 0 ? "+" : ""}$${totalProfit.toFixed(
      6
    )} (${totalProfitPercent >= 0 ? "+" : ""}${totalProfitPercent.toFixed(4)}%)`
  );
  console.log(`💼 Total Value: $${totalBal.toFixed(6)}`);
  console.log(`   USDC:  ${balUSDC.toFixed(6)}`);
  console.log(`   yUSDC: ${balYUSDC.toFixed(6)} @ $${sharePrice.toFixed(6)}`);
  if (entry.txHash) {
    console.log(`   TX: ${entry.txHash}`);
  }

  return entry;
}

/**
 * Get summary statistics
 */
export async function getBalanceSummary() {
  const log = await loadBalanceLog();

  if (log.balanceHistory.length === 0) {
    return {
      hasData: false,
      message: "No balance history yet",
    };
  }

  const startBalance = log.startingBalance;
  const currentBalance = log.currentBalance;
  const totalProfit = currentBalance - startBalance;
  const totalProfitPercent = (totalProfit / startBalance) * 100;

  // Calculate max drawdown
  let maxBalance = startBalance;
  let maxDrawdown = 0;

  for (const entry of log.balanceHistory) {
    if (entry.totalValueUSDC > maxBalance) {
      maxBalance = entry.totalValueUSDC;
    }
    const drawdown = ((maxBalance - entry.totalValueUSDC) / maxBalance) * 100;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  // Calculate average profit per trade
  const avgProfitPerTrade = totalProfit / log.totalTrades;

  // Get winning vs losing trades
  const tradesWithChange = log.balanceHistory.filter(
    (e) => e.changeFromPrev !== undefined
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

  return {
    hasData: true,
    startTime: log.startTime,
    lastUpdateTime: log.balanceHistory[log.balanceHistory.length - 1].timestamp,
    startBalance,
    currentBalance,
    totalProfit,
    totalProfitPercent,
    totalTrades: log.totalTrades,
    avgProfitPerTrade,
    maxDrawdown,
    winningTrades,
    losingTrades,
    winRate,
  };
}

/**
 * Display balance summary
 */
export async function displayBalanceSummary() {
  const summary = await getBalanceSummary();

  console.log("\n" + "=".repeat(80));
  console.log("💼 PORTFOLIO SUMMARY");
  console.log("=".repeat(80));

  if (!summary.hasData) {
    console.log(summary.message);
    console.log("=".repeat(80) + "\n");
    return;
  }

  const startDate = new Date(summary.startTime);
  const endDate = new Date(summary.lastUpdateTime);
  const daysRunning = Math.max(
    1,
    (endDate - startDate) / (1000 * 60 * 60 * 24)
  );

  console.log(`Started: ${startDate.toLocaleString()}`);
  console.log(`Last Update: ${endDate.toLocaleString()}`);
  console.log(`Days Running: ${daysRunning.toFixed(2)}`);

  console.log(`\n💰 PERFORMANCE`);
  console.log(`Starting Balance: $${summary.startBalance.toFixed(6)}`);
  console.log(`Current Balance:  $${summary.currentBalance.toFixed(6)}`);
  console.log(
    `Total Profit:     ${
      summary.totalProfit >= 0 ? "+" : ""
    }$${summary.totalProfit.toFixed(6)} (${
      summary.totalProfitPercent >= 0 ? "+" : ""
    }${summary.totalProfitPercent.toFixed(4)}%)`
  );

  console.log(`\n📊 STATISTICS`);
  console.log(`Total Trades: ${summary.totalTrades}`);
  console.log(`Winning Trades: ${summary.winningTrades}`);
  console.log(`Losing Trades: ${summary.losingTrades}`);
  console.log(`Win Rate: ${summary.winRate.toFixed(2)}%`);
  console.log(
    `Avg Profit/Trade: ${
      summary.avgProfitPerTrade >= 0 ? "+" : ""
    }$${summary.avgProfitPerTrade.toFixed(6)}`
  );
  console.log(`Max Drawdown: ${summary.maxDrawdown.toFixed(4)}%`);
  console.log(
    `Daily Profit: $${(summary.totalProfit / daysRunning).toFixed(6)}/day`
  );

  console.log("=".repeat(80) + "\n");
}

/**
 * Get recent balance history
 */
export async function getRecentBalances(count = 10) {
  const log = await loadBalanceLog();
  return log.balanceHistory.slice(-count).reverse();
}

/**
 * Display recent balance history
 */
export async function displayRecentBalances(count = 10) {
  const balances = await getRecentBalances(count);

  console.log("\n" + "=".repeat(80));
  console.log(
    `📊 RECENT BALANCE HISTORY (Last ${Math.min(count, balances.length)})`
  );
  console.log("=".repeat(80));

  if (balances.length === 0) {
    console.log("No balance history yet.");
  } else {
    balances.forEach((balance, idx) => {
      const change = balance.changeFromPrev;
      const emoji = change === undefined ? "📌" : change >= 0 ? "✅" : "❌";

      console.log(`\n${emoji} Entry #${balances.length - idx}`);
      console.log(`   Time: ${new Date(balance.timestamp).toLocaleString()}`);
      console.log(`   Total Value: $${balance.totalValueUSDC.toFixed(6)}`);
      console.log(`   USDC: ${balance.balUSDC.toFixed(6)}`);
      console.log(
        `   yUSDC: ${balance.balYUSDC.toFixed(
          6
        )} @ $${balance.sharePrice.toFixed(6)}`
      );

      if (change !== undefined) {
        console.log(
          `   Change: ${change >= 0 ? "+" : ""}$${change.toFixed(6)} (${
            balance.changePercentFromPrev >= 0 ? "+" : ""
          }${balance.changePercentFromPrev.toFixed(4)}%)`
        );
      }

      if (balance.totalProfit !== undefined) {
        console.log(
          `   Total Profit: ${
            balance.totalProfit >= 0 ? "+" : ""
          }$${balance.totalProfit.toFixed(6)} (${
            balance.totalProfitPercent >= 0 ? "+" : ""
          }${balance.totalProfitPercent.toFixed(4)}%)`
        );
      }

      if (balance.direction) {
        console.log(`   Direction: ${balance.direction}`);
      }

      if (balance.txHash) {
        console.log(`   TX: ${balance.txHash}`);
      }
    });
  }

  console.log("\n" + "=".repeat(80) + "\n");
}

/**
 * Export balance history to CSV
 */
export async function exportToCSV(filename = "balance_history.csv") {
  const log = await loadBalanceLog();

  if (log.balanceHistory.length === 0) {
    console.log("No data to export");
    return;
  }

  const headers = [
    "Timestamp",
    "USDC Balance",
    "yUSDC Balance",
    "Share Price",
    "Total Value USD",
    "Change From Prev",
    "Change %",
    "Total Profit",
    "Total Profit %",
    "Direction",
    "TX Hash",
  ].join(",");

  const rows = log.balanceHistory.map((entry) =>
    [
      entry.timestamp,
      entry.balUSDC,
      entry.balYUSDC,
      entry.sharePrice,
      entry.totalValueUSDC,
      entry.changeFromPrev || "",
      entry.changePercentFromPrev || "",
      entry.totalProfit || "",
      entry.totalProfitPercent || "",
      entry.direction || "",
      entry.txHash || "",
    ].join(",")
  );

  const csv = [headers, ...rows].join("\n");

  const filepath = join(__dirname, filename);
  await fs.writeFile(filepath, csv);

  console.log(
    `✅ Exported ${log.balanceHistory.length} entries to ${filepath}`
  );
}

/**
 * Reset balance log (use with caution!)
 */
export async function resetBalanceLog() {
  const initialData = {
    startTime: new Date().toISOString(),
    startingBalance: null,
    currentBalance: null,
    totalTrades: 0,
    balanceHistory: [],
  };
  await saveBalanceLog(initialData);
  console.log("✅ Balance log has been reset.");
}
