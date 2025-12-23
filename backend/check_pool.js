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

// ============================================================================
// SCRIPT CHECKS THE AMOUNTS IN THE POOL (NEEDED TO DETERMINE OPT TRADE AMOUNT)
// ============================================================================

// ============================================================================
// CONFIGURATION
// ============================================================================

const HOOK = ethers.getAddress(process.env.NEXT_PUBLIC_HOOK_ADDRESS.trim());
const TOKEN0_RAW = ethers.getAddress(
  process.env.NEXT_PUBLIC_USDC_ADDRESS.trim()
);
const TOKEN1_RAW = ethers.getAddress(
  process.env.NEXT_PUBLIC_YUSDC_ADDRESS.trim()
);
const VAULT_ADDRESS = ethers.getAddress(
  process.env.NEXT_PUBLIC_YUSDC_ADDRESS.trim()
);

const DEC0 = 6; // USDC decimals
const DEC1 = 6; // yUSDC decimals

const DYNAMIC_FEE_FLAG = 0x800000;
const TICK_SPACING = 60;
const TICK_LOWER = -887272; // Full range
const TICK_UPPER = 887272;

const STATE_VIEW = "0x9D467FA9062b6e9B1a46E26007aD82db116c67cB";

const RPC_URL =
  process.env.NEXT_PUBLIC_ALCHEMY_API_KEY_FULL ||
  "https://sepolia-rollup.arbitrum.io/rpc";

// Ensure correct token ordering (currency0 < currency1)
const [TOKEN0, TOKEN1, DECIMALS] =
  TOKEN0_RAW.toLowerCase() < TOKEN1_RAW.toLowerCase()
    ? [TOKEN0_RAW, TOKEN1_RAW, { dec0: DEC0, dec1: DEC1 }]
    : [TOKEN1_RAW, TOKEN0_RAW, { dec0: DEC1, dec1: DEC0 }];

const IS_VAULT_TOKEN0 = TOKEN0.toLowerCase() === VAULT_ADDRESS.toLowerCase();

// ============================================================================
// CONTRACT ABI
// ============================================================================

const STATE_VIEW_ABI = [
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
  "function getTickLiquidity(bytes32 poolId, int24 tick) view returns (uint128 liquidityGross, int128 liquidityNet)",
];

const provider = new ethers.JsonRpcProvider(RPC_URL);
const stateView = new ethers.Contract(STATE_VIEW, STATE_VIEW_ABI, provider);

// ============================================================================
// HELPERS
// ============================================================================

const Q96 = 1n << 96n;

function getPoolId(currency0, currency1, fee, tickSpacing, hooks) {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "uint24", "int24", "address"],
    [currency0, currency1, fee, tickSpacing, hooks]
  );
  return ethers.keccak256(encoded);
}

function sqrtPriceToPrice(sqrtX96, dec0, dec1) {
  // price(token1 per token0) = (sqrtP^2 / 2^192) * 10^(dec0-dec1)
  const Q192 = 1n << 192n;
  const num = sqrtX96 * sqrtX96;
  const scaleIn = 10n ** BigInt(dec0);
  const scaleOut = 10n ** BigInt(dec1);
  const ONE = 10n ** 18n;

  const priceScaled = (num * scaleIn * ONE) / (Q192 * scaleOut);
  return Number(priceScaled) / 1e18;
}

function sqrtPriceToPriceE18(sqrtX96, dec0, dec1) {
  const Q192 = 1n << 192n;
  const num = sqrtX96 * sqrtX96;
  const scaleIn = 10n ** BigInt(dec0);
  const scaleOut = 10n ** BigInt(dec1);
  const ONE = 10n ** 18n;

  return (num * scaleIn * ONE) / (Q192 * scaleOut);
}

