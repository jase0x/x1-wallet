// Swap API service
// Uses XDEX API for ALL quotes/swaps (fees baked in)
// Uses Jupiter API for Solana token list

import { logger } from '../utils/logger.js';

const XDEX_API = 'https://api.xdex.xyz/api/xendex';
const JUPITER_TOKEN_API = 'https://lite-api.jup.ag/tokens/v2';

// Token metadata cache - prevents repeated API calls for same tokens
// Stores both successful and failed lookups
const tokenMetadataCache = new Map();
const CACHE_TTL_SUCCESS = 30 * 60 * 1000; // 30 minutes for successful lookups
const CACHE_TTL_FAILED = 5 * 60 * 1000;   // 5 minutes for failed lookups (404s)

function getCachedMetadata(mintAddress) {
  const cached = tokenMetadataCache.get(mintAddress);
  if (!cached) return null;
  
  const age = Date.now() - cached.timestamp;
  const ttl = cached.failed ? CACHE_TTL_FAILED : CACHE_TTL_SUCCESS;
  
  if (age > ttl) {
    tokenMetadataCache.delete(mintAddress);
    return null;
  }
  
  return cached;
}

function setCachedMetadata(mintAddress, data, failed = false) {
  tokenMetadataCache.set(mintAddress, {
    data,
    failed,
    timestamp: Date.now()
  });
}

// Logo URLs
const XDEX_LOGOS = {
  X1: '/icons/48-x1.png',
  WXNT: '/icons/48-x1.png',
  SOL: '/icons/48-sol.png',
  USDC: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
  USDC_X: '/icons/48-usdcx.png',
};

// Known tokens registry by network (for immediate recognition)
const KNOWN_TOKENS = {
  'X1 Mainnet': {
    'B69chRzqzDCmdB5WYB8NRu5Yv5ZA95ABiZcdzCgGm9Tq': {
      symbol: 'USDC.X',
      name: 'USD Coin (X1)',
      decimals: 6,
      logoURI: XDEX_LOGOS.USDC_X,
      isToken2022: true,
      price: 1
    },
    'AvNDf423kEmWNP6AZHFV7DkNG4YRgt6qbdyyryjaa4PQ': {
      symbol: 'XNM',
      name: 'Xenium',
      decimals: 9,
      logoURI: 'https://mint.xdex.xyz/ipfs/bafkreidzj5vsbzgojfultyykflh322ypmbzpl7wngq7qxfjxzl3hql47ge?pinataGatewayToken=yMPvcPv-nyFCJ0GGUmoHxYkuVS6bZxS_ucWqpMpVMedA3_nOdJO5uUqA8dibii5a',
      isToken2022: true
    },
    // Add more X1 Mainnet tokens here
  },
  'X1 Testnet': {
    'B69chRzqzDCmdB5WYB8NRu5Yv5ZA95ABiZcdzCgGm9Tq': {
      symbol: 'USDC.X',
      name: 'USD Coin (X1)',
      decimals: 6,
      logoURI: XDEX_LOGOS.USDC_X,
      isToken2022: true,
      price: 1
    },
    'AvNDf423kEmWNP6AZHFV7DkNG4YRgt6qbdyyryjaa4PQ': {
      symbol: 'XNM',
      name: 'Xenium',
      decimals: 9,
      logoURI: 'https://mint.xdex.xyz/ipfs/bafkreidzj5vsbzgojfultyykflh322ypmbzpl7wngq7qxfjxzl3hql47ge?pinataGatewayToken=yMPvcPv-nyFCJ0GGUmoHxYkuVS6bZxS_ucWqpMpVMedA3_nOdJO5uUqA8dibii5a',
      isToken2022: true
    },
    // Add more X1 Testnet tokens here
  },
  'Solana Mainnet': {
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      logoURI: XDEX_LOGOS.USDC,
      isToken2022: false
    },
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': {
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
      logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.svg',
      isToken2022: false
    },
    // Add more Solana Mainnet tokens here
  },
  'Solana Devnet': {
    // Devnet has different token addresses
  }
};

// Legacy export for backwards compatibility
const X1_KNOWN_TOKENS = KNOWN_TOKENS['X1 Mainnet'];

// Popular Solana token mints (fallback if API fails)
const SOLANA_TOKENS = {
  'SOL': 'So11111111111111111111111111111111111111112',
  'USDC': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'USDT': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'JUP': 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  'BONK': 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  'RAY': '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  'PYTH': 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
  'WIF': 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  'ORCA': 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
  'MSOL': 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
};

