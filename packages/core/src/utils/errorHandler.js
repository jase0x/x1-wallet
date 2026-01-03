/**
 * Error handling utilities
 * Provides user-friendly error messages without leaking internal details
 */

// Map of internal error patterns to user-friendly messages
const ERROR_MAPPINGS = [
  // Network errors
  { pattern: /fetch failed|network error|net::ERR/i, message: 'Network connection failed. Please check your internet connection.' },
  { pattern: /timeout|timed out/i, message: 'Request timed out. Please try again.' },
  { pattern: /CORS|cross-origin/i, message: 'Unable to connect to the service. Please try again later.' },
  { pattern: /dns|ENOTFOUND/i, message: 'Unable to reach the server. Please check your connection.' },
  
  // RPC errors
  { pattern: /rpc.*error|jsonrpc/i, message: 'Blockchain network error. Please try again.' },
  { pattern: /rate limit|429|too many requests/i, message: 'Too many requests. Please wait a moment and try again.' },
  { pattern: /blockhash not found|expired/i, message: 'Transaction expired. Please try again.' },
  
  // Transaction errors  
  { pattern: /insufficient.*balance|insufficient.*funds/i, message: 'Insufficient balance for this transaction.' },
  { pattern: /invalid.*signature/i, message: 'Transaction signing failed. Please try again.' },
  { pattern: /simulation failed/i, message: 'Transaction simulation failed. Please check the details and try again.' },
  { pattern: /account.*not found|account does not exist/i, message: 'Account not found. Please verify the address.' },
  
  // Wallet errors
  { pattern: /invalid.*address|invalid.*public.*key/i, message: 'Invalid wallet address format.' },
  { pattern: /invalid.*mnemonic|invalid.*seed/i, message: 'Invalid recovery phrase.' },
  { pattern: /wallet.*locked|unlock.*required/i, message: 'Please unlock your wallet first.' },
  
  // Hardware wallet errors
  { pattern: /ledger.*not.*connected|device.*not.*found/i, message: 'Hardware wallet not connected. Please connect and try again.' },
  { pattern: /user.*rejected|user.*denied|cancelled by user/i, message: 'Action cancelled.' },
  { pattern: /wrong.*app|open.*app/i, message: 'Please open the correct app on your hardware wallet.' },
  { pattern: /locked.*device/i, message: 'Please unlock your hardware wallet.' },
  
  // Swap errors
  { pattern: /slippage|price.*impact/i, message: 'Price changed significantly. Please adjust slippage or try again.' },
  { pattern: /no.*route|route.*not.*found/i, message: 'No swap route available for this pair.' },
  { pattern: /liquidity/i, message: 'Insufficient liquidity for this swap.' },
  
  // Generic errors
  { pattern: /unauthorized|401/i, message: 'Authentication required. Please reconnect.' },
  { pattern: /forbidden|403/i, message: 'Access denied.' },
  { pattern: /not found|404/i, message: 'Resource not found.' },
  { pattern: /internal.*error|500|502|503|504/i, message: 'Service temporarily unavailable. Please try again later.' },
];

/**
 * Get a user-friendly error message from an error object
 * @param {Error|string|unknown} error - The error to sanitize
 * @param {string} fallback - Fallback message if no match found
 * @returns {string} User-friendly error message
 */
export function getUserFriendlyError(error, fallback = 'An unexpected error occurred. Please try again.') {
  // Handle null/undefined
  if (!error) {
    return fallback;
  }

  // Get the error message string
  let errorMessage = '';
  if (typeof error === 'string') {
    errorMessage = error;
  } else if (error instanceof Error) {
    errorMessage = error.message || '';
  } else if (typeof error === 'object') {
    errorMessage = error.message || error.error || error.msg || JSON.stringify(error);
  }

  // Check against known patterns
  for (const { pattern, message } of ERROR_MAPPINGS) {
    if (pattern.test(errorMessage)) {
      return message;
    }
  }

  // For unknown errors, return the fallback
  // Never expose raw error messages to users as they may contain sensitive info
  return fallback;
}

/**
 * Specific error handlers for different contexts
 */
export const ErrorMessages = {
  // Transaction errors
  transaction: {
    failed: 'Transaction failed. Please try again.',
    timeout: 'Transaction timed out. Please check your transaction history.',
    rejected: 'Transaction was rejected.',
    insufficientFunds: 'Insufficient balance for this transaction.',
    invalidRecipient: 'Invalid recipient address.',
    signFailed: 'Failed to sign transaction. Please try again.',
  },
  
  // Wallet errors
  wallet: {
    loadFailed: 'Failed to load wallet. Please try again.',
    createFailed: 'Failed to create wallet. Please try again.',
    importFailed: 'Failed to import wallet. Please check your recovery phrase.',
    notFound: 'Wallet not found.',
    locked: 'Wallet is locked. Please unlock to continue.',
  },
  
  // Network errors
  network: {
    connectionFailed: 'Network connection failed. Please check your internet.',
    rpcError: 'Blockchain network error. Please try again.',
    timeout: 'Request timed out. Please try again.',
  },
  
  // Hardware wallet errors
  hardware: {
    notConnected: 'Hardware wallet not connected.',
    wrongApp: 'Please open the Solana app on your device.',
    locked: 'Please unlock your hardware wallet.',
    rejected: 'Action cancelled on device.',
    connectionFailed: 'Failed to connect to hardware wallet.',
  },
  
  // Swap errors  
  swap: {
    failed: 'Swap failed. Please try again.',
    quoteFailed: 'Failed to get quote. Please try again.',
    noRoute: 'No swap route available.',
    slippage: 'Price changed significantly. Please try again.',
    insufficientLiquidity: 'Insufficient liquidity for this swap.',
  },
  
  // Stake errors
  stake: {
    failed: 'Staking operation failed. Please try again.',
    poolNotFound: 'Staking pool not found.',
    insufficientStake: 'Insufficient stake amount.',
  },
  
  // Generic
  generic: {
    unknown: 'An unexpected error occurred. Please try again.',
    tryAgain: 'Something went wrong. Please try again.',
    serviceUnavailable: 'Service temporarily unavailable.',
  }
};

/**
 * Create a safe error handler that logs the full error internally
 * but returns a sanitized message for the UI
 * @param {string} context - Context for logging (e.g., 'Swap', 'Send')
 * @param {string} fallbackMessage - User-friendly fallback message
 */
export function createErrorHandler(context, fallbackMessage) {
  return (error) => {
    // Log full error in development only
    if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') {
      console.error(`[${context}] Error:`, error);
    }
    
    return getUserFriendlyError(error, fallbackMessage);
  };
}

export default {
  getUserFriendlyError,
  ErrorMessages,
  createErrorHandler,
};
