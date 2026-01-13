// X1 Wallet - Main App Component
import { logger, getUserFriendlyError, ErrorMessages, useWallet } from '@x1-wallet/core';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import './styles.css';

// Components
import WelcomeScreen from './components/WelcomeScreen';
import CreateWallet from './components/CreateWallet';
import ImportWallet from './components/ImportWallet';
import HardwareWallet from './components/HardwareWallet';
import WalletMain from './components/WalletMain';
import WalletManager from './components/WalletManager';
import SettingsScreen from './components/SettingsScreen';
import SendFlow from './components/SendFlow';
import ReceiveScreen from './components/ReceiveScreen';
import SwapScreen from './components/SwapScreen';
import BridgeScreen from './components/BridgeScreen';
import StakeScreen from './components/StakeScreen';
import TokenDetail from './components/TokenDetail';
import X1Logo from './components/X1Logo';
import DAppApproval from './components/DAppApproval';

// Storage helper
const storage = {
  get: (key, defaultValue) => {
    try { return JSON.parse(localStorage.getItem(`x1wallet_${key}`)) ?? defaultValue; }
    catch { return defaultValue; }
  },
  set: (key, value) => {
    localStorage.setItem(`x1wallet_${key}`, JSON.stringify(value));
    // Also sync to chrome.storage.local for persistence across sessions
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ [`x1wallet_${key}`]: value }).catch(() => {});
    }
  }
};

