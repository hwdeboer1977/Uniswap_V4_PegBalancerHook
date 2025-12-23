"use client";

import { useState } from "react";
import Scenarios from "@/components/Scenarios";
import Link from "next/link";

export default function ScenariosPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 mb-4"
          >
            ← Back to Dashboard
          </Link>

          <h1 className="text-5xl font-bold text-slate-800 mb-2">
            Scenario Comparison
          </h1>
          <p className="text-lg text-slate-600">
            Compare Baseline, Soft Peg, and Full System performance
          </p>
        </div>

        {/* Scenarios Component */}
        <div className="mb-8">
          <Scenarios />
        </div>

        {/* CTA Section */}
        <div className="mt-8 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl shadow-lg p-8 text-center text-white">
          <h2 className="text-3xl font-bold mb-4">Ready to Try It Out?</h2>
          <p className="text-xl mb-6">
            Experience the Full System with dynamic fees and automated arbitrage
          </p>
          <Link
            href="/"
            className="inline-block bg-white text-blue-600 px-8 py-3 rounded-lg font-bold text-lg hover:bg-blue-50 transition-colors"
          >
            Go to Dashboard →
          </Link>
        </div>
      </div>
    </main>
  );
}
