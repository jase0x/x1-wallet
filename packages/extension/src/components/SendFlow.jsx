// Send Flow - Multi-step Send Process (Backpack-style)
// Flow: Token → Recipient → Amount → Confirm → Success
import React, { useState, useEffect, useRef } from 'react';
import X1Logo from './X1Logo';
import { NETWORKS, getTxExplorerUrl } from '@x1-wallet/core/services/networks';
import { logger, getUserFriendlyError, ErrorMessages } from '@x1-wallet/core';
import { validateAddress } from '@x1-wallet/core/utils/base58';
import { hardwareWallet } from '../services/hardware';

// Solana Logo URL
const SOLANA_LOGO_URL = '/icons/48-sol.png';

// Transaction priority options - network aware
function getPriorityOptions(network) {
  const isX1 = network?.includes('X1');
  // X1 has higher base fees than Solana
  if (isX1) {
    return [
      { id: 'auto', name: 'Auto', fee: 0, description: 'Standard speed' },
      { id: 'fast', name: 'Fast', fee: 0.001, description: 'Higher priority' },
      { id: 'turbo', name: 'Turbo', fee: 0.005, description: 'Very high priority' },
      { id: 'degen', name: 'Degen', fee: 0.01, description: 'Maximum priority' },
      { id: 'custom', name: 'Custom', fee: 0, description: 'Set your own fee' }
    ];
  }
  // Solana fees
  return [
    { id: 'auto', name: 'Auto', fee: 0, description: 'Standard speed' },
    { id: 'fast', name: 'Fast', fee: 0.000005, description: 'Higher priority' },
    { id: 'turbo', name: 'Turbo', fee: 0.00005, description: 'Very high priority' },
    { id: 'degen', name: 'Degen', fee: 0.001, description: 'Maximum priority' },
    { id: 'custom', name: 'Custom', fee: 0, description: 'Set your own fee' }
  ];
}

// Get base transaction fee for network
function getBaseFee(network) {
  const isX1 = network?.includes('X1');
  return isX1 ? 0.002 : 0.000005; // X1: 0.002 XNT, Solana: 5000 lamports
}

// Legacy constant for backwards compatibility
const PRIORITY_OPTIONS = [
  { id: 'auto', name: 'Auto', fee: 0, description: 'Standard speed' },
  { id: 'fast', name: 'Fast', fee: 0.000005, description: 'Higher priority' },
  { id: 'turbo', name: 'Turbo', fee: 0.00005, description: 'Very high priority' },
  { id: 'degen', name: 'Degen', fee: 0.001, description: 'Maximum priority' },
  { id: 'custom', name: 'Custom', fee: 0, description: 'Set your own fee' }
];

// Network-aware logo component
function NetworkLogo({ network, size = 40 }) {
  // X1 logo fills edge-to-edge, Solana logo has internal padding
  const x1LogoSize = Math.round(size * 0.8);
  const solanaLogoSize = Math.round(size * 0.95);
  
  if (network?.includes('Solana')) {
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
          src={SOLANA_LOGO_URL}
          alt="Solana"
          style={{
            width: solanaLogoSize,
            height: solanaLogoSize,
            objectFit: 'contain',
            display: 'block'
          }}
        />
      </div>
    );
  }
  return <X1Logo size={size} />;
}

// Flow steps - Token first, then Recipient
const STEPS = {
  TOKEN: 0,
  RECIPIENT: 1,
  AMOUNT: 2,
  CONFIRM: 3,
  SUCCESS: 4
};

