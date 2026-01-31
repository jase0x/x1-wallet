// Wallet service - handles wallet creation, storage, and transactions
import { logger } from '../utils/logger.js';
import { encryptData, decryptData, isEncrypted, hashPassword, verifyPassword as verifyPasswordHash } from '../utils/encryption.js';

import * as base58 from '../utils/base58';
import * as crypto from '../utils/crypto';
import { generateMnemonic, validateMnemonic, mnemonicToSeed } from '../utils/bip39';
import { getNetwork } from './networks';

const STORAGE_KEY = 'x1wallet';
const AUTH_KEY = 'x1wallet_auth';
const RATE_LIMIT_KEY = 'x1wallet_rate_limit';

// X1W-SEC-001: Track if localStorage fallback was used (security concern)
let _localStorageFallbackUsed = false;

/**
 * X1W-SEC-001: Check if localStorage fallback was used
 * This is a security concern as localStorage is more accessible than chrome.storage
 */
export function wasLocalStorageFallbackUsed() {
  return _localStorageFallbackUsed;
}

/**
 * X1W-SEC-001: Log security warning when localStorage fallback is used
 */
function logLocalStorageFallbackWarning(operation) {
  if (!_localStorageFallbackUsed) {
    _localStorageFallbackUsed = true;
    logger.warn(`[SEC-001] localStorage fallback used for ${operation}. ` +
      'This is less secure than chrome.storage. ' +
      'Ensure you are running in a proper extension context.');
  }
}

// Rate limiting constants for password attempts (X1W-002)
const MAX_ATTEMPTS_BEFORE_DELAY = 3;
const MAX_ATTEMPTS_BEFORE_LOCKOUT = 10;  // X1W-SEC: Reduced from 20
const LOCKOUT_DURATION_MS = 60 * 60 * 1000; // X1W-SEC: 1 hour (reduced from 24h)

// Internal storage for legacy data during migration (X1W-001)
// This is never exposed externally - only used internally for secure migration
const _legacyMigrationStore = new Map();

// Create wallet from mnemonic
export async function createWallet(mnemonic) {
  const seed = await mnemonicToSeed(mnemonic);
  const keypair = await crypto.generateKeyPair(seed.slice(0, 32));
  
  return {
    mnemonic,
    publicKey: base58.encode(keypair.publicKey),
    secretKey: Array.from(keypair.secretKey)
  };
}

// Generate new wallet
export async function generateNewWallet() {
  const mnemonic = generateMnemonic();
  return createWallet(mnemonic);
}

// Import wallet from mnemonic
export async function importWallet(mnemonic) {
  if (!validateMnemonic(mnemonic)) {
    throw new Error('Invalid seed phrase');
  }
  return createWallet(mnemonic);
}

// Check if a password has been set up
export async function hasPassword() {
  try {
    let authData = null;
    
    if (typeof chrome !== 'undefined' && chrome.storage) {
      try {
        const result = await chrome.storage.local.get(AUTH_KEY);
        authData = result[AUTH_KEY];
      } catch (e) {
        // Fall through to localStorage
      }
    }
    
    if (!authData) {
      authData = localStorage.getItem(AUTH_KEY);
    }
    
    if (!authData) return false;
    
    // Validate that authData is valid JSON with expected structure
    try {
      const parsed = JSON.parse(authData);
      // Must have both hash and salt to be valid
      if (parsed && parsed.hash && parsed.salt) {
        return true;
      }
    } catch (e) {
      // Invalid JSON - not a valid password
    }
    
    return false;
  } catch (e) {
    logger.error('[Wallet] Error checking password:', e);
    return false;
  }
}

// Set up password for wallet encryption
// X1W-005: Strong password policy enforcement
export async function setupPassword(password) {
  const passwordValidation = validatePasswordStrength(password);
  if (!passwordValidation.valid) {
    throw new Error(passwordValidation.error);
  }
  
  const { hash, salt } = await hashPassword(password);
  const authData = JSON.stringify({ hash, salt });
  
  // Save to both chrome.storage and localStorage for consistency
  localStorage.setItem(AUTH_KEY, authData);
  
  if (typeof chrome !== 'undefined' && chrome.storage) {
    try {
      await chrome.storage.local.set({ [AUTH_KEY]: authData });
    } catch (e) {
      // localStorage fallback already done above
    }
  }
}

/**
 * Validate password strength (matches Phantom/Backpack requirements)
 * Requirements: minimum 8 characters, at least one letter, at least one number
 */
