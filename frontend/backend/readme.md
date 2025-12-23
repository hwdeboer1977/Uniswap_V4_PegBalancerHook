# PegBalanceHook Arbitrage Bot Backend

Automated arbitrage bot that monitors price deviations between a Uniswap V4 liquidity pool and an ERC-4626 vault, executing profitable trades to maintain price peg.

## 🎯 Overview

This backend system continuously monitors price differences between:

- **LP Pool Price**: Uniswap V4 pool with dynamic fee hook
- **Vault NAV**: ERC-4626 yield-bearing vault share price

When the deviation exceeds a threshold, the bot automatically executes arbitrage trades to restore the peg and capture profit.

## 🏗️ Architecture

```
┌─────────────┐
│  server.js  │  ← Main orchestrator
└──────┬──────┘
       │
       ├──► WebSocket listeners (swap events + block updates)
       │
       ├──► check_pool.js          (fetch pool state)
       │
       ├──► check_optimal_amounts.js (calculate trade size)
       │
       ├──► call_arb_contract.js   (execute arbitrage)
       │
       └──► simple_balance_logger.js (track P&L)
```

## 📁 File Structure

### 1. `server.js` - Main Bot Controller

**Purpose:** Orchestrates the entire arbitrage workflow

**Key Features:**

- WebSocket connection to Arbitrum Sepolia
- Event listener for pool swaps (`FeeChosen` event)
- Block listener for vault NAV changes
- Automatic arbitrage execution when profitable
- Balance tracking and logging

**Flow:**

```javascript
1. Connect to blockchain via WebSocket
2. Listen for events:
   ├─ FeeChosen (swap in pool) → Check arbitrage
   └─ New blocks → Check vault NAV changes
3. When opportunity detected:
   ├─ Get pool state
   ├─ Calculate optimal amounts
   ├─ Execute arbitrage
   └─ Log results
```

### 2. `check_pool.js` - Pool State Reader

**Purpose:** Fetches current state of the Uniswap V4 pool

**Returns:**

```javascript
{
  sqrtPriceX96: BigInt,    // Current pool price (Q64.96 format)
  tick: number,            // Current tick
  liquidity: BigInt,       // Available liquidity
  fee: number,             // Current fee tier
  token0: {
    address: string,
    symbol: string,
    decimals: number
  },
  token1: {
    address: string,
    symbol: string,
    decimals: number
  }
}
```

**Usage:**

```javascript
import { checkPool } from "./check_pool.js";
const poolData = await checkPool();
```

### 3. `check_optimal_amounts.js` - Trade Calculator

**Purpose:** Calculates optimal trade size and direction to maximize profit

**Algorithm:**

1. Compare LP price vs Vault NAV
2. Determine direction (zeroForOne or oneForZero)
3. Calculate swap amounts considering:
   - Available liquidity
   - Price impact
   - Slippage
   - Gas costs
4. Return trade parameters

**Returns:**

```javascript
{
  direction: "zeroForOne" | "oneForZero",
  amount0_in: BigInt,   // Token0 input amount
  amount1_in: BigInt,   // Token1 input amount
  amount0_out: BigInt,  // Token0 output amount
  amount1_out: BigInt,  // Token1 output amount
  expectedProfit: BigInt
}
```

**Trade Directions:**

- **zeroForOne**: LP price > Vault NAV → Mint in vault, sell in pool (`arbMintThenSell`)
- **oneForZero**: LP price < Vault NAV → Buy in pool, redeem in vault (`arbBuyAndQueue`)

### 4. `call_arb_contract.js` - Arbitrage Executor

**Purpose:** Executes arbitrage trades via ArbExecutor smart contract

**Functions:**

#### `arbMintThenSell()`

When LP price is **above** vault NAV:

1. Mint yToken shares in vault (using USDC)
2. Sell yToken in pool for USDC
3. Profit = USDC received - USDC spent

#### `arbBuyAndQueue()`

When LP price is **below** vault NAV:

1. Buy yToken from pool (using USDC)
2. Queue withdrawal in vault
3. Complete withdrawal (after delay or immediate if `REDEMPTION_DELAY = 0`)
4. Profit = USDC received - USDC spent

**Features:**

- Pre-execution checks (balance, allowances, pool key)
- Gas estimation with 20% buffer
- Slippage protection (1% default)
- Automatic redemption completion
- Transaction monitoring and error handling

**Configuration:**

```javascript
const REDEMPTION_DELAY = 0; // Set to 0 for immediate completion
// const REDEMPTION_DELAY = 7 * 24 * 60 * 60; // 7 days for production
```

