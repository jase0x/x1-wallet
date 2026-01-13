// CORE XP Leaderboard API service
import { logger } from '../utils/logger.js';

const API_BASE = 'https://core.xdex.xyz/api';

export async function reportScore(wallet, network, action, amount, txSignature, category = 'wallet') {
  try {
    const response = await fetch(`${API_BASE}/score/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user: wallet,
        network,
        category,
        action,
        amount: parseFloat(amount) || 0,
        transactionSignature: txSignature,
        source: 'wallet'
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      logger.log('✓ CORE XP reported:', action, data);
      return data;
    } else {
      logger.warn('CORE XP report failed:', response.status);
      return null;
    }
  } catch (error) {
    logger.error('CORE XP error:', error);
    return null;
  }
}

// Report send transaction
export async function reportSend(wallet, network, amount, txSignature) {
  return reportScore(wallet, network, 'send', amount, txSignature, 'wallet');
}

// Report swap transaction
export async function reportSwap(wallet, network, amount, txSignature) {
  return reportScore(wallet, network, 'swap', amount, txSignature, 'wallet');
}

// Report bridge transaction (future)
export async function reportBridge(wallet, network, amount, txSignature) {
  return reportScore(wallet, network, 'bridge', amount, txSignature, 'wallet');
}
