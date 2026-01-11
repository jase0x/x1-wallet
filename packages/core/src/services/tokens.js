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

// Cache for failed requests to avoid retrying them repeatedly
const failedRequestsCache = new Map();
const FAILED_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function hasRecentlyFailed(key) {
  const failedAt = failedRequestsCache.get(key);
  if (!failedAt) return false;
  
  if (Date.now() - failedAt > FAILED_CACHE_TTL) {
    failedRequestsCache.delete(key);
    return false;
  }
  return true;
}

function markFailed(key) {
  failedRequestsCache.set(key, Date.now());
}

function clearFailed(key) {
  failedRequestsCache.delete(key);
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

// Check if a token is an XDEX LP token by its mint authority
async function checkAndApplyLPBranding(rpcUrl, token, network) {
  // Only check on X1 networks where XDEX operates
  if (!network?.includes('X1')) return false;
  
  try {
    const mintAuthority = await fetchMintAuthority(rpcUrl, token.mint);
    
    if (mintAuthority === XDEX_LP_MINT_AUTHORITY) {
      token.symbol = 'XLP';
      token.name = 'XDEX LP Token';
      token.logoURI = XLP_LOGO_URL;
      token.isLPToken = true;
      logger.log(`[Tokens] Detected XDEX LP token: ${token.mint}`);
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

// Metadata cache (in-memory)
const metadataCache = new Map();

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

// Fetch all token accounts for an address
export async function fetchTokenAccounts(rpcUrl, ownerAddress, network = null, onUpdate = null) {
  const tokens = [];
  const startTime = Date.now();
  
  try {
    logger.log('[Tokens] Starting token fetch for:', ownerAddress, 'on network:', network);
    
    // Fetch tokens from RPC and XDEX price API in parallel
    const [splTokens, token2022, xdexPrices] = await Promise.all([
      fetchTokenAccountsByProgram(rpcUrl, ownerAddress, TOKEN_PROGRAM_ID),
      fetchTokenAccountsByProgram(rpcUrl, ownerAddress, TOKEN_2022_PROGRAM_ID),
      fetchXDEXWalletTokens(ownerAddress, network)
    ]);
    
    logger.log('[Tokens] RPC done in', Date.now() - startTime, 'ms - SPL:', splTokens.length, 'Token2022:', token2022.length);
    logger.log('[Tokens] XDEX prices received for', Object.keys(xdexPrices).length, 'tokens');
    
    tokens.push(...splTokens, ...token2022);
    
    // Quick pass: apply cached/known metadata and XDEX prices
    for (const token of tokens) {
      const cacheKey = network ? `${network}:${token.mint}` : token.mint;
      
      // Check cache first
      if (metadataCache.has(cacheKey)) {
        const cached = metadataCache.get(cacheKey);
        Object.assign(token, cached);
        // Keep XDEX price if we got one (prices update more frequently)
        if (xdexPrices[token.mint]?.price !== undefined) {
          token.price = parseFloat(xdexPrices[token.mint].price);
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
        if (xdexPrices[token.mint]?.price !== undefined) {
          token.price = parseFloat(xdexPrices[token.mint].price);
          updatePriceCache(token.mint, token.price);
        }
        metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: token.logoURI, price: token.price });
        continue;
      }
      
      // Apply XDEX data if available (for non-hardcoded tokens)
      if (xdexPrices[token.mint]) {
        const xdexData = xdexPrices[token.mint];
        if (xdexData.price !== undefined && xdexData.price !== null) {
          token.price = parseFloat(xdexData.price);
          updatePriceCache(token.mint, token.price);
        }
        // Use XDEX metadata
        if (xdexData.symbol) token.symbol = xdexData.symbol;
        if (xdexData.name) token.name = xdexData.name;
        if (xdexData.image) token.logoURI = xdexData.image;
        
        // If XDEX provided complete data (symbol, name, AND image), cache it
        if (xdexData.symbol && xdexData.name && xdexData.image) {
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
    
    // Identify tokens that still need metadata enrichment
    const tokensNeedingMetadata = tokens.filter(t => {
      const cacheKey = network ? `${network}:${t.mint}` : t.mint;
      if (!metadataCache.has(cacheKey)) return true;
      const cached = metadataCache.get(cacheKey);
      return !cached.logoURI;
    });
    
    // If we have tokens needing metadata and a callback, enrich in background
    if (tokensNeedingMetadata.length > 0) {
      logger.log('[Tokens] Will enrich', tokensNeedingMetadata.length, 'tokens in background');
      
      // Fire and forget - enrich in background
      (async () => {
        try {
          // Process in batches to avoid overwhelming APIs
          const batchSize = 5;
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
            
            // Small delay between batches
            if (i + batchSize < tokensNeedingMetadata.length) {
              await new Promise(r => setTimeout(r, 100));
            }
          }
          
          // Final update
          if (onUpdate) {
            onUpdate([...tokens]);
          }
          
          logger.log('[Tokens] Background enrichment complete in', Date.now() - startTime, 'ms');
        } catch (e) {
          logger.warn('[Tokens] Background enrichment error:', e);
        }
      })();
    }
    
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
    const url = `https://devapi.xdex.xyz/api/xendex/wallet/tokens?wallet_address=${walletAddress}&network=${encodeURIComponent(networkName)}&price=true`;
    
    logger.log('[XDEX] Fetching wallet tokens with prices:', url);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(url, { 
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    clearTimeout(timeout);
    
    if (!response.ok) {
      logger.warn('[XDEX] Wallet tokens API returned:', response.status);
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
        
        priceMap[mint] = {
          price: price,
          symbol: token.symbol,
          name: token.name,
          image: imageUrl
        };
        
        if (price !== null) {
          logger.log('[XDEX] Price found for', token.symbol || mint.slice(0,8), ':', price);
        }
      }
    }
    
    logger.log('[XDEX] Total prices extracted:', Object.values(priceMap).filter(p => p.price !== null).length);
    
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
      const timeout = setTimeout(() => controller.abort(), 5000);
      
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
          await new Promise(r => setTimeout(r, 1000 * attempt));
          continue;
        }
        return [];
      }
      
      const data = await response.json();
      
      if (data.error) {
        logger.warn('[Tokens] RPC error fetching tokens:', data.error, `(attempt ${attempt}/${maxRetries})`);
        lastError = data.error;
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
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
        
        logger.log(`[Tokens] Found token: mint=${info.mint?.slice(0, 8)}... amount=${info.tokenAmount.amount} uiAmount=${uiAmount} program=${programId === TOKEN_2022_PROGRAM_ID ? 'Token-2022' : 'SPL'}`);
        
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
        await new Promise(r => setTimeout(r, 1000 * attempt));
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
  
  if (metadataCache.has(cacheKey)) {
    const cached = metadataCache.get(cacheKey);
    Object.assign(token, cached);
    return;
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
    metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: token.logoURI, isLPToken: true });
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
      
      // If we have price, we're done. Otherwise continue to check XDEX for price.
      if (token.price !== null && token.price !== undefined) {
        metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: token.logoURI, price: token.price });
        return;
      }
      // Continue to XDEX to try to get price
    }
  } catch (e) {
    logger.warn('Failed to fetch from X1 Mobile API:', e);
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
            logger.warn('Failed to fetch metadata from URI:', e);
          }
        }
        
        metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: token.logoURI });
        return;
      }
    } catch (e) {
      logger.warn('Failed to fetch Token-2022 extension metadata:', e);
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
          const uriMetadata = await fetchTokenMetadataFromURI(metaplexData.uri);
          if (uriMetadata?.image) token.logoURI = uriMetadata.image;
          if (uriMetadata?.name && !apiMetadata?.name) token.name = uriMetadata.name;
          if (uriMetadata?.symbol && !apiMetadata?.symbol) token.symbol = uriMetadata.symbol;
        } catch (e) {
          logger.warn('Failed to fetch metadata from URI:', e);
        }
      }
      
      metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: token.logoURI, price: token.price });
      return;
    }
  } catch (e) {
    logger.warn('Failed to fetch on-chain metadata:', e);
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
          logger.warn('Failed to fetch metadata from DAS URI:', e);
        }
      }
      
      metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: token.logoURI, price: token.price });
      return;
    }
  } catch (e) {
    logger.warn('Failed to fetch from DAS API:', e);
  }
  
  // Try Jupiter API (for Solana tokens)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
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
        { signal: AbortSignal.timeout(5000) }
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

