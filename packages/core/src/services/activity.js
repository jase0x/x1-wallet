// Activity Service for transaction history
import { logger } from '../utils/logger.js';
// Uses the same X1 Mobile API as the Android app

const API_SERVER = 'https://mobile-api.x1.xyz';

/**
 * Map network name to providerId (same as Android app)
 */
function getProviderId(networkName) {
  switch (networkName) {
    case 'X1 Mainnet':
      return 'X1-mainnet';
    case 'X1 Testnet':
      return 'X1-testnet';
    case 'Solana Mainnet':
      return 'SOLANA-mainnet';
    case 'Solana Devnet':
      return 'SOLANA-devnet';
    default:
      return 'X1-testnet';
  }
}

/**
 * Register wallet with the indexer for transaction tracking
 */
export async function registerWallet(address, networkName) {
  try {
    const providerId = getProviderId(networkName);
    const response = await fetch(`${API_SERVER}/wallets/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        address,
        network: providerId,
      }),
    });
    
    if (!response.ok) {
      logger.warn('Failed to register wallet:', response.status);
      return false;
    }
    
    const data = await response.json();
    logger.log('Wallet registered:', data);
    return true;
  } catch (error) {
    logger.error('Error registering wallet:', error);
    return false;
  }
}

/**
 * Trigger on-demand indexing for a wallet
 */
export async function indexWallet(address, networkName) {
  try {
    const providerId = getProviderId(networkName);
    const response = await fetch(`${API_SERVER}/wallets/index-now`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        address,
        network: providerId,
      }),
    });
    
    if (!response.ok) {
      logger.warn('Failed to index wallet:', response.status);
      return null;
    }
    
    const data = await response.json();
    logger.log('Indexing result:', data);
    return data;
  } catch (error) {
    logger.error('Error indexing wallet:', error);
    return null;
  }
}

/**
 * Fetch transactions for a wallet from the API
 * @param {string} address - Wallet address
 * @param {string} networkName - Network name (e.g., 'X1 Testnet')
 * @param {string} beforeSignature - Optional signature for pagination
 * @returns {Promise<Array>} Array of formatted transactions
 */
export async function fetchTransactions(address, networkName, beforeSignature = null) {
  try {
    const providerId = getProviderId(networkName);
    let url = `${API_SERVER}/transactions/${address}?providerId=${providerId}`;
    
    if (beforeSignature) {
      url += `&before=${beforeSignature}`;
    }
    
    logger.log('[Activity] Fetching transactions from:', url);
    
    // Add timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    
    if (!response.ok) {
      logger.warn('Failed to fetch transactions:', response.status);
      // Try to trigger indexing on failure
      indexWallet(address, networkName).catch(() => {});
      return [];
    }
    
    const data = await response.json();
    
    if (!data || !data.transactions || data.transactions.length === 0) {
      // Trigger indexing in background for next refresh
      logger.log('[Activity] No transactions found, triggering background indexing...');
      indexWallet(address, networkName).catch(() => {});
      return [];
    }
    
    return formatTransactions(data.transactions, networkName);
  } catch (error) {
    if (error.name === 'AbortError') {
      logger.warn('[Activity] API request timeout');
    } else {
      logger.error('Error fetching transactions:', error);
    }
    return [];
  }
}

/**
 * Format raw transaction data for display
 */
function formatTransactions(transactions, networkName) {
  const nativeSymbol = networkName.startsWith('X1') ? 'XNT' : 'SOL';
  
  return transactions.map(tx => {
    // Parse timestamp
    let date;
    if (typeof tx.timestamp === 'string') {
      date = new Date(tx.timestamp);
    } else if (typeof tx.timestamp === 'number') {
      date = new Date(tx.timestamp * 1000);
    } else {
      date = new Date();
    }
    
    // Format timestamp for display
    const timestamp = formatTimestamp(date);
    
    // Parse amount
    const amount = typeof tx.amount === 'string' 
      ? parseFloat(tx.amount) 
      : (tx.amount || 0);
    
    // Determine transaction type
    let type = 'received';
    if (tx.type === 'SEND') {
      type = 'sent';
    } else if (tx.type === 'RECEIVE') {
      type = 'received';
    } else if (tx.type === 'SWAP') {
      type = 'swap';
    }
    
    // Get token info
    const token = tx.tokenSymbol || tx.symbol || nativeSymbol;
    const tokenMint = tx.tokenMint || tx.mint || null;
    const tokenIcon = tx.tokenIcon || null;
    
    return {
      id: tx.hash || tx.signature || `tx-${Date.now()}-${Math.random()}`,
      signature: tx.hash || tx.signature,
      type,
      amount: Math.abs(amount).toFixed(6),
      token,
      tokenMint,
      tokenIcon,
      fee: tx.fee ? parseFloat(tx.fee).toFixed(9) : '0.000005000',
      timestamp,
      rawTimestamp: date.getTime(),
      from: tx.from || tx.source,
      to: tx.to || tx.destination,
    };
  }).sort((a, b) => b.rawTimestamp - a.rawTimestamp); // Sort by newest first
}

/**
 * Format timestamp for display
 */
function formatTimestamp(date) {
  if (!date || isNaN(date.getTime())) {
    return 'Unknown';
  }
  
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) {
    return 'Just now';
  } else if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  }
}

/**
 * Fetch wallet balance and price from API
 */
export async function fetchWalletBalance(address, networkName) {
  try {
    const providerId = getProviderId(networkName);
    const url = `${API_SERVER}/wallet/${address}?providerId=${providerId}`;
    
    logger.log('[Activity] Fetching wallet balance from:', url);
    
    const response = await fetch(url);
    
    if (!response.ok) {
      logger.warn('Failed to fetch wallet balance:', response.status);
      return null;
    }
    
    const data = await response.json();
    
    if (data && data.balance !== undefined) {
      return {
        balance: data.balance,
        balanceUSD: data.balanceUSD || 0,
        price: data.price || 0,
      };
    }
    
    return null;
  } catch (error) {
    logger.error('Error fetching wallet balance:', error);
    return null;
  }
}

export { getProviderId };
