/**
 * XP/Score tracking service for X1 CORE
 * Tracks user actions and awards XP through the CORE API
 */

import { logger } from "../utils/logger.js";

const CORE_API = "https://core.x1.xyz/api";

/**
 * Add XP for a user action
 * @param {Object} params - XP parameters
 * @param {string} params.user - User's wallet address
 * @param {string} params.network - Network name (e.g., "X1 Testnet", "X1 Mainnet")
 * @param {string} params.category - Action category (e.g., "swap", "send", "stake")
 * @param {string} params.action - Specific action (e.g., "swap", "transfer", "stake")
 * @param {string} params.transactionSignature - Transaction signature
 * @param {Object} params.data - Action-specific data
 * @param {string} params.source - Source identifier (default: "wallet")
 * @returns {Promise<Object>} API response
 */
export async function addXP({
  user,
  network,
  category,
  action,
  transactionSignature,
  data = {},
  source = "wallet",
}) {
  if (!user || !network || !category || !action || !transactionSignature) {
    logger.warn("[XP] Missing required parameters for XP tracking");
    return null;
  }

  const payload = {
    user,
    network,
    category,
    action,
    transactionSignature,
    data,
    source,
  };

  logger.log("[XP] Submitting score for:", category);

  try {
    const response = await fetch(`${CORE_API}/score/add`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok) {
      logger.error("[XP] API error");
      return { success: false, error: "XP tracking failed" };
    }

    logger.log("[XP] Score added successfully");
    return { success: true, data: result };
  } catch (error) {
    logger.error("[XP] Failed to add score");
    return { success: false, error: "XP tracking failed" };
  }
}

/**
 * Track a swap action for XP
 */
export async function trackSwapXP({
  user,
  network,
  transactionSignature,
  inputMint,
  outputMint,
  inputAmount,
  outputAmount,
}) {
  return addXP({
    user,
    network,
    category: "swap",
    action: "swap",
    transactionSignature,
    data: {
      inputMint,
      outputMint,
      inputAmount,
      outputAmount,
    },
  });
}

/**
 * Track a send/transfer action for XP
 */
export async function trackSendXP({
  user,
  network,
  transactionSignature,
  mint,
  amount,
  recipient,
}) {
  return addXP({
    user,
    network,
    category: "send",
    action: "transfer",
    transactionSignature,
    data: {
      mint,
      amount,
      recipient,
    },
  });
}

/**
 * Track wallet connection for XP
 */
export async function trackConnectXP({ user, network, dapp }) {
  return addXP({
    user,
    network,
    category: "connect",
    action: "connect",
    transactionSignature: `connect_${Date.now()}`,
    data: {
      dapp,
    },
    source: "wallet",
  });
}

/**
 * Track a stake/unstake action for XP
 */
export async function trackStakeXP({
  user,
  network,
  transactionSignature,
  amount,
  stakePool,
  action = "stake", // "stake" or "unstake"
}) {
  return addXP({
    user,
    network,
    category: "stake",
    action: action,
    transactionSignature,
    data: {
      amount,
      stakePool,
    },
  });
}

/**
 * Get XP balance for a user
 * @param {string} walletAddress - User's wallet address
 * @param {string} network - Network name (default: "X1 Mainnet")
 * @returns {Promise<Object>} XP balance data with totalScore, totalCurrentScore, totalClaimedScore
 */
export async function getXPBalance(walletAddress, network = "X1 Mainnet") {
  if (!walletAddress) {
    return { 
      success: false, 
      totalScore: 0, 
      totalCurrentScore: 0, 
      totalClaimedScore: 0 
    };
  }

  try {
    const params = new URLSearchParams({
      user: walletAddress,
      network: network
    });
    
    const response = await fetch(`${CORE_API}/score?${params.toString()}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return { 
        success: false, 
        totalScore: 0, 
        totalCurrentScore: 0, 
        totalClaimedScore: 0 
      };
    }

    const result = await response.json();
    
    if (result.success && result.data) {
      return {
        success: true,
        totalScore: result.data.totalScore || 0,
        totalCurrentScore: result.data.totalCurrentScore || 0,
        totalClaimedScore: result.data.totalClaimedScore || 0,
        network: result.data.network,
        user: result.data.user
      };
    }
    
    return { 
      success: false, 
      totalScore: 0, 
      totalCurrentScore: 0, 
      totalClaimedScore: 0 
    };
  } catch (error) {
    logger.error("[XP] Failed to fetch balance:", error);
    return { 
      success: false, 
      totalScore: 0, 
      totalCurrentScore: 0, 
      totalClaimedScore: 0 
    };
  }
}

export default {
  addXP,
  trackSwapXP,
  trackSendXP,
  trackConnectXP,
  trackStakeXP,
  getXPBalance,
};