// Token decimals
const TOKEN_DECIMALS = {
  'SOL': 9,
  'USDC': 6,
  'USDT': 6,
  'JUP': 6,
  'BONK': 5,
  'RAY': 6,
  'PYTH': 6,
  'WIF': 6,
  'ORCA': 6,
  'MSOL': 9,
  'XNT': 9,
  'USDC.X': 6,
};

/**
 * Check if network is Solana
 */
function isSolanaNetwork(network) {
  return network === 'Solana Mainnet' || network === 'Solana Devnet';
}

/**
 * Check if network is X1 (including custom X1 networks)
 */
function isX1Network(network) {
  if (!network) return false;
  // Built-in X1 networks
  if (network === 'X1 Mainnet' || network === 'X1 Testnet') return true;
  // Check if name contains X1 indicators
  const lowerName = network.toLowerCase();
  if (lowerName.includes('x1') || lowerName.includes('xnt')) return true;
  // Check custom networks for X1-related RPC URLs
  try {
    const customNetworks = JSON.parse(localStorage.getItem('x1wallet_customRpcs') || '[]');
    const customNet = customNetworks.find(n => n.name === network);
    if (customNet) {
      const url = customNet.url?.toLowerCase() || '';
      // Check if RPC URL indicates X1 network
      if (url.includes('x1.xyz') || url.includes('x1.') || url.includes('/x1')) return true;
      // Check if symbol is XNT
      if (customNet.symbol?.toUpperCase() === 'XNT') return true;
    }
  } catch (e) {
    // Ignore localStorage errors
  }
  return false;
}

/**
 * Get known token for a network
 */
function getKnownToken(network, mintAddress) {
  const networkTokens = KNOWN_TOKENS[network] || {};
  return networkTokens[mintAddress] || null;
}

/**
 * Map network name to API network parameter
 */
function getNetworkName(network) {
  switch (network) {
    case 'X1 Mainnet': return 'X1 Mainnet';
    case 'X1 Testnet': return 'X1 Testnet';
    case 'Solana Mainnet': return 'Solana Mainnet';
    case 'Solana Devnet': return 'Solana Devnet';
    default: return network || 'X1 Mainnet';
  }
}

// ============================================
// XDEX API - Used for ALL quotes and swaps
// ============================================

/**
 * Get swap quote from XDEX API (works for X1 and Solana)
 * @param {string} tokenIn - Token symbol or mint address
 * @param {string} tokenOut - Token symbol or mint address  
 * @param {string} amountIn - Amount to swap
 * @param {string} network - Network name
 * @param {Object} tokenInData - Optional full token data with mint address
 * @param {Object} tokenOutData - Optional full token data with mint address
 */
// Native token address used by XDEX API (same as wrapped SOL for all networks)
const NATIVE_TOKEN_ADDRESS = 'So11111111111111111111111111111111111111112';

