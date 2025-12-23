import { ethers } from "ethers";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRequire } from "module";
import { checkPool } from "./check_pool.js";
import { calcOptAmounts } from "./check_optimal_amounts.js";
import { callArbContract } from "./call_arb_contract.js";
import { logBalance, displayBalanceSummary } from "./simple_balance_logger.js";

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from root directory
dotenv.config({ path: join(__dirname, "..", ".env.local") });
dotenv.config({ path: join(__dirname, "..", ".env") });

// Create require function for JSON imports
const require = createRequire(import.meta.url);

// Import ABIs
const PegHookAbiJson = require("./abis/PegHook.abi.json");
const PEG_HOOK_ABI = PegHookAbiJson.abi || PegHookAbiJson;

const ERC20AbiJson = require("./abis/ERC20.abi.json");
const ERC20_ABI = ERC20AbiJson.abi || ERC20AbiJson;

const ARBAbiJson = require("./abis/ArbExecutor.abi.json");
const ARB_ABI = ARBAbiJson.abi || ARBAbiJson;

const VaultAbiJson = require("./abis/Vault.abi.json");
const VAULT_ABI = VaultAbiJson.abi || VaultAbiJson;

// Configuration
const config = {
  wssUrl: process.env.NEXT_PUBLIC_ALCHEMY_API_WSS_KEY_FULL,
  usdcAddress: process.env.NEXT_PUBLIC_USDC_ADDRESS,
  yusdcAddress: process.env.NEXT_PUBLIC_YUSDC_ADDRESS,
  hookAddress: process.env.NEXT_PUBLIC_HOOK_ADDRESS,
  vaultAddress: process.env.NEXT_PUBLIC_VAULT_ADDRESS,
  arbExecutor: process.env.NEXT_PUBLIC_ARB_EXECUTOR,
  dec0: process.env.NEXT_PUBLIC_DECIMALS0,
  dec1: process.env.NEXT_PUBLIC_DECIMALS1,
  arbTriggerBps: BigInt(process.env.ARB_TRIGGER_BPS || "500"),
};

const priceBase = 1;
const BPS = 10_000n;

console.log("🚀 Starting arbitrage bot...");
console.log(config);

// Setup WebSocket provider
const provider = new ethers.WebSocketProvider(config.wssUrl);

// Initialize contracts
const hook = new ethers.Contract(config.hookAddress, PEG_HOOK_ABI, provider);
const usdc = new ethers.Contract(config.usdcAddress, ERC20_ABI, provider);
const yusdc = new ethers.Contract(config.yusdcAddress, ERC20_ABI, provider);
const vault = new ethers.Contract(config.vaultAddress, VAULT_ABI, provider);

// Get pool key
const poolKeyTemplate = await hook.keyDynamic(60);
const poolKey = {
  currency0: poolKeyTemplate.currency0,
  currency1: poolKeyTemplate.currency1,
  fee: poolKeyTemplate.fee,
  tickSpacing: poolKeyTemplate.tickSpacing,
  hooks: poolKeyTemplate.hooks,
};

console.log("✅ Connected to WebSocket");
console.log("Pool Key:", poolKey);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function getBalances() {
  const balUSDCRaw = await usdc.balanceOf(config.arbExecutor);
  const balUSDC = Number(balUSDCRaw) / 10 ** config.dec0;
  const balYUSDCRaw = await yusdc.balanceOf(config.arbExecutor);
  const balYUSDC = Number(balYUSDCRaw) / 10 ** config.dec1;

  const totalAssets = await vault.totalAssets();
  const totalShares = await vault.totalSupply();
  const sharePrice = Number(totalAssets) / Number(totalShares);

  const totalBal = (balYUSDC * sharePrice + balUSDC) * priceBase;

  return { balUSDC, balYUSDC, sharePrice, totalBal };
}

