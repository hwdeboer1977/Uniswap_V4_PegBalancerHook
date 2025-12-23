"use client";
import Image from "next/image";

export default function Scenarios() {
  return (
    <div className="bg-white rounded-xl shadow-lg p-6 border-2 border-slate-200">
      <h2 className="text-2xl font-bold text-slate-800 mb-6 flex items-center gap-2">
        <span className="text-3xl">📊</span>
        Scenario Comparison
      </h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Scenario 1: Baseline */}
        <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-xl p-6 border-2 border-red-200">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-red-500 text-white p-3 rounded-lg">
              <span className="text-2xl">📉</span>
            </div>
            <div>
              <h3 className="text-xl font-bold text-red-800">Baseline AMM</h3>
              <p className="text-sm text-red-600">Fixed 0.3% Fee</p>
            </div>
          </div>

          <p className="text-sm text-slate-700 mb-4">
            Standard AMM with no protection mechanism
          </p>

          <div className="space-y-3 bg-white/70 rounded-lg p-4">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Arb Profits:</span>
              <span className="font-bold text-red-700">External MEV</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Earned Fees:</span>
              <span className="font-bold text-red-700">0.30% (fixed)</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">LP Protection:</span>
              <span className="font-bold text-red-700">None</span>
            </div>
          </div>

          <div className="mt-4 bg-red-100 border border-red-300 rounded-lg p-3">
            <p className="text-xs text-red-800">
              <br />
              ❌ MEV bots capture all arbitrage
              <br />
              ❌ High impermanent loss for LPs
              <br />❌ Only fixed 0.30% fee revenue
            </p>
          </div>
        </div>

        {/* Scenario 2: Full System (Dynamic Fees + ArbExecutor) */}
        <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-6 border-2 border-green-200">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-green-500 text-white p-3 rounded-lg">
              <span className="text-2xl">⚡</span>
            </div>
            <div>
              <h3 className="text-xl font-bold text-green-800">
                PegBalancerHook
              </h3>
              <p className="text-sm text-green-600">
                Dynamic Fees + ArbExecutor
              </p>
            </div>
          </div>

          <p className="text-sm text-slate-700 mb-4">
            Automated correction with smart fee optimization
          </p>

          <div className="space-y-3 bg-white/70 rounded-lg p-4">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Arb Profits:</span>
              <span className="font-bold text-green-700">Protocol ✓</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Earned Fees:</span>
              <span className="font-bold text-green-700">0.05% - 10%</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">LP Protection:</span>
              <span className="font-bold text-green-700">Active</span>
            </div>
          </div>

          <div className="mt-4 bg-green-100 border border-green-300 rounded-lg p-3">
            <p className="text-xs text-green-800">
              <br />
              ✅ Protocol captures arbitrage profits
              <br />
              ✅ Dynamic fees maximize revenue
              <br />✅ Minimal IL for liquidity providers
            </p>
          </div>
        </div>
      </div>

      {/* Detailed Comparison Chart */}
      <div className="mt-8 bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-6 border-2 border-slate-200">
        <div className="bg-white rounded-lg p-4 shadow-inner">
          <Image
            src="/image/baseline_vs_pegbalancer_144k.png"
            alt="Baseline vs PegBalancerHook comparison showing 17.4x revenue increase with 144K trading volume"
            width={1400}
            height={600}
            priority
            className="w-full h-auto rounded-lg"
          />
        </div>

        {/* Key Metrics */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-lg p-4 border-2 border-green-200">
            <div className="text-3xl font-bold text-green-600 mb-1">17.4x</div>
            <div className="text-sm text-slate-600">Revenue Multiplier</div>
          </div>

          <div className="bg-white rounded-lg p-4 border-2 border-blue-200">
            <div className="text-3xl font-bold text-blue-600 mb-1">$7,506</div>
            <div className="text-sm text-slate-600">
              PegBalancerHook Revenue
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
