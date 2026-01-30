// Main Wallet Screen with Full Features
import { logger, getUserFriendlyError, ErrorMessages } from '@x1-wallet/core';
import React, { useState, useEffect, useRef } from 'react';
import X1Logo from './X1Logo';
import CoreDashboard from './CoreDashboard';
import { NETWORKS, getTxExplorerUrl } from '@x1-wallet/core/services/networks';
import { getNetworkConfig } from '@x1-wallet/core/hooks/useWallet';
import { getTransactionHistory, formatTransaction, fetchBlockchainTransactions } from '@x1-wallet/core/utils/transaction';
import { fetchTransactions as fetchAPITransactions, registerWallet } from '@x1-wallet/core/services/activity';
import { fetchTokenAccounts, invalidateRPCCache } from '@x1-wallet/core/services/tokens';

// Global image cache to prevent re-fetching across screens
const imageCache = new Map();

// ============================================
// REQUEST DEDUPLICATION - Prevents duplicate concurrent fetches
// ============================================
const pendingFetches = new Map();
const lastFetchTime = new Map();
const FETCH_DEBOUNCE_MS = 2000; // Don't re-fetch within 2 seconds

function getFetchCacheKey(walletAddress, network) {
  return `${walletAddress}:${network}`;
}

// ============================================
// TOKEN LIST CACHE - Persists across wallet switches
// ============================================
const TOKEN_CACHE_KEY = 'x1wallet_token_cache';
const TOKEN_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ============================================
// BALANCE CACHE - For instant display on load
// ============================================
const BALANCE_CACHE_KEY = 'x1wallet_balance_cache';

function getCachedBalance(walletAddress, network) {
  try {
    const cache = JSON.parse(localStorage.getItem(BALANCE_CACHE_KEY) || '{}');
    const key = `${walletAddress}:${network}`;
    const entry = cache[key];
    if (entry && entry.balance !== undefined) {
      return entry.balance;
    }
  } catch (e) {
    // Ignore
  }
  return null;
}

function setCachedBalance(walletAddress, network, balance) {
  try {
    const cache = JSON.parse(localStorage.getItem(BALANCE_CACHE_KEY) || '{}');
    const key = `${walletAddress}:${network}`;
    cache[key] = { balance, timestamp: Date.now() };
    // Keep only last 10 entries
    const keys = Object.keys(cache);
    if (keys.length > 10) {
      const oldest = keys.sort((a, b) => (cache[a]?.timestamp || 0) - (cache[b]?.timestamp || 0))[0];
      delete cache[oldest];
    }
    localStorage.setItem(BALANCE_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    // Ignore
  }
}

function getTokenCacheKey(walletAddress, network) {
  return `${walletAddress}:${network}`;
}

// In-memory session cache for instant access within same session
const sessionTokenCache = new Map();

function getCachedTokens(walletAddress, network) {
  try {
    const key = getTokenCacheKey(walletAddress, network);
    
    // 1. Check in-memory cache first (instant)
    if (sessionTokenCache.has(key)) {
      const entry = sessionTokenCache.get(key);
      logger.log('[TokenCache] Memory hit:', entry.tokens.length, 'tokens');
      return entry.tokens;
    }
    
    // 2. Check localStorage (persistent)
    const cache = JSON.parse(localStorage.getItem(TOKEN_CACHE_KEY) || '{}');
    const entry = cache[key];
    if (entry && entry.tokens && entry.timestamp) {
      // Populate memory cache
      sessionTokenCache.set(key, entry);
      logger.log('[TokenCache] LocalStorage hit:', entry.tokens.length, 'tokens');
      return entry.tokens;
    }
  } catch (e) {
    logger.warn('[TokenCache] Error reading cache:', e);
  }
  return null;
}

function setCachedTokens(walletAddress, network, tokens) {
  try {
    const key = getTokenCacheKey(walletAddress, network);
    const entry = { tokens, timestamp: Date.now() };
    
    // 1. Update memory cache (instant for next read)
    sessionTokenCache.set(key, entry);
    
    // 2. Update localStorage (persistent)
    const cache = JSON.parse(localStorage.getItem(TOKEN_CACHE_KEY) || '{}');
    cache[key] = entry;
    // Keep only last 10 wallet/network combos to prevent bloat
    const keys = Object.keys(cache);
    if (keys.length > 10) {
      const oldest = keys.sort((a, b) => (cache[a]?.timestamp || 0) - (cache[b]?.timestamp || 0))[0];
      delete cache[oldest];
    }
    localStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify(cache));
    logger.log('[TokenCache] Saved', tokens.length, 'tokens for', key);
  } catch (e) {
    logger.warn('[TokenCache] Error saving cache:', e);
  }
}

// Compare two token lists to see if they're meaningfully different
// Returns true if update is needed
function tokensNeedUpdate(oldTokens, newTokens) {
  if (!oldTokens || !newTokens) return true;
  if (oldTokens.length !== newTokens.length) return true;
  
  // Create a map of old tokens by mint for quick lookup
  const oldMap = new Map();
  oldTokens.forEach(t => {
    const key = t.mint || 'native';
    oldMap.set(key, t);
  });
  
  // Check if any token has changed significantly
  for (const newToken of newTokens) {
    const key = newToken.mint || 'native';
    const oldToken = oldMap.get(key);
    
    if (!oldToken) return true; // New token appeared
    
    // Check for meaningful balance change (more than 0.01% difference to avoid float issues)
    const oldBal = parseFloat(oldToken.uiAmount || oldToken.balance || 0);
    const newBal = parseFloat(newToken.uiAmount || newToken.balance || 0);
    if (oldBal === 0 && newBal === 0) {
      // Even with zero balance, check if price became available
      const oldPrice = oldToken.price;
      const newPrice = newToken.price;
      if ((oldPrice === null || oldPrice === undefined) && newPrice !== null && newPrice !== undefined) {
        return true; // Price became available
      }
      continue;
    }
    if (oldBal === 0 || newBal === 0) return true;
    
    const diff = Math.abs(newBal - oldBal) / Math.max(oldBal, newBal);
    if (diff > 0.0001) return true; // 0.01% threshold
    
    // Also check if price became available
    const oldPrice = oldToken.price;
    const newPrice = newToken.price;
    if ((oldPrice === null || oldPrice === undefined) && newPrice !== null && newPrice !== undefined) {
      return true; // Price became available
    }
  }
  
  return false;
}

// Merge new token data into existing tokens (diff/patch instead of replace)
// This prevents UI flicker and maintains token order
function mergeTokenUpdates(existingTokens, newTokens) {
  if (!existingTokens || existingTokens.length === 0) return newTokens;
  if (!newTokens || newTokens.length === 0) return existingTokens;
  
  // Build map of new tokens by mint
  const newMap = new Map();
  newTokens.forEach(t => {
    const key = t.mint || 'native';
    newMap.set(key, t);
  });
  
  // Build map of existing tokens by mint
  const existingMap = new Map();
  existingTokens.forEach(t => {
    const key = t.mint || 'native';
    existingMap.set(key, t);
  });
  
  // Start with existing tokens, update in place
  const merged = existingTokens.map(existing => {
    const key = existing.mint || 'native';
    const updated = newMap.get(key);
    
    if (!updated) {
      // Token no longer exists - keep it but mark as stale (will be filtered later if needed)
      return existing;
    }
    
    // Merge: keep existing metadata if new is missing, update balance/price
    return {
      ...existing,
      // Always update balance
      amount: updated.amount,
      uiAmount: updated.uiAmount,
      balance: updated.balance || updated.uiAmount,
      // Update price if available
      price: updated.price !== undefined ? updated.price : existing.price,
      // Update metadata only if we got better data
      symbol: updated.symbol || existing.symbol,
      name: (updated.name && updated.name !== 'Unknown Token') ? updated.name : existing.name,
      logoURI: updated.logoURI || existing.logoURI,
      // Preserve LP token flag
      isLPToken: updated.isLPToken || existing.isLPToken,
    };
  });
  
  // Add any new tokens that didn't exist before
  for (const [key, newToken] of newMap) {
    if (!existingMap.has(key)) {
      merged.push(newToken);
    }
  }
  
  // Filter out tokens with zero balance that weren't in the new list
  // (they may have been transferred out)
  return merged.filter(t => {
    const key = t.mint || 'native';
    const inNewList = newMap.has(key);
    const hasBalance = parseFloat(t.uiAmount || t.balance || 0) > 0;
    return inNewList || hasBalance;
  });
}

// XLP Icon path - same format as other working icons like SOLANA_LOGO_URL
const XLP_ICON_PATH = '/icons/48-xlp.png';

// Preload and cache an image
function preloadImage(url) {
  if (!url || imageCache.has(url)) return;
  const img = new Image();
  img.src = url;
  imageCache.set(url, img);
}

// Preload XLP icon on module load
preloadImage(XLP_ICON_PATH);

// Preload multiple token images
function preloadTokenImages(tokens) {
  if (!tokens) return;
  tokens.forEach(token => {
    // AGGRESSIVE LP DETECTION - same logic as render
    const tokenName = (token.name || '').toLowerCase();
    const tokenSymbol = (token.symbol || '').toUpperCase();
    
    const isLP = token.isLPToken || 
                 tokenSymbol === 'XLP' || 
                 tokenSymbol === 'SLP' ||
                 tokenSymbol.includes('XLP') ||
                 tokenSymbol.includes('SLP') ||
                 tokenName.includes('xlp') ||
                 tokenName.includes(' lp') ||
                 tokenName.includes('lp token') ||
                 tokenName.includes('/') ||
                 (tokenName.includes('xdex') && tokenName.includes('lp'));
    
    if (isLP) {
      preloadImage(XLP_ICON_PATH);
    } else if (token.logoURI) {
      preloadImage(token.logoURI);
    }
  });
}

