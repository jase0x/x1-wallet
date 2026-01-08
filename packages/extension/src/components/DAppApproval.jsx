// DAppApproval.jsx - Handle dApp connection and signing requests
import React, { useState, useEffect, useRef } from 'react';
import * as crypto from '@x1-wallet/core/utils/crypto';
import * as base58 from '@x1-wallet/core/utils/base58';
import { logger, getUserFriendlyError, ErrorMessages } from '@x1-wallet/core';
import { hardwareWallet } from '../services/hardware';

// Transaction priority options (same as SendFlow)
const PRIORITY_OPTIONS = [
  { id: 'auto', name: 'Auto', fee: 0, description: 'Standard speed' },
  { id: 'fast', name: 'Fast', fee: 0.000005, description: 'Higher priority' },
  { id: 'turbo', name: 'Turbo', fee: 0.00005, description: 'Very high priority' },
  { id: 'degen', name: 'Degen', fee: 0.001, description: 'Maximum priority' },
  { id: 'custom', name: 'Custom', fee: 0, description: 'Set your own fee' }
];

// Known program IDs for X1/Solana
const KNOWN_PROGRAMS = {
  '11111111111111111111111111111111': { name: 'System Program', safe: true },
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA': { name: 'Token Program', safe: true },
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb': { name: 'Token-2022 Program', safe: true },
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL': { name: 'Associated Token Program', safe: true },
  'ComputeBudget111111111111111111111111111111': { name: 'Compute Budget', safe: true },
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr': { name: 'Memo Program', safe: true },
  'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo': { name: 'Memo Program v1', safe: true },
  // Wrapped SOL mint (used in XNT wrapping/unwrapping)
  'So11111111111111111111111111111111111111112': { name: 'Wrapped SOL/XNT', safe: true },
};

// Trusted dApp origins - don't show "unknown program" warning for these
// Uses partial matching so 'x1.xyz' matches 'app.x1.xyz', 'staging.x1.xyz', etc.
const TRUSTED_DAPP_ORIGINS = [
  'x1.xyz',      // Matches all *.x1.xyz
  'xdex.xyz',    // Matches all *.xdex.xyz
];

// System program instruction types
const SYSTEM_INSTRUCTIONS = {
  0: 'Create Account',
  1: 'Assign',
  2: 'Transfer',
  3: 'Create Account with Seed',
  4: 'Advance Nonce',
  5: 'Withdraw Nonce',
  6: 'Initialize Nonce',
  7: 'Authorize Nonce',
  8: 'Allocate',
  9: 'Allocate with Seed',
  10: 'Assign with Seed',
  11: 'Transfer with Seed',
  12: 'Upgrade Nonceless Account'
};

// Token program instruction types
const TOKEN_INSTRUCTIONS = {
  0: 'Initialize Mint',
  1: 'Initialize Account',
  2: 'Initialize Multisig',
  3: 'Transfer',
  4: 'Approve',
  5: 'Revoke',
  6: 'Set Authority',
  7: 'Mint To',
  8: 'Burn',
  9: 'Close Account',
  10: 'Freeze Account',
  11: 'Thaw Account',
  12: 'Transfer Checked',
  13: 'Approve Checked',
  14: 'Mint To Checked',
  15: 'Burn Checked',
  16: 'Initialize Account 2',
  17: 'Sync Native',
  18: 'Initialize Account 3',
};

// Compute Budget instruction types
const COMPUTE_BUDGET_INSTRUCTIONS = {
  0: 'Request Heap Frame',
  1: 'Set Compute Unit Limit', // Legacy
  2: 'Set Compute Unit Limit',
  3: 'Set Compute Unit Price',
};

/**
 * Read a compact-u16 encoded value from a buffer
 * Solana uses compact-u16 for array lengths and other variable-length integers
 */
function readCompactU16(buffer, offset) {
  let value = 0;
  let shift = 0;
  let bytesRead = 0;
  
  while (offset + bytesRead < buffer.length) {
    const byte = buffer[offset + bytesRead];
    bytesRead++;
    
    value |= (byte & 0x7f) << shift;
    
    if ((byte & 0x80) === 0) {
      break;
    }
    shift += 7;
    
    // Prevent infinite loop
    if (bytesRead > 3) break;
  }
  
  return { value, bytesRead };
}

/**
 * Detect if transaction is versioned (V0) or legacy
 */
function isVersionedTransaction(txBytes, messageStart) {
  // In versioned transactions, the first byte of the message has the high bit set
  // and the lower 7 bits indicate the version (0 for V0)
  const firstMessageByte = txBytes[messageStart];
  // Check if high bit is set (0x80) - indicates versioned transaction
  return (firstMessageByte & 0x80) !== 0;
}

/**
 * Decode transaction to show user-friendly details (X1W-003)
 * Supports both legacy and versioned (V0) transaction formats
 * @param {Uint8Array} txBytes - Raw transaction bytes
 * @returns {Object} Decoded transaction details
 */