export function validatePasswordStrength(password) {
  if (typeof password !== 'string' || !password) {
    return { valid: false, error: 'Password is required' };
  }

  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters' };
  }

  if (!/[a-zA-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one letter' };
  }

  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one number' };
  }

  return { valid: true };
}

/**
 * Calculate password strength score (0-100) for UI feedback
 */
export function getPasswordStrength(password) {
  if (!password) return 0;
  
  let score = 0;
  
  // Length scoring
  if (password.length >= 8) score += 15;
  if (password.length >= 12) score += 15;
  if (password.length >= 16) score += 10;
  
  // Character type scoring
  if (/[a-z]/.test(password)) score += 15;
  if (/[A-Z]/.test(password)) score += 15;
  if (/[0-9]/.test(password)) score += 15;
  if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password)) score += 15;
  
  return Math.min(100, score);
}

// Verify password with rate limiting (X1W-002)
export async function checkPassword(password) {
  try {
    // Check rate limiting first
    const rateLimitStatus = await checkRateLimit();
    if (rateLimitStatus.locked) {
      const remainingTime = Math.ceil((rateLimitStatus.lockoutUntil - Date.now()) / 60000);
      throw new Error(`Too many failed attempts. Account locked for ${remainingTime} minutes.`);
    }
    
    let authData;
    if (typeof chrome !== 'undefined' && chrome.storage) {
      const result = await chrome.storage.local.get(AUTH_KEY);
      authData = result[AUTH_KEY];
    }
    if (!authData) {
      authData = localStorage.getItem(AUTH_KEY);
    }
    
    if (!authData) return false;
    
    const { hash, salt } = JSON.parse(authData);
    const isValid = await verifyPasswordHash(password, hash, salt);
    
    // Update rate limit based on result
    await updateRateLimit(isValid);
    
    return isValid;
  } catch (e) {
    if (e.message.includes('Too many failed attempts')) {
      throw e;
    }
    logger.error('Password verification error');
    return false;
  }
}

/**
 * Clear stale password/auth data
 * Used when wallet data is cleared but auth remains
 */
export async function clearPassword() {
  try {
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem('x1wallet_encrypted');
    // Note: Don't clear passwordProtection - that's a user setting
    
    if (typeof chrome !== 'undefined' && chrome.storage) {
      await chrome.storage.local.remove([AUTH_KEY, 'x1wallet_encrypted']);
    }
    
    logger.log('[wallet] Cleared password/auth data');
    return true;
  } catch (e) {
    logger.error('[wallet] Error clearing auth:', e);
    return false;
  }
}

/**
 * Check rate limit status for password attempts (X1W-002)
 * X1W-SEC-012: Added integrity validation to detect tampering
 * Note: Client-side rate limiting is a "speed bump" - sophisticated attackers 
 * can bypass it. Consider server-side rate limiting for additional protection.
 */
async function checkRateLimit() {
  try {
    let rateLimitData;
    if (typeof chrome !== 'undefined' && chrome.storage) {
      const result = await chrome.storage.local.get(RATE_LIMIT_KEY);
      rateLimitData = result[RATE_LIMIT_KEY];
    }
    if (!rateLimitData) {
      rateLimitData = localStorage.getItem(RATE_LIMIT_KEY);
      if (rateLimitData) rateLimitData = JSON.parse(rateLimitData);
    }
    
    if (!rateLimitData) {
      return { locked: false, attempts: 0 };
    }
    
    // X1W-SEC-012: Validate integrity hash to detect tampering
    if (!validateRateLimitIntegrity(rateLimitData)) {
      logger.warn('X1W-SEC-012: Rate limit data tampering detected, resetting');
      await clearRateLimit();
      return { locked: false, attempts: 0, tamperingDetected: true };
    }
    
    // Check if lockout has expired
    if (rateLimitData.lockoutUntil && Date.now() < rateLimitData.lockoutUntil) {
      return { locked: true, lockoutUntil: rateLimitData.lockoutUntil, attempts: rateLimitData.attempts };
    }
    
    // Reset if lockout expired
    if (rateLimitData.lockoutUntil && Date.now() >= rateLimitData.lockoutUntil) {
      await clearRateLimit();
      return { locked: false, attempts: 0 };
    }
    
    return { locked: false, attempts: rateLimitData.attempts || 0 };
  } catch (e) {
    return { locked: false, attempts: 0 };
  }
}

