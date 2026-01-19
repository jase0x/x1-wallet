// Token Service for SPL and Token-2022 tokens
// FIXED: Added rate limiting to prevent 429 errors on XDEX API calls
// INCLUDES: All metadata sources - X1 Mobile API, Metaplex, DAS, Jupiter, XDEX

import { logger } from '../utils/logger.js';
import { decodeBase58, encodeBase58 } from '../utils/base58';
import { 
  XDEX_LP_MINT_AUTHORITY, 
  XLP_LOGO_URL, 
  KNOWN_TOKENS,
  NETWORK_TOKEN_OVERRIDES,
  X1_TOKEN_OVERRIDES,
  isX1Network,
  getKnownTokenMetadata
} from './knownTokens.js';

// API Server (same as Android app)
const API_SERVER = 'https://mobile-api.x1.xyz';

// Program IDs
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const METADATA_PROGRAM_ID = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';

// ============================================
// RATE LIMITER - Prevents 429 errors
// ============================================

class RateLimiter {
  constructor(maxRequests = 5, windowMs = 1000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = [];
  }

  async acquire() {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.windowMs);
    
    if (this.requests.length >= this.maxRequests) {
      const waitTime = this.windowMs - (now - this.requests[0]) + 10;
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.acquire();
    }
    
    this.requests.push(now);
    return true;
  }
}

// Rate limiter for XDEX API (5 requests per second)
const xdexRateLimiter = new RateLimiter(5, 1000);

// ============================================
// RPC TOKEN ACCOUNTS CACHE - For faster subsequent loads
// ============================================
const rpcTokenAccountsCache = new Map();
const RPC_CACHE_TTL = 15 * 1000; // 15 seconds - short enough to catch external dApp transactions

// Cache for XDEX wallet tokens response (prices change slowly, can cache longer)
const walletTokensCache = new Map();
const WALLET_TOKENS_CACHE_TTL = 60 * 1000; // 60 seconds for prices

function getCachedRPCTokenAccounts(ownerAddress, rpcUrl) {
  const cacheKey = `${ownerAddress}:${rpcUrl}`;
  const cached = rpcTokenAccountsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < RPC_CACHE_TTL) {
    logger.log('[RPC Cache] Hit - using cached token accounts, age:', Math.round((Date.now() - cached.timestamp) / 1000), 's');
    return cached.data;
  }
  return null;
}

function setCachedRPCTokenAccounts(ownerAddress, rpcUrl, splTokens, token2022) {
  const cacheKey = `${ownerAddress}:${rpcUrl}`;
  rpcTokenAccountsCache.set(cacheKey, {
    data: { splTokens, token2022 },
    timestamp: Date.now()
  });
  // Keep max 5 wallets cached
  if (rpcTokenAccountsCache.size > 5) {
    const oldestKey = rpcTokenAccountsCache.keys().next().value;
    rpcTokenAccountsCache.delete(oldestKey);
  }
  logger.log('[RPC Cache] Stored token accounts for', ownerAddress.slice(0, 8));
}

// Invalidate RPC cache for a wallet (call after transactions)
export function invalidateRPCCache(ownerAddress = null) {
  if (ownerAddress) {
    for (const key of rpcTokenAccountsCache.keys()) {
      if (key.startsWith(ownerAddress)) {
        rpcTokenAccountsCache.delete(key);
      }
    }
    for (const key of walletTokensCache.keys()) {
      if (key.startsWith(ownerAddress)) {
        walletTokensCache.delete(key);
      }
    }
    logger.log('[Cache] Invalidated for wallet:', ownerAddress.slice(0, 8));
  } else {
    rpcTokenAccountsCache.clear();
    walletTokensCache.clear();
    logger.log('[Cache] Invalidated all');
  }
}

// Cache for failed requests to avoid retrying them repeatedly
// Now uses localStorage for persistence across sessions
const FAILED_CACHE_KEY = 'x1wallet_failed_token_lookups';
const FAILED_CACHE_TTL = 10 * 60 * 1000; // 10 minutes for failed lookups

function getFailedCache() {
  try {
    const cached = localStorage.getItem(FAILED_CACHE_KEY);
    return cached ? JSON.parse(cached) : {};
  } catch {
    return {};
  }
}

function setFailedCache(cache) {
  try {
    // Clean up old entries
    const now = Date.now();
    const cleaned = {};
    for (const [key, timestamp] of Object.entries(cache)) {
      if (now - timestamp < FAILED_CACHE_TTL) {
        cleaned[key] = timestamp;
      }
    }
    // Keep max 100 entries
    const entries = Object.entries(cleaned);
    if (entries.length > 100) {
      entries.sort((a, b) => b[1] - a[1]); // Sort by timestamp desc
      const limited = Object.fromEntries(entries.slice(0, 100));
      localStorage.setItem(FAILED_CACHE_KEY, JSON.stringify(limited));
    } else {
      localStorage.setItem(FAILED_CACHE_KEY, JSON.stringify(cleaned));
    }
  } catch {
    // Ignore storage errors
  }
}

function hasRecentlyFailed(key) {
  const cache = getFailedCache();
  const failedAt = cache[key];
  if (!failedAt) return false;
  
  if (Date.now() - failedAt > FAILED_CACHE_TTL) {
    delete cache[key];
    setFailedCache(cache);
    return false;
  }
  return true;
}

function markFailed(key) {
  const cache = getFailedCache();
  cache[key] = Date.now();
  setFailedCache(cache);
}

function clearFailed(key) {
  const cache = getFailedCache();
  delete cache[key];
  setFailedCache(cache);
}

// Fetch with rate limiting
async function fetchWithRateLimit(url, options = {}) {
  await xdexRateLimiter.acquire();
  return fetch(url, options);
}

// ============================================
// XDEX LP TOKEN DETECTION
// ============================================

// Cache for mint authority lookups (to avoid repeated RPC calls)
const mintAuthorityCache = new Map();
const MINT_AUTHORITY_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Cache for LP token info from XDEX API
const lpTokenInfoCache = new Map();
const LP_TOKEN_INFO_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Fetch mint authority for a token
async function fetchMintAuthority(rpcUrl, mintAddress) {
  const cacheKey = `${rpcUrl}:${mintAddress}`;
  const cached = mintAuthorityCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < MINT_AUTHORITY_CACHE_TTL) {
    return cached.authority;
  }
  
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAccountInfo',
        params: [
          mintAddress,
          { encoding: 'jsonParsed' }
        ]
      })
    });
    
    const data = await response.json();
    const mintAuthority = data?.result?.value?.data?.parsed?.info?.mintAuthority || null;
    
    mintAuthorityCache.set(cacheKey, { authority: mintAuthority, timestamp: Date.now() });
    return mintAuthority;
  } catch (e) {
    logger.warn('[Tokens] Failed to fetch mint authority:', e.message);
    return null;
  }
}

