// Hardware Wallet Connection Component
import { logger, getUserFriendlyError, ErrorMessages } from '@x1-wallet/core';
import React, { useState, useEffect } from 'react';
import { hardwareWallet, LEDGER_STATES, HW_TYPES, CONNECTION_TYPES } from '../services/hardware';

export default function HardwareWallet({ onComplete, onBack }) {
  const [step, setStep] = useState('select'); // select, connection, connect, app, account, name
  const [deviceType, setDeviceType] = useState(null);
  const [connectionType, setConnectionType] = useState(CONNECTION_TYPES.USB);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [walletName, setWalletName] = useState('');
  const [derivationPaths] = useState(hardwareWallet.getDerivationPaths());

  // Log current step on render
  logger.log('[HardwareWallet] Rendering with step:', step, 'loading:', loading);

  // Check browser support
  const isSupported = hardwareWallet.isSupported();

  // Handle device selection
  const selectDevice = (type) => {
    setDeviceType(type);
    setError('');
    setStep('connection'); // Go to connection type selection for Ledger
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
    setStatus('Connecting to device...');
    logger.log('[HardwareWallet] Starting connection... current step:', step, 'deviceType:', deviceType);

    try {
      // Ledger connection
      await hardwareWallet.connect(connectionType);
      logger.log('[HardwareWallet] Ledger connected, setting step to app');
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
        (typeof err === 'string' ? err : 'Failed to connect to device. Make sure Ledger is connected and unlocked.');
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // Open app and get accounts
  const openAppAndGetAccounts = async () => {
    setLoading(true);
    setError('');
    setStatus('Opening Solana app...');

    try {
      await hardwareWallet.openApp();
      setStatus('Getting accounts...');
      
      // Get accounts for different derivation paths
      const accountList = [];
      for (let i = 0; i < 3; i++) {
        const path = `44'/501'/${i}'/0'`;
        try {
          const address = await hardwareWallet.getPublicKey(path, false);
          accountList.push({
            index: i,
            path,
            address,
            label: `Account ${i + 1}`
          });
        } catch (e) {
          logger.warn(`Could not get account ${i}:`, e);
          break;
        }
      }
      
      if (accountList.length === 0) {
        throw new Error('No accounts found. Make sure the Solana app is open on your Ledger.');
      }
      
      setAccounts(accountList);
      setSelectedAccount(accountList[0]);
      setLoading(false);
      setStep('account');
    } catch (err) {
      setError(err.message || 'Failed to open app');
      setLoading(false);
    }
  };

  // Verify address on device
  const verifyOnDevice = async () => {
    if (!selectedAccount) return;
    
    setLoading(true);
    setStatus('Please verify address on your Ledger...');
    
    try {
      await hardwareWallet.getPublicKey(selectedAccount.path, true);
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
        </div>

        <div className="hardware-info">
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
    return (
      <div className="screen hardware-screen no-nav">
        <button className="back-btn" onClick={() => { hardwareWallet.disconnect(); setStep('connection'); }} style={{ alignSelf: 'flex-start', marginBottom: 16 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>

        <h2>Connect Your Ledger</h2>
        
        <div className="hardware-steps">
          <div className="hardware-step">
            <div className="hardware-step-number">1</div>
            <div className="hardware-step-content">
              <span className="hardware-step-title">
                {connectionType === CONNECTION_TYPES.BLUETOOTH ? 'Enable Bluetooth' : 'Connect your Ledger'}
              </span>
              <span className="hardware-step-desc">
                {connectionType === CONNECTION_TYPES.BLUETOOTH 
                  ? 'On Ledger: Settings → Bluetooth → Enable. On computer: Turn on Bluetooth' 
                  : 'Use the USB cable to connect your device'}
              </span>
            </div>
          </div>
          <div className="hardware-step">
            <div className="hardware-step-number">2</div>
            <div className="hardware-step-content">
              <span className="hardware-step-title">Unlock your Ledger</span>
              <span className="hardware-step-desc">Enter your PIN code on the device</span>
            </div>
          </div>
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
            connectionType === CONNECTION_TYPES.BLUETOOTH ? 'Connect via Bluetooth' : 'Connect Ledger'
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
          <span>Having trouble? Try "Open in Full Tab" for better hardware wallet support.</span>
        </div>
        
        <p className="hardware-hint">
          Don't have the Solana app? Install it via <a href="https://www.ledger.com/ledger-live" target="_blank" rel="noopener noreferrer">Ledger Live</a>
        </p>
      </div>
    );
  }

  // Step 3: Open app
  if (step === 'app') {
    return (
      <div className="screen hardware-screen no-nav">
        <button className="back-btn" onClick={() => { hardwareWallet.disconnect(); setStep('connection'); }} style={{ alignSelf: 'flex-start', marginBottom: 16 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="hardware-connecting">
          <div className="hardware-device-icon connected">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <path d="M12 10v4" />
              <circle cx="12" cy="12" r="1" />
            </svg>
          </div>
          <h2>Ledger Connected</h2>
          <p>Now open the Solana app on your device and click Continue</p>
        </div>

        {error && <div className="error-message">{error}</div>}
        {status && loading && <div className="status-message">{status}</div>}

        <button 
          className="btn-primary" 
          onClick={openAppAndGetAccounts}
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

  // Step 4: Select account
  if (step === 'account') {
    return (
      <div className="screen hardware-screen no-nav">
        <button className="back-btn" onClick={() => setStep('app')} style={{ alignSelf: 'flex-start', marginBottom: 16 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>

        <h2>Select Account</h2>
        <p className="hardware-subtitle">Choose which account to import</p>

        <div className="hardware-accounts">
          {accounts.map((account) => (
            <div 
              key={account.path}
              className={`hardware-account ${selectedAccount?.path === account.path ? 'selected' : ''}`}
              onClick={() => setSelectedAccount(account)}
            >
              <div className="hardware-account-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="6" width="20" height="14" rx="2" />
                  <path d="M2 10h20" />
                </svg>
              </div>
              <div className="hardware-account-info">
                <span className="hardware-account-label">{account.label}</span>
                <span className="hardware-account-address">
                  {account.address.slice(0, 8)}...{account.address.slice(-8)}
                </span>
              </div>
              {selectedAccount?.path === account.path && (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </div>
          ))}
        </div>

        <button 
          className="btn-secondary verify-btn" 
          onClick={verifyOnDevice}
          disabled={loading || !selectedAccount}
        >
          {loading ? 'Verifying...' : 'Verify on Device'}
        </button>

        {error && <div className="error-message">{error}</div>}

        <button 
          className="btn-primary" 
          onClick={() => setStep('name')}
          disabled={!selectedAccount}
        >
          Continue
        </button>
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
            <span className="hardware-summary-label">Account</span>
            <span className="hardware-summary-value">{selectedAccount?.label}</span>
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