function getSqrtPriceAtTick(tick) {
  const absTick = BigInt(Math.abs(tick));
  let ratio =
    (absTick & 1n) !== 0n
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n;

  const mulConst = [
    0xfff97272373d413259a46990580e213an,
    0xfff2e50f5f656932ef12357cf3c7fdccn,
    0xffe5caca7e10e4e61c3624eaa0941cd0n,
    0xffcb9843d60f6159c9db58835c926644n,
    0xff973b41fa98c081472e6896dfb254c0n,
    0xff2ea16466c96a3843ec78b326b52861n,
    0xfe5dee046a99a2a811c461f1969c3053n,
    0xfcbe86c7900a88aedcffc83b479aa3a4n,
    0xf987a7253ac413176f2b074cf7815e54n,
    0xf3392b0822b70005940c7a398e4b70f3n,
    0xe7159475a2c29b7443b29c7fa6e889d9n,
    0xd097f3bdfd2022b8845ad8f792aa5825n,
    0xa9f746462d870fdf8a65dc1f90e061ean,
    0x70d869a156d2a1b890bb3df62baf32f7n,
    0x31be135f97d08fd981231505542fcfa6n,
    0x9aa508b5b7a84e1c677de54f3e99bc9n,
    0x5d6af8dedb81196699c329225ee604n,
    0x2216e584f5fa1ea926041bedfe98n,
    0x48a170391f7dc42444e8fa2n,
  ];

  for (let i = 0; i < mulConst.length; i++) {
    if ((absTick & (1n << BigInt(i + 1))) !== 0n) {
      ratio = (ratio * mulConst[i]) >> 128n;
    }
  }

  if (tick > 0) {
    const max = (1n << 256n) - 1n;
    ratio = max / ratio;
  }

  // Round up to Q64.96
  const sqrtX96 =
    (ratio >> 32n) + ((ratio & ((1n << 32n) - 1n)) === 0n ? 0n : 1n);
  return sqrtX96;
}

function calculateTokenAmounts(
  liquidity,
  currentTick,
  sqrtPriceX96,
  tickLower,
  tickUpper
) {
  const sqrtLower = getSqrtPriceAtTick(tickLower);
  const sqrtUpper = getSqrtPriceAtTick(tickUpper);

  // Below range - all token0
  if (currentTick < Math.min(tickLower, tickUpper)) {
    const lower = sqrtLower < sqrtUpper ? sqrtLower : sqrtUpper;
    const upper = sqrtLower < sqrtUpper ? sqrtUpper : sqrtLower;
    const amount0 = (liquidity * (upper - lower) * Q96) / (upper * lower);
    return { amount0, amount1: 0n };
  }

  // Above range - all token1
  if (currentTick > Math.max(tickLower, tickUpper)) {
    const lower = sqrtLower < sqrtUpper ? sqrtLower : sqrtUpper;
    const upper = sqrtLower < sqrtUpper ? sqrtUpper : sqrtLower;
    const amount1 = (liquidity * (upper - lower)) / Q96;
    return { amount0: 0n, amount1 };
  }

  // Inside range - both tokens
  const lower = sqrtLower < sqrtUpper ? sqrtLower : sqrtUpper;
  const upper = sqrtLower < sqrtUpper ? sqrtUpper : sqrtLower;

  const amount0 =
    (liquidity * (upper - sqrtPriceX96) * Q96) / (upper * sqrtPriceX96);
  const amount1 = (liquidity * (sqrtPriceX96 - lower)) / Q96;

  return { amount0, amount1 };
}

function formatUnits(amount, decimals) {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const str = abs.toString().padStart(decimals + 1, "0");
  const intPart = str.slice(0, str.length - decimals);
  const fracPart = str.slice(str.length - decimals).replace(/0+$/, "");
  return (
    (negative ? "-" : "") + (fracPart ? `${intPart}.${fracPart}` : intPart)
  );
}

// ============================================================================
// MAIN
// ============================================================================
const WINDOW_STEPS = 20; // how many tickSpacing steps to show on each side