// Alert Modal Component - Styled to match app design
function AlertModal({ title, message, onClose, type = 'error' }) {
  if (!message) return null;
  
  const iconColor = type === 'error' ? 'var(--error)' : type === 'warning' ? 'var(--warning)' : 'var(--x1-blue)';
  
  return (
    <div className="alert-modal-overlay" onClick={onClose}>
      <div className="alert-modal-content" onClick={e => e.stopPropagation()}>
        <div className="alert-modal-icon">
          {type === 'error' ? (
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          ) : type === 'warning' ? (
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2">
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
            </svg>
          ) : (
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          )}
        </div>
        <h3 className="alert-modal-title">{title || (type === 'error' ? 'Error' : type === 'warning' ? 'Warning' : 'Notice')}</h3>
        <p className="alert-modal-message">{message}</p>
        <button className="btn-primary alert-modal-btn" onClick={onClose}>
          OK
        </button>
      </div>
      <style>{`
        .alert-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.75);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          padding: 20px;
          animation: fadeIn 0.15s ease-out;
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .alert-modal-content {
          background: var(--bg-secondary);
          border-radius: 20px;
          width: 100%;
          max-width: 320px;
          padding: 32px 24px 24px;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          box-shadow: 0 20px 60px rgba(0,0,0,0.4);
          animation: slideUp 0.2s ease-out;
        }
        .alert-modal-icon {
          margin-bottom: 16px;
        }
        .alert-modal-title {
          margin: 0 0 8px 0;
          font-size: 18px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .alert-modal-message {
          margin: 0 0 24px 0;
          font-size: 14px;
          line-height: 1.5;
          color: var(--text-secondary);
        }
        .alert-modal-btn {
          width: 100%;
          padding: 14px 24px;
          font-size: 15px;
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}

// Apply saved theme on startup
const applySavedTheme = () => {
  try {
    const saved = localStorage.getItem('x1wallet_darkMode');
    const isDark = saved === null ? true : JSON.parse(saved);
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  } catch {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
};
applySavedTheme();

// Lock Screen Component - Integrates with useWallet encryption
function LockScreen({ onUnlock, walletUnlock }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [unlocking, setUnlocking] = useState(false);

  const handleUnlock = async () => {
    if (!password || unlocking) return;
    
    setUnlocking(true);
    setError('');
    
    try {
      // First try the wallet's unlock function (for encrypted storage)
      if (walletUnlock) {
        await walletUnlock(password);
        onUnlock(password);
        return;
      }
      
      // X1W-SEC-006 FIX: Use PBKDF2 verification from wallet service instead of base64
      const { checkPassword } = await import('@x1-wallet/core/services/wallet');
      const isValid = await checkPassword(password);
      
      if (isValid) {
        onUnlock(password);
      } else {
        throw new Error('Incorrect password');
      }
    } catch (e) {
      setAttempts(a => a + 1);
      const msg = e.message || 'Incorrect password';
      setError(`${msg}${attempts >= 2 ? `. ${5 - attempts} attempts remaining.` : ''}`);
      if (attempts >= 4) {
        setError('Too many failed attempts. Please wait 30 seconds.');
        setTimeout(() => setAttempts(0), 30000);
      }
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <div className="screen lock-screen">
      <X1Logo size={80} />
      <div className="lock-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>
      <h2>Wallet Locked</h2>
      <p className="lock-subtitle">Enter your password to unlock</p>
      
      <div className="form-group" style={{ marginTop: 24, width: '100%' }}>
        <input
          type="password"
          className="form-input"
          placeholder="Enter password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
          autoFocus
          disabled={attempts >= 5 || unlocking}
        />
      </div>
      
      {error && <div className="error-message">{error}</div>}
      
      <button 
        className="btn-primary" 
        onClick={handleUnlock}
        disabled={!password || attempts >= 5 || unlocking}
        style={{ marginTop: 16 }}
      >
        {unlocking ? 'Unlocking...' : 'Unlock'}
      </button>
    </div>
  );
}

function App() {
  console.log('[App] Rendering...');
  const wallet = useWallet();
  console.log('[App] wallet.wallets:', wallet.wallets?.length, 'wallet.loading:', wallet.loading, 'wallet.isEncrypted:', wallet.isEncrypted);
  const [screen, setScreen] = useState('loading');
  const [returnScreen, setReturnScreen] = useState('main');
  const [isLocked, setIsLocked] = useState(false);
  const [initialCheckDone, setInitialCheckDone] = useState(false);
  const [selectedToken, setSelectedToken] = useState(null);
  const [activityRefreshKey, setActivityRefreshKey] = useState(0);
  const [balanceRefreshKey, setBalanceRefreshKey] = useState(0);
  const [userTokens, setUserTokens] = useState([]);
  const [hasDAppRequest, setHasDAppRequest] = useState(false);
  const [alertModal, setAlertModal] = useState({ show: false, title: '', message: '', type: 'error' });
  const lastActivityRef = useRef(Date.now());
  const lockTimerRef = useRef(null);
  
  // Show alert modal helper
  const showAlert = useCallback((message, title = '', type = 'error') => {
    setAlertModal({ show: true, title, message, type });
  }, []);
  
  const closeAlert = useCallback(() => {
    setAlertModal({ show: false, title: '', message: '', type: 'error' });
  }, []);
  
  // Function to trigger activity refresh
  const triggerActivityRefresh = useCallback(() => {
    setActivityRefreshKey(prev => prev + 1);
  }, []);
  
  // Function to trigger balance refresh
  const triggerBalanceRefresh = useCallback(() => {
    setBalanceRefreshKey(prev => prev + 1);
  }, []);

  // Check for pending dApp requests
  // Supports both: 1) Approval window (URL params) and 2) In-popup approvals (port messages)
  useEffect(() => {
    let port = null;
    
    const checkDAppRequest = async () => {
      try {
        // Check if this popup was opened as an approval window (has request param in URL)
        const urlParams = new URLSearchParams(window.location.search);
        const isApprovalWindow = urlParams.has('request');
        
        // For approval windows, check for pending request
        if (isApprovalWindow) {
          if (typeof chrome !== 'undefined' && chrome.runtime) {
            const response = await chrome.runtime.sendMessage({ type: 'get-pending-request' });
            const pendingReq = response?.request || response;
            setHasDAppRequest(pendingReq && pendingReq.type ? true : false);
          }
          return;
        }
        
        // For regular popup (no URL params), also check if there's a pending request
        // This handles the case where background uses action.openPopup()
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          const response = await chrome.runtime.sendMessage({ type: 'get-pending-request' });
          const pendingReq = response?.request || response;
          if (pendingReq && pendingReq.type) {
            setHasDAppRequest(true);
          }
        }
      } catch (err) {
        // Ignore errors
      }
    };
    
    // Connect to background via port for real-time approval notifications
    const connectPort = () => {
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        try {
          port = chrome.runtime.connect({ name: 'x1-wallet-popup' });
          
          port.onMessage.addListener((message) => {
            if (message.type === 'pending-request' && message.request) {
              logger.log('[App] Received pending request via port:', message.request.type);
              setHasDAppRequest(true);
            }
          });
          
          port.onDisconnect.addListener(() => {
            logger.log('[App] Port disconnected from background');
            port = null;
          });
          
          logger.log('[App] Connected to background via port');
        } catch (err) {
          logger.log('[App] Failed to connect port:', err.message);
        }
      }
    };
    
    // Connect port and check for pending requests
    connectPort();
    checkDAppRequest();
    
    // Keep checking periodically (for approval windows)
    const interval = setInterval(checkDAppRequest, 500);
    
    return () => {
      clearInterval(interval);
      if (port) {
        try {
          port.disconnect();
        } catch (e) {}
      }
    };
  }, []);

  // Fetch user's token holdings
  const fetchUserTokens = useCallback(async () => {
    if (!wallet.wallet?.publicKey) {
      logger.log('[App] Cannot fetch tokens - no publicKey');
      return;
    }
    if (!wallet.network) {
      logger.log('[App] Cannot fetch tokens - no network');
      return;
    }
    // Tokens are now fetched by WalletMain and synced via onTokensUpdate
    // This function is kept for any non-WalletMain screens that need tokens
  }, [wallet.wallet?.publicKey, wallet.network]);

  // Tokens are now managed by WalletMain - only fetch here if specifically needed
  // (e.g., for SendScreen which uses userTokens from App)
  useEffect(() => {
    // WalletMain will sync tokens via onTokensUpdate callback
    // No need to duplicate the fetch here
  }, [wallet.wallet?.publicKey, wallet.network]);

  // Check if password protection is enabled and if there's a password set
  // X1W-SEC-006: Check both legacy passwordHash and new PBKDF2 auth
  const [passwordProtection, setPasswordProtection] = useState(() => storage.get('passwordProtection', false));
  const [hasPasswordAsync, setHasPasswordAsync] = useState(false);
  const [autoLockMinutes, setAutoLockMinutes] = useState(() => storage.get('autoLock', 5));
  const [passwordCheckComplete, setPasswordCheckComplete] = useState(false);
  
  useEffect(() => {
    const checkHasPassword = async () => {
      try {
        // Only sync from chrome.storage if localStorage is empty
        // This prevents chrome.storage from overwriting user's recent changes
        const localProtection = localStorage.getItem('x1wallet_passwordProtection');
        const localAutoLock = localStorage.getItem('x1wallet_autoLock');
        
        console.log('[App] Password check - localStorage protection:', localProtection, 'autoLock:', localAutoLock);
        
        if (typeof chrome !== 'undefined' && chrome.storage) {
          try {
            const result = await chrome.storage.local.get(['x1wallet_passwordProtection', 'x1wallet_autoLock']);
            console.log('[App] chrome.storage values:', result);
            
            // Only use chrome.storage value if localStorage is empty
            if (localProtection === null && result.x1wallet_passwordProtection !== undefined) {
              let protectionValue = result.x1wallet_passwordProtection;
              if (typeof protectionValue === 'string') {
                try { protectionValue = JSON.parse(protectionValue); } catch {}
              }
              console.log('[App] Syncing protection from chrome.storage:', protectionValue);
              localStorage.setItem('x1wallet_passwordProtection', JSON.stringify(protectionValue));
            }
            
            if (localAutoLock === null && result.x1wallet_autoLock !== undefined) {
              let autoLockValue = result.x1wallet_autoLock;
              if (typeof autoLockValue === 'string') {
                try { autoLockValue = JSON.parse(autoLockValue); } catch {}
              }
              localStorage.setItem('x1wallet_autoLock', JSON.stringify(autoLockValue));
            }
          } catch (e) {
            // Continue with localStorage values
          }
        }
        
        // Read final values from localStorage
        setPasswordProtection(storage.get('passwordProtection', false));
        setAutoLockMinutes(storage.get('autoLock', 5));
        
        const { hasPassword: checkHasPass } = await import('@x1-wallet/core/services/wallet');
        const result = await checkHasPass();
        setHasPasswordAsync(result);
        setPasswordCheckComplete(true);
      } catch {
        // Fallback to legacy check
        setHasPasswordAsync(
          storage.get('passwordHash', null) !== null || 
          !!localStorage.getItem('x1wallet_auth')
        );
        setPasswordCheckComplete(true);
      }
    };
    checkHasPassword();
  }, []);
  
  const hasPassword = hasPasswordAsync;

  // Track user activity - persist to storage so it survives popup close
  const updateActivity = useCallback(() => {
    const now = Date.now();
    lastActivityRef.current = now;
    // Persist to storage for cross-session tracking
    storage.set('lastActivity', now);
  }, []);

  // Check for auto-lock
  useEffect(() => {
    if (!passwordProtection || !hasPassword || autoLockMinutes === -1) {
      return;
    }

    const checkLock = () => {
      if (screen === 'settings') return;
      
      const elapsed = (Date.now() - lastActivityRef.current) / 1000 / 60;
      if (elapsed >= autoLockMinutes && !isLocked && screen !== 'welcome' && screen !== 'loading') {
        setIsLocked(true);
      }
    };

    lockTimerRef.current = setInterval(checkLock, 10000);

    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach(e => window.addEventListener(e, updateActivity));

    return () => {
      if (lockTimerRef.current) clearInterval(lockTimerRef.current);
      events.forEach(e => window.removeEventListener(e, updateActivity));
    };
  }, [passwordProtection, hasPassword, autoLockMinutes, isLocked, screen, updateActivity]);

  // Check for existing wallet on mount - wait for password check
  useEffect(() => {
    if (wallet.loading || initialCheckDone || !passwordCheckComplete) return;
    
    const checkWallet = async () => {
      await new Promise(r => setTimeout(r, 100));
      
      // Check URL params for hardware wallet redirect
      const urlParams = new URLSearchParams(window.location.search);
      const hwParam = urlParams.get('hw');
      
      // Check if there's encrypted data that needs unlocking
      const encryptedData = localStorage.getItem('x1wallet_wallets');
      const encryptedFlag = localStorage.getItem('x1wallet_encrypted');
      let isDataEncrypted = false;
      if (encryptedData && encryptedData.length > 0) {
        try {
          JSON.parse(encryptedData);
          console.log('[App] Wallet data is valid JSON (not encrypted)');
        } catch {
          isDataEncrypted = true;
          console.log('[App] Wallet data is NOT valid JSON (encrypted)');
        }
      }
      console.log('[App] State: wallets:', wallet.wallets?.length, 'isDataEncrypted:', isDataEncrypted, 'encryptedFlag:', encryptedFlag, 'protection:', passwordProtection, 'hasPassword:', hasPassword);
      
      if (wallet.wallets.length > 0) {
        // Wallets loaded - check if should lock based on settings
        logger.log('[App] Password check - protection:', passwordProtection, 'hasPassword:', hasPassword, 'autoLock:', autoLockMinutes);
        
        // Only lock if protection is ON, password exists, AND timeout exceeded
        if (passwordProtection && hasPassword && autoLockMinutes !== -1) {
          const lastActivity = storage.get('lastActivity', 0);
          const elapsedMinutes = (Date.now() - lastActivity) / 1000 / 60;
          
          if (lastActivity > 0 && elapsedMinutes >= autoLockMinutes) {
            setIsLocked(true);
          } else {
            // Opening extension is activity - reset timer
            const now = Date.now();
            lastActivityRef.current = now;
            storage.set('lastActivity', now);
          }
        } else {
          // No auto-lock - just set activity
          const now = Date.now();
          lastActivityRef.current = now;
          storage.set('lastActivity', now);
        }
        
        // If hw=1 param, go to hardware wallet screen
        if (hwParam === '1') {
          setReturnScreen('main');
          setScreen('hardware');
        } else {
          setScreen('main');
        }
      } else if (isDataEncrypted) {
        // Encrypted data exists but couldn't load - need password to unlock
        // Only show lock screen if protection is actually ON
        if (passwordProtection) {
          logger.log('[App] Encrypted data found, protection ON - need unlock');
          setIsLocked(true);
          setScreen('main');
        } else {
          // Protection is OFF but data is encrypted - this shouldn't happen
          // Try to clear the encrypted flag and go to welcome
          logger.log('[App] Encrypted data but protection OFF - clearing and going to welcome');
          localStorage.removeItem('x1wallet_encrypted');
          setScreen('welcome');
        }
      } else {
        // No wallet exists
        if (hwParam === '1') {
          setReturnScreen('welcome');
          setScreen('hardware');
        } else {
          setScreen('welcome');
        }
      }
      setInitialCheckDone(true);
    };
    
    checkWallet();
  }, [wallet.loading, initialCheckDone, passwordCheckComplete, passwordProtection, hasPassword, autoLockMinutes]);

  // Redirect to welcome when all wallets are removed (but not if data is encrypted)
  useEffect(() => {
    // Don't redirect if there's encrypted data that needs unlocking
    const encryptedData = localStorage.getItem('x1wallet_wallets');
    let isDataEncrypted = false;
    if (encryptedData && encryptedData.length > 0) {
      try {
        JSON.parse(encryptedData);
      } catch {
        isDataEncrypted = true;
      }
    }
    
    if (initialCheckDone && !wallet.loading && wallet.wallets.length === 0 && screen === 'main' && !isDataEncrypted) {
      setScreen('welcome');
    }
  }, [wallet.wallets.length, wallet.loading, initialCheckDone, screen]);

  // Handle unlock - supports both legacy password and encrypted wallet
  const handleUnlock = async (password) => {
    setIsLocked(false);
    const now = Date.now();
    lastActivityRef.current = now;
    storage.set('lastActivity', now);
  };
  
  // After unlock, if protection is OFF, save wallets unencrypted
  // This useEffect watches for wallets loading after unlock
  useEffect(() => {
    const saveUnencryptedIfNeeded = async () => {
      const currentProtection = storage.get('passwordProtection', false);
      const isEncryptedFlag = localStorage.getItem('x1wallet_encrypted');
      
      // If protection is OFF but wallets are encrypted, save them unencrypted
      if (!currentProtection && isEncryptedFlag === 'true' && wallet.wallets && wallet.wallets.length > 0) {
        logger.log('[App] Protection OFF but data encrypted - saving unencrypted');
        try {
          if (wallet.saveWalletsUnencrypted) {
            wallet.saveWalletsUnencrypted(wallet.wallets);
            if (wallet.clearEncryptionPassword) {
              wallet.clearEncryptionPassword();
            }
            localStorage.removeItem('x1wallet_encrypted');
            const { clearPassword } = await import('@x1-wallet/core/services/wallet');
            await clearPassword();
            setHasPasswordAsync(false);
          }
        } catch (e) {
          logger.error('[App] Failed to save unencrypted:', e);
        }
      }
    };
    
    if (!isLocked && wallet.wallets && wallet.wallets.length > 0) {
      saveUnencryptedIfNeeded();
    }
  }, [isLocked, wallet.wallets, wallet.saveWalletsUnencrypted, wallet.clearEncryptionPassword]);

  // Handle wallet creation - password only if protection is ON
  const handleCreateComplete = async (mnemonic, name, password) => {
    try {
      // Re-read protection setting directly from localStorage to ensure we have current value
      let currentProtection = false;
      try {
        const stored = localStorage.getItem('x1wallet_passwordProtection');
        if (stored) {
          currentProtection = JSON.parse(stored) === true;
        }
      } catch (e) {
        currentProtection = false;
      }
      
      logger.log('[handleCreateComplete] Protection:', currentProtection, 'Password provided:', !!password);
      
      // If protection is OFF and no password provided, create unencrypted
      if (!currentProtection && !password) {
        logger.log('[handleCreateComplete] Creating unencrypted wallet');
        await wallet.createWallet(mnemonic, name);
        storage.set('lastActivity', Date.now());
        setScreen('main');
        return;
      }
      
      // Protection is ON - password required
      if (!password) {
        throw new Error('Password is required');
      }
      
      const { setupPassword, hasPassword: checkHasPassword } = await import('@x1-wallet/core/services/wallet');
      const passwordExists = await checkHasPassword();
      const hasWallets = wallet.wallets && wallet.wallets.length > 0;
      const effectivePasswordExists = passwordExists && hasWallets;
      
      // Set encryption password and create wallet
      wallet.setEncryptionPasswordOnly(password);
      await wallet.createWallet(mnemonic, name);
      
      // Set up password hash if first time
      if (!effectivePasswordExists) {
        await setupPassword(password);
      }
      
      setHasPasswordAsync(true);
      localStorage.setItem('x1wallet_encrypted', 'true');
      storage.set('lastActivity', Date.now());
      setScreen('main');
    } catch (err) {
      logger.error('Failed to create wallet:', err);
      showAlert(err.message || 'Failed to create wallet', 'Creation Failed', 'warning');
    }
  };

  // Handle wallet import - ALWAYS requires password (turns protection ON)
  const handleImportComplete = async (mnemonic, name, password) => {
    try {
      // Import ALWAYS requires password (existing funds need protection)
      if (!password) {
        throw new Error('Password is required');
      }
      
      const { setupPassword, hasPassword: checkHasPassword } = await import('@x1-wallet/core/services/wallet');
      const passwordExists = await checkHasPassword();
      const hasWallets = wallet.wallets && wallet.wallets.length > 0;
      const effectivePasswordExists = passwordExists && hasWallets;
      
      // Set encryption password and import wallet
      wallet.setEncryptionPasswordOnly(password);
      await wallet.importWallet(mnemonic, name);
      
      // Set up password hash if first time
      if (!effectivePasswordExists) {
        await setupPassword(password);
      }
      
      // Import always turns ON password protection
      storage.set('passwordProtection', true);
      setPasswordProtection(true);
      setHasPasswordAsync(true);
      localStorage.setItem('x1wallet_encrypted', 'true');
      
      storage.set('lastActivity', Date.now());
      setScreen('main');
    } catch (err) {
      logger.error('Failed to import wallet:', err);
      showAlert(err.message || 'Failed to import wallet', 'Import Failed', 'warning');
    }
  };

  // Handle private key import - ALWAYS requires password (turns protection ON)
  const handleImportPrivateKey = async (walletData) => {
    try {
      const password = walletData.password;
      
      // Import ALWAYS requires password (existing funds need protection)
      if (!password) {
        showAlert('Password is required', 'Security Error', 'error');
        return;
      }
      
      // Check if wallet already exists
      const existingWallets = wallet.wallets || [];
      const existingMatch = existingWallets.find(w => 
        w.publicKey === walletData.publicKey || 
        w.addresses?.some(a => a.publicKey === walletData.publicKey)
      );
      if (existingMatch) {
        showAlert(`This wallet has already been imported as "${existingMatch.name}"`, 'Wallet Already Exists', 'warning');
        return;
      }
      
      const { setupPassword, hasPassword: checkHasPassword } = await import('@x1-wallet/core/services/wallet');
      const passwordExists = await checkHasPassword();
      const hasWallets = existingWallets.length > 0;
      const effectivePasswordExists = passwordExists && hasWallets;
      
      // Build the new wallet object
      const newWallet = {
        id: Date.now().toString(),
        name: walletData.name || 'Imported Wallet',
        publicKey: walletData.publicKey,
        privateKey: walletData.privateKey,
        mnemonic: null,
        type: 'imported',
        createdAt: new Date().toISOString(),
        addresses: [{
          index: 0,
          publicKey: walletData.publicKey,
          privateKey: walletData.privateKey,
          name: 'Address 1'
        }],
        activeAddressIndex: 0
      };
      
      // Set encryption password and save
      wallet.setEncryptionPasswordOnly(password);
      await wallet.saveWallets([...existingWallets, newWallet]);
      wallet.selectWallet(newWallet.id);
      
      // Set up password hash if first time
      if (!effectivePasswordExists) {
        await setupPassword(password);
      }
      
      // Import always turns ON password protection
      storage.set('passwordProtection', true);
      setPasswordProtection(true);
      setHasPasswordAsync(true);
      localStorage.setItem('x1wallet_encrypted', 'true');
      
      storage.set('lastActivity', Date.now());
      setScreen('main');
    } catch (err) {
      logger.error('Failed to import private key wallet:', err);
      showAlert('Failed to import wallet: ' + err.message, 'Import Failed', 'error');
    }
  };

  // Handle lock/reset
  const handleLock = () => {
    wallet.clearWallet();
    setScreen('welcome');
  };

  // Navigate to create from manager
  const handleManagerCreate = () => {
    setReturnScreen('main');
    setScreen('create');
  };

  // Navigate to import from manager
  const handleManagerImport = () => {
    setReturnScreen('main');
    setScreen('import');
  };

  // Navigate to hardware wallet from manager
  const handleManagerHardware = () => {
    setReturnScreen('main');
    setScreen('hardware');
  };

  // Handle hardware wallet complete
  const handleHardwareComplete = async (hwWallet) => {
    try {
      await wallet.addHardwareWallet(hwWallet);
      setScreen('main');
    } catch (err) {
      logger.error('Failed to add hardware wallet:', err);
      showAlert(err.message || 'Failed to add hardware wallet', 'Wallet Already Exists', 'warning');
    }
  };

  // Loading screen
  if (screen === 'loading' || wallet.loading) {
    return (
      <div className="app loading">
        <div className="spinner" />
      </div>
    );
  }

  // Lock screen
  if (isLocked && screen !== 'welcome') {
    return (
      <div className="app">
        <LockScreen 
          onUnlock={handleUnlock} 
          walletUnlock={wallet.isEncrypted ? wallet.unlockWallet : null}
        />
      </div>
    );
  }

  // Bottom Navigation Component
  const BottomNav = () => (
    <div className="bottom-nav">
      <button className={`nav-item ${screen === 'main' ? 'active' : ''}`} onClick={() => setScreen('main')}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
        <span>Assets</span>
      </button>
      <button className={`nav-item ${screen === 'swap' ? 'active' : ''}`} onClick={() => setScreen('swap')}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
        </svg>
        <span>Swap</span>
      </button>
      <button className={`nav-item ${screen === 'browser' ? 'active' : ''}`} onClick={() => setScreen('browser')}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        <span>Browse</span>
      </button>
      <button className={`nav-item ${screen === 'settings' ? 'active' : ''}`} onClick={() => setScreen('settings')}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        <span>Settings</span>
      </button>
    </div>
  );

  // Screens that don't show bottom nav
  const noNavScreens = ['welcome', 'create', 'import', 'hardware'];
  const showBottomNav = !noNavScreens.includes(screen);

  // Welcome screen
  if (screen === 'welcome') {
    return (
      <div className="app">
        <WelcomeScreen
          onCreateWallet={() => { setReturnScreen('main'); setScreen('create'); }}
          onImportWallet={() => { setReturnScreen('main'); setScreen('import'); }}
          onHardwareWallet={() => { setReturnScreen('main'); setScreen('hardware'); }}
          onBack={wallet.wallets?.length > 0 ? () => setScreen('main') : null}
        />
      </div>
    );
  }

  // Create wallet flow
  if (screen === 'create') {
    return (
      <div className="app">
        {alertModal.show && (
          <AlertModal
            title={alertModal.title}
            message={alertModal.message}
            type={alertModal.type}
            onClose={closeAlert}
          />
        )}
        <CreateWallet
          onComplete={handleCreateComplete}
          onBack={() => setScreen(returnScreen === 'manage' ? 'manage' : 'welcome')}
          passwordProtection={passwordProtection}
        />
      </div>
    );
  }

  // Import wallet flow
  if (screen === 'import') {
    return (
      <div className="app">
        {alertModal.show && (
          <AlertModal
            title={alertModal.title}
            message={alertModal.message}
            type={alertModal.type}
            onClose={closeAlert}
          />
        )}
        <ImportWallet
          onComplete={handleImportComplete}
          onCompletePrivateKey={handleImportPrivateKey}
          onBack={() => setScreen(returnScreen === 'manage' ? 'manage' : 'welcome')}
        />
      </div>
    );
  }

  // Hardware wallet flow
  if (screen === 'hardware') {
    return (
      <div className="app">
        {alertModal.show && (
          <AlertModal
            title={alertModal.title}
            message={alertModal.message}
            type={alertModal.type}
            onClose={closeAlert}
          />
        )}
        <HardwareWallet
          onComplete={handleHardwareComplete}
          onBack={() => setScreen(returnScreen === 'manage' ? 'manage' : 'main')}
        />
      </div>
    );
  }

  // Wallet manager
  if (screen === 'manage') {
    return (
      <div className="app">
        <WalletManager
          wallet={wallet}
          onBack={() => setScreen('main')}
          onCreateWallet={handleManagerCreate}
          onImportWallet={handleManagerImport}
        />
        <BottomNav />
      </div>
    );
  }

  // Settings screen
  if (screen === 'settings') {
    return (
      <div className="app">
        <SettingsScreen
          key={`settings-${passwordProtection}`}
          wallet={wallet}
          onBack={() => setScreen('main')}
          onLock={handleLock}
          initialPasswordProtection={passwordProtection}
          onPasswordProtectionChange={(newValue) => {
            setPasswordProtection(newValue);
            if (!newValue) {
              setIsLocked(false);
              setHasPasswordAsync(false);
            }
          }}
          onAutoLockChange={(newValue) => {
            setAutoLockMinutes(newValue);
          }}
        />
        <BottomNav />
      </div>
    );
  }

  // Send screen
  if (screen === 'send') {
    return (
      <div className="app">
        <SendFlow
          wallet={wallet}
          selectedToken={selectedToken}
          userTokens={userTokens}
          onBack={() => { 
            setSelectedToken(null); 
            setScreen('main'); 
            triggerBalanceRefresh();
          }}
          onSuccess={() => { 
            triggerActivityRefresh(); 
          }}
        />
        <BottomNav />
      </div>
    );
  }

  // Token Detail screen
  if (screen === 'tokenDetail') {
    return (
      <div className="app">
        <TokenDetail
          token={selectedToken}
          wallet={wallet}
          onBack={() => { setSelectedToken(null); setScreen('main'); }}
          onSend={(token) => { setSelectedToken(token); setScreen('send'); }}
          onReceive={() => setScreen('receive')}
          onSwap={() => setScreen('swap')}
          onBridge={() => setScreen('bridge')}
          onStake={() => setScreen('stake')}
        />
        <BottomNav />
      </div>
    );
  }

  // Receive screen
  if (screen === 'receive') {
    return (
      <div className="app">
        <ReceiveScreen
          wallet={wallet}
          onBack={() => setScreen('main')}
        />
        <BottomNav />
      </div>
    );
  }

  // Swap screen
  if (screen === 'swap') {
    return (
      <div className="app">
        <SwapScreen
          wallet={wallet}
          onBack={() => setScreen('main')}
          onSwapComplete={() => {
            triggerActivityRefresh();
            fetchUserTokens();
          }}
          userTokens={userTokens}
          initialFromToken={selectedToken}
        />
        <BottomNav />
      </div>
    );
  }

  // Bridge screen
  if (screen === 'bridge') {
    return (
      <div className="app">
        <BridgeScreen
          wallet={wallet}
          onBack={(action) => {
            setScreen('main');
            if (action === 'network') {
              sessionStorage.setItem('openNetworkPanel', 'true');
            }
          }}
        />
        <BottomNav />
      </div>
    );
  }

  // Stake screen
  if (screen === 'stake') {
    logger.log('[App] Rendering stake screen');
    return (
      <div className="app">
        <StakeScreen
          wallet={wallet}
          onBack={(action) => {
            setScreen('main');
            // If action is 'network', we need to trigger network panel - pass a flag
            if (action === 'network') {
              // Store flag to open network panel after returning to main
              sessionStorage.setItem('openNetworkPanel', 'true');
            }
          }}
          onRefreshBalance={() => wallet.refreshBalance()}
        />
        <BottomNav />
      </div>
    );
  }

  // Browser screen
  if (screen === 'browser') {
    const dapps = [
      { 
        name: 'X1 Blockchain', 
        url: 'https://x1.xyz', 
        logo: 'https://logo44.s3.us-east-2.amazonaws.com/logos/X1.png',
        desc: 'Layer-1 Blockchain' 
      },
      { 
        name: 'XDEX', 
        url: 'https://xdex.xyz', 
        logo: 'https://xdex.s3.us-east-2.amazonaws.com/vimages/XDEX.png',
        desc: 'X1 Native DEX' 
      },
      { 
        name: 'Degen', 
        url: 'https://degen.fyi', 
        logo: 'https://xdex.s3.us-east-2.amazonaws.com/vimages/DEGEN.png',
        desc: 'Launchpad' 
      },
      { 
        name: 'Vero', 
        url: 'https://vero.x1.xyz/', 
        letter: 'V',
        color: '#8b5cf6',
        desc: 'Predictive Markets' 
      },
      { 
        name: 'Bridge', 
        url: 'https://bridge.x1.xyz/', 
        letter: 'B',
        color: '#14F195',
        desc: 'Cross-Chain Bridge' 
      },
    ];

    // Render icon based on type
    const renderIcon = (dapp) => {
      if (dapp.logo) {
        return <img src={dapp.logo} alt={dapp.name} style={{ width: 36, height: 36, borderRadius: 10, objectFit: 'cover' }} />;
      }
      if (dapp.letter) {
        return (
          <div style={{ 
            width: 36, 
            height: 36, 
            borderRadius: 10, 
            background: '#000',
            border: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: dapp.color || 'var(--text-primary)' }}>{dapp.letter}</span>
          </div>
        );
      }
      if (dapp.svgIcon === 'explorer') {
        return (
          <div style={{ 
            width: 36, 
            height: 36, 
            borderRadius: 10, 
            background: '#000',
            border: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </div>
        );
      }
      return null;
    };
    
    return (
      <div className="app">
        <div className="screen browser-screen">
          <div className="page-header">
            <h2 className="header-title">Explore dApps</h2>
          </div>
          <div className="dapp-grid">
            {dapps.map((dapp, i) => (
              <button 
                key={i} 
                className="dapp-card"
                onClick={() => window.open(dapp.url, '_blank')}
              >
                <div className="dapp-card-icon" style={{ background: 'transparent' }}>
                  {renderIcon(dapp)}
                </div>
                <div className="dapp-card-info">
                  <span className="dapp-card-name">{dapp.name}</span>
                  <span className="dapp-card-desc">{dapp.desc}</span>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </button>
            ))}
          </div>
        </div>
        <BottomNav />
      </div>
    );
  }

  // Main wallet screen
  // If this is an approval window with a pending request, ONLY show DAppApproval (not the main wallet)
  if (hasDAppRequest && wallet.wallet) {
    return (
      <div className="app">
        <DAppApproval 
          wallet={wallet} 
          onComplete={() => setHasDAppRequest(false)} 
        />
      </div>
    );
  }

  return (
    <div className="app">
      {alertModal.show && (
        <AlertModal
          title={alertModal.title}
          message={alertModal.message}
          type={alertModal.type}
          onClose={closeAlert}
        />
      )}
      <WalletMain
        wallet={wallet}
        userTokens={userTokens}
        onTokensUpdate={setUserTokens}
        onSend={(token) => { setSelectedToken(token || null); setScreen('send'); }}
        onReceive={() => setScreen('receive')}
        onSwap={(token) => { setSelectedToken(token || null); setScreen('swap'); }}
        onBridge={() => setScreen('bridge')}
        onStake={() => { logger.log('[App] Setting screen to stake'); setScreen('stake'); }}
        onSettings={() => setScreen('settings')}
        onCreateWallet={handleManagerCreate}
        onImportWallet={handleManagerImport}
        onHardwareWallet={handleManagerHardware}
        activityRefreshKey={activityRefreshKey}
        balanceRefreshKey={balanceRefreshKey}
        onTokenClick={(token) => { setSelectedToken(token); setScreen('tokenDetail'); }}
      />
      <BottomNav />
    </div>
  );
}

export default App;