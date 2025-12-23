'use client'

interface UserBalanceProps {
  usdcBalance: string
  yusdcBalance: string
  isLoading: boolean
  error: string | null
}

export default function UserBalance({ usdcBalance, yusdcBalance, isLoading, error }: UserBalanceProps) {
  return (
    <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl shadow-lg p-6 border-2 border-indigo-200">
      <h2 className="text-2xl font-bold text-slate-800 mb-6 flex items-center gap-2">
        <span className="text-3xl">👤</span>
        Your Balance
      </h2>
      
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
          {error}
        </div>
      )}
      
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white/70 backdrop-blur rounded-lg p-4 border-2 border-indigo-200">
          <div className="text-sm text-slate-600 font-medium mb-2">USDC Balance</div>
          {isLoading ? (
            <div className="text-2xl font-bold text-indigo-400">Loading...</div>
          ) : (
            <>
              <div className="text-4xl font-bold text-indigo-700">{usdcBalance}</div>
              <div className="text-xs text-slate-500 mt-1">USDC</div>
            </>
          )}
        </div>
        
        <div className="bg-white/70 backdrop-blur rounded-lg p-4 border-2 border-purple-200">
          <div className="text-sm text-slate-600 font-medium mb-2">yUSDC Balance</div>
          {isLoading ? (
            <div className="text-2xl font-bold text-purple-400">Loading...</div>
          ) : (
            <>
              <div className="text-4xl font-bold text-purple-700">{yusdcBalance}</div>
              <div className="text-xs text-slate-500 mt-1">yUSDC tokens</div>
            </>
          )}
        </div>
      </div>
      
      <div className="mt-4 text-xs text-slate-500 text-center">
        Arbitrum Sepolia Testnet
      </div>
    </div>
  );
}
