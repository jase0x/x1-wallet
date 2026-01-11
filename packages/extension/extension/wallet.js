import { l as logger, v as verifyPassword, h as hashPassword } from "./popup.js";
const AUTH_KEY = "x1wallet_auth";
const RATE_LIMIT_KEY = "x1wallet_rate_limit";
const MAX_ATTEMPTS_BEFORE_DELAY = 3;
const MAX_ATTEMPTS_BEFORE_LOCKOUT = 20;
const LOCKOUT_DURATION_MS = 24 * 60 * 60 * 1e3;
async function hasPassword() {
  try {
    let authData = null;
    if (typeof chrome !== "undefined" && chrome.storage) {
      try {
        const result = await chrome.storage.local.get(AUTH_KEY);
        authData = result[AUTH_KEY];
      } catch (e) {
      }
    }
    if (!authData) {
      authData = localStorage.getItem(AUTH_KEY);
    }
    if (!authData) return false;
    try {
      const parsed = JSON.parse(authData);
      if (parsed && parsed.hash && parsed.salt) {
        return true;
      }
    } catch (e) {
    }
    return false;
  } catch (e) {
    logger.error("[Wallet] Error checking password:", e);
    return false;
  }
}
async function setupPassword(password) {
  const passwordValidation = validatePasswordStrength(password);
  if (!passwordValidation.valid) {
    throw new Error(passwordValidation.error);
  }
  const { hash, salt } = await hashPassword(password);
  const authData = JSON.stringify({ hash, salt });
  localStorage.setItem(AUTH_KEY, authData);
  if (typeof chrome !== "undefined" && chrome.storage) {
    try {
      await chrome.storage.local.set({ [AUTH_KEY]: authData });
    } catch (e) {
    }
  }
}
function validatePasswordStrength(password) {
  if (!password) {
    return { valid: false, error: "Password is required" };
  }
  if (password.length < 12) {
    return { valid: false, error: "Password must be at least 12 characters" };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: "Password must contain at least one lowercase letter" };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: "Password must contain at least one uppercase letter" };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: "Password must contain at least one number" };
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password)) {
    return { valid: false, error: "Password must contain at least one special character" };
  }
  const commonPatterns = ["password", "12345678", "qwerty", "abcdef"];
  const lowerPassword = password.toLowerCase();
  for (const pattern of commonPatterns) {
    if (lowerPassword.includes(pattern)) {
      return { valid: false, error: "Password contains a common weak pattern" };
    }
  }
  return { valid: true };
}
async function checkPassword(password) {
  try {
    const rateLimitStatus = await checkRateLimit();
    if (rateLimitStatus.locked) {
      const remainingTime = Math.ceil((rateLimitStatus.lockoutUntil - Date.now()) / 6e4);
      throw new Error(`Too many failed attempts. Account locked for ${remainingTime} minutes.`);
    }
    let authData;
    if (typeof chrome !== "undefined" && chrome.storage) {
      const result = await chrome.storage.local.get(AUTH_KEY);
      authData = result[AUTH_KEY];
    }
    if (!authData) {
      authData = localStorage.getItem(AUTH_KEY);
    }
    if (!authData) return false;
    const { hash, salt } = JSON.parse(authData);
    const isValid = await verifyPassword(password, hash, salt);
    await updateRateLimit(isValid);
    return isValid;
  } catch (e) {
    if (e.message.includes("Too many failed attempts")) {
      throw e;
    }
    logger.error("Password verification error");
    return false;
  }
}
async function checkRateLimit() {
  try {
    let rateLimitData;
    if (typeof chrome !== "undefined" && chrome.storage) {
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
    if (!validateRateLimitIntegrity(rateLimitData)) {
      logger.warn("X1W-SEC-012: Rate limit data tampering detected, resetting");
      await clearRateLimit();
      return { locked: false, attempts: 0, tamperingDetected: true };
    }
    if (rateLimitData.lockoutUntil && Date.now() < rateLimitData.lockoutUntil) {
      return { locked: true, lockoutUntil: rateLimitData.lockoutUntil, attempts: rateLimitData.attempts };
    }
    if (rateLimitData.lockoutUntil && Date.now() >= rateLimitData.lockoutUntil) {
      await clearRateLimit();
      return { locked: false, attempts: 0 };
    }
    return { locked: false, attempts: rateLimitData.attempts || 0 };
  } catch (e) {
    return { locked: false, attempts: 0 };
  }
}
function computeRateLimitChecksum(data) {
  const str = `${data.attempts}:${data.lastAttempt}:${data.lockoutUntil || 0}:${data.delayUntil || 0}:x1w`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}
function validateRateLimitIntegrity(data) {
  if (!data || !data.checksum) return true;
  return data.checksum === computeRateLimitChecksum(data);
}
async function updateRateLimit(success) {
  if (success) {
    await clearRateLimit();
    return;
  }
  const status = await checkRateLimit();
  const newAttempts = status.attempts + 1;
  let rateLimitData = { attempts: newAttempts, lastAttempt: Date.now() };
  if (newAttempts >= MAX_ATTEMPTS_BEFORE_LOCKOUT) {
    rateLimitData.lockoutUntil = Date.now() + LOCKOUT_DURATION_MS;
    logger.warn("Password attempts exhausted - account locked");
  } else if (newAttempts >= 10) {
    rateLimitData.delayUntil = Date.now() + 3e4;
  } else if (newAttempts >= 5) {
    rateLimitData.delayUntil = Date.now() + 5e3;
  } else if (newAttempts >= MAX_ATTEMPTS_BEFORE_DELAY) {
    rateLimitData.delayUntil = Date.now() + 1e3;
  }
  rateLimitData.checksum = computeRateLimitChecksum(rateLimitData);
  try {
    if (typeof chrome !== "undefined" && chrome.storage) {
      await chrome.storage.local.set({ [RATE_LIMIT_KEY]: rateLimitData });
    } else {
      localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(rateLimitData));
    }
  } catch (e) {
    localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(rateLimitData));
  }
}
async function clearRateLimit() {
  try {
    if (typeof chrome !== "undefined" && chrome.storage) {
      await chrome.storage.local.remove(RATE_LIMIT_KEY);
    }
  } catch (e) {
  }
  localStorage.removeItem(RATE_LIMIT_KEY);
}
export {
  checkPassword,
  hasPassword,
  setupPassword,
  validatePasswordStrength
};
