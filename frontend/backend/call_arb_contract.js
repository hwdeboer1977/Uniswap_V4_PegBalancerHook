import { ethers } from "ethers";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from root directory
dotenv.config({ path: join(__dirname, "..", ".env.local") });
dotenv.config({ path: join(__dirname, "..", ".env") });

// Validate required environment variables
for (const k of [
  "NEXT_PUBLIC_PRIVATE_KEY",
  "NEXT_PUBLIC_ALCHEMY_API_KEY_FULL",
  "NEXT_PUBLIC_ARB_EXECUTOR",
  "NEXT_PUBLIC_VAULT_ADDRESS",
]) {
  if (!process.env[k]) throw new Error(`Missing env: ${k}`);
}

const CONFIG = {
  RPC_URL: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY_FULL,
  PRIVATE_KEY: process.env.NEXT_PUBLIC_PRIVATE_KEY,
  CONTRACT_ADDRESS_ARB: process.env.NEXT_PUBLIC_ARB_EXECUTOR,
  CONTRACT_ADDRESS_VAULT: process.env.NEXT_PUBLIC_VAULT_ADDRESS,
};

const SHARE_DECIMALS = 6;
const REDEMPTION_DELAY = 0; // Set to 0 for immediate completion, or 7 * 24 * 60 * 60 for 7 days

// Track pending redemptions
let pendingRedemptions = [];

// ---------- ABIs ----------
const ARB_EXECUTOR_ABI = [
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
  "function BASE() view returns (address)",
  "function Y_TOKEN() view returns (address)",
  "function VAULT() view returns (address)",
  "function router() view returns (address)",
  "function poolKey() view returns (tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks))",
  "function arbMintThenSell(uint256 maxBaseToMint, uint256 minYShares, uint256 minQuoteOut, uint256 deadline) returns (int256 pnlBase)",
  "function arbBuyAndQueue(uint256 maxQuoteIn, uint256 minYOut, uint256 deadline) returns (uint256 unlockAt)",
  "function completeQueuedRedeem(uint256 minBaseOut) returns (int256 pnlBase)",
  "function poolId() view returns (bytes32)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const VAULT_ABI = [
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function convertToShares(uint256 assets) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
];

const ROUTER_ABI = [
  "function swap(address sender, (address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key, (bool zeroForOne,int256 amountSpecified,uint160 sqrtPriceLimitX96) params, bytes hookData) returns (int256,int256)",
];

const MIN_SQRT = 4295128739n;
const MAX_SQRT = 1461446703485210103287273052203988822378723970341n;