### 5. `simple_balance_logger.js` - Profit Tracker

**Purpose:** Logs all trades and tracks cumulative profit

**Features:**

- Records every balance snapshot
- Calculates per-trade profit/loss
- Tracks cumulative P&L
- Stores swap event metadata (fees, direction, tx hashes)
- Monthly log rotation

**Log Entry:**

```javascript
{
  timestamp: "2025-10-29T11:02:31Z",
  balUSDC: 7961.129458,
  balYUSDC: 40073.018017,
  sharePrice: 1.0,
  totalValueUSDC: 48034.147475,
  txHash: "0x...",
  direction: "VAULT_TO_LP",
  changeFromPrev: 4.224270,
  changePercentFromPrev: 0.008796,
  totalProfit: 16.897076,
  totalProfitPercent: 0.035190,
  swapRawFee: 500,
  swapFeePercent: 0.0005,
  swapToward: true
}
```

**Functions:**

```javascript
await logBalance(balanceData); // Log new entry
await displayBalanceSummary(); // Show stats
await getRecentBalances(10); // Get last N entries
await exportToCSV("history.csv"); // Export to CSV
```

## 🚀 Setup

### Prerequisites

```bash
node >= 18.0.0
npm or yarn
```

### Environment Variables

Create `.env` or `.env.local` in the root directory:

```bash
# RPC URLs
NEXT_PUBLIC_ALCHEMY_API_KEY_FULL=https://arb-sepolia.g.alchemy.com/v2/YOUR_KEY
NEXT_PUBLIC_ALCHEMY_API_WSS_KEY_FULL=wss://arb-sepolia.g.alchemy.com/v2/YOUR_KEY

# Private Key (for signing transactions)
NEXT_PUBLIC_PRIVATE_KEY=0x...

# Contract Addresses
NEXT_PUBLIC_ARB_EXECUTOR=0x...
NEXT_PUBLIC_VAULT_ADDRESS=0x...
NEXT_PUBLIC_HOOK_ADDR=0x...
NEXT_PUBLIC_USDC_ADDRESS=0x...
NEXT_PUBLIC_YUSDC_ADDRESS=0x...

# Configuration
NEXT_PUBLIC_DECIMALS0=6
NEXT_PUBLIC_DECIMALS1=6
NEXT_PUBLIC_POOL_TICK_SPACING=60

# Bot Settings
ARB_TRIGGER_BPS=500  # 5% deviation triggers arbitrage (500 basis points)
```

### Installation

```bash
cd backend
npm install
```

### Dependencies

```json
{
  "ethers": "^6.x",
  "dotenv": "^16.x"
}
```

## 🎮 Usage

### Start the Bot

```bash
node server.js
```

### Expected Output

```
🚀 Starting arbitrage bot...
✅ Connected to WebSocket
Pool Key: { currency0: '0x...', currency1: '0x...', ... }

📊 Starting balances logged

👂 Listening for swaps + vault NAV changes...

================================================================================
🎯 SWAP DETECTED IN POOL
================================================================================
Block: 209658984
TX Hash: 0x...
Raw Fee: 500 (0.0005%)
Fee with Flag: 4194804
Toward: true
Dev BPS: 2521
================================================================================

📊 Logging balances...

🔍 checkAndExecuteArbitrage called
Price LP raw:  998762345678901234
Price NAV:     1000000000000000000
Deviation: 0.12%
❌ No arbitrage opportunity

[... waits for next opportunity ...]

================================================================================
🎯 SWAP DETECTED IN POOL
================================================================================
[...]
✅ Arbitrage opportunity detected!
Direction: LP_TO_VAULT

[Executes trade]

💰 ARBITRAGE EXECUTED!
   Arb TX: 0x...
   Profit: +4.224270 USDC
```

## 🔧 Configuration

### Arbitrage Threshold

Adjust sensitivity in `.env`:

```bash
ARB_TRIGGER_BPS=500   # 5% = 500 basis points
ARB_TRIGGER_BPS=100   # 1% = 100 basis points (more sensitive)
ARB_TRIGGER_BPS=1000  # 10% = 1000 basis points (less sensitive)
```

### Redemption Delay

In `call_arb_contract.js`:

```javascript
// Testing: Immediate completion
const REDEMPTION_DELAY = 0;

// Production: Wait for vault's redemption period
const REDEMPTION_DELAY = 7 * 24 * 60 * 60; // 7 days
```

### Monitoring Method

Choose between:

**Option 1: Events Only (Efficient)**

