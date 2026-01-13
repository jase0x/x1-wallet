/**
 * Production-safe logger utility
 * Only logs in development mode, sanitizes sensitive data
 */

const isDev = typeof process !== 'undefined' 
  ? process.env.NODE_ENV === 'development'
  : (typeof window !== 'undefined' && window.location?.hostname === 'localhost');

// Patterns that indicate sensitive data that should be redacted
const SENSITIVE_PATTERNS = [
  /privateKey/i,
  /private_key/i,
  /secretKey/i,
  /secret_key/i,
  /mnemonic/i,
  /seed/i,
  /password/i,
  /token(?!s?\b)/i,  // 'token' but not 'tokens'
  /apiKey/i,
  /api_key/i,
  /auth/i,
  /credential/i,
  /signature/i,
];

// Keys that should always be redacted from logged objects
const REDACTED_KEYS = new Set([
  'privateKey',
  'private_key', 
  'secretKey',
  'secret_key',
  'mnemonic',
  'seed',
  'password',
  'apiKey',
  'api_key',
  'auth',
  'authorization',
  'credentials',
  'secret',
]);

/**
 * Sanitize a value by redacting sensitive information
 */
function sanitizeValue(value, key = '') {
  if (value === null || value === undefined) {
    return value;
  }

  // Handle Error objects specially - they don't enumerate their properties
  if (value instanceof Error) {
    return {
      message: value.message,
      name: value.name,
      stack: value.stack
    };
  }

  // Check if the key suggests sensitive data
  const keyLower = key.toLowerCase();
  if (REDACTED_KEYS.has(keyLower) || SENSITIVE_PATTERNS.some(p => p.test(key))) {
    return '[REDACTED]';
  }

  // Handle strings that look like keys/secrets (long hex or base58 strings)
  if (typeof value === 'string') {
    // Redact what looks like a private key (64+ hex chars or 88 base58 chars)
    if (/^[0-9a-fA-F]{64,}$/.test(value) || /^[1-9A-HJ-NP-Za-km-z]{87,}$/.test(value)) {
      return '[REDACTED_KEY]';
    }
    // Redact what looks like a mnemonic (12+ lowercase words, no punctuation/brackets)
    // This avoids flagging JSON error responses as mnemonics
    const words = value.split(/\s+/);
    if (words.length >= 12 && words.length <= 24) {
      // Check if all words are lowercase letters only (like BIP39 words)
      const looksLikeMnemonic = words.every(w => /^[a-z]+$/.test(w));
      if (looksLikeMnemonic) {
        return '[REDACTED_MNEMONIC]';
      }
    }
    return value;
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeValue(item, String(index)));
  }

  // Handle objects
  if (typeof value === 'object') {
    const sanitized = {};
    for (const [k, v] of Object.entries(value)) {
      sanitized[k] = sanitizeValue(v, k);
    }
    return sanitized;
  }

  return value;
}

/**
 * Sanitize all arguments for logging
 */
function sanitizeArgs(args) {
  return args.map((arg, index) => {
    if (typeof arg === 'string') {
      return sanitizeValue(arg);
    }
    return sanitizeValue(arg, String(index));
  });
}

/**
 * Logger that only outputs in development mode
 */
export const logger = {
  log(...args) {
    if (isDev) {
      console.log(...sanitizeArgs(args));
    }
  },

  warn(...args) {
    if (isDev) {
      console.warn(...sanitizeArgs(args));
    }
  },

  error(...args) {
    // Errors are always logged but sanitized
    console.error(...sanitizeArgs(args));
  },

  debug(...args) {
    if (isDev) {
      console.debug(...sanitizeArgs(args));
    }
  },

  info(...args) {
    if (isDev) {
      console.info(...sanitizeArgs(args));
    }
  },

  // Force log even in production (use sparingly)
  force(...args) {
    console.log(...sanitizeArgs(args));
  }
};

export default logger;
