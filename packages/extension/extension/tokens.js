import { l as logger } from "./popup.js";
const ICONS = {
  X1: "/icons/48-x1.png",
  PXNT: "/icons/48-pxnt.png",
  USDCX: "/icons/48-usdcx.png",
  XLP: "/icons/48-xlp.png",
  // External icons (third-party tokens)
  SOL: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
  USDC: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
  USDT: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png",
  MSOL: "https://raw.githubusercontent.com/marinade-finance/msol-logo/main/msol-logo.png",
  BONK: "https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I",
  JUP: "https://static.jup.ag/jup/icon.png",
  ETH: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs/logo.png",
  MIND: "https://xdex.s3.us-east-2.amazonaws.com/tokens/mind-48.png"
};
const XDEX_LP_MINT_AUTHORITY = "9Dpjw2pB5kXJr6ZTHiqzEMfJPic3om9jgNacnwpLCoaU";
const XLP_LOGO_URL = ICONS.XLP;
const KNOWN_TOKENS = {
  // === Native/Wrapped Tokens ===
  "So11111111111111111111111111111111111111112": {
    symbol: "SOL",
    name: "Wrapped SOL",
    decimals: 9,
    logoURI: ICONS.SOL
  },
  // === Stablecoins ===
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": {
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    logoURI: ICONS.USDC
  },
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": {
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    logoURI: ICONS.USDT
  },
  "B69chRzqzDCmdB5WYB8NRu5Yv5ZA95ABiZcdzCgGm9Tq": {
    symbol: "USDC.X",
    name: "USDC X1",
    decimals: 6,
    logoURI: ICONS.USDCX,
    isToken2022: true,
    price: 1
  },
  // === Liquid Staking Tokens ===
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So": {
    symbol: "mSOL",
    name: "Marinade staked SOL",
    decimals: 9,
    logoURI: ICONS.MSOL
  },
  "pXNTyoqQsskHdZ7Q1rnP25FEyHHjissbs7n6RRN2nP5": {
    symbol: "pXNT",
    name: "Staked XNT",
    decimals: 9,
    logoURI: ICONS.PXNT,
    isToken2022: false,
    isStakePoolToken: true,
    price: 1
  },
  // === Popular Tokens ===
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263": {
    symbol: "BONK",
    name: "Bonk",
    decimals: 5,
    logoURI: ICONS.BONK
  },
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN": {
    symbol: "JUP",
    name: "Jupiter",
    decimals: 6,
    logoURI: ICONS.JUP
  },
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs": {
    symbol: "ETH",
    name: "Ether (Wormhole)",
    decimals: 8,
    logoURI: ICONS.ETH
  },
  // === X1 Ecosystem Tokens ===
  "DohWBfvXER6qs8zFGtdZRDpgbHmm97ZZwgCUTCdtHQNT": {
    symbol: "MIND",
    name: "Mind",
    decimals: 9,
    logoURI: ICONS.MIND
  }
};
const NETWORK_TOKEN_OVERRIDES = {
  "X1 Mainnet": {
    "So11111111111111111111111111111111111111112": {
      symbol: "WXNT",
      name: "Wrapped XNT",
      decimals: 9,
      logoURI: ICONS.X1
    }
  },
  "X1 Testnet": {
    "So11111111111111111111111111111111111111112": {
      symbol: "WXNT",
      name: "Wrapped XNT",
      decimals: 9,
      logoURI: ICONS.X1
    }
  },
  "Solana Mainnet": {
    "So11111111111111111111111111111111111111112": {
      symbol: "SOL",
      name: "Solana",
      decimals: 9,
      logoURI: ICONS.SOL
    },
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": {
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
      logoURI: ICONS.USDC
    },
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": {
      symbol: "USDT",
      name: "Tether USD",
      decimals: 6,
      logoURI: ICONS.USDT
    }
  },
  "Solana Devnet": {
    "So11111111111111111111111111111111111111112": {
      symbol: "SOL",
      name: "Solana",
      decimals: 9,
      logoURI: ICONS.SOL
    }
  }
};
const X1_TOKEN_OVERRIDES = {
  "So11111111111111111111111111111111111111112": {
    symbol: "WXNT",
    name: "Wrapped XNT",
    decimals: 9,
    logoURI: ICONS.X1
  }
};
function isX1Network(network) {
  var _a, _b;
  if (!network) return false;
  if (network === "X1 Mainnet" || network === "X1 Testnet") return true;
  const lowerName = network.toLowerCase();
  if (lowerName.includes("x1") || lowerName.includes("xnt")) return true;
  try {
    const customNetworks = JSON.parse(localStorage.getItem("x1wallet_customRpcs") || "[]");
    const customNet = customNetworks.find((n) => n.name === network);
    if (customNet) {
      const url = ((_a = customNet.url) == null ? void 0 : _a.toLowerCase()) || "";
      if (url.includes("x1.xyz") || url.includes("x1.") || url.includes("/x1") || ((_b = customNet.symbol) == null ? void 0 : _b.toUpperCase()) === "XNT") {
        return true;
      }
    }
  } catch {
  }
  return false;
}
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
const API_SERVER = "https://mobile-api.x1.xyz";
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const METADATA_PROGRAM_ID = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
class RateLimiter {
  constructor(maxRequests = 5, windowMs = 1e3) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = [];
  }
  async acquire() {
    const now = Date.now();
    this.requests = this.requests.filter((time) => now - time < this.windowMs);
    if (this.requests.length >= this.maxRequests) {
      const waitTime = this.windowMs - (now - this.requests[0]) + 10;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      return this.acquire();
    }
    this.requests.push(now);
    return true;
  }
}
const xdexRateLimiter = new RateLimiter(5, 1e3);
const failedRequestsCache = /* @__PURE__ */ new Map();
const FAILED_CACHE_TTL = 5 * 60 * 1e3;
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
async function fetchWithRateLimit(url, options = {}) {
  await xdexRateLimiter.acquire();
  return fetch(url, options);
}
const mintAuthorityCache = /* @__PURE__ */ new Map();
const MINT_AUTHORITY_CACHE_TTL = 30 * 60 * 1e3;
async function fetchMintAuthority(rpcUrl, mintAddress) {
  var _a, _b, _c, _d, _e;
  const cacheKey = `${rpcUrl}:${mintAddress}`;
  const cached = mintAuthorityCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < MINT_AUTHORITY_CACHE_TTL) {
    return cached.authority;
  }
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [
          mintAddress,
          { encoding: "jsonParsed" }
        ]
      })
    });
    const data = await response.json();
    const mintAuthority = ((_e = (_d = (_c = (_b = (_a = data == null ? void 0 : data.result) == null ? void 0 : _a.value) == null ? void 0 : _b.data) == null ? void 0 : _c.parsed) == null ? void 0 : _d.info) == null ? void 0 : _e.mintAuthority) || null;
    mintAuthorityCache.set(cacheKey, { authority: mintAuthority, timestamp: Date.now() });
    return mintAuthority;
  } catch (e) {
    logger.warn("[Tokens] Failed to fetch mint authority:", e.message);
    return null;
  }
}
async function checkAndApplyLPBranding(rpcUrl, token, network) {
  if (!(network == null ? void 0 : network.includes("X1"))) return false;
  try {
    const mintAuthority = await fetchMintAuthority(rpcUrl, token.mint);
    if (mintAuthority === XDEX_LP_MINT_AUTHORITY) {
      token.symbol = "XLP";
      token.name = "XDEX LP Token";
      token.logoURI = XLP_LOGO_URL;
      token.isLPToken = true;
      logger.log(`[Tokens] Detected XDEX LP token: ${token.mint}`);
      return true;
    }
  } catch (e) {
    logger.warn("[Tokens] LP token check failed:", e.message);
  }
  return false;
}
const metadataCache = /* @__PURE__ */ new Map();
const PRICE_CACHE_KEY = "x1wallet_price_cache";
const PRICE_CACHE_TTL = 5 * 60 * 1e3;
function getPriceCache() {
  try {
    const cached = localStorage.getItem(PRICE_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (e) {
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
  }
}
function getCachedPrice(mint) {
  const cache = getPriceCache();
  if (cache[mint] !== void 0 && cache._timestamp && Date.now() - cache._timestamp < PRICE_CACHE_TTL) {
    return cache[mint];
  }
  return void 0;
}
function updatePriceCache(mint, price) {
  const cache = getPriceCache();
  cache[mint] = price;
  cache._timestamp = Date.now();
  setPriceCache(cache);
}
async function fetchTokenMetadataFromAPI(mint) {
  try {
    const url = `${API_SERVER}/tokens?mint=${encodeURIComponent(mint)}&verified=true`;
    logger.log("[Token API] Fetching metadata for:", mint);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3e3);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) {
      logger.log("[Token API] HTTP", response.status, "- Failed to fetch");
      return null;
    }
    const data = await response.json();
    if (data && data.tokens && data.tokens.length > 0) {
      const token = data.tokens[0];
      logger.log("[Token API] Found:", token.name, "(" + token.symbol + ")");
      return {
        name: token.name,
        symbol: token.symbol,
        logoURI: token.icon,
        price: token.price,
        mint: token.mint
      };
    }
    logger.log("[Token API] No token found for mint:", mint);
    return null;
  } catch (e) {
    if (e.name === "AbortError") {
      logger.warn("[Token API] Request timeout for:", mint);
    } else {
      logger.warn("[Token API] Error fetching metadata:", e);
    }
    return null;
  }
}
async function fetchFromDAS(rpcUrl, mint) {
  try {
    if (!rpcUrl.includes("helius")) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3e3);
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAsset",
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
        const imageFile = files.find((f) => {
          var _a;
          return (_a = f.mime) == null ? void 0 : _a.startsWith("image/");
        });
        if (imageFile) logoURI = imageFile.uri;
      }
      logger.log("[DAS API] Found metadata:", metadata.name);
      return {
        name: metadata.name,
        symbol: metadata.symbol,
        logoURI,
        uri: content.json_uri
      };
    }
    return null;
  } catch (e) {
    logger.warn("[DAS API] Error:", e.message);
    return null;
  }
}
async function fetchTokenAccounts(rpcUrl, ownerAddress, network = null, onUpdate = null) {
  var _a, _b;
  const tokens = [];
  const startTime = Date.now();
  try {
    logger.log("[Tokens] Starting token fetch for:", ownerAddress, "on network:", network);
    const [splTokens, token2022, xdexPrices] = await Promise.all([
      fetchTokenAccountsByProgram(rpcUrl, ownerAddress, TOKEN_PROGRAM_ID),
      fetchTokenAccountsByProgram(rpcUrl, ownerAddress, TOKEN_2022_PROGRAM_ID),
      fetchXDEXWalletTokens(ownerAddress, network)
    ]);
    logger.log("[Tokens] RPC done in", Date.now() - startTime, "ms - SPL:", splTokens.length, "Token2022:", token2022.length);
    logger.log("[Tokens] XDEX prices received for", Object.keys(xdexPrices).length, "tokens");
    tokens.push(...splTokens, ...token2022);
    for (const token of tokens) {
      const cacheKey = network ? `${network}:${token.mint}` : token.mint;
      if (metadataCache.has(cacheKey)) {
        const cached = metadataCache.get(cacheKey);
        Object.assign(token, cached);
        if (((_a = xdexPrices[token.mint]) == null ? void 0 : _a.price) !== void 0) {
          token.price = parseFloat(xdexPrices[token.mint].price);
          updatePriceCache(token.mint, token.price);
        }
        continue;
      }
      const known = getKnownTokenMetadata(token.mint, network);
      if (known) {
        token.symbol = known.symbol;
        token.name = known.name;
        token.logoURI = known.logoURI;
        token.price = known.price;
        if (((_b = xdexPrices[token.mint]) == null ? void 0 : _b.price) !== void 0) {
          token.price = parseFloat(xdexPrices[token.mint].price);
          updatePriceCache(token.mint, token.price);
        }
        metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: token.logoURI, price: token.price });
        continue;
      }
      if (xdexPrices[token.mint]) {
        const xdexData = xdexPrices[token.mint];
        if (xdexData.price !== void 0 && xdexData.price !== null) {
          token.price = parseFloat(xdexData.price);
          updatePriceCache(token.mint, token.price);
        }
        if (xdexData.symbol) token.symbol = xdexData.symbol;
        if (xdexData.name) token.name = xdexData.name;
        if (xdexData.image) token.logoURI = xdexData.image;
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
      if (token.price === void 0 || token.price === null) {
        const cachedPrice = getCachedPrice(token.mint);
        if (cachedPrice !== void 0) {
          token.price = cachedPrice;
        }
      }
      if (!token.symbol) {
        token.symbol = token.mint ? token.mint.slice(0, 4).toUpperCase() : "UNK";
      }
      if (!token.name) {
        token.name = token.isToken2022 ? "Token-2022" : "SPL Token";
      }
    }
    logger.log("[Tokens] Quick pass done in", Date.now() - startTime, "ms - RETURNING IMMEDIATELY");
    const tokensNeedingMetadata = tokens.filter((t) => {
      const cacheKey = network ? `${network}:${t.mint}` : t.mint;
      if (!metadataCache.has(cacheKey)) return true;
      const cached = metadataCache.get(cacheKey);
      return !cached.logoURI;
    });
    if (tokensNeedingMetadata.length > 0) {
      logger.log("[Tokens] Will enrich", tokensNeedingMetadata.length, "tokens in background");
      (async () => {
        try {
          const batchSize = 5;
          let updated = false;
          for (let i = 0; i < tokensNeedingMetadata.length; i += batchSize) {
            const batch = tokensNeedingMetadata.slice(i, i + batchSize);
            await Promise.allSettled(batch.map(async (token) => {
              try {
                await enrichTokenMetadata(rpcUrl, token, network);
                updated = true;
              } catch (e) {
                logger.warn("[Tokens] Failed to enrich metadata for", token.mint, e.message);
              }
            }));
            if (updated && onUpdate) {
              onUpdate([...tokens]);
              updated = false;
            }
            if (i + batchSize < tokensNeedingMetadata.length) {
              await new Promise((r) => setTimeout(r, 100));
            }
          }
          if (onUpdate) {
            onUpdate([...tokens]);
          }
          logger.log("[Tokens] Background enrichment complete in", Date.now() - startTime, "ms");
        } catch (e) {
          logger.warn("[Tokens] Background enrichment error:", e);
        }
      })();
    }
    logger.log("[Tokens] Returning", tokens.length, "tokens");
    return tokens;
  } catch (e) {
    logger.error("[Tokens] Error fetching token accounts:", e);
    return [];
  }
}
async function fetchXDEXWalletTokens(walletAddress, network) {
  var _a;
  try {
    const networkName = network || "X1 Mainnet";
    const url = `https://devapi.xdex.xyz/api/xendex/wallet/tokens?wallet_address=${walletAddress}&network=${encodeURIComponent(networkName)}&price=true`;
    logger.log("[XDEX] Fetching wallet tokens with prices:", url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5e3);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "Accept": "application/json" }
    });
    clearTimeout(timeout);
    if (!response.ok) {
      logger.warn("[XDEX] Wallet tokens API returned:", response.status);
      return {};
    }
    const data = await response.json();
    const tokenList = ((_a = data == null ? void 0 : data.data) == null ? void 0 : _a.tokens) || (data == null ? void 0 : data.tokens) || (Array.isArray(data) ? data : []);
    logger.log("[XDEX] Wallet tokens response - count:", tokenList.length);
    if (tokenList[0]) {
      logger.log("[XDEX] Sample token fields:", Object.keys(tokenList[0]).join(", "));
    }
    const priceMap = {};
    const extractPrice = (token) => {
      const priceValue = token.price ?? token.priceUsd ?? token.price_usd ?? token.priceUSD ?? token.usdPrice ?? token.usd_price ?? token.tokenPrice ?? token.token_price ?? null;
      if (priceValue !== null && priceValue !== void 0) {
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
        let imageUrl = token.imageUrl || token.image || token.logo || token.logoURI || token.icon;
        if (imageUrl && !imageUrl.startsWith("http")) {
          imageUrl = null;
        }
        priceMap[mint] = {
          price,
          symbol: token.symbol,
          name: token.name,
          image: imageUrl
        };
        if (price !== null) {
          logger.log("[XDEX] Price found for", token.symbol || mint.slice(0, 8), ":", price);
        }
      }
    }
    logger.log("[XDEX] Total prices extracted:", Object.values(priceMap).filter((p) => p.price !== null).length);
    return priceMap;
  } catch (e) {
    if (e.name === "AbortError") {
      logger.warn("[XDEX] Wallet tokens request timeout");
    } else {
      logger.warn("[XDEX] Failed to fetch wallet tokens:", e.message);
    }
    return {};
  }
}
async function fetchTokenAccountsByProgram(rpcUrl, ownerAddress, programId) {
  var _a;
  if (!rpcUrl) {
    logger.error("[Tokens] No RPC URL provided");
    return [];
  }
  logger.log(`[Tokens] Fetching ${programId === TOKEN_2022_PROGRAM_ID ? "Token-2022" : "SPL Token"} accounts from:`, rpcUrl);
  const maxRetries = 2;
  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5e3);
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTokenAccountsByOwner",
          params: [
            ownerAddress,
            { programId },
            { encoding: "jsonParsed", commitment: "confirmed" }
          ]
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (!response.ok) {
        logger.error(`[Tokens] HTTP error: ${response.status} ${response.statusText} (attempt ${attempt}/${maxRetries})`);
        lastError = new Error(`HTTP ${response.status}`);
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1e3 * attempt));
          continue;
        }
        return [];
      }
      const data = await response.json();
      if (data.error) {
        logger.warn("[Tokens] RPC error fetching tokens:", data.error, `(attempt ${attempt}/${maxRetries})`);
        lastError = data.error;
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1e3 * attempt));
          continue;
        }
        return [];
      }
      if (!((_a = data.result) == null ? void 0 : _a.value)) {
        logger.log("[Tokens] No token accounts found");
        return [];
      }
      const tokens = data.result.value.map((item) => {
        var _a2;
        const info = item.account.data.parsed.info;
        const uiAmount = info.tokenAmount.uiAmount || 0;
        logger.log(`[Tokens] Found token: mint=${(_a2 = info.mint) == null ? void 0 : _a2.slice(0, 8)}... amount=${info.tokenAmount.amount} uiAmount=${uiAmount} program=${programId === TOKEN_2022_PROGRAM_ID ? "Token-2022" : "SPL"}`);
        return {
          address: item.pubkey,
          mint: info.mint,
          owner: info.owner,
          amount: info.tokenAmount.amount,
          decimals: info.tokenAmount.decimals,
          uiAmount,
          balance: uiAmount,
          programId,
          isToken2022: programId === TOKEN_2022_PROGRAM_ID
        };
      }).filter((t) => parseFloat(t.amount) > 0);
      logger.log(`[Tokens] Found ${tokens.length} ${programId === TOKEN_2022_PROGRAM_ID ? "Token-2022" : "SPL"} tokens`);
      return tokens;
    } catch (e) {
      if (e.name === "AbortError") {
        logger.error(`[Tokens] Request timeout (attempt ${attempt}/${maxRetries})`);
      } else {
        logger.error(`[Tokens] Error fetching ${programId} accounts:`, e.message || e, `(attempt ${attempt}/${maxRetries})`);
      }
      lastError = e;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1e3 * attempt));
        continue;
      }
    }
  }
  logger.error("[Tokens] All retry attempts failed:", lastError);
  return [];
}
async function enrichTokenMetadata(rpcUrl, token, network = null) {
  const cacheKey = network ? `${network}:${token.mint}` : token.mint;
  if (metadataCache.has(cacheKey)) {
    const cached = metadataCache.get(cacheKey);
    Object.assign(token, cached);
    return;
  }
  const known = getKnownTokenMetadata(token.mint, network);
  if (known) {
    token.symbol = known.symbol;
    token.name = known.name;
    token.logoURI = known.logoURI;
    if (known.isToken2022 !== void 0) token.isToken2022 = known.isToken2022;
    if (known.price !== void 0) token.price = known.price;
    metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: token.logoURI, price: token.price });
    return;
  }
  const isLP = await checkAndApplyLPBranding(rpcUrl, token, network);
  if (isLP) {
    metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: token.logoURI, isLPToken: true });
    return;
  }
  let apiMetadata = null;
  try {
    apiMetadata = await fetchTokenMetadataFromAPI(token.mint);
    if (apiMetadata && apiMetadata.name && apiMetadata.logoURI) {
      token.symbol = apiMetadata.symbol || token.mint.slice(0, 4);
      token.name = apiMetadata.name;
      token.logoURI = apiMetadata.logoURI;
      token.price = apiMetadata.price || null;
      if (token.price !== null && token.price !== void 0) {
        metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: token.logoURI, price: token.price });
        return;
      }
    }
  } catch (e) {
    logger.warn("Failed to fetch from X1 Mobile API:", e);
  }
  if (token.isToken2022) {
    try {
      const extMetadata = await fetchToken2022Metadata(rpcUrl, token.mint);
      if (extMetadata && extMetadata.name) {
        token.symbol = extMetadata.symbol || token.mint.slice(0, 4);
        token.name = extMetadata.name || "Unknown Token";
        token.logoURI = extMetadata.uri || null;
        if (extMetadata.uri) {
          try {
            const uriMetadata = await fetchTokenMetadataFromURI(extMetadata.uri);
            if (uriMetadata == null ? void 0 : uriMetadata.image) token.logoURI = uriMetadata.image;
          } catch (e) {
            logger.warn("Failed to fetch metadata from URI:", e);
          }
        }
        metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: token.logoURI });
        return;
      }
    } catch (e) {
      logger.warn("Failed to fetch Token-2022 extension metadata:", e);
    }
  }
  try {
    const metaplexData = await fetchMetaplexMetadata(rpcUrl, token.mint);
    if (metaplexData) {
      token.symbol = (apiMetadata == null ? void 0 : apiMetadata.symbol) || metaplexData.symbol || token.mint.slice(0, 4);
      token.name = (apiMetadata == null ? void 0 : apiMetadata.name) || metaplexData.name || "Unknown Token";
      token.logoURI = null;
      token.price = (apiMetadata == null ? void 0 : apiMetadata.price) || null;
      if (metaplexData.uri && metaplexData.uri.startsWith("http")) {
        try {
          const uriMetadata = await fetchTokenMetadataFromURI(metaplexData.uri);
          if (uriMetadata == null ? void 0 : uriMetadata.image) token.logoURI = uriMetadata.image;
          if ((uriMetadata == null ? void 0 : uriMetadata.name) && !(apiMetadata == null ? void 0 : apiMetadata.name)) token.name = uriMetadata.name;
          if ((uriMetadata == null ? void 0 : uriMetadata.symbol) && !(apiMetadata == null ? void 0 : apiMetadata.symbol)) token.symbol = uriMetadata.symbol;
        } catch (e) {
          logger.warn("Failed to fetch metadata from URI:", e);
        }
      }
      metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: token.logoURI, price: token.price });
      return;
    }
  } catch (e) {
    logger.warn("Failed to fetch on-chain metadata:", e);
  }
  try {
    const dasData = await fetchFromDAS(rpcUrl, token.mint);
    if (dasData && dasData.name) {
      token.symbol = dasData.symbol || token.mint.slice(0, 4);
      token.name = dasData.name;
      token.logoURI = dasData.logoURI || null;
      token.price = (apiMetadata == null ? void 0 : apiMetadata.price) || null;
      if (!token.logoURI && dasData.uri) {
        try {
          const uriMetadata = await fetchTokenMetadataFromURI(dasData.uri);
          if (uriMetadata == null ? void 0 : uriMetadata.image) token.logoURI = uriMetadata.image;
        } catch (e) {
          logger.warn("Failed to fetch metadata from DAS URI:", e);
        }
      }
      metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: token.logoURI, price: token.price });
      return;
    }
  } catch (e) {
    logger.warn("Failed to fetch from DAS API:", e);
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3e3);
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
  }
  const xdexCacheKey = `xdex:${token.mint}`;
  if (!hasRecentlyFailed(xdexCacheKey)) {
    try {
      logger.log("[Token API] Trying XDEX API for:", token.mint);
      const xdexResponse = await fetchWithRateLimit(
        "https://api.xdex.xyz/api/xendex/tokens/" + token.mint,
        { signal: AbortSignal.timeout(5e3) }
      );
      if (xdexResponse.status === 429) {
        logger.warn("[Token API] XDEX rate limited for:", token.mint);
        markFailed(xdexCacheKey);
      } else if (xdexResponse.status === 404) {
        markFailed(xdexCacheKey);
      } else if (xdexResponse.ok) {
        clearFailed(xdexCacheKey);
        const xdexData = await xdexResponse.json();
        logger.log("[Token API] XDEX response:", xdexData);
        let xdexPrice = null;
        if (xdexData.price !== void 0 && xdexData.price !== null) {
          xdexPrice = parseFloat(xdexData.price);
        } else if (xdexData.priceUsd !== void 0 && xdexData.priceUsd !== null) {
          xdexPrice = parseFloat(xdexData.priceUsd);
        }
        if (token.name && token.name !== "Unknown Token" && token.logoURI) {
          if (xdexPrice !== null && (token.price === null || token.price === void 0)) {
            token.price = xdexPrice;
            logger.log("[Token API] Got price from XDEX:", xdexPrice, "for", token.symbol);
          }
          metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: token.logoURI, price: token.price });
          return;
        }
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
      logger.warn("[Token API] XDEX API failed:", e.message);
      markFailed(xdexCacheKey);
    }
  }
  if (apiMetadata && apiMetadata.name) {
    token.symbol = apiMetadata.symbol || token.mint.slice(0, 4);
    token.name = apiMetadata.name;
    token.logoURI = null;
    token.price = apiMetadata.price || null;
    metadataCache.set(cacheKey, { symbol: token.symbol, name: token.name, logoURI: null, price: token.price });
    return;
  }
  token.symbol = token.mint.slice(0, 4) + "..";
  token.name = "Unknown Token";
  token.logoURI = null;
  metadataCache.set(token.mint, { symbol: token.symbol, name: token.name, logoURI: null });
}
async function fetchMetaplexMetadata(rpcUrl, mint) {
  var _a;
  try {
    logger.log("[Metaplex] Fetching metadata for mint:", mint);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8e3);
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getProgramAccounts",
        params: [
          METADATA_PROGRAM_ID,
          {
            encoding: "base64",
            filters: [{ memcmp: { offset: 33, bytes: mint } }]
          }
        ]
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    const data = await response.json();
    if (!((_a = data.result) == null ? void 0 : _a.length) > 0) {
      logger.log("[Metaplex] No metadata account found");
      return null;
    }
    const accountData = data.result[0].account.data[0];
    const bytes = Uint8Array.from(atob(accountData), (c) => c.charCodeAt(0));
    const parsed = parseMetaplexMetadata(bytes);
    logger.log("[Metaplex] Parsed metadata:", parsed == null ? void 0 : parsed.name, parsed == null ? void 0 : parsed.symbol);
    return parsed;
  } catch (e) {
    logger.warn("Error fetching Metaplex metadata:", e);
    return null;
  }
}
function parseMetaplexMetadata(data) {
  try {
    let offset = 65;
    const nameLen = data[offset] | data[offset + 1] << 8 | data[offset + 2] << 16 | data[offset + 3] << 24;
    offset += 4;
    const name = new TextDecoder().decode(data.slice(offset, offset + nameLen)).replace(/\0/g, "").trim();
    offset += nameLen;
    const symbolLen = data[offset] | data[offset + 1] << 8 | data[offset + 2] << 16 | data[offset + 3] << 24;
    offset += 4;
    const symbol = new TextDecoder().decode(data.slice(offset, offset + symbolLen)).replace(/\0/g, "").trim();
    offset += symbolLen;
    const uriLen = data[offset] | data[offset + 1] << 8 | data[offset + 2] << 16 | data[offset + 3] << 24;
    offset += 4;
    const uri = new TextDecoder().decode(data.slice(offset, offset + uriLen)).replace(/\0/g, "").trim();
    return { name, symbol, uri };
  } catch (e) {
    logger.warn("Error parsing metadata:", e);
    return null;
  }
}
async function fetchToken2022Metadata(rpcUrl, mint) {
  var _a, _b, _c, _d;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3e3);
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [mint, { encoding: "jsonParsed" }]
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    const data = await response.json();
    if (!((_d = (_c = (_b = (_a = data.result) == null ? void 0 : _a.value) == null ? void 0 : _b.data) == null ? void 0 : _c.parsed) == null ? void 0 : _d.info)) return null;
    const info = data.result.value.data.parsed.info;
    if (info.extensions) {
      for (const ext of info.extensions) {
        if (ext.extension === "tokenMetadata") {
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
    logger.warn("Error fetching Token-2022 metadata:", e);
    return null;
  }
}
async function fetchTokenMetadataFromURI(uri) {
  if (!uri) return null;
  try {
    let fetchUrl = uri;
    if (uri.startsWith("ipfs://")) {
      fetchUrl = uri.replace("ipfs://", "https://ipfs.io/ipfs/");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8e3);
    const response = await fetch(fetchUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const data = await response.json();
    let image = data.image;
    if (image && image.startsWith("ipfs://")) {
      image = image.replace("ipfs://", "https://ipfs.io/ipfs/");
    }
    return {
      name: data.name,
      symbol: data.symbol,
      image,
      description: data.description
    };
  } catch (e) {
    logger.warn("Failed to fetch metadata from URI:", uri, e.message);
    return null;
  }
}
export {
  METADATA_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  fetchToken2022Metadata,
  fetchTokenAccounts,
  fetchTokenMetadataFromAPI,
  fetchTokenMetadataFromURI
};