// Fetch LP token info from XDEX devapi
async function fetchLPTokenInfoFromXDEX(lpMint) {
  const cacheKey = `lp:${lpMint}`;
  const cached = lpTokenInfoCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < LP_TOKEN_INFO_CACHE_TTL) {
    return cached.info;
  }
  
  try {
    // Use devapi endpoint first (more reliable for LP tokens)
    const response = await fetchWithRateLimit(
      `https://devapi.xdex.xyz/api/xendex/tokens/${lpMint}`,
      { signal: AbortSignal.timeout(2000) }
    );
    
    if (response.ok) {
      const data = await response.json();
      logger.log('[Tokens] XDEX devapi LP token data:', data);
      
      // Check if we got a valid name (not "Unknown Token" or empty)
      if (data.name && data.name !== 'Unknown Token' && data.name.trim() !== '') {
        const info = {
          name: data.name,
          symbol: data.symbol || 'XLP',
          logoURI: data.image || data.logo || data.logoURI
        };
        lpTokenInfoCache.set(cacheKey, { info, timestamp: Date.now() });
        return info;
      }
    }
  } catch (e) {
    logger.warn('[Tokens] XDEX devapi LP lookup failed:', e.message);
  }
  
  // Cache null to avoid repeated failed lookups
  lpTokenInfoCache.set(cacheKey, { info: null, timestamp: Date.now() });
  return null;
}

// Helper to check if LP token has a specific name (not generic fallback)
// Specific names contain pair separators like "XNT/USDC.X LP" or "XNT-USDC LP"
function hasSpecificLPName(name) {
  return name && 
    name !== 'XLP' &&
    name !== 'SLP' &&
    name !== 'SPL Token' && 
    name !== 'Token-2022' &&
    name !== 'XDEX LP Token' &&
    name !== 'SLP Token' &&
    name !== 'Unknown Token' &&
    (name.includes('/') || name.includes('-'));
}

// Check if a token is an XDEX LP token by its mint authority
async function checkAndApplyLPBranding(rpcUrl, token, network) {
  // Check on X1 networks where XDEX operates, or Solana
  const isX1 = network?.includes('X1');
  const isSolana = network?.includes('Solana');
  
  if (!isX1 && !isSolana) return false;
  
  try {
    const mintAuthority = await fetchMintAuthority(rpcUrl, token.mint);
    
    if (mintAuthority === XDEX_LP_MINT_AUTHORITY) {
      token.isLPToken = true;
      token.logoURI = XLP_LOGO_URL;
      
      // If token already has a good name (not generic), keep it
      const hasGoodName = token.name && 
        token.name !== 'XLP' &&
        token.name !== 'SLP' &&
        token.name !== 'SPL Token' && 
        token.name !== 'Token-2022' &&
        token.name !== 'XDEX LP Token' &&
        token.name !== 'SLP Token' &&
        token.name !== 'Unknown Token';
      
      if (hasGoodName) {
        if (!token.symbol || token.symbol === token.mint?.slice(0, 4).toUpperCase()) {
          token.symbol = 'XLP';
        }
        logger.log(`[Tokens] LP token keeping good name: ${token.mint} -> ${token.name}`);
        return true;
      }
      
      if (isX1) {
        // Try to get actual LP name from XDEX devapi
        logger.log('[Tokens] Fetching LP name from XDEX devapi for:', token.mint);
        const lpInfo = await fetchLPTokenInfoFromXDEX(token.mint);
        
        // Accept ANY name from the API that's not generic
        if (lpInfo && lpInfo.name && lpInfo.name !== 'Unknown Token') {
          token.name = lpInfo.name;
          token.symbol = lpInfo.symbol || 'XLP';
          logger.log(`[Tokens] LP token got API name: ${token.mint} -> ${token.name}`);
        } else {
          // Fallback
          token.name = 'XDEX LP Token';
          token.symbol = 'XLP';
          logger.log(`[Tokens] LP token using fallback name: ${token.mint}`);
        }
      } else if (isSolana) {
        token.name = 'SLP Token';
        token.symbol = 'SLP';
        logger.log(`[Tokens] Solana LP token: ${token.mint}`);
      }
      
      // ALWAYS ensure XLP icon is set (in case it was overwritten)
      token.logoURI = XLP_LOGO_URL;
      
      return true;
    }
  } catch (e) {
    logger.warn('[Tokens] LP token check failed:', e.message);
  }
  
  return false;
}

// ============================================
// KNOWN TOKENS - Imported from knownTokens.js
// ============================================

// Metadata cache - persisted to localStorage for instant loads
const METADATA_CACHE_KEY = 'x1wallet_metadata_cache';
const METADATA_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const metadataCache = new Map();

// Load metadata cache from localStorage on module init
function loadMetadataCache() {
  try {
    const cached = localStorage.getItem(METADATA_CACHE_KEY);
    if (cached) {
      const data = JSON.parse(cached);
      if (data._timestamp && (Date.now() - data._timestamp < METADATA_CACHE_TTL)) {
        let count = 0;
        let skipped = 0;
        
        // Generic names that indicate LP token needs enrichment
        const genericNames = ['XLP', 'SLP', 'SPL Token', 'Token-2022', 'XDEX LP Token', 'SLP Token', 'Unknown Token'];
        
        for (const [key, value] of Object.entries(data)) {
          if (key !== '_timestamp') {
            // Skip LP tokens with generic names - they need fresh enrichment
            if (value.isLPToken && genericNames.includes(value.name)) {
              skipped++;
              continue;
            }
            metadataCache.set(key, value);
            count++;
          }
        }
        logger.log('[Tokens] Loaded', count, 'entries from cache (skipped', skipped, 'LP tokens)');
      }
    }
  } catch (e) {
    logger.warn('[Tokens] Error loading metadata cache:', e);
  }
}

// Save metadata cache to localStorage (debounced)
let metadataCacheSaveTimeout = null;
function saveMetadataCache() {
  // Debounce saves to avoid excessive writes
  if (metadataCacheSaveTimeout) {
    clearTimeout(metadataCacheSaveTimeout);
  }
  metadataCacheSaveTimeout = setTimeout(() => {
    try {
      const data = { _timestamp: Date.now() };
      // Only save up to 200 entries to prevent localStorage bloat
      let count = 0;
      for (const [key, value] of metadataCache.entries()) {
        if (count >= 200) break;
        data[key] = value;
        count++;
      }
      localStorage.setItem(METADATA_CACHE_KEY, JSON.stringify(data));
      logger.log('[Tokens] Saved', count, 'entries to metadata cache');
    } catch (e) {
      logger.warn('[Tokens] Error saving metadata cache:', e);
    }
  }, 1000); // Save after 1 second of no new updates
}

// Clear metadata cache - useful for debugging or forcing fresh data
export function clearMetadataCache() {
  metadataCache.clear();
  rpcTokenAccountsCache.clear();
  walletTokensCache.clear();
  try {
    localStorage.removeItem(METADATA_CACHE_KEY);
    localStorage.removeItem(PRICE_CACHE_KEY);
    logger.log('[Tokens] Cleared all token caches');
  } catch (e) {
    logger.warn('[Tokens] Error clearing caches:', e);
  }
}

