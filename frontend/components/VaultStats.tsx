'use client'

interface VaultStatsProps {
  totalAssets: string
  totalShares: string
  sharePrice: string
  assetsPerShare: string
  isLoading: boolean
  error: string | null
}

export default function VaultStats({
  totalAssets,
  totalShares,
  sharePrice,
  assetsPerShare,
  isLoading,
  error
}: VaultStatsProps) {
  return (
    <div className="bg-white rounded-xl shadow-lg p-6 border-2 border-green-100">
      <h2 className="text-2xl font-bold text-slate-800 mb-6 flex items-center gap-2">
        <span className="text-3xl">🏦</span>
        Vault Stats
      </h2>
      
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
          {error}
        </div>
      )}
      
      <div className="space-y-4">
        <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
          <span className="text-slate-600 font-medium">Total Assets</span>
          {isLoading ? (
            <span className="text-xl font-bold text-green-400">Loading...</span>
          ) : (
            <span className="text-2xl font-bold text-green-700">${totalAssets}</span>
          )}
        </div>
        
        <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
          <span className="text-slate-600 font-medium">Total Shares</span>
          {isLoading ? (
            <span className="text-xl font-bold text-blue-400">Loading...</span>
          ) : (
            <span className="text-2xl font-bold text-blue-700">{totalShares}</span>
          )}
        </div>
        
        <div className="flex justify-between items-center p-3 bg-purple-50 rounded-lg">
          <span className="text-slate-600 font-medium">Share Price (NAV)</span>
          {isLoading ? (
            <span className="text-xl font-bold text-purple-400">Loading...</span>
          ) : (
            <span className="text-2xl font-bold text-purple-700">${sharePrice}</span>
          )}
        </div>
        
        <div className="flex justify-between items-center p-3 bg-indigo-50 rounded-lg">
          <span className="text-slate-600 font-medium">Assets per Share</span>
          {isLoading ? (
            <span className="text-xl font-bold text-indigo-400">Loading...</span>
          ) : (
            <span className="text-2xl font-bold text-indigo-700">${assetsPerShare}</span>
          )}
        </div>
      </div>
      
      <div className="mt-4 p-3 bg-blue-50 border-2 border-blue-200 rounded-lg text-center">
        <span className="text-blue-800 font-semibold">Mint/Redeem Fee: 0.00%</span>
      </div>
      
      <div className="mt-2 text-xs text-slate-500 text-center">
        Auto-refreshes every 10 seconds
      </div>
    </div>
  );
}