export async function getQuote(tokenIn, tokenOut, amountIn, network, tokenInData = null, tokenOutData = null) {
  // Validate amount
  const parsedAmount = parseFloat(amountIn);
  if (!amountIn || isNaN(parsedAmount) || parsedAmount <= 0) {
    throw new Error('Invalid amount');
  }
  
  // Validate token parameters
  if (!tokenIn && !tokenInData?.mint) {
    throw new Error('Invalid input token');
  }
  if (!tokenOut && !tokenOutData?.mint) {
    throw new Error('Invalid output token');
  }

  const networkName = getNetworkName(network);
  
  // Determine what to send as token identifiers
  // XDEX API uses So11111111111111111111111111111111111111112 for native tokens on ALL networks
  let tokenInParam = tokenIn;
  let tokenOutParam = tokenOut;
  
  // Handle token_in
  if (tokenInData) {
    if (tokenInData.mint === 'native' || tokenInData.isNative || !tokenInData.mint || tokenInData.mint.startsWith('native_')) {
      // Native token - use the standard native address
      tokenInParam = NATIVE_TOKEN_ADDRESS;
    } else {
      // SPL token - use mint address
      tokenInParam = tokenInData.mint;
    }
  } else if (tokenIn === 'XNT' || tokenIn === 'SOL') {
    // Symbol passed without data - use native address
    tokenInParam = NATIVE_TOKEN_ADDRESS;
  }
  
  // Handle token_out
  if (tokenOutData) {
    if (tokenOutData.mint === 'native' || tokenOutData.isNative || !tokenOutData.mint || tokenOutData.mint.startsWith('native_')) {
      // Native token - use the standard native address
      tokenOutParam = NATIVE_TOKEN_ADDRESS;
    } else {
      // SPL token - use mint address
      tokenOutParam = tokenOutData.mint;
    }
  } else if (tokenOut === 'XNT' || tokenOut === 'SOL') {
    // Symbol passed without data - use native address
    tokenOutParam = NATIVE_TOKEN_ADDRESS;
  }
  
  // Convert amount to lamports/smallest unit based on decimals
  const decimals = tokenInData?.decimals || 9;
  const amountInSmallest = Math.floor(parseFloat(amountIn) * Math.pow(10, decimals));
  
  // XDEX API required parameters
  const params = new URLSearchParams({
    network: networkName,
    token_in: tokenInParam,
    token_out: tokenOutParam,
    token_in_amount: amountIn.toString(),
    is_exact_amount_in: 'true'
  });
  
  logger.log('[XDEX] Getting quote:', {
    url: `${XDEX_API}/swap/quote`,
    params: Object.fromEntries(params),
    tokenIn: tokenInParam,
    tokenOut: tokenOutParam,
    amount: amountIn,
    amountSmallest: amountInSmallest,
    decimals,
    network: networkName
  });
  
  try {
    const response = await fetch(`${XDEX_API}/swap/quote?${params}`, {
      method: 'GET',
      headers: { 
        'Accept': 'application/json'
      }
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      logger.error('[XDEX] Quote error response:', {
        status: response.status,
        data,
        requestParams: Object.fromEntries(params)
      });
      
      let errorMsg = data.error || data.message || '';
      
      // Strip HTML tags
      errorMsg = errorMsg.replace(/<[^>]*>/g, '').trim();
      
      // Check for rate limit first
      if (response.status === 429 || errorMsg.includes('429') || errorMsg.includes('Too Many Requests')) {
        throw new Error('Too many requests. Please wait a moment and try again.');
      }
      
      // Provide user-friendly error messages
      if (errorMsg.includes('Pool not found') || errorMsg.includes('No pool')) {
        throw new Error('No liquidity pool exists for this pair');
      }
      if (errorMsg.includes('Invalid token') || errorMsg.includes('address format')) {
        throw new Error('Invalid token address');
      }
      if (response.status === 404 || errorMsg.includes('No route') || errorMsg.includes('Route not found')) {
        throw new Error('No swap route available');
      }
      if (response.status === 400) {
        throw new Error(errorMsg || 'Invalid request');
      }
      throw new Error(errorMsg || `Quote failed: ${response.status}`);
    }
    
    logger.log('[XDEX] Quote response:', data);
    return { ...data, provider: 'xdex' };
  } catch (error) {
    logger.error('[XDEX] Quote fetch error:', error);
    throw error;
  }
}

/**
 * Prepare swap transaction from XDEX API
 * @param {string} walletAddress - User's wallet public key
 * @param {string} tokenIn - Input token mint address
 * @param {string} tokenOut - Output token mint address
 * @param {number} amountIn - Amount to swap
 * @param {string} network - Network name
 * @param {number} slippageBps - Slippage tolerance in basis points (e.g., 50 = 0.5%)
 */
export async function prepareSwap(walletAddress, tokenIn, tokenOut, amountIn, network, slippageBps = 50) {
  // Validate required parameters
  if (!walletAddress || typeof walletAddress !== 'string') {
    throw new Error('Invalid wallet address');
  }
  if (!tokenIn || typeof tokenIn !== 'string') {
    throw new Error('Invalid input token');
  }
  if (!tokenOut || typeof tokenOut !== 'string') {
    throw new Error('Invalid output token');
  }
  
  const parsedAmount = parseFloat(amountIn);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    throw new Error('Invalid swap amount');
  }
  
  const networkName = getNetworkName(network);
  
  const payload = {
    network: networkName,
    wallet: walletAddress,
    token_in: tokenIn,
    token_out: tokenOut,
    token_in_amount: parsedAmount,
    is_exact_amount_in: true,
    slippage_bps: slippageBps,
    slippage: slippageBps / 100, // Also send as percentage for compatibility
    wrap_unwrap_sol: true, // Explicitly request SOL wrapping/unwrapping
    use_shared_accounts: true // Use shared accounts for better success rate
  };
  
  logger.log('[XDEX] Preparing swap:', JSON.stringify(payload));
  
  const response = await fetch(`${XDEX_API}/swap/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    logger.error('[XDEX] Prepare failed:', response.status);
    logger.error('[XDEX] Error response:', JSON.stringify(data));
    let errorMsg = data.error || data.message || data.detail || `Swap prepare failed: ${response.status}`;
    
    // Strip HTML tags
    errorMsg = errorMsg.replace(/<[^>]*>/g, '').trim();
    
    // Check for rate limit
    if (errorMsg.includes('429') || errorMsg.includes('Too Many Requests')) {
      throw new Error('Too many requests. Please wait 30 seconds and try again.');
    }
    
    throw new Error(errorMsg);
  }
  
  logger.log('[XDEX] Prepare response received');
  logger.log('[XDEX] Response keys:', Object.keys(data));
  if (data.data) {
    logger.log('[XDEX] data.data keys:', Object.keys(data.data));
  }
  if (data.transaction) {
    logger.log('[XDEX] transaction type:', typeof data.transaction);
    if (typeof data.transaction === 'object') {
      logger.log('[XDEX] transaction keys:', Object.keys(data.transaction));
    }
  }
  if (data.data?.transaction) {
    logger.log('[XDEX] data.transaction type:', typeof data.data.transaction);
    if (typeof data.data.transaction === 'object') {
      logger.log('[XDEX] data.transaction keys:', Object.keys(data.data.transaction));
    }
  }
  
  return { ...data, provider: 'xdex' };
}

/**
 * Execute swap - prepares and returns transaction for signing
 */
export async function executeSwap(walletData, tokenIn, tokenOut, amountIn, network) {
  const txData = await prepareSwap(
    walletData.publicKey,
    tokenIn,
    tokenOut,
    amountIn,
    network
  );
  
  const transaction = txData?.data?.transaction || txData?.transaction;
  
  if (!transaction) {
    throw new Error('No transaction data in prepare response');
  }
  
  return { transaction, ...txData };
}

// ============================================
// TOKEN LIST - Jupiter for Solana, hardcoded for X1
// ============================================

// Cache for Jupiter tokens
let jupiterTokensCache = null;
let jupiterTokensCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Hardcoded Solana token list (always available)
const SOLANA_TOKEN_LIST = [
  { symbol: 'SOL', name: 'Solana', address: 'So11111111111111111111111111111111111111112', decimals: 9, logoURI: '/icons/48-sol.png' },
  { symbol: 'USDC', name: 'USD Coin', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6, logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png' },
  { symbol: 'USDT', name: 'Tether USD', address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6, logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.svg' },
  { symbol: 'JUP', name: 'Jupiter', address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', decimals: 6, logoURI: 'https://static.jup.ag/jup/icon.png' },
  { symbol: 'BONK', name: 'Bonk', address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5, logoURI: 'https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I' },
  { symbol: 'RAY', name: 'Raydium', address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', decimals: 6, logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R/logo.png' },
  { symbol: 'PYTH', name: 'Pyth Network', address: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', decimals: 6, logoURI: 'https://pyth.network/token.svg' },
  { symbol: 'WIF', name: 'dogwifhat', address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', decimals: 6, logoURI: 'https://assets.coingecko.com/coins/images/33566/standard/dogwifhat.jpg' },
  { symbol: 'ORCA', name: 'Orca', address: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', decimals: 6, logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE/logo.png' },
  { symbol: 'MSOL', name: 'Marinade SOL', address: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', decimals: 9, logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So/logo.png' },
];

/**
 * Fetch token list from Jupiter API V2 - uses verified token list
 */
async function fetchJupiterTokens() {
  // Return cached if fresh
  if (jupiterTokensCache && Date.now() - jupiterTokensCacheTime < CACHE_DURATION) {
    return jupiterTokensCache;
  }

  try {
    logger.log('[Jupiter] Fetching token list...');
    
    // Use Jupiter's V2 API for verified tokens
    const response = await fetch('https://lite-api.jup.ag/tokens/v2/tag?query=verified', {
      headers: { 
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      logger.warn('[Jupiter] API returned', response.status);
      return SOLANA_TOKEN_LIST;
    }
    
    const tokens = await response.json();
    
    // V2 API returns array with different field names (id instead of address, icon instead of logoURI)
    // Normalize to match expected format
    if (Array.isArray(tokens) && tokens.length > 0) {
      const normalizedTokens = tokens.map(t => ({
        address: t.id || t.address,
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
        logoURI: t.icon || t.logoURI
      }));
      jupiterTokensCache = normalizedTokens;
      jupiterTokensCacheTime = Date.now();
      logger.log('[Jupiter] Loaded', normalizedTokens.length, 'verified tokens');
      return normalizedTokens;
    }
    
    return SOLANA_TOKEN_LIST;
  } catch (err) {
    logger.error('[Jupiter] Token fetch error:', err);
    return SOLANA_TOKEN_LIST;
  }
}

/**
 * Get popular tokens for swap dropdown
 */
const POPULAR_SOLANA_MINTS = [
  'So11111111111111111111111111111111111111112', // SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', // JUP
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', // RAY
  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', // PYTH
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', // WIF
  'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', // ORCA
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
];

/**
 * Get available tokens for swapping on a network
 */
export async function getSwapTokens(network) {
  // X1 networks (including custom X1 networks) - base tokens for swapping
  if (isX1Network(network)) {
    return [
      { symbol: 'XNT', name: 'X1 Native Token', mint: 'native', logoURI: XDEX_LOGOS.X1, decimals: 9, isNative: true },
      { 
        symbol: 'WXNT', 
        name: 'Wrapped XNT', 
        mint: 'So11111111111111111111111111111111111111112', 
        logoURI: XDEX_LOGOS.WXNT, 
        decimals: 9,
        isWrappedNative: true
      },
      { 
        symbol: 'USDC.X', 
        name: 'USD Coin (X1)', 
        mint: 'B69chRzqzDCmdB5WYB8NRu5Yv5ZA95ABiZcdzCgGm9Tq', 
        logoURI: XDEX_LOGOS.USDC_X,
        decimals: 6,
        isToken2022: true
      },
    ];
  }

  // Solana Devnet - limited tokens
  if (network === 'Solana Devnet') {
    return [
      { symbol: 'SOL', name: 'Solana', mint: SOLANA_TOKENS.SOL, logoURI: XDEX_LOGOS.SOL, decimals: 9, isNative: true },
      { symbol: 'USDC', name: 'USD Coin', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6, logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png' },
    ];
  }

  // Solana Mainnet - use Jupiter strict token list
  logger.log('[Swap] Loading Solana Mainnet tokens from Jupiter');
  
  // Fetch from Jupiter
  const jupiterTokens = await fetchJupiterTokens();
  
  if (jupiterTokens && jupiterTokens.length > 0 && jupiterTokens !== SOLANA_TOKEN_LIST) {
    // Map all tokens to our format, prioritizing popular ones first
    const popularSet = new Set(POPULAR_SOLANA_MINTS);
    
    // Create a lookup for reliable logo URLs (override Jupiter's potentially broken IPFS links)
    const logoOverrides = {};
    SOLANA_TOKEN_LIST.forEach(t => {
      logoOverrides[t.address] = t.logoURI;
    });
    
    const allTokens = jupiterTokens
      .map(t => ({
        symbol: t.symbol,
        name: t.name,
        mint: t.address,
        // Use our reliable logos for popular tokens, fallback to Jupiter's logo
        logoURI: logoOverrides[t.address] || t.logoURI,
        decimals: t.decimals,
        isPopular: popularSet.has(t.address),
        // Mark SOL as native
        isNative: t.symbol === 'SOL' || t.address === SOLANA_TOKENS.SOL
      }))
      // Sort: popular tokens first, then alphabetically
      .sort((a, b) => {
        // Native token always first
        if (a.isNative && !b.isNative) return -1;
        if (!a.isNative && b.isNative) return 1;
        if (a.isPopular && !b.isPopular) return -1;
        if (!a.isPopular && b.isPopular) return 1;
        return a.symbol.localeCompare(b.symbol);
      });
    
    logger.log('[Swap] Loaded', allTokens.length, 'tokens from Jupiter');
    return allTokens;
  }

  // Use hardcoded Solana token list
  logger.log('[Swap] Using hardcoded Solana token list');
  return SOLANA_TOKEN_LIST.map(t => ({
    symbol: t.symbol,
    name: t.name,
    mint: t.address,
    logoURI: t.logoURI,
    decimals: t.decimals,
    isNative: t.symbol === 'SOL'
  }));
}

/**
 * Search Jupiter tokens by symbol or name
 */
export async function searchTokens(query, network) {
  if (!isSolanaNetwork(network) || !query || query.length < 2) {
    return [];
  }

  const jupiterTokens = await fetchJupiterTokens();
  if (!jupiterTokens) return [];

  const lowerQuery = query.toLowerCase();
  return jupiterTokens
    .filter(t => 
      t.symbol.toLowerCase().includes(lowerQuery) || 
      t.name.toLowerCase().includes(lowerQuery)
    )
    .slice(0, 20)
    .map(t => ({
      symbol: t.symbol,
      name: t.name,
      mint: t.address,
      logoURI: t.logoURI,
      decimals: t.decimals
    }));
}

/**
 * Derive Metaplex metadata PDA
 */
async function deriveMetadataPDA(mintAddress) {
  const METADATA_PROGRAM_ID = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
  
  // Import base58 utilities
  const { decodeBase58, encodeBase58 } = await import('../utils/base58.js');
  
  // Seeds: "metadata" + program_id + mint
  const metadataPrefix = new TextEncoder().encode('metadata');
  const programIdBytes = decodeBase58(METADATA_PROGRAM_ID);
  const mintBytes = decodeBase58(mintAddress);
  
  // Combine seeds
  const seeds = new Uint8Array(metadataPrefix.length + programIdBytes.length + mintBytes.length);
  seeds.set(metadataPrefix, 0);
  seeds.set(programIdBytes, metadataPrefix.length);
  seeds.set(mintBytes, metadataPrefix.length + programIdBytes.length);
  
  // Find PDA (simplified - tries bump 255 first)
  for (let bump = 255; bump >= 0; bump--) {
    try {
      const seedsWithBump = new Uint8Array(seeds.length + 1);
      seedsWithBump.set(seeds);
      seedsWithBump[seeds.length] = bump;
      
      // Hash to get PDA
      const hash = await crypto.subtle.digest('SHA-256', seedsWithBump);
      const hashArray = new Uint8Array(hash);
      
      // Check if it's off the Ed25519 curve (valid PDA)
      // For simplicity, we'll just return the first attempt
      return encodeBase58(hashArray.slice(0, 32));
    } catch (e) {
      continue;
    }
  }
  return null;
}

/**
 * Fetch token metadata from RPC by mint address
 * Works for both SPL Token and Token-2022, tries Metaplex metadata
 * @param {string} rpcUrl - RPC endpoint URL
 * @param {string} mintAddress - Token mint address
 * @param {string} network - Network name (e.g., 'X1 Mainnet', 'Solana Mainnet')
 */
export async function fetchTokenMetadata(rpcUrl, mintAddress, network = null) {
  try {
    logger.log('[XDEX] Fetching token metadata for:', mintAddress, 'on', network || 'unknown network');
    
    // Check cache first (including failed lookups)
    const cached = getCachedMetadata(mintAddress);
    if (cached) {
      if (cached.failed) {
        logger.log('[XDEX] Cache hit (failed):', mintAddress, '- skipping API call');
        return null;
      }
      logger.log('[XDEX] Cache hit:', mintAddress, cached.data?.symbol);
      return cached.data;
    }
    
    // Check network-specific known tokens first
    if (network) {
      const knownToken = getKnownToken(network, mintAddress);
      if (knownToken) {
        logger.log('[XDEX] Found in known tokens:', knownToken.symbol);
        const result = {
          mint: mintAddress,
          symbol: knownToken.symbol,
          name: knownToken.name,
          decimals: knownToken.decimals,
          logoURI: knownToken.logoURI,
          isToken2022: knownToken.isToken2022 || false,
          isCustom: true
        };
        setCachedMetadata(mintAddress, result);
        return result;
      }
    }
    
    // For Solana networks, try Jupiter API first (most comprehensive metadata)
    if (network && isSolanaNetwork(network)) {
      try {
        logger.log('[XDEX] Trying Jupiter API for Solana token...');
        const jupResponse = await fetch(`${JUPITER_TOKEN_API}/tag?query=verified`);
        if (jupResponse.ok) {
          const tokens = await jupResponse.json();
          const token = tokens.find(t => (t.id || t.address) === mintAddress);
          if (token) {
            logger.log('[XDEX] Found token in Jupiter:', token.symbol);
            const result = {
              mint: mintAddress,
              symbol: token.symbol,
              name: token.name,
              decimals: token.decimals,
              logoURI: token.icon || token.logoURI,
              isToken2022: false,
              isCustom: true
            };
            setCachedMetadata(mintAddress, result);
            return result;
          }
        }
      } catch (e) {
        logger.log('[XDEX] Jupiter lookup failed:', e.message);
      }
    }
    
    // Get the account info from RPC
    logger.log('[XDEX] Fetching from RPC:', rpcUrl);
    const accountResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAccountInfo',
        params: [mintAddress, { encoding: 'jsonParsed' }]
      })
    });
    
    const accountData = await accountResponse.json();
    logger.log('[XDEX] RPC response:', accountData.result ? 'found' : 'not found', accountData.error?.message || '');
    
    if (!accountData.result?.value) {
      throw new Error(accountData.error?.message || 'Token not found on this network');
    }
    
    const parsedData = accountData.result.value.data?.parsed;
    if (!parsedData || parsedData.type !== 'mint') {
      throw new Error('Not a valid token mint');
    }
    
    const mintInfo = parsedData.info;
    const owner = accountData.result.value.owner;
    const isToken2022 = owner === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
    
    let symbol = mintAddress.slice(0, 4).toUpperCase();
    let name = isToken2022 ? 'Token-2022' : 'SPL Token';
    let logoURI = null;
    
    // Check for Token-2022 metadata extension
    if (isToken2022 && mintInfo.extensions) {
      logger.log('[XDEX] Token-2022 extensions:', JSON.stringify(mintInfo.extensions, null, 2));
      
      // Try different extension names
      const metadataExt = mintInfo.extensions.find(ext => 
        ext.extension === 'tokenMetadata' || 
        ext.extension === 'metadata' ||
        ext.extension === 'TokenMetadata'
      );
      
      logger.log('[XDEX] Metadata extension found:', metadataExt);
      
      if (metadataExt?.state) {
        symbol = metadataExt.state.symbol || symbol;
        name = metadataExt.state.name || name;
        logger.log('[XDEX] Token-2022 metadata from extension:', { symbol, name });
        
        // Check for URI which may contain logo
        const uri = metadataExt.state.uri || metadataExt.state.URI || metadataExt.state.url;
        if (uri) {
          try {
            logger.log('[XDEX] Fetching metadata from URI:', uri);
            const metaResponse = await fetch(uri);
            if (metaResponse.ok) {
              const metaJson = await metaResponse.json();
              logger.log('[XDEX] URI metadata:', metaJson);
              logoURI = metaJson.image || metaJson.logo || metaJson.icon || metaJson.logoURI || null;
              if (metaJson.name && metaJson.name !== 'Unknown') name = metaJson.name;
              if (metaJson.symbol && metaJson.symbol !== 'UNKN') symbol = metaJson.symbol;
            }
          } catch (e) {
            logger.log('[XDEX] Could not fetch URI metadata:', e.message);
          }
        }
      }
    }
    
    // For non-Token-2022 SPL tokens, check if there's parsed metadata
    if (!isToken2022 && parsedData.info) {
      // Some RPC nodes return additional parsed data
      if (parsedData.info.name) name = parsedData.info.name;
      if (parsedData.info.symbol) symbol = parsedData.info.symbol;
    }
    
    // Try Metaplex metadata if we still don't have good data
    if (name === 'Token-2022' || name === 'SPL Token') {
      try {
        // Derive metadata PDA using known formula
        const METADATA_PROGRAM = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
        
        // Get raw account data with base64 encoding to find metadata account
        const metaAccountResponse = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getProgramAccounts',
            params: [
              METADATA_PROGRAM,
              {
                encoding: 'jsonParsed',
                filters: [
                  { memcmp: { offset: 33, bytes: mintAddress } }
                ]
              }
            ]
          })
        });
        
        const metaAccounts = await metaAccountResponse.json();
        logger.log('[XDEX] Metaplex accounts:', metaAccounts);
        
        if (metaAccounts.result?.length > 0) {
          const metaAccount = metaAccounts.result[0];
          const metaData = metaAccount.account?.data;
          
          // Parse metadata from account
          if (metaData) {
            // Metaplex metadata is typically at specific offsets
            // This is a simplified parser
            logger.log('[XDEX] Found Metaplex metadata account');
          }
        }
      } catch (e) {
        logger.log('[XDEX] Metaplex lookup failed:', e.message);
      }
    }
    
    // Try to get from X1 explorer API or known token list
    try {
      logger.log('[XDEX] Trying explorer API...');
      const explorerResponse = await fetch(`https://explorer.mainnet.x1.xyz/api/v2/tokens/${mintAddress}`);
      if (explorerResponse.ok) {
        const explorerData = await explorerResponse.json();
        logger.log('[XDEX] Explorer API response:', explorerData);
        if (explorerData.name) name = explorerData.name;
        if (explorerData.symbol) symbol = explorerData.symbol;
        if (explorerData.image || explorerData.logo || explorerData.logoURI) {
          logoURI = explorerData.image || explorerData.logo || explorerData.logoURI;
        }
      }
    } catch (e) {
      logger.log('[XDEX] Explorer API not available:', e.message);
    }
    
    // Try XDEX backend tokens API
    if (name === 'Token-2022' || name === 'SPL Token' || !logoURI) {
      try {
        logger.log('[XDEX] Trying XDEX tokens API...');
        const xdexResponse = await fetch(`${XDEX_API}/tokens/${mintAddress}`);
        if (xdexResponse.ok) {
          const xdexData = await xdexResponse.json();
          logger.log('[XDEX] XDEX API response:', xdexData);
          if (xdexData.name) name = xdexData.name;
          if (xdexData.symbol) symbol = xdexData.symbol;
          if (xdexData.image || xdexData.logo || xdexData.logoURI || xdexData.icon) {
            logoURI = xdexData.image || xdexData.logo || xdexData.logoURI || xdexData.icon;
          }
        }
      } catch (e) {
        logger.log('[XDEX] XDEX API not available:', e.message);
      }
    }
    
    // Try X1 mobile API as another fallback
    if (name === 'Token-2022' || name === 'SPL Token' || !logoURI) {
      try {
        logger.log('[XDEX] Trying X1 mobile API...');
        const mobileApiResponse = await fetch(`https://mobile-api.x1.xyz/tokens?mint=${encodeURIComponent(mintAddress)}&verified=true`);
        if (mobileApiResponse.ok) {
          const mobileData = await mobileApiResponse.json();
          logger.log('[XDEX] X1 mobile API response:', mobileData);
          if (mobileData.tokens && mobileData.tokens.length > 0) {
            const tokenData = mobileData.tokens[0];
            if (tokenData.name) name = tokenData.name;
            if (tokenData.symbol) symbol = tokenData.symbol;
            if (tokenData.image || tokenData.logo || tokenData.logoURI) {
              logoURI = tokenData.image || tokenData.logo || tokenData.logoURI;
            }
            logger.log('[XDEX] Found token in X1 mobile API:', symbol);
          }
        }
      } catch (e) {
        logger.log('[XDEX] X1 mobile API not available:', e.message);
      }
    }
    
    // For Solana, try Solscan API
    if (network && isSolanaNetwork(network) && (name === 'SPL Token' || !logoURI)) {
      try {
        logger.log('[XDEX] Trying Solscan API...');
        const solscanResponse = await fetch(`https://api.solscan.io/token/meta?token=${mintAddress}`);
        if (solscanResponse.ok) {
          const solscanData = await solscanResponse.json();
          logger.log('[XDEX] Solscan API response:', solscanData);
          if (solscanData.data) {
            if (solscanData.data.name) name = solscanData.data.name;
            if (solscanData.data.symbol) symbol = solscanData.data.symbol;
            if (solscanData.data.icon) logoURI = solscanData.data.icon;
          }
        }
      } catch (e) {
        logger.log('[XDEX] Solscan API not available:', e.message);
      }
    }
    
    logger.log('[XDEX] Token metadata result:', { symbol, name, decimals: mintInfo.decimals, isToken2022, logoURI });
    
    const result = {
      mint: mintAddress,
      symbol,
      name,
      decimals: mintInfo.decimals,
      supply: mintInfo.supply,
      isToken2022,
      logoURI,
      isCustom: true
    };
    
    // Cache successful result
    setCachedMetadata(mintAddress, result);
    
    return result;
  } catch (error) {
    logger.error('[XDEX] Failed to fetch token metadata:', error);
    // Cache failed lookup to avoid repeated 404s
    setCachedMetadata(mintAddress, null, true);
    throw error;
  }
}