// Initialize metadata cache from localStorage
loadMetadataCache();

// Persistent price cache using localStorage
// This prevents price flicker during refreshes
const PRICE_CACHE_KEY = 'x1wallet_price_cache';
const PRICE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getPriceCache() {
  try {
    const cached = localStorage.getItem(PRICE_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (e) {
    // Ignore
  }
  return {};
}

function setPriceCache(prices) {
  try {
    localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify({
      ...prices,
      _timestamp: Date.now()
    }));
  } catch (e) {
    // Ignore
  }
}

function getCachedPrice(mint) {
  const cache = getPriceCache();
  if (cache[mint] !== undefined && cache._timestamp && (Date.now() - cache._timestamp < PRICE_CACHE_TTL)) {
    return cache[mint];
  }
  return undefined;
}

function updatePriceCache(mint, price) {
  const cache = getPriceCache();
  cache[mint] = price;
  cache._timestamp = Date.now();
  setPriceCache(cache);
}

// ============================================
// API FUNCTIONS
// ============================================

// Fetch token metadata from X1 Mobile API
export async function fetchTokenMetadataFromAPI(mint) {
  try {
    const url = `${API_SERVER}/tokens?mint=${encodeURIComponent(mint)}&verified=true`;
    logger.log('[Token API] Fetching metadata for:', mint);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    
    if (!response.ok) {
      logger.log('[Token API] HTTP', response.status, '- Failed to fetch');
      return null;
    }
    
    const data = await response.json();
    if (data && data.tokens && data.tokens.length > 0) {
      const token = data.tokens[0];
      logger.log('[Token API] Found:', token.name, '(' + token.symbol + ')');
      return {
        name: token.name,
        symbol: token.symbol,
        logoURI: token.icon,
        price: token.price,
        mint: token.mint
      };
    }
    
    logger.log('[Token API] No token found for mint:', mint);
    return null;
  } catch (e) {
    if (e.name === 'AbortError') {
      logger.warn('[Token API] Request timeout for:', mint);
    } else {
      logger.warn('[Token API] Error fetching metadata:', e);
    }
    return null;
  }
}

// Fetch from Helius DAS API
async function fetchFromDAS(rpcUrl, mint) {
  try {
    if (!rpcUrl.includes('helius')) return null;
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAsset',
        params: { id: mint }
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    
    const data = await response.json();
    if (data.result && data.result.content) {
      const content = data.result.content;
      const metadata = content.metadata || {};
      const links = content.links || {};
      const files = content.files || [];
      
      let logoURI = links.image || null;
      if (!logoURI && files.length > 0) {
        const imageFile = files.find(f => f.mime?.startsWith('image/'));
        if (imageFile) logoURI = imageFile.uri;
      }
      
      logger.log('[DAS API] Found metadata:', metadata.name);
      return {
        name: metadata.name,
        symbol: metadata.symbol,
        logoURI: logoURI,
        uri: content.json_uri
      };
    }
    return null;
  } catch (e) {
    logger.warn('[DAS API] Error:', e.message);
    return null;
  }
}

// ============================================
// MAIN TOKEN FETCH
// ============================================

/**
 * Fetch all token accounts for an address
 * @param {string} rpcUrl - RPC endpoint URL
 * @param {string} ownerAddress - Wallet address
 * @param {string} network - Network name (e.g., 'X1 Mainnet')
 * @param {function} onUpdate - Callback for background updates
 * @param {object} options - Optional settings
 * @param {string} options.mode - 'import' for fast initial load, 'refresh' for full sync (default)
 * @param {boolean} options.forceRefresh - Bypass RPC cache entirely (for post-transaction refresh)
 */
export async function fetchTokenAccounts(rpcUrl, ownerAddress, network = null, onUpdate = null, options = {}) {
  const tokens = [];
  const startTime = Date.now();
  const mode = options.mode || 'refresh';  // Default to full refresh
  const forceRefresh = options.forceRefresh || false;
  
  try {
    logger.log('[Tokens] Starting token fetch for:', ownerAddress, 'on network:', network, 'mode:', mode, 'force:', forceRefresh);
    
    // Check RPC cache first (unless forceRefresh)
    const cachedRPC = forceRefresh ? null : getCachedRPCTokenAccounts(ownerAddress, rpcUrl);
    
    let splTokens, token2022, xdexPrices;
    
    if (mode === 'import' && !forceRefresh) {
      // IMPORT MODE: Fastest possible initial load
      // 1. Use cached RPC data if available
      // 2. Skip XDEX batch call initially (prices come later)
      // 3. Background enrichment will fill in prices/metadata
      if (cachedRPC) {
        splTokens = cachedRPC.splTokens;
        token2022 = cachedRPC.token2022;
        xdexPrices = {}; // Skip XDEX on import - use cached prices
        logger.log('[Tokens] Import mode - using cached RPC, skipping XDEX');
      } else {
        // No RPC cache - must fetch tokens, but skip XDEX pricing
        [splTokens, token2022] = await Promise.all([
          fetchTokenAccountsByProgram(rpcUrl, ownerAddress, TOKEN_PROGRAM_ID),
          fetchTokenAccountsByProgram(rpcUrl, ownerAddress, TOKEN_2022_PROGRAM_ID)
        ]);
        xdexPrices = {}; // Skip XDEX on import
        // Cache for next time
        setCachedRPCTokenAccounts(ownerAddress, rpcUrl, splTokens, token2022);
        logger.log('[Tokens] Import mode - fresh RPC, skipping XDEX');
      }
    } else if (cachedRPC) {
      // REFRESH MODE with cache: Use cached RPC data, only fetch fresh prices from XDEX
      splTokens = cachedRPC.splTokens;
      token2022 = cachedRPC.token2022;
      xdexPrices = await fetchXDEXWalletTokens(ownerAddress, network);
      logger.log('[Tokens] Fast path - cached RPC +', Date.now() - startTime, 'ms for XDEX');
    } else {
      // REFRESH MODE without cache: Fetch everything fresh in parallel
      [splTokens, token2022, xdexPrices] = await Promise.all([
        fetchTokenAccountsByProgram(rpcUrl, ownerAddress, TOKEN_PROGRAM_ID),
        fetchTokenAccountsByProgram(rpcUrl, ownerAddress, TOKEN_2022_PROGRAM_ID),
        fetchXDEXWalletTokens(ownerAddress, network)
      ]);
      // Cache for next time
      setCachedRPCTokenAccounts(ownerAddress, rpcUrl, splTokens, token2022);
    }
    
    logger.log('[Tokens] RPC done in', Date.now() - startTime, 'ms - SPL:', splTokens.length, 'Token2022:', token2022.length);
    logger.log('[Tokens] XDEX prices received for', Object.keys(xdexPrices).length, 'tokens');
    
    tokens.push(...splTokens, ...token2022);
    
    // PRE-FILTER: Mark dust tokens BEFORE they enter the pricing pipeline
    // This prevents unnecessary price lookups and enrichment for worthless tokens
    const DUST_RAW_THRESHOLD = 1;  // Raw amount threshold
    let dustCount = 0;
    for (const token of tokens) {
      // Zero balance - skip completely
      if (token.balance === 0 || token.uiAmount === 0 || parseInt(token.amount) === 0) {
        token.isDust = true;
        token.skipEnrichment = true;
        dustCount++;
        continue;
      }
      // Near-zero raw amount
      if (parseInt(token.amount) <= DUST_RAW_THRESHOLD) {
        token.isDust = true;
        token.skipEnrichment = true;
        dustCount++;
      }
    }
    if (dustCount > 0) {
      logger.log('[Tokens] Pre-filtered', dustCount, 'dust tokens from pricing pipeline');
    }
    
    // Generic names that indicate LP token needs enrichment
    const genericLPNames = ['XLP', 'SLP', 'SPL Token', 'Token-2022', 'XDEX LP Token', 'SLP Token', 'Unknown Token'];
    
    // Quick pass: apply cached/known metadata and XDEX prices
    for (const token of tokens) {
      // Skip dust tokens entirely - they don't need pricing or metadata
      if (token.isDust) {
        token.symbol = token.mint?.slice(0, 4) || 'DUST';
        token.name = 'Dust Token';
        continue;
      }
      
      const cacheKey = network ? `${network}:${token.mint}` : token.mint;
      
      // Log all tokens for debugging
      logger.log('[Tokens] Processing token:', token.mint?.slice(0, 8), 'symbol:', token.symbol, 'name:', token.name);
      
      // Check cache first
      if (metadataCache.has(cacheKey)) {
        const cached = metadataCache.get(cacheKey);
        logger.log('[Tokens] Found in cache:', token.mint?.slice(0, 8), 'isLPToken:', cached.isLPToken, 'name:', cached.name);
        
        // Skip cached LP tokens with generic names - they need enrichment
        if (cached.isLPToken && genericLPNames.includes(cached.name)) {
          logger.log('[Tokens] Quick pass: skipping cached LP with generic name:', cached.name);
          Object.assign(token, cached);
          token.needsEnrichment = true;
          // Ensure XLP icon for LP tokens
          token.logoURI = XLP_LOGO_URL;
          // Still update price from XDEX
          const xdexPrice = xdexPrices[token.mint]?.price;
          if (xdexPrice !== undefined && xdexPrice !== null && !isNaN(xdexPrice)) {
            token.price = parseFloat(xdexPrice);
          }
          continue;
        }
        Object.assign(token, cached);
        // Ensure XLP icon for LP tokens loaded from cache
        if (cached.isLPToken) {
          token.logoURI = XLP_LOGO_URL;
        }
        // Override with XDEX price if available
        const xdexPrice = xdexPrices[token.mint]?.price;
        if (xdexPrice !== undefined && xdexPrice !== null && !isNaN(xdexPrice)) {
          token.price = parseFloat(xdexPrice);
          updatePriceCache(token.mint, token.price);
        }
        continue;
      }
      
      // Check known tokens FIRST (hardcoded reliable data)
      const known = getKnownTokenMetadata(token.mint, network);
      if (known) {
        token.symbol = known.symbol;
        token.name = known.name;
        token.logoURI = known.logoURI;
        // Use known price as default, but prefer XDEX price if available
        token.price = known.price;
        const xdexPrice = xdexPrices[token.mint]?.price;
        if (xdexPrice !== undefined && xdexPrice !== null && !isNaN(xdexPrice)) {
          token.price = parseFloat(xdexPrice);
          updatePriceCache(token.mint, token.price);
          logger.log('[Tokens] XDEX price for', token.symbol, ':', token.price);
        }
        metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: token.logoURI, price: token.price });
        continue;
      }
      
      // Apply XDEX data if available (for non-hardcoded tokens)
      if (xdexPrices[token.mint]) {
        const xdexData = xdexPrices[token.mint];
        logger.log('[Tokens] XDEX data for:', token.mint?.slice(0, 8), 'symbol:', xdexData.symbol, 'name:', xdexData.name, 'isLPToken:', xdexData.isLPToken);
        
        if (xdexData.price !== undefined && xdexData.price !== null) {
          token.price = parseFloat(xdexData.price);
          updatePriceCache(token.mint, token.price);
        }
        // Use XDEX metadata
        if (xdexData.symbol) token.symbol = xdexData.symbol;
        if (xdexData.name) token.name = xdexData.name;
        
        // AGGRESSIVE LP TOKEN DETECTION - use flag from XDEX or detect by pattern
        const tokenName = (xdexData.name || '').toLowerCase();
        const tokenSymbol = (xdexData.symbol || '').toUpperCase();
        
        // Check for XLP/SLP in symbol or name
        const isLPToken = xdexData.isLPToken || 
                          tokenSymbol === 'XLP' || 
                          tokenSymbol === 'SLP' || 
                          tokenSymbol.includes('XLP') ||     // catches "WXNT-USDC.X XLP"
                          tokenSymbol.includes('SLP') ||
                          tokenName.includes('xlp') ||       // catches "wxnt-usdc.x xlp"
                          tokenName.includes(' lp') ||
                          tokenName.includes('lp token') ||
                          tokenName.includes('/') ||
                          (tokenName.includes('xdex') && tokenName.includes('lp')) ||
                          /[a-z0-9.]+\/[a-z0-9.]+/i.test(xdexData.name);
        
        logger.log('[Tokens] LP detection for', token.mint?.slice(0, 8), '- isLPToken:', isLPToken, 'tokenName:', tokenName, 'tokenSymbol:', tokenSymbol);
        
        if (isLPToken) {
          token.isLPToken = true;
          token.logoURI = XLP_LOGO_URL;  // Always use XLP icon for LP tokens
          logger.log('[Tokens] Quick pass: LP token detected:', token.symbol, token.name, 'logoURI:', token.logoURI);
          
          // Check if we have a good name (not generic)
          const hasGoodName = token.name && 
            token.name !== 'XLP' &&
            token.name !== 'SLP' &&
            token.name !== 'SPL Token' && 
            token.name !== 'Token-2022' &&
            token.name !== 'XDEX LP Token' &&
            token.name !== 'Unknown Token';
          
          if (hasGoodName) {
            // Cache the good LP data
            metadataCache.set(cacheKey, { 
              symbol: token.symbol, 
              name: token.name, 
              logoURI: token.logoURI, 
              price: token.price,
              isLPToken: true
            });
            logger.log('[Tokens] Quick pass: LP token with good name:', token.name);
          } else {
            // Need enrichment to get real name
            token.needsEnrichment = true;
            logger.log('[Tokens] Quick pass: LP token needs enrichment:', token.mint?.slice(0, 8));
          }
          continue;
        }
        
        // For non-LP tokens, use XDEX image if valid
        if (xdexData.image) {
          token.logoURI = xdexData.image;
        }
        
        // Cache if we have good data
        if (xdexData.symbol && xdexData.name) {
          metadataCache.set(cacheKey, { 
            symbol: token.symbol, 
            name: token.name, 
            logoURI: token.logoURI, 
            price: token.price 
          });
          continue;
        }
      }
      
      // If no price found, check persistent cache
      if (token.price === undefined || token.price === null) {
        const cachedPrice = getCachedPrice(token.mint);
        if (cachedPrice !== undefined) {
          token.price = cachedPrice;
        }
      }
      
      // Fallback defaults
      if (!token.symbol) {
        token.symbol = token.mint ? token.mint.slice(0, 4).toUpperCase() : 'UNK';
      }
      if (!token.name) {
        token.name = token.isToken2022 ? 'Token-2022' : 'SPL Token';
      }
    }
    
    logger.log('[Tokens] Quick pass done in', Date.now() - startTime, 'ms - RETURNING IMMEDIATELY');
    
    // DUST GATE: Skip expensive enrichment for dust/spam tokens
    // This dramatically speeds up wallets with many spam tokens
    // (DUST_RAW_THRESHOLD already defined in pre-filter above)
    const DUST_USD_THRESHOLD = 0.01;  // Skip enrichment if value < $0.01
    
    // Identify tokens that still need metadata enrichment
    const tokensNeedingMetadata = tokens.filter(t => {
      // Already filtered as dust in pre-filter
      if (t.isDust || t.skipEnrichment) {
        return false;
      }
      
      // Check if this is a dust token by value
      if (t.price && t.uiAmount) {
        const valueUsd = t.uiAmount * t.price;
        if (valueUsd < DUST_USD_THRESHOLD) {
          t.skipEnrichment = true;
          logger.log('[Tokens] Skipping dust token:', t.mint?.slice(0, 8), 'value:', valueUsd);
          return false;
        }
      }
      
      // Explicitly marked for enrichment
      if (t.needsEnrichment) return true;
      
      const cacheKey = network ? `${network}:${t.mint}` : t.mint;
      if (!metadataCache.has(cacheKey)) return true;
      
      const cached = metadataCache.get(cacheKey);
      // LP tokens with generic names need enrichment
      if (cached.isLPToken && genericLPNames.includes(cached.name)) return true;
      // Tokens without logos need enrichment
      return !cached.logoURI;
    });
    
    // If we have tokens needing metadata and a callback, enrich in background
    if (tokensNeedingMetadata.length > 0) {
      logger.log('[Tokens] Will enrich', tokensNeedingMetadata.length, 'tokens in background');
      
      // Fire and forget - enrich in background
      (async () => {
        try {
          // Process in larger batches for speed
          const batchSize = 10;  // Increased from 5 to 10
          let updated = false;
          
          for (let i = 0; i < tokensNeedingMetadata.length; i += batchSize) {
            const batch = tokensNeedingMetadata.slice(i, i + batchSize);
            await Promise.allSettled(batch.map(async (token) => {
              try {
                await enrichTokenMetadata(rpcUrl, token, network);
                updated = true;
              } catch (e) {
                logger.warn('[Tokens] Failed to enrich metadata for', token.mint, e.message);
              }
            }));
            
            // Notify after each batch if we have updates and a callback
            if (updated && onUpdate) {
              onUpdate([...tokens]);
              updated = false;
            }
            // No delay between batches - let rate limiter handle it
          }
          
          // Final update
          if (onUpdate) {
            onUpdate([...tokens]);
          }
          
          // Save metadata cache to localStorage for faster future loads
          saveMetadataCache();
          
          logger.log('[Tokens] Background enrichment complete in', Date.now() - startTime, 'ms');
        } catch (e) {
          logger.warn('[Tokens] Background enrichment error:', e);
        }
      })();
    }
    
    // IMPORT MODE: Fetch prices in background after returning tokens immediately
    if (mode === 'import' && onUpdate && tokens.length > 0) {
      logger.log('[Tokens] Import mode - fetching prices in background');
      (async () => {
        try {
          // Wait a tick to let UI render first
          await new Promise(r => setTimeout(r, 100));
          
          // Fetch XDEX prices in background
          const priceData = await fetchXDEXWalletTokens(ownerAddress, network);
          
          if (Object.keys(priceData).length > 0) {
            let pricesUpdated = false;
            
            // Apply prices to tokens
            for (const token of tokens) {
              if (priceData[token.mint]) {
                const data = priceData[token.mint];
                if (data.price !== undefined && data.price !== null && !isNaN(data.price)) {
                  token.price = parseFloat(data.price);
                  updatePriceCache(token.mint, token.price);
                  pricesUpdated = true;
                }
                // Also apply any metadata we got
                if (data.symbol && !token.symbol) token.symbol = data.symbol;
                if (data.name && (!token.name || token.name === 'Unknown Token')) token.name = data.name;
                if (data.image && !token.logoURI) token.logoURI = data.image;
              }
            }
            
            if (pricesUpdated) {
              logger.log('[Tokens] Background prices applied for', Object.keys(priceData).length, 'tokens');
              onUpdate([...tokens]);
            }
          }
        } catch (e) {
          logger.warn('[Tokens] Background price fetch error:', e.message);
        }
      })();
    }
    
    // Save metadata cache after quick pass (for known tokens/cached data)
    saveMetadataCache();
    
    logger.log('[Tokens] Returning', tokens.length, 'tokens');
    return tokens;
  } catch (e) {
    logger.error('[Tokens] Error fetching token accounts:', e);
    return [];
  }
}