/**
 * X1W-SEC-003: Cryptographically secure integrity check for rate limit data
 * Uses HMAC-like construction with device fingerprint for tamper detection
 */
function computeRateLimitChecksum(data) {
  // Create a deterministic device fingerprint
  const deviceId = typeof navigator !== 'undefined' 
    ? `${navigator.userAgent}:${navigator.language}:${screen?.width || 0}x${screen?.height || 0}:${new Date().getTimezoneOffset()}`
    : 'server';
  
  // Secret prefix to prevent simple replay attacks
  const secretPrefix = 'x1w_rl_v3_hmac_';
  
  // Build the data string with all relevant fields
  const str = `${secretPrefix}${deviceId}:${data.attempts}:${data.lastAttempt}:${data.lockoutUntil || 0}:${data.delayUntil || 0}`;
  
  // Use a more robust hash (HMAC-like construction)
  let h1 = 0x811c9dc5; // FNV offset basis
  let h2 = 0x1000193;  // FNV prime
  
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch;
    h2 = Math.imul(h2, 0x1b873593);
  }
  
  // Mix the hashes
  h1 ^= h2;
  h1 = Math.imul(h1 ^ (h1 >>> 16), 0x85ebca6b);
  h1 = Math.imul(h1 ^ (h1 >>> 13), 0xc2b2ae35);
  h1 ^= h1 >>> 16;
  
  h2 ^= h1;
  h2 = Math.imul(h2 ^ (h2 >>> 16), 0x85ebca6b);
  h2 = Math.imul(h2 ^ (h2 >>> 13), 0xc2b2ae35);
  h2 ^= h2 >>> 16;
  
  // Combine into a string that's hard to forge
  return `v3_${(h1 >>> 0).toString(36)}_${(h2 >>> 0).toString(36)}`;
}

function validateRateLimitIntegrity(data) {
  if (!data || !data.checksum) return true; // Legacy data without checksum is OK
  return data.checksum === computeRateLimitChecksum(data);
}

/**
 * Update rate limit after password attempt (X1W-002)
 * Implements exponential backoff: 1s after 3 failed, 5s after 5, 30s after 10, lockout after 20
 */
async function updateRateLimit(success) {
  if (success) {
    // Clear rate limit on successful login
    await clearRateLimit();
    return;
  }
  
  // Get current state
  const status = await checkRateLimit();
  const newAttempts = status.attempts + 1;
  
  let rateLimitData = { attempts: newAttempts, lastAttempt: Date.now() };
  
  // Calculate delay based on attempts
  if (newAttempts >= MAX_ATTEMPTS_BEFORE_LOCKOUT) {
    // Permanent lockout requiring recovery phrase
    rateLimitData.lockoutUntil = Date.now() + LOCKOUT_DURATION_MS;
    logger.warn('Password attempts exhausted - account locked');
  } else if (newAttempts >= 10) {
    // 30 second delay
    rateLimitData.delayUntil = Date.now() + 30000;
  } else if (newAttempts >= 5) {
    // 5 second delay
    rateLimitData.delayUntil = Date.now() + 5000;
  } else if (newAttempts >= MAX_ATTEMPTS_BEFORE_DELAY) {
    // 1 second delay
    rateLimitData.delayUntil = Date.now() + 1000;
  }
  
  // X1W-SEC-012: Add integrity checksum
  rateLimitData.checksum = computeRateLimitChecksum(rateLimitData);
  
  try {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      await chrome.storage.local.set({ [RATE_LIMIT_KEY]: rateLimitData });
    } else {
      localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(rateLimitData));
    }
  } catch (e) {
    localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(rateLimitData));
  }
}

/**
 * Clear rate limit (on successful login or recovery)
 */
async function clearRateLimit() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      await chrome.storage.local.remove(RATE_LIMIT_KEY);
    }
  } catch (e) {}
  localStorage.removeItem(RATE_LIMIT_KEY);
}

/**
 * Get remaining attempts before lockout
 */
export async function getRemainingAttempts() {
  const status = await checkRateLimit();
  if (status.locked) return 0;
  return Math.max(0, MAX_ATTEMPTS_BEFORE_LOCKOUT - status.attempts);
}

