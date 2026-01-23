// Wallet Encryption Utilities
// Uses AES-GCM with PBKDF2 key derivation for secure storage
// X1W-SEC: Encryption is MANDATORY - plaintext storage is blocked

// X1W-NEW-001 FIX: Increased to OWASP 2024 recommendation (600,000+ for PBKDF2-SHA256)
// Version 2 uses legacy 100k iterations for backward compatibility
// Version 3 uses modern 600k iterations for new wallets
const PBKDF2_ITERATIONS_V2 = 100000;  // Legacy - for decrypting existing wallets
const PBKDF2_ITERATIONS_V3 = 600000;  // Current - OWASP 2024 compliant
const CURRENT_VERSION = 3;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const VERSION_BYTE_LENGTH = 1;

// X1W-SEC: Deterministic prefix for encrypted data - NOT heuristic
const ENCRYPTED_PREFIX = 'X1W:v3:';

async function deriveKey(password, salt, iterations = PBKDF2_ITERATIONS_V3) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptData(plaintext, password) {
  if (!password || password.length < 1) {
    throw new Error('Password is required for encryption');
  }
  
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS_V3);
  
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    data
  );
  
  const encrypted = new Uint8Array(encryptedBuffer);
  // Version 3 format: [version byte][salt][iv][ciphertext]
  const combined = new Uint8Array(VERSION_BYTE_LENGTH + SALT_LENGTH + IV_LENGTH + encrypted.length);
  combined[0] = CURRENT_VERSION; // Version byte
  combined.set(salt, VERSION_BYTE_LENGTH);
  combined.set(iv, VERSION_BYTE_LENGTH + SALT_LENGTH);
  combined.set(encrypted, VERSION_BYTE_LENGTH + SALT_LENGTH + IV_LENGTH);
  
  // Convert to base64 without using spread operator (avoids stack overflow for large data)
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < combined.length; i += chunkSize) {
    const chunk = combined.subarray(i, Math.min(i + chunkSize, combined.length));
    binary += String.fromCharCode.apply(null, chunk);
  }
  // X1W-SEC: Add deterministic prefix for reliable detection
  return ENCRYPTED_PREFIX + btoa(binary);
}

export async function decryptData(encryptedBase64, password) {
  if (!password) throw new Error('Password is required for decryption');
  if (!encryptedBase64) throw new Error('No encrypted data provided');
  
  try {
    // X1W-SEC: Strip prefix if present
    let base64Data = encryptedBase64;
    if (encryptedBase64.startsWith(ENCRYPTED_PREFIX)) {
      base64Data = encryptedBase64.slice(ENCRYPTED_PREFIX.length);
    }
    
    const combined = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    
    // Detect version based on format
    // Version 3: first byte is 3, then salt, iv, ciphertext
    // Version 2 (legacy): no version byte, starts directly with salt
    let salt, iv, encrypted, iterations;
    
    if (combined[0] === 3) {
      // Version 3 format with 600k iterations
      salt = combined.slice(VERSION_BYTE_LENGTH, VERSION_BYTE_LENGTH + SALT_LENGTH);
      iv = combined.slice(VERSION_BYTE_LENGTH + SALT_LENGTH, VERSION_BYTE_LENGTH + SALT_LENGTH + IV_LENGTH);
      encrypted = combined.slice(VERSION_BYTE_LENGTH + SALT_LENGTH + IV_LENGTH);
      iterations = PBKDF2_ITERATIONS_V3;
    } else {
      // Legacy version 2 format with 100k iterations (no version byte)
      salt = combined.slice(0, SALT_LENGTH);
      iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
      encrypted = combined.slice(SALT_LENGTH + IV_LENGTH);
      iterations = PBKDF2_ITERATIONS_V2;
    }
    
    const key = await deriveKey(password, salt, iterations);
    
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encrypted
    );
    
    return new TextDecoder().decode(decryptedBuffer);
  } catch (error) {
    throw new Error('Decryption failed - incorrect password or corrupted data');
  }
}

export async function hashPassword(password, existingSalt = null) {
  const encoder = new TextEncoder();
  const salt = existingSalt || crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  
  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: PBKDF2_ITERATIONS_V3, // Use modern iteration count
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );
  
  // Convert to base64 safely (small arrays, but avoid spread for consistency)
  const hashArray = new Uint8Array(hashBuffer);
  let hashBinary = '';
  for (let i = 0; i < hashArray.length; i++) {
    hashBinary += String.fromCharCode(hashArray[i]);
  }
  let saltBinary = '';
  for (let i = 0; i < salt.length; i++) {
    saltBinary += String.fromCharCode(salt[i]);
  }
  
  return {
    hash: btoa(hashBinary),
    salt: btoa(saltBinary)
  };
}

export async function verifyPassword(password, storedHash, storedSalt) {
  try {
    const salt = Uint8Array.from(atob(storedSalt), c => c.charCodeAt(0));
    const { hash } = await hashPassword(password, salt);
    // X1W-SEC: Constant-time comparison to prevent timing attacks
    if (hash.length !== storedHash.length) return false;
    let result = 0;
    for (let i = 0; i < hash.length; i++) {
      result |= hash.charCodeAt(i) ^ storedHash.charCodeAt(i);
    }
    return result === 0;
  } catch {
    return false;
  }
}

// X1W-SEC: Deterministic check - prefix means definitely encrypted
export function isEncrypted(data) {
  if (!data || typeof data !== 'string') return false;
  
  // Deterministic: has our prefix
  if (data.startsWith(ENCRYPTED_PREFIX)) {
    return true;
  }
  
  // Legacy: try to decode as JSON first
  try {
    JSON.parse(data);
    return false; // Valid JSON = plaintext
  } catch {
    // Not JSON - check if valid base64 with minimum length
    try {
      const decoded = atob(data);
      return decoded.length >= SALT_LENGTH + IV_LENGTH + 16;
    } catch {
      return false;
    }
  }
}

/**
 * X1W-SEC-009 FIX: Securely wipe sensitive data from memory
 * Zeros out Uint8Arrays and attempts to clear strings
 * Note: JavaScript strings are immutable, so we can only encourage GC
 */
export function secureWipe(data) {
  if (!data) return;
  
  if (data instanceof Uint8Array || data instanceof Int8Array) {
    // Zero out typed arrays
    data.fill(0);
  } else if (Array.isArray(data)) {
    // Zero out regular arrays
    for (let i = 0; i < data.length; i++) {
      if (typeof data[i] === 'number') {
        data[i] = 0;
      } else if (data[i] instanceof Uint8Array) {
        data[i].fill(0);
      }
    }
    data.length = 0;
  } else if (typeof data === 'object' && data !== null) {
    // Recursively wipe object properties
    for (const key of Object.keys(data)) {
      if (data[key] instanceof Uint8Array) {
        data[key].fill(0);
      }
      // Set to null to encourage GC
      data[key] = null;
    }
  }
  // For strings, we can't modify them but setting the reference to null helps GC
  return null;
}

/**
 * X1W-SEC-009: Wrapper to run a function and wipe sensitive intermediate data
 */
export async function withSecureCleanup(fn, ...sensitiveRefs) {
  try {
    return await fn();
  } finally {
    // Wipe all sensitive references after function completes
    for (const ref of sensitiveRefs) {
      secureWipe(ref);
    }
  }
}

export default { encryptData, decryptData, hashPassword, verifyPassword, isEncrypted, secureWipe, withSecureCleanup };