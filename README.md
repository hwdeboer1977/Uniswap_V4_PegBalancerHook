# PegBalancerHook Uniswap V4 Dashboard

Interactive web dashboard for the PegBalancerHook - a Uniswap V4 hook that implements dynamic fees based on vault NAV (Net Asset Value) deviation, maintaining a soft peg between LP tokens and vault shares.

## 🎯 Overview

This Next.js application provides a user-friendly interface to interact with the PegBalancerHook smart contract on Arbitrum Sepolia testnet. The hook dynamically adjusts trading fees based on how far the liquidity pool price deviates from the vault's NAV, incentivizing arbitrage to maintain the peg.

## ✨ Features

### 📊 Real-Time Analytics

- **Liquidity Pool Stats**
  - Current LP Price (token1/token0 ratio)
  - Total Liquidity in the pool
  - Dynamic Current Fee percentage
  - Deadzone Range visualization
  - Spread (LP vs NAV) percentage

### 🏦 Vault Information

- **ERC-4626 Vault Stats**
  - Total Assets deposited
  - Total Shares outstanding
  - Share Price (NAV)
  - Assets per Share ratio
  - Mint/Redeem fee display

### 💼 Wallet Integration

- **User Balance Display**
  - USDC balance
  - yUSDC (vault token) balance
  - Real-time balance updates after transactions
  - Connected wallet address display

### 💱 Trading Interface

- **Token Swap with Direction Toggle**
  - Buy USDC or Buy yUSDC toggle switch
  - Dynamic input labels based on selected direction
  - Trading fee preview
  - Estimated output calculation
  - Transaction confirmation and explorer links

### 🪙 Vault Operations

- **Mint Tokens (Deposit)**
  - Deposit USDC to receive yUSDC vault shares
  - Real-time share calculation
  - Mint fee display
- **Redeem Tokens (Withdraw)**
  - Redeem yUSDC shares for underlying USDC
  - Withdrawal amount preview
  - Redemption period tracking
  - Fee-free redemption display

## 🛠️ Technology Stack

- **Framework**: Next.js 14.2.5 (App Router)
- **Language**: TypeScript
- **Blockchain Library**: ethers.js v6
- **Styling**: Tailwind CSS
- **Network**: Arbitrum Sepolia Testnet
- **Smart Contracts**:
  - Uniswap V4 Pool Manager
  - Custom PegBalancerHook
  - ERC-4626 Vault (yUSDC)
  - Custom Swap Router

## 📋 Prerequisites

- Node.js 18.x or higher
- npm or yarn package manager
- MetaMask or compatible Web3 wallet
- Arbitrum Sepolia testnet ETH (for gas)
- Test USDC tokens on Arbitrum Sepolia

## 🚀 Getting Started

### Installation

```bash
# Clone the repository
git clone https://github.com/hwdeboer1977/Frontend_UV4_PegBalancerHook.git
cd Frontend_UV4_PegBalancerHook

# Install dependencies
npm install

# Create environment file
cp .env.example .env.local
```

### Environment Configuration

Create a `.env.local` file with the following variables:

```env
# RPC Configuration
NEXT_PUBLIC_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
NEXT_PUBLIC_ALCHEMY_API_KEY=your_alchemy_key_here

# Contract Addresses (Arbitrum Sepolia)
NEXT_PUBLIC_USDC_ADDRESS=0xYourUSDCAddress
NEXT_PUBLIC_YUSDC_ADDRESS=0xYourVaultAddress
NEXT_PUBLIC_HOOK_ADDRESS=0xYourHookAddress
NEXT_PUBLIC_POOL_MANAGER_ADDRESS=0xYourPoolManagerAddress
NEXT_PUBLIC_SWAP_ROUTER_ADDRESS=0xYourSwapRouterAddress

# Pool Configuration
NEXT_PUBLIC_POOL_FEE=3000
NEXT_PUBLIC_TICK_SPACING=60
```

### Running the Application

```bash
# Development mode
npm run dev

# Production build
npm run build
npm start

# Linting
npm run lint
```

The application will be available at `http://localhost:3000`

## 🏗️ Project Structure

```
pegbalancehook-dashboard/
├── app/
│   ├── layout.tsx          # Root layout
│   ├── page.tsx            # Main dashboard page
│   └── globals.css         # Global styles
├── components/
│   ├── WalletConnect.tsx   # Wallet connection component
│   ├── PoolStats.tsx       # Liquidity pool statistics
│   ├── VaultStats.tsx      # Vault information display
│   ├── BuyTokenCard.tsx    # Token swap interface
│   ├── MintCard.tsx        # Vault deposit interface
│   └── RedeemCard.tsx      # Vault withdrawal interface
├── hooks/
│   ├── useLPPoolStats.ts   # Pool data fetching hook
│   └── useBalances.ts      # User balance tracking hook
├── constants/
│   └── contracts.ts        # Contract addresses and ABIs
├── public/                 # Static assets
└── package.json
```

## 📝 License

MIT License - see LICENSE file for details

## 📧 Contact

**Developer**: hwdeboer1977  
**GitHub**: [@hwdeboer1977](https://github.com/hwdeboer1977)  
**Repository**: [Frontend_UV4_PegBalancerHook](https://github.com/hwdeboer1977/Frontend_UV4_PegBalancerHook)

**⚠️ Disclaimer**: This is experimental software deployed on testnet. Do not use with real funds. Always audit smart contracts before mainnet deployment.
