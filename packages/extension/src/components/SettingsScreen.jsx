// Settings Screen
import { logger, getUserFriendlyError, ErrorMessages } from '@x1-wallet/core';
import React, { useState, useEffect } from 'react';
import X1Logo from './X1Logo';
import { NETWORKS, getRpcOverride, setRpcOverride, clearRpcOverride } from '@x1-wallet/core/services/networks';

const storage = {
  get: (key, defaultValue) => {
    try { return JSON.parse(localStorage.getItem(`x1wallet_${key}`)) ?? defaultValue; }
    catch { return defaultValue; }
  },
  set: (key, value) => localStorage.setItem(`x1wallet_${key}`, JSON.stringify(value))
};

export default function SettingsScreen({ wallet, onBack, onLock }) {
  const [subScreen, setSubScreen] = useState(null);
  const [darkMode, setDarkMode] = useState(() => storage.get('darkMode', true));
  const [autoLock, setAutoLock] = useState(() => storage.get('autoLock', 5));
  const [currency, setCurrency] = useState(() => storage.get('currency', 'USD'));
  const [notifications, setNotifications] = useState(() => storage.get('notifications', true));
  const [skipSimulation, setSkipSimulation] = useState(() => storage.get('skipSimulation', false));
  const [passwordProtection, setPasswordProtection] = useState(() => {
    const hasHash = storage.get('passwordHash', null) !== null;
    return hasHash ? storage.get('passwordProtection', true) : false;
  });
  const [biometricEnabled, setBiometricEnabled] = useState(() => storage.get('biometricEnabled', false));
  const [customExplorer, setCustomExplorer] = useState(() => storage.get('customExplorer', ''));
  const [copied, setCopied] = useState(false);
  
  // Check if biometric is available (not available in browser extensions)
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  
  useEffect(() => {
    // Check if we're in a mobile context or if WebAuthn is available
    const checkBiometric = async () => {
      try {
        // Browser extensions don't support biometrics
        const isExtension = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
        if (isExtension) {
          setBiometricAvailable(false);
          return;
        }
        
        // Check for WebAuthn support (mobile browsers might support this)
        if (window.PublicKeyCredential) {
          const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
          setBiometricAvailable(available);
        } else {
          setBiometricAvailable(false);
        }
      } catch (e) {
        setBiometricAvailable(false);
      }
    };
    checkBiometric();
  }, []);
  
  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  
  // Recovery phrase state - must be at top level
  const [recoveryView, setRecoveryView] = useState('menu');
  const [showPhrase, setShowPhrase] = useState(false);
  const [newMnemonic, setNewMnemonic] = useState('');
  const [customWords, setCustomWords] = useState(Array(12).fill(''));
  const [seedLength, setSeedLength] = useState(12);
  const [recoveryError, setRecoveryError] = useState('');
  
  // Private key state
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [privateKeyView, setPrivateKeyView] = useState('menu'); // menu, view, import
  const [importPrivateKey, setImportPrivateKey] = useState('');
  const [privateKeyError, setPrivateKeyError] = useState('');
  const [privateKeyCopied, setPrivateKeyCopied] = useState(false);
  
  // Password verification state for sensitive data
  const [passwordVerified, setPasswordVerified] = useState(false);
  const [verifyPassword, setVerifyPassword] = useState('');
  const [verifyError, setVerifyError] = useState('');
  
  // Network sub-screen state - moved to top level
  const [showAddRpc, setShowAddRpc] = useState(false);
  const [customRpc, setCustomRpc] = useState({ name: '', url: '', symbol: '', decimals: 9, explorer: '' });
  const [customRpcs, setCustomRpcs] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('x1wallet_customRpcs')) || [];
    } catch { return []; }
  });
  const [error, setError] = useState('');
  
  // RPC Override state - for customizing RPC URLs of built-in networks
  const [rpcOverrides, setRpcOverrides] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('x1wallet_rpcOverrides')) || {};
    } catch { return {}; }
  });
  const [editingRpcOverride, setEditingRpcOverride] = useState(null);
  const [rpcOverrideUrl, setRpcOverrideUrl] = useState('');
  
  // Notification state - must be at top level
  const [notifPermission, setNotifPermission] = useState(() => 
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  );
  const [txAlerts, setTxAlerts] = useState(() => storage.get('txAlerts', true));
  const [priceAlerts, setPriceAlerts] = useState(() => storage.get('priceAlerts', false));
  const [securityAlerts, setSecurityAlerts] = useState(() => storage.get('securityAlerts', true));

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    storage.set('darkMode', darkMode);
  }, [darkMode]);

  useEffect(() => { storage.set('autoLock', autoLock); }, [autoLock]);
  useEffect(() => { storage.set('currency', currency); }, [currency]);
  useEffect(() => { storage.set('notifications', notifications); }, [notifications]);
  useEffect(() => { storage.set('skipSimulation', skipSimulation); }, [skipSimulation]);
  useEffect(() => { storage.set('passwordProtection', passwordProtection); }, [passwordProtection]);
  useEffect(() => { storage.set('biometricEnabled', biometricEnabled); }, [biometricEnabled]);
  useEffect(() => { storage.set('customExplorer', customExplorer); }, [customExplorer]);
  
  // Reset recovery state when leaving recovery screen
  useEffect(() => {
    if (subScreen !== 'recovery') {
      setRecoveryView('menu');
      setShowPhrase(false);
      setNewMnemonic('');
      setCustomWords(Array(12).fill(''));
      setRecoveryError('');
      setPasswordVerified(false);
      setVerifyPassword('');
      setVerifyError('');
    }
  }, [subScreen]);

  // Reset private key state when leaving private key screen
  useEffect(() => {
    if (subScreen !== 'privatekey') {
      setShowPrivateKey(false);
      setPrivateKeyView('menu');
      setImportPrivateKey('');
      setPrivateKeyError('');
      setPrivateKeyCopied(false);
      setPasswordVerified(false);
      setVerifyPassword('');
      setVerifyError('');
    }
  }, [subScreen]);

  const copyAddress = () => {
    navigator.clipboard.writeText(wallet.wallet?.publicKey || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const saveCustomRpc = () => {
    // Validate inputs
    if (!customRpc.name?.trim()) {
      setError('Please enter a network name');
      return;
    }
    if (!customRpc.url?.trim()) {
      setError('Please enter an RPC URL');
      return;
    }
    // Basic URL validation
    if (!customRpc.url.startsWith('http://') && !customRpc.url.startsWith('https://')) {
      setError('RPC URL must start with http:// or https://');
      return;
    }
    
    const newNetwork = {
      ...customRpc,
      id: Date.now(),
      name: customRpc.name.trim(),
      url: customRpc.url.trim(),
      symbol: customRpc.symbol?.trim() || 'TOKEN',
      decimals: parseInt(customRpc.decimals) || 9,
      explorer: customRpc.explorer?.trim() || ''
    };
    
    const newRpcs = [...customRpcs, newNetwork];
    setCustomRpcs(newRpcs);
    localStorage.setItem('x1wallet_customRpcs', JSON.stringify(newRpcs));
    setShowAddRpc(false);
    setCustomRpc({ name: '', url: '', symbol: '', decimals: 9, explorer: '' });
    setError('');
  };

  const removeCustomRpc = (id) => {
    const newRpcs = customRpcs.filter(r => r.id !== id);
    setCustomRpcs(newRpcs);
    localStorage.setItem('x1wallet_customRpcs', JSON.stringify(newRpcs));
  };

  // Save RPC override for a built-in network
  const saveRpcOverride = (networkName) => {
    const url = rpcOverrideUrl.trim();
    if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
      setError('RPC URL must start with http:// or https://');
      return;
    }
    
    const newOverrides = { ...rpcOverrides };
    if (url) {
      newOverrides[networkName] = url;
    } else {
      delete newOverrides[networkName];
    }
    
    setRpcOverrides(newOverrides);
    localStorage.setItem('x1wallet_rpcOverrides', JSON.stringify(newOverrides));
    setEditingRpcOverride(null);
    setRpcOverrideUrl('');
    setError('');
  };

  // Clear RPC override for a network
  const clearRpcOverrideForNetwork = (networkName) => {
    const newOverrides = { ...rpcOverrides };
    delete newOverrides[networkName];
    setRpcOverrides(newOverrides);
    localStorage.setItem('x1wallet_rpcOverrides', JSON.stringify(newOverrides));
  };

  // Start editing RPC override
  const startEditingRpcOverride = (networkName) => {
    setEditingRpcOverride(networkName);
    setRpcOverrideUrl(rpcOverrides[networkName] || '');
    setError('');
  };

  // X1W-SEC-006 FIX: Use PBKDF2 verification instead of base64
  const verifyUserPassword = async () => {
    try {
      const { checkPassword } = await import('@x1-wallet/core/services/wallet');
      const isValid = await checkPassword(verifyPassword);
      
      if (isValid) {
        setPasswordVerified(true);
        setVerifyError('');
        setVerifyPassword('');
      } else {
        setVerifyError('Incorrect password');
      }
    } catch (err) {
      setVerifyError(err.message || 'Password verification failed');
    }
  };

  // Check if password protection is enabled
  const [hasPasswordProtection, setHasPasswordProtection] = useState(false);
  
  useEffect(() => {
    const checkPasswordProtection = async () => {
      if (!passwordProtection) {
        setHasPasswordProtection(false);
        return;
      }
      try {
        const { hasPassword } = await import('@x1-wallet/core/services/wallet');
        const result = await hasPassword();
        setHasPasswordProtection(result);
      } catch {
        setHasPasswordProtection(!!storage.get('x1wallet_auth', null));
      }
    };
    checkPasswordProtection();
  }, [passwordProtection]);

  // Sub-screens
  if (subScreen === 'autolock') {
    const options = [
      { value: 0, label: 'Immediately' },
      { value: 1, label: '1 minute' },
      { value: 5, label: '5 minutes' },
      { value: 15, label: '15 minutes' },
      { value: 30, label: '30 minutes' },
      { value: -1, label: 'Never' },
    ];
    return (
      <div className="screen settings-screen">
        <div className="settings-header">
          <button className="back-btn" onClick={() => setSubScreen(null)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <h2>Auto-Lock Timer</h2>
        </div>
        <div className="settings-content">
          <div className="radio-group">
            {options.map(opt => (
              <div key={opt.value} className={`radio-option ${autoLock === opt.value ? 'selected' : ''}`} onClick={() => setAutoLock(opt.value)}>
                <span className="radio-option-text">{opt.label}</span>
                <div className="radio-option-check">
                  {autoLock === opt.value && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (subScreen === 'currency') {
    const currencies = [
      { code: 'USD', name: 'US Dollar', symbol: '$' },
      { code: 'EUR', name: 'Euro', symbol: '€' },
      { code: 'GBP', name: 'British Pound', symbol: '£' },
      { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
      { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$' },
      { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
      { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
      { code: 'KRW', name: 'Korean Won', symbol: '₩' },
    ];
    return (
      <div className="screen settings-screen">
        <div className="settings-header">
          <button className="back-btn" onClick={() => setSubScreen(null)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <h2>Currency</h2>
        </div>
        <div className="settings-content">
          <div className="radio-group">
            {currencies.map(c => (
              <div key={c.code} className={`radio-option ${currency === c.code ? 'selected' : ''}`} onClick={() => setCurrency(c.code)}>
                <div className="radio-option-text">
                  <span>{c.symbol} {c.code}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}> - {c.name}</span>
                </div>
                <div className="radio-option-check">
                  {currency === c.code && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (subScreen === 'recovery') {
    // Menu view
    if (recoveryView === 'menu') {
      const hasMnemonic = wallet.getMnemonic ? !!wallet.getMnemonic() : false;
      
      return (
        <div className="screen settings-screen">
          <div className="settings-header">
            <button className="back-btn" onClick={() => setSubScreen(null)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
            <h2>Seed Phrase</h2>
          </div>
          <div className="settings-content">
            {hasMnemonic ? (
              <div className="settings-section">
                <div className="settings-item" onClick={() => setRecoveryView('view')}>
                  <div className="settings-item-left">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    <div className="settings-item-text">
                      <span>View Seed Phrase</span>
                      <span className="settings-item-desc">Backup your 12 or 24 words</span>
                    </div>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </div>
              </div>
            ) : (
              <div className="info-box">
                <span>ℹ️</span>
                <span>This wallet was imported via private key and does not have a seed phrase. To backup, use Settings → Private Key.</span>
              </div>
            )}
            
            <div className="warning-box" style={{ marginTop: 20 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffa502" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>Your seed phrase gives full access to all addresses in this wallet. Never share it with anyone!</span>
            </div>
            
            {hasMnemonic && wallet.wallet?.addresses && (
              <div className="info-box" style={{ marginTop: 12 }}>
                <span>💡</span>
                <span>This wallet has {wallet.wallet.addresses.length} address{wallet.wallet.addresses.length > 1 ? 'es' : ''}. All addresses can be recovered from this single seed phrase.</span>
              </div>
            )}
          </div>
        </div>
      );
    }
    
    // View phrase
    if (recoveryView === 'view') {
      const phrase = wallet.getMnemonic ? wallet.getMnemonic() : '';
      const words = phrase ? phrase.split(' ') : [];
      
      // Show password verification first if enabled
      if (hasPasswordProtection && !passwordVerified) {
        return (
          <div className="screen settings-screen">
            <div className="settings-header">
              <button className="back-btn" onClick={() => setRecoveryView('menu')}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </button>
              <h2>Verify Password</h2>
            </div>
            <div className="settings-content">
              <div className="reveal-phrase-section">
                <div className="reveal-icon">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>
                <p>Enter your password to view seed phrase</p>
                <div className="form-group" style={{ marginTop: 16, width: '100%' }}>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="Enter password"
                    value={verifyPassword}
                    onChange={(e) => setVerifyPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && verifyUserPassword()}
                    autoFocus
                  />
                </div>
                {verifyError && <div className="error-message">{verifyError}</div>}
                <button className="btn-primary" onClick={verifyUserPassword} disabled={!verifyPassword}>
                  Verify
                </button>
              </div>
            </div>
          </div>
        );
      }
      
      return (
        <div className="screen settings-screen">
          <div className="settings-header">
            <button className="back-btn" onClick={() => {
              setShowPhrase(false);
              setPasswordVerified(false);
              setRecoveryView('menu');
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
            <h2>View Seed Phrase</h2>
          </div>
          <div className="settings-content">
            {!showPhrase ? (
              <div className="reveal-phrase-section">
                <div className="reveal-icon">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                </div>
                <p>Your seed phrase is hidden for security.</p>
                <button className="btn-primary" onClick={() => setShowPhrase(true)}>
                  Reveal Phrase
                </button>
              </div>
            ) : (
              <>
                <div className="warning-box">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffa502" strokeWidth="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <span>Never share your seed phrase with anyone!</span>
                </div>
                <div className="seed-phrase-display">
                  {words.length > 0 ? words.map((word, i) => (
                    <div key={i} className="seed-word">
                      <span className="seed-number">{i + 1}</span>
                      <span className="seed-text">{word}</span>
                    </div>
                  )) : (
                    <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No seed phrase available for hardware wallets</p>
                  )}
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '20px' }}>
                  {words.length > 0 && (
                    <button 
                      className="btn-secondary" 
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}
                      onClick={() => {
                        navigator.clipboard.writeText(phrase);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                      <span>{copied ? 'Copied!' : 'Copy to Clipboard'}</span>
                    </button>
                  )}
                  <button 
                    className="btn-primary"
                    onClick={() => {
                      setShowPhrase(false);
                      setPasswordVerified(false);
                      setRecoveryView('menu');
                    }}
                  >
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      );
    }
    
    return null;
  }

  // Private Key subscreen
  if (subScreen === 'privatekey') {
    const currentPrivateKey = wallet.wallet?.privateKey || '';
    
    const copyPrivateKey = () => {
      navigator.clipboard.writeText(currentPrivateKey);
      setPrivateKeyCopied(true);
      setTimeout(() => setPrivateKeyCopied(false), 2000);
    };
    
    const handleImportPrivateKey = async () => {
      setPrivateKeyError('');
      
      if (!importPrivateKey.trim()) {
        setPrivateKeyError('Please enter a private key');
        return;
      }
      
      try {
        // Validate it's a valid base58 string (should be 64 or 88 characters for Solana keys)
        const trimmedKey = importPrivateKey.trim();
        
        // Base58 character set check
        const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
        if (!base58Regex.test(trimmedKey)) {
          setPrivateKeyError('Invalid private key format (not base58)');
          return;
        }
        
        // Decode to verify length
        const { decodeBase58, encodeBase58 } = await import('@x1-wallet/core/utils/base58');
        const decoded = decodeBase58(trimmedKey);
        
        // Solana private keys are 64 bytes (secret key) or 32 bytes (seed)
        if (decoded.length !== 64 && decoded.length !== 32) {
          setPrivateKeyError(`Invalid key length: ${decoded.length} bytes (expected 32 or 64)`);
          return;
        }
        
        // If 32 bytes, we need to derive the public key
        let secretKey = decoded;
        let publicKey;
        
        if (decoded.length === 32) {
          // Need to derive keypair from seed
          const { getPublicKey } = await import('@x1-wallet/core/utils/bip44');
          publicKey = getPublicKey(decoded);
          // Create full 64-byte secret key
          secretKey = new Uint8Array(64);
          secretKey.set(decoded, 0);
          secretKey.set(publicKey, 32);
        } else {
          // Already 64 bytes - extract public key
          publicKey = decoded.slice(32);
        }
        
        const publicKeyBase58 = encodeBase58(publicKey);
        const privateKeyBase58 = encodeBase58(secretKey);
        
        // Create new wallet entry
        const newWallet = {
          id: Date.now().toString(),
          name: `Imported ${publicKeyBase58.slice(0, 4)}...`,
          publicKey: publicKeyBase58,
          privateKey: privateKeyBase58,
          mnemonic: null, // No mnemonic for imported private keys
          type: 'imported',
          createdAt: new Date().toISOString()
        };
        
        // Add to wallet list
        const existingWallets = JSON.parse(localStorage.getItem('x1wallet_wallets') || '[]');
        
        // Check if already exists
        if (existingWallets.some(w => w.publicKey === publicKeyBase58)) {
          setPrivateKeyError('This wallet is already imported');
          return;
        }
        
        existingWallets.push(newWallet);
        localStorage.setItem('x1wallet_wallets', JSON.stringify(existingWallets));
        localStorage.setItem('x1wallet_active', newWallet.id);
        
        // Refresh wallet state
        alert(`Wallet imported successfully!\n\nAddress: ${publicKeyBase58.slice(0, 20)}...`);
        
        setImportPrivateKey('');
        setPrivateKeyView('menu');
        
        // Reload page to refresh wallet
        window.location.reload();
        
      } catch (err) {
        logger.error('Import error:', err);
        setPrivateKeyError('Failed to import: ' + err.message);
      }
    };
    
    // Menu view
    if (privateKeyView === 'menu') {
      return (
        <div className="screen settings-screen">
          <div className="sub-screen-header">
            <button className="back-btn" onClick={() => setSubScreen(null)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
            <h2>Private Key</h2>
          </div>
          
          <div className="sub-screen-content">
            <div className="warning-box" style={{ marginBottom: 20 }}>
              <span>⚠️</span>
              <span>Never share your private key. Anyone with your private key has full control of your wallet.</span>
            </div>
            
            <div className="settings-section">
              <div className="settings-item" onClick={() => setPrivateKeyView('view')}>
                <div className="settings-item-left">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <div>
                    <span>View Private Key</span>
                    <span className="settings-item-desc">Export your private key</span>
                  </div>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </div>
              
              <div className="settings-item" onClick={() => setPrivateKeyView('import')}>
                <div className="settings-item-left">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <div>
                    <span>Import Private Key</span>
                    <span className="settings-item-desc">Import wallet from private key</span>
                  </div>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      );
    }
    
    // View private key
    if (privateKeyView === 'view') {
      // Show password verification first if enabled
      if (hasPasswordProtection && !passwordVerified) {
        return (
          <div className="screen settings-screen">
            <div className="sub-screen-header">
              <button className="back-btn" onClick={() => setPrivateKeyView('menu')}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </button>
              <h2>Verify Password</h2>
            </div>
            <div className="sub-screen-content">
              <div className="reveal-phrase-section">
                <div className="reveal-icon">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>
                <p>Enter your password to view private key</p>
                <div className="form-group" style={{ marginTop: 16, width: '100%' }}>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="Enter password"
                    value={verifyPassword}
                    onChange={(e) => setVerifyPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && verifyUserPassword()}
                    autoFocus
                  />
                </div>
                {verifyError && <div className="error-message">{verifyError}</div>}
                <button className="btn-primary" onClick={verifyUserPassword} disabled={!verifyPassword}>
                  Verify
                </button>
              </div>
            </div>
          </div>
        );
      }
      
      return (
        <div className="screen settings-screen">
          <div className="sub-screen-header">
            <button className="back-btn" onClick={() => {
              setShowPrivateKey(false);
              setPasswordVerified(false);
              setPrivateKeyView('menu');
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
            <h2>View Private Key</h2>
          </div>
          
          <div className="sub-screen-content">
            <div className="warning-box danger" style={{ marginBottom: 20 }}>
              <span>🚨</span>
              <span>DO NOT share this key with anyone! It provides full access to your wallet.</span>
            </div>
            
            <div className="form-group">
              <label>Wallet Address</label>
              <div className="readonly-field">
                {wallet.wallet?.publicKey?.slice(0, 20)}...{wallet.wallet?.publicKey?.slice(-8)}
              </div>
            </div>
            
            <div className="form-group">
              <label>Private Key (Base58)</label>
              {!showPrivateKey ? (
                <div className="private-key-hidden">
                  <span>••••••••••••••••••••••••••••••••</span>
                  <button 
                    className="btn-secondary" 
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                    onClick={() => setShowPrivateKey(true)}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    Reveal
                  </button>
                </div>
              ) : (
                <div className="private-key-revealed">
                  <code className="private-key-text">{currentPrivateKey}</code>
                  <div className="private-key-actions">
                    <button 
                      className="btn-secondary" 
                      style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                      onClick={() => setShowPrivateKey(false)}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                      Hide
                    </button>
                    <button 
                      className="btn-primary" 
                      style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                      onClick={copyPrivateKey}
                    >
                      {privateKeyCopied ? (
                        <>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          Copied!
                        </>
                      ) : (
                        <>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
            
            {(wallet.getMnemonic ? wallet.getMnemonic() : null) && (
              <div className="info-box" style={{ marginTop: 16 }}>
                <span>ℹ️</span>
                <span>This wallet also has a seed phrase which can be viewed in Seed Phrase settings.</span>
              </div>
            )}
            
            <button 
              className="btn-primary" 
              style={{ marginTop: 20 }}
              onClick={() => {
                setShowPrivateKey(false);
                setPasswordVerified(false);
                setPrivateKeyView('menu');
              }}
            >
              Done
            </button>
          </div>
        </div>
      );
    }
    
    // Import private key
    if (privateKeyView === 'import') {
      return (
        <div className="screen settings-screen">
          <div className="sub-screen-header">
            <button className="back-btn" onClick={() => setPrivateKeyView('menu')}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
            <h2>Import Private Key</h2>
          </div>
          
          <div className="sub-screen-content">
            <p className="settings-description">
              Enter a base58-encoded private key to import an existing wallet.
            </p>
            
            <div className="form-group">
              <label>Private Key</label>
              <textarea
                className="form-input private-key-input"
                placeholder="Enter your private key (base58)"
                value={importPrivateKey}
                onChange={(e) => { setImportPrivateKey(e.target.value); setPrivateKeyError(''); }}
                rows={3}
              />
            </div>
            
            {privateKeyError && <div className="error-message">{privateKeyError}</div>}
            
            <button 
              className="btn-primary" 
              onClick={handleImportPrivateKey}
              style={{ marginTop: 16 }}
            >
              Import Wallet
            </button>
            
            <div className="info-box" style={{ marginTop: 20 }}>
              <span>ℹ️</span>
              <span>Accepts 64-byte secret keys (88 chars) or 32-byte seeds (44 chars) in base58 format.</span>
            </div>
          </div>
        </div>
      );
    }
    
    return null;
  }

  if (subScreen === 'changepassword') {
    const handlePasswordChange = async () => {
      setPasswordError('');
      setPasswordSuccess(false);
      
      // X1W-SEC-001 FIX: Use PBKDF2 verification from wallet service instead of base64
      try {
        // Import secure password functions from wallet service
        const { checkPassword, setupPassword, validatePasswordStrength } = await import('@x1-wallet/core/services/wallet');
        
        // Check if there's an existing password to verify
        const hasExisting = storage.get('passwordHash', null) !== null;
        
        if (hasExisting) {
          // Verify current password using PBKDF2
          const isValid = await checkPassword(currentPassword);
          if (!isValid) {
            setPasswordError('Current password is incorrect');
            return;
          }
        }
        
        // X1W-SEC-008 FIX: Use consistent password validation (12 chars minimum)
        const validation = validatePasswordStrength(newPassword);
        if (!validation.valid) {
          setPasswordError(validation.error);
          return;
        }
        
        if (newPassword !== confirmPassword) {
          setPasswordError('Passwords do not match');
          return;
        }
        
        // X1W-SEC-002 FIX: Re-encrypt wallet data with new password
        // First, set up the new password hash (PBKDF2)
        await setupPassword(newPassword);
        
        // Then re-encrypt wallet data using wallet hook
        if (wallet.changePassword) {
          await wallet.changePassword(currentPassword, newPassword);
        } else if (wallet.enableEncryption) {
          // Fallback: re-enable encryption with new password
          await wallet.enableEncryption(newPassword);
        }
        
        // Also update the legacy storage key for backward compatibility
        // (but now properly hashed via setupPassword above)
        storage.set('passwordProtection', true);
        setPasswordProtection(true);
        setPasswordSuccess(true);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        
        setTimeout(() => {
          setSubScreen('password');
          setPasswordSuccess(false);
        }, 1500);
      } catch (err) {
        setPasswordError(err.message || 'Failed to change password');
      }
    };
    
    const hasExistingPassword = storage.get('passwordHash', null) !== null;
    
    return (
      <div className="screen settings-screen">
        <div className="settings-header">
          <button className="back-btn" onClick={() => {
            setSubScreen('password');
            setPasswordError('');
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <h2>{hasExistingPassword ? 'Change Password' : 'Set Password'}</h2>
        </div>
        <div className="settings-content">
          {hasExistingPassword && (
            <div className="form-group">
              <label>Current Password</label>
              <input 
                type="password" 
                className="form-input" 
                placeholder="Enter current password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
              />
            </div>
          )}
          <div className="form-group">
            <label>New Password</label>
            <input 
              type="password" 
              className="form-input" 
              placeholder="Enter new password (min 12 chars)"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
            />
            <div className="password-requirements" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
              Requirements: 12+ chars, uppercase, lowercase, number, special character
            </div>
          </div>
          <div className="form-group">
            <label>Confirm New Password</label>
            <input 
              type="password" 
              className="form-input" 
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
            />
          </div>
          {passwordError && <div className="error-message">{passwordError}</div>}
          {passwordSuccess && <div className="success-message">Password {hasExistingPassword ? 'updated' : 'set'} successfully!</div>}
          <button className="btn-primary" onClick={handlePasswordChange}>
            {hasExistingPassword ? 'Update Password' : 'Set Password'}
          </button>
        </div>
      </div>
    );
  }

  // Manage Password sub-screen
  if (subScreen === 'password') {
    const hasPassword = storage.get('passwordHash', null) !== null;
    
    const handleRemovePassword = () => {
      if (confirm('Are you sure you want to remove your password? Your wallet will no longer be protected.')) {
        storage.set('passwordHash', null);
        storage.set('passwordProtection', false);
        setPasswordProtection(false);
      }
    };
    
    return (
      <div className="screen settings-screen">
        <div className="settings-header">
          <button className="back-btn" onClick={() => setSubScreen(null)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <h2>Manage Password</h2>
        </div>
        <div className="settings-content">
          <div className="settings-section">
            {hasPassword && (
              <div className="settings-item" onClick={() => {
                const newValue = !passwordProtection;
                setPasswordProtection(newValue);
                storage.set('passwordProtection', newValue);
              }}>
                <div className="settings-item-left">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                  <div className="settings-item-text">
                    <span>Require Password</span>
                    <span className="settings-item-desc">Ask for password when opening wallet</span>
                  </div>
                </div>
                <div className={`toggle ${passwordProtection ? 'active' : ''}`}>
                  <div className="toggle-handle" />
                </div>
              </div>
            )}
            
            <div className="settings-item" onClick={() => setSubScreen('changepassword')}>
              <div className="settings-item-left">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                </svg>
                <div className="settings-item-text">
                  <span>{hasPassword ? 'Change Password' : 'Set Password'}</span>
                  <span className="settings-item-desc">{hasPassword ? 'Update your current password' : 'Create a new password'}</span>
                </div>
              </div>
              <div className="settings-item-right">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </div>
            </div>
            
            {hasPassword && (
              <div className="settings-item" onClick={handleRemovePassword}>
                <div className="settings-item-left">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  <div className="settings-item-text">
                    <span style={{ color: 'var(--error)' }}>Remove Password</span>
                    <span className="settings-item-desc">Disable password protection</span>
                  </div>
                </div>
                <div className="settings-item-right">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </div>
              </div>
            )}
          </div>
          
          <div className="info-box">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span>{hasPassword 
              ? 'Password protects your wallet from unauthorized access on this device.'
              : 'Set a password to protect your wallet from unauthorized access.'
            }</span>
          </div>
        </div>
      </div>
    );
  }

  // Biometric sub-screen
  if (subScreen === 'biometric') {
    const handleBiometricToggle = async () => {
      if (!biometricEnabled) {
        // Try to enable biometric
        if (window.PublicKeyCredential) {
          try {
            const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
            if (available) {
              setBiometricEnabled(true);
            } else {
              alert('Biometric authentication is not available on this device.');
            }
          } catch {
            alert('Biometric authentication is not supported in this browser.');
          }
        } else {
          alert('Biometric authentication is not supported in this browser.');
        }
      } else {
        setBiometricEnabled(false);
      }
    };
    
    return (
      <div className="screen settings-screen">
        <div className="settings-header">
          <button className="back-btn" onClick={() => setSubScreen(null)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <h2>Biometric Unlock</h2>
        </div>
        <div className="settings-content">
          <div className="settings-section">
            <div className="settings-item" onClick={handleBiometricToggle}>
              <div className="settings-item-left">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 0 0 8 11a4 4 0 1 1 8 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0 0 15.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 0 0 8 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
                </svg>
                <div className="settings-item-text">
                  <span>Enable Biometric Unlock</span>
                  <span className="settings-item-desc">Use fingerprint or face recognition</span>
                </div>
              </div>
              <div className={`toggle ${biometricEnabled ? 'active' : ''}`}>
                <div className="toggle-handle" />
              </div>
            </div>
          </div>
          
          <div className="info-box">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span>Biometric unlock uses your device's fingerprint or face recognition to quickly access your wallet.</span>
          </div>
          
          {biometricEnabled && (
            <div className="success-box">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <span>Biometric unlock is enabled and ready to use.</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Notifications sub-screen
  if (subScreen === 'notifications') {
    const requestPermission = async () => {
      if (typeof Notification === 'undefined') {
        alert('Notifications are not supported in this browser.');
        return;
      }
      
      try {
        const permission = await Notification.requestPermission();
        setNotifPermission(permission);
        if (permission === 'granted') {
          setNotifications(true);
          // Test notification
          new Notification('X1 Wallet', {
            body: 'Notifications enabled successfully!',
            icon: '/icons/icon128.png'
          });
        }
      } catch (err) {
        logger.error('Failed to request notification permission:', err);
      }
    };
    
    const testNotification = () => {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('X1 Wallet', {
          body: 'This is a test notification.',
          icon: '/icons/icon128.png'
        });
      }
    };
    
    return (
      <div className="screen settings-screen">
        <div className="settings-header">
          <button className="back-btn" onClick={() => setSubScreen(null)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <h2>Notifications</h2>
        </div>
        <div className="settings-content">
          <div className="settings-section">
            <div className="settings-item" onClick={() => setNotifications(!notifications)}>
              <div className="settings-item-left">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                <div className="settings-item-text">
                  <span>Enable Notifications</span>
                  <span className="settings-item-desc">Receive alerts for transactions and updates</span>
                </div>
              </div>
              <div className={`toggle ${notifications ? 'active' : ''}`}>
                <div className="toggle-handle" />
              </div>
            </div>
          </div>
          
          {notifications && (
            <div className="settings-section">
              <h3>Notification Types</h3>
              <div className="settings-item" onClick={() => { setTxAlerts(!txAlerts); storage.set('txAlerts', !txAlerts); }}>
                <div className="settings-item-left">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="1" x2="12" y2="23" />
                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                  <div className="settings-item-text">
                    <span>Transaction Alerts</span>
                    <span className="settings-item-desc">Incoming and outgoing transactions</span>
                  </div>
                </div>
                <div className={`toggle ${txAlerts ? 'active' : ''}`}>
                  <div className="toggle-handle" />
                </div>
              </div>
              <div className="settings-item" onClick={() => { setPriceAlerts(!priceAlerts); storage.set('priceAlerts', !priceAlerts); }}>
                <div className="settings-item-left">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                  <div className="settings-item-text">
                    <span>Price Alerts</span>
                    <span className="settings-item-desc">Significant price changes</span>
                  </div>
                </div>
                <div className={`toggle ${priceAlerts ? 'active' : ''}`}>
                  <div className="toggle-handle" />
                </div>
              </div>
              <div className="settings-item" onClick={() => { setSecurityAlerts(!securityAlerts); storage.set('securityAlerts', !securityAlerts); }}>
                <div className="settings-item-left">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <div className="settings-item-text">
                    <span>Security Alerts</span>
                    <span className="settings-item-desc">Login attempts and security events</span>
                  </div>
                </div>
                <div className={`toggle ${securityAlerts ? 'active' : ''}`}>
                  <div className="toggle-handle" />
                </div>
              </div>
            </div>
          )}
          
          {typeof Notification !== 'undefined' && (
            <div className="settings-section">
              <h3>Browser Permission</h3>
              <div className="permission-status">
                <span className={`permission-badge ${notifPermission}`}>
                  {notifPermission === 'granted' ? '✓ Granted' : 
                   notifPermission === 'denied' ? '✗ Denied' : '? Not Set'}
                </span>
              </div>
              {notifPermission !== 'granted' && (
                <button className="btn-primary" onClick={requestPermission} style={{ marginTop: 12 }}>
                  Enable Browser Notifications
                </button>
              )}
              {notifPermission === 'granted' && (
                <button className="btn-secondary" onClick={testNotification} style={{ marginTop: 12 }}>
                  Send Test Notification
                </button>
              )}
              {notifPermission === 'denied' && (
                <div className="info-box" style={{ marginTop: 12 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  <span>Notifications are blocked. Please enable them in your browser settings.</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (subScreen === 'explorer') {
    const currentNetwork = wallet?.network || 'X1 Mainnet';
    const isSolana = currentNetwork.includes('Solana');
    const isTestnet = currentNetwork.includes('Testnet') || currentNetwork.includes('Devnet');
    
    // Network-specific explorers
    const x1MainnetExplorers = [
      { name: 'X1 Explorer', url: 'https://explorer.x1.xyz' },
    ];
    
    const x1TestnetExplorers = [
      { name: 'X1 Testnet Explorer', url: 'https://explorer.testnet.x1.xyz' },
    ];
    
    const solanaExplorers = [
      { name: 'Solscan', url: 'https://solscan.io' },
      { name: 'Solana Explorer', url: 'https://explorer.solana.com' },
      { name: 'SolanaFM', url: 'https://solana.fm' },
    ];
    
    // Select explorers based on current network
    let explorers;
    if (isSolana) {
      explorers = solanaExplorers;
    } else if (isTestnet) {
      explorers = x1TestnetExplorers;
    } else {
      explorers = x1MainnetExplorers;
    }
    const defaultExplorer = explorers[0]?.url || '';
    
    // Get stored explorer for current network type (network-specific keys)
    let explorerKey;
    if (isSolana) {
      explorerKey = currentNetwork.includes('Devnet') ? 'solanaDevnetExplorer' : 'solanaExplorer';
    } else {
      explorerKey = isTestnet ? 'x1TestnetExplorer' : 'x1Explorer';
    }
    const storedExplorer = storage.get(explorerKey, '') || defaultExplorer;
    
    // Check if stored explorer is a preset or custom
    const isPresetExplorer = explorers.some(e => e.url === storedExplorer);
    const customExplorerValue = isPresetExplorer ? '' : storedExplorer;
    
    const handleSelectExplorer = (url) => {
      storage.set(explorerKey, url);
      setCustomExplorer(url); // Trigger re-render
    };
    
    const handleCustomExplorerChange = (e) => {
      const value = e.target.value;
      if (value) {
        // Save custom URL
        storage.set(explorerKey, value);
        setCustomExplorer(value);
      }
      // Don't reset to default when cleared - just leave it empty in the input
    };
    
    return (
      <div className="screen settings-screen">
        <div className="settings-header">
          <button className="back-btn" onClick={() => setSubScreen(null)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <h2>Block Explorer</h2>
        </div>
        <div className="settings-content">
          <div className="settings-section">
            <h3>{isSolana ? 'Solana' : 'X1'} Explorers</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
              Current network: {currentNetwork}
            </p>
            <div className="radio-group">
              {explorers.map(exp => (
                <div 
                  key={exp.url} 
                  className={`radio-option ${storedExplorer === exp.url ? 'selected' : ''}`} 
                  onClick={() => handleSelectExplorer(exp.url)}
                >
                  <div className="radio-option-text">
                    <span>{exp.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block' }}>{exp.url}</span>
                  </div>
                  <div className="radio-option-check">
                    {storedExplorer === exp.url && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                </div>
              ))}
              {/* Custom option */}
              <div 
                className={`radio-option ${!isPresetExplorer ? 'selected' : ''}`}
                onClick={() => {}}
              >
                <div className="radio-option-text" style={{ flex: 1 }}>
                  <span>Custom</span>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="https://your-explorer.com"
                    value={customExplorerValue}
                    onChange={handleCustomExplorerChange}
                    onClick={(e) => e.stopPropagation()}
                    style={{ marginTop: 8, fontSize: 12 }}
                  />
                </div>
                <div className="radio-option-check">
                  {!isPresetExplorer && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="settings-section">
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              For custom explorers, use the base URL. Transactions will be viewed at: [url]/tx/[hash]
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (subScreen === 'network') {
    if (showAddRpc) {
      return (
        <div className="screen settings-screen">
          <div className="settings-header">
            <button className="back-btn" onClick={() => { setShowAddRpc(false); setError(''); }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
            <h2>Add Custom Network</h2>
          </div>
          <div className="settings-content">
            {error && (
              <div className="error-message" style={{ marginBottom: '16px', padding: '12px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px', color: '#ef4444', fontSize: '13px' }}>
                {error}
              </div>
            )}
            <div className="form-group">
              <label>Network Name *</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. My Custom Network"
                value={customRpc.name}
                onChange={e => setCustomRpc({ ...customRpc, name: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>RPC URL *</label>
              <input
                type="text"
                className="form-input"
                placeholder="https://rpc.example.com"
                value={customRpc.url}
                onChange={e => setCustomRpc({ ...customRpc, url: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Token Symbol</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. ETH, SOL, XNT"
                value={customRpc.symbol}
                onChange={e => setCustomRpc({ ...customRpc, symbol: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Decimals</label>
              <input
                type="number"
                className="form-input"
                placeholder="9"
                value={customRpc.decimals}
                onChange={e => setCustomRpc({ ...customRpc, decimals: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Block Explorer URL (optional)</label>
              <input
                type="text"
                className="form-input"
                placeholder="https://explorer.example.com"
                value={customRpc.explorer}
                onChange={e => setCustomRpc({ ...customRpc, explorer: e.target.value })}
              />
            </div>
            <button 
              className="btn-primary" 
              onClick={saveCustomRpc}
              style={{ marginTop: '8px' }}
            >
              Add Network
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="screen settings-screen">
        <div className="settings-header">
          <button className="back-btn" onClick={() => setSubScreen(null)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <h2>Network</h2>
        </div>
        <div className="settings-content">
          <div className="settings-section">
            <h3>Mainnets</h3>
            <div className="radio-group">
              {Object.keys(NETWORKS).filter(n => !n.includes('Testnet') && !n.includes('Devnet')).map(net => (
                <div key={net} style={{ marginBottom: '4px' }}>
                  <div 
                    className={`radio-option ${wallet.network === net ? 'selected' : ''}`} 
                    onClick={() => wallet.setNetwork(net)}
                    style={{ position: 'relative' }}
                  >
                    <div className="radio-option-text">
                      <span>{net}</span>
                      {rpcOverrides[net] && (
                        <span style={{ fontSize: 11, color: 'var(--primary)', display: 'block' }}>
                          Custom: {rpcOverrides[net].length > 30 ? rpcOverrides[net].slice(0, 30) + '...' : rpcOverrides[net]}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {/* Gear icon for RPC override */}
                      <button
                        onClick={(e) => { e.stopPropagation(); startEditingRpcOverride(net); }}
                        style={{ background: 'none', border: 'none', color: rpcOverrides[net] ? 'var(--primary)' : 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
                        title="Set custom RPC"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="3" />
                          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                        </svg>
                      </button>
                      <div className="radio-option-check">
                        {wallet.network === net && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
                      </div>
                    </div>
                  </div>
                  
                  {/* RPC Override Edit Panel */}
                  {editingRpcOverride === net && (
                    <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: '8px', marginTop: '8px', marginBottom: '8px' }}>
                      <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '8px' }}>Custom RPC for {net}</div>
                      {error && <div className="error-message" style={{ marginBottom: '8px', fontSize: '12px' }}>{error}</div>}
                      <input
                        type="text"
                        className="form-input"
                        placeholder={NETWORKS[net]?.rpcUrl || 'https://rpc.example.com'}
                        value={rpcOverrideUrl}
                        onChange={e => setRpcOverrideUrl(e.target.value)}
                        style={{ marginBottom: '8px' }}
                      />
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button 
                          className="btn-primary" 
                          style={{ flex: 1, padding: '8px' }}
                          onClick={() => saveRpcOverride(net)}
                        >
                          Save
                        </button>
                        {rpcOverrides[net] && (
                          <button 
                            className="btn-secondary" 
                            style={{ flex: 1, padding: '8px', color: 'var(--error)' }}
                            onClick={() => { clearRpcOverrideForNetwork(net); setEditingRpcOverride(null); }}
                          >
                            Clear
                          </button>
                        )}
                        <button 
                          className="btn-secondary" 
                          style={{ flex: 1, padding: '8px' }}
                          onClick={() => { setEditingRpcOverride(null); setRpcOverrideUrl(''); setError(''); }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="settings-section">
            <h3>Testnets / Devnets</h3>
            <div className="radio-group">
              {Object.keys(NETWORKS).filter(n => n.includes('Testnet') || n.includes('Devnet')).map(net => (
                <div key={net} style={{ marginBottom: '4px' }}>
                  <div 
                    className={`radio-option ${wallet.network === net ? 'selected' : ''}`} 
                    onClick={() => wallet.setNetwork(net)}
                    style={{ position: 'relative' }}
                  >
                    <div className="radio-option-text">
                      <span>{net}</span>
                      {rpcOverrides[net] && (
                        <span style={{ fontSize: 11, color: 'var(--primary)', display: 'block' }}>
                          Custom: {rpcOverrides[net].length > 30 ? rpcOverrides[net].slice(0, 30) + '...' : rpcOverrides[net]}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {/* Gear icon for RPC override */}
                      <button
                        onClick={(e) => { e.stopPropagation(); startEditingRpcOverride(net); }}
                        style={{ background: 'none', border: 'none', color: rpcOverrides[net] ? 'var(--primary)' : 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
                        title="Set custom RPC"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="3" />
                          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                        </svg>
                      </button>
                      <div className="radio-option-check">
                        {wallet.network === net && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
                      </div>
                    </div>
                  </div>
                  
                  {/* RPC Override Edit Panel */}
                  {editingRpcOverride === net && (
                    <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: '8px', marginTop: '8px', marginBottom: '8px' }}>
                      <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '8px' }}>Custom RPC for {net}</div>
                      {error && <div className="error-message" style={{ marginBottom: '8px', fontSize: '12px' }}>{error}</div>}
                      <input
                        type="text"
                        className="form-input"
                        placeholder={NETWORKS[net]?.rpcUrl || 'https://rpc.example.com'}
                        value={rpcOverrideUrl}
                        onChange={e => setRpcOverrideUrl(e.target.value)}
                        style={{ marginBottom: '8px' }}
                      />
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button 
                          className="btn-primary" 
                          style={{ flex: 1, padding: '8px' }}
                          onClick={() => saveRpcOverride(net)}
                        >
                          Save
                        </button>
                        {rpcOverrides[net] && (
                          <button 
                            className="btn-secondary" 
                            style={{ flex: 1, padding: '8px', color: 'var(--error)' }}
                            onClick={() => { clearRpcOverrideForNetwork(net); setEditingRpcOverride(null); }}
                          >
                            Clear
                          </button>
                        )}
                        <button 
                          className="btn-secondary" 
                          style={{ flex: 1, padding: '8px' }}
                          onClick={() => { setEditingRpcOverride(null); setRpcOverrideUrl(''); setError(''); }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {customRpcs.length > 0 && (
            <div className="settings-section">
              <h3>Custom Networks</h3>
              <div className="radio-group">
                {customRpcs.map(rpc => (
                  <div 
                    key={rpc.id} 
                    className={`radio-option ${wallet.network === rpc.name ? 'selected' : ''}`}
                    onClick={() => wallet.setNetwork(rpc.name)}
                    style={{ position: 'relative' }}
                  >
                    <div className="radio-circle">
                      {wallet.network === rpc.name && <div className="radio-dot" />}
                    </div>
                    <div className="radio-option-text">
                      <span>{rpc.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block' }}>{rpc.url}</span>
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); removeCustomRpc(rpc.id); }}
                      style={{ background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', padding: 8, marginLeft: 'auto' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button className="add-token-btn" onClick={() => setShowAddRpc(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v8M8 12h8" />
            </svg>
            Add Custom RPC
          </button>
        </div>
      </div>
    );
  }

  if (subScreen === 'about') {
    return (
      <div className="screen settings-screen">
        <div className="settings-header">
          <button className="back-btn" onClick={() => setSubScreen(null)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <h2>About</h2>
        </div>
        <div className="settings-content" style={{ textAlign: 'center', paddingTop: 40 }}>
          <X1Logo size={64} />
          <h3 style={{ marginTop: 16, marginBottom: 4 }}>X1 Wallet</h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: 8 }}>Version 0.10.65</p>
          <p style={{ color: 'var(--text-muted)', marginBottom: 24, fontSize: 12 }}>
            Network: {wallet?.network || 'Unknown'}
          </p>
          
          <div className="about-links">
            <a href="https://x1.xyz" target="_blank" rel="noopener noreferrer" className="about-link">
              Website
            </a>
            <a href="https://docs.x1.xyz" target="_blank" rel="noopener noreferrer" className="about-link">
              Documentation
            </a>
            <a href="https://x.com/x1_chain" target="_blank" rel="noopener noreferrer" className="about-link">
              X
            </a>
            <a href="https://t.me/x1_wallet" target="_blank" rel="noopener noreferrer" className="about-link">
              Telegram
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Main settings
  return (
    <div className="screen settings-screen">
      <div className="page-header">
        <h2 className="header-title">Settings</h2>
      </div>

      <div className="settings-content">
        {/* Account */}
        <div className="settings-section">
          <h3>Account</h3>
          <div className="settings-item" onClick={copyAddress}>
            <div className="settings-item-left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span>Wallet Address</span>
            </div>
            <div className="settings-item-right">
              <span className="settings-value">{wallet.formatAddress(wallet.wallet?.publicKey, 6)}</span>
              {copied ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </div>
          </div>
        </div>

        {/* Network */}
        <div className="settings-section">
          <h3>Network</h3>
          <div className="settings-item" onClick={() => setSubScreen('network')}>
            <div className="settings-item-left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <span>Network</span>
            </div>
            <div className="settings-item-right">
              <span className="settings-value">{wallet.network}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </div>
          </div>
          <div className="settings-item" onClick={() => setSubScreen('explorer')}>
            <div className="settings-item-left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <span>Block Explorer</span>
            </div>
            <div className="settings-item-right">
              <span className="settings-value">
                {(() => {
                  const currentNet = wallet?.network || 'X1 Mainnet';
                  const isSolana = currentNet.includes('Solana');
                  const isTestnet = currentNet.includes('Testnet') || currentNet.includes('Devnet');
                  
                  let explorerKey;
                  if (isSolana) {
                    explorerKey = currentNet.includes('Devnet') ? 'solanaDevnetExplorer' : 'solanaExplorer';
                  } else {
                    explorerKey = isTestnet ? 'x1TestnetExplorer' : 'x1Explorer';
                  }
                  
                  const storedExplorer = storage.get(explorerKey, '');
                  if (!storedExplorer) {
                    if (isSolana) return 'Solscan';
                    if (isTestnet) return 'X1 Testnet Explorer';
                    return 'X1 Explorer';
                  }
                  if (storedExplorer.includes('solscan')) return 'Solscan';
                  if (storedExplorer.includes('solana.com')) return 'Solana Explorer';
                  if (storedExplorer.includes('solana.fm')) return 'SolanaFM';
                  if (storedExplorer.includes('testnet.x1.xyz')) return 'X1 Testnet Explorer';
                  if (storedExplorer.includes('x1.xyz')) return 'X1 Explorer';
                  return 'Custom';
                })()}
              </span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </div>
          </div>
        </div>

        {/* Security */}
        <div className="settings-section">
          <h3>Security</h3>
          <div className="settings-item" onClick={() => setSubScreen('password')}>
            <div className="settings-item-left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span>Manage Password</span>
            </div>
            <div className="settings-item-right">
              <span className="settings-value">{passwordProtection ? 'On' : 'Off'}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </div>
          </div>
          <div className="settings-item" onClick={() => setSubScreen('autolock')}>
            <div className="settings-item-left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>Auto-Lock Timer</span>
            </div>
            <div className="settings-item-right">
              <span className="settings-value">{autoLock === -1 ? 'Never' : autoLock === 0 ? 'Immediately' : `${autoLock} min`}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </div>
          </div>
          {biometricAvailable && (
            <div className="settings-item" onClick={() => setSubScreen('biometric')}>
              <div className="settings-item-left">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 0 0 8 11a4 4 0 1 1 8 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0 0 15.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 0 0 8 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
                </svg>
                <span>Biometric Unlock</span>
              </div>
              <div className="settings-item-right">
                <span className="settings-value">{biometricEnabled ? 'On' : 'Off'}</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </div>
            </div>
          )}
          <div className="settings-item" onClick={() => setSkipSimulation(!skipSimulation)}>
            <div className="settings-item-left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <div>
                <span>Fast Mode</span>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  Skip transaction simulation for faster sends
                </div>
              </div>
            </div>
            <div className={`toggle ${skipSimulation ? 'active' : ''}`}>
              <div className="toggle-handle" />
            </div>
          </div>
          {skipSimulation && (
            <div className="settings-item-info" style={{ color: 'var(--warning, #f59e0b)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>Warning: Transactions won't be verified before sending. Failed transactions will still consume network fees.</span>
            </div>
          )}
          <div className="settings-item-info">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span>Seed phrases and private keys are managed per-wallet. Click the wallet selector → Edit to access them.</span>
          </div>
        </div>

        {/* Preferences */}
        <div className="settings-section">
          <h3>Preferences</h3>
          <div className="settings-item" onClick={() => setDarkMode(!darkMode)}>
            <div className="settings-item-left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
              <span>Dark Mode</span>
            </div>
            <div className={`toggle ${darkMode ? 'active' : ''}`}>
              <div className="toggle-handle" />
            </div>
          </div>
          <div className="settings-item" onClick={() => setSubScreen('notifications')}>
            <div className="settings-item-left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              <span>Notifications</span>
            </div>
            <div className="settings-item-right">
              <span className="settings-value">{notifications ? 'On' : 'Off'}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </div>
          </div>
          <div className="settings-item" onClick={() => setSubScreen('currency')}>
            <div className="settings-item-left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v12M9 9h4.5a2.5 2.5 0 0 1 0 5H9" />
              </svg>
              <span>Currency</span>
            </div>
            <div className="settings-item-right">
              <span className="settings-value">{currency}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </div>
          </div>
        </div>

        {/* About */}
        <div className="settings-section">
          <h3>About</h3>
          <div className="settings-item" onClick={() => setSubScreen('about')}>
            <div className="settings-item-left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
              <span>About X1 Wallet</span>
            </div>
            <div className="settings-item-right">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </div>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="settings-section danger">
          <div className="settings-item" onClick={onLock}>
            <div className="settings-item-left">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span style={{ color: 'var(--error)' }}>Lock & Reset Wallet</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}