export async function checkPool() {
  console.log("🔍 Checking pool state...\n");

  const poolId = getPoolId(
    TOKEN0,
    TOKEN1,
    DYNAMIC_FEE_FLAG,
    TICK_SPACING,
    HOOK
  );

  try {
    // Call getSlot0 and getLiquidity
    const [slot0Result, liquidityNow] = await Promise.all([
      stateView.getSlot0(poolId),
      stateView.getLiquidity(poolId),
    ]);

    const sqrtPriceX96 = slot0Result[0];
    const tickNow = Number(slot0Result[1]);
    const protocolFee = Number(slot0Result[2]);
    const lpFee = Number(slot0Result[3]);
    const Lnow = liquidityNow;

    console.log("=== Pool Info ===");
    console.log("Pool ID:", poolId);
    console.log("Token0:", TOKEN0);
    console.log("Token1:", TOKEN1);
    console.log("Hook:", HOOK);
    console.log("Fee: Dynamic (0x800000)");
    console.log("Tick Spacing:", TICK_SPACING);
    console.log();

    console.log("=== Pool State ===");
    console.log("sqrtPriceX96:", sqrtPriceX96.toString());
    console.log("Tick (current):", tickNow);
    console.log("Protocol Fee:", protocolFee);
    console.log(
      "LP Fee (pips):",
      lpFee,
      lpFee > 0 ? `(${lpFee / 10000}%)` : ""
    );
    console.log("Active Liquidity (L):", Lnow.toString());
    console.log();

    if (sqrtPriceX96 === 0n) {
      console.log("⚠️  Pool exists but not initialized (sqrtPrice = 0)");
      return;
    }

    const priceNow = sqrtPriceToPrice(
      sqrtPriceX96,
      DECIMALS.dec0,
      DECIMALS.dec1
    );
    console.log("Price now (token1 per token0):", priceNow);
    console.log();

    // ----------- BUILD TICK WINDOW -----------
    const base = Math.floor(tickNow / TICK_SPACING) * TICK_SPACING;
    const ticks = [];
    for (let i = -WINDOW_STEPS; i <= WINDOW_STEPS; i++) {
      ticks.push(base + i * TICK_SPACING);
    }

    // ----------- FETCH TICK LIQUIDITY -----------
    console.log("Fetching tick liquidity data...");
    const tickResults = await Promise.all(
      ticks.map((t) => stateView.getTickLiquidity(poolId, t))
    );

    // Reconstruct L across tick boundaries moving UP
    let Lcursor = Lnow;

    const table = ticks.map((t, idx) => {
      const [liqGross, liqNet] = tickResults[idx];

      const sqrtAtTick = getSqrtPriceAtTick(t);
      const priceAtTick = sqrtPriceToPrice(
        sqrtAtTick,
        DECIMALS.dec0,
        DECIMALS.dec1
      );

      // If we cross UP through this boundary, active L updates by +liqNet
      const L_after_up = t >= base ? Lcursor + liqNet : Lcursor;

      // Advance Lcursor only when we move up
      if (t >= base) Lcursor = L_after_up;

      return {
        tick: t,
        sqrtAtTick,
        priceAtTick,
        liqGross,
        liqNet,
        L_after_up,
      };
    });

    // ----------- PRINT SUMMARY -----------
    console.log(
      `\n=== Liquidity per tick (window: ${WINDOW_STEPS} steps × ${TICK_SPACING}) ===`
    );
    console.log(`Columns: tick | price@tick | liqGross | liqNet | L_after_up`);
    for (const row of table) {
      const mark = row.tick === base ? " <== current band start" : "";
      console.log(
        row.tick.toString().padStart(8, " "),
        "|",
        row.priceAtTick.toFixed(6).padStart(14, " "),
        "|",
        row.liqGross.toString().padStart(18, " "),
        "|",
        row.liqNet.toString().padStart(18, " "),
        "|",
        row.L_after_up.toString().padStart(18, " "),
        mark
      );
    }

    // ----------- COMPUTE FULL-RANGE AMOUNTS -----------
    const { amount0, amount1 } = calculateTokenAmounts(
      Lnow,
      tickNow,
      sqrtPriceX96,
      TICK_LOWER,
      TICK_UPPER
    );

    console.log("\n=== Position Amounts (full range example) ===");
    if (tickNow < Math.min(TICK_LOWER, TICK_UPPER)) {
      console.log("Status: BELOW range (all token0)");
    } else if (tickNow > Math.max(TICK_LOWER, TICK_UPPER)) {
      console.log("Status: ABOVE range (all token1)");
    } else {
      console.log("Status: INSIDE range");
    }
    console.log("Token0 (raw):", amount0.toString());
    console.log("Token1 (raw):", amount1.toString());
    console.log("Token0 (formatted):", formatUnits(amount0, DECIMALS.dec0));
    console.log("Token1 (formatted):", formatUnits(amount1, DECIMALS.dec1));
    console.log();

    // ----------- TOTALS IN USD (assuming USDC = $1) -----------
    const amount0Float = parseFloat(ethers.formatUnits(amount0, DECIMALS.dec0));
    const amount1Float = parseFloat(ethers.formatUnits(amount1, DECIMALS.dec1));

    // Return the data for use in other scripts
    return {
      poolId,
      Lnow,
      amount0,
      amount1,
    };
  } catch (error) {
    console.error("❌ Error reading pool:", error);
    console.log("\nPossible reasons:");
    console.log("  1. Pool hasn't been created yet");
    console.log("  2. Wrong network or RPC endpoint");
    console.log("  3. StateView contract address is incorrect");
    console.log("  4. Environment variables not set correctly");
    return null;
  }
}

// Export for use in other modules, but also run if executed directly
export default checkPool;

// Auto-run if this is the main module being executed
if (process.argv[1] && process.argv[1].includes("check_pool")) {
  checkPool().catch(console.error);
}
