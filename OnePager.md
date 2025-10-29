# PegBalancerHook (ERC-4626 × Uniswap V4)

> A next-generation DeFi protocol combining yield generation with on-chain liquidity.  
> Built on an enhanced **ERC-4626 vault**, a **Uniswap V4 pool with a dynamic-fee hook**, and an **on-chain arbitrage executor**.
> Increases yield for DeFi protocols, as higher dynamic fees and arbitrage profits flow back into the ecosystem!
---

## 🧩 Overview

Traditional ERC-4626 vaults issue yield tokens (e.g., **yBTC**) representing deposits in a yield-generating strategy.  
However, these tokens are often **illiquid** due to **redemption periods** (24–48 h or more), leaving users locked during market volatility.

This protocol introduces a **liquid secondary market** for vault shares through **Uniswap V4** — enabling users to instantly trade yield tokens while keeping the vault’s internal redemption model intact.

---

## ⚙️ Architecture

### 1. ERC-4626 Vault (Yield Layer)
- Standardized vault issuing yield tokens such as `yBTC`.
- Supports both instant and asynchronous (cooldown-based) withdrawals.
- Exposes totalAssets(), totalSupply(), and Net Asset Value (NAV) computation for external price reference.

### 2. Uniswap V4 Pool + PegHook (Soft Peg)
- Dedicated pool (e.g., `yBTC/WBTC`) provides continuous liquidity.
- Custom **PegHook** dynamically adjusts swap fees based on deviation from the vault’s **Net Asset Value (NAV)**:
  - **Toward peg:** lower fees → encourage rebalancing trades.
  - **Away from peg:** higher fees → deter divergence, reward LPs.
- This maintains a **soft peg** between market price and NAV without external keepers.

### 3. ArbExecutor (Hard Peg)
- Smart contract that performs on-chain arbitrage when deviations exceed a threshold:
  - **LP < NAV:** buy yBTC → redeem in vault.  
  - **LP > NAV:** mint yBTC in vault → sell in pool.
- Restores parity automatically and captures arbitrage profits for the protocol.

---

## 💡 Key Features
- 🔁 **Instant Liquidity** – trade yield tokens anytime via Uniswap V4.  
- 📈 **Dynamic Fees** – soft-peg mechanism aligns price and NAV.  
- 🧠 **Autonomous Arbitrage** – smart-contract enforcement for hard-peg stability.  
- 💰 **Sustainable LP Yield** – higher fees during volatility compensate LP risk.  
- 🔗 **Composable Design** – fully compatible with ERC-4626 and Uniswap V4 standards.
- 💰 **Higher yield for DeFi protocols** – Higher fees and arbitrage profits flow back into the ecosystem!

---

## 🧱 Core Components
| Component | Description |
|------------|-------------|
| `Vault.sol` | Enhanced ERC-4626 vault (supports cooldown withdrawals). |
| `PegHook.sol` | Uniswap V4 hook implementing dynamic-fee soft peg logic. |
| `ArbExecutor.sol` | Arbitrage contract enforcing hard peg via atomic swaps. |
| `PegFeeMath.sol` | Library computing deviation-based dynamic fee curves. |

---

## 🧪 Example Flow
```
1. User deposits BTC → receives yBTC (vault shares)
2. yBTC trades freely in Uniswap V4 pool (soft-peg maintained)
3. If deviation > threshold → ArbExecutor restores hard peg
```

---

## 🧠 Concept Summary

> **Goal:** Turn illiquid vault shares into freely tradable yield tokens.  
> **Mechanism:** Dynamic Uniswap V4 fees (soft peg) + on-chain arbitrage (hard peg).  
> **Result:** A sustainable, self-balancing liquidity market for yield-bearing assets.

---

## 🧰 Tech Stack
- **Solidity 0.8.26**  
- **Uniswap V4 Core / Periphery**  
- **ERC-4626 Standard (Vaults)**  
- **Foundry + Forge** for testing & deployment  

---

## 📜 License
MIT License © 2025 Blockstat Solutions