// ============================================
// RPC FETCH WITH RETRY - Handles 429 rate limits
// ============================================
async function fetchRpcWithRetry(rpcUrl, body, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body)
      });
      
      if (response.status === 429) {
        // Rate limited - exponential backoff with jitter
        const baseDelay = 1000 * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 500;
        const delay = Math.min(baseDelay + jitter, 8000);
        logger.warn(`[RPC] Rate limited (429), waiting ${Math.round(delay)}ms (attempt ${attempt}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      
      return response;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      // Network error - delay before retry
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  
  throw new Error('RPC request failed after max retries');
}

// Activity List Component
// Activity cache for instant loading
const ACTIVITY_CACHE_KEY = 'x1wallet_activity_cache';

function getCachedActivity(walletAddress, network) {
  try {
    const cache = JSON.parse(localStorage.getItem(ACTIVITY_CACHE_KEY) || '{}');
    const key = `${walletAddress}:${network}`;
    const entry = cache[key];
    if (entry && entry.transactions) {
      logger.log('[ActivityCache] Found cached activity for', key, '- count:', entry.transactions.length);
      return entry.transactions;
    }
  } catch (e) {
    logger.warn('[ActivityCache] Error reading cache:', e);
  }
  return null;
}

function setCachedActivity(walletAddress, network, transactions) {
  try {
    const cache = JSON.parse(localStorage.getItem(ACTIVITY_CACHE_KEY) || '{}');
    const key = `${walletAddress}:${network}`;
    cache[key] = {
      transactions: transactions.slice(0, 50), // Keep only last 50 to prevent bloat
      timestamp: Date.now()
    };
    // Keep only last 10 wallet/network combos
    const keys = Object.keys(cache);
    if (keys.length > 10) {
      const oldest = keys.sort((a, b) => (cache[a]?.timestamp || 0) - (cache[b]?.timestamp || 0))[0];
      delete cache[oldest];
    }
    localStorage.setItem(ACTIVITY_CACHE_KEY, JSON.stringify(cache));
    logger.log('[ActivityCache] Saved', transactions.length, 'transactions for', key);
  } catch (e) {
    logger.warn('[ActivityCache] Error saving cache:', e);
  }
}

function ActivityList({ walletAddress, network, networkConfig, refreshKey }) {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sortOrder, setSortOrder] = useState('desc'); // 'desc' = newest first, 'asc' = oldest first

  // Load cached activity on mount
  useEffect(() => {
    if (walletAddress && network) {
      const cached = getCachedActivity(walletAddress, network);
      if (cached && cached.length > 0) {
        logger.log('[ActivityList] Loading cached activity:', cached.length);
        setTransactions(cached);
        setLoading(false);
      }
    }
  }, [walletAddress, network]);

  // Normalize timestamp to milliseconds for consistent sorting
  const normalizeTimestamp = (tx) => {
    let ts = tx.rawTimestamp || tx.timestamp || 0;
    // If timestamp is in seconds (less than year 2100 in seconds), convert to ms
    if (ts > 0 && ts < 4102444800) {
      ts = ts * 1000;
    }
    return ts;
  };

  const fetchTransactions = async (showLoading = true) => {
    if (!walletAddress) return;
    // Only show loading if we have no cached data
    if (showLoading && transactions.length === 0) setLoading(true);
    setIsRefreshing(true);
    
    try {
      // Register wallet with indexer and trigger indexing
      registerWallet(walletAddress, network).catch(() => {});
      
      // Get local transaction history immediately (sync)
      const localHistory = getTransactionHistory(walletAddress, network, 'desc');
      
      // Fetch API and blockchain in parallel
      const [apiTxs, blockchainTxs] = await Promise.all([
        fetchAPITransactions(walletAddress, network).catch(e => {
          return [];
        }),
        networkConfig?.rpcUrl 
          ? fetchBlockchainTransactions(networkConfig.rpcUrl, walletAddress, 20, network).catch(e => {
              return [];
            })
          : Promise.resolve([])
      ]);
      
      // Merge all transactions with normalized timestamps
      // Priority: blockchain > API > local (to ensure correct data overwrites stale local data)
      // BUT: preserve transaction type from local history for stake/unstake/wrap/unwrap
      const allTxs = [];
      const seen = new Set();
      
      // Build a map of local transaction types by signature for preservation
      const localTypeMap = new Map();
      const preserveTypes = ['stake', 'unstake', 'wrap', 'unwrap', 'swap'];
      for (const tx of localHistory) {
        if (tx.signature && (preserveTypes.includes(tx.type) || tx.isSwap)) {
          localTypeMap.set(tx.signature, {
            type: tx.type,
            description: tx.description,
            amount: tx.amount,
            symbol: tx.symbol,
            toAmount: tx.toAmount,
            toSymbol: tx.toSymbol
          });
        }
      }
      
      // Add blockchain transactions FIRST - they have the most accurate data
      for (const tx of blockchainTxs) {
        if (tx.signature && !seen.has(tx.signature)) {
          seen.add(tx.signature);
          // Use network-appropriate native symbol - replace SOL with XNT on X1 networks
          const isX1Network = network?.startsWith('X1');
          let txSymbol = tx.symbol || tx.token;
          // Replace SOL with XNT on X1 networks for native transfers
          if (isX1Network && txSymbol === 'SOL') {
            txSymbol = 'XNT';
          }
          
          // Check if we have a preserved type from local history
          const localData = localTypeMap.get(tx.signature);
          
          const formatted = formatTransaction({
            ...tx,
            // Preserve local type if it's a stake/unstake/wrap/unwrap
            ...(localData ? localData : {}),
            symbol: localData?.symbol || txSymbol || networkConfig?.symbol || (isX1Network ? 'XNT' : 'SOL'),
            network
          });
          allTxs.push({
            ...formatted,
            _sortTs: normalizeTimestamp(formatted)
          });
        }
      }
      
      // Add API transactions (if not already from blockchain)
      for (const tx of apiTxs) {
        if (tx.signature && !seen.has(tx.signature)) {
          seen.add(tx.signature);
          const formatted = formatTransaction(tx);
          allTxs.push({
            ...formatted,
            _sortTs: normalizeTimestamp(formatted)
          });
        }
      }
      
      // Add local transactions LAST - only if not already included from blockchain/API
      for (const tx of localHistory) {
        if (tx.signature && !seen.has(tx.signature)) {
          seen.add(tx.signature);
          const formatted = formatTransaction(tx);
          allTxs.push({
            ...formatted,
            _sortTs: normalizeTimestamp(formatted)
          });
        } else if (!tx.signature) {
          const formatted = formatTransaction(tx);
          allTxs.push({
            ...formatted,
            _sortTs: normalizeTimestamp(formatted)
          });
        }
      }
      
      // Sort by _sortTs - purely chronological, no grouping by type
      allTxs.sort((a, b) => {
        return sortOrder === 'asc' ? a._sortTs - b._sortTs : b._sortTs - a._sortTs;
      });
      
      setTransactions(allTxs);
      // Save to cache for instant loading
      setCachedActivity(walletAddress, network, allTxs);
    } catch (e) {
      logger.error('Failed to fetch transactions:', e);
      // Don't clear transactions on error - keep cached data
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
  }, [walletAddress, network, networkConfig?.rpcUrl, refreshKey, sortOrder]);

  if (loading) {
    return (
      <div className="activity-loading">
        <div className="spinner" />
      </div>
    );
  }

  const openExplorer = (signature) => {
    const url = getTxExplorerUrl(network, signature);
    window.open(url, '_blank');
  };

  return (
    <div className="activity-list">
      <div className="activity-header">
        <span>Transaction History</span>
        <div className="activity-header-buttons">
          <button 
            className="sort-toggle-btn"
            onClick={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
            title={sortOrder === 'desc' ? 'Showing newest first' : 'Showing oldest first'}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              {sortOrder === 'desc' ? (
                <path d="M5 1v8M1 5l4 4 4-4"/>
              ) : (
                <path d="M5 9V1M1 5l4-4 4 4"/>
              )}
            </svg>
            <span>{sortOrder === 'desc' ? 'Newest' : 'Oldest'}</span>
          </button>
          <button 
            className={`activity-refresh-btn ${isRefreshing ? 'spinning' : ''}`}
            onClick={() => fetchTransactions(false)}
            disabled={isRefreshing}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
          </button>
        </div>
      </div>
      
      {transactions.length === 0 ? (
        <div className="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          <p>No transactions yet</p>
          <p className="empty-state-sub">Your transaction history will appear here</p>
        </div>
      ) : (
        transactions.map((tx, i) => {
          const isFailed = tx.status === 'failed';
          const isSwap = tx.type === 'swap' || tx.type === 'wrap' || tx.type === 'unwrap' || tx.isSwap;
          const isStake = tx.type === 'stake';
          const isUnstake = tx.type === 'unstake';
          const isReward = tx.type === 'reward' || tx.isReward;
          const isDapp = tx.type === 'dapp' || tx.isDappInteraction;
          
          // Determine send/receive from current wallet's perspective
          // If the transaction has explicit from/to, use them to determine direction
          let isSend;
          if (isDapp) {
            // For dApp interactions, determine direction based on balance change
            isSend = tx.from === walletAddress;
          } else if (tx.type === 'send' || tx.type === 'sent') {
            // Check if current wallet is the sender
            isSend = tx.from === walletAddress || tx.walletAddress === walletAddress && tx.to !== walletAddress;
          } else if (tx.type === 'receive' || tx.type === 'received' || isReward) {
            isSend = false;
          } else if (tx.from && tx.to) {
            // Determine based on from/to addresses relative to current wallet
            isSend = tx.from === walletAddress && tx.to !== walletAddress;
          } else {
            // Fall back to type
            isSend = tx.type === 'send' || tx.type === 'sent';
          }
          
          // Determine icon type
          const iconType = isFailed ? 'failed' : isDapp ? 'dapp' : isStake ? 'stake' : isUnstake ? 'unstake' : isReward ? 'reward' : isSwap ? 'swap' : isSend ? 'send' : 'receive';
          
          // Get display title
          const getTitle = () => {
            if (isDapp) return 'dApp Interaction';
            // Check stake/unstake/reward BEFORE swap
            if (isReward) return `Staking Reward`;
            if (isStake) return `Staked ${tx.symbol || 'XNT'}`;
            if (isUnstake) return `Unstaked ${tx.symbol || 'XNT'}`;
            if (isSwap) {
              if (tx.type === 'wrap') return `Wrapped ${tx.symbol || 'XNT'}`;
              if (tx.type === 'unwrap') return `Unwrapped ${tx.symbol || 'wXNT'}`;
              return `Swapped ${tx.symbol || tx.token}`;
            }
            if (isSend) return `Sent ${tx.token || tx.symbol}`;
            return `Received ${tx.token || tx.symbol}`;
          };
          
          // Get subtitle
          const getSubtitle = () => {
            if (isDapp) {
              // Show program or contract interaction
              if (tx.dappProgram) {
                return `Program: ${tx.dappProgram.slice(0,4)}...${tx.dappProgram.slice(-4)}`;
              }
              return isSend ? 'Outgoing' : 'Incoming';
            }
            // Check stake/unstake/reward BEFORE swap
            if (isReward) {
              return 'Net gain from staking';
            }
            if (isStake) {
              const match = tx.description?.match(/([\d.]+)\s*pXNT/);
              return match ? `→ ${match[1]} pXNT` : '→ pXNT';
            }
            if (isUnstake) {
              const match = tx.description?.match(/([\d.]+)\s*XNT/);
              return match ? `→ ${match[1]} XNT` : '→ XNT';
            }
            if (isSwap) return `→ ${tx.toSymbol || tx.toToken || 'Token'}`;
            if (isSend) return `To: ${tx.shortTo || (tx.to ? tx.to.slice(0,4) + '...' + tx.to.slice(-4) : '...')}`;
            return `From: ${tx.shortFrom || (tx.from ? tx.from.slice(0,4) + '...' + tx.from.slice(-4) : '...')}`;
          };
          
          // Get amount display
          const getAmountDisplay = () => {
            // Format amount to show max 4 decimals, remove trailing zeros
            const formatAmount = (num) => {
              if (typeof num !== 'number') return num || '0';
              // For amounts >= 1, show max 2 decimals
              if (num >= 1) return parseFloat(num.toFixed(2)).toString();
              // For amounts < 1, show max 6 decimals
              return parseFloat(num.toFixed(6)).toString();
            };
            
            const amount = formatAmount(tx.amount);
            const symbol = tx.symbol || tx.token || (currentNetwork?.includes('Solana') ? 'SOL' : 'XNT');
            
            if (isDapp) {
              return isSend ? `-${amount} ${symbol}` : `+${amount} ${symbol}`;
            }
            // Check stake/unstake/reward BEFORE swap
            if (isReward) return `+${amount} ${symbol}`;
            if (isStake) return `${amount} ${tx.symbol || 'XNT'}`;
            if (isUnstake) return `+${amount} ${tx.symbol || 'XNT'}`;
            if (isSwap) {
              // Show full swap format when we have both amounts
              if (tx.toAmount && tx.toSymbol) {
                const toAmount = formatAmount(tx.toAmount);
                return `${amount} ${symbol} → ${toAmount} ${tx.toSymbol}`;
              }
              // Show just the from amount if we don't have to details yet
              return `${amount} ${symbol}`;
            }
            if (isSend) return `-${amount} ${symbol}`;
            return `+${amount} ${symbol}`;
          };
          
          return (
            <div 
              key={tx.signature || tx.id || i} 
              className="activity-item"
              onClick={() => tx.signature && openExplorer(tx.signature)}
            >
              <div className={`activity-icon ${iconType}`}>
                {isFailed ? (
                  /* Failed - red X */
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                ) : isDapp ? (
                  /* dApp - grid/app icon */
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1" />
                    <rect x="14" y="3" width="7" height="7" rx="1" />
                    <rect x="3" y="14" width="7" height="7" rx="1" />
                    <rect x="14" y="14" width="7" height="7" rx="1" />
                  </svg>
                ) : isReward ? (
                  /* Reward - star/gift icon */
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                ) : isStake || isUnstake ? (
                  /* Stake/Unstake - layers icon */
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L2 7l10 5 10-5-10-5z" />
                    <path d="M2 17l10 5 10-5" />
                    <path d="M2 12l10 5 10-5" />
                  </svg>
                ) : isSwap ? (
                  /* Swap arrows */
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
                  </svg>
                ) : isSend ? (
                  /* Send - arrow up */
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                ) : (
                  /* Receive - arrow down */
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M12 5v14M5 12l7 7 7-7" />
                  </svg>
                )}
              </div>
              <div className="activity-info">
                <div className="activity-title">{getTitle()}</div>
                <div className="activity-subtitle">{getSubtitle()}</div>
              </div>
              <div className="activity-amount-col">
                <div className={`activity-amount ${iconType}`}>{getAmountDisplay()}</div>
                <div className="activity-date">{tx.dateStr || tx.timestamp}</div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// NFTs Tab Component
function NFTsTab({ wallet, networkConfig }) {
  const [nfts, setNfts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedNft, setSelectedNft] = useState(null);
  const [sendMode, setSendMode] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sendSuccess, setSendSuccess] = useState(false);
  const [txHash, setTxHash] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [hiddenNfts, setHiddenNfts] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('x1wallet_hidden_nfts') || '[]');
    } catch { return []; }
  });

  const walletAddress = wallet?.wallet?.publicKey || wallet?.publicKey;
  const privateKey = wallet?.wallet?.privateKey;
  const network = wallet?.network;
  const rpcUrl = networkConfig?.rpcUrl;
  
  // Hide/unhide NFT
  const toggleHideNft = (mint) => {
    setHiddenNfts(prev => {
      const newHidden = prev.includes(mint) 
        ? prev.filter(m => m !== mint)
        : [...prev, mint];
      localStorage.setItem('x1wallet_hidden_nfts', JSON.stringify(newHidden));
      return newHidden;
    });
    setSelectedNft(null);
  };
  
  // Filter visible NFTs
  const visibleNfts = showHidden ? nfts : nfts.filter(nft => !hiddenNfts.includes(nft.mint));
  const hiddenCount = nfts.filter(nft => hiddenNfts.includes(nft.mint)).length;

  // Send NFT function
  const handleSendNft = async () => {
    if (!recipient || !selectedNft) return;
    
    setSending(true);
    setSendError('');
    
    try {
      // Validate recipient address (basic check)
      if (recipient.length < 32 || recipient.length > 44) {
        throw new Error('Invalid recipient address');
      }
      
      // Get recent blockhash with retry for rate limits
      const blockhashResponse = await fetchRpcWithRetry(rpcUrl, {
        jsonrpc: '2.0',
        id: 1,
        method: 'getLatestBlockhash',
        params: [{ commitment: 'finalized' }]
      });
      
      const blockhashData = await blockhashResponse.json();
      if (blockhashData.error) throw new Error(blockhashData.error.message);
      
      const blockhash = blockhashData.result?.value?.blockhash;
      if (!blockhash) throw new Error('Failed to get blockhash');
      
      // Determine if Token-2022 or regular SPL
      const programId = selectedNft.isToken2022 
        ? 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' 
        : 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
      
      // Check if this is a compressed NFT (cNFT)
      if (selectedNft.isCompressed || !selectedNft.address) {
        // Get asset proof from DAS API
        const proofResponse = await fetchRpcWithRetry(rpcUrl, {
          jsonrpc: '2.0',
          id: 1,
          method: 'getAssetProof',
          params: { id: selectedNft.mint }
        });
        
        const proofData = await proofResponse.json();
        if (proofData.error) {
          throw new Error('Failed to get asset proof: ' + proofData.error.message);
        }
        
        const proof = proofData.result;
        if (!proof || !proof.proof) {
          throw new Error('This NFT cannot be transferred. It may not be a valid compressed NFT.');
        }
        
        // Get asset details for transfer
        const assetResponse = await fetchRpcWithRetry(rpcUrl, {
          jsonrpc: '2.0',
          id: 1,
          method: 'getAsset',
          params: { id: selectedNft.mint }
        });
        
        const assetData = await assetResponse.json();
        if (assetData.error || !assetData.result) {
          throw new Error('Failed to get asset details');
        }
        
        const asset = assetData.result;
        
        // Import cNFT transfer utility
        const { createCompressedNftTransfer } = await import('@x1-wallet/core/utils/transaction');
        
        const tx = await createCompressedNftTransfer({
          assetId: selectedNft.mint,
          owner: walletAddress,
          newOwner: recipient.trim(),
          proof: proof,
          asset: asset,
          recentBlockhash: blockhash,
          privateKey: privateKey
        });
        
        // Send transaction
        const sendResponse = await fetchRpcWithRetry(rpcUrl, {
          jsonrpc: '2.0',
          id: 1,
          method: 'sendTransaction',
          params: [tx, { encoding: 'base64', preflightCommitment: 'confirmed' }]
        });
        
        const sendData = await sendResponse.json();
        if (sendData.error) throw new Error(sendData.error.message);
        
        setTxHash(sendData.result);
        setSendSuccess(true);
        setNfts(prev => prev.filter(n => n.mint !== selectedNft.mint));
        return;
      }
      
      // Standard NFT transfer (non-compressed)
      let fromTokenAccount = selectedNft.address;
      
      if (!fromTokenAccount) {
        const { findExistingATA } = await import('@x1-wallet/core/utils/transaction');
        fromTokenAccount = await findExistingATA(rpcUrl, walletAddress, selectedNft.mint, programId);
        if (!fromTokenAccount) {
          throw new Error('Could not find your token account for this NFT. This may be a compressed NFT (cNFT) which cannot be transferred with standard methods.');
        }
      }
      
      // Import token transfer utility
      const { createTokenTransferTransaction } = await import('@x1-wallet/core/utils/transaction');
      
      // Create NFT transfer transaction (amount = 1, decimals = 0)
      const tx = await createTokenTransferTransaction({
        fromPubkey: walletAddress,
        toPubkey: recipient.trim(),
        mint: selectedNft.mint,
        amount: 1,
        decimals: 0,
        fromTokenAccount: fromTokenAccount,
        recentBlockhash: blockhash,
        privateKey: privateKey,
        programId: programId,
        rpcUrl: rpcUrl
      });
      
      // Send transaction with retry for rate limits
      const sendResponse = await fetchRpcWithRetry(rpcUrl, {
        jsonrpc: '2.0',
        id: 1,
        method: 'sendTransaction',
        params: [tx, { encoding: 'base64', preflightCommitment: 'confirmed' }]
      });
      
      const sendData = await sendResponse.json();
      if (sendData.error) throw new Error(sendData.error.message);
      
      setTxHash(sendData.result);
      setSendSuccess(true);
      
      // Remove NFT from local state
      setNfts(prev => prev.filter(n => n.mint !== selectedNft.mint));
      
    } catch (err) {
      logger.error('[NFT Send] Error:', err);
      setSendError(err.message || 'Failed to send NFT');
    } finally {
      setSending(false);
    }
  };

  // Reset send state
  const resetSendState = () => {
    setSendMode(false);
    setRecipient('');
    setSendError('');
    setSendSuccess(false);
    setTxHash('');
  };

  // IPFS gateways to try (in order of preference)
  const IPFS_GATEWAYS = [
    'https://gateway.pinata.cloud/ipfs/',
    'https://cloudflare-ipfs.com/ipfs/',
    'https://ipfs.io/ipfs/',
    'https://nftstorage.link/ipfs/',
    'https://dweb.link/ipfs/'
  ];

  // Convert any IPFS URL to use a gateway
  const normalizeIpfsUrl = (url) => {
    if (!url) return null;
    
    // Already a normal HTTP URL
    if (url.startsWith('http://') || url.startsWith('https://')) {
      // Check if it's already using an IPFS gateway, keep as-is
      return url;
    }
    
    // Handle ipfs:// protocol
    if (url.startsWith('ipfs://')) {
      const cid = url.replace('ipfs://', '');
      return `${IPFS_GATEWAYS[0]}${cid}`;
    }
    
    // Handle /ipfs/ paths
    if (url.startsWith('/ipfs/')) {
      return `${IPFS_GATEWAYS[0]}${url.slice(6)}`;
    }
    
    return url;
  };

  // NFT metadata cache
  const nftMetadataCache = useRef(new Map());

  // Fetch NFT metadata from URI with fallback gateways
  const fetchMetadata = async (uri) => {
    // Check cache first
    if (nftMetadataCache.current.has(uri)) {
      return nftMetadataCache.current.get(uri);
    }
    
    try {
      // Normalize the URI
      let fetchUrl = normalizeIpfsUrl(uri);
      
      const response = await fetch(fetchUrl, { 
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });
      
      if (!response.ok) {
        return null;
      }
      
      const json = await response.json();
      // Cache the result
      nftMetadataCache.current.set(uri, json);
      return json;
    } catch (err) {
      logger.warn('[NFT] Failed to fetch metadata:', uri);
      return null;
    }
  };

  // Get Metaplex metadata PDA
  const getMetadataPDA = (mint) => {
    // Metaplex Token Metadata Program ID
    const METADATA_PROGRAM_ID = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
    
    // This is a simplified approach - we'll use the RPC to find metadata
    return mint;
  };

  useEffect(() => {
    if (!walletAddress || !rpcUrl) {
      setLoading(false);
      return;
    }

    const fetchNFTs = async () => {
      setLoading(true);
      setError('');
      
      try {
        const isSolana = network?.includes('Solana');
        const isHelius = rpcUrl?.includes('helius');
        
        // For Solana with Helius RPC, use DAS API (much more reliable)
        if (isSolana && isHelius) {
          try {
            const dasResponse = await fetch(rpcUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'getAssetsByOwner',
                params: {
                  ownerAddress: walletAddress,
                  page: 1,
                  limit: 1000
                }
              })
            });
            
            const dasData = await dasResponse.json();
            
            if (dasData?.result?.items && dasData.result.items.length > 0) {
              // Filter for NFTs - exclude fungible tokens
              const nftItemsFromDAS = dasData.result.items
                .filter(item => {
                  const iface = item.interface;
                  // Exclude fungible tokens
                  if (iface === 'FungibleToken' || iface === 'FungibleAsset') return false;
                  // Include NFT types
                  return true;
                });
              
              // DAS API doesn't return token account addresses, so we need to look them up
              let mintToTokenAccount = new Map();
              
              try {
                const [tokenAccountsResponse, token2022Response] = await Promise.all([
                  fetchRpcWithRetry(rpcUrl, {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'getTokenAccountsByOwner',
                    params: [
                      walletAddress,
                      { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
                      { encoding: 'jsonParsed' }
                    ]
                  }),
                  fetchRpcWithRetry(rpcUrl, {
                    jsonrpc: '2.0',
                    id: 2,
                    method: 'getTokenAccountsByOwner',
                    params: [
                      walletAddress,
                      { programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' },
                      { encoding: 'jsonParsed' }
                    ]
                  })
                ]);
                
                const [tokenAccountsData, token2022Data] = await Promise.all([
                  tokenAccountsResponse.json(),
                  token2022Response.json()
                ]);
                
                // Build a map of mint -> token account address
                const allTokenAccounts = [
                  ...(tokenAccountsData?.result?.value || []),
                  ...(token2022Data?.result?.value || [])
                ];
                
                for (const acc of allTokenAccounts) {
                  const info = acc.account?.data?.parsed?.info;
                  if (info?.mint) {
                    mintToTokenAccount.set(info.mint, acc.pubkey);
                  }
                }
              } catch (err) {
                logger.warn('[NFT] Failed to fetch token accounts:', err);
              }
              
              // Now build NFT items - use token account if found, otherwise check if compressed
              const nftItems = nftItemsFromDAS.map(item => {
                const tokenAccountAddress = mintToTokenAccount.get(item.id);
                const isCompressed = item.compression?.compressed === true;
                
                return {
                  mint: item.id,
                  address: tokenAccountAddress || null,
                  name: item.content?.metadata?.name || `NFT ${item.id?.slice(0, 8)}...`,
                  symbol: item.content?.metadata?.symbol || '',
                  image: item.content?.links?.image || item.content?.files?.[0]?.uri || item.content?.json_uri || null,
                  description: item.content?.metadata?.description || '',
                  attributes: item.content?.metadata?.attributes || [],
                  isToken2022: item.interface === 'ProgrammableNFT',
                  isCompressed: isCompressed,
                  loading: false
                };
              });
              
              logger.log('[NFT] Loaded', nftItems.length, 'NFTs via DAS');
              
              if (nftItems.length > 0) {
                setNfts(nftItems);
                setLoading(false);
                return;
              }
            }
          } catch (dasError) {
            logger.error('[NFT] DAS API error:', dasError);
            // Fall through to standard method
          }
        }
        
        // Fallback: Standard method for X1 or non-Helius RPCs
        // Fetch both token programs in PARALLEL
        const [tokenResponse, token2022Response] = await Promise.all([
          fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'getTokenAccountsByOwner',
              params: [
                walletAddress,
                { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
                { encoding: 'jsonParsed' }
              ]
            })
          }),
          fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              method: 'getTokenAccountsByOwner',
              params: [
                walletAddress,
                { programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' },
                { encoding: 'jsonParsed' }
              ]
            })
          })
        ]);

        const [data, data2022] = await Promise.all([
          tokenResponse.json(),
          token2022Response.json()
        ]);
        
        const tokenAccounts = data?.result?.value || [];
        const tokenAccounts2022 = data2022?.result?.value || [];
        
        // Filter for NFTs (amount = 1, decimals = 0)
        const filterNFTs = (accounts) => accounts.filter(acc => {
          const info = acc.account?.data?.parsed?.info;
          return info && 
                 info.tokenAmount?.decimals === 0 && 
                 info.tokenAmount?.uiAmount === 1;
        });
        
        const nftAccounts = filterNFTs(tokenAccounts);
        const nftAccounts2022 = filterNFTs(tokenAccounts2022);

        // Combine all NFTs with isToken2022 flag
        const allNftMints = [
          ...nftAccounts.map(acc => {
            const info = acc.account?.data?.parsed?.info;
            return {
              mint: info?.mint,
              address: acc.pubkey,
              isToken2022: false
            };
          }),
          ...nftAccounts2022.map(acc => {
            const info = acc.account?.data?.parsed?.info;
            return {
              mint: info?.mint,
              address: acc.pubkey,
              isToken2022: true
            };
          })
        ];

        logger.log('[NFT] Found', allNftMints.length, 'potential NFTs');
        
        // Show NFTs immediately with basic info, then load metadata
        const basicNfts = allNftMints.map(nft => ({
          ...nft,
          name: `NFT ${nft.mint?.slice(0, 8)}...`,
          symbol: '',
          image: null,
          loading: true
        }));
        setNfts(basicNfts);
        
        // Fetch metadata for each NFT in parallel with timeout
        const nftsWithMetadata = await Promise.all(
          allNftMints.map(async (nft) => {
            try {
              // For Solana with Helius, try DAS getAsset first
              if (isSolana && isHelius) {
                try {
                  const assetResponse = await fetch(rpcUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      jsonrpc: '2.0',
                      id: 1,
                      method: 'getAsset',
                      params: { id: nft.mint }
                    })
                  });
                  
                  const assetData = await assetResponse.json();
                  if (assetData?.result) {
                    const item = assetData.result;
                    return {
                      ...nft,
                      name: item.content?.metadata?.name || `NFT ${nft.mint?.slice(0, 8)}...`,
                      symbol: item.content?.metadata?.symbol || '',
                      image: item.content?.links?.image || item.content?.files?.[0]?.uri || null,
                      description: item.content?.metadata?.description || '',
                      attributes: item.content?.metadata?.attributes || [],
                      loading: false
                    };
                  }
                } catch (dasErr) {
                  logger.warn('[NFT] DAS getAsset failed for', nft.mint, dasErr);
                }
              }
              
              // Fallback: Metaplex on-chain metadata
              const METADATA_PROGRAM_ID = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
              
              // Try to find metadata using getProgramAccounts with timeout
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 5000);
              
              const pdaResponse = await fetch(rpcUrl, {
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
                      filters: [
                        { memcmp: { offset: 33, bytes: nft.mint } }
                      ]
                    }
                  ]
                }),
                signal: controller.signal
              });
              
              clearTimeout(timeout);
              const pdaData = await pdaResponse.json();
              
              const metadataAccount = pdaData?.result?.[0];
              
              if (metadataAccount) {
                const accountData = metadataAccount.account?.data?.[0];
                if (accountData) {
                  const buffer = Uint8Array.from(atob(accountData), c => c.charCodeAt(0));
                  
                  // Parse Metaplex metadata structure
                  let offset = 65;
                  
                  const nameLen = buffer[offset] | (buffer[offset+1] << 8) | (buffer[offset+2] << 16) | (buffer[offset+3] << 24);
                  offset += 4;
                  const name = new TextDecoder().decode(buffer.slice(offset, offset + Math.min(nameLen, 32))).replace(/\0/g, '').trim();
                  offset += 32;
                  
                  const symbolLen = buffer[offset] | (buffer[offset+1] << 8) | (buffer[offset+2] << 16) | (buffer[offset+3] << 24);
                  offset += 4;
                  const symbol = new TextDecoder().decode(buffer.slice(offset, offset + Math.min(symbolLen, 10))).replace(/\0/g, '').trim();
                  offset += 10;
                  
                  const uriLen = buffer[offset] | (buffer[offset+1] << 8) | (buffer[offset+2] << 16) | (buffer[offset+3] << 24);
                  offset += 4;
                  const uri = new TextDecoder().decode(buffer.slice(offset, offset + Math.min(uriLen, 200))).replace(/\0/g, '').trim();
                  
                  // Fetch off-chain metadata from URI
                  let image = null;
                  let description = '';
                  let attributes = [];
                  
                  if (uri && (uri.startsWith('http') || uri.startsWith('ipfs'))) {
                    const offChainMeta = await fetchMetadata(uri);
                    
                    if (offChainMeta) {
                      image = normalizeIpfsUrl(offChainMeta.image);
                      description = offChainMeta.description || '';
                      attributes = offChainMeta.attributes || [];
                    }
                  }
                  
                  return {
                    ...nft,
                    name: name || `NFT ${nft.mint?.slice(0, 8)}...`,
                    symbol,
                    uri,
                    image,
                    description,
                    attributes,
                    loading: false
                  };
                }
              }
              
              return {
                ...nft,
                name: `NFT ${nft.mint?.slice(0, 8)}...`,
                symbol: '',
                image: null,
                loading: false
              };
            } catch (err) {
              return {
                ...nft,
                name: `NFT ${nft.mint?.slice(0, 8)}...`,
                symbol: '',
                image: null,
                loading: false
              };
            }
          })
        );

        setNfts(nftsWithMetadata);
      } catch (err) {
        logger.error('[NFTs] Fetch error:', err);
        setError('Failed to load NFTs');
      } finally {
        setLoading(false);
      }
    };

    fetchNFTs();
  }, [walletAddress, rpcUrl, network]);

  // NFT Send Success Screen
  if (sendSuccess) {
    const explorerUrl = getTxExplorerUrl(network, txHash);
    
    return (
      <div className="nft-detail" style={{ textAlign: 'center', paddingTop: 40 }}>
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M9 12l2 2 4-4" />
        </svg>
        <h3 style={{ marginTop: 16, marginBottom: 8 }}>NFT Sent!</h3>
        <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>{selectedNft?.name} has been sent successfully.</p>
        
        <a 
          href={explorerUrl} 
          target="_blank" 
          rel="noopener noreferrer"
          style={{ color: 'var(--x1-blue)', fontSize: 13 }}
        >
          View Transaction ↗
        </a>
        
        <button 
          className="btn-primary" 
          onClick={() => { resetSendState(); setSelectedNft(null); }}
          style={{ marginTop: 24 }}
        >
          Done
        </button>
      </div>
    );
  }

  // NFT Send Form
  if (sendMode && selectedNft) {
    return (
      <div className="nft-detail">
        <button className="back-btn" onClick={resetSendState} style={{ marginBottom: 16 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          <span style={{ marginLeft: 8 }}>Back</span>
        </button>
        
        <h3 style={{ marginBottom: 16 }}>Send NFT</h3>
        
        {/* NFT Preview */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
          {selectedNft.image ? (
            <img src={selectedNft.image} alt={selectedNft.name} style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover' }} />
          ) : (
            <div style={{ width: 48, height: 48, background: 'var(--bg-tertiary)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" />
              </svg>
            </div>
          )}
          <div>
            <div style={{ fontWeight: 600 }}>{selectedNft.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selectedNft.mint?.slice(0, 8)}...{selectedNft.mint?.slice(-4)}</div>
          </div>
        </div>
        
        {/* Recipient Input */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>Recipient Address</label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="Enter wallet address"
            style={{
              width: '100%',
              padding: '12px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 8,
              color: 'var(--text-primary)',
              fontSize: 14,
              boxSizing: 'border-box'
            }}
          />
        </div>
        
        {/* Error Message */}
        {sendError && (
          <div style={{ 
            padding: 12, 
            background: 'rgba(239, 68, 68, 0.1)', 
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 8, 
            color: '#ef4444',
            fontSize: 13,
            marginBottom: 16 
          }}>
            {sendError}
          </div>
        )}
        
        {/* Send Button */}
        <button 
          className="btn-primary"
          onClick={handleSendNft}
          disabled={sending || !recipient}
        >
          {sending ? 'Sending...' : 'Send NFT'}
        </button>
      </div>
    );
  }

  // NFT Detail Modal
  if (selectedNft) {
    return (
      <div className="nft-detail">
        <button className="back-btn" onClick={() => setSelectedNft(null)} style={{ marginBottom: 16 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          <span style={{ marginLeft: 8 }}>Back</span>
        </button>
        
        <div className="nft-detail-image">
          {selectedNft.image ? (
            <img 
              src={selectedNft.image} 
              alt={selectedNft.name} 
              style={{ width: '100%', borderRadius: 12 }}
              onError={(e) => {
                logger.warn('[NFT] Image failed to load:', selectedNft.image);
                e.target.style.display = 'none';
                e.target.nextSibling.style.display = 'flex';
              }}
            />
          ) : null}
          <div style={{ 
            display: selectedNft.image ? 'none' : 'flex',
            width: '100%', 
            aspectRatio: '1', 
            background: 'var(--bg-tertiary)', 
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </div>
        </div>
        
        <h3 style={{ marginTop: 16, marginBottom: 8 }}>{selectedNft.name}</h3>
        {selectedNft.symbol && <p style={{ color: 'var(--text-muted)', marginBottom: 8 }}>{selectedNft.symbol}</p>}
        {selectedNft.description && <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>{selectedNft.description}</p>}
        
        {/* Compressed NFT indicator */}
        {selectedNft.isCompressed && (
          <div style={{ 
            background: 'rgba(99, 102, 241, 0.1)', 
            border: '1px solid rgba(99, 102, 241, 0.3)',
            borderRadius: 8, 
            padding: 10, 
            marginBottom: 12,
            fontSize: 12,
            color: 'var(--text-muted)'
          }}>
            <span style={{ color: '#818cf8' }}>✦</span> Compressed NFT (cNFT)
          </div>
        )}
        
        {/* Send Button */}
        <button 
          className="btn-primary"
          onClick={() => setSendMode(true)}
          style={{ marginBottom: 12 }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8 }}>
            <path d="M22 2L11 13" />
            <path d="M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
          Send NFT
        </button>
        
        {/* Hide/Unhide Button */}
        <button 
          className="btn-secondary"
          onClick={() => toggleHideNft(selectedNft.mint)}
          style={{ marginBottom: 16, width: '100%' }}
        >
          {hiddenNfts.includes(selectedNft.mint) ? (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8 }}>
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              Unhide NFT
            </>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 8 }}>
                <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
              Hide NFT
            </>
          )}
        </button>
        
        <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Mint Address</div>
          <div style={{ fontSize: 12, wordBreak: 'break-all' }}>{selectedNft.mint}</div>
        </div>
        
        {selectedNft.attributes && selectedNft.attributes.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <h4 style={{ marginBottom: 12, fontSize: 14 }}>Attributes</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {selectedNft.attributes.map((attr, i) => (
                <div key={i} style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 10, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{attr.trait_type}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{attr.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="empty-state">
        <div className="spinner" />
        <p>Loading NFTs...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="1.5">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <p>{error}</p>
      </div>
    );
  }

  if (nfts.length === 0) {
    return (
      <div className="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
        <p>No NFTs found</p>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
          NFTs will appear here when you receive them
        </span>
      </div>
    );
  }

  return (
    <div>
      {/* Hidden NFTs toggle */}
      {hiddenCount > 0 && (
        <div 
          onClick={() => setShowHidden(!showHidden)}
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            padding: '8px 12px',
            marginBottom: 12,
            background: 'var(--bg-tertiary)',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 13
          }}
        >
          <span style={{ color: 'var(--text-muted)' }}>
            {showHidden ? 'Showing' : 'Hiding'} {hiddenCount} hidden NFT{hiddenCount > 1 ? 's' : ''}
          </span>
          <span style={{ color: 'var(--x1-blue)' }}>
            {showHidden ? 'Hide' : 'Show'}
          </span>
        </div>
      )}
      
      <div className="nft-grid">
        {visibleNfts.map((nft, index) => (
          <div 
            key={nft.mint || index} 
            className="nft-card" 
            onClick={() => setSelectedNft(nft)} 
            style={{ 
              cursor: 'pointer',
              opacity: hiddenNfts.includes(nft.mint) ? 0.5 : 1
            }}
          >
            <div className="nft-image">
              {nft.image ? (
                <img 
                  src={nft.image} 
                  alt={nft.name} 
                  style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 }}
                  onError={(e) => {
                    logger.warn('[NFT] Grid image failed to load:', nft.image);
                    e.target.style.display = 'none';
                    e.target.nextSibling.style.display = 'flex';
                  }}
                  onLoad={() => logger.log('[NFT] Image loaded:', nft.name)}
                />
              ) : null}
              <div style={{ 
                display: nft.image ? 'none' : 'flex',
                width: '100%',
                height: '100%',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--bg-tertiary)',
                borderRadius: 8
              }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15l-5-5L5 21" />
                </svg>
              </div>
              {/* Hidden indicator */}
              {hiddenNfts.includes(nft.mint) && (
                <div style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  background: 'rgba(0,0,0,0.7)',
                  borderRadius: 4,
                  padding: '2px 6px',
                  fontSize: 10,
                  color: '#999'
                }}>
                  Hidden
                </div>
              )}
            </div>
            <div className="nft-info">
              <span className="nft-name">{nft.name}</span>
              <span className="nft-mint">{nft.mint?.slice(0, 4)}...{nft.mint?.slice(-4)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// DeFi Tab Component
function DefiTab({ wallet, tokens, isSolana, onStake }) {
  const [xpBalance, setXpBalance] = useState(null);
  const [xpLoading, setXpLoading] = useState(true);
  
  // Fetch XP balance
  useEffect(() => {
    const fetchXP = async () => {
      if (!wallet.wallet?.publicKey) return;
      
      setXpLoading(true);
      try {
        const { getXPBalance } = await import('@x1-wallet/core/services/xp');
        const result = await getXPBalance(wallet.wallet.publicKey, wallet.network);
        setXpBalance(result);
      } catch (err) {
        logger.error('[DefiTab] Failed to fetch XP:', err);
        setXpBalance({ totalScore: 0, totalCurrentScore: 0, totalClaimedScore: 0 });
      }
      setXpLoading(false);
    };
    
    fetchXP();
  }, [wallet.wallet?.publicKey, wallet.network]);
  
  // Find pXNT token for staking position
  const pxntToken = tokens.find(t => t.symbol === 'pXNT');
  const pxntBalance = parseFloat(pxntToken?.balance || pxntToken?.uiAmount || 0);
  const hasPxnt = pxntBalance > 0;
  
  // Find XLP tokens for liquidity positions
  const xlpTokens = tokens.filter(t => 
    t.symbol?.includes('XLP') || 
    t.symbol?.includes('LP') ||
    t.name?.toLowerCase().includes('liquidity')
  );
  
  const isX1 = wallet.network === 'X1 Mainnet';
  
  return (
    <div className="defi-tab">
      {/* CORE XP Balance Section */}
      <div className="defi-section">
        <div className="defi-section-header">
          <span className="defi-section-title">CORE XP</span>
          <a href="https://core.x1.xyz" target="_blank" rel="noopener noreferrer" className="defi-section-link" title="Open CORE">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        </div>
        <div className="defi-item xp-item">
          <div className="defi-item-icon xp">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </div>
          <div className="defi-item-info">
            <span className="defi-item-title">Available XP</span>
            <span className="defi-item-desc">
              {xpBalance?.totalClaimedScore > 0 && `Claimed: ${xpBalance.totalClaimedScore.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
            </span>
          </div>
          <div className="defi-item-value xp-value">
            {xpLoading ? (
              <span className="loading-dots">...</span>
            ) : (
              <span className="xp-score">
                {(xpBalance?.totalCurrentScore || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Staking Section - Only show on X1 */}
      {isX1 && (
        <div className="defi-section">
          <div className="defi-section-header">
            <span className="defi-section-title">Staking</span>
          </div>
          
          <div 
            className="defi-item clickable"
            onClick={onStake}
          >
            <div className="defi-item-icon stake">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <div className="defi-item-info">
              <span className="defi-item-title">XNT Staking</span>
              <span className="defi-item-desc">
                {hasPxnt 
                  ? `${pxntBalance.toFixed(4)} pXNT staked` 
                  : 'Stake XNT to earn rewards'}
              </span>
            </div>
            <div className="defi-item-action">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </div>
          </div>
        </div>
      )}

      {/* Liquidity Section */}
      <div className="defi-section">
        <div className="defi-section-header">
          <span className="defi-section-title">Liquidity Pools</span>
        </div>
        
        {xlpTokens.length > 0 ? (
          xlpTokens.map((lp, idx) => (
            <div key={idx} className="defi-item">
              <div className="defi-item-icon liquidity">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M8 12h8M12 8v8" />
                </svg>
              </div>
              <div className="defi-item-info">
                <span className="defi-item-title">{lp.name || lp.symbol || 'LP Token'}</span>
                <span className="defi-item-desc">{parseFloat(lp.balance || lp.uiAmount || 0).toFixed(6)} tokens</span>
              </div>
              <div className="defi-item-value">
                {lp.usdValue ? `$${lp.usdValue.toFixed(2)}` : ''}
              </div>
            </div>
          ))
        ) : (
          <div className="defi-empty">
            <span>No liquidity positions</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Logo URL for Solana from XDEX S3
const SOLANA_LOGO_URL = '/icons/48-sol.png';

// Network Logo based on network type
function NetworkLogo({ network, size = 40 }) {
  // X1 logo fills edge-to-edge, Solana logo has internal padding
  // Use slightly larger size for Solana to make them visually consistent
  const x1LogoSize = Math.round(size * 0.8);
  const solanaLogoSize = Math.round(size * 0.95); // Larger to compensate for internal padding
  
  if (network?.includes('Solana')) {
    return (
      <div 
        className="network-logo-container"
        style={{
          width: size,
          height: size,
          minWidth: size,
          minHeight: size,
          borderRadius: '50%',
          background: '#000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          overflow: 'hidden'
        }}
      >
        <img 
          src={SOLANA_LOGO_URL}
          alt="Solana"
          style={{
            width: solanaLogoSize,
            height: solanaLogoSize,
            objectFit: 'contain',
            display: 'block'
          }}
        />
      </div>
    );
  }
  
  // X1 logo
  return (
    <div
      className="network-logo-container"
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        borderRadius: '50%',
        background: '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        overflow: 'hidden'
      }}
    >
      <img
        src="/icons/48-x1.png"
        alt="X1"
        style={{ 
          width: x1LogoSize,
          height: x1LogoSize,
          objectFit: 'contain', 
          display: 'block'
        }}
        onError={(e) => {
          // Fallback to text if image fails
          e.target.style.display = 'none';
          e.target.parentElement.innerHTML = '<span style="color: #0274fb; font-weight: bold; font-size: ' + Math.round(size * 0.4) + 'px;">X1</span>';
        }}
      />
    </div>
  );
}


// Network Selector - Slide Up Panel
function NetworkPanel({ network, networks, onSelect, onClose, onCustomRpc }) {
  // Only show mainnets in the quick network selector
  // Testnets/devnets are available in Settings → Network for developers
  const mainnets = Object.keys(networks).filter(n => !n.includes('Testnet') && !n.includes('Devnet'));
  
  return (
    <div className="slide-panel-overlay" onClick={onClose}>
      <div className="slide-panel" onClick={e => e.stopPropagation()}>
        
        <div className="slide-panel-header">
          <button className="panel-back-btn" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <h3>Select Network</h3>
        </div>
        <div className="slide-panel-content">
          <div className="network-section-label">Networks</div>
          {mainnets.map((net, index) => (
            <div 
              key={net}
              className={`network-option ${network === net ? 'active' : ''}`}
              onClick={() => { onSelect(net); onClose(); }}
            >
              <NetworkLogo network={net} size={40} />
              <div className="network-option-info">
                <span className="network-name">{net}</span>
              </div>
              {network === net && (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </div>
          ))}
          
          <div className="network-info-note" style={{ 
            padding: '12px 16px', 
            fontSize: '12px', 
            color: 'var(--text-muted)',
            marginTop: '12px'
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6, verticalAlign: -2 }}>
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
            Testnets available in Settings → Network
          </div>
        </div>
      </div>
    </div>
  );
}

// Wallet Selector - Slide Up Panel
function WalletPanel({ wallets, activeId, network, onSelect, onManage, onClose, onEditWallet, onShowAddWallet, onReorderWallets }) {
  const [copiedId, setCopiedId] = useState(null);
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [balances, setBalances] = useState({});
  const [loadingBalances, setLoadingBalances] = useState(true);
  const [hiddenWallets, setHiddenWallets] = useState(() => {
    try {
      const stored = localStorage.getItem('x1wallet_hidden_wallets');
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const [showHidden, setShowHidden] = useState(false);

  // Toggle wallet visibility (can't hide active wallet)
  const toggleWalletVisibility = (e, walletId) => {
    e.stopPropagation();
    // Don't allow hiding the currently active wallet
    if (walletId === activeId && !hiddenWallets.includes(walletId)) {
      return; // Can't hide active wallet
    }
    const newHidden = hiddenWallets.includes(walletId)
      ? hiddenWallets.filter(id => id !== walletId)
      : [...hiddenWallets, walletId];
    setHiddenWallets(newHidden);
    localStorage.setItem('x1wallet_hidden_wallets', JSON.stringify(newHidden));
  };

  // Filter wallets based on visibility
  const visibleWallets = showHidden 
    ? wallets 
    : wallets.filter(w => !hiddenWallets.includes(w.id));
  
  const hiddenCount = wallets.filter(w => hiddenWallets.includes(w.id)).length;

  // Fetch balances for all wallets when panel opens
  useEffect(() => {
    let isMounted = true;
    
    const fetchBalances = async () => {
      if (!isMounted) return;
      setLoadingBalances(true);
      const newBalances = {};
      
      // Get RPC URL from network config
      const networkConfig = NETWORKS[network] || NETWORKS['X1 Mainnet'];
      const rpcUrl = networkConfig?.rpcUrl || 'https://rpc.mainnet.x1.xyz';
      
      // Fetch all balances in parallel
      const promises = wallets.map(async (w) => {
        try {
          const address = w.publicKey || w.addresses?.[w.activeAddressIndex || 0]?.publicKey || w.addresses?.[0]?.publicKey;
          if (!address) return { id: w.id, balance: null };
          
          const response = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'getBalance',
              params: [address]
            })
          });
          
          const data = await response.json();
          if (data.result?.value !== undefined) {
            return { id: w.id, balance: data.result.value / 1e9 };
          }
          return { id: w.id, balance: null };
        } catch (err) {
          return { id: w.id, balance: null };
        }
      });
      
      const results = await Promise.all(promises);
      results.forEach(r => { newBalances[r.id] = r.balance; });
      
      if (isMounted) {
        setBalances(newBalances);
        setLoadingBalances(false);
      }
    };

    if (wallets?.length > 0) {
      fetchBalances();
    }
    
    return () => { isMounted = false; };
  }, []); // Only run once on mount

  // Format balance for display
  const formatBalance = (balance) => {
    if (balance === null || balance === undefined) return '...';
    if (balance === 0) return '0';
    if (balance < 0.0001) return '<0.0001';
    if (balance < 1) return balance.toFixed(4);
    if (balance < 1000) return balance.toFixed(2);
    if (balance < 1000000) return (balance / 1000).toFixed(1) + 'K';
    return (balance / 1000000).toFixed(1) + 'M';
  };

  // Get token symbol
  const tokenSymbol = network?.includes('Solana') ? 'SOL' : 'XNT';
  
  const copyAddress = (e, walletId, address) => {
    e.stopPropagation();
    navigator.clipboard.writeText(address);
    setCopiedId(walletId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatAddress = (addr) => {
    if (!addr) return '';
    return `${addr.slice(0, 8)}...${addr.slice(-8)}`;
  };

  // Get the active address for a wallet
  const getActiveAddress = (w) => {
    if (!w.addresses || w.addresses.length === 0) return { publicKey: w.publicKey, name: 'Address 1' };
    const idx = w.activeAddressIndex || 0;
    return w.addresses[idx] || w.addresses[0];
  };

  // Check if avatar is an uploaded image
  const isImage = (avatar) => avatar && avatar.startsWith('data:image');

  // Drag handlers
  const handleDragStart = (e, walletId) => {
    setDraggedId(walletId);
    e.dataTransfer.effectAllowed = 'move';
    // Add a slight delay to show the drag visual
    setTimeout(() => {
      e.target.style.opacity = '0.5';
    }, 0);
  };

  const handleDragEnd = (e) => {
    e.target.style.opacity = '1';
    setDraggedId(null);
    setDragOverId(null);
  };

  const handleDragOver = (e, walletId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (walletId !== draggedId) {
      setDragOverId(walletId);
    }
  };

  const handleDragLeave = (e) => {
    setDragOverId(null);
  };

  const handleDrop = (e, targetId) => {
    e.preventDefault();
    if (draggedId && targetId && draggedId !== targetId && onReorderWallets) {
      const draggedIndex = wallets.findIndex(w => w.id === draggedId);
      const targetIndex = wallets.findIndex(w => w.id === targetId);
      
      if (draggedIndex !== -1 && targetIndex !== -1) {
        const newWallets = [...wallets];
        const [draggedWallet] = newWallets.splice(draggedIndex, 1);
        newWallets.splice(targetIndex, 0, draggedWallet);
        onReorderWallets(newWallets);
      }
    }
    setDraggedId(null);
    setDragOverId(null);
  };

  return (
    <div className="slide-panel-overlay" onClick={onClose}>
      <div className="slide-panel" onClick={e => e.stopPropagation()}>
        
        <div className="slide-panel-header">
          <button className="back-btn" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <h3 className="slide-panel-title">Select Wallet</h3>
          <div style={{ width: 32 }} />
        </div>
        <div className="slide-panel-content">
          {/* Show hidden toggle if there are hidden wallets */}
          {hiddenCount > 0 && (
            <button
              onClick={() => setShowHidden(!showHidden)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 12px',
                marginBottom: 8,
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                borderRadius: 8,
                color: 'var(--text-muted)',
                fontSize: 12,
                cursor: 'pointer',
                width: '100%'
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {showHidden ? (
                  <>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </>
                ) : (
                  <>
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </>
                )}
              </svg>
              {showHidden ? 'Hide' : 'Show'} hidden wallets ({hiddenCount})
            </button>
          )}
          
          {visibleWallets.map(w => {
            const activeAddr = getActiveAddress(w);
            const hasImage = isImage(w.avatar);
            const isHidden = hiddenWallets.includes(w.id);
            
            return (
              <div 
                key={w.id}
                className={`wallet-panel-item ${activeId === w.id ? 'active' : ''} ${dragOverId === w.id ? 'drag-over' : ''}`}
                onClick={() => { onSelect(w.id); onClose(); }}
                draggable={!isHidden}
                onDragStart={(e) => handleDragStart(e, w.id)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, w.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, w.id)}
                style={{ opacity: isHidden ? 0.5 : 1 }}
              >
                <div className="wallet-item-avatar">
                  {hasImage ? (
                    <img src={w.avatar} alt={w.name} />
                  ) : (
                    <div className="wallet-avatar-initials">
                      {w.isHardware ? 'L' : (w.name?.charAt(0)?.toUpperCase() || 'W')}
                    </div>
                  )}
                </div>
                <div className="wallet-item-info">
                  <div className="wallet-item-row1" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span 
                      className="wallet-item-name"
                      style={{ 
                        color: (w.type === 'watchonly' || w.isWatchOnly) ? '#ffc107' : undefined 
                      }}
                    >
                      {w.name}
                    </span>
                    {/* Hide/Unhide toggle - next to name */}
                    <button 
                      className={`wallet-hide-btn ${isHidden ? 'is-hidden' : ''} ${w.id === activeId && !isHidden ? 'is-active' : ''}`}
                      onClick={(e) => toggleWalletVisibility(e, w.id)}
                      title={w.id === activeId && !isHidden ? "Can't hide active wallet" : isHidden ? "Show wallet" : "Hide wallet"}
                      style={{ 
                        background: 'none',
                        border: 'none',
                        padding: 2,
                        cursor: w.id === activeId && !isHidden ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        pointerEvents: w.id === activeId && !isHidden ? 'none' : 'auto'
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isHidden ? "var(--text-muted)" : "var(--text-secondary)"} strokeWidth="2">
                        {isHidden ? (
                          <>
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                            <line x1="1" y1="1" x2="23" y2="23" />
                          </>
                        ) : (
                          <>
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </>
                        )}
                      </svg>
                    </button>
                    {activeId === w.id && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="3">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                    <span style={{ 
                      fontSize: 12, 
                      fontWeight: 600, 
                      color: balances[w.id] > 0 ? 'var(--success)' : 'var(--text-muted)',
                      marginLeft: 'auto'
                    }}>
                      {loadingBalances ? '...' : `${formatBalance(balances[w.id])} ${tokenSymbol}`}
                    </span>
                  </div>
                  <div className="wallet-item-row2" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span className="wallet-item-address">{formatAddress(activeAddr.publicKey)}</span>
                    <button 
                      className="wallet-item-copy"
                      onClick={(e) => copyAddress(e, w.id, activeAddr.publicKey)}
                    >
                      {copiedId === w.id ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                <button 
                  className="wallet-item-edit"
                  onClick={(e) => { e.stopPropagation(); onClose(); onEditWallet(w); }}
                  title="Edit wallet"
                  style={{ alignSelf: 'flex-start', marginTop: 2 }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
        <div className="slide-panel-footer">
          <button className="panel-action-btn full-width" onClick={() => { onClose(); onShowAddWallet(); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v8M8 12h8" />
            </svg>
            Add Wallet
          </button>
        </div>
      </div>
    </div>
  );
}

// Add Wallet Options Panel
function AddWalletPanel({ onClose, onCreateNew, onImport, onHardware, onWatchOnly }) {
  return (
    <div className="slide-panel-overlay" onClick={onClose}>
      <div className="slide-panel" onClick={e => e.stopPropagation()}>
        
        <div className="slide-panel-header">
          <button className="back-btn" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <h3>Add Wallet</h3>
        </div>
        <div className="slide-panel-content">
          <div className="add-wallet-options">
            <button className="add-wallet-option" onClick={() => { onClose(); onCreateNew(); }}>
              <div className="add-wallet-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="2">
                  <path d="M12 2l9 4.5v5c0 5.5-3.84 10.74-9 12-5.16-1.26-9-6.5-9-12v-5L12 2z" />
                  <path d="M12 8v8M8 12h8" />
                </svg>
              </div>
              <div className="add-wallet-text">
                <span className="add-wallet-title">Create New Wallet</span>
                <span className="add-wallet-desc">Generate a new seed phrase</span>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>

            <button className="add-wallet-option" onClick={() => { onClose(); onImport(); }}>
              <div className="add-wallet-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </div>
              <div className="add-wallet-text">
                <span className="add-wallet-title">Import Wallet</span>
                <span className="add-wallet-desc">Seed phrase or private key</span>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>

            <button className="add-wallet-option" onClick={() => { onClose(); onHardware(); }}>
              <div className="add-wallet-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="2">
                  <rect x="2" y="7" width="20" height="10" rx="2" />
                  <circle cx="12" cy="12" r="2" />
                  <path d="M6 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2" />
                </svg>
              </div>
              <div className="add-wallet-text">
                <span className="add-wallet-title">Hardware Wallet</span>
                <span className="add-wallet-desc">Connect Ledger or Trezor</span>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>

            <button className="add-wallet-option" onClick={() => { onClose(); onWatchOnly && onWatchOnly(); }}>
              <div className="add-wallet-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              </div>
              <div className="add-wallet-text">
                <span className="add-wallet-title">Watch-Only</span>
                <span className="add-wallet-desc">Monitor any address (read only)</span>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Private Key Byte Array Display Component
function PrivateKeyByteArray({ privateKey }) {
  const [copied, setCopied] = useState(false);
  const [byteArray, setByteArray] = useState('');
  
  React.useEffect(() => {
    const convertToByteArray = async () => {
      try {
        const { decodeBase58 } = await import('@x1-wallet/core/utils/base58');
        const bytes = decodeBase58(privateKey);
        const arrayStr = '[' + Array.from(bytes).join(',') + ']';
        setByteArray(arrayStr);
      } catch (e) {
        setByteArray('Error converting key');
      }
    };
    if (privateKey) {
      convertToByteArray();
    }
  }, [privateKey]);
  
  const copyByteArray = () => {
    navigator.clipboard.writeText(byteArray);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  if (!byteArray) return null;
  
  return (
    <div style={{
      marginTop: 12,
      padding: 12,
      background: 'rgba(255, 59, 48, 0.1)',
      border: '1px solid rgba(255, 59, 48, 0.3)',
      borderRadius: 8
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: 10,
        color: '#ff3b30',
        fontSize: 11,
        fontWeight: 600
      }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        Never share this with anyone!
      </div>
      <div style={{
        fontSize: 9,
        fontFamily: 'monospace',
        color: 'var(--text-primary)',
        wordBreak: 'break-all',
        lineHeight: 1.3,
        padding: '8px',
        background: 'var(--bg-secondary)',
        borderRadius: 6,
        marginBottom: 8
      }}>
        {byteArray}
      </div>
      <button
        onClick={copyByteArray}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          width: '100%',
          padding: '8px 10px',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)',
          borderRadius: 6,
          color: copied ? 'var(--success)' : 'var(--text-primary)',
          fontSize: 12,
          fontWeight: 500,
          cursor: 'pointer'
        }}
      >
        {copied ? (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Copied!
          </>
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Copy Byte Array
          </>
        )}
      </button>
    </div>
  );
}

// Edit Wallet Panel with Address Management
function EditWalletPanel({ walletData, onSave, onClose, onRemove }) {
  const [name, setName] = useState(walletData.name || '');
  const [avatar, setAvatar] = useState(walletData.avatar || '');
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [showPrivateKey, setShowPrivateKey] = useState(null); // null, 'base58', or 'bytes'
  const [copiedKey, setCopiedKey] = useState(false);
  const fileInputRef = React.useRef(null);
  
  const walletActions = walletData.walletActions || {};

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        alert('Image must be less than 5MB');
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        setAvatar(event.target.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = () => {
    onSave({
      ...walletData,
      name: name.trim() || walletData.name,
      avatar
    });
  };

  const clearAvatar = () => {
    setAvatar('');
  };

  const handleRemove = () => {
    if (onRemove) {
      onRemove(walletData.id);
      onClose();
    }
  };

  const copyAddress = () => {
    const addr = addresses[0]?.publicKey;
    if (addr) {
      navigator.clipboard.writeText(addr);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    }
  };

  const copyPrivateKey = () => {
    const key = addresses[0]?.privateKey;
    if (key) {
      navigator.clipboard.writeText(key);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  const addresses = walletData.addresses || [{ 
    index: 0, 
    publicKey: walletData.publicKey, 
    privateKey: walletData.privateKey,
    name: 'Address 1' 
  }];
  // Show seed phrase button unless explicitly marked as private-key-only or hardware wallet
  const hasMnemonic = !walletData.isPrivateKeyOnly && !walletData.isHardware && walletData.type !== 'privatekey' && walletData.type !== 'watchonly' && !walletData.isWatchOnly;
  const primaryAddress = addresses[0]?.publicKey || '';
  const privateKey = addresses[0]?.privateKey || '';

  // Check if avatar is an uploaded image
  const isImage = avatar && avatar.startsWith('data:image');

  return (
    <div className="slide-panel-overlay" onClick={onClose}>
      <div className="slide-panel large" onClick={e => e.stopPropagation()}>
        
        <div className="slide-panel-header">
          <button className="back-btn" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <h3>Edit Wallet</h3>
        </div>
        <div className="slide-panel-content">
          {/* Simple Avatar Section */}
          <div className="edit-avatar-row">
            <div className="edit-avatar-preview-small">
              {isImage ? (
                <img src={avatar} alt="Wallet avatar" />
              ) : (
                <span>{name?.charAt(0)?.toUpperCase() || 'W'}</span>
              )}
            </div>
            
            <div className="edit-avatar-actions">
              <button 
                className="avatar-action-btn"
                onClick={() => fileInputRef.current?.click()}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Upload
              </button>
              {isImage && (
                <button 
                  className="avatar-action-btn"
                  onClick={clearAvatar}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                  Remove
                </button>
              )}
            </div>
            
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
          </div>

          {/* Wallet Name */}
          <div className="form-group compact">
            <label>Wallet Name</label>
            <input
              type="text"
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter wallet name"
            />
          </div>

          {/* Address Section - Full address with copy */}
          <div className="form-group compact">
            <label>Address</label>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 14px',
              background: 'var(--bg-secondary)',
              borderRadius: 10,
              marginTop: 8
            }}>
              <span style={{
                flex: 1,
                fontSize: 12,
                fontFamily: 'monospace',
                color: 'var(--text-primary)',
                wordBreak: 'break-all',
                lineHeight: 1.4
              }}>
                {primaryAddress}
              </span>
              <button
                onClick={copyAddress}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 6,
                  cursor: 'pointer',
                  color: copiedAddress ? 'var(--success)' : 'var(--text-muted)',
                  flexShrink: 0
                }}
              >
                {copiedAddress ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </button>
            </div>
            
            {/* Action buttons */}
            <div style={{
              display: 'flex',
              gap: 8,
              marginTop: 12
            }}>
              {hasMnemonic && (
                <button
                  onClick={() => walletActions.showRecoveryPhrase?.(walletData.id)}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    padding: '10px 6px',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 8,
                    color: 'var(--text-primary)',
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: 'pointer'
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  Seed
                </button>
              )}
              
              {privateKey && (
                <button
                  onClick={() => setShowPrivateKey(showPrivateKey === 'base58' ? null : 'base58')}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    padding: '10px 6px',
                    background: showPrivateKey === 'base58' ? 'rgba(0, 122, 255, 0.15)' : 'var(--bg-tertiary)',
                    border: showPrivateKey === 'base58' ? '1px solid var(--x1-blue)' : '1px solid var(--border-color)',
                    borderRadius: 8,
                    color: showPrivateKey === 'base58' ? 'var(--x1-blue)' : 'var(--text-primary)',
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: 'pointer'
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                  </svg>
                  Key
                </button>
              )}
              
              {privateKey && (
                <button
                  onClick={() => setShowPrivateKey(showPrivateKey === 'bytes' ? null : 'bytes')}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    padding: '10px 6px',
                    background: showPrivateKey === 'bytes' ? 'rgba(0, 122, 255, 0.15)' : 'var(--bg-tertiary)',
                    border: showPrivateKey === 'bytes' ? '1px solid var(--x1-blue)' : '1px solid var(--border-color)',
                    borderRadius: 8,
                    color: showPrivateKey === 'bytes' ? 'var(--x1-blue)' : 'var(--text-primary)',
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: 'pointer'
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7" />
                    <rect x="14" y="3" width="7" height="7" />
                    <rect x="14" y="14" width="7" height="7" />
                    <rect x="3" y="14" width="7" height="7" />
                  </svg>
                  Bytes
                </button>
              )}
            </div>
            
            {/* Private Key Display - Base58 */}
            {showPrivateKey === 'base58' && privateKey && (
              <div style={{
                marginTop: 12,
                padding: 12,
                background: 'rgba(255, 59, 48, 0.1)',
                border: '1px solid rgba(255, 59, 48, 0.3)',
                borderRadius: 8
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: 10,
                  color: '#ff3b30',
                  fontSize: 11,
                  fontWeight: 600
                }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  Never share this with anyone!
                </div>
                <div style={{
                  fontSize: 10,
                  fontFamily: 'monospace',
                  color: 'var(--text-primary)',
                  wordBreak: 'break-all',
                  lineHeight: 1.4,
                  padding: '8px',
                  background: 'var(--bg-secondary)',
                  borderRadius: 6,
                  marginBottom: 8
                }}>
                  {privateKey}
                </div>
                <button
                  onClick={copyPrivateKey}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    width: '100%',
                    padding: '8px 10px',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 6,
                    color: copiedKey ? 'var(--success)' : 'var(--text-primary)',
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: 'pointer'
                  }}
                >
                  {copiedKey ? (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      Copied!
                    </>
                  ) : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                      Copy Private Key
                    </>
                  )}
                </button>
              </div>
            )}
            
            {/* Private Key Display - Byte Array */}
            {showPrivateKey === 'bytes' && privateKey && (
              <PrivateKeyByteArray privateKey={privateKey} />
            )}
          </div>

          {/* Danger Zone - Collapsible */}
          <div className="danger-zone-section">
            {!showRemoveConfirm ? (
              <button 
                className="danger-zone-trigger"
                onClick={() => setShowRemoveConfirm(true)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                Remove Wallet
              </button>
            ) : (
              <div className="remove-confirm-box">
                <p>Remove wallet? Make sure you have your seed phrase!</p>
                <div className="remove-confirm-btns">
                  <button className="btn-secondary" onClick={() => setShowRemoveConfirm(false)}>Cancel</button>
                  <button className="btn-danger" onClick={handleRemove}>Remove</button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="slide-panel-footer">
          <button className="btn-primary" onClick={handleSave}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}

// Seed Phrase Modal
function RecoveryPhrasePanel({ wallet, onClose }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordVerified, setPasswordVerified] = useState(false);
  
  const phrase = wallet?.mnemonic || wallet?.seedPhrase || '';
  const words = phrase ? phrase.split(' ') : [];
  
  // Check if password protection is enabled
  // Note: App.jsx stores this as x1wallet_passwordProtection with JSON.stringify
  const storedPwdProtection = localStorage.getItem('x1wallet_passwordProtection');
  const passwordProtection = storedPwdProtection ? JSON.parse(storedPwdProtection) : false;
  // X1W-SEC-006 FIX: Check for PBKDF2 auth data instead of base64 hash
  const [hasAuthData, setHasAuthData] = useState(false);
  
  useEffect(() => {
    // Check for auth data asynchronously
    const checkAuth = async () => {
      try {
        const { hasPassword } = await import('@x1-wallet/core/services/wallet');
        const result = await hasPassword();
        setHasAuthData(result);
      } catch {
        // Fallback to localStorage check
        setHasAuthData(!!localStorage.getItem('x1wallet_auth'));
      }
    };
    checkAuth();
  }, []);
  
  const requiresPassword = passwordProtection && hasAuthData;
  
  const copyPhrase = () => {
    navigator.clipboard.writeText(phrase);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  // X1W-SEC-006 FIX: Use PBKDF2 verification instead of base64
  const verifyPassword = async () => {
    setPasswordError('');
    if (!password) {
      setPasswordError('Please enter your password');
      return;
    }
    
    try {
      const { checkPassword } = await import('@x1-wallet/core/services/wallet');
      const isValid = await checkPassword(password);
      if (!isValid) {
        setPasswordError('Incorrect password');
        return;
      }
      setPasswordVerified(true);
    } catch (err) {
      setPasswordError(err.message || 'Password verification failed');
    }
  };
  
  const handleReveal = () => {
    if (requiresPassword && !passwordVerified) {
      // Will show password prompt
      return;
    }
    setRevealed(true);
  };

  return (
    <div className="slide-panel-overlay" onClick={onClose}>
      <div className="slide-panel large" onClick={e => e.stopPropagation()}>
        <div className="slide-panel-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button 
            className="back-btn" 
            onClick={onClose}
            style={{ background: 'none', border: 'none', padding: 8, cursor: 'pointer' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <h3 style={{ margin: 0 }}>Seed Phrase</h3>
        </div>
        
        <div className="slide-panel-content">
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            background: 'var(--bg-secondary)',
            borderRadius: 12,
            marginBottom: 20
          }}>
            <span style={{ fontWeight: 600 }}>{wallet?.name || 'Wallet'}</span>
          </div>
          
          {!revealed ? (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ marginBottom: 20 }}>
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              </div>
              
              {requiresPassword && !passwordVerified ? (
                <>
                  <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
                    Enter your password to reveal seed phrase
                  </p>
                  <div style={{ maxWidth: 280, margin: '0 auto' }}>
                    <input
                      type="password"
                      className="form-input"
                      placeholder="Enter password"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setPasswordError(''); }}
                      onKeyDown={(e) => e.key === 'Enter' && verifyPassword()}
                      autoFocus
                      style={{ marginBottom: 12, textAlign: 'center' }}
                    />
                    {passwordError && (
                      <div style={{ color: '#ff3b30', fontSize: 13, marginBottom: 12 }}>
                        {passwordError}
                      </div>
                    )}
                    <button className="btn-primary" onClick={verifyPassword} style={{ width: '100%' }}>
                      Verify Password
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
                    Your seed phrase is hidden for security
                  </p>
                  <button className="btn-primary" onClick={() => setRevealed(true)}>
                    Reveal Phrase
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="warning-box compact" style={{ marginBottom: 16 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffa502" strokeWidth="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <span>Never share this with anyone!</span>
              </div>
              
              <div className="seed-phrase-grid">
                {words.map((word, i) => (
                  <div key={i} className="seed-word-item">
                    <span className="seed-word-num">{i + 1}</span>
                    <span className="seed-word-text">{word}</span>
                  </div>
                ))}
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 20 }}>
                <button 
                  className="btn-secondary" 
                  onClick={copyPhrase} 
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}
                >
                  {copied ? (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                      <span>Copy to Clipboard</span>
                    </>
                  )}
                </button>
                <button className="btn-primary" onClick={onClose}>
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Browser Screen Component
function BrowserScreen({ wallet, onBack }) {
  const [url, setUrl] = useState('');
  const [currentUrl, setCurrentUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const dapps = [
    { 
      name: 'X1 Blockchain', 
      url: 'https://x1.xyz', 
      logo: '/icons/48-x1.png',
      desc: 'Layer-1 Blockchain',
      color: '#0274fb' 
    },
    { 
      name: 'XDEX', 
      url: 'https://xdex.xyz', 
      logo: '/icons/48-xdex.png',
      desc: 'X1 Native DEX',
      color: '#0274fb' 
    },
    { 
      name: 'Degen', 
      url: 'https://degen.fyi', 
      logo: '/icons/48-degen.png',
      desc: 'Launchpad',
      color: '#ff6b35' 
    },
    { 
      name: 'Vero', 
      url: 'https://vero.x1.xyz/', 
      letter: 'V',
      desc: 'Predictive Markets',
      color: '#8b5cf6' 
    },
    { 
      name: 'Bridge', 
      url: 'https://bridge.x1.xyz/', 
      letter: 'B',
      desc: 'Cross-Chain Bridge',
      color: '#14F195' 
    },
    { 
      name: 'Explorer', 
      url: 'https://explorer.mainnet.x1.xyz/', 
      logo: '/icons/48-x1.png',
      desc: 'X1 Mainnet Explorer',
      color: '#00d26a' 
    },
  ];

  // SVG icons for dApps without logos
  const DAppIcon = ({ dapp }) => {
    if (dapp.logo) {
      return <img src={dapp.logo} alt={dapp.name} style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover' }} />;
    }
    if (dapp.letter) {
      return (
        <span style={{ 
          fontSize: 20, 
          fontWeight: 700, 
          color: dapp.color || 'var(--text-primary)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif'
        }}>
          {dapp.letter}
        </span>
      );
    }
    if (dapp.svgIcon === 'explorer') {
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      );
    }
    return <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>?</span>;
  };

  const handleNavigate = (targetUrl) => {
    if (!targetUrl) return;
    let finalUrl = targetUrl;
    if (!targetUrl.startsWith('http')) {
      finalUrl = 'https://' + targetUrl;
    }
    setIsLoading(true);
    setCurrentUrl(finalUrl);
    setTimeout(() => setIsLoading(false), 500);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleNavigate(url);
    }
  };

  const expandToSidePanel = () => {
    // Open as side panel in browser
    const expandUrl = currentUrl || 'https://xdex.xyz';
    window.open(expandUrl, '_blank', 'width=420,height=680,right=0,top=0');
  };

  // If viewing a dApp
  if (currentUrl) {
    return (
      <div className="screen browser-screen">
        <div className="browser-nav-bar">
          <button className="browser-nav-btn" onClick={() => setCurrentUrl('')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="browser-url-display">
            {isLoading && <span className="loading-dot" />}
            <span className="url-text">{currentUrl.replace('https://', '').split('/')[0]}</span>
          </div>
          <button className="browser-nav-btn" onClick={() => window.open(currentUrl, '_blank')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </button>
          <button className="browser-nav-btn" onClick={expandToSidePanel} title="Expand to side panel">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </button>
        </div>
        <div className="browser-iframe-container">
          <iframe 
            src={currentUrl} 
            title="dApp Browser"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </div>
      </div>
    );
  }

  // Main browser view
  return (
    <div className="screen browser-screen">
      <div className="browser-header">
        <div className="browser-search-bar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input 
            type="text" 
            placeholder="Search or enter URL"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyPress={handleKeyPress}
          />
          <button className="browser-expand-btn" onClick={expandToSidePanel} title="Expand to side panel">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </button>
        </div>
      </div>
      
      <div className="browser-content">
        <h3>Featured dApps</h3>
        <div className="dapp-grid">
          {dapps.map(dapp => (
            <div 
              key={dapp.name} 
              className="dapp-card"
              onClick={() => handleNavigate(dapp.url)}
            >
              <div className="dapp-icon" style={{ background: dapp.logo ? 'transparent' : '#000', border: dapp.logo ? 'none' : '1px solid var(--border-color)' }}>
                <DAppIcon dapp={dapp} />
              </div>
              <div className="dapp-info">
                <span className="dapp-name">{dapp.name}</span>
                <span className="dapp-desc">{dapp.desc}</span>
              </div>
            </div>
          ))}
        </div>

        <h3>Quick Actions</h3>
        <div className="browser-quick-actions">
          <div className="browser-action-card" onClick={() => handleNavigate('https://xdex.xyz/swap')}>
            <div className="browser-action-icon" style={{ background: 'rgba(2, 116, 251, 0.15)', color: '#0274fb' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
              </svg>
            </div>
            <div className="browser-action-info">
              <span className="browser-action-title">Swap Tokens</span>
              <span className="browser-action-desc">Exchange on XDEX</span>
            </div>
          </div>
          <div className="browser-action-card" onClick={() => handleNavigate('https://bridge.x1.xyz/')}>
            <div className="browser-action-icon" style={{ background: 'rgba(20, 241, 149, 0.15)', color: '#14F195' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                <line x1="4" y1="22" x2="4" y2="15" />
                <line x1="20" y1="22" x2="20" y2="15" />
              </svg>
            </div>
            <div className="browser-action-info">
              <span className="browser-action-title">Bridge Assets</span>
              <span className="browser-action-desc">Cross-chain transfer</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WalletMain({ wallet, userTokens: initialTokens = [], onTokensUpdate, onSend, onReceive, onSwap, onBridge, onStake, onSettings, onCreateWallet, onImportWallet, onHardwareWallet, onWatchOnly, activityRefreshKey: externalRefreshKey = 0, balanceRefreshKey = 0, onTokenClick, onWalletSwitch }) {
  const [activeTab, setActiveTab] = useState('tokens');
  const [bottomNav, setBottomNav] = useState('assets');
  const [showNetworkPanel, setShowNetworkPanel] = useState(false);
  const [showWalletPanel, setShowWalletPanel] = useState(false);
  const [walletPanelKey, setWalletPanelKey] = useState(0);
  const [showAddWalletPanel, setShowAddWalletPanel] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editingWalletId, setEditingWalletId] = useState(null);
  const [showRecoveryFor, setShowRecoveryFor] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  
  // Initialize tokens from cache IMMEDIATELY on first render - no waiting for useEffect
  const [tokens, setTokens] = useState(() => {
    if (wallet.wallet?.publicKey) {
      const cached = getCachedTokens(wallet.wallet.publicKey, wallet.network);
      if (cached && cached.length > 0) {
        logger.log('[WalletMain] Initialized from cache:', cached.length, 'tokens');
        return cached;
      }
    }
    return initialTokens;
  });
  const [tokensLoading, setTokensLoading] = useState(() => {
    // Only show loading if no cached tokens
    if (wallet.wallet?.publicKey) {
      const cached = getCachedTokens(wallet.wallet.publicKey, wallet.network);
      if (cached && cached.length > 0) return false;
    }
    return initialTokens.length === 0;
  });
  
  const [copiedTokenMint, setCopiedTokenMint] = useState(null);
  const [showHiddenTokens, setShowHiddenTokens] = useState(false);
  const [hiddenTokens, setHiddenTokens] = useState(() => {
    try {
      const saved = localStorage.getItem('x1wallet_hidden_tokens');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [internalRefreshKey, setInternalRefreshKey] = useState(0);
  const [tokenRefreshKey, setTokenRefreshKey] = useState(0);  // For forcing token refresh after transactions
  const [prevBalanceRefreshKey, setPrevBalanceRefreshKey] = useState(0);
  const lastManualRefresh = useRef(0);
  
  // Currency setting - read from localStorage
  const [currency, setCurrency] = useState(() => {
    try {
      const saved = localStorage.getItem('x1wallet_currency');
      return saved ? JSON.parse(saved) : 'USD';
    } catch {
      return 'USD';
    }
  });
  
  // Listen for currency changes from Settings
  useEffect(() => {
    const checkCurrency = () => {
      try {
        const saved = localStorage.getItem('x1wallet_currency');
        const newCurrency = saved ? JSON.parse(saved) : 'USD';
        if (newCurrency !== currency) {
          setCurrency(newCurrency);
        }
      } catch {
        // Ignore
      }
    };
    
    // Check on mount and when tab gets focus
    checkCurrency();
    window.addEventListener('focus', checkCurrency);
    window.addEventListener('storage', checkCurrency);
    
    return () => {
      window.removeEventListener('focus', checkCurrency);
      window.removeEventListener('storage', checkCurrency);
    };
  }, [currency]);
  
  // Track current wallet to prevent stale fetch results from updating state
  const currentWalletRef = useRef(wallet.wallet?.publicKey);
  const currentNetworkRef = useRef(wallet.network);
  
  // Sync initialTokens when they change from parent
  useEffect(() => {
    if (initialTokens.length > 0 && tokens.length === 0) {
      setTokens(initialTokens);
      setTokensLoading(false);
    }
  }, [initialTokens]);
  
  // Cache balance when it updates (for instant display on next load)
  useEffect(() => {
    if (wallet.wallet?.publicKey && wallet.balance !== undefined && wallet.balance !== null) {
      setCachedBalance(wallet.wallet.publicKey, wallet.network, wallet.balance);
    }
  }, [wallet.balance, wallet.wallet?.publicKey, wallet.network]);
  
  // Check for network panel flag from Stake/Bridge screens
  useEffect(() => {
    const shouldOpenNetwork = sessionStorage.getItem('openNetworkPanel');
    if (shouldOpenNetwork === 'true') {
      sessionStorage.removeItem('openNetworkPanel');
      setShowNetworkPanel(true);
    }
  }, []);
  
  // Note: Token refresh effect (watching tokenRefreshKey) is defined after fetchTokens
  
  // Combine internal and external refresh keys
  const activityRefreshKey = internalRefreshKey + externalRefreshKey;

  const networkConfig = getNetworkConfig(wallet.network) || NETWORKS['X1 Mainnet'];
  const isSolana = wallet.network?.includes('Solana');
  
  // Calculate total portfolio USD value (tokens + native balance)
  const tokensUsdValue = tokens.reduce((total, token) => {
    // Calculate price based on token type
    let price = token.price || 0;
    
    // Stablecoins
    if (token.symbol === 'USDC' || token.symbol === 'USDT' || token.symbol === 'USDC.X') {
      price = 1;
    }
    // pXNT is staked XNT, same price as XNT ($1.00)
    else if (token.symbol === 'pXNT') {
      price = 1;
    }
    // WXNT is wrapped XNT, same price as XNT ($1.00)
    else if (token.symbol === 'WXNT') {
      price = 1;
    }
    
    const tokenValue = (token.uiAmount || 0) * price;
    logger.log('[Portfolio] Token:', token.symbol, 'uiAmount:', token.uiAmount, 'price:', price, 'value:', tokenValue);
    return total + tokenValue;
  }, 0);
  
  // Get display balance - use cached if fresh balance not yet loaded
  const displayBalance = (() => {
    if (wallet.balance !== undefined && wallet.balance !== null && wallet.balance > 0) {
      return wallet.balance;
    }
    // Fallback to cached balance for instant display
    if (wallet.wallet?.publicKey) {
      const cached = getCachedBalance(wallet.wallet.publicKey, wallet.network);
      if (cached !== null) {
        return cached;
      }
    }
    return wallet.balance || 0;
  })();
  
  // Add native balance value
  // XNT is pegged at $1.00, SOL fetches real price (fallback to estimate)
  const nativePrice = isSolana ? 150 : 1; // SOL price estimate, XNT = $1.00 (pegged)
  const nativeUsdValue = displayBalance * nativePrice;
  
  const totalPortfolioUsd = tokensUsdValue + nativeUsdValue;
  logger.log('[Portfolio] Total USD:', totalPortfolioUsd, 'tokens:', tokensUsdValue, 'native:', nativeUsdValue);
  
  // Get the native symbol for the current network
  const nativeSymbol = isSolana ? 'SOL' : 'XNT';
  
  // Check if native currency is selected
  const isNativeCurrency = currency === 'NATIVE';
  
  // Currency configuration with exchange rates (USD base)
  // Rates are approximate - could be fetched from API for accuracy
  const currencyInfo = {
    // NATIVE - uses network's native token (XNT for X1, SOL for Solana)
    NATIVE: { symbol: nativeSymbol, position: 'after', rate: null, isNative: true },
    // Fiat currencies with USD exchange rates
    USD: { symbol: '$', position: 'before', rate: 1 },
    EUR: { symbol: '€', position: 'before', rate: 0.92 },
    GBP: { symbol: '£', position: 'before', rate: 0.79 },
    PLN: { symbol: 'zł', position: 'after', rate: 4.02 },
    JPY: { symbol: '¥', position: 'before', rate: 149.5 },
    CAD: { symbol: 'C$', position: 'before', rate: 1.36 },
    AUD: { symbol: 'A$', position: 'before', rate: 1.53 },
    CNY: { symbol: '¥', position: 'before', rate: 7.24 },
    KRW: { symbol: '₩', position: 'before', rate: 1320 }
  };
  
  // Format currency value with conversion
  const formatCurrency = (usdValue) => {
    const info = currencyInfo[currency] || currencyInfo.USD;
    
    // If showing native token currency
    if (info.isNative) {
      // For native token display, show the balance in native units
      // usdValue is already in USD, convert back to native
      const nativeAmount = usdValue / nativePrice;
      if (nativeAmount === 0 || isNaN(nativeAmount)) return `0 ${nativeSymbol}`;
      if (nativeAmount < 0.0001) return `<0.0001 ${nativeSymbol}`;
      const formatted = nativeAmount.toLocaleString(undefined, { 
        minimumFractionDigits: 2, 
        maximumFractionDigits: 4 
      });
      return `${formatted} ${nativeSymbol}`;
    }
    
    // Fiat currency conversion
    if (usdValue === null || usdValue === undefined || isNaN(usdValue)) {
      return info.position === 'after' ? '0.00 ' + info.symbol : info.symbol + '0.00';
    }
    if (usdValue === 0) {
      return info.position === 'after' ? '0.00 ' + info.symbol : info.symbol + '0.00';
    }
    
    // Convert USD to target currency
    const convertedValue = usdValue * (info.rate || 1);
    
    // For JPY and KRW, don't show decimals
    const decimals = (currency === 'JPY' || currency === 'KRW') ? 0 : 2;
    
    const formatted = convertedValue.toLocaleString(undefined, { 
      minimumFractionDigits: decimals, 
      maximumFractionDigits: decimals 
    });
    
    if (convertedValue < 0.01 && decimals > 0) {
      return info.position === 'after' ? '<0.01 ' + info.symbol : '<' + info.symbol + '0.01';
    }
    
    return info.position === 'after' ? formatted + ' ' + info.symbol : info.symbol + formatted;
  };
  
  // Legacy formatUsd function (for compatibility)
  const formatUsd = formatCurrency;
  
  // Format as USD fiat (used as secondary display when native token is primary)
  const formatFiat = (usdValue) => {
    if (usdValue === null || usdValue === undefined || isNaN(usdValue)) return '$0.00';
    if (usdValue === 0) return '$0.00';
    if (usdValue < 0.01) return '<$0.01';
    return '$' + usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  
  // Format balance - show minimal decimals, no trailing zeros, with commas
  const formatBalance = (balance, maxDecimals = 6) => {
    if (balance === 0 || balance === null || balance === undefined) return '0';
    if (balance < 0.000001) return balance.toExponential(2);
    // For large numbers, use commas
    if (balance >= 1000) {
      return balance.toLocaleString(undefined, { maximumFractionDigits: maxDecimals });
    }
    // For smaller numbers, remove trailing zeros
    const fixed = balance.toFixed(maxDecimals);
    return parseFloat(fixed).toString();
  };
  
  // Toggle token visibility (hide/show)
  const toggleHiddenToken = (tokenMint) => {
    setHiddenTokens(prev => {
      const newHidden = prev.includes(tokenMint)
        ? prev.filter(m => m !== tokenMint)
        : [...prev, tokenMint];
      localStorage.setItem('x1wallet_hidden_tokens', JSON.stringify(newHidden));
      return newHidden;
    });
  };
  
  // Get current editing wallet from wallet list (stays in sync with updates)
  const editingWallet = editingWalletId ? wallet.wallets?.find(w => w.id === editingWalletId) : null;

  // Fetch tokens function - optimized with deduplication
  const fetchTokens = async (isInitialLoad = false, forceRefresh = false, mode = null) => {
    if (!wallet.wallet?.publicKey || !networkConfig?.rpcUrl) {
      logger.log('[WalletMain] Cannot fetch tokens - missing:', {
        publicKey: wallet.wallet?.publicKey,
        rpcUrl: networkConfig?.rpcUrl,
        network: wallet.network
      });
      return;
    }
    
    // Determine fetch mode: 'import' for fast initial loads, 'refresh' for full sync
    const fetchMode = mode || (isInitialLoad ? 'import' : 'refresh');
    
    // Capture wallet/network at fetch start to detect stale results
    const fetchWallet = wallet.wallet.publicKey;
    const fetchNetwork = wallet.network;
    const cacheKey = getFetchCacheKey(fetchWallet, fetchNetwork);
    
    // OPTIMIZATION: Skip if we fetched very recently (unless forced)
    if (!forceRefresh && !isInitialLoad) {
      const lastFetch = lastFetchTime.get(cacheKey);
      if (lastFetch && Date.now() - lastFetch < FETCH_DEBOUNCE_MS) {
        logger.log('[WalletMain] Skipping fetch - too recent:', Date.now() - lastFetch, 'ms ago');
        return;
      }
    }
    
    // OPTIMIZATION: Deduplicate concurrent requests - return existing promise if in flight
    if (pendingFetches.has(cacheKey)) {
      logger.log('[WalletMain] Reusing pending fetch for:', cacheKey);
      return pendingFetches.get(cacheKey);
    }
    
    logger.log('[WalletMain] Fetching tokens for:', fetchWallet, 'on', fetchNetwork, 'mode:', fetchMode);
    
    // Only show loading state on initial load when we have no tokens
    if (isInitialLoad && tokens.length === 0) {
      setTokensLoading(true);
    }
    
    // Create the fetch promise
    const fetchPromise = (async () => {
      try {
        // Callback for background metadata updates
        const handleTokenUpdate = (updatedTokens) => {
          // IMPORTANT: Check if wallet/network changed since fetch started
          if (currentWalletRef.current !== fetchWallet || currentNetworkRef.current !== fetchNetwork) {
            logger.log('[WalletMain] Ignoring stale background update');
            return;
          }
          
          const tokenList = updatedTokens.filter(token => {
            const isNFT = token.decimals === 0 && token.uiAmount === 1;
            return !isNFT;
          });
          
          // Direct update for background metadata enrichment
          logger.log('[WalletMain] Background token update:', tokenList.length, 'tokens');
          setTokens(tokenList);
          setCachedTokens(fetchWallet, fetchNetwork, tokenList);
          if (onTokensUpdate) onTokensUpdate(tokenList);
        };
        
        const allTokens = await fetchTokenAccounts(networkConfig.rpcUrl, fetchWallet, fetchNetwork, handleTokenUpdate, { mode: fetchMode, forceRefresh });
        
        // Record fetch time
        lastFetchTime.set(cacheKey, Date.now());
        
        // IMPORTANT: Check if wallet/network changed since fetch started
        if (currentWalletRef.current !== fetchWallet || currentNetworkRef.current !== fetchNetwork) {
          logger.log('[WalletMain] Ignoring stale fetch result');
          return;
        }
        
        // Filter out NFTs
        const tokenList = allTokens.filter(token => {
          const isNFT = token.decimals === 0 && token.uiAmount === 1;
          return !isNFT;
        });
        
        // Update tokens - direct replacement ensures fresh data
        logger.log('[WalletMain] Fetched tokens:', tokenList.length);
        setTokens(tokenList);
        setCachedTokens(fetchWallet, fetchNetwork, tokenList);
        preloadTokenImages(tokenList);
        if (onTokensUpdate) onTokensUpdate(tokenList);
      } catch (err) {
        logger.error('[WalletMain] Failed to fetch tokens:', err);
      } finally {
        // Clean up pending fetch
        pendingFetches.delete(cacheKey);
        // Only clear loading if we're still on same wallet
        if (currentWalletRef.current === fetchWallet && currentNetworkRef.current === fetchNetwork) {
          setTokensLoading(false);
        }
      }
    })();
    
    // Store the pending promise for deduplication
    pendingFetches.set(cacheKey, fetchPromise);
    
    return fetchPromise;
  };

  // Force token refresh when tokenRefreshKey changes (triggered by dApp transactions)
  const prevTokenRefreshKeyRef = useRef(0);
  useEffect(() => {
    if (tokenRefreshKey > prevTokenRefreshKeyRef.current) {
      prevTokenRefreshKeyRef.current = tokenRefreshKey;
      logger.log('[WalletMain] Token refresh triggered by key change:', tokenRefreshKey);
      if (wallet.wallet?.publicKey && networkConfig?.rpcUrl) {
        fetchTokens(false, true);  // forceRefresh=true
      }
    }
  }, [tokenRefreshKey, wallet.wallet?.publicKey, networkConfig?.rpcUrl]);

  // Manual refresh function - parallelized for speed
  const refreshBalance = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    lastManualRefresh.current = Date.now();
    // Invalidate RPC cache to get fresh data
    if (wallet.wallet?.publicKey) {
      invalidateRPCCache(wallet.wallet.publicKey);
    }
    try {
      // Fetch balance and tokens in PARALLEL for faster refresh
      await Promise.all([
        wallet.refreshBalance(),
        fetchTokens(false, true)  // forceRefresh=true bypasses debounce
      ]);
      setLastRefresh(Date.now());
      setInternalRefreshKey(prev => prev + 1); // Trigger activity refresh
    } catch (err) {
      logger.error('Failed to refresh balance:', err);
    }
    setTimeout(() => setIsRefreshing(false), 500);
  };

  // Trigger refresh when balanceRefreshKey changes (e.g., after send)
  useEffect(() => {
    if (balanceRefreshKey > prevBalanceRefreshKey) {
      logger.log('[WalletMain] Balance refresh triggered by key change');
      setPrevBalanceRefreshKey(balanceRefreshKey);
      lastManualRefresh.current = Date.now();
      // Invalidate RPC cache to get fresh balances after transaction
      if (wallet.wallet?.publicKey) {
        invalidateRPCCache(wallet.wallet.publicKey);
        wallet.refreshBalance();
        fetchTokens(false, true);  // forceRefresh=true
      }
    }
  }, [balanceRefreshKey, prevBalanceRefreshKey, wallet.wallet?.publicKey]);

  // Track previous network to detect changes
  const prevNetworkRef = useRef(wallet.network);
  const prevWalletRef = useRef(wallet.wallet?.publicKey);

  // Listen for balance refresh signal from background script (after dApp transactions)
  const lastTxRefreshRef = useRef(0);
  const lastKnownTxTimeRef = useRef(0);
  
  useEffect(() => {
    // Handler for runtime messages from background
    const handleRuntimeMessage = (message) => {
      if (message.type === 'balance-refresh-needed') {
        // Debounce: skip if we refreshed in the last 1.5 seconds
        const now = Date.now();
        if (now - lastTxRefreshRef.current < 1500) {
          logger.log('[WalletMain] Skipping duplicate refresh signal');
          return;
        }
        lastTxRefreshRef.current = now;
        
        logger.log('[WalletMain] Received balance-refresh-needed signal - refreshing immediately');
        if (wallet.wallet?.publicKey) {
          // Invalidate caches and force refresh
          invalidateRPCCache(wallet.wallet.publicKey);
          wallet.refreshBalance();
          setTokenRefreshKey(prev => prev + 1);  // Trigger token refresh
          setInternalRefreshKey(prev => prev + 1);  // Trigger activity refresh
        }
      }
    };
    
    // Handler for storage changes (backup method)
    const handleStorageChange = (changes, areaName) => {
      if (areaName === 'local' && changes.x1wallet_last_tx_time) {
        const newTxTime = changes.x1wallet_last_tx_time.newValue;
        if (newTxTime && newTxTime > lastKnownTxTimeRef.current) {
          lastKnownTxTimeRef.current = newTxTime;
          
          const now = Date.now();
          if (now - lastTxRefreshRef.current < 1500) {
            return;
          }
          lastTxRefreshRef.current = now;
          
          logger.log('[WalletMain] Detected transaction via storage change - refreshing');
          if (wallet.wallet?.publicKey) {
            invalidateRPCCache(wallet.wallet.publicKey);
            wallet.refreshBalance();
            setTokenRefreshKey(prev => prev + 1);
            setInternalRefreshKey(prev => prev + 1);
          }
        }
      }
    };
    
    // ALSO: Check for missed transactions on mount/focus
    // This catches transactions that happened while popup was closed
    const checkForMissedTransactions = async () => {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        try {
          const result = await chrome.storage.local.get('x1wallet_last_tx_time');
          const lastTxTime = result.x1wallet_last_tx_time || 0;
          
          if (lastTxTime > lastKnownTxTimeRef.current) {
            logger.log('[WalletMain] Found missed transaction, triggering refresh');
            lastKnownTxTimeRef.current = lastTxTime;
            
            if (wallet.wallet?.publicKey) {
              invalidateRPCCache(wallet.wallet.publicKey);
              wallet.refreshBalance();
              setTokenRefreshKey(prev => prev + 1);
              setInternalRefreshKey(prev => prev + 1);
            }
          }
        } catch (e) {
          // Ignore
        }
      }
    };
    
    // Check immediately on mount
    checkForMissedTransactions();
    
    // Also check periodically (every 2 seconds) - fast polling for transactions
    const pollInterval = setInterval(checkForMissedTransactions, 2000);
    
    // Add listeners
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    }
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.onChanged.addListener(handleStorageChange);
    }
    
    return () => {
      clearInterval(pollInterval);
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
      }
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      }
    };
  }, [wallet.wallet?.publicKey, wallet.refreshBalance]);  // Removed fetchTokens from deps

  // Auto-refresh and handle network/wallet changes
  useEffect(() => {
    const networkChanged = prevNetworkRef.current !== wallet.network;
    const walletChanged = prevWalletRef.current !== wallet.wallet?.publicKey;
    
    // Update refs FIRST before any async operations
    prevNetworkRef.current = wallet.network;
    prevWalletRef.current = wallet.wallet?.publicKey;
    currentWalletRef.current = wallet.wallet?.publicKey;
    currentNetworkRef.current = wallet.network;
    
    // Handle wallet OR network change - load cached tokens immediately
    if (walletChanged || networkChanged) {
      logger.log('[WalletMain] Wallet/network changed - network:', networkChanged, 'wallet:', walletChanged);
      
      // Clear old fetch cache for this new context
      const newCacheKey = getFetchCacheKey(wallet.wallet?.publicKey, wallet.network);
      lastFetchTime.delete(newCacheKey);
      
      // Try to load cached tokens immediately (prevents blank screen)
      if (wallet.wallet?.publicKey) {
        const cachedTokens = getCachedTokens(wallet.wallet.publicKey, wallet.network);
        if (cachedTokens && cachedTokens.length > 0) {
          logger.log('[WalletMain] Using cached tokens:', cachedTokens.length);
          setTokens(cachedTokens);
          setTokensLoading(false); // We have data, don't show loading
          preloadTokenImages(cachedTokens);
        } else {
          // No cache - show loading
          setTokens([]);
          setTokensLoading(true);
        }
        
        // Fetch fresh data in background (will update silently)
        logger.log('[WalletMain] Fetching fresh data in background');
        Promise.all([
          wallet.refreshBalance(),
          fetchTokens(cachedTokens?.length === 0, true)  // forceRefresh=true for new wallet/network
        ]).catch(logger.error);
        // Also trigger activity refresh on wallet/network change
        setInternalRefreshKey(prev => prev + 1);
      } else {
        setTokens([]);
        setTokensLoading(true);
      }
    }
    
    // Token/balance refresh every 10 seconds (silent) - skip if manual refresh was recent
    const tokenInterval = setInterval(() => {
      // Skip if manual refresh was within last 8 seconds
      if (Date.now() - lastManualRefresh.current < 8000) {
        logger.log('[WalletMain] Skipping interval refresh - manual refresh was recent');
        return;
      }
      if (wallet.wallet?.publicKey) {
        Promise.all([
          wallet.refreshBalance().catch(logger.error),
          fetchTokens(false, true)  // forceRefresh=true to bypass debounce and get fresh data
        ]).then(() => {
          setLastRefresh(Date.now());
        });
      }
    }, 10000);
    
    // Activity refresh every 30 seconds
    const activityInterval = setInterval(() => {
      if (wallet.wallet?.publicKey) {
        setInternalRefreshKey(prev => prev + 1);
      }
    }, 30000);
    
    // NOTE: On mount load is handled by the wallet/network change code above
    // since walletChanged will be true on first render (prev ref starts undefined)
    
    return () => {
      clearInterval(tokenInterval);
      clearInterval(activityInterval);
    };
  }, [wallet.wallet?.publicKey, wallet.network]);

  const copyAddress = () => {
    navigator.clipboard.writeText(wallet.wallet?.publicKey || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Browser tab
  if (bottomNav === 'browser') {
    return (
      <div className="screen main-screen">
        <BrowserScreen wallet={wallet} onBack={() => setBottomNav('assets')} />
      </div>
    );
  }

  // Get last 5 chars of address
  const shortAddress = wallet.wallet?.publicKey?.slice(-5) || '';

  // Check if avatar is an uploaded image
  const isImageAvatar = wallet.wallet?.avatar && wallet.wallet.avatar.startsWith('data:image');

  // Main Assets view
  return (
    <div className="screen main-screen">
      {/* Header */}
      <div className="main-header">
        <div className="header-brand">
          <img src="/icons/48-x1.png" alt="X1 Wallet" style={{ width: 32, height: 32, objectFit: 'contain' }} />
        </div>
        
        <div className="header-center-area">
          {/* Single field: Copy | Wallet Name | Network */}
          <button className="wallet-selector-btn" onClick={() => { setWalletPanelKey(k => k + 1); setShowWalletPanel(true); }}>
            {/* Copy Button */}
            <div 
              className="header-copy-icon"
              onClick={(e) => { e.stopPropagation(); copyAddress(); }}
              title={copied ? 'Copied!' : 'Copy address'}
            >
              {copied ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </div>
            
            {/* Divider */}
            <div className="header-divider" />
            
            {/* Wallet Name */}
            <span className="wallet-selector-name">{wallet.wallet?.name || 'Wallet'}</span>
            
            {/* Dropdown Arrow */}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="selector-arrow">
              <path d="M6 9l6 6 6-6" />
            </svg>
            
            {/* Divider before network */}
            <div className="header-divider" />
            
            {/* Network icon */}
            <div 
              className="header-network-icon"
              onClick={(e) => { e.stopPropagation(); setShowNetworkPanel(true); }}
              title="Change network"
            >
              <NetworkLogo network={wallet.network} size={18} />
            </div>
          </button>
        </div>
        
        <div className="header-actions">
          {/* Side Panel Button */}
          <button 
            className="header-action-btn" 
            onClick={async () => {
              try {
                if (typeof chrome !== 'undefined' && chrome.windows) {
                  const currentWindow = await chrome.windows.getCurrent();
                  await chrome.sidePanel.open({ windowId: currentWindow.id });
                  window.close(); // Close popup after opening side panel
                }
              } catch (e) {
                logger.log('Side panel not available:', e);
              }
            }} 
            title="Open in Side Panel"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="15" y1="3" x2="15" y2="21" />
            </svg>
          </button>
        </div>
      </div>

      {/* Watch-only Banner */}
      {(wallet.wallet?.type === 'watchonly' || wallet.wallet?.isWatchOnly) && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          padding: '6px 12px',
          background: 'rgba(255, 193, 7, 0.1)',
          borderBottom: '1px solid rgba(255, 193, 7, 0.2)',
          color: '#ffc107',
          fontSize: 12,
          fontWeight: 500
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          Watch-only · View balances and activity
        </div>
      )}

      {/* Tabs - Tokens, DeFi, NFTs, Activity */}
      <div className="tabs">
        <button className={`tab ${activeTab === 'tokens' ? 'active' : ''}`} onClick={() => setActiveTab('tokens')}>
          Tokens
        </button>
        <button className={`tab ${activeTab === 'defi' ? 'active' : ''}`} onClick={() => setActiveTab('defi')}>
          DeFi
        </button>
        <button className={`tab ${activeTab === 'nfts' ? 'active' : ''}`} onClick={() => setActiveTab('nfts')}>
          NFTs
        </button>
        <button className={`tab ${activeTab === 'activity' ? 'active' : ''}`} onClick={() => setActiveTab('activity')}>
          Activity
        </button>
      </div>

      {/* Balance - Only show on Tokens tab */}
      {activeTab === 'tokens' && (
        <div className="balance-section">
          {isNativeCurrency ? (
            /* Native token selected - show native balance as primary */
            <>
              <div className="balance-row">
                <div className="balance-amount">{formatBalance(displayBalance)} {networkConfig.symbol}</div>
              </div>
              <div className="balance-usd">{formatFiat(totalPortfolioUsd)}</div>
            </>
          ) : (
            /* Fiat currency selected - show fiat as primary */
            <>
              <div className="balance-row">
                <div className="balance-amount">{formatCurrency(totalPortfolioUsd)}</div>
              </div>
              <div className="balance-usd">{formatBalance(displayBalance)} {networkConfig.symbol}</div>
            </>
          )}
        </div>
      )}

      {/* Action Buttons - Only show on Tokens tab */}
      {activeTab === 'tokens' && (
        <div className="action-buttons">
        <button className="action-btn" onClick={onReceive} title="Receive">
          <div className="action-icon-sleek receive">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </div>
        </button>
        <button 
          className="action-btn" 
          onClick={() => {
            if (wallet.wallet?.type === 'watchonly' || wallet.wallet?.isWatchOnly) {
              return; // Silently ignore - button looks disabled
            }
            onSend(null);
          }} 
          title={wallet.wallet?.type === 'watchonly' || wallet.wallet?.isWatchOnly ? 'Watch-only wallet cannot send' : 'Send'}
          style={{ 
            opacity: wallet.wallet?.type === 'watchonly' || wallet.wallet?.isWatchOnly ? 0.4 : 1,
            cursor: wallet.wallet?.type === 'watchonly' || wallet.wallet?.isWatchOnly ? 'not-allowed' : 'pointer'
          }}
        >
          <div className="action-icon-sleek send" style={{ position: 'relative' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
            {/* Lock overlay for watch-only */}
            {(wallet.wallet?.type === 'watchonly' || wallet.wallet?.isWatchOnly) && (
              <svg 
                width="12" height="12" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="var(--text-muted)" 
                strokeWidth="2.5"
                style={{ position: 'absolute', bottom: -2, right: -2, background: 'var(--bg-primary)', borderRadius: 4, padding: 1 }}
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            )}
          </div>
        </button>
        <button 
          className="action-btn" 
          onClick={() => {
            if (wallet.wallet?.type === 'watchonly' || wallet.wallet?.isWatchOnly) {
              return; // Silently ignore - button looks disabled
            }
            onSwap();
          }} 
          title={wallet.wallet?.type === 'watchonly' || wallet.wallet?.isWatchOnly ? 'Watch-only wallet cannot swap' : 'Swap'}
          style={{ 
            opacity: wallet.wallet?.type === 'watchonly' || wallet.wallet?.isWatchOnly ? 0.4 : 1,
            cursor: wallet.wallet?.type === 'watchonly' || wallet.wallet?.isWatchOnly ? 'not-allowed' : 'pointer'
          }}
        >
          <div className="action-icon-sleek swap" style={{ position: 'relative' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
            {/* Lock overlay for watch-only */}
            {(wallet.wallet?.type === 'watchonly' || wallet.wallet?.isWatchOnly) && (
              <svg 
                width="12" height="12" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="var(--text-muted)" 
                strokeWidth="2.5"
                style={{ position: 'absolute', bottom: -2, right: -2, background: 'var(--bg-primary)', borderRadius: 4, padding: 1 }}
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            )}
          </div>
        </button>
        <button className="action-btn" onClick={() => setShowMoreMenu(true)} title="More">
          <div className="action-icon-sleek more">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="19" cy="12" r="1.5" />
              <circle cx="5" cy="12" r="1.5" />
            </svg>
          </div>
        </button>
      </div>
      )}

      {/* More Menu Slide Panel */}
      {showMoreMenu && (
        <div className="slide-panel-overlay" onClick={() => setShowMoreMenu(false)}>
          <div className="slide-panel small" onClick={e => e.stopPropagation()}>
            
            <div className="slide-panel-content">
              <div 
                className="more-menu-item" 
                onClick={() => { 
                  if (wallet.wallet?.type === 'watchonly' || wallet.wallet?.isWatchOnly) return;
                  setShowMoreMenu(false); 
                  onBridge(); 
                }}
                style={{ 
                  opacity: wallet.wallet?.type === 'watchonly' || wallet.wallet?.isWatchOnly ? 0.4 : 1,
                  cursor: wallet.wallet?.type === 'watchonly' || wallet.wallet?.isWatchOnly ? 'not-allowed' : 'pointer'
                }}
              >
                <div className="more-menu-icon bridge" style={{ position: 'relative' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                    <line x1="4" y1="22" x2="4" y2="15" />
                    <line x1="20" y1="22" x2="20" y2="15" />
                  </svg>
                  {(wallet.wallet?.type === 'watchonly' || wallet.wallet?.isWatchOnly) && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5"
                      style={{ position: 'absolute', bottom: -2, right: -2, background: 'var(--bg-secondary)', borderRadius: 3 }}>
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  )}
                </div>
                <div className="more-menu-info">
                  <span className="more-menu-title">Bridge</span>
                  <span className="more-menu-desc">
                    {wallet.wallet?.type === 'watchonly' || wallet.wallet?.isWatchOnly 
                      ? 'Not available for watch-only' 
                      : 'Transfer across chains'}
                  </span>
                </div>
              </div>
              <div 
                className="more-menu-item" 
                onClick={() => { 
                  if (wallet.wallet?.type === 'watchonly' || wallet.wallet?.isWatchOnly) return;
                  logger.log('[WalletMain] Stake clicked'); 
                  setShowMoreMenu(false); 
                  onStake(); 
                }}
                style={{ 
                  opacity: wallet.wallet?.type === 'watchonly' || wallet.wallet?.isWatchOnly ? 0.4 : 1,
                  cursor: wallet.wallet?.type === 'watchonly' || wallet.wallet?.isWatchOnly ? 'not-allowed' : 'pointer'
                }}
              >
                <div className="more-menu-icon stake" style={{ position: 'relative' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5z" />
                    <path d="M2 17l10 5 10-5" />
                    <path d="M2 12l10 5 10-5" />
                  </svg>
                  {(wallet.wallet?.type === 'watchonly' || wallet.wallet?.isWatchOnly) && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5"
                      style={{ position: 'absolute', bottom: -2, right: -2, background: 'var(--bg-secondary)', borderRadius: 3 }}>
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  )}
                </div>
                <div className="more-menu-info">
                  <span className="more-menu-title">Stake</span>
                  <span className="more-menu-desc">
                    {wallet.wallet?.type === 'watchonly' || wallet.wallet?.isWatchOnly 
                      ? 'Not available for watch-only' 
                      : 'Earn rewards on your tokens'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="main-content">
        {activeTab === 'tokens' && (
          <div className="token-list">
            {/* Native Token */}
            <div 
              className="token-item clickable"
              onClick={() => onTokenClick ? onTokenClick({
                symbol: networkConfig.symbol,
                name: isSolana ? 'Solana' : 'X1 Native Token',
                balance: displayBalance,
                uiAmount: displayBalance,
                mint: null,
                isNative: true,
                logoURI: null,
                usdValue: nativeUsdValue
              }) : onSend(null)}
            >
              <NetworkLogo network={wallet.network} size={40} />
              <div className="token-info">
                <span className="token-name">{isSolana ? 'Solana' : 'X1 Native Token'}</span>
                <span className="token-amount-sub">{formatBalance(displayBalance)} {networkConfig.symbol}</span>
              </div>
              <div className="token-balance">
                <span className="token-usd">{formatUsd(nativeUsdValue)}</span>
                <span className="token-change neutral">0.00%</span>
              </div>
            </div>

            {/* SPL & Token-2022 Tokens */}
            {tokensLoading && tokens.length === 0 && (
              <div className="token-loading">
                <div className="spinner-small" />
                <span>Loading tokens...</span>
              </div>
            )}

            {tokens
              .filter(token => showHiddenTokens || !hiddenTokens.includes(token.mint))
              .sort((a, b) => {
                // Sort by USD value (highest first), fallback to raw balance
                const aBalance = parseFloat(a.uiAmount || a.balance || 0);
                const bBalance = parseFloat(b.uiAmount || b.balance || 0);
                const aPrice = parseFloat(a.price || 0);
                const bPrice = parseFloat(b.price || 0);
                const aUsdValue = a.usdValue || (aBalance * aPrice);
                const bUsdValue = b.usdValue || (bBalance * bPrice);
                
                // If both have USD values, sort by USD
                if (aUsdValue > 0 || bUsdValue > 0) {
                  return bUsdValue - aUsdValue;
                }
                // Otherwise sort by raw balance
                return bBalance - aBalance;
              })
              .map((token) => {
              const isHidden = hiddenTokens.includes(token.mint);
              // AGGRESSIVE LP TOKEN DETECTION
              const tokenName = (token.name || '').toLowerCase();
              const tokenSymbol = (token.symbol || '').toUpperCase();
              
              // Detect LP tokens by multiple methods:
              // 1. isLPToken flag (set by tokens.js)
              // 2. Symbol is XLP or SLP
              // 3. Name contains "xlp" (catches "WXNT-USDC.X XLP")
              // 4. Name contains " lp" (catches "SOL/USDC LP")
              // 5. Name contains "/" (pair format)
              // 6. Symbol contains "XLP" (catches symbols like "WXNT-USDC.X XLP")
              const isLP = token.isLPToken === true || 
                           tokenSymbol === 'XLP' || 
                           tokenSymbol === 'SLP' ||
                           tokenSymbol.includes('XLP') ||   // NEW: catches "WXNT-USDC.X XLP" symbol
                           tokenSymbol.includes('SLP') ||   // NEW: catches SLP variants
                           tokenName.includes('xlp') ||     // NEW: catches "wxnt-usdc.x xlp"
                           tokenName.includes(' lp') ||
                           tokenName.includes('lp token') ||
                           tokenName.includes('/') ||
                           (tokenName.includes('xdex') && tokenName.includes('lp'));
              
              // For LP tokens, use the XLP icon path
              const effectiveLogoUrl = isLP ? XLP_ICON_PATH : token.logoURI;
              const hasLogo = effectiveLogoUrl && (effectiveLogoUrl.startsWith('http') || effectiveLogoUrl.startsWith('/'));
              
              // Always log LP token detection for debugging
              if (isLP || tokenName.includes('lp') || tokenName.includes('xlp') || tokenSymbol.includes('XLP')) {
                console.log('[LP Check]', {
                  name: token.name,
                  symbol: token.symbol,
                  isLPToken: token.isLPToken,
                  detected: isLP,
                  effectiveLogoUrl,
                  hasLogo
                });
              }
              
              return (
              <div 
                key={token.address} 
                className={`token-item clickable${isHidden ? ' token-hidden' : ''}`}
                onClick={() => onTokenClick ? onTokenClick(token) : onSend(token)}
              >
                <div className="token-icon">
                  {hasLogo ? (
                    <img 
                      src={effectiveLogoUrl} 
                      alt={token.symbol} 
                      className="token-logo"
                      onError={(e) => {
                        console.error('[Image Load Failed]', effectiveLogoUrl, 'for', token.name);
                        e.target.style.display = 'none';
                        if (e.target.nextSibling) {
                          e.target.nextSibling.style.display = 'flex';
                        }
                      }}
                      onLoad={() => {
                        if (isLP) console.log('[LP Icon Loaded]', effectiveLogoUrl);
                      }}
                    />
                  ) : null}
                  <div 
                    className={`token-logo-fallback ${token.symbol === 'pXNT' ? 'pxnt' : ''} ${isLP ? 'lp-token' : ''}`}
                    style={{ display: hasLogo ? 'none' : 'flex' }}
                  >
                    {isLP ? 'LP' : (token.symbol === 'pXNT' ? 'pXNT' : (token.symbol?.charAt(0) || '?'))}
                  </div>
                </div>
                <div className="token-info">
                  <div className="token-name-row">
                    <span className="token-name">{token.name || 'Unknown Token'}</span>
                    <button 
                      className="token-copy-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(token.mint);
                        setCopiedTokenMint(token.mint);
                        setTimeout(() => setCopiedTokenMint(null), 2000);
                      }}
                      title="Copy token address"
                    >
                      {copiedTokenMint === token.mint ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      )}
                    </button>
                    <button 
                      className="token-hide-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleHiddenToken(token.mint);
                      }}
                      title={isHidden ? "Show token" : "Hide token"}
                    >
                      {isHidden ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <span className="token-amount-sub">
                    {(token.uiAmount || 0).toLocaleString(undefined, { maximumFractionDigits: 6 })} {token.symbol}
                  </span>
                </div>
                <div className="token-balance">
                  <span className="token-usd">
                    {(() => {
                      // Calculate USD price based on token type
                      let price = token.price;
                      
                      // Stablecoins
                      if (token.symbol === 'USDC' || token.symbol === 'USDT' || token.symbol === 'USDC.X') {
                        price = 1;
                      }
                      // pXNT is staked XNT, same price as XNT
                      else if (token.symbol === 'pXNT') {
                        price = 1; // XNT is pegged at $1.00
                      }
                      // WXNT is wrapped XNT, same price as XNT
                      else if (token.symbol === 'WXNT') {
                        price = 1; // XNT is pegged at $1.00
                      }
                      
                      // If no price available, show --
                      if (price === undefined || price === null) {
                        return '--';
                      }
                      
                      const value = (token.uiAmount || 0) * price;
                      return value > 0 
                        ? `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
                        : '$0.00';
                    })()}
                  </span>
                  <span className="token-change neutral">0.00%</span>
                </div>
              </div>
              );
            })}
            
            {/* Show hidden tokens toggle */}
            {hiddenTokens.length > 0 && (
              <button 
                className="show-hidden-tokens-btn"
                onClick={() => setShowHiddenTokens(!showHiddenTokens)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {showHiddenTokens ? (
                    <>
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </>
                  ) : (
                    <>
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </>
                  )}
                </svg>
                {showHiddenTokens ? 'Hide' : 'Show'} {hiddenTokens.length} hidden token{hiddenTokens.length !== 1 ? 's' : ''}
              </button>
            )}
          </div>
        )}

        {activeTab === 'nfts' && (
          <NFTsTab wallet={wallet} networkConfig={networkConfig} />
        )}

        {activeTab === 'defi' && (
          <DefiTab 
            wallet={wallet} 
            tokens={tokens} 
            isSolana={isSolana}
            onStake={onStake}
          />
        )}

        {activeTab === 'activity' && (
          <ActivityList 
            walletAddress={wallet.wallet?.publicKey} 
            network={wallet.network}
            networkConfig={networkConfig}
            refreshKey={activityRefreshKey}
          />
        )}
      </div>

      {/* Panels */}
      {showNetworkPanel && (
        <NetworkPanel
          network={wallet.network}
          networks={NETWORKS}
          onSelect={wallet.setNetwork}
          onClose={() => setShowNetworkPanel(false)}
        />
      )}

      {showWalletPanel && (
        <WalletPanel
          key={walletPanelKey}
          wallets={wallet.wallets}
          activeId={wallet.activeWalletId}
          network={wallet.network}
          onSelect={(walletId) => {
            // Clear tokens immediately before switching to prevent stale data
            setTokens([]);
            setTokensLoading(true);
            if (onWalletSwitch) onWalletSwitch();
            wallet.switchWallet(walletId);
          }}
          onClose={() => setShowWalletPanel(false)}
          onEditWallet={(w) => setEditingWalletId(w.id)}
          onShowAddWallet={() => setShowAddWalletPanel(true)}
          onReorderWallets={wallet.reorderWallets}
        />
      )}

      {showAddWalletPanel && (
        <AddWalletPanel
          onClose={() => setShowAddWalletPanel(false)}
          onCreateNew={onCreateWallet}
          onImport={onImportWallet}
          onHardware={onHardwareWallet}
          onWatchOnly={onWatchOnly}
        />
      )}

      {editingWallet && (
        <EditWalletPanel
          walletData={{
            ...editingWallet,
            walletActions: {
              showRecoveryPhrase: (walletId) => {
                // Use getWalletForBackup to get full wallet with mnemonic for recovery UI
                const w = wallet.getWalletForBackup ? wallet.getWalletForBackup(walletId) : wallet.wallets?.find(w => w.id === walletId);
                if (w) setShowRecoveryFor(w);
              }
            }
          }}
          onSave={(updatedWallet) => {
            wallet.updateWallet(updatedWallet.id, { name: updatedWallet.name, avatar: updatedWallet.avatar });
            setEditingWalletId(null);
          }}
          onClose={() => setEditingWalletId(null)}
          onRemove={(walletId) => {
            wallet.removeWallet(walletId);
            setEditingWalletId(null);
          }}
        />
      )}

      {showRecoveryFor && (
        <RecoveryPhrasePanel
          wallet={showRecoveryFor}
          onClose={() => setShowRecoveryFor(null)}
        />
      )}
    </div>
  );
}