/**
 * Fetch wallet tokens with prices from XDEX API (batch endpoint)
 * This is the primary source for token prices - fetches ALL tokens in ONE call
 */
async function fetchXDEXWalletTokens(walletAddress, network) {
  try {
    const networkName = network || 'X1 Mainnet';
    const cacheKey = `${walletAddress}:${networkName}`;
    
    // Check cache first
    const cached = walletTokensCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < WALLET_TOKENS_CACHE_TTL) {
      logger.log('[XDEX] Using cached wallet tokens response');
      return cached.data;
    }
    
    const url = `https://devapi.xdex.xyz/api/xendex/wallet/tokens?wallet_address=${walletAddress}&network=${encodeURIComponent(networkName)}&price=true`;
    
    logger.log('[XDEX] Fetching wallet tokens with prices');
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);  // 5s timeout for price data
    
    const response = await fetch(url, { 
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    clearTimeout(timeout);
    
    if (!response.ok) {
      logger.warn('[XDEX] Wallet tokens API returned:', response.status);
      // Cache empty result to avoid hammering API
      walletTokensCache.set(cacheKey, { data: {}, timestamp: Date.now() });
      return {};
    }
    
    const data = await response.json();
    
    // Handle nested response: { success: true, data: { tokens: [...] } }
    const tokenList = data?.data?.tokens || data?.tokens || (Array.isArray(data) ? data : []);
    logger.log('[XDEX] Wallet tokens response - count:', tokenList.length);
    
    // Log first token structure
    if (tokenList[0]) {
      logger.log('[XDEX] Sample token fields:', Object.keys(tokenList[0]).join(', '));
    }
    
    // Build a map of mint -> token data with prices
    const priceMap = {};
    
    // Helper to extract price from various field names
    const extractPrice = (token) => {
      const priceValue = token.price ?? token.priceUsd ?? token.price_usd ?? 
                         token.priceUSD ?? token.usdPrice ?? token.usd_price ?? 
                         token.tokenPrice ?? token.token_price ?? null;
      
      if (priceValue !== null && priceValue !== undefined) {
        const parsed = parseFloat(priceValue);
        if (!isNaN(parsed) && parsed >= 0) {
          return parsed;
        }
      }
      return null;
    };
    
    for (const token of tokenList) {
      if (token.mint || token.address) {
        const mint = token.mint || token.address;
        const price = extractPrice(token);
        
        // Get image URL, but only if it's a full URL
        let imageUrl = token.imageUrl || token.image || token.logo || token.logoURI || token.icon;
        if (imageUrl && !imageUrl.startsWith('http')) {
          imageUrl = null;
        }
        
        // AGGRESSIVE LP TOKEN DETECTION - catch all XDEX LP tokens
        const tokenName = (token.name || '').toLowerCase();
        const tokenSymbol = (token.symbol || '').toUpperCase();
        
        // Check for XLP/SLP in symbol or name
        const isLP = tokenSymbol === 'XLP' || 
                     tokenSymbol === 'SLP' ||
                     tokenSymbol.includes('XLP') ||     // catches "WXNT-USDC.X XLP"
                     tokenSymbol.includes('SLP') ||
                     tokenName.includes('xlp') ||       // catches "wxnt-usdc.x xlp"
                     tokenName.includes(' lp') ||
                     tokenName.includes('lp token') ||
                     tokenName.includes('/') ||
                     (tokenName.includes('xdex') && tokenName.includes('lp')) ||
                     /[a-z0-9.]+\/[a-z0-9.]+/i.test(token.name);
        
        if (isLP) {
          logger.log('[XDEX] Detected LP token:', token.symbol, token.name);
        }
        
        priceMap[mint] = {
          price: price,
          symbol: token.symbol,
          name: token.name,
          image: isLP ? XLP_LOGO_URL : imageUrl,  // Use XLP icon for LP tokens
          isLPToken: isLP
        };
        
        if (price !== null) {
          logger.log('[XDEX] Price found for', token.symbol || mint.slice(0,8), ':', price);
        }
      }
    }
    
    logger.log('[XDEX] Total prices extracted:', Object.values(priceMap).filter(p => p.price !== null).length);
    
    // Cache the result
    walletTokensCache.set(cacheKey, { data: priceMap, timestamp: Date.now() });
    
    return priceMap;
  } catch (e) {
    if (e.name === 'AbortError') {
      logger.warn('[XDEX] Wallet tokens request timeout');
    } else {
      logger.warn('[XDEX] Failed to fetch wallet tokens:', e.message);
    }
    return {};
  }
}