export async function callArbContract(optAmounts) {
  console.log("🔍 ArbExecutor diagnostic + call (ethers v6)\n");

  const provider = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
  const wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, provider);
  const signerAddr = await wallet.getAddress();

  console.log(`📍 Signer:   ${signerAddr}`);
  console.log(`📍 ArbExec:  ${CONFIG.CONTRACT_ADDRESS_ARB}`);
  console.log(`📍 Vault:    ${CONFIG.CONTRACT_ADDRESS_VAULT}\n`);

  const arbExecutor = new ethers.Contract(
    CONFIG.CONTRACT_ADDRESS_ARB,
    ARB_EXECUTOR_ABI,
    provider
  );
  const arbWithSigner = arbExecutor.connect(wallet);

  // 1) Owner / paused
  console.log("1️⃣ OWNER / PAUSED");
  const owner = await arbExecutor.owner();
  const paused = await arbExecutor.paused();
  console.log(`   Owner:  ${owner}`);
  console.log(
    `   You owner? ${
      owner.toLowerCase() === signerAddr.toLowerCase()
        ? "✅ yes"
        : "❌ no (may revert)"
    }`
  );
  console.log(`   Paused: ${paused ? "❌ YES (will revert)" : "✅ NO"}`);
  if (paused) {
    console.log("   Contract is paused. Exiting.");
    return;
  }

  // 2) Core addresses
  console.log("\n2️⃣ CORE ADDRESSES");
  const [baseAddr, yTokenAddr, vaultAddr, routerAddr] = await Promise.all([
    arbExecutor.BASE(),
    arbExecutor.Y_TOKEN(),
    arbExecutor.VAULT(),
    arbExecutor.router(),
  ]);
  console.log(`   BASE:   ${baseAddr}`);
  console.log(`   yToken: ${yTokenAddr}`);
  console.log(`   Vault:  ${vaultAddr}`);
  console.log(`   Router: ${routerAddr}`);

  const base = new ethers.Contract(baseAddr, ERC20_ABI, provider);
  const yTok = new ethers.Contract(yTokenAddr, ERC20_ABI, provider);
  const vault = new ethers.Contract(vaultAddr, VAULT_ABI, provider);
  const router = new ethers.Contract(routerAddr, ROUTER_ABI, provider);

  const [baseDec, baseSym, yTokenDec, yTokenSym] = await Promise.all([
    base.decimals(),
    base.symbol(),
    yTok.decimals(),
    yTok.symbol(),
  ]);

  // 3) Balances
  console.log("\n3️⃣ BALANCES (owner = ArbExecutor)");
  const [arbBaseBal, arbYTokenBal] = await Promise.all([
    base.balanceOf(CONFIG.CONTRACT_ADDRESS_ARB),
    yTok.balanceOf(CONFIG.CONTRACT_ADDRESS_ARB),
  ]);

  console.log(
    `   ${baseSym} @ArbExec: ${ethers.formatUnits(
      arbBaseBal,
      baseDec
    )} ${baseSym}`
  );
  console.log(
    `   ${yTokenSym} @ArbExec: ${ethers.formatUnits(
      arbYTokenBal,
      yTokenDec
    )} ${yTokenSym}`
  );

  if (arbBaseBal === 0n) {
    console.log(
      "   ⚠️ ArbExecutor has 0 BASE. Fund it before calling arbMintThenSell."
    );
  }

  // 4) Allowances
  console.log("\n4️⃣ ALLOWANCES (owner = ArbExecutor)");
  const [
    baseToVaultAllow,
    baseToRouterAllow,
    yTokenToVaultAllow,
    yTokenToRouterAllow,
  ] = await Promise.all([
    base.allowance(CONFIG.CONTRACT_ADDRESS_ARB, vaultAddr),
    base.allowance(CONFIG.CONTRACT_ADDRESS_ARB, routerAddr),
    yTok.allowance(CONFIG.CONTRACT_ADDRESS_ARB, vaultAddr),
    yTok.allowance(CONFIG.CONTRACT_ADDRESS_ARB, routerAddr),
  ]);

  console.log("   For arbMintThenSell:");
  console.log(
    `     BASE→Vault:     ${
      baseToVaultAllow === ethers.MaxUint256
        ? "✅ MAX"
        : "❌ " + ethers.formatUnits(baseToVaultAllow, baseDec)
    }`
  );
  console.log(
    `     Y_TOKEN→Router: ${
      yTokenToRouterAllow === ethers.MaxUint256 ? "✅ MAX" : "❌ limited"
    }`
  );

  console.log("   For arbBuyAndQueue:");
  console.log(
    `     BASE→Router:    ${
      baseToRouterAllow === ethers.MaxUint256
        ? "✅ MAX"
        : "❌ " + ethers.formatUnits(baseToRouterAllow, baseDec)
    }`
  );
  console.log(
    `     Y_TOKEN→Vault:  ${
      yTokenToVaultAllow === ethers.MaxUint256 ? "✅ MAX" : "❌ limited"
    }`
  );

  // 5) PoolKey sanity
  console.log("\n5️⃣ POOL KEY");
  const pk = await arbExecutor.poolKey();
  console.log(`   currency0: ${pk.currency0}`);
  console.log(`   currency1: ${pk.currency1}`);
  console.log(`   fee:       ${pk.fee}`);
  console.log(`   tickSpace: ${pk.tickSpacing}`);
  console.log(`   hooks:     ${pk.hooks}`);

  const matchesPool =
    [pk.currency0.toLowerCase(), pk.currency1.toLowerCase()]
      .sort()
      .join(",") ===
    [baseAddr.toLowerCase(), yTokenAddr.toLowerCase()].sort().join(",");
  console.log(
    `   matches (BASE,yToken)? ${matchesPool ? "✅" : "❌ mismatch"}`
  );
  if (!matchesPool) {
    console.log("   Pool key doesn't match. Exiting.");
    return;
  }

  // 6) Vault state
  console.log("\n6️⃣ VAULT STATE");
  try {
    const [totalAssets, totalSupply] = await Promise.all([
      vault.totalAssets(),
      vault.totalSupply(),
    ]);
    console.log(
      `   totalAssets: ${ethers.formatUnits(totalAssets, baseDec)} ${baseSym}`
    );
    console.log(
      `   totalSupply: ${ethers.formatUnits(
        totalSupply,
        SHARE_DECIMALS
      )} shares`
    );
    if (totalSupply > 0n) {
      const sharePriceE18 = (totalAssets * 10n ** 18n) / totalSupply;
      console.log(
        `   sharePrice:  ${ethers.formatUnits(
          sharePriceE18,
          18
        )} ${baseSym}/share`
      );
    }
  } catch (error) {
    console.log("   ⚠️ could not fetch vault data:", error.message);
  }

  // 7) Prepare arbitrage
  console.log("\n7️⃣ PREPARING ARBITRAGE FROM OPTIMAL AMOUNTS");
  console.log(`   Direction: ${optAmounts.direction}`);

  let amountIn;
  let expectedOut;
  let functionName;

  if (optAmounts.direction === "zeroForOne") {
    amountIn = optAmounts.amount0_in;
    expectedOut = optAmounts.amount1_out;
    functionName = "arbMintThenSell";

    console.log(
      `   Token0 (${yTokenSym}) IN: ${ethers.formatUnits(
        amountIn,
        yTokenDec
      )} ${yTokenSym}`
    );
    console.log(
      `   Token1 (${baseSym}) OUT: ${ethers.formatUnits(
        expectedOut,
        baseDec
      )} ${baseSym}`
    );
    console.log(
      `   Strategy: Mint ${yTokenSym} in vault → Sell for ${baseSym} in pool`
    );
  } else if (optAmounts.direction === "oneForZero") {
    amountIn = optAmounts.amount1_in;
    expectedOut = optAmounts.amount0_out;
    functionName = "arbBuyAndQueue";

    console.log(
      `   Token1 (${baseSym}) IN: ${ethers.formatUnits(
        amountIn,
        baseDec
      )} ${baseSym}`
    );
    console.log(
      `   Token0 (${yTokenSym}) OUT: ${ethers.formatUnits(
        expectedOut,
        yTokenDec
      )} ${yTokenSym}`
    );
    console.log(
      `   Strategy: Buy ${yTokenSym} in pool → Queue withdrawal from vault`
    );
  } else {
    console.log("   ❌ Unknown direction. Exiting.");
    return;
  }

  // Check if ArbExecutor has enough balance
  if (arbBaseBal < amountIn) {
    console.log(`   ⚠️ Insufficient balance!`);
    console.log(
      `   ArbExecutor has: ${ethers.formatUnits(
        arbBaseBal,
        baseDec
      )} ${baseSym}`
    );
    console.log(
      `   Needs:           ${ethers.formatUnits(amountIn, baseDec)} ${baseSym}`
    );
    console.log(
      `   Missing:         ${ethers.formatUnits(
        amountIn - arbBaseBal,
        baseDec
      )} ${baseSym}`
    );
    return;
  }
  console.log(`   ✅ ArbExecutor has sufficient ${baseSym} balance\n`);

  // 8) Execute arbitrage
  console.log(`8️⃣ EXECUTING ${functionName.toUpperCase()}`);

  const deadline = Math.floor(Date.now() / 1000) + 3000;
  const currentBlock = await provider.getBlock("latest");
  const currentTimestamp = currentBlock.timestamp;

  console.log(`   Current time: ${currentTimestamp}`);
  console.log(`   Deadline:     ${deadline}`);
  console.log(`   Time left:    ${deadline - currentTimestamp} seconds`);

  if (deadline <= currentTimestamp) {
    console.log("   ❌ Deadline is in the past!");
    return;
  }

  let params;
  if (functionName === "arbMintThenSell") {
    const expShares = await vault.convertToShares(amountIn);
    const minYShares = (expShares * 99n) / 100n;
    const minQuoteOut = (expectedOut * 99n) / 100n;

    params = [amountIn, minYShares, minQuoteOut, deadline];

    console.log("\n   Parameters:");
    console.log(
      `   maxBaseToMint: ${ethers.formatUnits(amountIn, baseDec)} ${baseSym}`
    );
    console.log(
      `   minYShares:    ${ethers.formatUnits(
        minYShares,
        yTokenDec
      )} ${yTokenSym}`
    );
    console.log(
      `   minQuoteOut:   ${ethers.formatUnits(minQuoteOut, baseDec)} ${baseSym}`
    );
    console.log(`   deadline:      ${deadline}`);
  } else if (functionName === "arbBuyAndQueue") {
    const minYOut = (expectedOut * 99n) / 100n;

    params = [amountIn, minYOut, deadline];

    console.log("\n   Parameters:");
    console.log(
      `   maxQuoteIn:    ${ethers.formatUnits(amountIn, baseDec)} ${baseSym}`
    );
    console.log(
      `   minYOut:       ${ethers.formatUnits(minYOut, yTokenDec)} ${yTokenSym}`
    );
    console.log(`   deadline:      ${deadline}`);
  }

  console.log();

  try {
    console.log("   ⛽ Estimating gas...");
    const gasEstimate = await arbWithSigner[functionName].estimateGas(
      ...params
    );
    console.log(`   ✅ gas estimate: ${gasEstimate.toString()}`);

    console.log("\n   🚀 Sending transaction...");
    const tx = await arbWithSigner[functionName](...params, {
      gasLimit: (gasEstimate * 120n) / 100n,
    });
    console.log(`   📝 tx hash: ${tx.hash}`);
    console.log(`   ⏳ Waiting for confirmation...`);

    const rcpt = await tx.wait();
    console.log(`   ✅ Confirmed in block ${rcpt.blockNumber}`);
    console.log(`   ⛽ Gas used: ${rcpt.gasUsed.toString()}`);

    if (functionName === "arbMintThenSell") {
      const profit = expectedOut - amountIn;
      console.log(
        `\n   💰 Estimated profit: ${ethers.formatUnits(
          profit,
          baseDec
        )} ${baseSym}`
      );
    } else if (functionName === "arbBuyAndQueue") {
      console.log(
        `\n   ⏰ Withdrawal queued! ${
          REDEMPTION_DELAY === 0
            ? "Completing immediately..."
            : "Will finalize after redemption period."
        }`
      );

      // Store pending redemption info
      const redemptionTime = currentTimestamp + REDEMPTION_DELAY;
      const redemptionInfo = {
        txHash: tx.hash,
        blockNumber: rcpt.blockNumber,
        timestamp: currentTimestamp,
        canCompleteAt: redemptionTime,
        expectedOut: expectedOut,
        minBaseOut: (expectedOut * 99n) / 100n,
      };

      if (REDEMPTION_DELAY === 0) {
        // Complete immediately
        console.log(`   🚀 Completing redemption now...`);
        await completeQueuedRedeem(provider, arbWithSigner, redemptionInfo);
      } else {
        // Schedule for later
        pendingRedemptions.push(redemptionInfo);

        console.log(
          `   📅 Can complete at: ${new Date(
            redemptionTime * 1000
          ).toLocaleString()}`
        );
        console.log(
          `   ⏳ Time until completion: ${REDEMPTION_DELAY / (60 * 60)} hours`
        );

        // Schedule automatic completion
        const delayMs = REDEMPTION_DELAY * 1000;
        setTimeout(async () => {
          console.log("\n⏰ Redemption period complete! Finalizing...");
          await completeQueuedRedeem(
            provider,
            arbWithSigner,
            pendingRedemptions[0]
          );
        }, delayMs);
      }
    }

    return {
      success: true,
      txHash: tx.hash,
      blockNumber: rcpt.blockNumber,
      gasUsed: rcpt.gasUsed,
      gasPrice: rcpt.gasPrice || rcpt.effectiveGasPrice,
    };
  } catch (err) {
    console.log("\n   ❌ Transaction failed");
    console.log("   Error:", err.message);
    if (err.data) {
      console.log("   Error data:", err.data);
    }
    return { success: false };
  }
}

