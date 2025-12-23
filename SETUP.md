# Quick Setup Guide

## 🚀 Get Started in 3 Steps

### 1. Copy Environment File
```bash
cp .env.example .env.local
```

### 2. Add Your Alchemy API Key

Edit `.env.local` and replace:
```env
NEXT_PUBLIC_ALCHEMY_API_KEY=your_alchemy_api_key_here
```

With your actual Alchemy API key from: https://www.alchemy.com/

**Free tier is sufficient for development!**

### 3. Run the App
```bash
npm install
npm run dev
```

Open http://localhost:3000

## ✅ What's Configured

All addresses and settings are already set for **Arbitrum Sepolia**:

✓ USDC Contract  
✓ yUSDC/Vault Contract  
✓ Hook Contract  
✓ Pool Configuration  
✓ Soft Peg Settings  

## 🔧 Need to Change Something?

All configuration is in `.env.local`:
- Contract addresses
- Pool settings (fee, tick spacing)
- Soft peg parameters (deadzone, base fee)
- Network settings

## 📝 Important Notes

- `.env.local` is git-ignored (safe to add secrets)
- Never commit your Alchemy API key
- Use `.env.example` as reference
- Restart dev server after changing `.env.local`

## 🆘 Troubleshooting

**"Failed to fetch" errors?**
→ Check your Alchemy API key is correct

**"Wrong network" errors?**
→ Switch MetaMask to Arbitrum Sepolia

**Contract not found?**
→ Verify addresses in `.env.local` match deployed contracts

## 📚 Full Documentation

See `README.md` for complete documentation.
