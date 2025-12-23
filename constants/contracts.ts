// src/constants/contracts.ts
import { ethers } from "ethers";

/* =========================
 * Helpers
 * ======================= */
const norm = (v?: string | null) => {
  if (!v) return undefined;
  const cleaned = v
    .trim()
    .replace(/^"+|"+$/g, "")
    .replace(/^'+|'+$/g, "");
  try {
    return ethers.getAddress(cleaned); // checksum + validate
  } catch {
    return undefined;
  }
};

/* =========================
 * Chain / RPC
 * ======================= */
export const ARBITRUM_SEPOLIA_CHAIN_ID: number = Number(
  process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_CHAIN_ID ?? 421614
);

export const ALCHEMY_API_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY ?? "";

export const getRpcUrl = (): string => {
  return ALCHEMY_API_KEY
    ? `https://arb-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
    : "https://sepolia-rollup.arbitrum.io/rpc";
};

export const ARBITRUM_SEPOLIA = {
  chainId: `0x${ARBITRUM_SEPOLIA_CHAIN_ID.toString(16)}`,
  chainName: "Arbitrum Sepolia",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: [getRpcUrl()],
  blockExplorerUrls: ["https://sepolia.arbiscan.io/"],
};

/* =========================
 * Addresses (literal env keys!)
 * ======================= */
export const CONTRACTS = {
  USDC: norm(process.env.NEXT_PUBLIC_USDC_ADDRESS || null),
  yUSDC: norm(process.env.NEXT_PUBLIC_YUSDC_ADDRESS || null),
  VAULT: norm(process.env.NEXT_PUBLIC_VAULT_ADDRESS || null),
  HOOK: norm(process.env.NEXT_PUBLIC_HOOK_ADDRESS || null),
  ROUTER: norm(process.env.NEXT_PUBLIC_SWAP_ROUTER_ADDRESS || null),
  POOL_MANAGER: norm(process.env.NEXT_PUBLIC_PM_ADDRESS || null),
} as const;

/* Dev-time warnings (works in both server and client bundles) */
(() => {
  const pairs: Array<[string, string | undefined]> = [
    ["USDC", process.env.NEXT_PUBLIC_USDC_ADDRESS],
    ["yUSDC", process.env.NEXT_PUBLIC_YUSDC_ADDRESS],
    ["VAULT", process.env.NEXT_PUBLIC_VAULT_ADDRESS],
    ["HOOK", process.env.NEXT_PUBLIC_HOOK_ADDRESS],
  ];
  for (const [label, raw] of pairs) {
    const cleaned = raw?.trim();
    if (!cleaned || !ethers.isAddress(cleaned)) {
      // eslint-disable-next-line no-console
      console.warn(`[contracts.ts] ${label} env invalid`, {
        raw,
        cleaned: cleaned && JSON.stringify(cleaned),
      });
    }
  }
})();

/* =========================
 * Pool / Hook config
 * ======================= */
export interface PoolKey {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
}

export const POOL_CONFIG: PoolKey & { fee: number; tickSpacing: number } = {
  currency0: (norm(process.env.NEXT_PUBLIC_POOL_CURRENCY1) ??
    CONTRACTS.USDC ??
    ethers.ZeroAddress) as `0x${string}`,
  currency1: (norm(process.env.NEXT_PUBLIC_POOL_CURRENCY0) ??
    CONTRACTS.yUSDC ??
    ethers.ZeroAddress) as `0x${string}`,
  fee: Number(process.env.NEXT_PUBLIC_POOL_FEE ?? 3000),
  tickSpacing: Number(process.env.NEXT_PUBLIC_POOL_TICK_SPACING ?? 60),
  hooks: (CONTRACTS.HOOK ?? ethers.ZeroAddress) as `0x${string}`,
};

/* =========================
 * Peg params
 * ======================= */
export const SOFT_PEG_CONFIG = {
  deadzonePercent: Number(process.env.NEXT_PUBLIC_DEADZONE_PERCENT ?? 2),
  baseFee: Number(process.env.NEXT_PUBLIC_BASE_FEE_BPS ?? 0.3), // percent
};

/* =========================
 * ABIs
 * ======================= */
export const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
] as const;

export const VAULT_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function asset() view returns (address)",
  "function totalAssets() view returns (uint256)",
  "function convertToShares(uint256 assets) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function maxDeposit(address) view returns (uint256)",
  "function maxMint(address) view returns (uint256)",
  "function maxWithdraw(address owner) view returns (uint256)",
  "function maxRedeem(address owner) view returns (uint256)",
  "function previewDeposit(uint256 assets) view returns (uint256)",
  "function previewMint(uint256 shares) view returns (uint256)",
  "function previewWithdraw(uint256 assets) view returns (uint256)",
  "function previewRedeem(uint256 shares) view returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function mint(uint256 shares, address receiver) returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
  "function initiateWithdraw(uint256 shares)",
  "function cancelWithdraw(uint256 shares)",
  "function pendingShares(address) view returns (uint256)",
  "function pendingUnlockAt(address) view returns (uint256)",
  "function unlockedSharesOf(address) view returns (uint256)",
  "function redemptionPeriod() view returns (uint256)",
] as const;

export const HOOK_ABI = [
  // Existing function
  "function currentPrices(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey) view returns (uint256 priceHumanLP, uint256 priceRawE18, uint160 sqrtP)",
  // Add the FeeChosen event
  "event FeeChosen(uint24 rawFee, uint24 withFlag, bool toward, uint256 devBps)",
] as const;

/* =========================
 * Providers
 * ======================= */
export const makeReadProvider = () => new ethers.JsonRpcProvider(getRpcUrl());
export const isValidAddress = (addr?: string): addr is `0x${string}` =>
  !!addr && ethers.isAddress(addr);