function decodeTransaction(txBytes) {
  try {
    // Read number of signatures using compact-u16
    const sigCountResult = readCompactU16(txBytes, 0);
    const numSignatures = sigCountResult.value;
    const messageStart = sigCountResult.bytesRead + (numSignatures * 64);
    
    if (messageStart >= txBytes.length) {
      return { success: false, error: 'Invalid transaction: message start beyond buffer', raw: true };
    }
    
    const message = txBytes.slice(messageStart);
    
    // Detect versioned vs legacy transaction
    const isVersioned = isVersionedTransaction(txBytes, messageStart);
    
    let accountKeys = [];
    let instructions = [];
    let offset = 0;
    let numRequiredSignatures = 0;
    let numReadonlySignedAccounts = 0;
    let numReadonlyUnsignedAccounts = 0;
    let hasAddressLookupTables = false;
    
    if (isVersioned) {
      // Versioned transaction (V0)
      const version = message[0] & 0x7f; // Lower 7 bits are version
      offset = 1;
      
      if (version !== 0) {
        // We only support V0 for now
        return {
          success: true,
          isVersioned: true,
          version,
          instructions: [{ programName: `Versioned Transaction (V${version})`, isKnownSafe: true }],
          hasUnknownPrograms: false,
          note: `Transaction version ${version} - details not fully decoded`
        };
      }
      
      // Parse V0 message header
      numRequiredSignatures = message[offset];
      numReadonlySignedAccounts = message[offset + 1];
      numReadonlyUnsignedAccounts = message[offset + 2];
      offset += 3;
      
      // Read static account keys using compact-u16 length
      const staticKeysResult = readCompactU16(message, offset);
      const numStaticKeys = staticKeysResult.value;
      offset += staticKeysResult.bytesRead;
      
      for (let i = 0; i < numStaticKeys && offset + 32 <= message.length; i++) {
        const key = message.slice(offset, offset + 32);
        accountKeys.push(base58.encode(key));
        offset += 32;
      }
      
      // Skip recent blockhash (32 bytes)
      offset += 32;
      
      // Parse instructions using compact-u16 for counts
      const numInstructionsResult = readCompactU16(message, offset);
      const numInstructions = numInstructionsResult.value;
      offset += numInstructionsResult.bytesRead;
      
      for (let i = 0; i < numInstructions && offset < message.length; i++) {
        const programIdIndex = message[offset];
        offset += 1;
        
        const numAccountsResult = readCompactU16(message, offset);
        const numAccounts = numAccountsResult.value;
        offset += numAccountsResult.bytesRead;
        
        const accountIndices = [];
        for (let j = 0; j < numAccounts && offset < message.length; j++) {
          accountIndices.push(message[offset]);
          offset += 1;
        }
        
        const dataLenResult = readCompactU16(message, offset);
        const dataLen = dataLenResult.value;
        offset += dataLenResult.bytesRead;
        
        const data = message.slice(offset, offset + dataLen);
        offset += dataLen;
        
        // Get program ID - may be from static keys or lookup table
        const programId = programIdIndex < accountKeys.length 
          ? accountKeys[programIdIndex] 
          : null;
        
        const instruction = decodeInstruction(programId, accountIndices, data, accountKeys);
        instructions.push(instruction);
      }
      
      // Check for address lookup tables (after instructions)
      if (offset < message.length) {
        const numALTsResult = readCompactU16(message, offset);
        hasAddressLookupTables = numALTsResult.value > 0;
      }
      
    } else {
      // Legacy transaction format
      numRequiredSignatures = message[0];
      numReadonlySignedAccounts = message[1];
      numReadonlyUnsignedAccounts = message[2];
      
      // Read number of accounts using compact-u16
      const numAccountsResult = readCompactU16(message, 3);
      const numAccounts = numAccountsResult.value;
      offset = 3 + numAccountsResult.bytesRead;
      
      for (let i = 0; i < numAccounts && offset + 32 <= message.length; i++) {
        const key = message.slice(offset, offset + 32);
        accountKeys.push(base58.encode(key));
        offset += 32;
      }
      
      // Skip recent blockhash (32 bytes)
      offset += 32;
      
      // Parse instructions
      const numInstructionsResult = readCompactU16(message, offset);
      const numInstructions = numInstructionsResult.value;
      offset += numInstructionsResult.bytesRead;
      
      for (let i = 0; i < numInstructions && offset < message.length; i++) {
        const programIdIndex = message[offset];
        offset += 1;
        
        const numAccountsResult = readCompactU16(message, offset);
        const numAccountIndices = numAccountsResult.value;
        offset += numAccountsResult.bytesRead;
        
        const accountIndices = [];
        for (let j = 0; j < numAccountIndices && offset < message.length; j++) {
          accountIndices.push(message[offset]);
          offset += 1;
        }
        
        const dataLenResult = readCompactU16(message, offset);
        const dataLen = dataLenResult.value;
        offset += dataLenResult.bytesRead;
        
        const data = message.slice(offset, offset + dataLen);
        offset += dataLen;
        
        const programId = programIdIndex < accountKeys.length 
          ? accountKeys[programIdIndex] 
          : null;
        
        const instruction = decodeInstruction(programId, accountIndices, data, accountKeys);
        instructions.push(instruction);
      }
    }
    
    return {
      success: true,
      isVersioned,
      numSignatures,
      numAccounts: accountKeys.length,
      accounts: accountKeys,
      instructions,
      hasUnknownPrograms: instructions.some(i => !i.isKnownSafe),
      hasAddressLookupTables,
      estimatedFee: 0.000005 * numSignatures
    };
  } catch (e) {
    logger.error('[decodeTransaction] Error:', e);
    return {
      success: false,
      error: 'Could not decode transaction',
      raw: true
    };
  }
}

/**
 * Check if a program ID is the System Program (handles various encodings)
 */
function isSystemProgram(programId) {
  if (!programId) return false;
  // Direct match
  if (programId === '11111111111111111111111111111111') return true;
  // Check if it's all 1s (various lengths due to encoding)
  if (/^1+$/.test(programId) && programId.length >= 30 && programId.length <= 44) return true;
  return false;
}

/**
 * Decode a single instruction based on program ID
 */
function decodeInstruction(programId, accountIndices, data, accountKeys) {
  // Handle case where program ID couldn't be resolved (e.g., from lookup table)
  if (!programId) {
    return {
      programId: 'Lookup Table Reference',
      programName: 'External Program (via Lookup Table)',
      isKnownSafe: true, // Don't warn for lookup table references in standard ops
      accounts: accountIndices.map(idx => accountKeys[idx] || `Index ${idx}`),
      data,
      note: 'Program resolved via Address Lookup Table'
    };
  }
  
  // Check for System Program first (handles encoding variations)
  const isSysProgram = isSystemProgram(programId);
  const programInfo = isSysProgram 
    ? { name: 'System Program', safe: true }
    : KNOWN_PROGRAMS[programId];
  
  const instruction = {
    programId,
    programName: programInfo?.name || 'Unknown Program',
    isKnownSafe: programInfo?.safe || false,
    accounts: accountIndices.map(idx => accountKeys[idx] || `Index ${idx}`),
    data
  };
  
  // Decode System Program instructions
  if (isSysProgram && data.length >= 4) {
    const instructionType = data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24);
    instruction.instructionType = SYSTEM_INSTRUCTIONS[instructionType] || `System Instruction ${instructionType}`;
    
    // Decode transfer amount
    if (instructionType === 2 && data.length >= 12) {
      try {
        const lamports = new DataView(data.buffer, data.byteOffset + 4, 8).getBigUint64(0, true);
        instruction.amount = Number(lamports) / 1e9;
        instruction.recipient = instruction.accounts[1];
      } catch (e) {
        // Ignore decode errors
      }
    }
  }
  
  // Decode Token Program instructions
  if ((programId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' ||
       programId === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') && data.length >= 1) {
    const instructionType = data[0];
    instruction.instructionType = TOKEN_INSTRUCTIONS[instructionType] || `Token Instruction ${instructionType}`;
    
    // Decode token transfer amount
    if ((instructionType === 3 || instructionType === 12) && data.length >= 9) {
      try {
        const amount = new DataView(data.buffer, data.byteOffset + 1, 8).getBigUint64(0, true);
        instruction.tokenAmount = amount.toString();
      } catch (e) {
        // Ignore decode errors
      }
    }
  }
  
  // Decode Compute Budget instructions
  if (programId === 'ComputeBudget111111111111111111111111111111' && data.length >= 1) {
    const instructionType = data[0];
    instruction.instructionType = COMPUTE_BUDGET_INSTRUCTIONS[instructionType] || `Compute Budget ${instructionType}`;
  }
  
  // Decode Associated Token Program
  if (programId === 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL') {
    instruction.instructionType = 'Create Associated Token Account';
  }
  
  return instruction;
}

/**
 * Format address for display
 */
