// Create this component: components/ScenariosPreview.tsx

"use client";

import Link from "next/link";

export default function ScenariosPreview() {
  return (
    <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl shadow-lg p-6 border-2 border-indigo-200">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <h3 className="text-2xl font-bold text-slate-800 mb-2 flex items-center gap-2">
            <span className="text-3xl">📊</span>
            Compare Scenarios
          </h3>
          <p className="text-slate-600 mb-4">
            See how scenario Baseline and PegBalancerHook compare side-by-side
            with detailed metrics and explanations.
          </p>

          <div className="flex gap-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-red-500">📉</span>
              <span className="text-slate-700">Baseline (Fixed Fee)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-green-500">⚡</span>
              <span className="text-slate-700">Full System</span>
            </div>
          </div>
        </div>

        <Link
          href="/scenarios"
          className="ml-6 bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-6 py-3 rounded-lg font-bold hover:from-indigo-600 hover:to-purple-700 transition-all shadow-md hover:shadow-lg"
        >
          View Comparison →
        </Link>
      </div>
    </div>
  );
}