export default function SendFlow({ wallet, selectedToken: initialToken, userTokens = [], onBack, onSuccess }) {
  // Flow state - start at TOKEN step, or RECIPIENT if token pre-selected
  const [step, setStep] = useState(initialToken ? STEPS.RECIPIENT : STEPS.TOKEN);
  const [slideDirection, setSlideDirection] = useState('right');
  
  // Form state
  const [recipient, setRecipient] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [currentToken, setCurrentToken] = useState(initialToken);
  const [amount, setAmount] = useState('');
  
  // UI state
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [txHash, setTxHash] = useState('');
  const [hwStatus, setHwStatus] = useState('');
  const [addressWarning, setAddressWarning] = useState('');
  const [myWallets, setMyWallets] = useState([]);
  const [recentAddresses, setRecentAddresses] = useState([]);
  const [priority, setPriority] = useState('auto');
  const [customFee, setCustomFee] = useState('');

  // Hardware wallet detection
  const isHardwareWallet = wallet?.wallet?.isHardware || 
                           wallet?.activeWallet?.isHardware || 
                           wallet?.isHardware || false;

  // Network config
  const network = wallet?.network || 'X1 Mainnet';
  const networkConfig = NETWORKS[network] || {
    symbol: 'XNT',
    decimals: 9,
    rpcUrl: 'https://rpc.testnet.x1.xyz',
    explorer: 'https://explorer.x1.xyz'
  };

  // Build token list
  const nativeToken = {
    symbol: networkConfig.symbol,
    name: network.includes('Solana') ? 'Solana' : 'X1 Native Token',
    mint: null,
    decimals: networkConfig.decimals,
    uiAmount: wallet?.balance || 0,
    balance: wallet?.balance || 0,
    logoURI: null,
    isNative: true
  };

  const tokensWithBalance = (userTokens || []).filter(t => {
    const bal = parseFloat(t.uiAmount) || parseFloat(t.balance) || 0;
    const rawAmount = parseInt(t.amount) || 0;
    return bal > 0 || rawAmount > 0;
  });

  const availableTokens = [nativeToken, ...tokensWithBalance];

  // Token display helpers
  const isTokenSend = currentToken && currentToken.mint;
  const displaySymbol = isTokenSend ? currentToken.symbol : networkConfig.symbol;
  const displayBalance = isTokenSend ? (parseFloat(currentToken.balance || currentToken.uiAmount) || 0) : (wallet?.balance || 0);
  const displayDecimals = isTokenSend ? (currentToken.decimals || 9) : networkConfig.decimals;
  const displayName = isTokenSend ? currentToken.name : (network.includes('Solana') ? 'Solana' : 'X1 Native Token');

  // Load wallets and recent addresses
  useEffect(() => {
    const loadData = async () => {
      try {
        // Use wallets from the wallet hook (already decrypted) instead of localStorage
        const wallets = wallet?.wallets || [];
        const currentPublicKey = wallet?.wallet?.publicKey;
        console.log('[SendFlow] Loading wallets from hook:', wallets.length, 'current:', currentPublicKey);
        
        // Flatten wallets - each wallet may have multiple addresses
        const allAddresses = [];
        const seenPublicKeys = new Set(); // Prevent duplicates
        
        wallets.forEach((w, walletIndex) => {
          // Try addresses array first (new format)
          if (w.addresses && Array.isArray(w.addresses) && w.addresses.length > 0) {
            w.addresses.forEach((addr, addrIndex) => {
              const pk = addr.publicKey || addr.address;
              
              // Allow sending to yourself - don't exclude current wallet
              if (pk && !seenPublicKeys.has(pk)) {
                seenPublicKeys.add(pk);
                
                // Use wallet name, or address name if it's custom, or fallback
                const displayName = w.name || addr.name || `Wallet ${walletIndex + 1}`;
                
                allAddresses.push({
                  publicKey: pk,
                  name: displayName,
                  avatar: w.avatar,
                  isHardware: w.isHardware,
                  type: w.type,
                  isCurrent: pk === currentPublicKey // Mark if this is current wallet
                });
              }
            });
          }
          
          // Also check wallet-level publicKey as fallback
          const walletPk = w.publicKey;
          if (walletPk && !seenPublicKeys.has(walletPk)) {
            seenPublicKeys.add(walletPk);
            allAddresses.push({
              publicKey: walletPk,
              name: w.name || `Wallet ${walletIndex + 1}`,
              avatar: w.avatar,
              isHardware: w.isHardware,
              type: w.type,
              isCurrent: walletPk === currentPublicKey
            });
          }
        });
        
        console.log('[SendFlow] Final addresses list:', allAddresses.map(a => ({ name: a.name, pk: a.publicKey?.slice(0, 8), isCurrent: a.isCurrent })));
        setMyWallets(allAddresses);
        
        // Load recent addresses and enrich with wallet names
        const recentStored = localStorage.getItem('x1_recent_addresses');
        if (recentStored) {
          const recent = JSON.parse(recentStored);
          
          // Enrich recent addresses with wallet names if they're our wallets
          const enrichedRecent = recent.map(r => {
            const matchedWallet = allAddresses.find(w => w.publicKey === r.address);
            if (matchedWallet && matchedWallet.name) {
              return { ...r, name: matchedWallet.name };
            }
            return r;
          });
          
          setRecentAddresses(enrichedRecent);
        }
      } catch (e) {
        console.error('[SendFlow] Failed to load data:', e);
      }
    };
    loadData();
  }, [wallet?.wallet?.publicKey, wallet?.wallets]);

  // Save recent address after successful send
  const saveRecentAddress = (address, name = null) => {
    try {
      const recent = JSON.parse(localStorage.getItem('x1_recent_addresses') || '[]');
      const filtered = recent.filter(r => r.address !== address);
      const newRecent = [{ address, name, timestamp: Date.now() }, ...filtered].slice(0, 10);
      localStorage.setItem('x1_recent_addresses', JSON.stringify(newRecent));
    } catch (e) {
      logger.warn('[SendFlow] Failed to save recent address');
    }
  };

  // Set initial token
  useEffect(() => {
    if (!currentToken) {
      setCurrentToken(initialToken || nativeToken);
    }
  }, [initialToken]);

  // Validate address
  useEffect(() => {
    if (recipient && recipient.trim()) {
      const result = validateAddress(recipient.trim());
      if (!result.valid) {
        setAddressWarning(result.error);
      } else {
        setAddressWarning('');
        if (recipient.trim() === wallet?.wallet?.publicKey) {
          // Allow sending to yourself - just show a warning
          if (currentToken && currentToken.mint) {
            setAddressWarning('Warning: Sending tokens to yourself');
          } else {
            setAddressWarning('Warning: Sending to your own address');
          }
        }
      }
    } else {
      setAddressWarning('');
    }
  }, [recipient, wallet?.wallet?.publicKey]);

  // Navigation with animation
  const goToStep = (newStep, direction = null) => {
    const dir = direction || (newStep > step ? 'right' : 'left');
    setSlideDirection(dir);
    setError('');
    setStep(newStep);
  };

  const handleBack = () => {
    if (step === STEPS.TOKEN) {
      onBack();
    } else if (step === STEPS.RECIPIENT) {
      if (initialToken) {
        // If token was pre-selected, go back to main screen
        onBack();
      } else {
        // Go back to token selection
        setRecipient('');
        setRecipientName('');
        goToStep(STEPS.TOKEN, 'left');
      }
    } else if (step === STEPS.AMOUNT) {
      // Go back to recipient - but also clear recipient so user can re-select
      setRecipient('');
      setRecipientName('');
      goToStep(STEPS.RECIPIENT, 'left');
    } else {
      goToStep(step - 1, 'left');
    }
  };

  // Select token and proceed to recipient
  const selectToken = (token) => {
    logger.log('[SendFlow] selectToken called:', token?.symbol);
    setCurrentToken(token);
    setAmount('');
    goToStep(STEPS.RECIPIENT, 'right'); // Token → Recipient slides right
  };

  // Select recipient from list
  const selectRecipient = (address, name = null) => {
    logger.log('[SendFlow] selectRecipient called:', { address, name });
    
    if (!address) {
      logger.error('[SendFlow] No address provided to selectRecipient');
      return;
    }
    
    // Ensure token is set before going to amount
    if (!currentToken) {
      logger.log('[SendFlow] No current token, setting to native');
      setCurrentToken(nativeToken);
    }
    
    // Set recipient and name
    setRecipient(address);
    setRecipientName(name || '');
    
    // Navigate immediately - state updates are synchronous in React 18
    setSlideDirection('left'); // Wallet selection slides left
    setError('');
    setStep(STEPS.AMOUNT);
  };

  // Proceed from recipient input to amount
  const proceedToAmount = () => {
    const result = validateAddress(recipient.trim());
    if (result.valid) {
      goToStep(STEPS.AMOUNT, 'up'); // Selecting send slides up
    } else {
      setAddressWarning(result.error);
    }
  };

  // Set max amount
  const setMax = () => {
    if (isTokenSend) {
      setAmount(displayBalance.toString());
    } else {
      const max = Math.max(0, displayBalance - 0.00001);
      setAmount(max.toString());
    }
  };

  // Validate and proceed to confirm
  const validateAndProceed = () => {
    setError('');
    
    const sendAmount = parseFloat(amount);
    if (!amount || isNaN(sendAmount) || sendAmount <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    
    // Use integer comparison to avoid floating-point precision issues
    const multiplier = Math.pow(10, displayDecimals);
    const requiredAmount = Math.round(sendAmount * multiplier);
    const availableAmount = Math.round(displayBalance * multiplier);
    
    if (requiredAmount > availableAmount) {
      setError(`Insufficient balance. Required: ${amount} ${displaySymbol}, Available: ${displayBalance} ${displaySymbol}`);
      return;
    }
    
    goToStep(STEPS.CONFIRM, 'left'); // Review slides left to confirm
  };

  // Get time ago string
  const getTimeAgo = (timestamp) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
  };

  // Sign with hardware wallet
  const signWithHardware = async (txMessage) => {
    try {
      setHwStatus('Connecting to Ledger...');
      
      // Get the derivation path from the current wallet
      const derivationPath = wallet?.wallet?.derivationPath;
      logger.log('[SendFlow] Signing with derivation path:', derivationPath);
      logger.log('[SendFlow] wallet.wallet object:', JSON.stringify({
        name: wallet?.wallet?.name,
        type: wallet?.wallet?.type,
        isHardware: wallet?.wallet?.isHardware,
        derivationPath: wallet?.wallet?.derivationPath,
        publicKey: wallet?.wallet?.publicKey
      }));
      
      // Always try to ensure fresh connection
      if (!hardwareWallet.isReady()) {
        try {
          await hardwareWallet.connect();
        } catch (connectErr) {
          // If device is already open, disconnect and retry
          if (connectErr.message?.includes('already open')) {
            logger.log('[SendFlow] Device already open, disconnecting and retrying...');
            await hardwareWallet.disconnect();
            await hardwareWallet.connect();
          } else {
            throw connectErr;
          }
        }
        await hardwareWallet.openApp();
      }
      
      setHwStatus('Please confirm transaction on Ledger...');
      const signature = await hardwareWallet.signTransaction(txMessage, derivationPath);
      return signature;
    } catch (err) {
      logger.error('[SendFlow] Hardware signing error:', err);
      if (err.message?.includes('rejected')) {
        throw new Error('Transaction rejected on Ledger');
      }
      if (err.message?.includes('cancelled') || err.message?.includes('No device')) {
        throw new Error('Ledger connection failed. Please make sure your Ledger is connected and the Solana app is open.');
      }
      if (err.message?.includes('already open')) {
        // Try to disconnect for next attempt
        try { await hardwareWallet.disconnect(); } catch (e) {}
        throw new Error('Ledger connection conflict. Please try again.');
      }
      throw new Error(`Ledger signing failed: ${err.message}`);
    }
  };

  // Send native token
  const sendNative = async (sendAmount) => {
    const lamports = Math.floor(sendAmount * Math.pow(10, networkConfig.decimals));
    
    // Get priority fee - use custom fee if selected, otherwise use preset (network-aware)
    const priorityFee = priority === 'custom' 
      ? (parseFloat(customFee) || 0)
      : (getPriorityOptions(network).find(p => p.id === priority)?.fee || 0);
    const priorityMicroLamports = Math.floor(priorityFee * 1e9); // Convert to microLamports
    
    const skipSimulation = (() => {
      try {
        return JSON.parse(localStorage.getItem('x1wallet_skipSimulation')) ?? false;
      } catch { return false; }
    })();
    
    console.log('[SendFlow] sendNative - Fast Mode (skipSimulation):', skipSimulation);
    
    const response = await fetch(networkConfig.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getLatestBlockhash',
        params: [{ commitment: 'finalized' }]
      })
    });
    
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    
    const blockhash = data.result?.value?.blockhash;
    if (!blockhash) throw new Error('Failed to get blockhash');

    let tx;
    
    if (isHardwareWallet) {
      const { buildTransferMessage, serializeTransaction } = await import('@x1-wallet/core/utils/transaction');
      
      const message = buildTransferMessage(
        wallet.wallet.publicKey,
        recipient.trim(),
        lamports,
        blockhash,
        priorityMicroLamports // Pass priority fee
      );
      
      setHwStatus('Please confirm on your Ledger...');
      const signature = await signWithHardware(message);
      
      const serializedTx = serializeTransaction(signature, message);
      tx = btoa(String.fromCharCode(...serializedTx));
    } else {
      const { createTransferTransaction } = await import('@x1-wallet/core/utils/transaction');
      
      tx = await createTransferTransaction({
        fromPubkey: wallet.wallet.publicKey,
        toPubkey: recipient.trim(),
        lamports,
        recentBlockhash: blockhash,
        privateKey: wallet.wallet.privateKey,
        priorityFee: priorityMicroLamports // Pass priority fee
      });
    }

    // Skip simulation for self-sends (native transfers to self are valid but simulation can be flaky)
    const isSelfSend = wallet.wallet.publicKey === recipient.trim();
    
    if (!skipSimulation && !isSelfSend) {
      console.log('[SendFlow] Running transaction simulation...');
      const simResponse = await fetch(networkConfig.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'simulateTransaction',
          params: [tx, { 
            encoding: 'base64',
            commitment: 'confirmed',
            replaceRecentBlockhash: true
          }]
        })
      });
      
      const simData = await simResponse.json();
      if (simData.result?.value?.err) {
        const err = simData.result.value.err;
        logger.error('[SendFlow] Simulation error:', JSON.stringify(err));
        let errorMsg = 'Transaction simulation failed';
        if (typeof err === 'object' && err.InstructionError) {
          const [idx, errDetail] = err.InstructionError;
          if (errDetail === 'InsufficientFunds') {
            errorMsg = 'Insufficient funds for this transaction';
          } else if (typeof errDetail === 'object' && errDetail.Custom !== undefined) {
            errorMsg = `Transaction failed: Custom error ${errDetail.Custom}`;
          } else {
            errorMsg = `Transaction failed: ${JSON.stringify(errDetail)}`;
          }
        }
        throw new Error(errorMsg);
      }
    } else {
      console.log('[SendFlow] Skipping simulation - Fast Mode:', skipSimulation, 'Self-send:', isSelfSend);
    }

    const sendResponse = await fetch(networkConfig.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendTransaction',
        params: [tx, { 
          encoding: 'base64', 
          preflightCommitment: 'confirmed',
          skipPreflight: skipSimulation || isSelfSend // Skip preflight for Fast Mode or self-sends
        }]
      })
    });
    
    const sendData = await sendResponse.json();
    if (sendData.error) throw new Error(sendData.error.message);
    
    return sendData.result;
  };

  // Send SPL token
  const sendSPLToken = async (sendAmount, privateKey) => {
    // Debug logging
    console.log('[SendFlow] sendSPLToken called');
    console.log('[SendFlow] isHardwareWallet:', isHardwareWallet);
    console.log('[SendFlow] wallet.wallet:', wallet?.wallet);
    console.log('[SendFlow] wallet.wallet.isHardware:', wallet?.wallet?.isHardware);
    console.log('[SendFlow] currentToken:', currentToken);
    console.log('[SendFlow] network:', network);
    
    // Validate token has required fields
    if (!currentToken.mint) {
      throw new Error('Token mint address is required');
    }
    if (!currentToken.address) {
      throw new Error('Token account address not found. Please refresh your wallet.');
    }
    // Only require privateKey for non-hardware wallets
    if (!isHardwareWallet && !privateKey) {
      throw new Error('Wallet is locked. Please unlock your wallet first.');
    }
    
    const tokenAmount = Math.floor(sendAmount * Math.pow(10, currentToken.decimals));
    
    console.log('[SendFlow] Token send details:', {
      from: wallet.wallet.publicKey,
      to: recipient.trim(),
      mint: currentToken.mint,
      programId: currentToken.programId,
      isToken2022: currentToken.isToken2022,
      sourceATA: currentToken.address,
      isSelfSend: wallet.wallet.publicKey === recipient.trim(),
      isToMint: recipient.trim() === currentToken.mint
    });
    
    // Prevent sending to the mint address (invalid)
    if (recipient.trim() === currentToken.mint) {
      throw new Error('Cannot send tokens to the token mint address. Please enter a wallet address.');
    }
    
    // Handle self-transfer - can't transfer SPL tokens to same wallet (same ATA)
    // Return a no-op success since balance wouldn't change anyway
    if (wallet.wallet.publicKey === recipient.trim()) {
      console.log('[SendFlow] Self-transfer detected - returning no-op success');
      return 'self-transfer-no-op';
    }
    
    const response = await fetch(networkConfig.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getLatestBlockhash',
        params: [{ commitment: 'finalized' }]
      })
    });
    
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    
    const blockhash = data.result?.value?.blockhash;
    if (!blockhash) throw new Error('Failed to get blockhash');

    let tx;
    
    if (isHardwareWallet) {
      // Hardware wallet flow - build message, sign with device
      const { buildTokenTransferMessageForHardware, serializeTransaction, findExistingATA, deriveATAAddressStandard } = await import('@x1-wallet/core/utils/transaction');
      
      // Determine destination token account
      let toTokenAccount = await findExistingATA(networkConfig.rpcUrl, recipient.trim(), currentToken.mint);
      let needsCreateATA = false;
      
      if (!toTokenAccount) {
        // Need to create ATA for recipient - use RPC validation
        toTokenAccount = await deriveATAAddressStandard(
          recipient.trim(), 
          currentToken.mint, 
          currentToken.programId,
          networkConfig.rpcUrl,
          wallet.wallet.publicKey // Use sender as payer for simulation
        );
        needsCreateATA = true;
      }
      
      setHwStatus('Please confirm on your Ledger...');
      
      const message = buildTokenTransferMessageForHardware({
        fromPubkey: wallet.wallet.publicKey,
        toPubkey: recipient.trim(),
        fromTokenAccount: currentToken.address,
        toTokenAccount,
        mint: currentToken.mint,
        amount: tokenAmount,
        recentBlockhash: blockhash,
        tokenProgramId: currentToken.programId,
        needsCreateATA
      });
      
      const signature = await signWithHardware(message);
      const serializedTx = serializeTransaction(signature, message);
      tx = btoa(String.fromCharCode(...serializedTx));
    } else {
      // Software wallet flow
      const { createTokenTransferTransaction } = await import('@x1-wallet/core/utils/transaction');
      
      tx = await createTokenTransferTransaction({
        fromPubkey: wallet.wallet.publicKey,
        toPubkey: recipient.trim(),
        mint: currentToken.mint,
        amount: tokenAmount,
        decimals: currentToken.decimals,
        fromTokenAccount: currentToken.address,
        recentBlockhash: blockhash,
        privateKey: privateKey,
        programId: currentToken.programId,
        rpcUrl: networkConfig.rpcUrl
      });
    }

    const sendResponse = await fetch(networkConfig.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendTransaction',
        params: [tx, { encoding: 'base64', preflightCommitment: 'confirmed' }]
      })
    });
    
    const sendData = await sendResponse.json();
    if (sendData.error) throw new Error(sendData.error.message);
    
    return sendData.result;
  };

  // Execute send
  const handleSend = async () => {
    setError('');
    
    // Validate wallet is unlocked and has private key
    const privateKey = wallet?.wallet?.privateKey;
    if (!isHardwareWallet && (!privateKey || typeof privateKey !== 'string' || privateKey.length < 32)) {
      setError('Wallet is locked or not available. Please unlock your wallet first.');
      return;
    }

    setSending(true);
    
    if (isHardwareWallet) {
      setHwStatus('Connecting to Ledger...');
    }

    try {
      const sendAmount = parseFloat(amount);
      let signature;
      
      if (isTokenSend) {
        signature = await sendSPLToken(sendAmount, privateKey);
      } else {
        signature = await sendNative(sendAmount);
      }
      
      setTxHash(signature);
      
      // Skip saving transaction history and XP for self-transfers (no real transaction)
      if (signature !== 'self-transfer-no-op') {
        // Save transaction history
        const { addTransaction } = await import('@x1-wallet/core/utils/transaction');
        addTransaction({
          signature,
          type: 'send',
          amount: sendAmount,
          symbol: displaySymbol,
          from: wallet.wallet.publicKey,
          to: recipient.trim(),
          timestamp: Date.now(),
          status: 'confirmed',
          network: network,
          isToken: isTokenSend,
          mint: currentToken?.mint,
          tokenName: currentToken?.name || currentToken?.symbol
        });
        
        // Track XP
        const { trackSendXP } = await import('@x1-wallet/core/services/xp');
        trackSendXP({
          user: wallet.wallet.publicKey,
          network: network,
          transactionSignature: signature,
          mint: currentToken?.mint || 'So11111111111111111111111111111111111111112',
          amount: sendAmount,
          recipient: recipient.trim()
        }).catch(() => {});
      }
      
      // Save recent address
      saveRecentAddress(recipient.trim(), recipientName || null);
      
      // Trigger success callback (which handles refresh via balanceRefreshKey)
      if (onSuccess) onSuccess(signature);
      
      goToStep(STEPS.SUCCESS, 'up');
    } catch (err) {
      logger.error('[SendFlow] Send error:', err.message || err);
      setError(getUserFriendlyError(err, ErrorMessages.transaction.failed));
    } finally {
      setSending(false);
      setHwStatus('');
    }
  };

  // Get header title based on step
  const getHeaderTitle = () => {
    switch (step) {
      case STEPS.TOKEN: return 'Send';
      case STEPS.RECIPIENT: return 'Send';
      case STEPS.AMOUNT: return `Send ${displaySymbol}`;
      case STEPS.CONFIRM: return 'Confirm';
      case STEPS.SUCCESS: return 'Success';
      default: return 'Send';
    }
  };

  // Render step content
  const renderStep = () => {
    switch (step) {
      // STEP 1: Token Selection
      case STEPS.TOKEN:
        return (
          <div className="send-step-content">
            <div className="send-section">
              <div className="send-section-label">SELECT TOKEN TO SEND</div>
              {availableTokens.map((token, i) => {
                const balance = parseFloat(token.balance || token.uiAmount || 0);
                // Calculate USD value
                let price = token.price || 0;
                if (token.isNative) {
                  price = network?.includes('Solana') ? 150 : 1; // SOL ~$150, XNT $1
                } else if (token.symbol === 'USDC' || token.symbol === 'USDT' || token.symbol === 'USDC.X') {
                  price = 1;
                }
                const usdValue = balance * price;
                
                return (
                  <div
                    key={token.mint || 'native'}
                    className="send-token-row"
                    onClick={() => selectToken(token)}
                  >
                    <div className="send-token-icon">
                      {token.isNative ? (
                        <NetworkLogo network={network} size={32} />
                      ) : token.logoURI ? (
                        <img src={token.logoURI} alt={token.symbol} style={{ width: 26, height: 26, objectFit: 'contain' }} />
                      ) : (
                        <span className="send-token-initial">{token.symbol?.charAt(0) || '?'}</span>
                      )}
                    </div>
                    <div className="send-token-info">
                      <span className="send-token-symbol">{token.symbol}</span>
                      <span className="send-token-name">{token.name}</span>
                    </div>
                    <div className="send-token-balance-col">
                      <span className="send-token-balance-amount">{balance.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                      {usdValue > 0 && (
                        <span className="send-token-balance-usd">${usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );

      // STEP 2: Recipient Selection
      case STEPS.RECIPIENT:
        return (
          <div className="send-step-content">
            {/* Address Input */}
            <div className="send-address-input-container">
              <input
                type="text"
                className="form-input send-address-input"
                placeholder="Enter address"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                autoComplete="off"
                spellCheck="false"
              />
              {recipient && (
                <button 
                  className="send-address-clear"
                  onClick={() => { setRecipient(''); setRecipientName(''); }}
                  type="button"
                >×</button>
              )}
            </div>
            
            {addressWarning && (
              <div className="send-address-warning">{addressWarning}</div>
            )}

            {/* Recent Addresses */}
            {recentAddresses.length > 0 && !recipient && (
              <div className="send-section">
                <div className="send-section-label">Recent addresses</div>
                {recentAddresses.map((addr, i) => {
                  // Don't show generic names like "Address 1" or "Wallet 1"
                  const isGenericName = addr.name && /^(Address|Wallet)\s*\d*$/i.test(addr.name);
                  const displayName = addr.name && !isGenericName ? addr.name : null;
                  
                  return (
                  <div 
                    key={i} 
                    className="send-address-row"
                    onClick={() => selectRecipient(addr.address, displayName)}
                  >
                    <div className="send-address-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                    </div>
                    <div className="send-address-info">
                      <span className="send-address-main">
                        {displayName || `${addr.address.slice(0, 12)}...`}
                      </span>
                      <span className="send-address-meta">{getTimeAgo(addr.timestamp)}</span>
                    </div>
                    <span className="send-address-short">
                      {addr.address.slice(0, 4)}...{addr.address.slice(-4)}
                    </span>
                  </div>
                  );
                })}
              </div>
            )}

            {/* My Wallets */}
            {myWallets.length > 0 && !recipient && (
              <div className="send-section">
                <div className="send-section-label">YOUR ADDRESSES</div>
                {myWallets.map((w, i) => {
                  const hasImage = w.avatar && (w.avatar.startsWith('data:image') || w.avatar.startsWith('http'));
                  const isHardware = w.isHardware || w.type === 'ledger';
                  
                  return (
                    <div 
                      key={w.publicKey || i}
                      className="send-address-row"
                      onClick={() => selectRecipient(w.publicKey, w.name)}
                    >
                      <div className="send-wallet-avatar">
                        {hasImage ? (
                          <img src={w.avatar} alt={w.name} />
                        ) : (
                          <span className="wallet-avatar-initials">
                            {isHardware ? 'L' : (w.name?.charAt(0)?.toUpperCase() || 'W')}
                          </span>
                        )}
                      </div>
                      <div className="send-wallet-info">
                        <span className="send-wallet-name">
                          {w.name || `Wallet ${i + 1}`}
                          {w.isCurrent && <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 6 }}>(Current)</span>}
                        </span>
                        <span className="send-wallet-address">{w.publicKey?.slice(0, 6)}...{w.publicKey?.slice(-4)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Show message if no wallets and no recent */}
            {myWallets.length === 0 && recentAddresses.length === 0 && !recipient && (
              <div className="send-empty-state">
                <p>Enter a wallet address above or add more wallets to see them here.</p>
              </div>
            )}

            {/* Next button when address entered - show if no error (warnings starting with "Warning:" are OK) */}
            {recipient && (!addressWarning || addressWarning.startsWith('Warning:')) && (
              <div className="send-bottom-action">
                <button 
                  className="btn-primary"
                  onClick={proceedToAmount}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        );

      // STEP 3: Amount Entry
      case STEPS.AMOUNT:
        // Safety check - if no recipient, go back
        if (!recipient) {
          logger.warn('[SendFlow] No recipient in AMOUNT step');
          return (
            <div className="send-step-content">
              <div className="send-empty-state">
                <p>No recipient selected. Please go back and select a recipient.</p>
              </div>
              <div className="send-bottom-action">
                <button className="btn-primary" onClick={() => goToStep(STEPS.RECIPIENT, 'left')}>
                  Go Back
                </button>
              </div>
            </div>
          );
        }
        
        // Safety check - if no token selected when not starting with one
        if (!currentToken && !initialToken) {
          logger.warn('[SendFlow] No token selected in AMOUNT step');
          return (
            <div className="send-step-content">
              <div className="send-empty-state">
                <p>No token selected. Please go back and select a token.</p>
              </div>
              <div className="send-bottom-action">
                <button className="btn-primary" onClick={() => goToStep(STEPS.TOKEN, 'left')}>
                  Go Back
                </button>
              </div>
            </div>
          );
        }
        
        return (
          <div className="send-step-content send-amount-step">
            {/* Recipient Display */}
            <div className="send-recipient-display">
              <span className="send-recipient-label">
                {recipientName && !recipientName.match(/^(Address|Wallet)\s*\d*$/i) 
                  ? recipientName 
                  : 'Recipient'}
              </span>
              <div className="send-recipient-pill">
                {recipient.slice(0, 6)}...{recipient.slice(-4)}
              </div>
            </div>

            {/* Amount Input */}
            <div className="send-amount-section">
              <input
                type="text"
                inputMode="decimal"
                className="send-amount-input"
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                autoComplete="off"
              />
              <div className="send-amount-token">
                {isTokenSend && currentToken ? (
                  currentToken.logoURI ? (
                    <img src={currentToken.logoURI} alt={currentToken.symbol} style={{ width: 24, height: 24, borderRadius: '50%' }} />
                  ) : (
                    <span className="send-token-mini">{currentToken.symbol?.charAt(0)}</span>
                  )
                ) : (
                  <NetworkLogo network={network} size={24} />
                )}
                <span>{displaySymbol}</span>
              </div>
            </div>

            {/* Max Button */}
            <button className="send-max-pill" onClick={setMax} type="button">
              Max: {displayBalance.toLocaleString(undefined, { maximumFractionDigits: 6 })} {displaySymbol}
            </button>

            {error && <div className="error-message" style={{ marginTop: 16 }}>{error}</div>}

            {/* Review Button */}
            <div className="send-bottom-action">
              <button 
                className="btn-primary"
                onClick={validateAndProceed}
                disabled={!amount || parseFloat(amount) <= 0}
              >
                Review
              </button>
            </div>
          </div>
        );

      // STEP 4: Confirm
      case STEPS.CONFIRM:
        return (
          <div className="send-step-content">
            {/* Transaction Summary */}
            <div className="send-summary-card">
              <div className="send-summary-row">
                <span className="send-summary-label">Sending</span>
                <span className="send-summary-value">{amount} {displaySymbol}</span>
              </div>
              <div className="send-summary-row">
                <span className="send-summary-label">To</span>
                <span className="send-summary-value">
                  {recipientName && !recipientName.match(/^(Address|Wallet)\s*\d*$/i) 
                    ? recipientName 
                    : `${recipient.slice(0, 6)}...${recipient.slice(-4)}`}
                </span>
              </div>
              <div className="send-summary-row">
                <span className="send-summary-label">Network Fee</span>
                <span className="send-summary-value">
                  ~{(getBaseFee(network) + (priority === 'custom' ? parseFloat(customFee) || 0 : getPriorityOptions(network).find(p => p.id === priority)?.fee || 0)).toFixed(6)} {networkConfig.symbol}
                </span>
              </div>
            </div>

            {/* Priority Selector */}
            <div className="send-priority-section">
              <div className="send-priority-label">Transaction Priority</div>
              <div className="send-priority-selector">
                {getPriorityOptions(network).filter(opt => opt.id !== 'custom').map(opt => (
                  <button
                    key={opt.id}
                    className={`send-priority-btn ${priority === opt.id ? 'active' : ''}`}
                    onClick={() => { setPriority(opt.id); setCustomFee(''); }}
                    type="button"
                    disabled={sending}
                  >
                    {opt.name}
                  </button>
                ))}
                <button
                  className={`send-priority-btn ${priority === 'custom' ? 'active' : ''}`}
                  onClick={() => setPriority('custom')}
                  type="button"
                  disabled={sending}
                >
                  ⚙
                </button>
              </div>
              
              {/* Custom Fee Input - only show when custom selected */}
              {priority === 'custom' && (
                <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <input
                    type="number"
                    min="0"
                    style={{
                      width: 100,
                      padding: '8px 12px',
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 8,
                      color: 'var(--text-primary)',
                      fontSize: 13,
                      textAlign: 'right'
                    }}
                    placeholder="0.0001"
                    value={customFee}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value.startsWith('-') || parseFloat(value) < 0) return;
                      setCustomFee(value);
                    }}
                    step="0.0001"
                    min="0"
                    disabled={sending}
                  />
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{networkConfig.symbol}</span>
                </div>
              )}
            </div>

            {/* Hardware wallet status */}
            {hwStatus && (
              <div className="send-hw-status">
                <div className="spinner" style={{ width: 20, height: 20 }} />
                <span>{hwStatus}</span>
              </div>
            )}

            {error && <div className="error-message">{error}</div>}

            {/* Action Buttons */}
            <div className="send-confirm-actions">
              <button 
                className="btn-secondary send-deny-btn"
                onClick={() => goToStep(STEPS.AMOUNT, 'left')}
                disabled={sending}
              >
                Deny
              </button>
              <button 
                className="btn-primary send-approve-btn"
                onClick={handleSend}
                disabled={sending}
              >
                {sending ? 'Sending...' : 'Approve'}
              </button>
            </div>
          </div>
        );

      // STEP 5: Success
      case STEPS.SUCCESS:
        const isSelfTransferNoOp = txHash === 'self-transfer-no-op';
        return (
          <div className="send-step-content send-success">
            <div className="success-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <h2 className="send-success-title">{isSelfTransferNoOp ? 'Complete!' : 'Sent!'}</h2>
            <p className="send-success-amount">{amount} {displaySymbol}</p>
            <p className="send-success-to">to {recipient.slice(0, 6)}...{recipient.slice(-4)}</p>
            
            {isSelfTransferNoOp && (
              <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 8 }}>
                Self-transfer - no blockchain transaction needed
              </p>
            )}
            
            {txHash && !isSelfTransferNoOp && (
              <button 
                className="btn-secondary" 
                onClick={() => window.open(getTxExplorerUrl(network, txHash), '_blank')}
                style={{ marginTop: 16 }}
              >
                View on Explorer
              </button>
            )}
            <button className="btn-primary" onClick={onBack} style={{ marginTop: 12 }}>
              Done
            </button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="screen send-screen send-flow-container">
      {/* Header */}
      <div className="page-header">
        <div className="header-left">
          {step !== STEPS.SUCCESS && (
            <button className="back-btn" onClick={handleBack}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {step === STEPS.TOKEN ? (
                  <path d="M18 6L6 18M6 6l12 12" />
                ) : (
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                )}
              </svg>
            </button>
          )}
        </div>
        <h2 className="header-title">{getHeaderTitle()}</h2>
        <div className="header-right" />
      </div>

      {/* Content with slide animation */}
      <div 
        className={`send-flow-content slide-${slideDirection}`}
        key={step}
      >
        {renderStep()}
      </div>
    </div>
  );
}