function formatAddr(addr) {
  if (!addr || addr.length < 8) return addr || 'Unknown';
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

export default function DAppApproval({ wallet, onComplete }) {
  const [pendingRequest, setPendingRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [currentNetwork, setCurrentNetwork] = useState(wallet.network || 'X1 Mainnet');
  const [decodedTx, setDecodedTx] = useState(null); // X1W-003: Transaction details
  const [priority, setPriority] = useState('auto');
  const [customFee, setCustomFee] = useState('');
  const [hwStatus, setHwStatus] = useState(''); // Hardware wallet status
  const [ledgerPopupError, setLedgerPopupError] = useState(false); // Ledger popup limitation
  
  // Ref to prevent re-entry into signing functions
  const signingInProgress = useRef(false);

  // Load network from chrome.storage for accuracy
  useEffect(() => {
    const loadNetwork = async () => {
      try {
        const result = await chrome.storage.local.get('x1wallet_network');
        if (result.x1wallet_network) {
          setCurrentNetwork(result.x1wallet_network);
        } else {
          // Fall back to localStorage
          const localNetwork = localStorage.getItem('x1wallet_network');
          setCurrentNetwork(localNetwork || 'X1 Mainnet');
        }
      } catch (e) {
        logger.warn('[DAppApproval] Error loading network:', e);
      }
    };
    loadNetwork();
  }, []);

  // Check for pending request on mount
  useEffect(() => {
    const checkPendingRequest = async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'get-pending-request' });
        // Handle new response format: { request, approvalWindowId }
        const request = response?.request || response;
        logger.log('[DAppApproval] Pending request type:', request?.type);
        
        if (request && request.type) {
          setPendingRequest(request);
          
          // X1W-003: Decode transaction for display
          if (request.transaction) {
            try {
              const txBytes = Uint8Array.from(atob(request.transaction), c => c.charCodeAt(0));
              const decoded = decodeTransaction(txBytes);
              setDecodedTx(decoded);
              logger.log('[DAppApproval] Decoded transaction:', decoded);
            } catch (e) {
              logger.error('[DAppApproval] Failed to decode transaction');
              setDecodedTx({ success: false, raw: true });
            }
          } else if (request.transactions && request.transactions.length > 0) {
            // Decode first transaction for preview
            try {
              const txBytes = Uint8Array.from(atob(request.transactions[0]), c => c.charCodeAt(0));
              const decoded = decodeTransaction(txBytes);
              decoded.totalTransactions = request.transactions.length;
              setDecodedTx(decoded);
            } catch (e) {
              setDecodedTx({ success: false, raw: true, totalTransactions: request.transactions.length });
            }
          }
        } else {
          setPendingRequest(null);
          setDecodedTx(null);
        }
      } catch (err) {
        logger.error('[DAppApproval] Error checking pending request');
        setPendingRequest(null);
      }
      setLoading(false);
    };

    checkPendingRequest();
    const interval = setInterval(checkPendingRequest, 1000);
    return () => clearInterval(interval);
  }, []);

  // Check if hardware wallet
  const isHardwareWallet = wallet?.wallet?.isHardware || 
                           wallet?.activeWallet?.isHardware || 
                           wallet?.isHardware || false;

  // Get secret key from wallet (software wallets only)
  const getSecretKey = () => {
    if (isHardwareWallet) {
      throw new Error('Hardware wallet - use signWithHardware instead');
    }
    const privateKey = wallet.wallet?.privateKey;
    if (!privateKey) throw new Error('No private key');
    
    // Try to parse - could be base58 or JSON array
    try {
      // Try base58 decode first
      return base58.decode(privateKey);
    } catch {
      try {
        // Try JSON array
        return new Uint8Array(JSON.parse(privateKey));
      } catch {
        throw new Error('Invalid private key format');
      }
    }
  };

  // Sign with hardware wallet
  const signWithHardware = async (message) => {
    try {
      setHwStatus('Connecting to Ledger...');
      
      // In popup context, try to use openConnected first (reuse authorized device)
      // This avoids the device picker which can be problematic in popups
      if (!hardwareWallet.isReady()) {
        logger.log('[DAppApproval] Hardware wallet not ready, attempting connection...');
        
        // First, try openConnected to reuse previously authorized device
        try {
          const TransportModule = await import('@ledgerhq/hw-transport-webhid');
          const Transport = TransportModule.default;
          
          // Try to get already connected/authorized device
          let transport = null;
          try {
            transport = await Transport.openConnected();
            logger.log('[DAppApproval] openConnected succeeded');
          } catch (e) {
            logger.log('[DAppApproval] openConnected failed:', e.message);
          }
          
          if (!transport) {
            // No previously connected device - in popup context, this won't work
            // WebHID permissions don't transfer to popup windows
            throw new Error('LEDGER_POPUP_LIMITATION');
          }
          
          // Manually set the transport on hardwareWallet service
          hardwareWallet.transport = transport;
          hardwareWallet.state = 'connected';
        } catch (connectErr) {
          logger.error('[DAppApproval] Transport connection failed:', connectErr);
          
          // Check if this is the popup limitation
          if (connectErr.message === 'LEDGER_POPUP_LIMITATION' || 
              connectErr.message?.includes('Access denied') ||
              connectErr.message?.includes('cancelled') ||
              connectErr.name === 'TransportOpenUserCancelled') {
            throw new Error('LEDGER_POPUP_LIMITATION');
          }
          throw connectErr;
        }
        
        // Now open the Solana app
        await hardwareWallet.openApp();
      }
      
      setHwStatus('Please confirm transaction on Ledger...');
      const signature = await hardwareWallet.signTransaction(message);
      return signature;
    } catch (err) {
      logger.error('[DAppApproval] Hardware signing error:', err);
      
      // Special handling for popup limitation
      if (err.message === 'LEDGER_POPUP_LIMITATION') {
        throw new Error('LEDGER_POPUP_LIMITATION');
      }
      
      if (err.message?.includes('rejected')) {
        throw new Error('Transaction rejected on Ledger');
      }
      if (err.message?.includes('cancelled') || err.message?.includes('No device') || err.message?.includes('Access denied')) {
        throw new Error('LEDGER_POPUP_LIMITATION');
      }
      
      // Session expired - need to reconnect
      if (err.message?.includes('session expired') || err.message?.includes('Ledger session')) {
        throw new Error('LEDGER_POPUP_LIMITATION');
      }
      
      // Disconnect and reset transport on errors that indicate corrupted state
      // This prevents 0x6a81 errors on retry
      const shouldDisconnect = 
        err.message?.includes('already open') ||
        err.message?.includes('0x6a81') ||
        err.message?.includes('UNKNOWN_ERROR') ||
        err.message?.includes('Could not connect') ||
        err.message?.includes('Solana app') ||
        err.message?.includes('not ready') ||
        err.statusCode === 27265 || // 0x6a81
        err.statusCode === 0x6a81 ||
        err.name === 'TransportStatusError';
      
      if (shouldDisconnect) {
        logger.log('[DAppApproval] Disconnecting Ledger due to transport error');
        try { await hardwareWallet.disconnect(); } catch (e) {}
        
        if (err.message?.includes('already open')) {
          throw new Error('Ledger connection conflict. Please try again.');
        }
        
        // For session/transport errors, trigger reconnection flow
        throw new Error('LEDGER_POPUP_LIMITATION');
      }
      
      throw new Error(`Ledger signing failed: ${err.message}`);
    } finally {
      setHwStatus('');
    }
  };

  // Handle reject
  const handleReject = async () => {
    setProcessing(true);
    try {
      const reqType = pendingRequest?.type;

      // Send the correct rejection message type so background can resolve the right pending request.
      // signMessage expects approve-sign-message, connect expects approve-connect.
      let message = { error: 'User rejected the request' };

      if (reqType === 'signMessage') {
        message = { ...message, type: 'approve-sign-message' };
      } else if (reqType === 'connect') {
        message = { ...message, type: 'approve-connect' };
      } else {
        // Covers signTransaction, signAllTransactions, signAndSendTransaction, etc.
        message = { ...message, type: 'approve-sign' };
      }

      await chrome.runtime.sendMessage(message);
    } catch (e) {}
    if (onComplete) onComplete();
    setTimeout(() => window.close(), 300);
  };

  // Handle approve connection
  const handleApproveConnect = async () => {
    setProcessing(true);
    setError(null);
    
    try {
      const publicKey = wallet.wallet?.publicKey;
      const network = currentNetwork; // Use the user-selected network from dropdown
      const chain = networkToChain(network);
      
      if (!publicKey) throw new Error('No wallet available');

      logger.log('[DAppApproval] Connecting with network:', network, 'chain:', chain);
      
      // Save the selected network to storage so wallet stays on this network
      localStorage.setItem('x1wallet_network', network);
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ 'x1wallet_network': network });
      }
      
      // Update wallet context if available
      if (wallet.setNetwork) {
        wallet.setNetwork(network);
      }

      // Send via provider-response with network and chain info
      await chrome.runtime.sendMessage({
        type: 'provider-response',
        payload: { result: { publicKey, network, chain } }
      });
      
      // Track XP for wallet connection (fire and forget)
      try {
        const { trackConnectXP } = await import('@x1-wallet/core/services/xp');
        trackConnectXP({
          user: publicKey,
          network: network,
          dapp: pendingRequest?.origin || 'unknown'
        }).catch(() => { /* XP tracking is non-critical */ });
      } catch (e) {
        // XP tracking is non-critical
      }
      
      if (onComplete) onComplete();
      setTimeout(() => window.close(), 300);
    } catch (err) {
      setError(getUserFriendlyError(err, ErrorMessages.wallet.loadFailed));
      setProcessing(false);
    }
  };

  // Helper: Convert network name to chain identifier
  const networkToChain = (network) => {
    const map = {
      'X1 Mainnet': 'x1:mainnet',
      'X1 Testnet': 'x1:testnet',
      'Solana Mainnet': 'solana:mainnet',
      'Solana Devnet': 'solana:devnet',
      'Solana Testnet': 'solana:testnet'
    };
    return map[network] || 'x1:mainnet';
  };

  // Helper: Convert chain identifier to network name
  const chainToNetwork = (chain) => {
    const map = {
      'x1:mainnet': 'X1 Mainnet',
      'x1:testnet': 'X1 Testnet',
      'solana:mainnet': 'Solana Mainnet',
      'solana:devnet': 'Solana Devnet',
      'solana:testnet': 'Solana Testnet'
    };
    return map[chain] || null;
  };

  // Sign a transaction - the dApp sends serialized tx, we sign it
  const handleSignTransaction = async () => {
    setProcessing(true);
    setError(null);
    
    // Notify background that Ledger is busy (prevents wallet switching during signing)
    if (isHardwareWallet) {
      try {
        await chrome.runtime.sendMessage({ 
          type: 'ledger-busy', 
          busy: true, 
          origin: pendingRequest?.origin 
        });
      } catch (e) {
        logger.warn('[DAppApproval] Failed to set ledger-busy:', e);
      }
    }
    
    try {
      const txBytes = Uint8Array.from(atob(pendingRequest.transaction), c => c.charCodeAt(0));
      
      logger.log('[DAppApproval] Transaction length:', txBytes.length);
      
      // Sign the transaction message
      // The transaction format is: [signature_count(compact-u16), signatures..., message]
      // We need to extract the message part, sign it, and place signature in the right slot
      
      // Parse using compact-u16 for signature count
      const sigCountResult = readCompactU16(txBytes, 0);
      const numSigSlots = sigCountResult.value;
      const sigSlotsStart = sigCountResult.bytesRead;
      const messageStart = sigSlotsStart + (numSigSlots * 64);
      const message = txBytes.slice(messageStart);
      
      logger.log('[DAppApproval] Num sig slots:', numSigSlots, 'Message start:', messageStart);
      
      // Sign the message - hardware or software wallet
      let signature;
      if (isHardwareWallet) {
        signature = await signWithHardware(message);
      } else {
        const secretKey = getSecretKey();
        signature = await crypto.sign(message, secretKey);
      }
      
      // Build signed transaction - preserve original structure
      const signedTx = new Uint8Array(txBytes.length);
      signedTx.set(txBytes); // Copy original
      signedTx.set(signature, sigSlotsStart); // Place signature in first slot
      
      const signedTxBase64 = btoa(String.fromCharCode(...signedTx));
      
      logger.log('[DAppApproval] Transaction signed successfully');
      
      // Send the signed transaction to background
      await chrome.runtime.sendMessage({
        type: 'approve-sign',
        signedTransaction: signedTxBase64
      });
      
      if (onComplete) onComplete();
      setTimeout(() => window.close(), 300);
    } catch (err) {
      logger.error('[DAppApproval] Sign error:', err);
      
      // Special handling for Ledger popup limitation
      if (err.message === 'LEDGER_POPUP_LIMITATION') {
        setLedgerPopupError(true);
        setProcessing(false);
        return;
      }
      
      // Send error back to background so it can clear queue and stop retries
      try {
        await chrome.runtime.sendMessage({
          type: 'approve-sign',
          error: err?.message || 'Transaction signing failed'
        });
      } catch (e) {
        logger.warn('[DAppApproval] Failed to send error to background:', e);
      }
      
      setError(getUserFriendlyError(err, ErrorMessages.transaction.signFailed));
      setProcessing(false);
    } finally {
      // ALWAYS clear Ledger busy state when done (success or failure)
      if (isHardwareWallet) {
        try {
          await chrome.runtime.sendMessage({ type: 'ledger-busy', busy: false });
        } catch (e) {
          logger.warn('[DAppApproval] Failed to clear ledger-busy:', e);
        }
      }
    }
  };

  // Handle sign all transactions
  const handleSignAllTransactions = async () => {
    setProcessing(true);
    setError(null);
    
    // Notify background that Ledger is busy (prevents wallet switching during signing)
    if (isHardwareWallet) {
      try {
        await chrome.runtime.sendMessage({ 
          type: 'ledger-busy', 
          busy: true, 
          origin: pendingRequest?.origin 
        });
      } catch (e) {
        logger.warn('[DAppApproval] Failed to set ledger-busy:', e);
      }
    }
    
    try {
      const signedTxs = [];
      const secretKey = isHardwareWallet ? null : getSecretKey();
      
      for (let i = 0; i < pendingRequest.transactions.length; i++) {
        const tx = pendingRequest.transactions[i];
        const txBytes = Uint8Array.from(atob(tx), c => c.charCodeAt(0));
        
        // Parse using compact-u16 for signature count
        const sigCountResult = readCompactU16(txBytes, 0);
        const numSigSlots = sigCountResult.value;
        const sigSlotsStart = sigCountResult.bytesRead;
        const messageStart = sigSlotsStart + (numSigSlots * 64);
        const message = txBytes.slice(messageStart);
        
        // Sign - hardware or software
        let signature;
        if (isHardwareWallet) {
          if (i === 0) {
            setHwStatus(`Please confirm transaction ${i + 1} of ${pendingRequest.transactions.length} on Ledger...`);
          } else {
            setHwStatus(`Signing transaction ${i + 1} of ${pendingRequest.transactions.length}...`);
          }
          signature = await signWithHardware(message);
        } else {
          signature = await crypto.sign(message, secretKey);
        }
        
        // Build signed transaction - preserve original structure
        const signedTx = new Uint8Array(txBytes.length);
        signedTx.set(txBytes); // Copy original
        signedTx.set(signature, sigSlotsStart); // Place signature in first slot
        
        signedTxs.push(btoa(String.fromCharCode(...signedTx)));
      }
      
      setHwStatus('');
      
      await chrome.runtime.sendMessage({
        type: 'approve-sign',
        signedTransactions: signedTxs
      });
      
      if (onComplete) onComplete();
      setTimeout(() => window.close(), 300);
    } catch (err) {
      logger.error('[DAppApproval] Sign all error:', err);
      
      // Special handling for Ledger popup limitation
      if (err.message === 'LEDGER_POPUP_LIMITATION') {
        setLedgerPopupError(true);
        setProcessing(false);
        return;
      }
      
      // Send error back to background so it can clear queue and stop retries
      try {
        await chrome.runtime.sendMessage({
          type: 'approve-sign',
          error: err?.message || 'Transaction signing failed'
        });
      } catch (e) {
        logger.warn('[DAppApproval] Failed to send error to background:', e);
      }
      
      setError(getUserFriendlyError(err, ErrorMessages.transaction.signFailed));
      setProcessing(false);
    } finally {
      // ALWAYS clear Ledger busy state when done (success or failure)
      if (isHardwareWallet) {
        try {
          await chrome.runtime.sendMessage({ type: 'ledger-busy', busy: false });
        } catch (e) {
          logger.warn('[DAppApproval] Failed to clear ledger-busy:', e);
        }
      }
    }
  };

  // Handle sign and send transaction
  const handleSignAndSendTransaction = async () => {
    setProcessing(true);
    setError(null);
    
    // Notify background that Ledger is busy (prevents wallet switching during signing)
    if (isHardwareWallet) {
      try {
        await chrome.runtime.sendMessage({ 
          type: 'ledger-busy', 
          busy: true, 
          origin: pendingRequest?.origin 
        });
      } catch (e) {
        logger.warn('[DAppApproval] Failed to set ledger-busy:', e);
      }
    }
    
    try {
      const txBytes = Uint8Array.from(atob(pendingRequest.transaction), c => c.charCodeAt(0));
      
      // Log selected priority for reference
      const priorityFeeSOL = priority === 'custom' 
        ? (parseFloat(customFee) || 0) 
        : (PRIORITY_OPTIONS.find(p => p.id === priority)?.fee || 0);
      
      if (priorityFeeSOL > 0) {
        logger.log('[DAppApproval] User selected priority fee:', priorityFeeSOL, 'SOL');
      }
      
      // Get RPC URL based on network
      let rpcUrl;
      if (currentNetwork === 'X1 Mainnet') {
        rpcUrl = 'https://rpc.mainnet.x1.xyz';
      } else if (currentNetwork === 'X1 Testnet') {
        rpcUrl = 'https://rpc.testnet.x1.xyz';
      } else if (currentNetwork === 'Solana Mainnet') {
        rpcUrl = 'https://jessamine-463apc-fast-mainnet.helius-rpc.com';
      } else if (currentNetwork === 'Solana Devnet') {
        rpcUrl = 'https://rose-l3rk46-fast-devnet.helius-rpc.com';
      } else {
        try {
          const customNetworks = JSON.parse(localStorage.getItem('x1wallet_customRpcs') || '[]');
          const customNet = customNetworks.find(n => n.name === currentNetwork);
          if (customNet) {
            rpcUrl = customNet.url;
          } else {
            rpcUrl = 'https://rpc.mainnet.x1.xyz';
          }
        } catch {
          rpcUrl = 'https://rpc.mainnet.x1.xyz';
        }
      }
      
      // Get wallet public key
      const walletPubKey = wallet.wallet?.publicKey;
      logger.log('[DAppApproval] Wallet public key:', walletPubKey);
      
      // Check balance before proceeding
      logger.log('[DAppApproval] Checking balance...');
      const balanceResponse = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getBalance',
          params: [walletPubKey, { commitment: 'confirmed' }]
        })
      });
      
      const balanceData = await balanceResponse.json();
      if (balanceData.error) {
        throw new Error('Failed to check balance: ' + (balanceData.error.message || JSON.stringify(balanceData.error)));
      }
      
      const balanceLamports = balanceData.result?.value || 0;
      const balanceSOL = balanceLamports / 1e9;
      const symbol = currentNetwork?.includes('Solana') ? 'SOL' : 'XNT';
      logger.log('[DAppApproval] Current balance:', balanceSOL, symbol);
      
      // Minimum balance needed for transaction (base fee + buffer)
      const MIN_BALANCE = 0.001; // 0.001 SOL/XNT minimum for fees
      if (balanceSOL < MIN_BALANCE) {
        throw new Error(`Insufficient ${symbol} balance. You have ${balanceSOL.toFixed(6)} ${symbol} but need at least ${MIN_BALANCE} ${symbol} for transaction fees.`);
      }
      
      // Parse transaction to find the message
      // Solana wire format: [num_signatures(compact-u16)] [signatures(64*n)] [message...]
      const sigCountResult = readCompactU16(txBytes, 0);
      const numSigSlots = sigCountResult.value;
      const sigSlotsStart = sigCountResult.bytesRead;
      const messageStart = sigSlotsStart + (numSigSlots * 64);
      const message = txBytes.slice(messageStart);
      
      // Check if versioned transaction (high bit set in first message byte)
      const isVersioned = (message[0] & 0x80) !== 0;
      
      logger.log('[DAppApproval] Tx parsing: numSigSlots=', numSigSlots, 
                 'messageStart=', messageStart, 'isVersioned=', isVersioned,
                 'messageLen=', message.length);
      
      // Extract fee payer from the message (first account key)
      let feePayerOffset;
      if (isVersioned) {
        let tempOffset = 4; // version(1) + header(3)
        const acctResult = readCompactU16(message, tempOffset);
        feePayerOffset = tempOffset + acctResult.bytesRead;
      } else {
        let tempOffset = 3; // header(3)
        const acctResult = readCompactU16(message, tempOffset);
        feePayerOffset = tempOffset + acctResult.bytesRead;
      }
      const feePayerBytes = message.slice(feePayerOffset, feePayerOffset + 32);
      const feePayerKey = base58.encode(feePayerBytes);
      logger.log('[DAppApproval] Fee payer in transaction:', feePayerKey);
      
      if (feePayerKey !== walletPubKey) {
        logger.warn('[DAppApproval] Fee payer mismatch! Wallet:', walletPubKey, 'Fee payer:', feePayerKey);
      }
      
      // Sign the message - hardware or software wallet
      logger.log('[DAppApproval] Signing message... isHardware:', isHardwareWallet);
      let signature;
      if (isHardwareWallet) {
        signature = await signWithHardware(message);
      } else {
        const secretKey = getSecretKey();
        signature = await crypto.sign(message, secretKey);
      }
      logger.log('[DAppApproval] Signature generated, length:', signature.length);
      
      // Build signed transaction - copy original and insert signature
      const signedTx = new Uint8Array(txBytes.length);
      signedTx.set(txBytes);
      signedTx.set(signature, sigSlotsStart);
      
      logger.log('[DAppApproval] Signed tx length:', signedTx.length);
      logger.log('[DAppApproval] Sending to RPC:', rpcUrl);
      
      // First try with simulation enabled to catch errors
      let response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'sendTransaction',
          params: [btoa(String.fromCharCode(...signedTx)), { 
            encoding: 'base64',
            skipPreflight: false,
            preflightCommitment: 'confirmed',
            maxRetries: 5
          }]
        })
      });
      
      let data = await response.json();
      logger.log('[DAppApproval] RPC response:', JSON.stringify(data));
      
      // If blockhash error, retry with skipPreflight (transaction may still succeed)
      if (data.error && data.error.message && data.error.message.includes('Blockhash not found')) {
        logger.log('[DAppApproval] Blockhash expired, retrying with skipPreflight...');
        response = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'sendTransaction',
            params: [btoa(String.fromCharCode(...signedTx)), { 
              encoding: 'base64',
              skipPreflight: true,
              preflightCommitment: 'confirmed',
              maxRetries: 5
            }]
          })
        });
        data = await response.json();
        logger.log('[DAppApproval] Retry RPC response:', JSON.stringify(data));
      }
      
      if (data.error) {
        logger.error('[DAppApproval] RPC error:', data.error);
        throw new Error(data.error.message || JSON.stringify(data.error));
      }
      
      const txSignature = data.result;
      logger.log('[DAppApproval] Transaction signature:', txSignature);
      
      // Record transaction to local history
      try {
        const walletAddress = wallet.wallet?.publicKey;
        const nativeSymbol = currentNetwork?.includes('Solana') ? 'SOL' : 'XNT';
        const dappName = pendingRequest.origin?.replace(/^https?:\/\//, '').split('/')[0] || 'DApp';
        
        // Determine transaction type from instructions
        let txType = 'dapp';
        if (decodedTx?.instructions) {
          const hasWrap = decodedTx.instructions.some(i => 
            i.instructionType === 'Sync Native' || 
            (i.programName === 'Token Program' && i.instructionType === 'Close Account')
          );
          const hasSwap = decodedTx.instructions.length > 3;
          
          if (hasWrap || hasSwap) {
            txType = 'swap';
          }
        }
        
        // Don't record dApp/swap transactions locally - they'll be fetched from blockchain/API
        // with correct amounts. Only log for debugging.
        logger.log('[DAppApproval] Transaction completed:', txSignature, 'type:', txType);
      } catch (e) {
        // Don't fail the transaction if recording fails
        logger.warn('[DAppApproval] Failed to record transaction:', e);
      }
      
      logger.log('[DAppApproval] Sending signature to background:', txSignature);
      
      await chrome.runtime.sendMessage({
        type: 'approve-sign',
        signature: txSignature
      });
      
      logger.log('[DAppApproval] Response sent, closing popup');
      
      if (onComplete) onComplete();
      setTimeout(() => window.close(), 300);
    } catch (err) {
      logger.error('[DAppApproval] Send error:', err.message || err);
      
      // Special handling for Ledger popup limitation
      if (err.message === 'LEDGER_POPUP_LIMITATION') {
        setLedgerPopupError(true);
        setProcessing(false);
        return;
      }
      
      // Send error back to background so it can clear queue and stop retries
      try {
        await chrome.runtime.sendMessage({
          type: 'approve-sign',
          error: err?.message || 'Transaction failed'
        });
      } catch (e) {
        logger.warn('[DAppApproval] Failed to send error to background:', e);
      }
      
      setError(getUserFriendlyError(err, ErrorMessages.transaction.failed));
      setProcessing(false);
    } finally {
      // ALWAYS clear Ledger busy state when done (success or failure)
      if (isHardwareWallet) {
        try {
          await chrome.runtime.sendMessage({ type: 'ledger-busy', busy: false });
        } catch (e) {
          logger.warn('[DAppApproval] Failed to clear ledger-busy:', e);
        }
      }
    }
  };

  // Handle sign message
  const handleSignMessage = async () => {
    // Prevent re-entry - don't allow multiple concurrent sign attempts
    if (signingInProgress.current) {
      logger.warn('[DAppApproval] Sign already in progress, ignoring duplicate call');
      return;
    }
    signingInProgress.current = true;
    
    setProcessing(true);
    setError(null);
    
    // Notify background that Ledger is busy (prevents wallet switching during signing)
    if (isHardwareWallet) {
      try {
        await chrome.runtime.sendMessage({ 
          type: 'ledger-busy', 
          busy: true, 
          origin: pendingRequest?.origin 
        });
      } catch (e) {
        logger.warn('[DAppApproval] Failed to set ledger-busy:', e);
      }
    }
    
    try {
      const messageBytes = Uint8Array.from(atob(pendingRequest.message), c => c.charCodeAt(0));
      
      let signature;
      if (isHardwareWallet) {
        // Sign with hardware wallet
        logger.log('[DAppApproval] Signing message with hardware wallet, bytes:', messageBytes.length);
        signature = await hardwareWallet.signMessage(messageBytes, wallet?.activeWallet?.derivationPath);
        logger.log('[DAppApproval] Hardware signature received:', signature?.length || 'null');
      } else {
        // Sign with software wallet
        const secretKey = getSecretKey();
        signature = await crypto.sign(messageBytes, secretKey);
      }
      
      const signatureBase64 = btoa(String.fromCharCode(...signature));
      
      await chrome.runtime.sendMessage({
        type: 'approve-sign-message',
        signature: signatureBase64
      });
      
      if (onComplete) onComplete();
      setTimeout(() => window.close(), 300);
    } catch (err) {
      // Log full error details
      logger.error('[DAppApproval] Sign message error:', {
        message: err?.message,
        name: err?.name,
        stack: err?.stack,
        statusCode: err?.statusCode
      });

// IMPORTANT: always notify background so it can close the approval window and clear the queue.
const errorMsg = err?.message || err?.toString?.() || 'Unknown error';
try {
  await chrome.runtime.sendMessage({
    type: 'approve-sign-message',
    error: errorMsg
  });
} catch (e) {
  // ignore - background may already be unavailable
}
      
      // Check if this is a Ledger error that needs reconnection
      // If so, show the "Connect Ledger" UI instead of closing
      const isLedgerReconnectError = isHardwareWallet && (
        err.message?.includes('Could not connect') ||
        err.message?.includes('Solana app') ||
        err.message?.includes('session expired') ||
        err.message?.includes('Ledger session') ||
        err.message?.includes('not ready') ||
        err.message?.includes('0x6a81') ||
        err.message?.includes('UNKNOWN_ERROR') ||
        err.message?.includes('Please open') ||
        err.message?.includes('unlock') ||
        err.message?.includes('Ledger not connected') ||
        err.statusCode === 27265 || // 0x6a81
        err.statusCode === 0x6a81 ||
        err.name === 'TransportStatusError'
      );
      
      if (isLedgerReconnectError) {
        logger.log('[DAppApproval] Ledger needs reconnection, showing connect UI');
        // Disconnect to force clean reconnection
        try { await hardwareWallet.disconnect(); } catch (e) {}
        // Show the "Connect Ledger" button UI
        setLedgerPopupError(true);
        setProcessing(false);
        // DON'T send error to background - keep window open for retry
        return;
      }
      
      // For non-recoverable errors (like user rejection), send to background and close
      try {
        await chrome.runtime.sendMessage({
          type: 'approve-sign-message',
          error: err?.message || 'Signing failed'
        });
      } catch (e) {
        logger.warn('[DAppApproval] Failed to send error to background:', e);
      }
      
      setError(getUserFriendlyError(err, ErrorMessages.transaction.signFailed));
      setProcessing(false);
    } finally {
      // ALWAYS clear signing state when done (success or failure)
      signingInProgress.current = false;
      
      // ALWAYS clear Ledger busy state when done (success or failure)
      if (isHardwareWallet) {
        try {
          await chrome.runtime.sendMessage({ type: 'ledger-busy', busy: false });
        } catch (e) {
          logger.warn('[DAppApproval] Failed to clear ledger-busy:', e);
        }
      }
    }
  };

  // Loading state
  if (loading) return null;
  if (!pendingRequest) return null;

  const originDisplay = pendingRequest.origin?.replace(/^https?:\/\//, '').split('/')[0] || 'Unknown';
  
  // Known dApp logos
  const knownLogos = {
    'xdex.xyz': 'https://xdex.s3.us-east-2.amazonaws.com/vimages/XDEX.png',
    'app.xdex.xyz': 'https://xdex.s3.us-east-2.amazonaws.com/vimages/XDEX.png',
    'dev.xdex.xyz': 'https://xdex.s3.us-east-2.amazonaws.com/vimages/XDEX.png',
    'degen.fyi': 'https://xdex.s3.us-east-2.amazonaws.com/vimages/DEGEN.png',
    'x1.xyz': 'https://logo44.s3.us-east-2.amazonaws.com/logos/X1.png',
    'bridge.x1.xyz': 'https://logo44.s3.us-east-2.amazonaws.com/logos/X1.png',
    'vero.x1.xyz': 'https://logo44.s3.us-east-2.amazonaws.com/logos/X1.png',
  };
  
  // Get the best icon URL
  const getIconUrl = () => {
    // Check known logos first
    if (knownLogos[originDisplay]) {
      return knownLogos[originDisplay];
    }
    // Fall back to favicon
    return pendingRequest.favicon;
  };
  
  const iconUrl = getIconUrl();
  
  // Get action handler
  // Click handler with debouncing - prevents multiple clicks before React re-renders
  const handleApproveClick = async () => {
    // Immediately check if already processing (before React state updates)
    if (processing || signingInProgress.current) {
      console.log('[DAppApproval] Ignoring click - already processing');
      return;
    }
    
    const handler = getHandler();
    if (handler) {
      await handler();
    }
  };
  
  const getHandler = () => {
    switch (pendingRequest.type) {
      case 'connect': return handleApproveConnect;
      case 'signTransaction': return handleSignTransaction;
      case 'signAllTransactions': return handleSignAllTransactions;
      case 'signAndSendTransaction': return handleSignAndSendTransaction;
      case 'signMessage': return handleSignMessage;
      default: return handleReject;
    }
  };

  return (
    <div className="dapp-approval-overlay">
      <div className="dapp-approval-container">
        {/* Header with site info */}
        <div className="dapp-site-header">
          <div className="dapp-site-icon">
            {iconUrl ? (
              <img 
                src={iconUrl} 
                alt="" 
                onError={(e) => {
                  e.target.style.display = 'none';
                  if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
                }}
              />
            ) : null}
            <div className="dapp-site-icon-fallback" style={iconUrl ? { display: 'none' } : {}}>
              {originDisplay.charAt(0).toUpperCase()}
            </div>
          </div>
          <div className="dapp-site-info">
            <span className="dapp-site-name">{originDisplay}</span>
            <span className="dapp-site-url">{pendingRequest.origin}</span>
          </div>
        </div>

        {/* Action type badge */}
        <div className={`dapp-action-badge ${pendingRequest.type === 'connect' ? 'connect' : 'sign'}`}>
          {pendingRequest.type === 'connect' ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
              <polyline points="10 17 15 12 10 7"/>
              <line x1="15" y1="12" x2="3" y2="12"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              <polyline points="9 12 11 14 15 10"/>
            </svg>
          )}
          <span>
            {pendingRequest.type === 'connect' ? 'Connect Wallet' : 
             pendingRequest.type === 'signMessage' ? 'Sign Message' :
             pendingRequest.type === 'signAndSendTransaction' ? 'Sign & Send Transaction' : 'Sign Transaction'}
          </span>
        </div>

        {/* Description */}
        <p className="dapp-description">
          {pendingRequest.type === 'connect' 
            ? pendingRequest.chain 
              ? `This site is requesting to connect to your wallet on ${chainToNetwork(pendingRequest.chain) || pendingRequest.chain}.`
              : 'This site is requesting access to view your wallet address and request transaction approvals.'
            : 'This site is requesting your signature for a transaction.'}
        </p>
        
        {/* Show chain mismatch warning */}
        {pendingRequest.type === 'connect' && pendingRequest.chain && networkToChain(currentNetwork) !== pendingRequest.chain && (
          <div className="dapp-chain-warning" style={{
            background: 'rgba(251, 191, 36, 0.1)',
            border: '1px solid rgba(251, 191, 36, 0.3)',
            borderRadius: '8px',
            padding: '12px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2">
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
            </svg>
            <span style={{ color: '#fbbf24', fontSize: '13px' }}>
              Will switch from {currentNetwork} to {chainToNetwork(pendingRequest.chain)}
            </span>
          </div>
        )}
        
        {/* Wallet card */}
        <div className="dapp-wallet-card">
          <div className="dapp-wallet-row">
            <div className="dapp-wallet-label">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
              <span>Account</span>
            </div>
            <span className="dapp-wallet-value">{wallet.wallet?.publicKey?.slice(0, 4)}...{wallet.wallet?.publicKey?.slice(-4)}</span>
          </div>
          <div className="dapp-wallet-row">
            <div className="dapp-wallet-label">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
              <span>Network</span>
            </div>
            {pendingRequest.type === 'connect' ? (
              <select 
                className="dapp-network-select"
                value={currentNetwork}
                onChange={(e) => setCurrentNetwork(e.target.value)}
                style={{
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  padding: '4px 28px 4px 8px',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  fontWeight: 'normal',
                  cursor: 'pointer',
                  minWidth: '140px',
                  textAlign: 'center',
                  textAlignLast: 'center'
                }}
              >
                <optgroup label="X1 Networks">
                  <option value="X1 Mainnet">X1 Mainnet</option>
                  <option value="X1 Testnet">X1 Testnet</option>
                </optgroup>
                <optgroup label="Solana Networks">
                  <option value="Solana Mainnet">Solana Mainnet</option>
                  <option value="Solana Devnet">Solana Devnet</option>
                </optgroup>
              </select>
            ) : (
              <span className="dapp-wallet-value network">
                <span className="network-dot"></span>
                {currentNetwork}
              </span>
            )}
          </div>
        </div>

        {/* Message preview for signMessage */}
        {pendingRequest.type === 'signMessage' && (
          <div className="dapp-message-preview">
            <span className="dapp-message-label">Message to sign:</span>
            <code className="dapp-message-content">
              {(() => { try { return atob(pendingRequest.message).slice(0, 150); } catch { return '(Binary data)'; } })()}
            </code>
          </div>
        )}
        
        {/* Transaction details and Priority Fee - Grid layout */}
        {(pendingRequest.type === 'signTransaction' || 
          pendingRequest.type === 'signAndSendTransaction' || 
          pendingRequest.type === 'signAllTransactions') && decodedTx && (
          <div className="dapp-tx-grid">
            {decodedTx.totalTransactions > 1 && (
              <div className="dapp-tx-warning batch">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                </svg>
                <span>Batch: {decodedTx.totalTransactions} transactions</span>
              </div>
            )}
            
            {decodedTx.hasUnknownPrograms && !TRUSTED_DAPP_ORIGINS.some(domain => pendingRequest?.origin?.includes(domain)) && (
              <div className="dapp-tx-warning">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                </svg>
                <span>Contains unknown program calls</span>
              </div>
            )}
            
            {decodedTx.success && decodedTx.instructions && (
              <details className="dapp-tx-row-details">
                <summary className="dapp-tx-row clickable">
                  <span className="dapp-tx-row-label">Transaction</span>
                  <span className="dapp-tx-row-value">
                    {decodedTx.instructions.length} operation{decodedTx.instructions.length !== 1 ? 's' : ''}
                  </span>
                  <svg className="dapp-tx-row-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </summary>
                <div className="dapp-tx-details-expanded">
                  {decodedTx.instructions.map((instr, idx) => {
                    const isTrustedOrigin = TRUSTED_DAPP_ORIGINS.some(domain => pendingRequest?.origin?.includes(domain));
                    const displayName = instr.instructionType || 
                      (instr.programName === 'Unknown Program' && isTrustedOrigin 
                        ? 'dApp Operation' 
                        : instr.programName);
                    
                    return (
                    <div key={idx} className={`dapp-tx-instruction-item ${instr.isKnownSafe || isTrustedOrigin ? 'safe' : 'unknown'}`}>
                      <span className="dapp-tx-instr-num">{idx + 1}</span>
                      <span className="dapp-tx-instr-name">
                        {displayName}
                      </span>
                      {!instr.isKnownSafe && !isTrustedOrigin && (
                        <span className="dapp-tx-instr-badge">!</span>
                      )}
                      {instr.amount !== undefined && (
                        <span className="dapp-tx-instr-amount">{instr.amount.toFixed(4)}</span>
                      )}
                    </div>
                    );
                  })}
                </div>
              </details>
            )}
            
            {!decodedTx.success && (
              <div className="dapp-tx-warning raw">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 8v4m0 4h.01"/>
                </svg>
                <span>Could not decode transaction.</span>
              </div>
            )}
            
            {/* Estimated Fee Row */}
            <div className="dapp-tx-row">
              <span className="dapp-tx-row-label">Estimated Fee</span>
              <span className="dapp-tx-row-value">{(decodedTx.estimatedFee || 0.000005).toFixed(6)} {currentNetwork?.includes('Solana') ? 'SOL' : 'XNT'}</span>
            </div>
            
            {/* Priority Fee Section */}
            <div className="dapp-tx-row priority-section">
              <span className="dapp-tx-row-label">Priority</span>
              <div className="dapp-priority-chips">
                {PRIORITY_OPTIONS.filter(opt => opt.id !== 'custom').map(opt => (
                  <button
                    key={opt.id}
                    className={`dapp-priority-chip ${priority === opt.id ? 'active' : ''}`}
                    onClick={() => { setPriority(opt.id); setCustomFee(''); }}
                    type="button"
                    disabled={processing}
                  >
                    {opt.name}
                  </button>
                ))}
                <button
                  className={`dapp-priority-chip ${priority === 'custom' ? 'active' : ''}`}
                  onClick={() => setPriority('custom')}
                  type="button"
                  disabled={processing}
                >
                  ⚙
                </button>
              </div>
            </div>
            
            {/* Custom Fee Input - only show when custom selected */}
            {priority === 'custom' && (
              <div className="dapp-tx-row">
                <span className="dapp-tx-row-label">Custom Fee</span>
                <div className="dapp-custom-fee-wrapper">
                  <input
                    type="number"
                    className="dapp-custom-fee-input"
                    placeholder="0.0001"
                    value={customFee}
                    onChange={(e) => setCustomFee(e.target.value)}
                    step="0.0001"
                    min="0"
                    disabled={processing}
                  />
                  <span className="dapp-custom-fee-symbol">{currentNetwork?.includes('Solana') ? 'SOL' : 'XNT'}</span>
                </div>
              </div>
            )}
            
            {/* Total Fee Display */}
            <div className="dapp-tx-row total">
              <span className="dapp-tx-row-label">Total Fee</span>
              <span className="dapp-tx-row-value highlight">
                {((decodedTx.estimatedFee || 0.000005) + (priority === 'custom' ? parseFloat(customFee) || 0 : PRIORITY_OPTIONS.find(p => p.id === priority)?.fee || 0)).toFixed(6)} {currentNetwork?.includes('Solana') ? 'SOL' : 'XNT'}
              </span>
            </div>
          </div>
        )}
        
        {error && <div className="error-message">{error}</div>}
        
        {/* Ledger popup limitation message */}
        {ledgerPopupError && (
          <div style={{
            background: 'rgba(255, 193, 7, 0.1)',
            border: '1px solid rgba(255, 193, 7, 0.3)',
            borderRadius: 12,
            padding: 16,
            marginBottom: 16
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FFC107" strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}>
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>
                  Ledger Authorization Required
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  Your Ledger needs to be authorized in Chrome. Click below to connect your Ledger, then click Approve again.
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button 
                onClick={async () => {
                  try {
                    setError(null);
                    setHwStatus('Select your Ledger device...');
                    setProcessing(true);
                    
                    // First disconnect any existing connection to ensure clean state
                    try { await hardwareWallet.disconnect(); } catch (e) {}
                    
                    // Clear session invalid flag
                    hardwareWallet.sessionInvalid = false;
                    
                    // Request device authorization - this shows the browser device picker
                    const TransportModule = await import('@ledgerhq/hw-transport-webhid');
                    const Transport = TransportModule.default;
                    
                    // This will show the device picker dialog
                    const transport = await Transport.create();
                    
                    if (transport) {
                      // Successfully authorized - set up hardware wallet
                      hardwareWallet.transport = transport;
                      hardwareWallet.state = 'connected';
                      
                      setHwStatus('Opening Solana app...');
                      await hardwareWallet.openApp();
                      
                      setHwStatus('');
                      setProcessing(false);
                      
                      // Hide the connect UI - user can now click Approve
                      setLedgerPopupError(false);
                      
                      // DON'T auto-retry - let user click Approve again
                      // This prevents loops if signing keeps failing
                    }
                  } catch (err) {
                    logger.error('[DAppApproval] Ledger authorization failed:', err);
                    setHwStatus('');
                    setProcessing(false);
                    
                    if (err.name === 'TransportOpenUserCancelled' || err.message?.includes('cancelled')) {
                      setError('Ledger connection was cancelled. Please try again.');
                    } else if (err.message?.includes('No device')) {
                      setError('No Ledger device found. Make sure it is connected and unlocked.');
                    } else if (err.message?.includes('Solana app') || err.message?.includes('open the')) {
                      setError('Please open the Solana app on your Ledger, then try again.');
                    } else {
                      setError(`Failed to connect: ${err.message}`);
                    }
                    // Keep ledgerPopupError true so user can retry
                  }
                }}
                disabled={processing}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  background: 'var(--x1-blue)',
                  border: 'none',
                  borderRadius: 8,
                  color: '#ffffff',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: processing ? 'not-allowed' : 'pointer',
                  opacity: processing ? 0.7 : 1
                }}
              >
                {processing ? 'Connecting...' : 'Connect Ledger'}
              </button>
              <button 
                onClick={handleReject}
                disabled={processing}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 8,
                  color: 'var(--text-primary)',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: processing ? 'not-allowed' : 'pointer',
                  opacity: processing ? 0.7 : 1
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        
        {/* Hardware wallet status */}
        {hwStatus && (
          <div className="send-hw-status" style={{ marginBottom: 16 }}>
            <div className="spinner" style={{ width: 20, height: 20 }} />
            <span>{hwStatus}</span>
          </div>
        )}
        
        {/* Actions */}
        {!ledgerPopupError && (
        <div className="dapp-approval-actions">
          <button className="dapp-btn-reject" onClick={handleReject} disabled={processing}>
            {pendingRequest.type === 'connect' ? 'Cancel' : 'Deny'}
          </button>
          <button className="dapp-btn-approve" onClick={handleApproveClick} disabled={processing}>
            {processing ? (
              <>
                <span className="btn-spinner"></span>
                Processing...
              </>
            ) : (
              pendingRequest.type === 'connect' ? 'Connect' : 'Approve'
            )}
          </button>
        </div>
        )}
      </div>
    </div>
  );
}