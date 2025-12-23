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

// ---------------- Config (edit these) ----------------

export async function calcOptAmounts(poolData, priceRawLP, priceNAV) {
  // Active in-range liquidity (uint128 from pool)
  //const L = 335_349_559n;
  const L = poolData.Lnow;

  // // A quick (amount1/amount0) approach is a nice shortcut for full-range, single-LP, away from bounds
  // const rawAmount0 = poolData.amount0;
  // const rawAmount1 = poolData.amount1;
  // const priceSimulated = rawAmount1 / rawAmount0;
  // console.log("Price based on raw amounts (amount1/amount0): ", priceSimulated);

  // const newAmount0 = rawAmount0 - 19874720; //sell 19874720
  // const newAmount1 = rawAmount1 + 18762733; // receive 18762733
  // const newPriceSimulated = newAmount1 / newAmount0;
  // console.log(
  //   "New price based on raw amounts (amount1/amount0): ",
  //   newPriceSimulated
  // );

  // Token decimals
  const DEC0 = 6; // USDC
  const DEC1 = 6; // yUSDC

  // Prices (token1 per token0), scaled 1e18
  // const P_LP_E18 = 891230819267775923n; // 0.891230819267775923
  // const P_VAULT_E18 = 1_000_000_000_000_000_000n; // 1.0
  const P_LP_E18 = priceRawLP; // 0.891230819267775923
  const P_VAULT_E18 = priceNAV; // 1.0

  // Input option B: if you already have slot0 sqrtPriceX96, set it here (else leave 0n to derive from P_LP_E18)
  const SQRT_PRICE_NOW_X96 = 0n; // e.g. read from StateView.getSlot0; 0n means derive from price above

  // ---------------- Math helpers ----------------

  const Q96 = 1n << 96n;

  /** Integer sqrt (floor) for bigint. */
  function sqrtBig(n) {
    if (n < 2n) return n;
    let x0 = n;
    let x1 = (n >> 1n) + 1n;
    while (x1 < x0) {
      x0 = x1;
      x1 = (x1 + n / x1) >> 1n;
    }
    return x0;
  }

  /**
   * Build sqrtPriceX96 from a price (token1 per token0) scaled by 1e18,
   * accounting for token decimals (dec0, dec1).
   *
   * priceE18 is the *human* relative price scaled to 1e18, i.e.:
   *   priceE18 = P_real * 1e18 / 10^(dec0-dec1)
   *
   * We compute: sqrtPriceX96 = floor( sqrt(P_real) * 2^96 )
   */
  function sqrtPriceX96FromPriceE18(priceE18, dec0, dec1) {
    // P_real = priceE18 / 1e18 * 10^(dec0-dec1)
    const exp = BigInt(dec0 - dec1);
    const num = priceE18 * (exp >= 0n ? 10n ** exp : 1n);
    const den = (exp >= 0n ? 1n : 10n ** -exp) * 10n ** 18n;

    // sqrt(num/den) * Q96  ==  sqrt(num * Q96^2 / den)
    const radicand = (num * Q96 * Q96) / den;
    return sqrtBig(radicand);
  }

  /**
   * Given current sqrtPriceX96 (sa) and target sqrtPriceX96 (sb),
   * compute fee-free amounts for:
   *  - zeroForOne (token0 in, token1 out, price DOWN: sb < sa)
   *  - oneForZero (token1 in, token0 out, price UP:   sb > sa)
   */
  /** price(token1 per token0) scaled 1e18 from sqrtPriceX96 and decimals */
  function priceFromSqrt(sb, dec0, dec1) {
    const exp = BigInt(dec0 - dec1);
    const num = sb * sb * (exp >= 0n ? 10n ** exp : 1n);
    const den = Q96 * Q96 * (exp >= 0n ? 1n : 10n ** -exp);
    return (num * 10n ** 18n) / den; // E18
  }

  /** zeroForOne: token0 in, token1 out, price ↓ (sb < sa) */
  function zeroForOneAmounts(L, sa, sb) {
    if (sb >= sa) throw new Error("zeroForOne requires sb < sa (price down)");
    const d = sa - sb;

    // Canonical v3 formulas (fee-free)
    const amount0_in = (L * d * Q96) / (sa * sb);
    const amount1_out = (L * d) / Q96;

    // Post-trade sqrt when you actually send `amount0_in`
    // sb_post = (L * sa * Q96) / (amount0_in * sa + L * Q96)
    const sb_post = (L * sa * Q96) / (amount0_in * sa + L * Q96);
    const priceE18_post = priceFromSqrt(sb_post, DEC0, DEC1);
    console.log("New price after swap (E18):", priceE18_post.toString());
    console.log("New price after swap (float):", Number(priceE18_post) / 1e18);

    return { amount0_in, amount1_out, sb_post, priceE18_post };
  }

  /** oneForZero: token1 in, token0 out, price ↑ (sb > sa) */
  function oneForZeroAmounts(L, sa, sb) {
    if (sb <= sa) throw new Error("oneForZero requires sb > sa (price up)");
    const d = sb - sa;

    // Canonical v3 formulas (fee-free)
    const amount1_in = (L * d) / Q96;
    // amount0_out = L * (1/sa - 1/sb)  with Q96 scaling:
    // = L * ( (Q96/sa) - (Q96/sb) )
    // = L * ( (Q96*Q96)/sa - (Q96*Q96)/sb ) / Q96
    const amount0_out = (L * ((Q96 * Q96) / sa - (Q96 * Q96) / sb)) / Q96;

    // Post-trade sqrt when you actually send `amount1_in`
    // sb_post = sa + (amount1_in * Q96) / L
    const sb_post = sa + (amount1_in * Q96) / L;
    const priceE18_post = priceFromSqrt(sb_post, DEC0, DEC1);
    console.log("New price after swap (E18):", priceE18_post.toString());
    console.log("New price after swap (float):", Number(priceE18_post) / 1e18);

    return { amount1_in, amount0_out, sb_post, priceE18_post };
  }

  // ---------------- Main ----------------
  console.log("\n🧮 Computing Optimal Arbitrage Amounts\n");
  console.log("=== Configuration ===");
  console.log("Liquidity (L):", L.toString());
  console.log("Token0 decimals:", DEC0);
  console.log("Token1 decimals:", DEC1);
  console.log("LP Price (E18):", P_LP_E18.toString());
  console.log("LP Price (float):", Number(P_LP_E18) / 1e18);
  console.log("Vault Price (E18):", P_VAULT_E18.toString());
  console.log("Vault Price (float):", Number(P_VAULT_E18) / 1e18);
  console.log();

  // Build sa (current) and sb (target) as sqrtPriceX96
  const sa =
    SQRT_PRICE_NOW_X96 !== 0n
      ? SQRT_PRICE_NOW_X96
      : sqrtPriceX96FromPriceE18(P_LP_E18, DEC0, DEC1);

  const sb = sqrtPriceX96FromPriceE18(P_VAULT_E18, DEC0, DEC1);

  console.log("=== Square Root Prices ===");
  console.log("sa (sqrtPriceX96 current):", sa.toString());
  console.log("sb (sqrtPriceX96 target):", sb.toString());
  console.log();

  // Declare variables outside the if/else blocks so they can be returned
  let amount0_in = 0n;
  let amount1_in = 0n;
  let amount0_out = 0n;
  let amount1_out = 0n;
  let sb_post = 0n;
  let priceE18_post = 0n;
  let direction = "";

  // Compare prices (E18) to pick direction
  if (P_LP_E18 > P_VAULT_E18) {
    // LP > Vault → push price DOWN to target → zeroForOne
    console.log(
      "🔴 LP > Vault → zeroForOne (token0 in, token1 out) to reach vault price\n"
    );

    const result = zeroForOneAmounts(L, sa, sb);
    amount0_in = result.amount0_in;
    amount1_out = result.amount1_out;
    sb_post = result.sb_post;
    priceE18_post = result.priceE18_post;
    direction = "zeroForOne";

    console.log("=== Swap Details ===");
    console.log("Direction: Token0 → Token1 (zeroForOne)");
    console.log("Amount Token0 IN (raw):", amount0_in.toString());
    console.log("Amount Token1 OUT (raw):", amount1_out.toString());
    console.log(
      "Amount Token0 IN (human):",
      ethers.formatUnits(amount0_in, DEC0)
    );
    console.log(
      "Amount Token1 OUT (human):",
      ethers.formatUnits(amount1_out, DEC1)
    );
    console.log();
    console.log("=== Post-Swap State ===");
    console.log("sqrtPriceX96 after swap:", sb_post.toString());
    console.log("Price after swap (E18):", priceE18_post.toString());
    console.log("Price after swap (float):", Number(priceE18_post) / 1e18);

    // Calculate price impact
    const priceImpact =
      ((Number(priceE18_post) - Number(P_LP_E18)) / Number(P_LP_E18)) * 100;
    console.log("Price impact:", priceImpact.toFixed(4) + "%");
  } else if (P_LP_E18 < P_VAULT_E18) {
    // LP < Vault → push price UP to target → oneForZero
    console.log(
      "🟢 LP < Vault → oneForZero (token1 in, token0 out) to reach vault price\n"
    );

    const result = oneForZeroAmounts(L, sa, sb);
    amount1_in = result.amount1_in;
    amount0_out = result.amount0_out;
    sb_post = result.sb_post;
    priceE18_post = result.priceE18_post;
    direction = "oneForZero";

    console.log("=== Swap Details ===");
    console.log("Direction: Token1 → Token0 (oneForZero)");
    console.log("Amount Token1 IN (raw):", amount1_in.toString());
    console.log("Amount Token0 OUT (raw):", amount0_out.toString());
    console.log(
      "Amount Token1 IN (human):",
      ethers.formatUnits(amount1_in, DEC1)
    );
    console.log(
      "Amount Token0 OUT (human):",
      ethers.formatUnits(amount0_out, DEC0)
    );
    console.log();
    console.log("=== Post-Swap State ===");
    console.log("sqrtPriceX96 after swap:", sb_post.toString());
    console.log("Price after swap (E18):", priceE18_post.toString());
    console.log("Price after swap (float):", Number(priceE18_post) / 1e18);

    // Calculate price impact
    const priceImpact =
      ((Number(priceE18_post) - Number(P_LP_E18)) / Number(P_LP_E18)) * 100;
    console.log("Price impact:", priceImpact.toFixed(4) + "%");
  } else {
    console.log("✅ Already at vault price; nothing to do.");
  }

  console.log("\n" + "=".repeat(80));

  // Return the data for use in other scripts
  return {
    direction,
    amount0_in,
    amount1_in,
    amount0_out,
    amount1_out,
    sb_post,
    priceE18_post,
    priceImpact:
      ((Number(priceE18_post) - Number(P_LP_E18)) / Number(P_LP_E18)) * 100,
  };
}

// Export for use in other modules, but also run if executed directly
export default calcOptAmounts;

// Auto-run if this is the main module being executed
if (process.argv[1] && process.argv[1].includes("check_optimal_amounts")) {
  console.log("⚠️  This module requires poolData, priceRawLP, and priceNAV");
  console.log("Run server.js to use this function with real data");
}
