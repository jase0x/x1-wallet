// Send Screen - Supports Native and SPL Tokens
import React, { useState, useEffect } from 'react';
import X1Logo from './X1Logo';
import { NETWORKS, getTxExplorerUrl } from '@x1-wallet/core/services/networks';
import { logger, getUserFriendlyError, ErrorMessages } from '@x1-wallet/core';
import { validateAddress } from '@x1-wallet/core/utils/base58';
import { hardwareWallet } from '../services/hardware';

// Get base transaction fee for network
function getBaseFee(network) {
  const isX1 = network?.includes('X1');
  return isX1 ? 0.002 : 0.000005; // X1: 0.002 XNT, Solana: 5000 lamports
}

export default function SendScreen({ wallet, selectedToken: initialToken, userTokens = [], onBack, onSuccess }) {
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [txHash, setTxHash] = useState('');
  const [showTokenSelector, setShowTokenSelector] = useState(false);
  const [showWalletSelector, setShowWalletSelector] = useState(false);
  const [currentToken, setCurrentToken] = useState(initialToken);
  const [myWallets, setMyWallets] = useState([]);
  const [addressWarning, setAddressWarning] = useState('');
  const [hwStatus, setHwStatus] = useState(''); // Hardware wallet status message

  // Check if this is a hardware wallet - check multiple paths
  const isHardwareWallet = wallet?.wallet?.isHardware || 
                           wallet?.activeWallet?.isHardware || 
                           wallet?.isHardware ||
                           false;
  
  // Debug logging for hardware wallet detection
  useEffect(() => {
    logger.log('[SendScreen] Hardware wallet check:', {
      'wallet?.wallet?.isHardware': wallet?.wallet?.isHardware,
      'wallet?.activeWallet?.isHardware': wallet?.activeWallet?.isHardware,
      'wallet?.isHardware': wallet?.isHardware,
      'isHardwareWallet': isHardwareWallet,
      'wallet?.wallet?.type': wallet?.wallet?.type
    });
  }, [wallet, isHardwareWallet]);

  // Load user's wallets for quick select
  useEffect(() => {
    const loadWallets = async () => {
      try {
        const stored = localStorage.getItem('x1_wallets');
        if (stored) {
          const wallets = JSON.parse(stored);
          // Filter out current wallet
          const otherWallets = wallets.filter(w => w.publicKey !== wallet?.wallet?.publicKey);
          setMyWallets(otherWallets);
        }
      } catch (e) {
        logger.warn('[SendScreen] Failed to load wallets');
      }
    };
    loadWallets();
  }, [wallet?.wallet?.publicKey]);

  // Track userTokens prop changes in dev only
  useEffect(() => {
    logger.log('[SendScreen] userTokens updated:', userTokens?.length);
  }, [userTokens]);
  
  // Validate address as user types
  useEffect(() => {
    if (recipient.trim()) {
      const result = validateAddress(recipient.trim());
      if (!result.valid) {
        setAddressWarning(result.error);
      } else {
        setAddressWarning('');
        // Check if sending to self
        if (recipient.trim() === wallet?.wallet?.publicKey) {
          setAddressWarning('Warning: You are sending to your own address');
        }
      }
    } else {
      setAddressWarning('');
    }
  }, [recipient, wallet?.wallet?.publicKey]);

  // Safe access to network config
  const network = wallet?.network || 'X1 Mainnet';
  const networkConfig = NETWORKS[network] || {
    symbol: 'XNT',
    decimals: 9,
    rpcUrl: 'https://rpc.testnet.x1.xyz',
    explorer: 'https://explorer.x1.xyz'
  };

  // Build token list: native token + user's SPL tokens
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

  // Filter user tokens that have a balance
  const tokensWithBalance = (userTokens || []).filter(t => {
    // Try multiple balance fields
    const bal = parseFloat(t.uiAmount) || parseFloat(t.balance) || 0;
    // Also check raw amount (in smallest units)
    const rawAmount = parseInt(t.amount) || 0;
    const hasBalance = bal > 0 || rawAmount > 0;
    if (hasBalance) {
      logger.log('[SendScreen] Token with balance:', t.symbol || t.mint?.slice(0, 8));
    }
    return hasBalance;
  }).sort((a, b) => {
    // Sort by USD value (highest first), fallback to raw balance
    const aBalance = parseFloat(a.uiAmount || a.balance || 0);
    const bBalance = parseFloat(b.uiAmount || b.balance || 0);
    const aPrice = parseFloat(a.price || 0);
    const bPrice = parseFloat(b.price || 0);
    const aUsdValue = a.usdValue || (aBalance * aPrice);
    const bUsdValue = b.usdValue || (bBalance * bPrice);
    
    if (aUsdValue > 0 || bUsdValue > 0) {
      return bUsdValue - aUsdValue;
    }
    return bBalance - aBalance;
  });

  // Combine native token with user's SPL tokens
  const availableTokens = [nativeToken, ...tokensWithBalance];

  // Set initial token or default to native
  useEffect(() => {
    if (!currentToken) {
      setCurrentToken(initialToken || nativeToken);
    }
  }, [initialToken]);
  
  // Determine if sending a token or native currency
  const isTokenSend = currentToken && currentToken.mint;
  
  // Get display values based on token or native
  const displaySymbol = isTokenSend ? currentToken.symbol : networkConfig.symbol;
  const displayBalance = isTokenSend ? (parseFloat(currentToken.balance || currentToken.uiAmount) || 0) : (wallet?.balance || 0);
  const displayDecimals = isTokenSend ? (currentToken.decimals || 9) : networkConfig.decimals;
  const displayName = isTokenSend ? currentToken.name : (network.includes('Solana') ? 'Solana' : 'X1 Native Token');

  const handleSend = async () => {
    setError('');
    
    // Validation
    if (!recipient.trim()) {
      setError('Please enter a recipient address');
      return;
    }
    
    // Use proper address validation
    const addressValidation = validateAddress(recipient.trim());
    if (!addressValidation.valid) {
      setError(addressValidation.error);
      return;
    }
    
    const sendAmount = parseFloat(amount);
    if (!amount || isNaN(sendAmount) || sendAmount <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    
    if (sendAmount > displayBalance) {
      setError('Insufficient balance');
      return;
    }

    // Check wallet availability
    if (!isHardwareWallet && !wallet?.wallet?.privateKey) {
      setError('Wallet not available for signing');
      return;
    }

    setSending(true);
    
    // For hardware wallets, show status
    if (isHardwareWallet) {
      setHwStatus('Connecting to Ledger...');
    }

    try {
      if (isTokenSend) {
        // SPL Token Transfer
        await sendSPLToken(sendAmount);
      } else {
        // Native Transfer
        await sendNative(sendAmount);
      }
    } catch (err) {
      logger.error('[SendScreen] Send error');
      setError(getUserFriendlyError(err, ErrorMessages.transaction.failed));
    } finally {
      setSending(false);
      setHwStatus('');
    }
  };

  // Sign transaction with hardware wallet
  const signWithHardware = async (txMessage) => {
    try {
      setHwStatus('Connecting to Ledger...');
      
      // Connect and open app if needed
      if (!hardwareWallet.isReady()) {
        await hardwareWallet.connect();
        await hardwareWallet.openApp();
      }
      
      // Get derivation path from wallet - check multiple possible locations
      const derivationPath = wallet?.wallet?.derivationPath || 
                             wallet?.derivationPath || 
                             wallet?.activeWallet?.derivationPath ||
                             "44'/501'/0'/0'"; // Default fallback
      logger.log('[SendScreen] Using derivation path:', derivationPath);
      
      setHwStatus('Please confirm transaction on Ledger...');
      
      // Sign the transaction message with the correct derivation path
      const signature = await hardwareWallet.signTransaction(txMessage, derivationPath);
      return signature;
    } catch (err) {
      logger.error('[SendScreen] Hardware signing error:', err);
      if (err.message?.includes('rejected')) {
        throw new Error('Transaction rejected on Ledger');
      }
      if (err.message?.includes('cancelled') || err.message?.includes('No device')) {
        throw new Error('Ledger connection failed. Please make sure your Ledger is connected and the Solana app is open.');
      }
      throw new Error(`Ledger signing failed: ${err.message}`);
    }
  };

  const sendNative = async (sendAmount) => {
    const lamports = Math.floor(sendAmount * Math.pow(10, networkConfig.decimals));
    
    // Check if simulation should be skipped (Fast Mode)
    const skipSimulation = (() => {
      try {
        return JSON.parse(localStorage.getItem('x1wallet_skipSimulation')) ?? false;
      } catch { return false; }
    })();
    
    // Get blockhash
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
      // Hardware wallet flow: build message, sign with device, assemble tx
      const { buildTransferMessage, serializeTransaction } = await import('@x1-wallet/core/utils/transaction');
      
      // Build the unsigned transaction message
      const message = buildTransferMessage(
        wallet.wallet.publicKey,
        recipient.trim(),
        lamports,
        blockhash
      );
      
      // Sign with hardware wallet
      setHwStatus('Please confirm on your Ledger...');
      const signature = await signWithHardware(message);
      
      // Serialize signed transaction
      const serializedTx = serializeTransaction(signature, message);
      tx = btoa(String.fromCharCode(...serializedTx));
    } else {
      // Software wallet flow: create signed transaction directly
      const { createTransferTransaction } = await import('@x1-wallet/core/utils/transaction');
      
      tx = await createTransferTransaction({
        fromPubkey: wallet.wallet.publicKey,
        toPubkey: recipient.trim(),
        lamports,
        recentBlockhash: blockhash,
        privateKey: wallet.wallet.privateKey
      });
    }

    // Simulate transaction first (unless Fast Mode is enabled)
    if (!skipSimulation) {
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
        let errorMsg = 'Transaction simulation failed';
        if (typeof err === 'object' && err.InstructionError) {
          const [, errDetail] = err.InstructionError;
          if (errDetail === 'InsufficientFunds') {
            errorMsg = 'Insufficient funds for this transaction';
          }
        }
        throw new Error(errorMsg);
      }
      logger.log('[SendScreen] Simulation passed');
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
    
    setTxHash(sendData.result);
    setSuccess(true);
    
    // Save to transaction history
    const { addTransaction } = await import('@x1-wallet/core/utils/transaction');
    addTransaction({
      signature: sendData.result,
      type: 'send',
      amount: sendAmount,
      symbol: networkConfig.symbol,
      from: wallet.wallet.publicKey,
      to: recipient.trim(),
      timestamp: Date.now(),
      status: 'confirmed',
      network: network,
      isToken: false
    });
    
    // Track XP for the send (fire and forget)
    const { trackSendXP } = await import('@x1-wallet/core/services/xp');
    trackSendXP({
      user: wallet.wallet.publicKey,
      network: network,
      transactionSignature: sendData.result,
      mint: 'So11111111111111111111111111111111111111112', // Native token
      amount: sendAmount,
      recipient: recipient.trim()
    }).catch(() => { /* XP tracking is non-critical */ });
    
    // Refresh balance
    if (wallet.refreshBalance) wallet.refreshBalance();
    if (onSuccess) onSuccess(sendData.result);
  };

  const sendSPLToken = async (sendAmount) => {
    const tokenAmount = Math.floor(sendAmount * Math.pow(10, currentToken.decimals));
    
    // Get blockhash
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

    // Import token transfer utility
    const { createTokenTransferTransaction } = await import('@x1-wallet/core/utils/transaction');
    
    // FIXED: Added rpcUrl parameter to enable ATA existence check and auto-creation
    const tx = await createTokenTransferTransaction({
      fromPubkey: wallet.wallet.publicKey,
      toPubkey: recipient.trim(),
      mint: currentToken.mint,
      amount: tokenAmount,
      decimals: currentToken.decimals,
      fromTokenAccount: currentToken.address,
      recentBlockhash: blockhash,
      privateKey: wallet.wallet.privateKey,
      programId: currentToken.programId,
      rpcUrl: networkConfig.rpcUrl  // NEW: enables ATA auto-creation if needed
    });

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
    
    setTxHash(sendData.result);
    setSuccess(true);
    
    // Save to transaction history
    const { addTransaction } = await import('@x1-wallet/core/utils/transaction');
    addTransaction({
      signature: sendData.result,
      type: 'send',
      amount: sendAmount,
      symbol: currentToken.symbol,
      from: wallet.wallet.publicKey,
      to: recipient.trim(),
      timestamp: Date.now(),
      status: 'confirmed',
      network: network,
      isToken: true,
      mint: currentToken.mint,
      tokenName: currentToken.name || currentToken.symbol
    });
    
    // Track XP for the send (fire and forget)
    const { trackSendXP } = await import('@x1-wallet/core/services/xp');
    trackSendXP({
      user: wallet.wallet.publicKey,
      network: network,
      transactionSignature: sendData.result,
      mint: currentToken.mint,
      amount: sendAmount,
      recipient: recipient.trim()
    }).catch(() => { /* XP tracking is non-critical */ });
    
    // Refresh balance
    if (wallet.refreshBalance) wallet.refreshBalance();
    if (onSuccess) onSuccess(sendData.result);
  };

  const setMax = () => {
    if (isTokenSend) {
      // For tokens, use full balance
      setAmount(displayBalance.toString());
    } else {
      // For native, reserve some for fees
      const max = Math.max(0, displayBalance - 0.00001);
      setAmount(max.toString());
    }
  };

  // Success screen
  if (success) {
    return (
      <div className="screen send-screen">
        <div className="success-state">
          <div className="success-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <h2>Sent!</h2>
          <p className="success-amount">{amount} {displaySymbol}</p>
          <p className="success-to">to {recipient.slice(0, 6)}...{recipient.slice(-4)}</p>
          {txHash && (
            <button 
              className="btn-secondary" 
              onClick={() => window.open(getTxExplorerUrl(network, txHash), '_blank')}
              style={{ marginTop: 16 }}
            >
              View on Explorer
            </button>
          )}
          <button className="btn-primary" onClick={onBack} style={{ marginTop: 12 }}>Done</button>
        </div>
      </div>
    );
  }

  // Main send form
  return (
    <div className="screen send-screen">
      <div className="page-header">
        <div className="header-left">
          <button className="back-btn" onClick={onBack}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
        <h2 className="header-title">Send</h2>
      </div>

      <div className="sub-screen-content">
        {/* Token/Amount Section - Swap style */}
        <div className="swap-box">
          <div className="swap-box-header">
            <span>You Send</span>
            <span className="swap-balance" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {displayBalance.toLocaleString(undefined, { maximumFractionDigits: 6 })} {displaySymbol}
              <button 
                onClick={setMax}
                type="button"
                style={{
                  background: 'rgba(2, 116, 251, 0.2)',
                  border: 'none',
                  borderRadius: 4,
                  padding: '2px 6px',
                  color: 'var(--x1-blue)',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >MAX</button>
            </span>
          </div>
          <div className="swap-box-main">
            <div className="swap-token-icon" onClick={() => setShowTokenSelector(true)}>
              {isTokenSend ? (
                currentToken.logoURI ? (
                  <img src={currentToken.logoURI} alt={currentToken.symbol} style={{ width: 32, height: 32, objectFit: 'contain' }} />
                ) : (
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{currentToken.symbol?.charAt(0) || '?'}</span>
                )
              ) : (
                <X1Logo size={32} />
              )}
            </div>
            <div className="swap-token-info" onClick={() => setShowTokenSelector(true)}>
              <span className="swap-token-symbol">
                {displaySymbol}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </span>
              <span className="swap-token-name">{displayName}</span>
            </div>
            <div className="swap-input-area">
              <input
                type="text"
                inputMode="decimal"
                className="swap-amount-input"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                autoComplete="off"
              />
            </div>
          </div>
        </div>

        {/* Token Selector Dropdown */}
        {showTokenSelector && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.8)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{
              background: 'var(--bg-primary)',
              borderRadius: '0 0 16px 16px',
              maxHeight: '70vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}>
              <div style={{ 
                padding: '16px 20px', 
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <h3 style={{ margin: 0, fontSize: 16 }}>Select Token</h3>
                <button 
                  onClick={() => setShowTokenSelector(false)}
                  style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', padding: 4 }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div style={{ overflow: 'auto', padding: '8px 0' }}>
                {availableTokens.map((token, i) => (
                  <div
                    key={token.mint || 'native'}
                    onClick={() => {
                      setCurrentToken(token);
                      setShowTokenSelector(false);
                      setAmount('');
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px 20px',
                      cursor: 'pointer',
                      background: (token.mint === currentToken?.mint) ? 'var(--bg-tertiary)' : 'transparent'
                    }}
                  >
                    {token.isNative ? (
                      <X1Logo size={40} />
                    ) : token.logoURI ? (
                      <div style={{
                        width: 40,
                        height: 40,
                        borderRadius: '50%',
                        background: '#000',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        flexShrink: 0
                      }}>
                        <img src={token.logoURI} alt={token.symbol} style={{ width: 32, height: 32, objectFit: 'contain' }} />
                      </div>
                    ) : (
                      <div style={{
                        width: 40,
                        height: 40,
                        borderRadius: '50%',
                        background: '#000000',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 14,
                        fontWeight: 600,
                        color: 'white',
                        flexShrink: 0
                      }}>
                        {token.symbol?.charAt(0) || '?'}
                      </div>
                    )}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>
                        {token.symbol}
                        {token.isNative && (
                          <span className="token-badge" style={{ marginLeft: 6 }}>Native</span>
                        )}
                        {token.isToken2022 && (
                          <span className="token-badge" style={{ marginLeft: 6 }}>Token-2022</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{token.name}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 14 }}>
                        {parseFloat(token.balance || token.uiAmount || 0).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                      </div>
                    </div>
                  </div>
                ))}
                {availableTokens.length === 1 && (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    No other tokens with balance
                  </div>
                )}
              </div>
            </div>
            <div style={{ flex: 1 }} onClick={() => setShowTokenSelector(false)} />
          </div>
        )}

        {/* Recipient Section */}
        <div className="swap-box" style={{ marginTop: 8 }}>
          <div className="swap-box-header">
            <span>To</span>
          </div>
          <div className="recipient-field" style={{ marginTop: 8 }}>
            <input
              type="text"
              className="form-input"
              placeholder={myWallets.length > 0 ? "Paste address or select wallet" : "Recipient address"}
              value={recipient}
              onChange={(e) => { setRecipient(e.target.value); setShowWalletSelector(false); }}
              onClick={() => !recipient && myWallets.length > 0 && setShowWalletSelector(true)}
              autoComplete="off"
              spellCheck="false"
            />
            {recipient && (
              <button 
                className="clear-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setRecipient('');
                }}
                type="button"
              >
                ×
              </button>
            )}
          </div>
          
          {/* My Wallets Quick Select */}
          {showWalletSelector && myWallets.length > 0 && (
            <div className="wallet-selector-dropdown">
              <div className="wallet-selector-header">
                <span>Select Wallet</span>
                <button onClick={() => setShowWalletSelector(false)}>×</button>
              </div>
              {myWallets.map((w, i) => (
                <div 
                  key={w.publicKey || i}
                  className="wallet-selector-item"
                  onClick={() => {
                    setRecipient(w.publicKey);
                    setShowWalletSelector(false);
                  }}
                >
                  <span className="wallet-selector-name">{w.name || `Wallet ${i + 1}`}</span>
                  <span className="wallet-selector-address">
                    {w.publicKey?.slice(0, 6)}...{w.publicKey?.slice(-4)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <div className="error-message">{error}</div>}
        
        {/* Hardware wallet status */}
        {hwStatus && (
          <div style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--accent-color)',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 12
          }}>
            <div className="spinner" style={{ width: 20, height: 20 }} />
            <span style={{ color: 'var(--accent-color)', fontSize: 14 }}>{hwStatus}</span>
          </div>
        )}

        <div className="send-summary">
          <div className="summary-row">
            <span>Network Fee</span>
            <span>~{getBaseFee(network)} {networkConfig.symbol}</span>
          </div>
          <div className="summary-row total">
            <span>Total</span>
            <span>{amount || '0'} {displaySymbol}</span>
          </div>
        </div>

        <button 
          className="btn-primary" 
          onClick={handleSend}
          disabled={sending || !recipient || !amount}
          type="button"
        >
          {sending ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  );
}