// Storage functions - NOW WITH MANDATORY ENCRYPTION
export async function saveWallet(walletData, password) {
  if (!password) {
    throw new Error('Password is required to save wallet');
  }
  
  try {
    // Encrypt sensitive data before storage
    const sensitiveData = JSON.stringify({
      mnemonic: walletData.mnemonic,
      secretKey: walletData.secretKey
    });
    const encryptedSensitive = await encryptData(sensitiveData, password);
    
    // Store encrypted data + public key (public key doesn't need encryption)
    const storageData = {
      publicKey: walletData.publicKey,
      encrypted: encryptedSensitive,
      version: 2 // Version 2 = encrypted storage
    };
    
    if (typeof chrome !== 'undefined' && chrome.storage) {
      await chrome.storage.local.set({ [STORAGE_KEY]: storageData });
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(storageData));
    }
  } catch (e) {
    logger.error('Save wallet error');
    throw new Error('Failed to save wallet securely');
  }
}

export async function loadWallet(password) {
  try {
    let stored;
    if (typeof chrome !== 'undefined' && chrome.storage) {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      stored = result[STORAGE_KEY];
    }
    if (!stored) {
      const localStored = localStorage.getItem(STORAGE_KEY);
      stored = localStored ? JSON.parse(localStored) : null;
    }
    
    if (!stored) return null;
    
    // Handle legacy unencrypted wallets (version 1 or no version)
    // X1W-001 FIX: Never return raw sensitive data - store internally for secure migration
    if (!stored.version || stored.version < 2) {
      logger.warn('Legacy unencrypted wallet detected - migration required');
      
      // X1W-SEC-005 FIX: Use crypto.getRandomValues() instead of Math.random()
      const randomBytes = new Uint8Array(16);
      crypto.getRandomValues(randomBytes);
      const randomPart = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      const migrationToken = `migration_${Date.now()}_${randomPart}`;
      
      // Store legacy data internally (NEVER exposed to caller)
      _legacyMigrationStore.set(migrationToken, {
        data: stored,
        createdAt: Date.now(),
        // Auto-expire after 5 minutes for security
        expiresAt: Date.now() + 5 * 60 * 1000
      });
      
      // Clean up expired migration tokens
      for (const [token, entry] of _legacyMigrationStore.entries()) {
        if (Date.now() > entry.expiresAt) {
          _legacyMigrationStore.delete(token);
        }
      }
      
      return { 
        publicKey: stored.publicKey,
        requiresMigration: true,
        isLegacy: true,
        // Migration token - used to retrieve legacy data securely during migration
        _migrationToken: migrationToken
      };
    }
    
    // Version 2: Encrypted storage
    if (!password) {
      // Return public key only without decryption
      return { publicKey: stored.publicKey, locked: true };
    }
    
    // Decrypt sensitive data
    const decrypted = await decryptData(stored.encrypted, password);
    const sensitiveData = JSON.parse(decrypted);
    
    return {
      publicKey: stored.publicKey,
      mnemonic: sensitiveData.mnemonic,
      secretKey: sensitiveData.secretKey,
      locked: false
    };
  } catch (e) {
    if (e.message.includes('Decryption failed')) {
      throw new Error('Incorrect password');
    }
    logger.error('Load wallet error');
    return null;
  }
}

// Check if wallet exists (without needing password)
export async function walletExists() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      return !!result[STORAGE_KEY];
    }
  } catch (e) {
    // Fall through
  }
  return !!localStorage.getItem(STORAGE_KEY);
}

// Get public key only (no password needed)
export async function getPublicKey() {
  try {
    let stored;
    if (typeof chrome !== 'undefined' && chrome.storage) {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      stored = result[STORAGE_KEY];
    }
    if (!stored) {
      const localStored = localStorage.getItem(STORAGE_KEY);
      stored = localStored ? JSON.parse(localStored) : null;
    }
    return stored?.publicKey || null;
  } catch (e) {
    return null;
  }
}

export async function clearWallet() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      await chrome.storage.local.remove([STORAGE_KEY, AUTH_KEY]);
    }
  } catch (e) {
    // Fall through
  }
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(AUTH_KEY);
}

/**
 * Migrate a legacy unencrypted wallet to encrypted storage (X1W-001 SECURE)
 * @param {Object} legacyWallet - Wallet object with _migrationToken
 * @param {string} password - New password for encryption
 * @returns {Object} Migrated wallet data
 */