// Fetch token accounts by program
async function fetchTokenAccountsByProgram(rpcUrl, ownerAddress, programId) {
  if (!rpcUrl) {
    logger.error('[Tokens] No RPC URL provided');
    return [];
  }
  
  logger.log(`[Tokens] Fetching ${programId === TOKEN_2022_PROGRAM_ID ? 'Token-2022' : 'SPL Token'} accounts from:`, rpcUrl);
  
  const maxRetries = 2;
  let lastError = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);  // 8s timeout - RPC can be slow
      
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTokenAccountsByOwner',
          params: [
            ownerAddress,
            { programId: programId },
            { encoding: 'jsonParsed', commitment: 'confirmed' }
          ]
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeout);
      
      if (!response.ok) {
        logger.error(`[Tokens] HTTP error: ${response.status} ${response.statusText} (attempt ${attempt}/${maxRetries})`);
        lastError = new Error(`HTTP ${response.status}`);
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 500 * attempt));
          continue;
        }
        return [];
      }
      
      const data = await response.json();
      
      if (data.error) {
        logger.warn('[Tokens] RPC error fetching tokens:', data.error, `(attempt ${attempt}/${maxRetries})`);
        lastError = data.error;
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 500 * attempt));
          continue;
        }
        return [];
      }
      
      if (!data.result?.value) {
        logger.log('[Tokens] No token accounts found');
        return [];
      }
      
      const tokens = data.result.value.map(item => {
        const info = item.account.data.parsed.info;
        const uiAmount = info.tokenAmount.uiAmount || 0;
        
        return {
          address: item.pubkey,
          mint: info.mint,
          owner: info.owner,
          amount: info.tokenAmount.amount,
          decimals: info.tokenAmount.decimals,
          uiAmount: uiAmount,
          balance: uiAmount,
          programId: programId,
          isToken2022: programId === TOKEN_2022_PROGRAM_ID
        };
      }).filter(t => parseFloat(t.amount) > 0);
      
      logger.log(`[Tokens] Found ${tokens.length} ${programId === TOKEN_2022_PROGRAM_ID ? 'Token-2022' : 'SPL'} tokens`);
      return tokens;
      
    } catch (e) {
      if (e.name === 'AbortError') {
        logger.error(`[Tokens] Request timeout (attempt ${attempt}/${maxRetries})`);
      } else {
        logger.error(`[Tokens] Error fetching ${programId} accounts:`, e.message || e, `(attempt ${attempt}/${maxRetries})`);
      }
      lastError = e;
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 500 * attempt));  // Reduced retry delay
        continue;
      }
    }
  }
  
  logger.error('[Tokens] All retry attempts failed:', lastError);
  return [];
}

