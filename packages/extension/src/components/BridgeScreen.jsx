// Bridge Screen - USDC ↔ USDC.X Cross-chain Warp Bridge
import { logger, getUserFriendlyError, ErrorMessages } from '@x1-wallet/core';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getTxExplorerUrl } from '@x1-wallet/core/services/networks';
import { hardwareWallet } from '../services/hardware';

// Bridge API Configuration - try multiple URLs
const BRIDGE_API_URLS = [
  'https://bridge-api.x1.xyz',
  'https://app.bridge.x1.xyz/api',
  'https://app.bridge.x1.xyz',
];
const SOLANA_RPC_URL = 'https://jessamine-463apc-fast-mainnet.helius-rpc.com';
const X1_RPC_URL = 'https://rpc.mainnet.x1.xyz';

// Helper to fetch from bridge API with fallback URLs
async function fetchBridgeAPI(path) {
  let lastError;
  for (const baseUrl of BRIDGE_API_URLS) {
    try {
      const url = `${baseUrl}${path}`;
      const res = await fetch(url);
      if (res.ok) {
        console.log('[Bridge] API success from:', baseUrl);
        return res;
      }
      lastError = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('All bridge API URLs failed');
}

// Warp Bridge Program ID (deployed on both Solana and X1)
const WARP_BRIDGE_PROGRAM_ID = '6JbPTuxVuoTgyQeXFb9MH8C8nUY8NBbLP1Lu4B13JfMD';

// bridge_out instruction discriminator from IDL
const BRIDGE_OUT_DISCRIMINATOR = new Uint8Array([27, 194, 57, 119, 215, 165, 247, 150]);

// Token mints
const USDC_SOLANA_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDCX_X1_MINT = 'B69chRzqzDCmdB5WYB8NRu5Yv5ZA95ABiZcdzCgGm9Tq';
const USDC_DECIMALS = 6;

// Token Program IDs
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';

// Chain IDs for seq encoding
const CHAIN_SOLANA = 0;
const CHAIN_X1 = 1;

// Logo URLs
const USDC_LOGO = 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png';
const X1_LOGO_URL = '/icons/48-x1.png';
const SOLANA_LOGO_URL = '/icons/48-sol.png';
const USDCX_LOGO_URL = '/icons/48-usdcx.png';

// Base58 alphabet and helper functions
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// Decode base58 to bytes
function decodeBase58Local(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const value = BASE58_ALPHABET.indexOf(char);
    if (value === -1) throw new Error(`Invalid base58 character: ${char}`);
    
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  
  // Add leading zeros
  for (let i = 0; i < str.length && str[i] === '1'; i++) {
    bytes.push(0);
  }
  
  return new Uint8Array(bytes.reverse());
}

// Decode base58 to fixed-size byte array with padding
function decodeToFixedSize(base58Str, size) {
  const decoded = decodeBase58Local(base58Str);
  if (decoded.length === size) {
    return decoded;
  }
  // Pad with leading zeros if too short
  if (decoded.length < size) {
    const padded = new Uint8Array(size);
    padded.set(decoded, size - decoded.length);
    return padded;
  }
  // Truncate if too long (shouldn't happen with valid data)
  return decoded.slice(0, size);
}

// SHA-256 hash
async function sha256(data) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hashBuffer);
}

// --- Ed25519 on-curve check for PDA derivation ---
// We need to check if a 32-byte hash is a valid ed25519 point.
// If it IS on curve, we skip that bump. PDAs must be OFF curve.
// This implements the minimal ed25519 point decompression check.

// Ed25519 field prime: p = 2^255 - 19
const ED25519_P = 2n ** 255n - 19n;

function mod(a, m) {
  return ((a % m) + m) % m;
}

function modInverse(a, m) {
  a = mod(a, m);
  let [old_r, r] = [a, m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  return mod(old_s, m);
}

function modPow(base, exp, m) {
  base = mod(base, m);
  let result = 1n;
  while (exp > 0n) {
    if (exp & 1n) result = result * base % m;
    base = base * base % m;
    exp >>= 1n;
  }
  return result;
}

// d constant: -121665/121666 mod p (computed after helper functions are defined)
const ED25519_D = mod(-121665n * modInverse(121666n, ED25519_P), ED25519_P);

// Check if 32 bytes represent a valid ed25519 curve point
function isOnCurve(bytes) {
  // Decode y-coordinate (little-endian, high bit is sign of x)
  const byteCopy = new Uint8Array(bytes);
  const sign = (byteCopy[31] >> 7) & 1;
  byteCopy[31] &= 0x7f; // Clear sign bit
  
  let y = 0n;
  for (let i = 0; i < 32; i++) {
    y |= BigInt(byteCopy[i]) << BigInt(i * 8);
  }
  
  if (y >= ED25519_P) return false;
  
  // Curve equation: -x^2 + y^2 = 1 + d*x^2*y^2
  // Solve for x^2: x^2 = (y^2 - 1) / (d*y^2 + 1)
  const y2 = y * y % ED25519_P;
  const numerator = mod(y2 - 1n, ED25519_P);
  const denominator = mod(ED25519_D * y2 + 1n, ED25519_P);
  
  if (denominator === 0n) return false;
  
  const x2 = numerator * modInverse(denominator, ED25519_P) % ED25519_P;
  
  if (x2 === 0n) {
    return sign === 0; // x=0 is valid only with positive sign
  }
  
  // Check if x2 is a quadratic residue (has a square root mod p)
  // Euler's criterion: x2^((p-1)/2) ≡ 1 (mod p) iff x2 is a QR
  const euler = modPow(x2, (ED25519_P - 1n) / 2n, ED25519_P);
  return euler === 1n;
}

// Find PDA (Program Derived Address) - proper implementation with on-curve check
async function findProgramAddress(seeds, programId) {
  const programBytes = typeof programId === 'string' ? decodeToFixedSize(programId, 32) : programId;
  const pda_marker = new TextEncoder().encode('ProgramDerivedAddress');
  
  for (let bump = 255; bump >= 0; bump--) {
    // Concatenate: seeds + [bump] + programId + "ProgramDerivedAddress"
    let totalLen = 0;
    for (const seed of seeds) totalLen += seed.length;
    totalLen += 1 + 32 + pda_marker.length;
    
    const buffer = new Uint8Array(totalLen);
    let offset = 0;
    for (const seed of seeds) {
      buffer.set(seed, offset);
      offset += seed.length;
    }
    buffer[offset++] = bump;
    buffer.set(programBytes, offset);
    offset += 32;
    buffer.set(pda_marker, offset);
    
    const hash = await sha256(buffer);
    
    // PDA must NOT be on the ed25519 curve
    if (!isOnCurve(hash)) {
      return { address: hash, bump };
    }
  }
  throw new Error('Could not find PDA');
}

// Find Associated Token Address
async function findAssociatedTokenAddress(wallet, mint, tokenProgram) {
  const walletBytes = typeof wallet === 'string' ? decodeToFixedSize(wallet, 32) : wallet;
  const mintBytes = typeof mint === 'string' ? decodeToFixedSize(mint, 32) : mint;
  const tokenProgramBytes = typeof tokenProgram === 'string' ? decodeToFixedSize(tokenProgram, 32) : tokenProgram;
  
  const seeds = [walletBytes, tokenProgramBytes, mintBytes];
  const { address } = await findProgramAddress(seeds, ASSOCIATED_TOKEN_PROGRAM_ID);
  return address;
}

// Encode seq with chain discriminator
// Format: [chain_pair (8 bits)][slot * 1000 + ix_index (56 bits)]
function encodeSeq(slot, ixIndex, sourceChain, destChain) {
  const chainPair = BigInt((sourceChain << 4) | destChain);
  const baseSeq = BigInt(slot) * 1000n + BigInt(ixIndex);
  const CHAIN_PAIR_SHIFT = 56n;
  return (chainPair << CHAIN_PAIR_SHIFT) | baseSeq;
}

// Write u64 as little-endian bytes
function writeU64LE(value) {
  const bytes = new Uint8Array(8);
  let v = BigInt(value);
  for (let i = 0; i < 8; i++) {
    bytes[i] = Number(v & 0xFFn);
    v >>= 8n;
  }
  return bytes;
}

// Encode base58 from bytes
function encodeBase58Local(bytes) {
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
  // Leading zeros
  let result = '';
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    result += '1';
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]];
  }
  return result;
}

// Solana Logo Component - using proper image
function SolanaLogo({ size = 24 }) {
  const [error, setError] = useState(false);
  const logoSize = Math.round(size * 0.5);
  
  if (error) {
    // Fallback to gradient SVG
    return (
      <div style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #9945FF 0%, #14F195 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0
      }}>
        <svg width={logoSize * 0.7} height={logoSize * 0.7} viewBox="0 0 397 311" fill="white">
          <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z"/>
          <path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z"/>
          <path d="M332.6 120.8c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z"/>
        </svg>
      </div>
    );
  }
  
  return (
    <div style={{
      width: size,
      height: size,
      minWidth: size,
      minHeight: size,
      borderRadius: '50%',
      background: '#000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }}>
      <img 
        src={SOLANA_LOGO_URL}
        alt="Solana"
        style={{
          width: logoSize,
          height: logoSize,
          objectFit: 'contain',
          display: 'block'
        }}
        onError={() => setError(true)}
      />
    </div>
  );
}

// X1 Logo Component - Smaller size for inline use
function X1LogoSmall({ size = 20 }) {
  const [error, setError] = useState(false);
  const logoSize = Math.round(size * 0.85); // 85% of container to match X1Logo
  
  if (error) {
    return (
      <div style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        borderRadius: '50%',
        background: '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        fontSize: size * 0.35,
        fontWeight: 700,
        flexShrink: 0
      }}>X1</div>
    );
  }
  
  return (
    <div style={{
      width: size,
      height: size,
      minWidth: size,
      minHeight: size,
      borderRadius: '50%',
      background: '#000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      overflow: 'hidden'
    }}>
      <img 
        src={X1_LOGO_URL}
        alt="X1"
        width={logoSize}
        height={logoSize}
        style={{ objectFit: 'contain' }}
        onError={() => setError(true)}
      />
    </div>
  );
}

