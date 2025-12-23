'use client'

import { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import { ARBITRUM_SEPOLIA, ARBITRUM_SEPOLIA_CHAIN_ID } from '@/constants/contracts'

interface WalletConnectProps {
  onAccountChange: (account: string | null) => void
}

export default function WalletConnect({ onAccountChange }: WalletConnectProps) {
  const [account, setAccount] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Check if wallet is already connected on page load
  useEffect(() => {
    checkIfWalletIsConnected()
  }, [])

  // Listen for account changes
  useEffect(() => {
    if (typeof window !== 'undefined' && window.ethereum) {
      window.ethereum.on('accountsChanged', handleAccountsChanged)
      window.ethereum.on('chainChanged', () => window.location.reload())
      
      return () => {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged)
      }
    }
  }, [])

  // Notify parent component when account changes
  useEffect(() => {
    onAccountChange(account)
  }, [account, onAccountChange])

  const handleAccountsChanged = (accounts: string[]) => {
    if (accounts.length === 0) {
      setAccount(null)
    } else {
      setAccount(accounts[0])
    }
  }

  const checkIfWalletIsConnected = async () => {
    try {
      if (typeof window !== 'undefined' && window.ethereum) {
        const provider = new ethers.BrowserProvider(window.ethereum)
        const accounts = await provider.listAccounts()
        
        if (accounts.length > 0) {
          setAccount(accounts[0].address)
          await checkNetwork()
        }
      }
    } catch (err) {
      console.error('Error checking wallet connection:', err)
    }
  }

  const checkNetwork = async () => {
    try {
      if (typeof window !== 'undefined' && window.ethereum) {
        const provider = new ethers.BrowserProvider(window.ethereum)
        const network = await provider.getNetwork()
        
        if (Number(network.chainId) !== ARBITRUM_SEPOLIA_CHAIN_ID) {
          setError('Wrong network! Please switch to Arbitrum Sepolia')
        } else {
          setError(null)
        }
      }
    } catch (err) {
      console.error('Error checking network:', err)
    }
  }

  const switchToArbitrumSepolia = async () => {
    try {
      if (typeof window !== 'undefined' && window.ethereum) {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: ARBITRUM_SEPOLIA.chainId }],
        })
        setError(null)
      }
    } catch (err: any) {
      // Chain not added, try to add it
      if (err.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [ARBITRUM_SEPOLIA],
          })
          setError(null)
        } catch (addError) {
          console.error('Error adding network:', addError)
          setError('Failed to add Arbitrum Sepolia network')
        }
      } else {
        console.error('Error switching network:', err)
        setError('Failed to switch network')
      }
    }
  }

  const connectWallet = async () => {
    setError(null)
    setIsConnecting(true)

    try {
      // Check if MetaMask/Rabby is installed
      if (typeof window === 'undefined' || !window.ethereum) {
        setError('Please install MetaMask or Rabby Wallet!')
        setIsConnecting(false)
        return
      }

      // Request account access
      const provider = new ethers.BrowserProvider(window.ethereum)
      const accounts = await provider.send('eth_requestAccounts', [])
      
      if (accounts.length > 0) {
        setAccount(accounts[0])
        console.log('Connected to wallet:', accounts[0])
        await checkNetwork()
      }
    } catch (err: any) {
      console.error('Error connecting wallet:', err)
      if (err.code === 4001) {
        setError('Connection rejected by user')
      } else {
        setError('Failed to connect wallet')
      }
    } finally {
      setIsConnecting(false)
    }
  }

  const disconnectWallet = () => {
    setAccount(null)
    setError(null)
  }

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`
  }

  return (
    <div className="bg-white rounded-xl shadow-lg p-4 border-2 border-slate-200">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">👛</span>
          <div>
            <div className="text-sm text-slate-600 font-medium">Wallet</div>
            {account ? (
              <div className="text-xs font-mono text-green-600 font-bold">
                {formatAddress(account)}
              </div>
            ) : (
              <div className="text-xs text-slate-500">Not Connected</div>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {error && (
            <div className="text-xs text-red-600 font-medium">
              {error}
              {error.includes('Wrong network') && (
                <button 
                  onClick={switchToArbitrumSepolia}
                  className="ml-2 underline hover:text-red-700"
                >
                  Switch Network
                </button>
              )}
            </div>
          )}
          
          {account ? (
            <button 
              onClick={disconnectWallet}
              className="bg-red-500 hover:bg-red-600 text-white font-bold py-3 px-6 rounded-lg transition-all flex items-center gap-2"
            >
              <svg 
                width="20" 
                height="20" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2" 
                strokeLinecap="round" 
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
              Disconnect
            </button>
          ) : (
            <button 
              onClick={connectWallet}
              disabled={isConnecting}
              className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-bold py-3 px-6 rounded-lg transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg 
                width="20" 
                height="20" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2" 
                strokeLinecap="round" 
                strokeLinejoin="round"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
              {isConnecting ? 'Connecting...' : 'Connect Wallet'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// TypeScript declaration for window.ethereum
declare global {
  interface Window {
    ethereum?: any
  }
}