// ============================================
// METADATA ENRICHMENT
// ============================================

// Enrich token with metadata
async function enrichTokenMetadata(rpcUrl, token, network = null) {
  const cacheKey = network ? `${network}:${token.mint}` : token.mint;
  
  // If token is already marked as LP token with a name, preserve it
  if (token.isLPToken && token.name && token.name !== 'SPL Token' && token.name !== 'Token-2022') {
    metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: token.logoURI, isLPToken: true, price: token.price });
    logger.log('[Tokens] Preserving existing LP token data:', token.name);
    return;
  }
  
  // Check cache - but only use if it has complete data
  if (metadataCache.has(cacheKey)) {
    const cached = metadataCache.get(cacheKey);
    if (cached.name && cached.name !== 'Unknown Token' && cached.logoURI) {
      Object.assign(token, cached);
      return;
    }
  }
  
  // Check known tokens first
  const known = getKnownTokenMetadata(token.mint, network);
  if (known) {
    token.symbol = known.symbol;
    token.name = known.name;
    token.logoURI = known.logoURI;
    if (known.isToken2022 !== undefined) token.isToken2022 = known.isToken2022;
    if (known.price !== undefined) token.price = known.price;
    metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: token.logoURI, price: token.price });
    return;
  }
  
  // Check if this is an XDEX LP token (by mint authority)
  const isLP = await checkAndApplyLPBranding(rpcUrl, token, network);
  if (isLP) {
    metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: token.logoURI, isLPToken: true, price: token.price });
    return;
  }
  
  let apiMetadata = null;
  
  // Try X1 Mobile API
  try {
    apiMetadata = await fetchTokenMetadataFromAPI(token.mint);
    if (apiMetadata && apiMetadata.name && apiMetadata.logoURI) {
      token.symbol = apiMetadata.symbol || token.mint.slice(0, 4);
      token.name = apiMetadata.name;
      token.logoURI = apiMetadata.logoURI;
      token.price = apiMetadata.price || null;
      
      // If we have price, we're done. Otherwise continue to check for price.
      if (token.price !== null && token.price !== undefined) {
        metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: token.logoURI, price: token.price });
        return;
      }
      // Continue to try to get price from other sources
    }
  } catch (e) {
    logger.warn('[Tokens] Failed to fetch from X1 Mobile API:', e.message);
  }
  
  // Try Token-2022 extension metadata
  if (token.isToken2022) {
    try {
      const extMetadata = await fetchToken2022Metadata(rpcUrl, token.mint);
      if (extMetadata && extMetadata.name) {
        token.symbol = extMetadata.symbol || token.mint.slice(0, 4);
        token.name = extMetadata.name || 'Unknown Token';
        token.logoURI = extMetadata.uri || null;
        
        if (extMetadata.uri) {
          try {
            const uriMetadata = await fetchTokenMetadataFromURI(extMetadata.uri);
            if (uriMetadata?.image) token.logoURI = uriMetadata.image;
          } catch (e) {
            logger.warn('[Tokens] Failed to fetch metadata from URI:', e.message);
          }
        }
        
        metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: token.logoURI, price: token.price });
        return;
      }
    } catch (e) {
      logger.warn('[Tokens] Failed to fetch Token-2022 extension metadata:', e.message);
    }
  }
  
  // Try Metaplex on-chain metadata
  try {
    const metaplexData = await fetchMetaplexMetadata(rpcUrl, token.mint);
    if (metaplexData) {
      token.symbol = apiMetadata?.symbol || metaplexData.symbol || token.mint.slice(0, 4);
      token.name = apiMetadata?.name || metaplexData.name || 'Unknown Token';
      token.logoURI = null; // Will be set from URI fetch
      token.price = apiMetadata?.price || null;
      
      if (metaplexData.uri && metaplexData.uri.startsWith('http')) {
        try {
          logger.log('[Metaplex] Fetching URI metadata:', metaplexData.uri.substring(0, 60));
          const uriMetadata = await fetchTokenMetadataFromURI(metaplexData.uri);
          if (uriMetadata?.image) token.logoURI = uriMetadata.image;
          if (uriMetadata?.name && !apiMetadata?.name) token.name = uriMetadata.name;
          if (uriMetadata?.symbol && !apiMetadata?.symbol) token.symbol = uriMetadata.symbol;
        } catch (e) {
          logger.warn('[Metaplex] Failed to fetch metadata from URI:', e.message);
        }
      }
      
      metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: token.logoURI, price: token.price });
      return;
    }
  } catch (e) {
    logger.warn('[Tokens] Failed to fetch Metaplex on-chain metadata:', e.message);
  }
  
  // Try DAS API
  try {
    const dasData = await fetchFromDAS(rpcUrl, token.mint);
    if (dasData && dasData.name) {
      token.symbol = dasData.symbol || token.mint.slice(0, 4);
      token.name = dasData.name;
      token.logoURI = dasData.logoURI || null;
      token.price = apiMetadata?.price || null;
      
      if (!token.logoURI && dasData.uri) {
        try {
          const uriMetadata = await fetchTokenMetadataFromURI(dasData.uri);
          if (uriMetadata?.image) token.logoURI = uriMetadata.image;
        } catch (e) {
          logger.warn('[Tokens] Failed to fetch metadata from DAS URI:', e.message);
        }
      }
      
      metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: token.logoURI, price: token.price });
      return;
    }
  } catch (e) {
    logger.warn('[Tokens] Failed to fetch from DAS API:', e.message);
  }
  
  // Try Jupiter API (for Solana tokens)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const jupiterResponse = await fetch(`https://lite-api.jup.ag/tokens/v1/token/${token.mint}`, {
      signal: controller.signal
    });
    clearTimeout(timeout);
    
    if (jupiterResponse.ok) {
      const jupiterData = await jupiterResponse.json();
      if (jupiterData && jupiterData.name) {
        token.symbol = jupiterData.symbol || token.mint.slice(0, 4);
        token.name = jupiterData.name;
        token.logoURI = jupiterData.logoURI || null;
        metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: token.logoURI, price: token.price });
        return;
      }
    }
  } catch (e) {
    // Silently ignore - Jupiter may not have the token
  }
  
  // Try XDEX API with rate limiting (single token endpoint as fallback)
  const xdexCacheKey = `xdex:${token.mint}`;
  if (!hasRecentlyFailed(xdexCacheKey)) {
    try {
      logger.log('[Token API] Trying XDEX API for:', token.mint);
      
      const xdexResponse = await fetchWithRateLimit(
        'https://api.xdex.xyz/api/xendex/tokens/' + token.mint,
        { signal: AbortSignal.timeout(3000) }
      );
      
      if (xdexResponse.status === 429) {
        logger.warn('[Token API] XDEX rate limited for:', token.mint);
        markFailed(xdexCacheKey);
      } else if (xdexResponse.status === 404) {
        markFailed(xdexCacheKey);
      } else if (xdexResponse.ok) {
        clearFailed(xdexCacheKey);
        const xdexData = await xdexResponse.json();
        logger.log('[Token API] XDEX response:', xdexData);
        
        // Get price from XDEX if available
        let xdexPrice = null;
        if (xdexData.price !== undefined && xdexData.price !== null) {
          xdexPrice = parseFloat(xdexData.price);
        } else if (xdexData.priceUsd !== undefined && xdexData.priceUsd !== null) {
          xdexPrice = parseFloat(xdexData.priceUsd);
        }
        
        // If we already have metadata from mobile API, just grab the price
        if (token.name && token.name !== 'Unknown Token' && token.logoURI) {
          if (xdexPrice !== null && (token.price === null || token.price === undefined)) {
            token.price = xdexPrice;
            logger.log('[Token API] Got price from XDEX:', xdexPrice, 'for', token.symbol);
          }
          metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: token.logoURI, price: token.price });
          return;
        }
        
        // Otherwise use full XDEX metadata
        if (xdexData.name) {
          token.symbol = xdexData.symbol || token.symbol || token.mint.slice(0, 4);
          token.name = xdexData.name;
          token.logoURI = xdexData.image || xdexData.logo || xdexData.logoURI || xdexData.icon || token.logoURI || null;
          if (xdexPrice !== null) {
            token.price = xdexPrice;
          }
          metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: token.logoURI, price: token.price });
          return;
        }
      }
    } catch (e) {
      logger.warn('[Token API] XDEX API failed:', e.message);
      markFailed(xdexCacheKey);
    }
  }
  
  // Fallback to API metadata if we have it
  if (apiMetadata && apiMetadata.name) {
    token.symbol = apiMetadata.symbol || token.mint.slice(0, 4);
    token.name = apiMetadata.name;
    token.logoURI = null;
    token.price = apiMetadata.price || null;
    metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: null, price: token.price });
    return;
  }
  
  // Final fallback
  token.symbol = token.mint.slice(0, 4) + '..';
  token.name = 'Unknown Token';
  token.logoURI = null;
  metadataCache.set(token.mint, { symbol: token.symbol, name: token.name, logoURI: null });
}