// Fetch Metaplex on-chain metadata
async function fetchMetaplexMetadata(rpcUrl, mint) {
  try {
    logger.log('[Metaplex] Fetching metadata for mint:', mint);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    
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
    if (!data.result?.length > 0) {
      logger.log('[Metaplex] No metadata account found');
      return null;
    }
    
    const accountData = data.result[0].account.data[0];
    const bytes = Uint8Array.from(atob(accountData), c => c.charCodeAt(0));
    const parsed = parseMetaplexMetadata(bytes);
    
    logger.log('[Metaplex] Parsed metadata:', parsed?.name, parsed?.symbol);
    return parsed;
  } catch (e) {
    logger.warn('Error fetching Metaplex metadata:', e);
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
    if (uri.startsWith('ipfs://')) {
      fetchUrl = uri.replace('ipfs://', 'https://ipfs.io/ipfs/');
    }
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    
    const response = await fetch(fetchUrl, { signal: controller.signal });
    clearTimeout(timeout);
    
    if (!response.ok) return null;
    
    const data = await response.json();
    let image = data.image;
    
    if (image && image.startsWith('ipfs://')) {
      image = image.replace('ipfs://', 'https://ipfs.io/ipfs/');
    }
    
    return {
      name: data.name,
      symbol: data.symbol,
      image: image,
      description: data.description
    };
  } catch (e) {
    logger.warn('Failed to fetch metadata from URI:', uri, e.message);
    return null;
  }
}