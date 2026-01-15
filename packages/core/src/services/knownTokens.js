// Known Tokens Database
// Hardcoded token metadata for reliable display of common tokens
// Add new tokens here to ensure they display correctly in the wallet

// ============================================
// LOCAL ICON PATHS (stored in /public/icons/)
// ============================================
export const ICONS = {
  X1: '/icons/48-x1.png',
  PXNT: '/icons/48-pxnt.png',
  USDCX: '/icons/48-usdcx.png',
  CORE: '/icons/48-core.png',
  XLP: '/icons/48-xlp.png',
  XDEX: '/icons/48-xdex.png',
  WALLET: '/icons/48-wallet.png',
  DEGEN: '/icons/48-degen.png',
  // External icons (third-party tokens)
  SOL: '/icons/48-sol.png',
  USDC: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
  USDT: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png',
  MSOL: 'https://raw.githubusercontent.com/marinade-finance/msol-logo/main/msol-logo.png',
  BONK: 'https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I',
  JUP: 'https://static.jup.ag/jup/icon.png',
  ETH: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs/logo.png',
  MIND: 'https://xdex.s3.us-east-2.amazonaws.com/tokens/mind-48.png'
};

// ============================================
// XDEX LP TOKEN DETECTION
// ============================================

// XDEX Program ID: sEsYH97wqmfnkzHedjNcw3zyJdPvUmsa9AixhS4b4fN
// XDEX LP Mint Authority (PDA derived from program) - used for LP token detection
export const XDEX_LP_MINT_AUTHORITY = '9Dpjw2pB5kXJr6ZTHiqzEMfJPic3om9jgNacnwpLCoaU';
export const XLP_LOGO_URL = ICONS.XLP;

// ============================================
// KNOWN TOKENS (All Networks)
// ============================================

export const KNOWN_TOKENS = {
  // === Native/Wrapped Tokens ===
  'So11111111111111111111111111111111111111112': {
    symbol: 'SOL',
    name: 'Wrapped SOL',
    decimals: 9,
    logoURI: ICONS.SOL
  },
  
  // === Stablecoins ===
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    logoURI: ICONS.USDC
  },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': {
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    logoURI: ICONS.USDT
  },
  'B69chRzqzDCmdB5WYB8NRu5Yv5ZA95ABiZcdzCgGm9Tq': {
    symbol: 'USDC.X',
    name: 'USDC X1',
    decimals: 6,
    logoURI: ICONS.USDCX,
    isToken2022: true,
    price: 1
  },
  
  // === Liquid Staking Tokens ===
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': {
    symbol: 'mSOL',
    name: 'Marinade staked SOL',
    decimals: 9,
    logoURI: ICONS.MSOL
  },
  'pXNTyoqQsskHdZ7Q1rnP25FEyHHjissbs7n6RRN2nP5': {
    symbol: 'pXNT',
    name: 'Staked XNT',
    decimals: 9,
    logoURI: ICONS.PXNT,
    isToken2022: false,
    isStakePoolToken: true,
    price: 1
  },
  
  // === Popular Tokens ===
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': {
    symbol: 'BONK',
    name: 'Bonk',
    decimals: 5,
    logoURI: ICONS.BONK
  },
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': {
    symbol: 'JUP',
    name: 'Jupiter',
    decimals: 6,
    logoURI: ICONS.JUP
  },
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs': {
    symbol: 'ETH',
    name: 'Ether (Wormhole)',
    decimals: 8,
    logoURI: ICONS.ETH
  },
  
  // === X1 Ecosystem Tokens ===
  'DohWBfvXER6qs8zFGtdZRDpgbHmm97ZZwgCUTCdtHQNT': {
    symbol: 'MIND',
    name: 'Mind',
    decimals: 9,
    logoURI: ICONS.MIND
  }
};

// ============================================
// NETWORK-SPECIFIC OVERRIDES
// ============================================

export const NETWORK_TOKEN_OVERRIDES = {
  'X1 Mainnet': {
    'So11111111111111111111111111111111111111112': {
      symbol: 'WXNT',
      name: 'Wrapped XNT',
      decimals: 9,
      logoURI: ICONS.X1
    }
  },
  'X1 Testnet': {
    'So11111111111111111111111111111111111111112': {
      symbol: 'WXNT',
      name: 'Wrapped XNT',
      decimals: 9,
      logoURI: ICONS.X1
    }
  },
  'Solana Mainnet': {
    'So11111111111111111111111111111111111111112': {
      symbol: 'SOL',
      name: 'Solana',
      decimals: 9,
      logoURI: ICONS.SOL
    },
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      logoURI: ICONS.USDC
    },
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': {
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
      logoURI: ICONS.USDT
    }
  },
  'Solana Devnet': {
    'So11111111111111111111111111111111111111112': {
      symbol: 'SOL',
      name: 'Solana',
      decimals: 9,
      logoURI: ICONS.SOL
    }
  }
};

// X1 token overrides for custom networks
export const X1_TOKEN_OVERRIDES = {
  'So11111111111111111111111111111111111111112': {
    symbol: 'WXNT',
    name: 'Wrapped XNT',
    decimals: 9,
    logoURI: ICONS.X1
  }
};

// ============================================
// HELPER FUNCTIONS
// ============================================

// Check if a network is X1-based
export function isX1Network(network) {
  if (!network) return false;
  if (network === 'X1 Mainnet' || network === 'X1 Testnet') return true;
  
  const lowerName = network.toLowerCase();
  if (lowerName.includes('x1') || lowerName.includes('xnt')) return true;
  
  try {
    const customNetworks = JSON.parse(localStorage.getItem('x1wallet_customRpcs') || '[]');
    const customNet = customNetworks.find(n => n.name === network);
    if (customNet) {
      const url = customNet.url?.toLowerCase() || '';
      if (url.includes('x1.xyz') || url.includes('x1.') || url.includes('/x1') || 
          customNet.symbol?.toUpperCase() === 'XNT') {
        return true;
      }
    }
  } catch {}
  
  return false;
}

// Get token metadata with network-specific overrides
export function getKnownTokenMetadata(mint, network) {
  const networkOverrides = NETWORK_TOKEN_OVERRIDES[network];
  if (networkOverrides && networkOverrides[mint]) {
    return networkOverrides[mint];
  }
  
  if (isX1Network(network) && X1_TOKEN_OVERRIDES[mint]) {
    return X1_TOKEN_OVERRIDES[mint];
  }
  
  return KNOWN_TOKENS[mint] || null;
}
