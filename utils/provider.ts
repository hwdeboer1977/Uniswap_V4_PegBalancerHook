import { ethers } from 'ethers'
import { getRpcUrl, ARBITRUM_SEPOLIA_CHAIN_ID } from '@/constants/contracts'

/**
 * Get a JSON-RPC provider using Alchemy
 * Falls back to browser provider if window.ethereum is available
 */
export function getProvider(): ethers.JsonRpcProvider | ethers.BrowserProvider {
  if (typeof window !== 'undefined' && window.ethereum) {
    return new ethers.BrowserProvider(window.ethereum)
  }
  
  // Use Alchemy RPC for read-only operations
  const rpcUrl = getRpcUrl()
  return new ethers.JsonRpcProvider(rpcUrl, ARBITRUM_SEPOLIA_CHAIN_ID)
}

/**
 * Get a read-only provider (always uses Alchemy)
 */
export function getReadOnlyProvider(): ethers.JsonRpcProvider {
  const rpcUrl = getRpcUrl()
  return new ethers.JsonRpcProvider(rpcUrl, ARBITRUM_SEPOLIA_CHAIN_ID)
}
