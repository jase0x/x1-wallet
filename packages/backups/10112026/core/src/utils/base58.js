// Base58 encoding/decoding for Solana/X1 addresses

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function encode(bytes) {
  const digits = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let result = '';
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    result += ALPHABET[0];
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    result += ALPHABET[digits[i]];
  }
  return result;
}

export function decode(str) {
  const bytes = [0];
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    let value = ALPHABET.indexOf(char);
    if (value < 0) throw new Error('Invalid base58 character');
    for (let j = 0; j < bytes.length; j++) {
      value += bytes[j] * 58;
      bytes[j] = value & 0xff;
      value >>= 8;
    }
    while (value > 0) {
      bytes.push(value & 0xff);
      value >>= 8;
    }
  }
  for (let i = 0; i < str.length && str[i] === ALPHABET[0]; i++) {
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

// Basic format validation
export function isValidFormat(str) {
  if (!str || str.length < 32 || str.length > 44) return false;
  for (const char of str) {
    if (ALPHABET.indexOf(char) < 0) return false;
  }
  return true;
}

// Full validation including decoding check
export function isValid(str) {
  if (!isValidFormat(str)) return false;
  
  try {
    // Attempt to decode - this catches invalid base58 sequences
    const decoded = decode(str);
    
    // Solana/X1 public keys should be exactly 32 bytes
    if (decoded.length !== 32) return false;
    
    // Check that the decoded bytes can be re-encoded to the same string
    // This ensures the address is in canonical form
    const reencoded = encode(decoded);
    if (reencoded !== str) return false;
    
    return true;
  } catch (e) {
    return false;
  }
}

// Validate address with detailed error messages
export function validateAddress(str) {
  if (!str) {
    return { valid: false, error: 'Address is required' };
  }
  
  if (typeof str !== 'string') {
    return { valid: false, error: 'Address must be a string' };
  }
  
  str = str.trim();
  
  if (str.length < 32) {
    return { valid: false, error: 'Address is too short' };
  }
  
  if (str.length > 44) {
    return { valid: false, error: 'Address is too long' };
  }
  
  // Check for invalid characters
  for (let i = 0; i < str.length; i++) {
    if (ALPHABET.indexOf(str[i]) < 0) {
      return { valid: false, error: `Invalid character '${str[i]}' at position ${i + 1}` };
    }
  }
  
  try {
    const decoded = decode(str);
    
    if (decoded.length !== 32) {
      return { valid: false, error: 'Invalid address length after decoding' };
    }
    
    // Verify canonical encoding
    const reencoded = encode(decoded);
    if (reencoded !== str) {
      return { valid: false, error: 'Address is not in canonical form' };
    }
    
    return { valid: true, decoded };
  } catch (e) {
    return { valid: false, error: 'Invalid base58 encoding' };
  }
}

// Check if address looks like it could be a typo of another address
// (useful for warning users before sending)
export function isSimilarAddress(addr1, addr2) {
  if (!addr1 || !addr2) return false;
  
  // Count different characters
  let differences = 0;
  const maxLen = Math.max(addr1.length, addr2.length);
  
  for (let i = 0; i < maxLen; i++) {
    if (addr1[i] !== addr2[i]) differences++;
    if (differences > 3) return false; // More than 3 differences = not similar
  }
  
  return differences > 0 && differences <= 3;
}

// Aliases for compatibility
export const encodeBase58 = encode;
export const decodeBase58 = decode;