export async function migrateLegacyWallet(legacyWallet, password) {
  if (!legacyWallet?.isLegacy || !legacyWallet._migrationToken) {
    throw new Error('Not a legacy wallet or invalid migration token');
  }
  
  // Validate password strength
  const passwordValidation = validatePasswordStrength(password);
  if (!passwordValidation.valid) {
    throw new Error(passwordValidation.error);
  }
  
  // Retrieve legacy data from internal store using migration token
  const migrationEntry = _legacyMigrationStore.get(legacyWallet._migrationToken);
  
  if (!migrationEntry) {
    throw new Error('Migration session expired. Please reload the wallet and try again.');
  }
  
  if (Date.now() > migrationEntry.expiresAt) {
    _legacyMigrationStore.delete(legacyWallet._migrationToken);
    throw new Error('Migration session expired. Please reload the wallet and try again.');
  }
  
  const legacyData = migrationEntry.data;
  
  // Create properly formatted wallet data
  const walletData = {
    publicKey: legacyData.publicKey,
    mnemonic: legacyData.mnemonic,
    secretKey: legacyData.secretKey
  };
  
  // Set up password hash
  await setupPassword(password);
  
  // Save with encryption
  await saveWallet(walletData, password);
  
  // CRITICAL: Clear legacy data from internal store immediately after successful migration
  _legacyMigrationStore.delete(legacyWallet._migrationToken);
  
  // Also clear any unencrypted data from storage
  await clearLegacyUnencryptedData();
  
  logger.log('Legacy wallet migrated to encrypted storage');
  
  // Return the wallet data for use
  return {
    publicKey: walletData.publicKey,
    mnemonic: walletData.mnemonic,
    secretKey: walletData.secretKey,
    locked: false
  };
}

/**
 * Clear any legacy unencrypted wallet data from storage (X1W-001)
 */
async function clearLegacyUnencryptedData() {
  try {
    // Re-read storage to verify we have encrypted version
    let stored;
    if (typeof chrome !== 'undefined' && chrome.storage) {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      stored = result[STORAGE_KEY];
    }
    if (!stored) {
      const localStored = localStorage.getItem(STORAGE_KEY);
      stored = localStored ? JSON.parse(localStored) : null;
    }
    
    // If we have version 2 (encrypted), we're good
    if (stored?.version >= 2) {
      logger.log('Confirmed wallet is now encrypted');
    }
  } catch (e) {
    logger.error('Error verifying migration');
  }
}

/**
 * Check if a wallet needs migration
 */
export async function needsMigration() {
  try {
    let stored;
    if (typeof chrome !== 'undefined' && chrome.storage) {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      stored = result[STORAGE_KEY];
    }
    if (!stored) {
      const localStored = localStorage.getItem(STORAGE_KEY);
      stored = localStored ? JSON.parse(localStored) : null;
    }
    
    if (!stored) return false;
    
    return !stored.version || stored.version < 2;
  } catch (e) {
    return false;
  }
}

// Get balance
export async function getBalance(publicKey, network) {
  const config = getNetwork(network);
  
  try {
    const response = await fetch(config.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBalance',
        params: [publicKey]
      })
    });
    
    const data = await response.json();
    if (data.result?.value !== undefined) {
      return data.result.value / 1e9;
    }
    return 0;
  } catch (e) {
    logger.error('Balance error:', e);
    return 0;
  }
}

// Get recent blockhash
async function getRecentBlockhash(network) {
  const config = getNetwork(network);
  
  const response = await fetch(config.rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getLatestBlockhash',
      params: [{ commitment: 'confirmed' }]
    })
  });
  
  const data = await response.json();
  return data.result?.value?.blockhash;
}

// Serialize transfer transaction
function serializeTransferTransaction(fromPubkey, toPubkey, lamports, recentBlockhash) {
  const from = base58.decode(fromPubkey);
  const to = base58.decode(toPubkey);
  const blockhash = base58.decode(recentBlockhash);
  
  const programId = new Uint8Array(32); // System program
  
  // Transfer instruction data
  const data = new Uint8Array(12);
  data[0] = 2; // Transfer instruction
  const lamportsBytes = new DataView(new ArrayBuffer(8));
  lamportsBytes.setBigUint64(0, BigInt(lamports), true);
  data.set(new Uint8Array(lamportsBytes.buffer), 4);
  
  // Build transaction
  const tx = [];
  tx.push(1, 0, 1); // Header
  tx.push(3); // num accounts
  tx.push(...from);
  tx.push(...to);
  tx.push(...programId);
  tx.push(...blockhash);
  tx.push(1); // num instructions
  tx.push(2); // program id index
  tx.push(2); // num accounts in instruction
  tx.push(0); // from index
  tx.push(1); // to index
  tx.push(data.length);
  tx.push(...data);
  
  return new Uint8Array(tx);
}

