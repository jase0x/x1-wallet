// Known Tokens Database
// Hardcoded token metadata for reliable display of common tokens
// Add new tokens here to ensure they display correctly in the wallet

// ============================================
// XDEX LP TOKEN DETECTION
// ============================================

// XDEX Program ID: sEsYH97wqmfnkzHedjNcw3zyJdPvUmsa9AixhS4b4fN
// XDEX LP Mint Authority (PDA derived from program) - used for LP token detection
export const XDEX_LP_MINT_AUTHORITY = '9Dpjw2pB5kXJr6ZTHiqzEMfJPic3om9jgNacnwpLCoaU';
export const XLP_LOGO_URL = 'https://xdex.s3.us-east-2.amazonaws.com/tokens/48-xlp.png';

// ============================================
// KNOWN TOKENS (All Networks)
// ============================================

export const KNOWN_TOKENS = {
  // === Native/Wrapped Tokens ===
  'So11111111111111111111111111111111111111112': {
    symbol: 'SOL',
    name: 'Wrapped SOL',
    decimals: 9,
    logoURI: 'https://xdex.s3.us-east-2.amazonaws.com/vimages/solana.png'
  },
  
  // === Stablecoins ===
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    logoURI: 'https://cryptologos.cc/logos/usd-coin-usdc-logo.png'
  },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': {
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    logoURI: 'https://cryptologos.cc/logos/tether-usdt-logo.png'
  },
  'B69chRzqzDCmdB5WYB8NRu5Yv5ZA95ABiZcdzCgGm9Tq': {
    symbol: 'USDC.X',
    name: 'USDC X1',
    decimals: 6,
    logoURI: 'https://x1logos.s3.us-east-1.amazonaws.com/48-usdcx.png',
    isToken2022: true,
    price: 1
  },
  
  // === Liquid Staking Tokens ===
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': {
    symbol: 'mSOL',
    name: 'Marinade staked SOL',
    decimals: 9,
    logoURI: 'https://raw.githubusercontent.com/marinade-finance/msol-logo/main/msol-logo.png'
  },
  'pXNTyoqQsskHdZ7Q1rnP25FEyHHjissbs7n6RRN2nP5': {
    symbol: 'pXNT',
    name: 'Staked XNT',
    decimals: 9,
    logoURI: 'https://x1logos.s3.us-east-1.amazonaws.com/48-pxnt.png',
    isToken2022: false,
    isStakePoolToken: true,
    price: 1
  },
  
  // === Popular Tokens ===
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': {
    symbol: 'BONK',
    name: 'Bonk',
    decimals: 5,
    logoURI: 'https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I'
  },
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': {
    symbol: 'JUP',
    name: 'Jupiter',
    decimals: 6,
    logoURI: 'https://static.jup.ag/jup/icon.png'
  },
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs': {
    symbol: 'ETH',
    name: 'Ether (Wormhole)',
    decimals: 8,
    logoURI: 'https://cryptologos.cc/logos/ethereum-eth-logo.png'
  },
  
  // === X1 Ecosystem Tokens ===
  'DohWBfvXER6qs8zFGtdZRDpgbHmm97ZZwgCUTCdtHQNT': {
    symbol: 'MIND',
    name: 'Mind',
    decimals: 9,
    logoURI: 'https://xdex.s3.us-east-2.amazonaws.com/tokens/mind-48.png'
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
      logoURI: 'https://x1logos.s3.us-east-1.amazonaws.com/48.png'
    }
  },
  'X1 Testnet': {
    'So11111111111111111111111111111111111111112': {
      symbol: 'WXNT',
      name: 'Wrapped XNT',
      decimals: 9,
      logoURI: 'https://x1logos.s3.us-east-1.amazonaws.com/48.png'
    }
  },
  'Solana Mainnet': {
    'So11111111111111111111111111111111111111112': {
      symbol: 'SOL',
      name: 'Solana',
      decimals: 9,
      logoURI: 'https://xdex.s3.us-east-2.amazonaws.com/vimages/solana.png'
    },
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      logoURI: 'https://cryptologos.cc/logos/usd-coin-usdc-logo.png'
    },
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': {
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
      logoURI: 'https://cryptologos.cc/logos/tether-usdt-logo.png'
    }
  },
  'Solana Devnet': {
    'So11111111111111111111111111111111111111112': {
      symbol: 'SOL',
      name: 'Solana',
      decimals: 9,
      logoURI: 'https://xdex.s3.us-east-2.amazonaws.com/vimages/solana.png'
    }
  }
};

// X1 token overrides for custom networks
export const X1_TOKEN_OVERRIDES = {
  'So11111111111111111111111111111111111111112': {
    symbol: 'WXNT',
    name: 'Wrapped XNT',
    decimals: 9,
    logoURI: 'https://x1logos.s3.us-east-1.amazonaws.com/48.png'
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