/**
 * Search XDEX for available swap tokens
 */
export async function searchXDEXTokens(query, network) {
  try {
    const networkName = getNetworkName(network);
    
    // Try XDEX token list endpoint
    const response = await fetch(`${XDEX_API}/tokens?network=${encodeURIComponent(networkName)}&search=${encodeURIComponent(query)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!response.ok) {
      logger.log('[XDEX] Token search endpoint not available, using fallback');
      return null;
    }
    
    const data = await response.json();
    logger.log('[XDEX] Token search results:', data);
    
    if (data.tokens && Array.isArray(data.tokens)) {
      return data.tokens.map(t => ({
        symbol: t.symbol,
        name: t.name,
        mint: t.address || t.mint,
        logoURI: t.logoURI || t.logo,
        decimals: t.decimals,
        isToken2022: t.isToken2022 || false
      }));
    }
    
    return null;
  } catch (error) {
    logger.log('[XDEX] Token search failed:', error.message);
    return null;
  }
}

/**
 * Get swap provider name for display
 */
export function getSwapProvider(network) {
  // XDEX handles all swaps (with Jupiter routing for Solana behind the scenes)
  return 'XDEX';
}

export { getNetworkName, isSolanaNetwork, isX1Network, getKnownToken, SOLANA_TOKENS, XDEX_LOGOS, X1_KNOWN_TOKENS, KNOWN_TOKENS };