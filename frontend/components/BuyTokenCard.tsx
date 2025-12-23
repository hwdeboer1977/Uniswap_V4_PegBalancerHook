"use client";

import { useMemo, useState } from "react";
import { ethers } from "ethers";
import {
  CONTRACTS,
  ERC20_ABI,
  getRpcUrl,
  ARBITRUM_SEPOLIA,
  ARBITRUM_SEPOLIA_CHAIN_ID,
} from "@/constants/contracts";

interface BuyTokenCardProps {
  account: string | null;
  /** current LP price in $ per token, e.g. "1.0050" */
  lpPrice: string;
  /** trading fee percent shown in the card, e.g. 0.30 */
  tradingFeePct?: number;
  /** pool fee tier (for V3 routers); default 3000 */
  poolFee?: number;
  onSuccess?: () => void;
}

/** ABI for your custom swap router that matches the Foundry script */
const SWAP_ROUTER_ABI = [
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, bool zeroForOne, tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bytes hookData, address receiver, uint256 deadline) external returns (uint256 amountOut)",
] as const;

// Dynamic fee flag constant
const DYNAMIC_FEE_FLAG = 0x800000; // LPFeeLibrary.DYNAMIC_FEE_FLAG

export default function BuyTokenCard({
  account,
  lpPrice,
  tradingFeePct = 0.3,
  poolFee = 3000,
  onSuccess,
}: BuyTokenCardProps) {
  const [amountUSD, setAmountUSD] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  // NEW: State for swap direction toggle
  // true = buying token1 (yUSDC/WETH), false = buying token0 (USDC)
  const [buyingToken1, setBuyingToken1] = useState(true);

  const lpPriceNum = useMemo(() => Number(lpPrice || "0"), [lpPrice]);
  const amountNum = useMemo(() => Number(amountUSD || "0"), [amountUSD]);

  // naive quote (no price impact, just for UI): tokens ≈ cash / price
  const tokensOutEst = useMemo(() => {
    if (!lpPriceNum || !amountNum) return "0.0000";
    const gross = amountNum / lpPriceNum;
    const fee = (tradingFeePct / 100) * gross;
    return (gross - fee).toFixed(4);
  }, [amountNum, lpPriceNum, tradingFeePct]);

  async function ensureWalletOnArbSepolia(provider: ethers.BrowserProvider) {
    const net = await provider.getNetwork();
    const chainId = Number(net.chainId);
    if (chainId === ARBITRUM_SEPOLIA_CHAIN_ID) return;
    try {
      await (window as any).ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: ARBITRUM_SEPOLIA.chainId }],
      });
    } catch (e: any) {
      if (e?.code === 4902) {
        await (window as any).ethereum.request({
          method: "wallet_addEthereumChain",
          params: [ARBITRUM_SEPOLIA],
        });
      } else {
        throw new Error(
          `Please switch to Arbitrum Sepolia (current: ${chainId})`
        );
      }
    }
  }

  const handleBuy = async () => {
    try {
      setIsLoading(true);
      setError(null);
      setTxHash(null);

      if (!account) throw new Error("Please connect your wallet");
      if (!amountNum || amountNum <= 0)
        throw new Error("Enter a valid $ amount");
      if (!CONTRACTS.USDC || !ethers.isAddress(CONTRACTS.USDC)) {
        throw new Error("Invalid USDC address (env)");
      }
      if (!CONTRACTS.yUSDC || !ethers.isAddress(CONTRACTS.yUSDC)) {
        throw new Error("Invalid token address (yUSDC) (env)");
      }
      if (!CONTRACTS.ROUTER || !ethers.isAddress(CONTRACTS.ROUTER)) {
        throw new Error(
          "Swap router address missing. Set NEXT_PUBLIC_SWAP_ROUTER_ADDRESS."
        );
      }

      // Read path: use your RPC
      const read = new ethers.JsonRpcProvider(getRpcUrl());

      // ensure contracts exist
      const [codeUSDC, codeYUSDC, codeRouter] = await Promise.all([
        read.getCode(CONTRACTS.USDC),
        read.getCode(CONTRACTS.yUSDC),
        read.getCode(CONTRACTS.ROUTER),
      ]);
      if (codeUSDC === "0x")
        throw new Error("USDC not deployed on this RPC's chain");
      if (codeYUSDC === "0x")
        throw new Error("Token not deployed on this RPC's chain");
      if (codeRouter === "0x")
        throw new Error("Router not deployed on this RPC's chain");

      // decimals
      const usdcRead = new ethers.Contract(CONTRACTS.USDC, ERC20_ABI, read);
      const tokenRead = new ethers.Contract(CONTRACTS.yUSDC, ERC20_ABI, read);

      const usdcDec = await usdcRead.decimals();
      let tokenDec = 6; // Default to 6 (same as USDC for your vault)

      try {
        const tokenDecRaw = await tokenRead.decimals();
        tokenDec = Number(tokenDecRaw); // Convert BigInt to number
        console.log("yUSDC decimals:", tokenDec);
      } catch (e) {
        console.warn(
          "Could not fetch yUSDC decimals, using default:",
          tokenDec
        );
      }

      // Determine which token is currency0 and which is currency1
      // Uniswap V4 orders tokens by address (lower address is currency0)
      const isUsdcCurrency0 =
        CONTRACTS.USDC.toLowerCase() < CONTRACTS.yUSDC.toLowerCase();
      const currency0 = isUsdcCurrency0 ? CONTRACTS.USDC : CONTRACTS.yUSDC;
      const currency1 = isUsdcCurrency0 ? CONTRACTS.yUSDC : CONTRACTS.USDC;

      // NEW: Determine the swap direction based on what we're buying
      // If buying token1 (yUSDC), and USDC is currency0, then zeroForOne = true
      // If buying token0 (USDC), and USDC is currency0, then zeroForOne = false
      let zeroForOne: boolean;
      let inputToken: string;
      let outputToken: string;

      if (buyingToken1) {
        // Buying yUSDC with USDC
        zeroForOne = isUsdcCurrency0;
        inputToken = CONTRACTS.USDC;
        outputToken = CONTRACTS.yUSDC;
      } else {
        // Buying USDC with yUSDC
        zeroForOne = !isUsdcCurrency0;
        inputToken = CONTRACTS.yUSDC;
        outputToken = CONTRACTS.USDC;
      }

      // convert $ to input token (assuming 1:1 with USD for now)
      const inputDec = buyingToken1 ? usdcDec : tokenDec;
      const outputDec = buyingToken1 ? tokenDec : usdcDec;
      const amountIn = ethers.parseUnits(amountUSD, Number(inputDec));

      console.log("Amount parsing:", {
        amountUSD,
        buyingToken1,
        inputToken,
        outputToken,
        inputDec: Number(inputDec),
        outputDec: Number(outputDec),
        amountIn: amountIn.toString(),
        tokensOutEst,
        lpPrice: lpPriceNum,
      });

      // Calculate expected output with proper decimals
      const grossTokens = parseFloat(amountUSD) / lpPriceNum;
      const tokensAfterFee = grossTokens * (1 - tradingFeePct / 100);

      // Ensure we have enough decimal places for the format
      const decimalPlaces = Math.min(Number(outputDec), 18);
      const estTokensBigInt = ethers.parseUnits(
        tokensAfterFee.toFixed(decimalPlaces),
        Number(outputDec)
      );

      // slippage: 1% default
      const slippagePct = 1;
      const minOut = (estTokensBigInt * BigInt(100 - slippagePct)) / 100n;

      console.log("Output calculation:", {
        grossTokens,
        tokensAfterFee,
        decimalPlaces,
        estTokensBigInt: estTokensBigInt.toString(),
        minOut: minOut.toString(),
        minOutFormatted: ethers.formatUnits(minOut, Number(outputDec)),
      });

      // Signer path
      if (typeof window === "undefined" || !(window as any).ethereum) {
        throw new Error("No wallet found");
      }
      const browserProvider = new ethers.BrowserProvider(
        (window as any).ethereum
      );
      await ensureWalletOnArbSepolia(browserProvider);
      const signer = await browserProvider.getSigner();

      // Verify pool exists by calling the hook
      console.log("Verifying pool state via hook...");
      const hookContract = new ethers.Contract(
        CONTRACTS.HOOK,
        [
          "function currentPrices(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey) view returns (uint256 priceHumanLP, uint256 priceRawE18, uint160 sqrtP)",
        ],
        browserProvider
      );

      // Build poolKey for verification (and later for swap)
      const poolKey = {
        currency0,
        currency1,
        fee: DYNAMIC_FEE_FLAG,
        tickSpacing: 60,
        hooks: CONTRACTS.HOOK,
      };

      try {
        const [priceHuman, priceRaw, sqrtP] = await hookContract.currentPrices(
          poolKey
        );
        console.log("Pool state verified:", {
          priceHuman: priceHuman.toString(),
          priceRaw: ethers.formatUnits(priceRaw, 18),
          sqrtP: sqrtP.toString(),
          poolActive: sqrtP > 0n,
        });

        if (sqrtP === 0n) {
          throw new Error("Pool is not initialized or has no liquidity");
        }
      } catch (poolErr: any) {
        console.error("Pool verification failed:", poolErr);
        throw new Error(
          "Pool verification failed: " + (poolErr?.message || "Unknown error")
        );
      }

      // approve router if needed
      const usdc = new ethers.Contract(CONTRACTS.USDC, ERC20_ABI, signer);
      const yusdc = new ethers.Contract(CONTRACTS.yUSDC, ERC20_ABI, signer);

      // Check balances first
      const [usdcBalance, yusdcBalance] = await Promise.all([
        usdc.balanceOf(account),
        yusdc.balanceOf(account),
      ]);

      const usdcDecNum = Number(usdcDec);
      const tokenDecNum = Number(tokenDec);

      console.log("Token Balances:", {
        usdc: ethers.formatUnits(usdcBalance, usdcDecNum),
        yusdc: ethers.formatUnits(yusdcBalance, tokenDecNum),
        neededInput: ethers.formatUnits(amountIn, Number(inputDec)),
        inputToken: buyingToken1 ? "USDC" : "yUSDC",
      });

      // Check if we have enough of the input token
      const inputBalance = buyingToken1 ? usdcBalance : yusdcBalance;
      if (inputBalance < amountIn) {
        const inputTokenName = buyingToken1 ? "USDC" : "yUSDC";
        throw new Error(
          `Insufficient ${inputTokenName} balance. Have: ${ethers.formatUnits(
            inputBalance,
            Number(inputDec)
          )}, Need: ${ethers.formatUnits(amountIn, Number(inputDec))}`
        );
      }

      // Approve the input token
      const inputTokenContract = buyingToken1 ? usdc : yusdc;
      const allowance: bigint = await inputTokenContract.allowance(
        account,
        CONTRACTS.ROUTER
      );
      const inputTokenName = buyingToken1 ? "USDC" : "yUSDC";

      console.log(`${inputTokenName} Allowance:`, {
        current: ethers.formatUnits(allowance, Number(inputDec)),
        needed: ethers.formatUnits(amountIn, Number(inputDec)),
        needsApproval: allowance < amountIn,
      });

      if (allowance < amountIn) {
        console.log(`Approving ${inputTokenName}...`);
        const approveTx = await inputTokenContract.approve(
          CONTRACTS.ROUTER,
          ethers.MaxUint256
        );
        console.log("Approval tx sent:", approveTx.hash);
        await approveTx.wait();
        console.log(`${inputTokenName} approved`);
      }

      // Also approve the other token (following your Foundry script pattern)
      const otherTokenContract = buyingToken1 ? yusdc : usdc;
      const otherTokenName = buyingToken1 ? "yUSDC" : "USDC";
      const otherAllowance: bigint = await otherTokenContract.allowance(
        account,
        CONTRACTS.ROUTER
      );

      if (otherAllowance === 0n) {
        console.log(`Approving ${otherTokenName}...`);
        const approveTx = await otherTokenContract.approve(
          CONTRACTS.ROUTER,
          ethers.MaxUint256
        );
        await approveTx.wait();
        console.log(`${otherTokenName} approved`);
      }

      // Create the swap router contract
      const swapRouter = new ethers.Contract(
        CONTRACTS.ROUTER,
        SWAP_ROUTER_ABI,
        signer
      );

      const hookData = "0x"; // Empty bytes
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 30); // 30 min

      console.log("Executing swap...", {
        amountIn: amountIn.toString(),
        amountOutMin: minOut.toString(),
        zeroForOne,
        poolKey,
        isUsdcCurrency0,
        buyingToken1,
        swapDirection: zeroForOne
          ? "currency0→currency1"
          : "currency1→currency0",
        actualSwap: `${inputTokenName}(${inputToken}) → ${
          buyingToken1 ? "yUSDC" : "USDC"
        }(${outputToken})`,
      });

      // Execute swap matching your Foundry script
      const tx = await swapRouter.swapExactTokensForTokens(
        amountIn,
        0, // Using 0 for minOut for testing - you can enable minOut for production
        zeroForOne,
        poolKey,
        hookData,
        account, // receiver
        deadline
      );

      const receipt = await tx.wait();
      setTxHash(receipt.hash);
      setAmountUSD("");
      onSuccess?.();
    } catch (e: any) {
      console.error("Buy error:", e);
      console.error("Error data:", e?.data);
      console.error("Error code:", e?.code);

      if (e?.code === 4001) {
        setError("User rejected the transaction");
      } else if (e?.data === "0x8199f5f3") {
        setError(
          "Currency not settled - your swap router might not be compatible with this pool. Verify NEXT_PUBLIC_SWAP_ROUTER_ADDRESS matches your deployed router."
        );
      } else if (/router address missing/i.test(e?.message || "")) {
        setError(e.message);
      } else if (/Too many requests|429/i.test(e?.message || "")) {
        setError(
          "RPC rate-limited; set NEXT_PUBLIC_ALCHEMY_API_KEY or NEXT_PUBLIC_RPC_URL."
        );
      } else if (e?.message?.includes("not deployed")) {
        setError(e.message + " - Check your .env.local addresses");
      } else if (e?.message?.includes("insufficient")) {
        setError("Insufficient balance or liquidity");
      } else {
        setError(e?.reason || e?.message || "Failed to buy tokens");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const explorer = "https://sepolia.arbiscan.io";

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 border-2 border-blue-200">
      {/* NEW: Token Swap Toggle */}
      <div className="mb-6 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-4 border border-blue-200">
        <div className="flex items-center justify-center gap-4">
          <span
            className={`font-semibold text-base transition-colors ${
              !buyingToken1 ? "text-blue-700" : "text-gray-400"
            }`}
          >
            Buy USDC
          </span>
          <button
            onClick={() => setBuyingToken1(!buyingToken1)}
            className={`relative inline-flex h-8 w-16 items-center rounded-full transition-colors ${
              buyingToken1 ? "bg-blue-600" : "bg-gray-400"
            }`}
          >
            <span
              className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform shadow-md ${
                buyingToken1 ? "translate-x-9" : "translate-x-1"
              }`}
            />
          </button>
          <span
            className={`font-semibold text-base transition-colors ${
              buyingToken1 ? "text-purple-700" : "text-gray-400"
            }`}
          >
            Buy yUSDC
          </span>
        </div>
      </div>

      <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
        <span className="text-2xl">💱</span>
        Buy Token ({buyingToken1 ? "yUSDC" : "USDC"})
      </h3>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
          {error}
        </div>
      )}

      {txHash && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-600">
          <div className="font-semibold mb-1">✓ Swap sent!</div>
          <a
            href={`${explorer}/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline break-all"
          >
            View transaction
          </a>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">
            Amount ({buyingToken1 ? "USDC" : "yUSDC"})
          </label>
          <input
            type="number"
            placeholder={`Enter amount in ${buyingToken1 ? "USDC" : "yUSDC"}`}
            value={amountUSD}
            onChange={(e) => setAmountUSD(e.target.value)}
            disabled={isLoading || !account}
            className="w-full px-4 py-3 border-2 border-slate-300 rounded-lg focus:outline-none focus:border-blue-500 text-lg disabled:bg-slate-100 disabled:cursor-not-allowed"
          />
        </div>

        <div className="bg-blue-50 rounded-lg p-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-600">Current LP Price:</span>
            <span className="font-bold text-blue-700">
              ${Number(lpPrice || "0").toFixed(4)}
            </span>
          </div>
          <div className="flex justify-between pt-2 border-t border-blue-200">
            <span className="text-slate-600">You will receive:</span>
            <span className="font-bold text-blue-700">
              ~{tokensOutEst} {buyingToken1 ? "yUSDC" : "USDC"}
            </span>
          </div>
        </div>

        <button
          onClick={handleBuy}
          disabled={isLoading || !amountUSD}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
        >
          {isLoading
            ? "Processing…"
            : !account
            ? "Connect wallet to buy"
            : `Buy ${buyingToken1 ? "yUSDC" : "USDC"}`}
        </button>

        <div className="text-xs text-slate-500 text-center">
          Trade on the liquidity pool at current market price
        </div>
      </div>
    </div>
  );
}