/**
 * Fetch just the price for a token from XDEX (with rate limiting)
 */
export async function fetchTokenPriceFromXDEX(mint) {
  const cacheKey = `xdex-price:${mint}`;
  
  if (hasRecentlyFailed(cacheKey)) {
    return null;
  }
  
  try {
    const response = await fetchWithRateLimit(
      'https://api.xdex.xyz/api/xendex/tokens/' + mint,
      { signal: AbortSignal.timeout(3000) }
    );
    
    if (response.status === 429 || response.status === 404) {
      markFailed(cacheKey);
      return null;
    }
    
    if (response.ok) {
      clearFailed(cacheKey);
      const data = await response.json();
      if (data.price !== undefined && data.price !== null) {
        return parseFloat(data.price);
      }
      if (data.priceUsd !== undefined && data.priceUsd !== null) {
        return parseFloat(data.priceUsd);
      }
    } else {
      markFailed(cacheKey);
    }
    return null;
  } catch (e) {
    markFailed(cacheKey);
    return null;
  }
}

// ============================================
// METAPLEX ON-CHAIN METADATA
// ============================================

// Fetch Metaplex on-chain metadata using getProgramAccounts
async function fetchMetaplexMetadata(rpcUrl, mint) {
  try {
    logger.log('[Metaplex] Fetching metadata for mint:', mint);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);  // Longer timeout
    
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getProgramAccounts',
        params: [
          METADATA_PROGRAM_ID,
          {
            encoding: 'base64',
            filters: [{ memcmp: { offset: 33, bytes: mint } }]
          }
        ]
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    
    const data = await response.json();
    
    if (data.error) {
      logger.warn('[Metaplex] RPC error:', data.error.message || data.error);
      return null;
    }
    
    if (!data.result || data.result.length === 0) {
      logger.log('[Metaplex] No metadata account found for:', mint);
      return null;
    }
    
    const accountData = data.result[0].account.data[0];
    const bytes = Uint8Array.from(atob(accountData), c => c.charCodeAt(0));
    const parsed = parseMetaplexMetadata(bytes);
    
    logger.log('[Metaplex] Parsed metadata:', parsed?.name, parsed?.symbol, parsed?.uri?.substring(0, 50));
    return parsed;
  } catch (e) {
    if (e.name === 'AbortError') {
      logger.warn('[Metaplex] Request timeout for:', mint);
    } else {
      logger.warn('[Metaplex] Error fetching on-chain metadata:', e.message);
    }
    return null;
  }
}