async function checkAndExecuteArbitrage(swapEvent = null, swapFeeData = null) {
  try {
    console.log("\n🔍 checkAndExecuteArbitrage called");

    // Get current prices
    const [, priceRawLP] = await hook.currentPrices(poolKey);
    const priceNAV = await hook.nav1e18();

    console.log("Price LP raw: ", priceRawLP.toString());
    console.log("Price NAV: ", priceNAV.toString());

    // Calculate deviation
    const difference =
      priceNAV > priceRawLP ? priceNAV - priceRawLP : priceRawLP - priceNAV;
    const deviationBps = (difference * BPS) / priceNAV;

    console.log(`Deviation: ${Number(deviationBps) / 100}%`);

    // Check if opportunity exists
    if (deviationBps >= config.arbTriggerBps) {
      console.log("✅ Arbitrage opportunity detected!");

      const direction = priceRawLP < priceNAV ? "LP_TO_VAULT" : "VAULT_TO_LP";
      console.log(`Direction: ${direction}`);

      // Get pool data and calculate optimal amounts
      const poolData = await checkPool();
      const optAmounts = await calcOptAmounts(poolData, priceRawLP, priceNAV);

      // Execute arbitrage
      console.log("🔄 Executing arbitrage...");
      const arbData = await callArbContract(optAmounts);

      // Always log new balances after arbitrage attempt
      console.log("📊 Logging balances...");
      const balances = await getBalances();
      await logBalance({
        ...balances,
        txHash: arbData?.txHash || null,
        direction: direction,
        // Add swap fee data
        swapRawFee: swapFeeData?.rawFee,
        swapFeePercent: swapFeeData?.feePercent,
        swapFeeWithFlag: swapFeeData?.withFlag,
        swapToward: swapFeeData?.toward,
        swapDevBps: swapFeeData?.devBps,
      });

      console.log("\n💰 ARBITRAGE EXECUTED!");
      console.log(`   Arb TX: ${arbData?.txHash || "N/A"}`);
      console.log(
        `   Triggered by Swap: ${swapEvent?.transactionHash || "N/A"}`
      );
      console.log("=".repeat(80) + "\n");
    } else {
      console.log("❌ No arbitrage opportunity");
    }
  } catch (error) {
    console.error("Error:", error.message);
  }
}

// ============================================================================
// LOG STARTING BALANCES
// ============================================================================

const startBalances = await getBalances();
await logBalance(startBalances);
console.log("\n📊 Starting balances logged\n");

// ============================================================================
// EVENT LISTENER
// ============================================================================

// ============================================================================
// PRIMARY: Event Listener (swap in pool = instant check)
// ============================================================================

hook.on("FeeChosen", async (rawFee, withFlag, toward, devBps, event) => {
  console.log("\n" + "=".repeat(80));
  console.log("🎯 SWAP DETECTED IN POOL");
  console.log("=".repeat(80));
  console.log(`Block: ${event.blockNumber}`);
  console.log(`TX Hash: ${event.transactionHash}`);
  console.log(`Raw Fee: ${rawFee} (${Number(rawFee) / 1000000}%)`);
  console.log(`Fee with Flag: ${withFlag}`);
  console.log(`Toward: ${toward}`);
  console.log(`Dev BPS: ${devBps}`);
  console.log("=".repeat(80) + "\n");

  // // Log swap immediately to JSON
  // await logBalance({
  //   ...(await getBalances()),
  //   txHash: event.transactionHash,
  //   direction: "SWAP_DETECTED",
  //   swapRawFee: Number(rawFee),
  //   swapFeePercent: Number(rawFee) / 1000000,
  //   swapFeeWithFlag: Number(withFlag),
  //   swapToward: toward,
  //   swapDevBps: Number(devBps),
  // });

  // Then check for arbitrage
  await checkAndExecuteArbitrage(event);
});
// ============================================================================
// SECONDARY: Block Listener (catches vault NAV changes)
// ============================================================================

// provider.on("block", async (blockNumber) => {
//   console.log(`📦 Block ${blockNumber}`);
//   await checkAndExecuteArbitrage();
// });

console.log("👂 Monitoring swaps + vault NAV changes...\n");

// Keep the process running
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down...");
  await displayBalanceSummary();
  process.exit(0);
});