// Function to complete queued redemptions
async function completeQueuedRedeem(provider, arbWithSigner, redemption) {
  console.log("\n" + "=".repeat(80));
  console.log("🔄 COMPLETING QUEUED REDEMPTION");
  console.log("=".repeat(80));
  console.log(`   Original TX: ${redemption.txHash}`);
  console.log(`   Block: ${redemption.blockNumber}`);

  try {
    const minBaseOut = redemption.minBaseOut;

    console.log("   ⛽ Estimating gas...");
    const gasEstimate = await arbWithSigner.completeQueuedRedeem.estimateGas(
      minBaseOut
    );
    console.log(`   ✅ gas estimate: ${gasEstimate.toString()}`);

    console.log("\n   🚀 Sending transaction...");
    const tx = await arbWithSigner.completeQueuedRedeem(minBaseOut, {
      gasLimit: (gasEstimate * 120n) / 100n,
    });
    console.log(`   📝 tx hash: ${tx.hash}`);
    console.log(`   ⏳ Waiting for confirmation...`);

    const rcpt = await tx.wait();
    console.log(`   ✅ Confirmed in block ${rcpt.blockNumber}`);
    console.log(`   ⛽ Gas used: ${rcpt.gasUsed.toString()}`);
    console.log(`\n   💰 Redemption complete! Profit realized.`);

    // Remove from pending list
    pendingRedemptions = pendingRedemptions.filter(
      (r) => r.txHash !== redemption.txHash
    );
  } catch (err) {
    console.log("\n   ❌ Completion failed");
    console.log("   Error:", err.message);
    console.log(
      "   💡 You can try again later by calling completeQueuedRedeem manually"
    );
  }

  console.log("=".repeat(80) + "\n");
}

export default callArbContract;

if (process.argv[1] && process.argv[1].includes("call_arb_contract")) {
  console.log(
    "⚠️  This module requires optAmounts from check_optimal_amounts.js"
  );
  console.log("Run server.js to use this function with real data");
}