// Parse Metaplex metadata bytes
function parseMetaplexMetadata(data) {
  try {
    let offset = 65;
    
    const nameLen = data[offset] | data[offset + 1] << 8 | data[offset + 2] << 16 | data[offset + 3] << 24;
    offset += 4;
    const name = new TextDecoder().decode(data.slice(offset, offset + nameLen)).replace(/\0/g, '').trim();
    offset += nameLen;
    
    const symbolLen = data[offset] | data[offset + 1] << 8 | data[offset + 2] << 16 | data[offset + 3] << 24;
    offset += 4;
    const symbol = new TextDecoder().decode(data.slice(offset, offset + symbolLen)).replace(/\0/g, '').trim();
    offset += symbolLen;
    
    const uriLen = data[offset] | data[offset + 1] << 8 | data[offset + 2] << 16 | data[offset + 3] << 24;
    offset += 4;
    const uri = new TextDecoder().decode(data.slice(offset, offset + uriLen)).replace(/\0/g, '').trim();
    
    return { name, symbol, uri };
  } catch (e) {
    logger.warn('Error parsing metadata:', e);
    return null;
  }
}

// ============================================
// TOKEN-2022 METADATA
// ============================================

// Fetch Token-2022 extension metadata
export async function fetchToken2022Metadata(rpcUrl, mint) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAccountInfo',
        params: [mint, { encoding: 'jsonParsed' }]
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    
    const data = await response.json();
    if (!data.result?.value?.data?.parsed?.info) return null;
    
    const info = data.result.value.data.parsed.info;
    if (info.extensions) {
      for (const ext of info.extensions) {
        if (ext.extension === 'tokenMetadata') {
          const state = ext.state;
          return {
            name: state.name || null,
            symbol: state.symbol || null,
            uri: state.uri || null
          };
        }
      }
    }
    return null;
  } catch (e) {
    logger.warn('Error fetching Token-2022 metadata:', e);
    return null;
  }
}

// ============================================
// URI METADATA FETCH (IPFS, Arweave, etc.)
// ============================================

// Fetch metadata from URI (IPFS, Arweave, etc.)
export async function fetchTokenMetadataFromURI(uri) {
  if (!uri) return null;
  
  try {
    let fetchUrl = uri;
    
    // Handle various IPFS formats
    if (uri.startsWith('ipfs://')) {
      fetchUrl = uri.replace('ipfs://', 'https://ipfs.io/ipfs/');
    } else if (uri.includes('/ipfs/') && !uri.startsWith('http')) {
      // Handle bare IPFS paths
      fetchUrl = 'https://ipfs.io' + uri;
    }
    
    // Handle Arweave
    if (uri.startsWith('ar://')) {
      fetchUrl = uri.replace('ar://', 'https://arweave.net/');
    }
    
    logger.log('[URI] Fetching metadata from:', fetchUrl.substring(0, 80));
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);  // Increased timeout for IPFS
    
    const response = await fetch(fetchUrl, { signal: controller.signal });
    clearTimeout(timeout);
    
    if (!response.ok) {
      logger.warn('[URI] HTTP error:', response.status, 'for:', fetchUrl.substring(0, 50));
      return null;
    }
    
    const data = await response.json();
    let image = data.image;
    
    // Handle various image URI formats
    if (image) {
      if (image.startsWith('ipfs://')) {
        image = image.replace('ipfs://', 'https://ipfs.io/ipfs/');
      } else if (image.startsWith('ar://')) {
        image = image.replace('ar://', 'https://arweave.net/');
      }
    }
    
    logger.log('[URI] Got metadata - name:', data.name, 'symbol:', data.symbol, 'hasImage:', !!image);
    
    return {
      name: data.name,
      symbol: data.symbol,
      image: image,
      description: data.description
    };
  } catch (e) {
    if (e.name === 'AbortError') {
      logger.warn('[URI] Timeout fetching:', uri?.substring(0, 50));
    } else {
      logger.warn('[URI] Failed to fetch metadata from:', uri?.substring(0, 50), e.message);
    }
    return null;
  }
}