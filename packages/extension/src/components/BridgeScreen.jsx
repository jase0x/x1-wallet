// Bridge Screen - USDC → USDC.X Cross-chain Bridge
import { logger, getUserFriendlyError, ErrorMessages } from '@x1-wallet/core';
// Redesigned to match X1 Bridge UI
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getTxExplorerUrl } from '@x1-wallet/core/services/networks';
import { hardwareWallet } from '../services/hardware';

// Bridge API Configuration
const BRIDGE_API_URL = 'https://bridge-alpha.x1.xyz';
const SOLANA_RPC_URL = 'https://jessamine-463apc-fast-mainnet.helius-rpc.com';

// Bridge Deposit Address - the USDC token account guardians monitor on Solana
const BRIDGE_DEPOSIT_ADDRESS = '6ob9XW6f6mweGu5sGh3JwW2Vp6UNQApjuPvrubXMQXyi';

// USDC Token Config (Solana Mainnet)
const USDC_SOLANA_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DECIMALS = 6;
const USDC_LOGO = 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png';

// SPL Token Program ID
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

// X1 Logo URL
const X1_LOGO_URL = '/icons/48-x1.png';

// Solana Logo URL
const SOLANA_LOGO_URL = '/icons/48-sol.png';

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

export default function BridgeScreen({ wallet, onBack }) {
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
  
  // Transaction tracking
  const [txSignature, setTxSignature] = useState(null);
  const [txStatus, setTxStatus] = useState({ stage: 'idle' });
  const [bridgeDepositAddress, setBridgeDepositAddress] = useState(BRIDGE_DEPOSIT_ADDRESS);
  const eventSourceRef = useRef(null);

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
        fetch(`${BRIDGE_API_URL}/config`),
        fetch(`${BRIDGE_API_URL}/guardians`)
      ]);

      if (!configRes.ok || !guardiansRes.ok) {
        setBridgeStatus({ status: 'offline', message: 'API offline' });
        return;
      }

      const config = await configRes.json();
      const guardians = await guardiansRes.json();
      
      logger.log('[Bridge] Config:', config);
      
      // Try to get deposit address from config
      if (config.config?.depositAddress) {
        logger.log('[Bridge] Got deposit address from API:', config.config.depositAddress);
        setBridgeDepositAddress(config.config.depositAddress);
      } else if (config.config?.usdcTokenAccount) {
        logger.log('[Bridge] Got USDC token account from API:', config.config.usdcTokenAccount);
        setBridgeDepositAddress(config.config.usdcTokenAccount);
      }

      // Parse daily cap (stored as micro-units with 6 decimals)
      const capValue = BigInt(config.config?.dailyCap || '0');
      const releasedValue = BigInt(config.config?.releasedToday || '0');
      const remaining = capValue - releasedValue;
      
      setDailyCap(Number(capValue) / 1_000_000);
      setDailyCapRemaining(Number(remaining) / 1_000_000);
      setThreshold(config.config?.threshold || 2);

      const healthy = guardians.healthyCount || 0;
      const total = guardians.totalGuardians || 3;
      setHealthyGuardians(healthy);
      setTotalGuardians(total);

      // Check bridge status
      if (config.config?.paused) {
        setBridgeStatus({ status: 'paused', message: 'Bridge paused' });
        return;
      }

      const requiredThreshold = config.config?.threshold || 2;

      if (healthy > requiredThreshold) {
        setBridgeStatus({ status: 'live', message: `${healthy}/${total} guardians healthy` });
      } else if (healthy === requiredThreshold) {
        setBridgeStatus({ status: 'degraded', message: `${healthy}/${total} guardians healthy` });
      } else {
        setBridgeStatus({ status: 'offline', message: `${healthy}/${total} guardians healthy` });
      }
    } catch (err) {
      logger.error('[Bridge] Config fetch error:', err);
      setBridgeStatus({ status: 'offline', message: 'Unable to connect' });
    }
  }, []);

  // Fetch user's USDC balance on Solana
  const fetchUsdcBalance = useCallback(async () => {
    if (!walletAddress) {
      setUserUsdcBalance(0);
      return;
    }

    logger.log('[Bridge] Fetching USDC balance for:', walletAddress);
    setFetchingBalance(true);
    try {
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
    } catch (err) {
      logger.error('[Bridge] Failed to fetch USDC balance:', err);
    } finally {
      setFetchingBalance(false);
    }
  }, [walletAddress]);

  // Initialize and refresh periodically
  useEffect(() => {
    fetchBridgeConfig();
    fetchUsdcBalance();
    
    const configInterval = setInterval(fetchBridgeConfig, 30000);
    const balanceInterval = setInterval(fetchUsdcBalance, 15000);
    
    return () => {
      clearInterval(configInterval);
      clearInterval(balanceInterval);
    };
  }, [fetchBridgeConfig, fetchUsdcBalance]);

  // SSE listener for transaction status updates
  useEffect(() => {
    if (!txSignature) return;

    logger.log('[Bridge] Starting SSE listener for:', txSignature.slice(0, 8));
    
    const eventSource = new EventSource(`${BRIDGE_API_URL}/transactions/stream`);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      logger.log('[Bridge] SSE connection opened');
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Only process events for our transaction
        if (data.txSig === txSignature) {
          logger.log('[Bridge] SSE event:', data.type);
          
          switch (data.type) {
            case 'transaction_detected':
              setTxStatus({
                stage: 'detected',
                message: 'Transaction detected by guardians'
              });
              break;
              
            case 'signature_added':
              setTxStatus({
                stage: 'signing',
                signatures: data.signatureCount,
                threshold: data.threshold,
                message: `Guardian ${data.signatureCount}/${data.threshold} signed`
              });
              break;
              
            case 'threshold_reached':
              setTxStatus({
                stage: 'threshold',
                signatures: data.signatureCount,
                threshold: data.threshold,
                message: 'Threshold reached! Submitting to X1...'
              });
              break;
              
            case 'transaction_submitted':
              setTxStatus({
                stage: 'confirming',
                x1TxSig: data.x1TxSig,
                message: 'Submitted to X1, confirming...'
              });
              break;
              
            case 'transaction_executed':
              setTxStatus({
                stage: 'executed',
                x1TxSig: data.x1TxSig,
                message: 'Complete! USDC.X received on X1.'
              });
              setLoading(false);
              eventSource.close();
              fetchUsdcBalance();
              break;
          }
        }
      } catch (err) {
        logger.error('[Bridge] SSE parse error:', err);
      }
    };

    eventSource.onerror = () => {
      logger.error('[Bridge] SSE connection error');
    };

    // Cleanup
    return () => {
      eventSource.close();
    };
  }, [txSignature, fetchUsdcBalance]);

  // Handle bridge - executes SPL token transfer to bridge deposit address
  const handleBridge = async () => {
    if (!walletAddress || (!privateKey && !isHardwareWallet)) {
      setError('Wallet not connected');
      return;
    }
    
    if (!userUsdcTokenAccount) {
      setError('No USDC token account found. Please refresh balance.');
      return;
    }
    
    // Check SOL balance for transaction fees
    const solBalance = wallet?.balance || 0;
    if (solBalance < 0.000005) {
      setError('Insufficient SOL for transaction fee. You need ~0.00001 SOL.');
      return;
    }
    
    if (!amount || inputAmount <= 0) {
      setError('Enter an amount to bridge');
      return;
    }
    if (inputAmount < 0.01) {
      setError('Minimum amount is 0.01 USDC');
      return;
    }
    // Use integer comparison to avoid floating-point precision issues
    const multiplier = Math.pow(10, USDC_DECIMALS);
    const requiredAmount = Math.round(inputAmount * multiplier);
    const availableAmount = Math.round(userUsdcBalance * multiplier);
    
    if (requiredAmount > availableAmount) {
      setError(`Insufficient USDC balance. Required: ${inputAmount} USDC, Available: ${userUsdcBalance} USDC`);
      return;
    }
    if (inputAmount > dailyCapRemaining) {
      setError('Exceeds daily bridge capacity');
      return;
    }
    if (bridgeStatus.status !== 'live' && bridgeStatus.status !== 'degraded') {
      setError('Bridge is not available');
      return;
    }

    setLoading(true);
    setError('');
    setTxStatus({ stage: 'idle', message: 'Preparing transaction...' });

    try {
      // Get recent blockhash from Solana
      logger.log('[Bridge] Getting blockhash from Solana...');
      const blockhashResponse = await fetch(SOLANA_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getLatestBlockhash',
          params: [{ commitment: 'finalized' }]
        })
      });
      
      const blockhashData = await blockhashResponse.json();
      if (blockhashData.error) {
        throw new Error(blockhashData.error.message || 'Failed to get blockhash');
      }
      
      const blockhash = blockhashData.result?.value?.blockhash;
      if (!blockhash) {
        throw new Error('Failed to get blockhash');
      }
      logger.log('[Bridge] Blockhash:', blockhash);

      // Convert amount to lamports (6 decimals for USDC)
      const tokenAmount = Math.floor(inputAmount * Math.pow(10, USDC_DECIMALS));
      logger.log('[Bridge] Token amount:', tokenAmount);
      logger.log('[Bridge] User token account:', userUsdcTokenAccount);
      logger.log('[Bridge] Bridge deposit address:', bridgeDepositAddress);

      // Note: We skip verification here - if the deposit account doesn't exist,
      // the SPL token transfer will fail with a clear error from Solana

      // Import only sign function
      const { sign } = await import('@x1-wallet/core/utils/bip44');
      
      // Decode all keys using local functions
      const ownerBytes = decodeToFixedSize(walletAddress, 32);
      const sourceBytes = decodeToFixedSize(userUsdcTokenAccount, 32);
      const destBytes = decodeToFixedSize(bridgeDepositAddress, 32);
      const programBytes = decodeToFixedSize(TOKEN_PROGRAM_ID, 32);
      const blockhashBytes = decodeToFixedSize(blockhash, 32);
      
      // Message header: 1 signer, 0 readonly signed, 1 readonly unsigned
      const header = new Uint8Array([1, 0, 1]);
      
      // Account keys: owner, source, dest, program
      const accountKeys = new Uint8Array(32 * 4);
      accountKeys.set(ownerBytes, 0);
      accountKeys.set(sourceBytes, 32);
      accountKeys.set(destBytes, 64);
      accountKeys.set(programBytes, 96);
      
      // Token Transfer instruction: type 3 + amount as u64 LE
      const instructionData = new Uint8Array(9);
      instructionData[0] = 3; // Transfer instruction
      const amountBI = BigInt(tokenAmount);
      for (let i = 0; i < 8; i++) {
        instructionData[1 + i] = Number((amountBI >> BigInt(i * 8)) & BigInt(0xff));
      }
      
      // Instruction: program_idx, num_accounts, account_indices, data_len, data
      const instruction = new Uint8Array([
        3, 3, 1, 2, 0, 9, ...instructionData
      ]);
      
      // Build message
      const messageLength = 3 + 1 + 128 + 32 + 1 + instruction.length;
      const message = new Uint8Array(messageLength);
      
      let offset = 0;
      message.set(header, offset); offset += 3;
      message[offset] = 4; offset += 1;
      message.set(accountKeys, offset); offset += 128;
      message.set(blockhashBytes, offset); offset += 32;
      message[offset] = 1; offset += 1;
      message.set(instruction, offset);
      
      logger.log('[Bridge] Message built, length:', message.length);
      
      // Sign the message - hardware wallet or software wallet
      let ed25519Signature;
      if (isHardwareWallet) {
        logger.log('[Bridge] Signing with hardware wallet...');
        setTxStatus({ stage: 'idle', message: 'Please confirm on your Ledger device...' });
        
        // Ledger expects just the message (transaction payload), not the full serialized tx
        ed25519Signature = await hardwareWallet.signTransaction(message, derivationPath);
      } else {
        // Decode private key for software wallet
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
      
      // Serialize: [1 byte: num_signatures] [64 bytes: signature] [message]
      const signedTx = new Uint8Array(1 + 64 + message.length);
      signedTx[0] = 1;
      signedTx.set(ed25519Signature, 1);
      signedTx.set(message, 65);
      
      const tx = btoa(String.fromCharCode(...signedTx));
      logger.log('[Bridge] Transaction ready, sending...');
      setTxStatus({ stage: 'idle', message: 'Sending transaction...' });

      // Send transaction with skipPreflight to see actual error
      const sendResponse = await fetch(SOLANA_RPC_URL, {
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
        throw new Error(sendData.error.message || 'Transaction failed');
      }
      
      const signature = sendData.result;
      logger.log('[Bridge] Transaction sent:', signature);
      
      // Set signature to trigger SSE listener
      setTxSignature(signature);
      setTxStatus({
        stage: 'detected',
        txSig: signature,
        message: 'Transaction sent! Waiting for guardians...'
      });
      
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
    if (userUsdcBalance > 0) {
      const maxAmount = Math.min(userUsdcBalance, dailyCapRemaining);
      setAmount(maxAmount.toFixed(2));
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

  // Check if user is on Solana network
  const isSolana = wallet?.network?.includes('Solana');

  // If not on Solana, show network switch prompt
  if (!isSolana) {
    return (
      <div style={styles.screen}>
        {/* Header */}
        <div className="page-header">
          <div className="header-left">
            <button className="back-btn" onClick={onBack}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
          <h2 className="header-title">X1 Bridge</h2>
        </div>

        {/* Network Warning */}
        <div style={styles.content}>
          <div style={{
            padding: 24,
            textAlign: 'center'
          }}>
            <div style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: 'rgba(239, 68, 68, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px'
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h3 style={{ color: '#fff', fontSize: 18, marginBottom: 8 }}>
              Switch to Solana Network
            </h3>
            <p style={{ color: '#8b8b8b', fontSize: 14, lineHeight: 1.5, marginBottom: 20 }}>
              The bridge transfers USDC from <strong style={{ color: '#fff' }}>Solana</strong> to <strong style={{ color: '#fff' }}>X1</strong>. 
              Please switch to Solana Mainnet to use the bridge.
            </p>
            <div style={{
              display: 'flex',
              gap: 12,
              justifyContent: 'center',
              marginBottom: 16
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                background: '#111',
                borderRadius: 8
              }}>
                <SolanaLogo size={20} />
                <span style={{ color: '#fff', fontSize: 14 }}>Solana</span>
              </div>
              <div style={{ color: '#6b6b6b', alignSelf: 'center' }}>→</div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                background: '#111',
                borderRadius: 8
              }}>
                <X1LogoSmall size={20} />
                <span style={{ color: '#fff', fontSize: 14 }}>X1</span>
              </div>
            </div>
            <p style={{ color: '#6b6b6b', fontSize: 12, marginBottom: 24 }}>
              Current network: <span style={{ color: '#ef4444' }}>{wallet?.network || 'Unknown'}</span>
            </p>
            <button 
              className="btn-primary"
              onClick={() => onBack && onBack('network')}
              style={{ width: 'auto', padding: '12px 32px' }}
            >
              Switch to Solana Mainnet
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="screen bridge-screen">
      {/* Header */}
      <div className="page-header">
        <div className="header-left">
          <button className="back-btn" onClick={onBack}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
        <h2 className="header-title">Bridge</h2>
        <div className="header-right" />
      </div>

      {/* Content - scrollable */}
      <div className="main-content" style={{ padding: '0 20px' }}>
        <div className="send-step-content send-amount-step">
          {/* From/To Display */}
          <div className="bridge-route-display">
            <div className="bridge-route-chain">
              <SolanaLogo size={24} />
              <span>Solana</span>
            </div>
            <div className="bridge-route-arrow">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </div>
            <div className="bridge-route-chain">
              <X1LogoSmall size={24} />
              <span>X1</span>
            </div>
          </div>

          {/* Amount Input - matching send flow style */}
          <div className="send-amount-section">
            <input
              type="text"
              inputMode="decimal"
              className="send-amount-input"
              placeholder="0"
              value={amount}
              onChange={e => { setAmount(e.target.value.replace(/[^0-9.]/g, '')); setError(''); }}
              disabled={loading}
            />
            <div className="send-amount-token">
              <UsdcLogo size={24} />
              <span>USDC</span>
            </div>
          </div>

          {/* Balance/Max Button */}
          <button 
            className="send-max-pill"
            onClick={setMaxAmount}
            type="button"
            disabled={fetchingBalance}
          >
            {fetchingBalance ? 'Loading...' : `Balance: ${formatNumber(userUsdcBalance)} USDC`}
          </button>

          {/* Receive Preview */}
          {amount && parseFloat(amount) > 0 && (
            <>
              <div className="bridge-arrow-down">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12l7 7 7-7" />
                </svg>
              </div>
              <div className="bridge-receive-preview">
                <span className="bridge-receive-value">{amount} USDC.X</span>
                <span className="bridge-receive-chain">on X1 Mainnet</span>
              </div>
            </>
          )}

          {/* Transaction Status (when active) */}
          {txStatus.stage !== 'idle' && (
            <div className="bridge-tx-status">
              <div className="bridge-tx-header">
                <span>Status</span>
                <span style={{ color: getTxStageInfo().color }}>{getTxStageInfo().label}</span>
              </div>
              
              {txStatus.signatures !== undefined && (
                <div className="bridge-signatures">
                  <div className="bridge-sig-label">
                    <span>Guardian Signatures</span>
                    <span>{txStatus.signatures}/{txStatus.threshold || threshold}</span>
                  </div>
                  <div className="bridge-sig-dots">
                    {Array.from({ length: txStatus.threshold || threshold }).map((_, i) => (
                      <div
                        key={i}
                        className={`bridge-sig-dot ${i < txStatus.signatures ? 'filled' : ''}`}
                      />
                    ))}
                  </div>
                </div>
              )}
              
              {txStatus.x1TxSig && (
                <a
                  href={getTxExplorerUrl('X1 Mainnet', txStatus.x1TxSig)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bridge-tx-link"
                >
                  View on Explorer →
                </a>
              )}
              
              {txStatus.message && (
                <div className="bridge-tx-message">{txStatus.message}</div>
              )}
            </div>
          )}

          {/* Error Message */}
          {error && <div className="error-message">{error}</div>}

          {/* Bridge Button */}
          <div className="send-bottom-action">
            <button
              className="btn-primary"
              onClick={handleBridge}
              disabled={loading || !amount || parseFloat(amount) <= 0 || (bridgeStatus.status !== 'live' && bridgeStatus.status !== 'degraded')}
            >
              {loading ? (
                <span className="btn-loading"><span className="spinner-small" /></span>
              ) : bridgeStatus.status === 'offline' || bridgeStatus.status === 'paused' ? (
                'Bridge Unavailable'
              ) : (
                'Bridge to X1'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}