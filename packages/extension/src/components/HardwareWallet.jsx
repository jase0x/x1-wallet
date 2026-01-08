// Hardware Wallet Connection Component
import { logger, getUserFriendlyError, ErrorMessages } from '@x1-wallet/core';
import React, { useState, useEffect } from 'react';
import { hardwareWallet, trezorWallet, getHardwareWallet, LEDGER_STATES, HW_TYPES, CONNECTION_TYPES, DERIVATION_SCHEMES } from '../services/hardware';

export default function HardwareWallet({ onComplete, onBack }) {
  const [step, setStep] = useState('select'); // select, connection, connect, app, scheme, account, name
  const [deviceType, setDeviceType] = useState(null);
  const [connectionType, setConnectionType] = useState(CONNECTION_TYPES.USB);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [walletName, setWalletName] = useState('');
  const [derivationPaths] = useState(hardwareWallet.getDerivationPaths());
  const [loadedCount, setLoadedCount] = useState(0);
  const [selectedScheme, setSelectedScheme] = useState(DERIVATION_SCHEMES.BIP44_STANDARD);
  const [customPath, setCustomPath] = useState('');
  const [showCustomPath, setShowCustomPath] = useState(false);
  
  // Get the appropriate wallet service based on device type
  const getWallet = () => getHardwareWallet(deviceType);

  // Log current step on render
  logger.log('[HardwareWallet] Rendering with step:', step, 'loading:', loading, 'deviceType:', deviceType);

  // Check browser support
  const isSupported = hardwareWallet.isSupported();

  // Handle device selection
  const selectDevice = (type) => {
    setDeviceType(type);
    setError('');
    // Trezor only supports USB, skip connection selection
    if (type === HW_TYPES.TREZOR) {
      setConnectionType(CONNECTION_TYPES.USB);
      setStep('connect');
    } else {
      setStep('connection'); // Go to connection type selection for Ledger
    }
  };

  // Handle connection type selection
  const selectConnectionType = (type) => {
    setConnectionType(type);
    setStep('connect');
  };

  // Check if running in extension popup (limited WebHID access)
  const isExtensionPopup = typeof chrome !== 'undefined' && 
                           chrome.runtime && 
                           chrome.runtime.id &&
                           window.innerWidth < 500;
  
  // Open wallet in a full tab for hardware wallet connection
  const openInFullTab = () => {
    if (chrome?.runtime?.id) {
      const extensionUrl = chrome.runtime.getURL('index.html');
      chrome.tabs.create({ url: extensionUrl + '?hw=1' });
    }
  };

  // Connect to device
  const connectDevice = async () => {
    // Prevent double calls
    if (loading) {
      logger.log('[HardwareWallet] Already connecting, ignoring...');
      return;
    }
    
    setLoading(true);
    setError('');
    setStatus(`Connecting to ${deviceType === HW_TYPES.TREZOR ? 'Trezor' : 'Ledger'}...`);
    logger.log('[HardwareWallet] Starting connection... current step:', step, 'deviceType:', deviceType);

    try {
      const wallet = getWallet();
      await wallet.connect(connectionType);
      logger.log('[HardwareWallet] Device connected, setting step to app');
      setStatus('Device connected!');
      setStep('app');
      logger.log('[HardwareWallet] Step updated');
    } catch (err) {
      logger.error('[HardwareWallet] Connection failed:', err);
      logger.error('[HardwareWallet] Error name:', err?.name);
      logger.error('[HardwareWallet] Error message:', err?.message);
      logger.error('[HardwareWallet] Error stack:', err?.stack);
      
      // Get the most useful error message
      const errorMsg = err?.message || err?.name || 
        `Failed to connect to device. Make sure ${deviceType === HW_TYPES.TREZOR ? 'Trezor' : 'Ledger'} is connected and unlocked.`;
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // Open app and go to scheme selection
  const openAppAndSelectScheme = async () => {
    setLoading(true);
    setError('');
    setStatus(deviceType === HW_TYPES.TREZOR ? 'Connecting to Trezor...' : 'Opening Solana app...');

    try {
      const wallet = getWallet();
      await wallet.openApp();
      setStatus('Ready!');
      setLoading(false);
      setStep('scheme');
    } catch (err) {
      setError(err.message || 'Failed to open app');
      setLoading(false);
    }
  };

  // Get accounts for selected scheme
  const getAccountsForScheme = async () => {
    setLoading(true);
    setError('');
    setStatus('Getting accounts...');

    try {
      const wallet = getWallet();
      // Get accounts for the selected derivation scheme (scan 10 accounts initially)
      const accountList = await wallet.getAccountsForScheme(selectedScheme, 0, 10);
      
      if (accountList.length === 0) {
        throw new Error(`No accounts found. Make sure ${deviceType === HW_TYPES.TREZOR ? 'Trezor is unlocked' : 'the Solana app is open on your Ledger'}.`);
      }
      
      setAccounts(accountList);
      setLoadedCount(accountList.length);
      setSelectedAccount(accountList[0]);
      setLoading(false);
      setShowCustomPath(false);
      setStep('account');
    } catch (err) {
      setError(err.message || 'Failed to get accounts');
      setLoading(false);
    }
  };

  // Get account for custom path
  const getAccountForCustomPath = async () => {
    if (!customPath.trim()) {
      setError('Please enter a derivation path');
      return;
    }
    
    setLoading(true);
    setError('');
    setStatus('Getting account...');

    try {
      const wallet = getWallet();
      // Normalize path - remove m/ prefix if present, ensure proper format
      let path = customPath.trim();
      if (path.startsWith('m/')) {
        path = path.slice(2);
      }
      
      const publicKey = await wallet.getPublicKey(path, false);
      
      const account = {
        address: publicKey,
        path: path,
        label: 'Custom Path',
        index: 0
      };
      
      setAccounts([account]);
      setLoadedCount(1);
      setSelectedAccount(account);
      setLoading(false);
      setStep('account');
    } catch (err) {
      setError(err.message || 'Failed to get account for custom path');
      setLoading(false);
    }
  };

  // Scan all derivation paths to find accounts
  const scanAllPaths = async () => {
    setLoading(true);
    setError('');
    setStatus('Scanning all paths...');
    
    try {
      const wallet = getWallet();
      const allAccounts = [];
      const seenAddresses = new Set();
      
      // Scan each scheme
      for (const scheme of Object.values(DERIVATION_SCHEMES)) {
        setStatus(`Scanning ${scheme.name}...`);
        try {
          const schemeAccounts = await wallet.getAccountsForScheme(scheme, 0, 5);
          for (const account of schemeAccounts) {
            // Avoid duplicates
            if (!seenAddresses.has(account.address)) {
              seenAddresses.add(account.address);
              allAccounts.push({
                ...account,
                label: `${scheme.name} #${account.index}`,
                schemeName: scheme.name
              });
            }
          }
        } catch (e) {
          logger.warn(`Failed to scan ${scheme.name}:`, e);
        }
      }
      
      if (allAccounts.length === 0) {
        throw new Error('No accounts found on any derivation path.');
      }
      
      setAccounts(allAccounts);
      setLoadedCount(allAccounts.length);
      setSelectedAccount(allAccounts[0]);
      setLoading(false);
      setShowCustomPath(false);
      setStep('account');
    } catch (err) {
      setError(err.message || 'Failed to scan paths');
      setLoading(false);
    }
  };

  // Load more accounts for current scheme
  const loadMoreAccounts = async () => {
    setLoadingMore(true);
    setError('');
    
    try {
      const wallet = getWallet();
      const newAccounts = await wallet.getAccountsForScheme(selectedScheme, loadedCount, 5);
      
      if (newAccounts.length > 0) {
        setAccounts([...accounts, ...newAccounts]);
        setLoadedCount(loadedCount + newAccounts.length);
      }
    } catch (err) {
      setError(err.message || 'Failed to load more accounts');
    }
    
    setLoadingMore(false);
  };

  // Verify address on device
  const verifyOnDevice = async () => {
    if (!selectedAccount) return;
    
    setLoading(true);
    setStatus(`Please verify address on your ${deviceType === HW_TYPES.TREZOR ? 'Trezor' : 'Ledger'}...`);
    
    try {
      const wallet = getWallet();
      await wallet.getPublicKey(selectedAccount.path, true);
      setLoading(false);
      setStatus('Address verified!');
    } catch (err) {
      setError(err.message || 'Verification cancelled');
      setLoading(false);
    }
  };

  // Complete setup
  const handleComplete = () => {
    if (!selectedAccount) return;
    
    onComplete({
      type: 'ledger',
      name: walletName || `Ledger ${selectedAccount.label}`,
      publicKey: selectedAccount.address,
      derivationPath: selectedAccount.path,
      derivationScheme: selectedAccount.scheme,
      isHardware: true,
      connectionType
    });
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (step !== 'name') {
        hardwareWallet.disconnect();
      }
    };
  }, [step]);

  // Browser not supported
  if (!isSupported) {
    return (
      <div className="screen hardware-screen no-nav">
        <button className="back-btn" onClick={onBack} style={{ alignSelf: 'flex-start', marginBottom: 16 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        
        <div className="hardware-error-state">
          <div className="hardware-error-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2>Browser Not Supported</h2>
          <p>Hardware wallet connection requires WebUSB or WebHID support.</p>
          <p className="hardware-hint">Please use Chrome, Edge, or Brave browser.</p>
        </div>
      </div>
    );
  }

  // Step 1: Select device type
  if (step === 'select') {
    return (
      <div className="screen hardware-screen no-nav">
        <button className="back-btn" onClick={onBack} style={{ alignSelf: 'flex-start', marginBottom: 16 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>

        <h2>Connect Hardware Wallet</h2>
        <p className="hardware-subtitle">Select your hardware wallet device</p>

        <div className="hardware-options">
          <button className="hardware-option" onClick={() => selectDevice(HW_TYPES.LEDGER)}>
            <div className="hardware-option-icon ledger">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="6" width="18" height="12" rx="2" />
                <rect x="6" y="9" width="5" height="6" rx="1" />
                <line x1="14" y1="10" x2="18" y2="10" />
                <line x1="14" y1="12" x2="18" y2="12" />
                <line x1="14" y1="14" x2="17" y2="14" />
              </svg>
            </div>
            <div className="hardware-option-text">
              <span className="hardware-option-title">Ledger</span>
              <span className="hardware-option-desc">Nano S, Nano S Plus, Nano X</span>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>

          <button className="hardware-option" onClick={() => selectDevice(HW_TYPES.TREZOR)}>
            <div className="hardware-option-icon trezor">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 2L4 6v6c0 5.5 3.4 10.3 8 12 4.6-1.7 8-6.5 8-12V6l-8-4z" />
                <path d="M12 8v4" />
                <circle cx="12" cy="15" r="1" />
              </svg>
            </div>
            <div className="hardware-option-text">
              <span className="hardware-option-title">Trezor</span>
              <span className="hardware-option-desc">Model T, Model One, Safe 3</span>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>

        <div className="hardware-info" style={{ marginBottom: 24 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <span>Hardware wallets keep your private keys secure on a physical device.</span>
        </div>
      </div>
    );
  }

  // Step 1.5: Select connection type (USB or Bluetooth)
  if (step === 'connection') {
    return (
      <div className="screen hardware-screen no-nav">
        <button className="back-btn" onClick={() => setStep('select')} style={{ alignSelf: 'flex-start', marginBottom: 16 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>

        <h2>Connection Method</h2>
        <p className="hardware-subtitle">How would you like to connect?</p>

        <div className="hardware-options">
          <button className="hardware-option" onClick={() => selectConnectionType(CONNECTION_TYPES.USB)}>
            <div className="hardware-option-icon usb">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2v6m0 0l3-3m-3 3l-3-3" />
                <circle cx="12" cy="12" r="2" />
                <path d="M12 14v4" />
                <path d="M8 18h8" />
                <path d="M9 18v2h6v-2" />
              </svg>
            </div>
            <div className="hardware-option-text">
              <span className="hardware-option-title">USB Cable</span>
              <span className="hardware-option-desc">All Ledger devices</span>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>

          <button className="hardware-option" onClick={() => selectConnectionType(CONNECTION_TYPES.BLUETOOTH)}>
            <div className="hardware-option-icon bluetooth">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6.5 6.5l11 11L12 23V1l5.5 5.5-11 11" />
              </svg>
            </div>
            <div className="hardware-option-text">
              <span className="hardware-option-title">Bluetooth</span>
              <span className="hardware-option-desc">Ledger Nano X only</span>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // Step 2: Connect device
  if (step === 'connect') {
    const isTrezor = deviceType === HW_TYPES.TREZOR;
    
    return (
      <div className="screen hardware-screen no-nav">
        <button className="back-btn" onClick={() => { getWallet().disconnect(); setStep('select'); }} style={{ alignSelf: 'flex-start', marginBottom: 16 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>

        <h2>Connect Your {isTrezor ? 'Trezor' : 'Ledger'}</h2>
        
        <div className="hardware-steps">
          {isTrezor && (
            <div className="hardware-step">
              <div className="hardware-step-number">1</div>
              <div className="hardware-step-content">
                <span className="hardware-step-title">Install Trezor Bridge</span>
                <span className="hardware-step-desc">
                  Required for browser connections. <a href="https://suite.trezor.io/web/bridge/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-color)' }}>Download Trezor Bridge</a>
                </span>
              </div>
            </div>
          )}
          <div className="hardware-step">
            <div className="hardware-step-number">{isTrezor ? '2' : '1'}</div>
            <div className="hardware-step-content">
              <span className="hardware-step-title">
                {isTrezor ? 'Connect your Trezor' : (connectionType === CONNECTION_TYPES.BLUETOOTH ? 'Enable Bluetooth' : 'Connect your Ledger')}
              </span>
              <span className="hardware-step-desc">
                {isTrezor 
                  ? 'Use the USB cable to connect your Trezor device'
                  : (connectionType === CONNECTION_TYPES.BLUETOOTH 
                    ? 'On Ledger: Settings → Bluetooth → Enable. On computer: Turn on Bluetooth' 
                    : 'Use the USB cable to connect your device')}
              </span>
            </div>
          </div>
          <div className="hardware-step">
            <div className="hardware-step-number">{isTrezor ? '3' : '2'}</div>
            <div className="hardware-step-content">
              <span className="hardware-step-title">Unlock your {isTrezor ? 'Trezor' : 'Ledger'}</span>
              <span className="hardware-step-desc">{isTrezor ? 'Enter your PIN when prompted' : 'Enter your PIN code on the device'}</span>
            </div>
          </div>
          {!isTrezor && (
            <div className="hardware-step">
              <div className="hardware-step-number">3</div>
              <div className="hardware-step-content">
                <span className="hardware-step-title">
                  {connectionType === CONNECTION_TYPES.BLUETOOTH ? 'Keep Ledger on home screen' : 'Open the Solana app'}
                </span>
                <span className="hardware-step-desc">
                  {connectionType === CONNECTION_TYPES.BLUETOOTH 
                    ? 'Stay on the dashboard (don\'t open any app yet)' 
                    : 'Navigate to and open the Solana app'}
                </span>
              </div>
            </div>
          )}
        </div>

        {error && <div className="error-message" style={{ whiteSpace: 'pre-line' }}>{error}</div>}
        {status && loading && <div className="status-message">{status}</div>}

        <button 
          className="btn-primary" 
          onClick={connectDevice}
          disabled={loading}
        >
          {loading ? (
            <>
              <span className="spinner-small" />
              Connecting...
            </>
          ) : (
            isTrezor ? 'Connect Trezor' : (connectionType === CONNECTION_TYPES.BLUETOOTH ? 'Connect via Bluetooth' : 'Connect Ledger')
          )}
        </button>
        
        {/* Show option to open in full tab if in popup */}
        {typeof chrome !== 'undefined' && chrome.runtime?.id && (
          <button 
            className="btn-secondary" 
            onClick={openInFullTab}
            style={{ marginTop: 12 }}
          >
            Open in Full Tab
          </button>
        )}
        
        <div className="hardware-info" style={{ marginTop: 16 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{isTrezor ? 'Make sure Trezor Bridge is running and Trezor Suite is closed.' : 'Having trouble? Try "Open in Full Tab" for better hardware wallet support.'}</span>
        </div>
        
        {!isTrezor && (
          <p className="hardware-hint">
            Don't have the Solana app? Install it via <a href="https://www.ledger.com/ledger-live" target="_blank" rel="noopener noreferrer">Ledger Live</a>
          </p>
        )}
      </div>
    );
  }

  // Step 3: Open app
  if (step === 'app') {
    const isTrezor = deviceType === HW_TYPES.TREZOR;
    
    return (
      <div className="screen hardware-screen no-nav">
        <button className="back-btn" onClick={() => { getWallet().disconnect(); setStep(isTrezor ? 'select' : 'connection'); }} style={{ alignSelf: 'flex-start', marginBottom: 16 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="hardware-connecting">
          <div className="hardware-device-icon connected">
            {isTrezor ? (
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
                <path d="M12 2L4 6v6c0 5.5 3.4 10.3 8 12 4.6-1.7 8-6.5 8-12V6l-8-4z" />
                <polyline points="9 12 12 15 16 10" />
              </svg>
            ) : (
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <path d="M12 10v4" />
                <circle cx="12" cy="12" r="1" />
              </svg>
            )}
          </div>
          <h2>{isTrezor ? 'Trezor Connected' : 'Ledger Connected'}</h2>
          <p>{isTrezor ? 'Click Continue to select your account' : 'Now open the Solana app on your device and click Continue'}</p>
        </div>

        {error && <div className="error-message">{error}</div>}
        {status && loading && <div className="status-message">{status}</div>}

        <button 
          className="btn-primary" 
          onClick={openAppAndSelectScheme}
          disabled={loading}
        >
          {loading ? (
            <>
              <span className="spinner-small" />
              {status || 'Loading...'}
            </>
          ) : (
            'Continue'
          )}
        </button>
      </div>
    );
  }

  // Step 3.5: Select derivation scheme
  if (step === 'scheme') {
    return (
      <div className="screen hardware-screen no-nav" style={{ justifyContent: 'flex-start', paddingTop: 20, paddingBottom: 20 }}>
        <button className="back-btn" onClick={() => setStep('app')} style={{ alignSelf: 'flex-start', marginBottom: 20 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>

        <h2 style={{ marginBottom: 6 }}>Select Derivation Path</h2>
        <p style={{ margin: '0 0 20px 0', fontSize: 14, color: 'var(--text-muted)' }}>Choose the path that matches your wallet</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
          {Object.values(DERIVATION_SCHEMES).map((scheme) => (
            <button 
              key={scheme.id}
              onClick={() => setSelectedScheme(scheme)}
              style={{
                border: selectedScheme.id === scheme.id ? '2px solid var(--x1-blue)' : '1px solid var(--border-color)',
                background: selectedScheme.id === scheme.id ? 'rgba(0, 122, 255, 0.1)' : 'var(--bg-secondary)',
                padding: '16px',
                borderRadius: 12,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                gap: 4,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>{scheme.name}</span>
              <span style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                {scheme.description}
              </span>
            </button>
          ))}
        </div>

        <div style={{ 
          display: 'flex', 
          gap: 10, 
          padding: '12px 14px', 
          background: 'var(--bg-secondary)', 
          borderRadius: 10, 
          marginTop: 16,
          marginBottom: 16,
          fontSize: 13,
          color: 'var(--text-secondary)',
          alignItems: 'flex-start'
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <span>
            <strong>Not sure?</strong> Try "Standard (BIP44)" first. If your accounts don't appear, go back and try another path.
          </span>
        </div>

        {error && <div className="error-message" style={{ marginBottom: 12 }}>{error}</div>}

        <button 
          className="btn-primary" 
          onClick={getAccountsForScheme}
          disabled={loading}
          style={{ padding: '14px', fontSize: 15 }}
        >
          {loading ? (
            <>
              <span className="spinner-small" />
              {status || 'Loading...'}
            </>
          ) : (
            'Continue'
          )}
        </button>
        
        <button 
          className="btn-secondary" 
          onClick={scanAllPaths}
          disabled={loading}
          style={{ padding: '12px', fontSize: 14, marginTop: 10 }}
        >
          {loading ? 'Scanning...' : 'Scan All Paths'}
        </button>
        
        <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 8 }}>
          Use "Scan All Paths" if you're not sure which path your wallet uses
        </p>
      </div>
    );
  }

  // Step 4: Select account
  if (step === 'account') {
    return (
      <div className="screen hardware-screen no-nav" style={{ justifyContent: 'flex-start', paddingTop: 20, paddingBottom: 20 }}>
        <button className="back-btn" onClick={() => setStep('scheme')} style={{ alignSelf: 'flex-start', marginBottom: 16 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>

        <h2 style={{ marginBottom: 6 }}>Select Account</h2>
        <p style={{ margin: '0 0 16px 0', fontSize: 14, color: 'var(--text-muted)' }}>
          Using: {selectedScheme.name}
        </p>

        {/* Account list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
          {accounts.map((account) => (
            <div 
              key={account.path}
              onClick={() => setSelectedAccount(account)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 12px',
                background: selectedAccount?.path === account.path ? 'rgba(2, 116, 251, 0.1)' : 'var(--bg-secondary)',
                border: selectedAccount?.path === account.path ? '2px solid var(--x1-blue)' : '1px solid var(--border-color)',
                borderRadius: 10,
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <div style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: 'var(--bg-tertiary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
                  <rect x="2" y="6" width="20" height="14" rx="2" />
                  <path d="M2 10h20" />
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{account.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  {account.address.slice(0, 6)}...{account.address.slice(-6)}
                </div>
              </div>
              {selectedAccount?.path === account.path && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </div>
          ))}
          
          {/* Load More */}
          <button
            onClick={loadMoreAccounts}
            disabled={loadingMore}
            style={{
              padding: '8px',
              background: 'transparent',
              border: '1px dashed var(--border-color)',
              borderRadius: 8,
              color: 'var(--text-muted)',
              fontSize: 13,
              cursor: loadingMore ? 'not-allowed' : 'pointer'
            }}
          >
            {loadingMore ? 'Loading...' : '+ Load More Accounts'}
          </button>
          
          {/* Custom Path Option */}
          <div style={{ marginTop: 8 }}>
            <button
              onClick={() => setShowCustomPath(!showCustomPath)}
              style={{
                padding: '8px',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: 13,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                width: '100%',
                justifyContent: 'center'
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              Can't find your wallet? Try custom path
            </button>
            
            {showCustomPath && (
              <div style={{ 
                marginTop: 8, 
                padding: 12, 
                background: 'var(--bg-secondary)', 
                borderRadius: 8,
                border: '1px solid var(--border-color)'
              }}>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, display: 'block' }}>
                  Custom Derivation Path
                </label>
                <input
                  type="text"
                  value={customPath}
                  onChange={(e) => setCustomPath(e.target.value)}
                  placeholder="44'/501'/0'/0'"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 6,
                    color: 'var(--text-primary)',
                    fontFamily: 'monospace',
                    fontSize: 13,
                    marginBottom: 8,
                    boxSizing: 'border-box'
                  }}
                />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                  Common paths: 44'/501'/0' (Standard), 44'/501'/0'/0' (Phantom)
                </div>
                <button
                  onClick={getAccountForCustomPath}
                  disabled={loading || !customPath.trim()}
                  style={{
                    width: '100%',
                    padding: '10px',
                    background: 'var(--accent-color)',
                    border: 'none',
                    borderRadius: 6,
                    color: 'white',
                    fontSize: 13,
                    cursor: loading || !customPath.trim() ? 'not-allowed' : 'pointer',
                    opacity: loading || !customPath.trim() ? 0.6 : 1
                  }}
                >
                  {loading ? 'Loading...' : 'Load Custom Path'}
                </button>
              </div>
            )}
          </div>
        </div>

        {error && <div className="error-message" style={{ marginTop: 12 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button 
            className="btn-secondary" 
            onClick={verifyOnDevice}
            disabled={loading || !selectedAccount}
            style={{ flex: 1, padding: '12px', fontSize: 14 }}
          >
            {loading ? 'Verifying...' : 'Verify on Device'}
          </button>

          <button 
            className="btn-primary" 
            onClick={() => setStep('name')}
            disabled={!selectedAccount}
            style={{ flex: 1, padding: '12px', fontSize: 14 }}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  // Step 5: Name wallet
  if (step === 'name') {
    return (
      <div className="screen hardware-screen no-nav">
        <button className="back-btn" onClick={() => setStep('account')} style={{ alignSelf: 'flex-start', marginBottom: 16 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="hardware-success-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        </div>

        <h2>Name Your Wallet</h2>
        <p className="hardware-subtitle">Give your hardware wallet a name</p>

        <div className="form-group" style={{ marginTop: 24 }}>
          <input
            type="text"
            className="form-input"
            value={walletName}
            onChange={(e) => setWalletName(e.target.value)}
            placeholder={`Ledger ${selectedAccount?.label || 'Wallet'}`}
            autoFocus
          />
        </div>

        <div className="hardware-summary">
          <div className="hardware-summary-item">
            <span className="hardware-summary-label">Device</span>
            <span className="hardware-summary-value">Ledger</span>
          </div>
          <div className="hardware-summary-item">
            <span className="hardware-summary-label">Connection</span>
            <span className="hardware-summary-value">{connectionType === CONNECTION_TYPES.BLUETOOTH ? 'Bluetooth' : 'USB'}</span>
          </div>
          <div className="hardware-summary-item">
            <span className="hardware-summary-label">Path Type</span>
            <span className="hardware-summary-value">{selectedScheme.name}</span>
          </div>
          <div className="hardware-summary-item">
            <span className="hardware-summary-label">Account</span>
            <span className="hardware-summary-value">{selectedAccount?.label}</span>
          </div>
          <div className="hardware-summary-item">
            <span className="hardware-summary-label">Derivation</span>
            <span className="hardware-summary-value" style={{ fontFamily: 'monospace', fontSize: 11 }}>
              m/{selectedAccount?.path}
            </span>
          </div>
          <div className="hardware-summary-item">
            <span className="hardware-summary-label">Address</span>
            <span className="hardware-summary-value address">
              {selectedAccount?.address.slice(0, 12)}...{selectedAccount?.address.slice(-8)}
            </span>
          </div>
        </div>

        {/* X1W-NEW-005 FIX: Blind signing warning */}
        <div className="warning-box" style={{ marginTop: 16 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2">
            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
          <span>
            <strong>Blind Signing Warning:</strong> Some transactions may not display full details on your Ledger screen. 
            Always verify transaction details in the wallet before confirming on your device. If you can't verify 
            the full transaction on your Ledger, consider enabling blind signing only for trusted dApps.
          </span>
        </div>

        <button className="btn-primary" onClick={handleComplete} style={{ marginTop: 24, marginBottom: 24 }}>
          Import Wallet
        </button>
      </div>
    );
  }

  return null;
}