```javascript
// In server.js - keep only FeeChosen listener
hook.on("FeeChosen", async (rawFee, withFlag, toward, devBps, event) => {
  await checkAndExecuteArbitrage(event, feeData);
});
```

**Option 2: Events + Block Polling (Comprehensive)**

```javascript
// Add block listener (catches vault NAV changes)
provider.on("block", async (blockNumber) => {
  console.log(`📦 Block ${blockNumber}`);
  await checkAndExecuteArbitrage();
});
```

## 📊 Monitoring & Analytics

### View Recent Trades

```javascript
import { displayRecentBalances } from "./simple_balance_logger.js";
await displayRecentBalances(20); // Last 20 trades
```

### View Performance Summary

```javascript
import { displayBalanceSummary } from "./simple_balance_logger.js";
await displayBalanceSummary(); // Current month stats
```

### Export Data

```javascript
import { exportToCSV } from "./simple_balance_logger.js";
await exportToCSV("trades.csv"); // Export all trades
```

### Log Files

```
backend/
├── balance_log.json              # Current log (auto-rotates monthly)
├── balance_log_2025-10.json     # October 2025 archive
├── balance_log_2025-11.json     # November 2025 archive
└── ...
```

## 🎯 How Arbitrage Works

### Scenario 1: LP Price > Vault NAV

**Example:** LP = $1.05, Vault = $1.00

```
1. Mint 100 USDC → 100 yToken in vault
2. Sell 100 yToken → 105 USDC in pool
3. Profit: 5 USDC (5% gain)
```

**Contract Call:** `arbMintThenSell()`

### Scenario 2: LP Price < Vault NAV

**Example:** LP = $0.95, Vault = $1.00

```
1. Buy 100 yToken with 95 USDC from pool
2. Queue 100 yToken for redemption
3. Complete redemption → 100 USDC from vault
4. Profit: 5 USDC (5.26% gain)
```

**Contract Calls:** `arbBuyAndQueue()` → `completeQueuedRedeem()`

### Fee Advantage

The dynamic fee hook **rewards peg-restoring trades**:

- **Toward peg:** 0.05% fee (lower)
- **Away from peg:** 0.30% fee (higher)

Since arbitrage always moves toward peg, the bot **always pays the lower fee**! 🎯

## 🛡️ Safety Features

### Pre-Trade Checks

1. ✅ Owner verification
2. ✅ Contract not paused
3. ✅ Sufficient balance
4. ✅ Proper allowances
5. ✅ Pool key validation
6. ✅ Deviation threshold met

### Transaction Protection

- Slippage protection (1% tolerance)
- Deadline enforcement (50 min)
- Gas estimation with buffer
- Error handling and retry logic

### Balance Tracking

- Every trade logged with full details
- Automatic profit/loss calculation
- Transaction hash tracking
- Swap event metadata captured

## 🐛 Troubleshooting

### Bot not detecting opportunities

**Check:**

```bash
# Verify WebSocket connection
echo "Check for '✅ Connected to WebSocket' message"

# Verify threshold
echo "ARB_TRIGGER_BPS might be too high"

# Check pool activity
echo "Need swaps to create opportunities"
```

### Transaction failures

**Common issues:**

- Insufficient gas
- Price moved (increase slippage tolerance)
- Contract paused
- Insufficient balance in ArbExecutor

**Solution:**

```javascript
// Increase gas buffer in call_arb_contract.js
gasLimit: (gasEstimate * 150n) / 100n; // 50% buffer instead of 20%
```

### Balance not logging

**Check:**

```javascript
// Ensure arbData returns success
if (arbData && arbData.success) {
  await logBalance(...);
}
```

## 📈 Performance Metrics

From `balance_log.json`:

- **Total Trades:** Number of arbitrage executions
- **Win Rate:** Percentage of profitable trades
- **Average Profit:** Mean profit per trade
- **Total Profit:** Cumulative profit (absolute & percentage)
- **Daily Profit:** Average profit per day

## 🔐 Security Notes

⚠️ **IMPORTANT:**

- Never commit `.env` files with private keys
- Use a dedicated wallet for the bot
- Start with small amounts for testing
- Monitor gas costs vs profit
- Set reasonable balance limits in ArbExecutor

## 📝 License

MIT

## 🤝 Contributing

Contributions welcome! Please:

1. Fork the repo
2. Create a feature branch
3. Test thoroughly
4. Submit a pull request

## 📧 Support

For issues or questions, please open an issue on GitHub.

---

**Built with ❤️ for automated DeFi arbitrage**