// USDC Logo with fallback
function UsdcLogo({ size = 24 }) {
  const [hasError, setHasError] = useState(false);
  
  if (hasError) {
    return (
      <div style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: '#2775CA',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        fontSize: size * 0.5,
        fontWeight: 700,
        flexShrink: 0
      }}>$</div>
    );
  }
  
  return (
    <div style={{
      width: size,
      height: size,
      minWidth: size,
      minHeight: size,
      borderRadius: '50%',
      overflow: 'hidden',
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <img 
        src={USDC_LOGO} 
        alt="USDC"
        style={{ 
          width: size,
          height: size,
          objectFit: 'contain'
        }}
        onError={() => setHasError(true)}
      />
    </div>
  );
}

// Wallet Icon
function WalletIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="6" width="20" height="14" rx="2"/>
      <path d="M16 14h.01"/>
      <path d="M2 10h20"/>
    </svg>
  );
}

// USDC.X Logo Component
function UsdcXLogo({ size = 24 }) {
  const [hasError, setHasError] = useState(false);
  
  if (hasError) {
    // Fallback to text
    return (
      <div style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        borderRadius: '50%',
        background: '#2775CA',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontSize: size * 0.4,
        fontWeight: 700,
        flexShrink: 0
      }}>$X</div>
    );
  }
  
  return (
    <div style={{
      width: size,
      height: size,
      minWidth: size,
      minHeight: size,
      borderRadius: '50%',
      overflow: 'hidden',
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <img 
        src={USDCX_LOGO_URL} 
        alt="USDC.X"
        style={{ 
          width: size,
          height: size,
          objectFit: 'contain'
        }}
        onError={() => setHasError(true)}
      />
    </div>
  );
}

export default function BridgeScreen({ wallet, userTokens = [], onBack, onNetworkSwitch }) {
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState({ status: 'checking', message: 'Checking...' });
  const [dailyCap, setDailyCap] = useState(0);
  const [dailyCapRemaining, setDailyCapRemaining] = useState(0);
  const [userUsdcBalance, setUserUsdcBalance] = useState(0);
  const [userUsdcTokenAccount, setUserUsdcTokenAccount] = useState(null);
  const [error, setError] = useState('');
  const [fetchingBalance, setFetchingBalance] = useState(false);
  const [threshold, setThreshold] = useState(3);
  const [healthyGuardians, setHealthyGuardians] = useState(3);
  const [totalGuardians, setTotalGuardians] = useState(3);
  
  // Bridge direction: 'solana-to-x1' or 'x1-to-solana'
  const [direction, setDirection] = useState('solana-to-x1');
  
  // Confirmation screen
  const [showConfirm, setShowConfirm] = useState(false);
  const [bridgeFees, setBridgeFees] = useState({ flatFee: 0, pctFeeBps: 0 });
  
  // Transaction tracking
  const [txSignature, setTxSignature] = useState(null);
  const [txStatus, setTxStatus] = useState({ stage: 'idle' });
  const [bridgeDepositAddress, setBridgeDepositAddress] = useState('');
  const eventSourceRef = useRef(null);
  const configFailCountRef = useRef(0);

  const walletAddress = wallet?.wallet?.publicKey;
  const privateKey = wallet?.wallet?.privateKey;
  const isHardwareWallet = wallet?.wallet?.isHardware || wallet?.activeWallet?.isHardware || false;
  const derivationPath = wallet?.activeWallet?.derivationPath;

  // Calculate amounts
  const inputAmount = parseFloat(amount) || 0;
  const receiveAmount = inputAmount; // 1:1 ratio

  // Fetch bridge config from API
  const fetchBridgeConfig = useCallback(async () => {
    try {
      const [configRes, guardiansRes] = await Promise.all([
        fetchBridgeAPI('/config'),
        fetchBridgeAPI('/guardians')
      ]);

      console.log('[Bridge] Config response status:', configRes.status);
      console.log('[Bridge] Guardians response status:', guardiansRes.status);

      if (!configRes.ok || !guardiansRes.ok) {
        console.log('[Bridge] API response not OK - config:', configRes.status, 'guardians:', guardiansRes.status);
        const status = configRes.status || guardiansRes.status;
        const msg = status === 502 || status === 503 
          ? 'Connecting...' 
          : status === 0 ? 'Connecting...' : 'Connecting...';
        setBridgeStatus({ status: 'offline', message: msg });
        return;
      }

      const config = await configRes.json();
      const guardians = await guardiansRes.json();
      
      console.log('[Bridge] Config:', JSON.stringify(config).substring(0, 500));
      console.log('[Bridge] Guardians:', JSON.stringify(guardians).substring(0, 500));
      
      // Handle both old API format (single chain) and new Warp Bridge format (dual chain)
      let chainConfig, chainTokens;
      const isSolToX1 = direction === 'solana-to-x1';
      
      if (config.solana || config.x1) {
        // New dual-chain Warp Bridge API format
        const sourceChainData = isSolToX1 ? config.solana : config.x1;
        chainConfig = sourceChainData?.config;
        chainTokens = sourceChainData?.tokens || [];
        
        // Find USDC token info for daily cap
        const usdcToken = chainTokens.find(t => t.symbol === 'USDC');
        if (usdcToken) {
          const capValue = BigInt(usdcToken.dailyCap || '0');
          const volumeValue = BigInt(usdcToken.dailyVolume || '0');
          const remaining = capValue > volumeValue ? capValue - volumeValue : 0n;
          setDailyCap(Number(capValue) / 1_000_000);
          setDailyCapRemaining(Number(remaining) / 1_000_000);
          // Extract fees from API
          const flatFee = usdcToken.flatFeeAmount ? Number(usdcToken.flatFeeAmount) / 1_000_000 : 0;
          const pctFeeBps = usdcToken.percentageFeeBps || 0;
          setBridgeFees({ flatFee, pctFeeBps });
        }
        
        setThreshold(chainConfig?.threshold || 2);
      } else {
        // Old single-chain format (legacy fallback)
        chainConfig = config.config;
        
        const capValue = BigInt(chainConfig?.dailyCap || '0');
        const releasedValue = BigInt(chainConfig?.releasedToday || '0');
        const remaining = capValue > releasedValue ? capValue - releasedValue : 0n;
        setDailyCap(Number(capValue) / 1_000_000);
        setDailyCapRemaining(Number(remaining) / 1_000_000);
        setThreshold(chainConfig?.threshold || 2);
      }

      const healthy = guardians.healthyCount || 0;
      const total = guardians.totalGuardians || 3;
      setHealthyGuardians(healthy);
      setTotalGuardians(total);

      console.log('[Bridge] Healthy guardians:', healthy, '/', total);
      console.log('[Bridge] Threshold:', chainConfig?.threshold || 2);
      console.log('[Bridge] Paused:', chainConfig?.paused);

      // Check bridge status
      if (chainConfig?.paused) {
        setBridgeStatus({ status: 'paused', message: 'Bridge paused' });
        return;
      }

      const requiredThreshold = chainConfig?.threshold || 2;

      if (healthy >= requiredThreshold) {
        console.log('[Bridge] Setting status to LIVE');
        setBridgeStatus({ status: 'live', message: `${healthy}/${total} guardians healthy` });
      } else if (healthy >= requiredThreshold - 1) {
        console.log('[Bridge] Setting status to DEGRADED');
        setBridgeStatus({ status: 'degraded', message: `${healthy}/${total} guardians healthy` });
      } else {
        console.log('[Bridge] Setting status to OFFLINE');
        setBridgeStatus({ status: 'offline', message: `${healthy}/${total} guardians healthy` });
      }
    } catch (err) {
      // Only log once, not every retry
      if (configFailCountRef?.current === 0) {
        console.log('[Bridge] Config unavailable:', err.message);
      }
      setBridgeStatus({ status: 'offline', message: 'Connecting...' });
      
      // Try reading fees from chain if we haven't yet
      if (bridgeFees.flatFee === 0 && bridgeFees.pctFeeBps === 0) {
        try {
          const isSolToX1 = direction === 'solana-to-x1';
          const rpcUrl = isSolToX1 ? SOLANA_RPC_URL : X1_RPC_URL;
          const tokenMint = isSolToX1 ? USDC_SOLANA_MINT : USDCX_X1_MINT;
          const trSeed = new TextEncoder().encode('token_registry');
          const mintBytesLocal = decodeToFixedSize(tokenMint, 32);
          const trPda = await findProgramAddress([trSeed, mintBytesLocal], WARP_BRIDGE_PROGRAM_ID);
          const trB58 = encodeBase58Local(trPda.address);
          
          const res = await fetch(rpcUrl, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [trB58, { encoding: 'base64' }] })
          });
          const data = await res.json();
          if (data.result?.value?.data?.[0]) {
            const raw = Uint8Array.from(atob(data.result.value.data[0]), c => c.charCodeAt(0));
            const flatFeeOffset = 8 + 32 + 1 + 1 + 12 + 1 + 8 + 8 + 8 + 8 + 8 + 1;
            let flatFeeRaw = 0n;
            for (let i = 0; i < 8; i++) flatFeeRaw |= BigInt(raw[flatFeeOffset + i]) << BigInt(i * 8);
            const pctOffset = flatFeeOffset + 8;
            const pctFeeBps = raw[pctOffset] | (raw[pctOffset + 1] << 8);
            setBridgeFees({ flatFee: Number(flatFeeRaw) / 1_000_000, pctFeeBps });
          }
        } catch (chainErr) {
          // Silently fail - fees will show as unknown
        }
      }
    }
  }, [direction]);

  // Fetch user's USDC balance on Solana
  // Fetch balance based on direction - USDC on Solana or USDC.X on X1
  const fetchUsdcBalance = useCallback(async () => {
    if (!walletAddress) {
      setUserUsdcBalance(0);
      return;
    }

    setFetchingBalance(true);
    try {
      if (direction === 'solana-to-x1') {
        // Fetch USDC balance from Solana
        logger.log('[Bridge] Fetching USDC balance for:', walletAddress);
        const response = await fetch(SOLANA_RPC_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getTokenAccountsByOwner',
            params: [
              walletAddress,
              { mint: USDC_SOLANA_MINT },
              { encoding: 'jsonParsed', commitment: 'confirmed' }
            ]
          })
        });
        
        const data = await response.json();
        logger.log('[Bridge] USDC balance response:', JSON.stringify(data).slice(0, 300));
        if (data.result?.value?.length > 0) {
          const tokenAccount = data.result.value[0];
          const balance = parseFloat(
            tokenAccount.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0
          );
          const tokenAccountAddress = tokenAccount.pubkey;
          logger.log('[Bridge] USDC balance:', balance, 'Token Account:', tokenAccountAddress);
          setUserUsdcBalance(balance);
          setUserUsdcTokenAccount(tokenAccountAddress);
        } else {
          logger.log('[Bridge] No USDC token account found');
          setUserUsdcBalance(0);
          setUserUsdcTokenAccount(null);
        }
      } else {
        // Fetch USDC.X balance from X1 RPC directly
        logger.log('[Bridge] Fetching USDC.X balance for:', walletAddress);
        
        // USDC.X mint on X1 (Token2022)
        const USDCX_MINT = 'B69chRzqzDCmdB5WYB8NRu5Yv5ZA95ABiZcdzCgGm9Tq';
        const X1_RPC_URL = 'https://rpc.mainnet.x1.xyz';
        
        try {
          // Use getTokenAccountsByOwner with Token2022 program
          const response = await fetch(X1_RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'getTokenAccountsByOwner',
              params: [
                walletAddress,
                { mint: USDCX_MINT },
                { encoding: 'jsonParsed', commitment: 'confirmed' }
              ]
            })
          });
          
          const data = await response.json();
          console.log('[Bridge] USDC.X balance response:', data);
          
          if (data.result?.value?.length > 0) {
            const tokenAccount = data.result.value[0];
            const balance = parseFloat(
              tokenAccount.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0
            );
            logger.log('[Bridge] USDC.X balance:', balance);
            setUserUsdcBalance(balance);
          } else {
            // Try Token2022 program ID
            const response2 = await fetch(X1_RPC_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'getTokenAccountsByOwner',
                params: [
                  walletAddress,
                  { mint: USDCX_MINT },
                  { 
                    encoding: 'jsonParsed', 
                    commitment: 'confirmed',
                    programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' // Token2022
                  }
                ]
              })
            });
            
            const data2 = await response2.json();
            console.log('[Bridge] USDC.X Token2022 response:', data2);
            
            if (data2.result?.value?.length > 0) {
              const tokenAccount = data2.result.value[0];
              const balance = parseFloat(
                tokenAccount.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0
              );
              logger.log('[Bridge] USDC.X balance (Token2022):', balance);
              setUserUsdcBalance(balance);
            } else {
              logger.log('[Bridge] No USDC.X token account found');
              setUserUsdcBalance(0);
            }
          }
        } catch (err) {
          logger.error('[Bridge] Failed to fetch USDC.X from RPC:', err);
          // Fallback to userTokens
          const usdcxToken = userTokens.find(t => 
            t.symbol === 'USDC.X' || t.symbol === 'USDCX'
          );
          if (usdcxToken) {
            setUserUsdcBalance(parseFloat(usdcxToken.balance) || 0);
          } else {
            setUserUsdcBalance(0);
          }
        }
        setUserUsdcTokenAccount(null);
      }
    } catch (err) {
      logger.error('[Bridge] Failed to fetch balance:', err);
      setUserUsdcBalance(0);
    } finally {
      setFetchingBalance(false);
    }
  }, [walletAddress, direction, userTokens]);

  // Refetch balance when direction changes - with small delay for network switch
  useEffect(() => {
    // Small delay to allow network switch to complete
    const timer = setTimeout(() => {
      fetchUsdcBalance();
      fetchBridgeConfig(); // Refetch config for new source chain
    }, 500);
    return () => clearTimeout(timer);
  }, [direction]);

  // Initialize and refresh periodically (with backoff when API is down)
  useEffect(() => {
    let configTimer = null;
    let balanceTimer = null;
    let cancelled = false;
    
    const scheduleConfigFetch = () => {
      if (cancelled) return;
      // Exponential backoff: 30s, 60s, 120s, max 300s (5 min)
      const backoff = Math.min(30000 * Math.pow(2, configFailCountRef.current), 300000);
      configTimer = setTimeout(async () => {
        if (cancelled) return;
        try {
          await fetchBridgeConfig();
          configFailCountRef.current = 0; // Reset on success
        } catch {
          configFailCountRef.current = Math.min(configFailCountRef.current + 1, 4);
        }
        scheduleConfigFetch();
      }, backoff);
    };
    
    // Initial fetch
    fetchBridgeConfig().catch(() => {
      configFailCountRef.current = 1;
    });
    scheduleConfigFetch();
    
    // Balance polling stays consistent
    fetchUsdcBalance();
    balanceTimer = setInterval(fetchUsdcBalance, 15000);
    
    return () => {
      cancelled = true;
      if (configTimer) clearTimeout(configTimer);
      clearInterval(balanceTimer);
    };
  }, [fetchBridgeConfig]);

  // Post-transaction tracking: SSE with RPC polling fallback
  useEffect(() => {
    if (!txSignature) return;
    
    let cancelled = false;
    let eventSource = null;
    let pollTimer = null;
    let sseWorking = false;
    const isSolToX1 = direction === 'solana-to-x1';
    const sourceRpc = isSolToX1 ? SOLANA_RPC_URL : X1_RPC_URL;
    const destRpc = isSolToX1 ? X1_RPC_URL : SOLANA_RPC_URL;
    
    logger.log('[Bridge] Starting tx tracker for:', txSignature.slice(0, 8));
    
    // Snapshot the initial dest balance so we can detect when it arrives
    let initialDestBalance = null;
    const snapshotDestBalance = async () => {
      try {
        const destMint = isSolToX1 ? USDCX_X1_MINT : USDC_SOLANA_MINT;
        const res = await fetch(destRpc, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner',
            params: [walletAddress, { mint: destMint }, { encoding: 'jsonParsed', commitment: 'confirmed' }]
          })
        });
        const data = await res.json();
        const accounts = data.result?.value || [];
        if (accounts.length > 0) {
          initialDestBalance = parseFloat(accounts[0].account?.data?.parsed?.info?.tokenAmount?.uiAmountString || '0');
        } else {
          initialDestBalance = 0;
        }
        logger.log('[Bridge] Initial dest balance snapshot:', initialDestBalance);
      } catch (e) {
        initialDestBalance = 0;
      }
    };
    snapshotDestBalance();
    
    // Check if dest balance increased (meaning bridge completed)
    const checkDestBalance = async () => {
      if (initialDestBalance === null) return false;
      try {
        const destMint = isSolToX1 ? USDCX_X1_MINT : USDC_SOLANA_MINT;
        const res = await fetch(destRpc, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner',
            params: [walletAddress, { mint: destMint }, { encoding: 'jsonParsed', commitment: 'confirmed' }]
          })
        });
        const data = await res.json();
        const accounts = data.result?.value || [];
        if (accounts.length > 0) {
          const newBalance = parseFloat(accounts[0].account?.data?.parsed?.info?.tokenAmount?.uiAmountString || '0');
          if (newBalance > initialDestBalance + 0.01) {
            logger.log('[Bridge] Dest balance increased:', initialDestBalance, '->', newBalance);
            return true;
          }
        }
      } catch (e) { /* ignore */ }
      return false;
    };
    
    // --- RPC polling fallback ---
    const startRpcPolling = () => {
      let pollCount = 0;
      let sourceFinalized = false;
      const maxPolls = 40; // ~3.5 min (5s intervals)
      
      const poll = async () => {
        if (cancelled || sseWorking) return;
        pollCount++;
        
        try {
          if (!sourceFinalized) {
            // Phase 1: Check source chain tx confirmation
            const statusRes = await fetch(sourceRpc, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSignatureStatuses',
                params: [[txSignature], { searchTransactionHistory: true }]
              })
            });
            const statusData = await statusRes.json();
            const txInfo = statusData.result?.value?.[0];
            
            if (txInfo) {
              if (txInfo.err) {
                setTxStatus({ stage: 'failed', message: 'Transaction failed on-chain' });
                return;
              }
              const isFinalized = txInfo.confirmationStatus === 'finalized';
              const confirmations = txInfo.confirmations || 0;
              
              if (isFinalized || confirmations >= 31) {
                sourceFinalized = true;
                setTxStatus({ stage: 'detected', txSig: txSignature, message: 'Confirmed. Guardians processing...' });
              } else {
                setTxStatus({ stage: 'detected', txSig: txSignature,
                  message: `Confirming... (${Math.min(confirmations, 31)}/31)`
                });
              }
            }
          } else {
            // Phase 2: Source finalized, check if dest balance increased
            const arrived = await checkDestBalance();
            if (arrived) {
              setTxStatus({ stage: 'executed', txSig: txSignature, message: 'Complete!' });
              fetchUsdcBalance();
              return; // Stop polling
            }
          }
        } catch (e) {
          logger.log('[Bridge] Poll error:', e.message);
        }
        
        if (pollCount >= maxPolls) {
          // Timeout — mark as complete anyway (guardians may still be processing)
          setTxStatus({ stage: 'executed', txSig: txSignature,
            message: 'Submitted. Funds should arrive shortly.'
          });
          fetchUsdcBalance();
          return;
        }
        
        if (!cancelled) {
          pollTimer = setTimeout(poll, 5000);
        }
      };
      
      pollTimer = setTimeout(poll, 3000);
    };
    
    // --- Try SSE first ---
    try {
      eventSource = new EventSource(`${BRIDGE_API_URLS[0]}/transactions/stream`);
      eventSourceRef.current = eventSource;
      
      const sseTimeout = setTimeout(() => {
        if (!sseWorking && !cancelled) {
          logger.log('[Bridge] SSE timeout, falling back to RPC polling');
          if (eventSource) { eventSource.close(); eventSource = null; }
          startRpcPolling();
        }
      }, 5000);
      
      eventSource.onopen = () => {
        sseWorking = true;
        clearTimeout(sseTimeout);
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.txSig === txSignature) {
            switch (data.type) {
              case 'transaction_detected':
                setTxStatus({ stage: 'detected', message: 'Detected by guardians' }); break;
              case 'signature_added':
                setTxStatus({ stage: 'signing', signatures: data.signatureCount, threshold: data.threshold, message: `Signing ${data.signatureCount}/${data.threshold}` }); break;
              case 'threshold_reached':
                setTxStatus({ stage: 'threshold', signatures: data.signatureCount, threshold: data.threshold, message: 'Submitting...' }); break;
              case 'transaction_submitted':
                setTxStatus({ stage: 'confirming', x1TxSig: data.x1TxSig, message: 'Confirming...' }); break;
              case 'transaction_executed':
                setTxStatus({ stage: 'executed', x1TxSig: data.x1TxSig, message: 'Complete!' });
                if (eventSource) eventSource.close();
                fetchUsdcBalance(); break;
            }
          }
        } catch (err) { /* ignore parse errors */ }
      };

      eventSource.onerror = () => {
        clearTimeout(sseTimeout);
        if (!sseWorking && !cancelled) {
          if (eventSource) { eventSource.close(); eventSource = null; }
          startRpcPolling();
        }
      };
    } catch (sseErr) {
      startRpcPolling();
    }

    return () => {
      cancelled = true;
      if (eventSource) eventSource.close();
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [txSignature, direction, fetchUsdcBalance, walletAddress]);

  // Handle bridge button click - validates then shows confirmation
  const handleBridgeClick = () => {
    if (!walletAddress || (!privateKey && !isHardwareWallet)) {
      setError('Wallet not connected');
      return;
    }
    
    // Only check USDC token account for Solana→X1 direction
    if (direction === 'solana-to-x1' && !userUsdcTokenAccount) {
      setError('No USDC token account found. Please refresh balance.');
      return;
    }
    
    // Check native balance for transaction fees
    const nativeBalance = wallet?.balance || 0;
    const feeToken = direction === 'solana-to-x1' ? 'SOL' : 'XN';
    if (nativeBalance < 0.000005) {
      setError(`Insufficient ${feeToken} for transaction fee.`);
      return;
    }
    
    if (!amount || inputAmount <= 0) {
      setError('Enter an amount to bridge');
      return;
    }
    
    // Minimum is 10 USDC/USDC.X
    if (inputAmount < 10) {
      const tokenName = direction === 'solana-to-x1' ? 'USDC' : 'USDC.X';
      setError(`Minimum amount is 10 ${tokenName}`);
      return;
    }
    // Use integer comparison to avoid floating-point precision issues
    const multiplier = Math.pow(10, USDC_DECIMALS);
    const requiredAmount = Math.round(inputAmount * multiplier);
    const availableAmount = Math.round(userUsdcBalance * multiplier);
    
    const tokenName = direction === 'solana-to-x1' ? 'USDC' : 'USDC.X';
    if (requiredAmount > availableAmount) {
      setError(`Insufficient ${tokenName} balance. Required: ${inputAmount}, Available: ${userUsdcBalance}`);
      return;
    }
    
    // Only check daily cap if we have fetched it (> 0 means data loaded)
    if (dailyCapRemaining > 0 && inputAmount > dailyCapRemaining) {
      setError(`Exceeds daily bridge capacity. ${dailyCapRemaining.toFixed(2)} ${tokenName} remaining.`);
      return;
    }

    setError('');
    setShowConfirm(true);
  };
  
  // Execute the bridge after user confirms
  const handleBridge = async () => {
    setShowConfirm(false);

    setLoading(true);
    setError('');
    setTxStatus({ stage: 'idle', message: 'Preparing transaction...' });

    try {
      // Determine which chain we're bridging from
      const isSolToX1 = direction === 'solana-to-x1';
      const rpcUrl = isSolToX1 ? SOLANA_RPC_URL : X1_RPC_URL;
      const tokenMint = isSolToX1 ? USDC_SOLANA_MINT : USDCX_X1_MINT;
      const sourceChain = isSolToX1 ? CHAIN_SOLANA : CHAIN_X1;
      const destChain = isSolToX1 ? CHAIN_X1 : CHAIN_SOLANA;
      // USDC on Solana is native (locked in vault), USDC.X on X1 is wrapped (burned)
      const isNativeToken = isSolToX1; // USDC is native on Solana
      // Token program: USDC on Solana uses regular SPL, USDC.X on X1 uses Token-2022
      const tokenProgramId = isSolToX1 ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
      
      // --- Fetch bridge config from API to get fee_collector ---
      setTxStatus({ stage: 'idle', message: 'Fetching bridge config...' });
      let feeCollector;
      let feeCollectorAta = null;
      try {
        const configRes = await fetchBridgeAPI('/config');
        if (!configRes.ok) throw new Error(`API returned ${configRes.status}`);
        const configData = await configRes.json();
        const chainConfig = isSolToX1 ? configData.solana?.config : configData.x1?.config;
        feeCollector = chainConfig?.feeCollector || chainConfig?.admin;
        // Get fee collector ATA from token info
        const chainTokens = isSolToX1 ? configData.solana?.tokens : configData.x1?.tokens;
        const tokenInfo = chainTokens?.find(t => t.symbol === 'USDC');
        if (tokenInfo?.feeCollectorAta && tokenInfo.feeCollectorAta !== SYSTEM_PROGRAM_ID) {
          feeCollectorAta = tokenInfo.feeCollectorAta;
        }
        // Extract fee info from API
        if (tokenInfo) {
          const flatFee = tokenInfo.flatFeeAmount ? Number(tokenInfo.flatFeeAmount) / Math.pow(10, USDC_DECIMALS) : 0;
          const pctFeeBps = tokenInfo.percentageFeeBps || 0;
          setBridgeFees({ flatFee, pctFeeBps });
        }
        logger.log('[Bridge] Fee collector from API:', feeCollector, 'ATA:', feeCollectorAta);
      } catch (e) {
        logger.log('[Bridge] API unavailable, reading config from chain...', e.message);
        // Fallback: read fee_collector from on-chain Config PDA
        // and fee_collector_ata from TokenRegistryEntry PDA
        try {
          const configSeedTmp = new TextEncoder().encode('config');
          const configPdaTmp = await findProgramAddress([configSeedTmp], WARP_BRIDGE_PROGRAM_ID);
          const configAccountB58 = encodeBase58Local(configPdaTmp.address);
          
          // Also derive token registry PDA to get fee_collector_ata
          const trSeedTmp = new TextEncoder().encode('token_registry');
          const mintBytesTmp = decodeToFixedSize(tokenMint, 32);
          const trPdaTmp = await findProgramAddress([trSeedTmp, mintBytesTmp], WARP_BRIDGE_PROGRAM_ID);
          const trAccountB58 = encodeBase58Local(trPdaTmp.address);
          
          const [configAccountRes, trAccountRes] = await Promise.all([
            fetch(rpcUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0', id: 1,
                method: 'getAccountInfo',
                params: [configAccountB58, { encoding: 'base64', commitment: 'confirmed' }]
              })
            }),
            fetch(rpcUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0', id: 2,
                method: 'getAccountInfo',
                params: [trAccountB58, { encoding: 'base64', commitment: 'confirmed' }]
              })
            })
          ]);
          
          const configAccData = await configAccountRes.json();
          const trAccData = await trAccountRes.json();
          
          // Parse Config account for fee_collector
          if (configAccData.result?.value?.data?.[0]) {
            const raw = Uint8Array.from(atob(configAccData.result.value.data[0]), c => c.charCodeAt(0));
            // Config layout: 8 (discriminator) + 32 (admin) + 1 (paused) + 160 (guardians 5x32) + 
            // 1 (num_guardians) + 1 (threshold) + 8 (out_seq) + 8 (in_seq) + 8 (flat_fee) + 
            // 2 (pct_fee) + 32 (fee_collector) = offset 229
            const feeCollectorOffset = 8 + 32 + 1 + 160 + 1 + 1 + 8 + 8 + 8 + 2;
            const fcBytes = raw.slice(feeCollectorOffset, feeCollectorOffset + 32);
            feeCollector = encodeBase58Local(fcBytes);
            logger.log('[Bridge] Fee collector from chain:', feeCollector);
          }
          
          // Parse TokenRegistryEntry for fee_collector_ata and fee amounts
          if (trAccData.result?.value?.data?.[0]) {
            const raw = Uint8Array.from(atob(trAccData.result.value.data[0]), c => c.charCodeAt(0));
            // TokenRegistryEntry layout:
            // 8 (disc) + 32 (local_mint) + 1 (decimals) + 1 (is_native) + 12 (symbol) + 
            // 1 (paused) + 8 (daily_cap) + 8 (daily_volume) + 8 (last_reset) + 
            // 8 (min_amount) + 8 (max_amount) + 1 (bump) = offset 96
            // Then: 8 (flat_fee_amount) + 2 (percentage_fee_bps) = offset 106
            // Then: 32 (fee_collector_ata)
            
            // Read flat_fee_amount (u64 LE at offset 96)
            const flatFeeOffset = 8 + 32 + 1 + 1 + 12 + 1 + 8 + 8 + 8 + 8 + 8 + 1;
            let flatFeeRaw = 0n;
            for (let i = 0; i < 8; i++) flatFeeRaw |= BigInt(raw[flatFeeOffset + i]) << BigInt(i * 8);
            const flatFee = Number(flatFeeRaw) / Math.pow(10, USDC_DECIMALS);
            
            // Read percentage_fee_bps (u16 LE at offset 104)
            const pctOffset = flatFeeOffset + 8;
            const pctFeeBps = raw[pctOffset] | (raw[pctOffset + 1] << 8);
            
            setBridgeFees({ flatFee, pctFeeBps });
            logger.log('[Bridge] Fees from chain: flat=', flatFee, 'USDC, pct=', pctFeeBps, 'bps');
            
            // Read fee_collector_ata (32 bytes at offset 106)
            const fcAtaOffset = pctOffset + 2;
            const fcAtaBytes = raw.slice(fcAtaOffset, fcAtaOffset + 32);
            const fcAtaStr = encodeBase58Local(fcAtaBytes);
            // Check it's not all zeros (default/unset)
            const isZero = fcAtaBytes.every(b => b === 0);
            if (!isZero && fcAtaStr !== SYSTEM_PROGRAM_ID) {
              feeCollectorAta = fcAtaStr;
              logger.log('[Bridge] Fee collector ATA from chain:', feeCollectorAta);
            }
          }
        } catch (chainErr) {
          logger.error('[Bridge] Failed to read on-chain config:', chainErr);
          throw new Error('Bridge API unavailable and unable to read on-chain config. Please try again later.');
        }
      }
      
      if (!feeCollector) {
        throw new Error('Bridge configuration unavailable.');
      }
      
      // --- Get slot and blockhash ---
      setTxStatus({ stage: 'idle', message: 'Getting network data...' });
      
      const [slotRes, blockhashRes] = await Promise.all([
        fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot', params: [{ commitment: 'confirmed' }] })
        }),
        fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'getLatestBlockhash', params: [{ commitment: 'finalized' }] })
        })
      ]);
      
      const slotData = await slotRes.json();
      const blockhashData = await blockhashRes.json();
      
      if (blockhashData.error) throw new Error(blockhashData.error.message || 'Failed to get blockhash');
      
      const slot = slotData.result;
      const blockhash = blockhashData.result?.value?.blockhash;
      if (!blockhash || !slot) throw new Error('Failed to get network data');
      
      logger.log('[Bridge] Slot:', slot, 'Blockhash:', blockhash);
      
      // --- Compute seq with chain encoding ---
      const seq = encodeSeq(slot, 0, sourceChain, destChain);
      const seqBytes = writeU64LE(seq);
      logger.log('[Bridge] Seq:', seq.toString(), 'encoded');
      
      // --- Derive all PDAs ---
      setTxStatus({ stage: 'idle', message: 'Deriving accounts...' });
      
      const programIdBytes = decodeToFixedSize(WARP_BRIDGE_PROGRAM_ID, 32);
      const mintBytes = decodeToFixedSize(tokenMint, 32);
      
      // Config PDA: seeds = ["config"]
      const configSeed = new TextEncoder().encode('config');
      const configPda = await findProgramAddress([configSeed], WARP_BRIDGE_PROGRAM_ID);
      logger.log('[Bridge] Config PDA:', encodeBase58Local(configPda.address), 'bump:', configPda.bump);
      
      // Token Registry PDA: seeds = ["token_registry", mint]
      const trSeed = new TextEncoder().encode('token_registry');
      const tokenRegistryPda = await findProgramAddress([trSeed, mintBytes], WARP_BRIDGE_PROGRAM_ID);
      logger.log('[Bridge] Token Registry PDA:', encodeBase58Local(tokenRegistryPda.address), 'bump:', tokenRegistryPda.bump);
      
      // Outgoing Message PDA: seeds = ["evt_out", seq_le_bytes]
      const evtSeed = new TextEncoder().encode('evt_out');
      const outgoingMsgPda = await findProgramAddress([evtSeed, seqBytes], WARP_BRIDGE_PROGRAM_ID);
      logger.log('[Bridge] Outgoing Msg PDA:', encodeBase58Local(outgoingMsgPda.address), 'bump:', outgoingMsgPda.bump);
      
      // User's token account (ATA)
      const senderTokenAccountBytes = isSolToX1 
        ? decodeToFixedSize(userUsdcTokenAccount, 32)
        : await findAssociatedTokenAddress(walletAddress, tokenMint, tokenProgramId);
      
      // Vault PDA: seeds = ["vault", mint] - only for native tokens
      let vaultPdaAddress = null;
      let vaultTokenAccountAddress = null;
      if (isNativeToken) {
        const vaultSeed = new TextEncoder().encode('vault');
        const vaultPda = await findProgramAddress([vaultSeed, mintBytes], WARP_BRIDGE_PROGRAM_ID);
        vaultPdaAddress = vaultPda.address;
        // Vault token account = ATA of vault PDA for the mint
        vaultTokenAccountAddress = await findAssociatedTokenAddress(
          encodeBase58Local(vaultPda.address), tokenMint, tokenProgramId
        );
        logger.log('[Bridge] Vault PDA:', encodeBase58Local(vaultPdaAddress));
      }
      
      // --- Build instruction data ---
      // bridge_out(seq: u64, amount: u64)
      const tokenAmount = BigInt(Math.floor(inputAmount * Math.pow(10, USDC_DECIMALS)));
      const ixData = new Uint8Array(8 + 8 + 8); // discriminator + seq + amount
      ixData.set(BRIDGE_OUT_DISCRIMINATOR, 0);
      ixData.set(seqBytes, 8);
      ixData.set(writeU64LE(tokenAmount), 16);
      
      // --- Build account keys array ---
      // Order from IDL:
      // 0: config (writable)
      // 1: token_registry (writable)
      // 2: outgoing_msg (writable)
      // 3: sender (writable, signer)
      // 4: sender_token_account (writable)
      // 5: token_mint (writable)
      // 6: vault (writable, optional) OR program_id sentinel for None
      // 7: vault_token_account (writable, optional) OR program_id sentinel for None
      // 8: fee_collector (writable)
      // 9: fee_collector_token_account (writable, optional) OR program_id sentinel for None
      // 10: token_program
      // 11: system_program
      
      const senderBytes = decodeToFixedSize(walletAddress, 32);
      const feeCollectorBytes = decodeToFixedSize(feeCollector, 32);
      const tokenProgramBytes = decodeToFixedSize(tokenProgramId, 32);
      const systemProgramBytes = decodeToFixedSize(SYSTEM_PROGRAM_ID, 32);
      const programIdBytesForNone = decodeToFixedSize(WARP_BRIDGE_PROGRAM_ID, 32);
      
      // Anchor uses the program's own ID as the sentinel for Option<Account> = None
      const vaultBytes = vaultPdaAddress || programIdBytesForNone;
      const vaultTokenBytes = vaultTokenAccountAddress || programIdBytesForNone;
      const feeCollectorAtaBytes = feeCollectorAta 
        ? decodeToFixedSize(feeCollectorAta, 32) 
        : programIdBytesForNone;
      
      // Collect all unique account keys (de-duplicate)
      const accountEntries = [
        { key: configPda.address, isSigner: false, isWritable: true },
        { key: tokenRegistryPda.address, isSigner: false, isWritable: true },
        { key: outgoingMsgPda.address, isSigner: false, isWritable: true },
        { key: senderBytes, isSigner: true, isWritable: true },
        { key: senderTokenAccountBytes, isSigner: false, isWritable: true },
        { key: mintBytes, isSigner: false, isWritable: true },
        { key: vaultBytes, isSigner: false, isWritable: isNativeToken },
        { key: vaultTokenBytes, isSigner: false, isWritable: isNativeToken },
        { key: feeCollectorBytes, isSigner: false, isWritable: true },
        { key: feeCollectorAtaBytes, isSigner: false, isWritable: !!feeCollectorAta },
        { key: tokenProgramBytes, isSigner: false, isWritable: false },
        { key: systemProgramBytes, isSigner: false, isWritable: false },
      ];
      
      // De-duplicate keys while tracking properties
      const keyMap = new Map();
      const orderedKeys = [];
      
      for (const entry of accountEntries) {
        const keyStr = encodeBase58Local(entry.key);
        if (keyMap.has(keyStr)) {
          const existing = keyMap.get(keyStr);
          existing.isSigner = existing.isSigner || entry.isSigner;
          existing.isWritable = existing.isWritable || entry.isWritable;
        } else {
          const idx = orderedKeys.length;
          keyMap.set(keyStr, { ...entry, idx });
          orderedKeys.push({ ...entry, keyStr });
        }
      }
      
      // Sort: signers+writable first, then signers+readonly, then writable, then readonly
      // But sender must be first (index 0) as the fee payer
      const signerWritable = orderedKeys.filter(k => k.isSigner && k.isWritable);
      const signerReadonly = orderedKeys.filter(k => k.isSigner && !k.isWritable);
      const nonsignerWritable = orderedKeys.filter(k => !k.isSigner && k.isWritable);
      const nonsignerReadonly = orderedKeys.filter(k => !k.isSigner && !k.isWritable);
      
      const sortedKeys = [...signerWritable, ...signerReadonly, ...nonsignerWritable, ...nonsignerReadonly];
      
      // Build the key-to-index lookup for instruction encoding
      const keyToIdx = new Map();
      sortedKeys.forEach((k, i) => keyToIdx.set(k.keyStr, i));
      
      const numSigners = signerWritable.length + signerReadonly.length;
      const numReadonlySigned = signerReadonly.length;
      const numReadonlyUnsigned = nonsignerReadonly.length;
      
      // Build account key bytes
      const numAccounts = sortedKeys.length;
      const accountKeysData = new Uint8Array(32 * numAccounts);
      sortedKeys.forEach((k, i) => accountKeysData.set(k.key, i * 32));
      
      // Build instruction account indices
      const ixAccountIndices = accountEntries.map(e => {
        const keyStr = encodeBase58Local(e.key);
        return keyToIdx.get(keyStr);
      });
      
      // Compact instruction format
      // program_id_index, num_accounts, [account_indices...], data_len, [data...]
      const programIdx = keyToIdx.get(encodeBase58Local(decodeToFixedSize(WARP_BRIDGE_PROGRAM_ID, 32)));
      
      // If program is not in keys, we need to add it
      let finalProgramIdx = programIdx;
      if (finalProgramIdx === undefined) {
        // Add program to keys as readonly unsigned
        const pBytes = decodeToFixedSize(WARP_BRIDGE_PROGRAM_ID, 32);
        finalProgramIdx = numAccounts;
        const newLen = accountKeysData.length + 32;
        const newKeys = new Uint8Array(newLen);
        newKeys.set(accountKeysData, 0);
        newKeys.set(pBytes, accountKeysData.length);
        // Can't reassign const, rebuild
        // Actually let's handle this differently - add program to sortedKeys
        sortedKeys.push({ key: pBytes, isSigner: false, isWritable: false, keyStr: WARP_BRIDGE_PROGRAM_ID });
        keyToIdx.set(WARP_BRIDGE_PROGRAM_ID, sortedKeys.length - 1);
        finalProgramIdx = sortedKeys.length - 1;
      }
      
      // Rebuild account keys with final set
      const finalNumAccounts = sortedKeys.length;
      const finalAccountKeys = new Uint8Array(32 * finalNumAccounts);
      sortedKeys.forEach((k, i) => finalAccountKeys.set(k.key, i * 32));
      
      // Recalculate readonly counts
      const finalNumReadonlyUnsigned = sortedKeys.filter(k => !k.isSigner && !k.isWritable).length;
      
      // Encode instruction: program_idx, compact_array(accounts), compact_array(data)
      function encodeCompactU16(val) {
        if (val < 128) return [val];
        return [val & 0x7f | 0x80, val >> 7];
      }
      
      const ixAccLen = encodeCompactU16(ixAccountIndices.length);
      const ixDataLen = encodeCompactU16(ixData.length);
      
      const instructionBytes = new Uint8Array(
        1 + ixAccLen.length + ixAccountIndices.length + ixDataLen.length + ixData.length
      );
      let ixOffset = 0;
      instructionBytes[ixOffset++] = finalProgramIdx;
      instructionBytes.set(ixAccLen, ixOffset); ixOffset += ixAccLen.length;
      for (const idx of ixAccountIndices) {
        instructionBytes[ixOffset++] = idx;
      }
      instructionBytes.set(ixDataLen, ixOffset); ixOffset += ixDataLen.length;
      instructionBytes.set(ixData, ixOffset);
      
      // --- Build legacy transaction message ---
      const blockhashBytes = decodeToFixedSize(blockhash, 32);
      
      // Header: num_required_signatures, num_readonly_signed, num_readonly_unsigned
      const header = new Uint8Array([numSigners, numReadonlySigned, finalNumReadonlyUnsigned]);
      
      // Num accounts (compact u16)
      const numAccountsCompact = encodeCompactU16(finalNumAccounts);
      
      // Num instructions = 1 (compact u16)
      const numInstructions = encodeCompactU16(1);
      
      // Build message
      const messageLen = 3 + numAccountsCompact.length + (32 * finalNumAccounts) + 32 + numInstructions.length + instructionBytes.length;
      const message = new Uint8Array(messageLen);
      let msgOffset = 0;
      
      message.set(header, msgOffset); msgOffset += 3;
      message.set(numAccountsCompact, msgOffset); msgOffset += numAccountsCompact.length;
      message.set(finalAccountKeys, msgOffset); msgOffset += finalAccountKeys.length;
      message.set(blockhashBytes, msgOffset); msgOffset += 32;
      message.set(numInstructions, msgOffset); msgOffset += numInstructions.length;
      message.set(instructionBytes, msgOffset);
      
      logger.log('[Bridge] Message built, length:', message.length, 'accounts:', finalNumAccounts);
      
      // --- Sign the message ---
      setTxStatus({ stage: 'idle', message: 'Signing transaction...' });
      
      const { sign } = await import('@x1-wallet/core/utils/bip44');
      
      let ed25519Signature;
      if (isHardwareWallet) {
        logger.log('[Bridge] Signing with hardware wallet...');
        setTxStatus({ stage: 'idle', message: 'Please confirm on your Ledger device...' });
        ed25519Signature = await hardwareWallet.signTransaction(message, derivationPath);
      } else {
        let secretKey;
        if (typeof privateKey === 'string') {
          secretKey = decodeBase58Local(privateKey);
        } else {
          secretKey = privateKey;
        }
        
        if (secretKey.length !== 64) {
          throw new Error(`Invalid secret key length: ${secretKey.length}`);
        }
        
        ed25519Signature = await sign(message, secretKey);
      }
      
      // --- Serialize and send ---
      const signedTx = new Uint8Array(1 + 64 + message.length);
      signedTx[0] = 1; // 1 signature
      signedTx.set(ed25519Signature, 1);
      signedTx.set(message, 65);
      
      const tx = btoa(String.fromCharCode(...signedTx));
      logger.log('[Bridge] Transaction ready, sending to', isSolToX1 ? 'Solana' : 'X1', '...');
      setTxStatus({ stage: 'idle', message: 'Sending transaction...' });

      const sendResponse = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'sendTransaction',
          params: [tx, { 
            encoding: 'base64', 
            skipPreflight: false,
            preflightCommitment: 'confirmed'
          }]
        })
      });
      
      const sendData = await sendResponse.json();
      if (sendData.error) {
        logger.error('[Bridge] Transaction error:', sendData.error);
        const errMsg = sendData.error.message || 'Transaction failed';
        // Try to extract useful info from logs
        const logs = sendData.error?.data?.logs;
        if (logs) {
          logger.error('[Bridge] Logs:', logs);
          const programError = logs.find(l => l.includes('Error Message:'));
          if (programError) {
            throw new Error(programError.split('Error Message:')[1]?.trim() || errMsg);
          }
        }
        throw new Error(errMsg);
      }
      
      const signature = sendData.result;
      logger.log('[Bridge] Transaction sent:', signature);
      
      setTxSignature(signature);
      setTxStatus({
        stage: 'detected',
        txSig: signature,
        message: 'Transaction sent! Waiting for confirmations...'
      });
      // Release the button immediately - status tracker handles progress
      setLoading(false);
      
      // Refresh balance after sending
      setTimeout(() => fetchUsdcBalance(), 3000);
      
    } catch (err) {
      logger.error('[Bridge] Transaction error:', err);
      setError(err.message || 'Transaction failed');
      setTxStatus({ stage: 'failed', message: err.message });
      setLoading(false);
    }
  };

  const setMaxAmount = () => {
    console.log('[Bridge] setMaxAmount called, userUsdcBalance:', userUsdcBalance, 'dailyCapRemaining:', dailyCapRemaining);
    if (userUsdcBalance > 0) {
      // If daily cap not loaded yet (0), just use balance
      // Otherwise use the minimum of balance and remaining cap
      const maxAmount = dailyCapRemaining > 0 
        ? Math.min(userUsdcBalance, dailyCapRemaining)
        : userUsdcBalance;
      console.log('[Bridge] Setting max amount to:', maxAmount);
      setAmount(maxAmount.toFixed(2));
    } else {
      console.log('[Bridge] userUsdcBalance is 0 or undefined');
    }
  };

  const formatNumber = (val, dec = 2) => {
    return (val || 0).toLocaleString(undefined, {
      minimumFractionDigits: dec,
      maximumFractionDigits: dec
    });
  };

  const getStatusColor = () => {
    switch (bridgeStatus.status) {
      case 'live': return '#22c55e';
      case 'degraded': return '#f59e0b';
      case 'paused': return '#f97316';
      default: return '#ef4444';
    }
  };

  const getTxStageInfo = () => {
    const stages = {
      idle: { label: 'Ready', color: '#8b8b8b' },
      detected: { label: 'Detected', color: '#0274fb' },
      signing: { label: 'Signing', color: '#f59e0b' },
      threshold: { label: 'Threshold Reached', color: '#f97316' },
      confirming: { label: 'Confirming', color: '#0274fb' },
      executed: { label: 'Complete', color: '#22c55e' },
      failed: { label: 'Failed', color: '#ef4444' }
    };
    return stages[txStatus.stage] || stages.idle;
  };

  // Styles matching Swap screen visual design
  const styles = {
    screen: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#000000'
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px 20px',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      position: 'relative',
      minHeight: 48
    },
    backBtn: {
      background: 'transparent',
      border: 'none',
      color: '#8b8b8b',
      cursor: 'pointer',
      padding: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'absolute',
      left: 16,
      top: '50%',
      transform: 'translateY(-50%)'
    },
    title: {
      textAlign: 'center'
    },
    titleText: {
      fontSize: 16,
      fontWeight: 600,
      color: '#fff',
      margin: 0
    },
    subtitle: {
      fontSize: 11,
      color: '#6b6b6b',
      marginTop: 2
    },
    headerSpacer: {
      width: 32,
      position: 'absolute',
      right: 16
    },
    content: {
      flex: 1,
      overflowY: 'auto',
      padding: '20px'
    },
    card: {
      background: 'transparent',
      padding: '16px 0',
      position: 'relative'
    },
    cardLabel: {
      fontSize: 12,
      color: '#6b6b6b',
      marginBottom: 8
    },
    chainRow: {
      display: 'flex',
      gap: 16
    },
    chainCol: {
      flex: 1
    },
    chainLabel: {
      fontSize: 11,
      color: '#6b6b6b',
      marginBottom: 10,
      textTransform: 'uppercase',
      letterSpacing: '0.5px'
    },
    chainPill: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      background: 'transparent',
      borderRadius: 8,
      padding: '8px 0'
    },
    chainName: {
      fontSize: 14,
      fontWeight: 500,
      color: '#fff'
    },
    // Amount box - matches swap-box styling
    amountBox: {
      padding: 0
    },
    amountHeader: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
      fontSize: 12,
      color: '#6b6b6b'
    },
    amountLabel: {
      fontSize: 12,
      color: '#6b6b6b'
    },
    amountRow: {
      display: 'flex',
      alignItems: 'center',
      gap: 12
    },
    receiveRow: {
      display: 'flex',
      alignItems: 'center',
      gap: 12
    },
    tokenIcon: {
      width: 40,
      height: 40,
      minWidth: 40,
      minHeight: 40,
      borderRadius: '50%',
      background: '#000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      overflow: 'hidden'
    },
    tokenInfo: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    },
    tokenSymbol: {
      fontWeight: 600,
      fontSize: 15,
      color: '#fff'
    },
    tokenName: {
      fontSize: 12,
      color: '#6b6b6b',
      whiteSpace: 'nowrap'
    },
    amountInputWrap: {
      flex: 1,
      textAlign: 'right',
      minWidth: 120
    },
    amountInput: {
      background: 'transparent',
      border: 'none',
      fontSize: 18,
      fontWeight: 600,
      fontFamily: 'inherit',
      color: '#fff',
      width: '100%',
      outline: 'none',
      textAlign: 'right'
    },
    amountUsd: {
      fontSize: 12,
      color: '#6b6b6b',
      marginTop: 2,
      textAlign: 'right'
    },
    balanceRow: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      color: '#6b6b6b',
      fontSize: 12
    },
    // Direction arrow wrapper
    directionWrapper: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      height: 32,
      margin: '8px 0'
    },
    directionLine: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: '50%',
      height: 1,
      background: 'rgba(255,255,255,0.1)'
    },
    directionBtn: {
      width: 32,
      height: 32,
      background: '#000',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#6b6b6b',
      zIndex: 2,
      position: 'relative'
    },
    // Receive box
    receiveBox: {
      padding: 0
    },
    receiveLabel: {
      fontSize: 12,
      color: '#6b6b6b',
      marginBottom: 8
    },
    receiveAmount: {
      fontSize: 18,
      fontWeight: 600,
      fontFamily: 'inherit',
      color: 'rgba(255,255,255,0.7)',
      flex: 1,
      textAlign: 'right'
    },
    receiveUsd: {
      fontSize: 12,
      color: '#6b6b6b',
      marginTop: 2,
      textAlign: 'right'
    },
    // Recipient row
    recipientRow: {
      padding: '12px 0',
      textAlign: 'center',
      color: '#8b8b8b',
      fontSize: 13,
      borderBottom: '1px solid rgba(255,255,255,0.06)'
    },
    recipientLabel: {
      color: '#6b6b6b'
    },
    recipientValue: {
      color: '#fff',
      fontWeight: 500
    },
    // Info/details section
    infoCard: {
      background: 'transparent',
      borderRadius: 0,
      padding: '12px 0',
      borderBottom: '1px solid rgba(255,255,255,0.06)'
    },
    infoGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 12,
      textAlign: 'center'
    },
    infoItem: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4
    },
    infoLabel: {
      fontSize: 11,
      color: '#6b6b6b'
    },
    infoValue: {
      fontSize: 13,
      color: '#fff',
      fontWeight: 500
    },
    infoRow: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '10px 0',
      borderBottom: '1px solid rgba(255,255,255,0.04)'
    },
    infoRowLast: {
      borderBottom: 'none'
    },
    statusDot: {
      display: 'inline-block',
      width: 8,
      height: 8,
      borderRadius: '50%',
      marginRight: 8
    },
    // Error and status boxes
    errorBox: {
      background: 'rgba(239, 68, 68, 0.1)',
      border: '1px solid rgba(239, 68, 68, 0.3)',
      borderRadius: 12,
      padding: '10px 12px',
      marginBottom: 12,
      color: '#ef4444',
      fontSize: 13,
      display: 'flex',
      alignItems: 'center',
      gap: 8
    },
    txStatus: {
      background: 'rgba(2, 116, 251, 0.1)',
      border: '1px solid rgba(2, 116, 251, 0.3)',
      borderRadius: 12,
      padding: 12,
      marginBottom: 12
    },
    txStatusHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8
    },
    txStatusLabel: {
      fontSize: 12,
      color: '#8b8b8b'
    },
    txStatusValue: {
      fontSize: 13,
      fontWeight: 600
    },
    txSigBar: {
      display: 'flex',
      gap: 6,
      marginTop: 8
    },
    txSigDot: {
      width: 24,
      height: 6,
      borderRadius: 3,
      background: 'rgba(255,255,255,0.1)'
    },
    txSigDotFilled: {
      background: '#22c55e'
    },
    // Bridge button
    bridgeBtn: {
      width: '100%',
      padding: '14px 20px',
      background: '#0274fb',
      border: 'none',
      borderRadius: 12,
      color: 'white',
      fontSize: 15,
      fontWeight: 600,
      cursor: 'pointer',
      marginTop: 16
    },
    bridgeBtnDisabled: {
      background: 'rgba(2, 116, 251, 0.3)',
      cursor: 'not-allowed'
    },
    footer: {
      textAlign: 'center',
      padding: '12px 0',
      color: '#4b4b4b',
      fontSize: 11
    }
  };

  // Detect current network and set appropriate default direction
  const isSolana = wallet?.network?.includes('Solana');
  const isX1 = wallet?.network?.includes('X1') && !wallet?.network?.includes('Testnet');
  
  // Auto-set direction based on current network on mount
  useEffect(() => {
    if (isSolana) {
      setDirection('solana-to-x1');
    } else if (isX1) {
      setDirection('x1-to-solana');
    }
  }, [wallet?.network]);

  return (
    <div className="screen bridge-screen" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#000' }}>
      {/* Header */}
      <div className="page-header">
        <div className="header-left">
          <button className="back-btn" onClick={onBack}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
        <h2 className="header-title">Warp Bridge</h2>
        <div className="header-right" />
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '0 20px' }}>

        {/* Chain selector row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '16px 0 16px' }}>
          <div style={{ width: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '8px 0' }}>
            {direction === 'solana-to-x1' ? <SolanaLogo size={20} /> : <X1LogoSmall size={20} />}
            <span style={{ color: '#fff', fontSize: 14, fontWeight: 500 }}>{direction === 'solana-to-x1' ? 'Solana' : 'X1'}</span>
          </div>
          <button 
            onClick={() => {
              const newDirection = direction === 'solana-to-x1' ? 'x1-to-solana' : 'solana-to-x1';
              setDirection(newDirection);
              setAmount('');
              setError('');
              setUserUsdcBalance(0);
              setFetchingBalance(true);
              const targetNetwork = newDirection === 'solana-to-x1' ? 'Solana Mainnet' : 'X1 Mainnet';
              if (onNetworkSwitch) onNetworkSwitch(targetNetwork);
            }}
            disabled={loading}
            style={{ background: 'none', border: 'none', color: '#6b6b6b', cursor: 'pointer', padding: 4, display: 'flex', flexShrink: 0 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M7 16l-4-4m0 0l4-4m-4 4h18M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </button>
          <div style={{ width: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '8px 0' }}>
            {direction === 'solana-to-x1' ? <X1LogoSmall size={20} /> : <SolanaLogo size={20} />}
            <span style={{ color: '#fff', fontSize: 14, fontWeight: 500 }}>{direction === 'solana-to-x1' ? 'X1' : 'Solana'}</span>
          </div>
        </div>

        {txStatus.stage === 'idle' ? (
          <>
            {/* Amount input area */}
            <div style={{ textAlign: 'center', padding: '4px 0 4px' }}>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={amount}
                onChange={e => { setAmount(e.target.value.replace(/[^0-9.]/g, '')); setError(''); }}
                disabled={loading}
                style={{
                  background: 'transparent', border: 'none', outline: 'none',
                  fontSize: 48, fontWeight: 600, fontFamily: 'inherit',
                  color: '#fff', textAlign: 'center', width: '100%',
                  caretColor: '#0274fb'
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 4 }}>
                {direction === 'solana-to-x1' ? <UsdcLogo size={20} /> : <UsdcXLogo size={20} />}
                <span style={{ color: '#fff', fontSize: 15, fontWeight: 500 }}>{direction === 'solana-to-x1' ? 'USDC' : 'USDC.X'}</span>
              </div>
            </div>

            {/* Balance pill */}
            <div style={{ textAlign: 'center', marginTop: 12, marginBottom: 12 }}>
              <button
                onClick={setMaxAmount}
                type="button"
                disabled={fetchingBalance}
                style={{
                  background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 20,
                  padding: '8px 20px', color: '#8b8b8b', fontSize: 13, cursor: 'pointer'
                }}
              >
                {fetchingBalance ? 'Loading...' : `Balance: ${formatNumber(userUsdcBalance)} ${direction === 'solana-to-x1' ? 'USDC' : 'USDC.X'}`}
              </button>
            </div>

            {/* Receive hint */}
            {amount && parseFloat(amount) > 0 && (
              <div style={{ textAlign: 'center', color: '#6b6b6b', fontSize: 13, marginBottom: 16 }}>
                You'll receive ≈ {amount} {direction === 'solana-to-x1' ? 'USDC.X' : 'USDC'} on {direction === 'solana-to-x1' ? 'X1' : 'Solana'}
              </div>
            )}

            {/* Info rows */}
            <div style={{ marginTop: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                <span style={{ fontSize: 13, color: '#6b6b6b' }}>Route</span>
                <span style={{ fontSize: 13, color: '#fff', fontWeight: 500 }}>
                  {direction === 'solana-to-x1' ? 'SOL → X1' : 'X1 → SOL'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                <span style={{ fontSize: 13, color: '#6b6b6b' }}>Rate</span>
                <span style={{ fontSize: 13, color: '#fff', fontWeight: 500 }}>1:1</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                <span style={{ fontSize: 13, color: '#6b6b6b' }}>Bridge fee</span>
                <span style={{ fontSize: 13, color: (bridgeFees.flatFee === 0 && bridgeFees.pctFeeBps === 0) ? '#22c55e' : '#fff', fontWeight: 500 }}>
                  {bridgeFees.flatFee === 0 && bridgeFees.pctFeeBps === 0 ? 'Free' :
                   bridgeFees.flatFee > 0 && bridgeFees.pctFeeBps > 0 ?
                     `${bridgeFees.flatFee} + ${(bridgeFees.pctFeeBps/100).toFixed(2)}%` :
                   bridgeFees.flatFee > 0 ? `${bridgeFees.flatFee} ${direction === 'solana-to-x1' ? 'USDC' : 'USDC.X'}` :
                     `${(bridgeFees.pctFeeBps/100).toFixed(2)}%`}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                <span style={{ fontSize: 13, color: '#6b6b6b' }}>Est. time</span>
                <span style={{ fontSize: 13, color: '#6b6b6b' }}>2–5 min</span>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div style={{ color: '#ef4444', fontSize: 13, textAlign: 'center', marginTop: 12 }}>{error}</div>
            )}
          </>
        ) : (
          /* Transaction status view */
          <div style={{ textAlign: 'center', padding: '40px 0 20px' }}>
            <div style={{ marginBottom: 20 }}>
              {txStatus.stage === 'executed' ? (
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(34,197,94,0.12)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </div>
              ) : txStatus.stage === 'failed' ? (
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(239,68,68,0.12)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </div>
              ) : (
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(2,116,251,0.12)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
                  <span className="spinner-small" style={{ width: 24, height: 24 }} />
                </div>
              )}
            </div>
            
            <div style={{ fontSize: 18, fontWeight: 600, color: '#fff', marginBottom: 6 }}>
              {txStatus.stage === 'executed' ? 'Warp Complete' :
               txStatus.stage === 'failed' ? 'Warp Failed' : 'Warping...'}
            </div>
            <div style={{ fontSize: 13, color: '#6b6b6b', marginBottom: 20 }}>
              {txStatus.message}
            </div>

            {txStatus.txSig && (
              <a
                href={getTxExplorerUrl(direction === 'solana-to-x1' ? 'Solana' : 'X1 Mainnet', txStatus.txSig)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 13, color: '#0274fb', textDecoration: 'none' }}
              >
                View transaction →
              </a>
            )}
          </div>
        )}

        {/* Button — pushed to bottom via margin-top auto */}
        <div className="send-bottom-action" style={{ flexShrink: 0 }}>
          {txStatus.stage === 'executed' || txStatus.stage === 'failed' ? (
            <button
              className="btn-primary"
              onClick={() => {
                setTxSignature(null);
                setTxStatus({ stage: 'idle' });
                setAmount('');
                setError('');
              }}
            >
              {txStatus.stage === 'executed' ? 'Done' : 'Try Again'}
            </button>
          ) : txStatus.stage !== 'idle' ? null : (
            <button
              className="btn-primary"
              onClick={handleBridgeClick}
              disabled={loading || !amount || parseFloat(amount) <= 0}
            >
              {loading ? (
                <span className="btn-loading"><span className="spinner-small" /></span>
              ) : (
                'Review Warp'
              )}
            </button>
          )}
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirm && (() => {
        const isSolToX1 = direction === 'solana-to-x1';
        const fromToken = isSolToX1 ? 'USDC' : 'USDC.X';
        const toToken = isSolToX1 ? 'USDC.X' : 'USDC';
        const fromChain = isSolToX1 ? 'Solana' : 'X1 Mainnet';
        const toChain = isSolToX1 ? 'X1 Mainnet' : 'Solana';
        const pctFee = (inputAmount * bridgeFees.pctFeeBps / 10000);
        const totalFee = bridgeFees.flatFee + pctFee;
        const receiveAmountNet = Math.max(0, inputAmount - totalFee);
        
        return (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: '#000000', zIndex: 9999,
            display: 'flex', flexDirection: 'column'
          }}>
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)',
              position: 'relative', minHeight: 48
            }}>
              <button onClick={() => setShowConfirm(false)} style={{
                background: 'transparent', border: 'none', color: '#8b8b8b',
                cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center',
                position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)'
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
              </button>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: '#fff', margin: 0 }}>Confirm Warp</h3>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
              {/* Amount display */}
              <div style={{ textAlign: 'center', padding: '20px 0 24px' }}>
                <div style={{ fontSize: 32, fontWeight: 600, color: '#fff', marginBottom: 4 }}>
                  {inputAmount} {fromToken}
                </div>
                <div style={{ fontSize: 13, color: '#6b6b6b' }}>
                  {fromChain} → {toChain}
                </div>
              </div>

              {/* Details section */}
              <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                {/* You send */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ fontSize: 13, color: '#6b6b6b' }}>You send</span>
                  <span style={{ fontSize: 13, color: '#fff', fontWeight: 500 }}>{inputAmount} {fromToken}</span>
                </div>

                {/* Bridge fee */}
                {(bridgeFees.flatFee > 0 || bridgeFees.pctFeeBps > 0) ? (
                  <>
                    {bridgeFees.flatFee > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <span style={{ fontSize: 13, color: '#6b6b6b' }}>Flat fee</span>
                        <span style={{ fontSize: 13, color: '#fff', fontWeight: 500 }}>{bridgeFees.flatFee.toFixed(2)} {fromToken}</span>
                      </div>
                    )}
                    {bridgeFees.pctFeeBps > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <span style={{ fontSize: 13, color: '#6b6b6b' }}>Fee ({(bridgeFees.pctFeeBps / 100).toFixed(2)}%)</span>
                        <span style={{ fontSize: 13, color: '#fff', fontWeight: 500 }}>{pctFee.toFixed(4)} {fromToken}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ fontSize: 13, color: '#6b6b6b' }}>Bridge fee</span>
                    <span style={{ fontSize: 13, color: '#22c55e', fontWeight: 500 }}>Free</span>
                  </div>
                )}

                {/* You receive */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ fontSize: 13, color: '#6b6b6b' }}>You receive</span>
                  <span style={{ fontSize: 13, color: '#fff', fontWeight: 600 }}>≈ {receiveAmountNet.toFixed(2)} {toToken}</span>
                </div>

                {/* Network fee */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ fontSize: 13, color: '#6b6b6b' }}>Network fee</span>
                  <span style={{ fontSize: 13, color: '#6b6b6b' }}>{isSolToX1 ? '< 0.001 SOL' : '< 0.001 XN'}</span>
                </div>

                {/* Estimated time */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0' }}>
                  <span style={{ fontSize: 13, color: '#6b6b6b' }}>Estimated time</span>
                  <span style={{ fontSize: 13, color: '#6b6b6b' }}>2–5 min</span>
                </div>
              </div>
            </div>

            {/* Bottom action */}
            <div style={{ padding: '12px 20px 20px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <button
                onClick={handleBridge}
                style={{
                  width: '100%', padding: '14px 20px',
                  background: '#0274fb', border: 'none', borderRadius: 12,
                  color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer'
                }}
              >
                Confirm Warp
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}