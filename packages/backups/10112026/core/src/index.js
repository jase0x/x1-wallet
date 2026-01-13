// X1 Wallet Core - Shared Logic
// All exports for use in extension and mobile

// Utils
export * from './utils/bip39.js';
export * from './utils/bip44.js';
export * from './utils/crypto.js';
export * from './utils/base58.js';
export * from './utils/transaction.js';
export { logger } from './utils/logger.js';
export { getUserFriendlyError, ErrorMessages, createErrorHandler } from './utils/errorHandler.js';
export { encryptData, decryptData, hashPassword, verifyPassword, isEncrypted } from './utils/encryption.js';

// Services
export * from './services/networks.js';
export * from './services/xdex.js';
export * from './services/tokens.js';
export * from './services/activity.js';
export * from './services/wallet.js';
export * from './services/core.js';
export * from './services/xp.js';

// Hooks
export { useWallet, getNetworkConfig } from './hooks/useWallet.js';
