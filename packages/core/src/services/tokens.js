// Token Service for SPL and Token-2022 tokens
import { logger } from '../utils/logger.js';
import { decodeBase58, encodeBase58 } from '../utils/base58';

// API Server (same as Android app)
const API_SERVER = 'https://mobile-api.x1.xyz';

// Program IDs
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const METADATA_PROGRAM_ID = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';

// Known token list for common tokens (fallback metadata)
const KNOWN_TOKENS = {
  'So11111111111111111111111111111111111111112': {
    symbol: 'SOL',
    name: 'Wrapped SOL',
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
  },
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': {
    symbol: 'mSOL',
    name: 'Marinade staked SOL',
    decimals: 9,
    logoURI: 'https://raw.githubusercontent.com/marinade-finance/msol-logo/main/msol-logo.png'
  },
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
  'B69chRzqzDCmdB5WYB8NRu5Yv5ZA95ABiZcdzCgGm9Tq': {
    symbol: 'USDC.X',
    name: 'USDC X1',
    decimals: 6,
    logoURI: 'https://cryptologos.cc/logos/usd-coin-usdc-logo.png',
    isToken2022: true,
    price: 1
  },
  'pXNTyoqQsskHdZ7Q1rnP25FEyHHjissbs7n6RRN2nP5': {
    symbol: 'pXNT',
    name: 'Staked XNT',
    decimals: 9,
    logoURI: 'https://x1logos.s3.us-east-1.amazonaws.com/48-pxnt.png',
    isToken2022: false,
    isStakePoolToken: true
  }
};