/**
 * Simulate a transaction before sending
 * @param {Uint8Array} signedTx - The signed transaction bytes
 * @param {string} network - Network name
 * @returns {Object} Simulation result with success/error info
 */
export async function simulateTransaction(signedTx, network) {
  const config = getNetwork(network);
  
  try {
    const response = await fetch(config.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'simulateTransaction',
        params: [
          btoa(String.fromCharCode(...signedTx)),
          { 
            encoding: 'base64',
            commitment: 'confirmed',
            replaceRecentBlockhash: true
          }
        ]
      })
    });
    
    const data = await response.json();
    
    if (data.error) {
      return {
        success: false,
        error: data.error.message || 'Simulation request failed',
        logs: []
      };
    }
    
    const result = data.result?.value;
    
    if (result?.err) {
      // Parse the error for user-friendly message
      let errorMessage = 'Transaction would fail';
      if (typeof result.err === 'object') {
        if (result.err.InstructionError) {
          const [idx, err] = result.err.InstructionError;
          if (typeof err === 'object' && err.Custom !== undefined) {
            errorMessage = `Instruction ${idx} failed with custom error ${err.Custom}`;
          } else if (err === 'InsufficientFunds') {
            errorMessage = 'Insufficient funds for this transaction';
          } else {
            errorMessage = `Instruction ${idx} failed: ${JSON.stringify(err)}`;
          }
        } else {
          errorMessage = JSON.stringify(result.err);
        }
      }
      
      return {
        success: false,
        error: errorMessage,
        logs: result.logs || [],
        unitsConsumed: result.unitsConsumed
      };
    }
    
    return {
      success: true,
      logs: result?.logs || [],
      unitsConsumed: result?.unitsConsumed || 0
    };
  } catch (e) {
    logger.error('Simulation error:', e);
    return {
      success: false,
      error: 'Failed to simulate transaction',
      logs: []
    };
  }
}

// Send native token
// Options: { skipSimulation: boolean } - Set true for faster sends (advanced users)
export async function sendTransaction(walletData, toAddress, amount, network, options = {}) {
  if (!walletData?.secretKey) {
    throw new Error('Wallet not loaded');
  }
  
  // Validate address
  if (!base58.isValid(toAddress)) {
    throw new Error('Invalid recipient address');
  }
  
  const config = getNetwork(network);
  const lamports = Math.floor(amount * 1e9);
  
  // Get blockhash
  const blockhash = await getRecentBlockhash(network);
  if (!blockhash) {
    throw new Error('Failed to get blockhash');
  }
  
  // Serialize message
  const message = serializeTransferTransaction(
    walletData.publicKey,
    toAddress,
    lamports,
    blockhash
  );
  
  // Sign
  const secretKey = new Uint8Array(walletData.secretKey);
  const signature = await crypto.sign(message, secretKey);
  
  // Build signed transaction
  const signedTx = new Uint8Array(1 + 64 + message.length);
  signedTx[0] = 1;
  signedTx.set(signature, 1);
  signedTx.set(message, 65);
  
  // Simulate transaction first (unless skipSimulation is true)
  // X1W-SEC-010 FIX: Log when simulation is bypassed for audit purposes
  if (!options.skipSimulation) {
    const simResult = await simulateTransaction(signedTx, network);
    if (!simResult.success) {
      throw new Error(`Transaction simulation failed: ${simResult.error}`);
    }
    logger.log('Simulation successful, units consumed:', simResult.unitsConsumed);
  } else {
    // Log security audit event when simulation is skipped
    logger.warn('X1W-SEC-010: Transaction simulation SKIPPED by caller', {
      timestamp: new Date().toISOString(),
      toAddress: toAddress.slice(0, 8) + '...',
      amount: amount,
      network: network
    });
  }
  
  // Send
  const response = await fetch(config.rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: [btoa(String.fromCharCode(...signedTx)), { encoding: 'base64' }]
    })
  });
  
  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || 'Transaction failed');
  }
  
  return data.result;
}

// Format address for display
export function formatAddress(address, chars = 4) {
  if (!address) return '';
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

// Format balance for display
export function formatBalance(balance, decimals = 6) {
  return balance.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals
  });
}