// Network-specific token overrides
const NETWORK_TOKEN_OVERRIDES = {
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
const X1_TOKEN_OVERRIDES = {
  'So11111111111111111111111111111111111111112': {
    symbol: 'WXNT',
    name: 'Wrapped XNT',
    decimals: 9,
    logoURI: 'https://x1logos.s3.us-east-1.amazonaws.com/48.png'
  }
};

// Check if a network is X1-based
function isX1Network(network) {
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
function getKnownTokenMetadata(mint, network) {
  const networkOverrides = NETWORK_TOKEN_OVERRIDES[network];
  if (networkOverrides && networkOverrides[mint]) {
    return networkOverrides[mint];
  }
  
  if (isX1Network(network) && X1_TOKEN_OVERRIDES[mint]) {
    return X1_TOKEN_OVERRIDES[mint];
  }
  
  return KNOWN_TOKENS[mint] || null;
}

// Metadata cache
const metadataCache = new Map();

// Fetch token metadata from X1 Mobile API
export async function fetchTokenMetadataFromAPI(mint) {
  try {
    const url = `${API_SERVER}/tokens?mint=${encodeURIComponent(mint)}&verified=true`;
    logger.log('[Token API] Fetching metadata for:', mint);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000); // Reduced to 3s
    
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
    const timeout = setTimeout(() => controller.abort(), 3000); // Reduced to 3s
    
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

// Fetch all token accounts for an address
export async function fetchTokenAccounts(rpcUrl, ownerAddress, network = null) {
  const tokens = [];
  const startTime = Date.now();
  
  try {
    logger.log('[Tokens] Starting token fetch for:', ownerAddress);
    
    const [splTokens, token2022] = await Promise.all([
      fetchTokenAccountsByProgram(rpcUrl, ownerAddress, TOKEN_PROGRAM_ID),
      fetchTokenAccountsByProgram(rpcUrl, ownerAddress, TOKEN_2022_PROGRAM_ID)
    ]);
    
    logger.log('[Tokens] RPC done in', Date.now() - startTime, 'ms - SPL:', splTokens.length, 'Token2022:', token2022.length);
    
    tokens.push(...splTokens, ...token2022);
    
    // Quick pass: apply cached/known metadata only (no network calls)
    for (const token of tokens) {
      const cacheKey = network ? `${network}:${token.mint}` : token.mint;
      
      if (metadataCache.has(cacheKey)) {
        Object.assign(token, metadataCache.get(cacheKey));
        continue;
      }
      
      const known = getKnownTokenMetadata(token.mint, network);
      if (known) {
        token.symbol = known.symbol;
        token.name = known.name;
        token.logoURI = known.logoURI;
        metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: token.logoURI });
        continue;
      }
      
      // Fallback
      if (!token.symbol) {
        token.symbol = token.mint ? token.mint.slice(0, 4).toUpperCase() : 'UNK';
      }
      if (!token.name) {
        token.name = token.isToken2022 ? 'Token-2022' : 'SPL Token';
      }
    }
    
    logger.log('[Tokens] Cache pass done in', Date.now() - startTime, 'ms');
    
    // Fetch missing metadata (blocking but parallelized)
    const tokensNeedingMetadata = tokens.filter(t => !metadataCache.has(network ? `${network}:${t.mint}` : t.mint));
    if (tokensNeedingMetadata.length > 0) {
      logger.log('[Tokens] Fetching metadata for', tokensNeedingMetadata.length, 'tokens');
      await Promise.allSettled(tokensNeedingMetadata.map(async (token) => {
        try {
          await enrichTokenMetadata(rpcUrl, token, network);
        } catch (e) {}
      }));
    }
    
    logger.log('[Tokens] Total time:', Date.now() - startTime, 'ms');
    return tokens;
  } catch (e) {
    logger.error('[Tokens] Error fetching token accounts:', e);
    return [];
  }
}

// Fetch token accounts by program
async function fetchTokenAccountsByProgram(rpcUrl, ownerAddress, programId) {
  if (!rpcUrl) {
    logger.error('[Tokens] No RPC URL provided');
    return [];
  }
  
  logger.log(`[Tokens] Fetching ${programId === TOKEN_2022_PROGRAM_ID ? 'Token-2022' : 'SPL Token'} accounts from:`, rpcUrl);
  
  const maxRetries = 2; // Reduced from 3
  let lastError = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000); // Reduced from 8s to 5s
      
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
      logger.log('[Tokens] RPC response:', JSON.stringify(data).slice(0, 500));
      
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
  
  let apiMetadata = null;
  
  // Try X1 Mobile API
  try {
    apiMetadata = await fetchTokenMetadataFromAPI(token.mint);
    if (apiMetadata && apiMetadata.name && apiMetadata.logoURI) {
      token.symbol = apiMetadata.symbol || token.mint.slice(0, 4);
      token.name = apiMetadata.name;
      token.logoURI = apiMetadata.logoURI;
      token.price = apiMetadata.price || null;
      metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: token.logoURI, price: token.price });
      return;
    }
  } catch (e) {
    logger.warn('Failed to fetch from X1 Mobile API:', e);
  }
  
  // Try Explorer API (with short timeout - often returns 404)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000); // 2 second timeout
    const explorerResponse = await fetch('https://explorer.mainnet.x1.xyz/api/v2/addresses/' + token.mint, {
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (explorerResponse.ok) {
      const explorerData = await explorerResponse.json();
      if (explorerData.token && explorerData.token.name) {
        token.symbol = explorerData.token.symbol || token.mint.slice(0, 4);
        token.name = explorerData.token.name;
        token.logoURI = explorerData.token.icon_url || explorerData.token.image || null;
        metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: token.logoURI });
        return;
      }
    }
  } catch (e) {
    // Silently ignore - Explorer API often fails
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
      token.logoURI = metaplexData.uri || null;
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
  
  // Try XDEX API
  try {
    logger.log('[Token API] Trying XDEX API for:', token.mint);
    const xdexResponse = await fetch('https://api.xdex.xyz/api/xendex/tokens/' + token.mint);
    if (xdexResponse.ok) {
      const xdexData = await xdexResponse.json();
      logger.log('[Token API] XDEX response:', xdexData);
      if (xdexData.name) {
        token.symbol = xdexData.symbol || token.mint.slice(0, 4);
        token.name = xdexData.name;
        token.logoURI = xdexData.image || xdexData.logo || xdexData.logoURI || xdexData.icon || null;
        metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: token.logoURI });
        return;
      }
    }
  } catch (e) {
    logger.warn('[Token API] XDEX API failed:', e.message);
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