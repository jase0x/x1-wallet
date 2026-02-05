// X1 Wallet - Main App Component
import { logger, getUserFriendlyError, ErrorMessages, useWallet } from '@x1-wallet/core';
import React, { useState, useEffect, useCallback, useRef, Component } from 'react';
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

// ============================================
// ERROR BOUNDARY - Prevents black screen on errors
// ============================================
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Error info:', errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="app" style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center',
          padding: 24,
          textAlign: 'center',
          minHeight: '100vh',
          background: 'var(--bg-primary)'
        }}>
          <div style={{ 
            width: 64, 
            height: 64, 
            borderRadius: '50%', 
            background: 'rgba(255, 107, 107, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 16
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ff6b6b" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2 style={{ color: 'var(--text-primary)', marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: 24, fontSize: 14 }}>
            The wallet encountered an error. Please reload to continue.
          </p>
          <button 
            onClick={this.handleReload}
            style={{
              background: 'var(--x1-blue)',
              color: 'white',
              border: 'none',
              padding: '12px 32px',
              borderRadius: 12,
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 14
            }}
          >
            Reload Wallet
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// ============================================
// CHROME RUNTIME HELPER - Checks if extension context is valid
// ============================================
function isExtensionContextValid() {
  try {
    // Check if chrome.runtime is available and not invalidated
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      return false;
    }
    // Accessing id will throw if context is invalidated
    const id = chrome.runtime.id;
    return !!id;
  } catch (e) {
    return false;
  }
}

// Safe message sender that handles invalidated context
async function safeSendMessage(message) {
  if (!isExtensionContextValid()) {
    console.warn('[App] Extension context invalid, cannot send message');
    return null;
  }
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (e) {
    if (e.message?.includes('Extension context invalidated')) {
      console.warn('[App] Extension context invalidated');
      return null;
    }
    throw e;
  }
}

// Storage helper
const storage = {
  get: (key, defaultValue) => {
    try { return JSON.parse(localStorage.getItem(`x1wallet_${key}`)) ?? defaultValue; }
    catch { return defaultValue; }
  },
  set: (key, value) => {
    localStorage.setItem(`x1wallet_${key}`, JSON.stringify(value));
    // Also sync to chrome.storage.local for persistence across sessions
    if (isExtensionContextValid() && chrome.storage) {
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

// Password Prompt Modal - Themed modal for password input
function PasswordPromptModal({ title, message, onSubmit, onCancel }) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const inputRef = React.useRef(null);
  
  React.useEffect(() => {
    // Focus input on mount
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);
  
  const handleSubmit = (e) => {
    e.preventDefault();
    if (password.trim()) {
      onSubmit(password);
    }
  };
  
  return (
    <div className="alert-modal-overlay" onClick={onCancel}>
      <div className="alert-modal-content" onClick={e => e.stopPropagation()}>
        <div className="alert-modal-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h3 className="alert-modal-title">{title || 'Enter Password'}</h3>
        <p className="alert-modal-message">{message || 'Please enter your wallet password to continue.'}</p>
        
        <form onSubmit={handleSubmit} style={{ width: '100%' }}>
          <div style={{ position: 'relative', marginBottom: 16 }}>
            <input
              ref={inputRef}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="form-input"
              style={{
                width: '100%',
                padding: '14px 44px 14px 16px',
                fontSize: 15,
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 12,
                color: 'var(--text-primary)',
                outline: 'none'
              }}
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              style={{
                position: 'absolute',
                right: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 4,
                color: 'var(--text-muted)'
              }}
            >
              {showPassword ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
          
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                flex: 1,
                padding: '14px 24px',
                fontSize: 15,
                fontWeight: 600,
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                borderRadius: 12,
                color: 'var(--text-primary)',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              style={{
                flex: 1,
                padding: '14px 24px',
                fontSize: 15,
                fontWeight: 600
              }}
              disabled={!password.trim()}
            >
              Confirm
            </button>
          </div>
        </form>
      </div>
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
function LockScreen({ onUnlock, walletUnlock, title, subtitle }) {
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
      <h2>{title || 'Wallet Locked'}</h2>
      <p className="lock-subtitle">{subtitle || 'Enter your password to unlock'}</p>
      
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
  const [importInitialType, setImportInitialType] = useState('phrase'); // 'phrase', 'privatekey', or 'watchonly'
  const [isLocked, setIsLocked] = useState(false);
  const [initialCheckDone, setInitialCheckDone] = useState(false);
  const [selectedToken, setSelectedToken] = useState(null);
  const [activityRefreshKey, setActivityRefreshKey] = useState(0);
  const [balanceRefreshKey, setBalanceRefreshKey] = useState(0);
  const [userTokens, setUserTokens] = useState([]);
  const [hasDAppRequest, setHasDAppRequest] = useState(false);
  const [dappRequiresReauth, setDappRequiresReauth] = useState(false);  // X1W-SEC: Track if signing needs password re-entry
  const [currentRequestId, setCurrentRequestId] = useState(null);  // X1W-SEC: Track which request is being handled
  const pendingRequestRef = useRef(null);  // Track incoming request to prevent race condition
  const [alertModal, setAlertModal] = useState({ show: false, title: '', message: '', type: 'error' });
  const [passwordPrompt, setPasswordPrompt] = useState({ show: false, title: '', message: '', resolve: null });
  const lastActivityRef = useRef(Date.now());
  const lockTimerRef = useRef(null);
  
  // Show alert modal helper
  const showAlert = useCallback((message, title = '', type = 'error') => {
    setAlertModal({ show: true, title, message, type });
  }, []);
  
  const closeAlert = useCallback(() => {
    setAlertModal({ show: false, title: '', message: '', type: 'error' });
  }, []);
  
  // Password prompt helper - returns a promise that resolves with password or null
  const promptPassword = useCallback((title, message) => {
    return new Promise((resolve) => {
      setPasswordPrompt({ show: true, title, message, resolve });
    });
  }, []);
  
  const handlePasswordSubmit = useCallback((password) => {
    if (passwordPrompt.resolve) {
      passwordPrompt.resolve(password);
    }
    setPasswordPrompt({ show: false, title: '', message: '', resolve: null });
  }, [passwordPrompt.resolve]);
  
  const handlePasswordCancel = useCallback(() => {
    if (passwordPrompt.resolve) {
      passwordPrompt.resolve(null);
    }
    setPasswordPrompt({ show: false, title: '', message: '', resolve: null });
  }, [passwordPrompt.resolve]);
  
  // Function to trigger activity refresh
  const triggerActivityRefresh = useCallback(() => {
    setActivityRefreshKey(prev => prev + 1);
  }, []);
  
  // Function to trigger balance refresh
  const triggerBalanceRefresh = useCallback(() => {
    setBalanceRefreshKey(prev => prev + 1);
  }, []);

  // Handle visibility change - reinitialize when side panel becomes visible again
  // This fixes the "black screen when navigating to new site" bug
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[App] Side panel became visible, refreshing...');
        // Trigger balance refresh to update data
        triggerBalanceRefresh();
        triggerActivityRefresh();
        // Re-apply theme (in case CSS variables weren't loaded)
        try {
          const savedTheme = localStorage.getItem('x1wallet_darkMode');
          const isDark = savedTheme === null ? true : JSON.parse(savedTheme);
          document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
        } catch (e) {
          document.documentElement.setAttribute('data-theme', 'dark');
        }
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [triggerBalanceRefresh, triggerActivityRefresh]);

  // Check for pending dApp requests
  // Supports both: 1) Approval window (URL params) and 2) In-popup approvals (port messages)
  useEffect(() => {
    let port = null;
    let isApprovalWindow = false;
    
    const checkDAppRequest = async () => {
      try {
        // Check if extension context is valid
        if (!isExtensionContextValid()) {
          logger.log('[App] Extension context invalid, skipping dApp request check');
          return;
        }
        
        // Check if this popup was opened as an approval window (has request param in URL)
        const urlParams = new URLSearchParams(window.location.search);
        isApprovalWindow = urlParams.has('request');
        
        // For approval windows OR side panel, check for pending request
        // Side panel won't have URL params but should still show approval if there's one pending
        const response = await safeSendMessage({ type: 'get-pending-request' });
        if (response) {
          const pendingReq = response?.request || response;
          const reqId = response?.requestId || pendingReq?.requestId;
          if (pendingReq && pendingReq.type) {
            setHasDAppRequest(true);
            setCurrentRequestId(reqId);  // X1W-SEC: Track which request we're handling
            // X1W-SEC: Check if this request requires password re-authentication
            if (pendingReq.requiresReauth) {
              logger.log('[App] Pending request requires reauth');
              setDappRequiresReauth(true);
            }
            return;
          }
        }
        
        if (isApprovalWindow) {
          return; // Don't proceed with normal loading for dedicated approval windows
        }
      } catch (err) {
        // Only log if it's not a context invalidation
        if (!err.message?.includes('Extension context invalidated')) {
          logger.log('[App] Error checking dApp request:', err.message);
        }
      }
    };
    
    // Connect to background via port for real-time approval notifications
    const connectPort = () => {
      if (!isExtensionContextValid()) return;
      
      try {
        port = chrome.runtime.connect({ name: 'x1-wallet-popup' });
        
        port.onMessage.addListener((message) => {
          if (message.type === 'pending-request' && message.request) {
            logger.log('[App] Received pending request via port:', message.request.type, 'id:', message.requestId);
            // Store in ref first to prevent race condition with onComplete
            pendingRequestRef.current = message.requestId || message.request.requestId;
            setHasDAppRequest(true);
            setCurrentRequestId(message.requestId || message.request.requestId);  // X1W-SEC: Track request ID
            // X1W-SEC: Check if this request requires password re-authentication
            if (message.request.requiresReauth) {
              logger.log('[App] Request requires reauth');
              setDappRequiresReauth(true);
            }
          }
        });
        
        port.onDisconnect.addListener(() => {
          logger.log('[App] Port disconnected from background');
          port = null;
          // Don't try to reconnect - might cause issues
        });
        
        logger.log('[App] Connected to background via port');
      } catch (err) {
        if (!err.message?.includes('Extension context invalidated')) {
          logger.log('[App] Failed to connect port:', err.message);
        }
      }
    };
    
    // Connect port and check for pending requests once on mount
    connectPort();
    checkDAppRequest();
    
    // Only poll for approval windows (where we need to know when request is handled)
    // Regular popup/side panel should NOT poll - it interferes with other windows
    let interval = null;
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('request')) {
      interval = setInterval(checkDAppRequest, 500);
    }
    
    return () => {
      if (interval) clearInterval(interval);
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
  // Migrate legacy "Never" (-1) setting to 1 day (1440 minutes)
  const [autoLockMinutes, setAutoLockMinutes] = useState(() => {
    const saved = storage.get('autoLock', 5);
    if (saved === -1) {
      storage.set('autoLock', 1440);
      return 1440;
    }
    return saved;
  });
  const [passwordCheckComplete, setPasswordCheckComplete] = useState(false);
  
  // Session password cache - stores password in memory during session
  // This allows creating multiple wallets without re-entering password
  const [sessionPassword, setSessionPassword] = useState(null);
  
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
              // Migrate legacy "Never" (-1) to 1 day (1440 minutes)
              if (autoLockValue === -1) {
                autoLockValue = 1440;
              }
              localStorage.setItem('x1wallet_autoLock', JSON.stringify(autoLockValue));
            }
          } catch (e) {
            // Continue with localStorage values
          }
        }
        
        // Read final values from localStorage with migration
        setPasswordProtection(storage.get('passwordProtection', false));
        let finalAutoLock = storage.get('autoLock', 5);
        // Ensure no legacy -1 values remain
        if (finalAutoLock === -1) {
          finalAutoLock = 1440;
          storage.set('autoLock', 1440);
        }
        setAutoLockMinutes(finalAutoLock);
        
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
  // Throttle to only update once per 30 seconds to reduce storage writes
  const lastStorageUpdateRef = useRef(0);
  const updateActivity = useCallback(() => {
    const now = Date.now();
    lastActivityRef.current = now;
    
    // Only persist to storage every 30 seconds to reduce spam
    if (now - lastStorageUpdateRef.current > 30000) {
      lastStorageUpdateRef.current = now;
      storage.set('lastActivity', now);
    }
  }, []);

  // Check for auto-lock
  useEffect(() => {
    // Skip if password protection is off or no password set
    if (!passwordProtection || !hasPassword) {
      return;
    }
    
    // Also handle edge case of invalid autoLockMinutes (shouldn't happen after migration)
    if (autoLockMinutes < 0) {
      return;
    }

    const checkLock = () => {
      // Don't lock during active operations - these screens mean user is actively doing something
      const activeScreens = ['settings', 'send', 'swap', 'bridge', 'stake', 'tokenDetail', 'create', 'import', 'hardware'];
      if (activeScreens.includes(screen)) return;
      
      // For "Immediately" (0), we only lock on initial load, not during active use
      // The interval-based lock is for timeout-based locking (1+ minutes)
      if (autoLockMinutes === 0) return;
      
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
        // Note: autoLockMinutes should always be >= 0 after migration (no more "Never" option)
        if (passwordProtection && hasPassword && autoLockMinutes >= 0) {
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
        } else if (!passwordProtection) {
          // No password protection - just set activity
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
    setSessionPassword(password); // Cache password for session
    const now = Date.now();
    lastActivityRef.current = now;
    storage.set('lastActivity', now);
  };
  
  // SEC-FIX: Removed unencrypted save effect
  // Encryption is now MANDATORY - data must always remain encrypted
  // The "password protection" setting only controls whether password is required on open
  // (session storage allows temporary unlock, but storage is always encrypted)

  // Handle wallet creation - password ALWAYS required (SEC-FIX)
  const handleCreateComplete = async (mnemonic, name, password) => {
    try {
      // SEC-FIX: Password is ALWAYS required - encryption is mandatory
      if (!password) {
        throw new Error('Password is required to create a wallet');
      }
      
      // Clear tokens immediately for instant UI update (no stale data)
      setUserTokens([]);
      
      logger.log('[handleCreateComplete] Creating encrypted wallet');
      
      const { setupPassword, hasPassword: checkHasPassword } = await import('@x1-wallet/core/services/wallet');
      const passwordExists = await checkHasPassword();
      const hasWallets = wallet.wallets && wallet.wallets.length > 0;
      const effectivePasswordExists = passwordExists && hasWallets;
      
      // Pass password directly to createWallet (avoids React state timing issue)
      await wallet.createWallet(mnemonic, name, password);
      
      // Set up password hash if first time
      if (!effectivePasswordExists) {
        await setupPassword(password);
      }
      
      // Cache password in session for subsequent wallet creations
      setSessionPassword(password);
      
      setHasPasswordAsync(true);
      localStorage.setItem('x1wallet_encrypted', 'true');
      storage.set('passwordProtection', true);  // Ensure protection is ON
      storage.set('lastActivity', Date.now());
      setScreen('main');
      return; // FIX: stop execution after success
    } catch (err) {
      logger.error('Failed to create wallet:', err);
      showAlert(err.message || 'Failed to create wallet', 'Creation Failed', 'warning');
    }
  };

  // Handle wallet import - ALWAYS requires password (turns protection ON)
  const handleImportComplete = async (mnemonic, name, password, derivationIndex = 0) => {
    try {
      // Import ALWAYS requires password (existing funds need protection)
      if (!password) {
        throw new Error('Password is required');
      }
      
      // Clear tokens immediately for instant UI update (no stale data)
      setUserTokens([]);
      
      const { setupPassword, hasPassword: checkHasPassword } = await import('@x1-wallet/core/services/wallet');
      const passwordExists = await checkHasPassword();
      const hasWallets = wallet.wallets && wallet.wallets.length > 0;
      const effectivePasswordExists = passwordExists && hasWallets;
      
      // Pass password directly to importWallet (avoids React state timing issue)
      await wallet.importWallet(mnemonic, name, password, derivationIndex);
      
      // Set up password hash if first time
      if (!effectivePasswordExists) {
        await setupPassword(password);
      }
      
      // Cache password in session for subsequent wallet creations
      setSessionPassword(password);
      
      // Import always turns ON password protection
      storage.set('passwordProtection', true);
      setPasswordProtection(true);
      setHasPasswordAsync(true);
      localStorage.setItem('x1wallet_encrypted', 'true');
      
      storage.set('lastActivity', Date.now());
      
      // Refresh wallet balance after import
      if (wallet.refreshBalance) {
        logger.log('[ImportComplete] Refreshing balance...');
        setTimeout(() => wallet.refreshBalance(), 500);
      }
      
      setScreen('main');
      return; // FIX: stop execution after success
    } catch (err) {
      logger.error('Failed to import wallet:', err);
      showAlert(err.message || 'Failed to import wallet', 'Import Failed', 'warning');
    }
  };

  // Handle importing multiple wallets from same seed phrase
  const handleImportMultiple = async (mnemonic, baseName, password, derivedAddresses) => {
    try {
      if (!password) {
        throw new Error('Password is required');
      }
      
      // Clear tokens immediately for instant UI update
      setUserTokens([]);
      
      const { setupPassword, hasPassword: checkHasPassword } = await import('@x1-wallet/core/services/wallet');
      const passwordExists = await checkHasPassword();
      const hasWallets = wallet.wallets && wallet.wallets.length > 0;
      const effectivePasswordExists = passwordExists && hasWallets;
      
      // Set up password hash FIRST if needed (before importing)
      if (!effectivePasswordExists) {
        await setupPassword(password);
      }
      
      // Import each selected address as a separate wallet
      let importedCount = 0;
      let skippedCount = 0;
      
      // Determine base name - strip trailing numbers/spaces if multiple wallets
      let cleanBaseName = baseName.trim();
      const shouldNumber = derivedAddresses.length > 1;
      
      if (shouldNumber) {
        // Remove trailing numbers and spaces (e.g., "Wallet 1" -> "Wallet", "My Wallet 2" -> "My Wallet")
        cleanBaseName = cleanBaseName.replace(/\s*\d+\s*$/, '').trim();
        // If name becomes empty after stripping, use default
        if (!cleanBaseName) cleanBaseName = 'Wallet';
      }
      
      // Find available numbers for this base name (fills gaps)
      let availableNumbers = [];
      if (shouldNumber && wallet.wallets) {
        const regex = new RegExp(`^${cleanBaseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(\\d+)$`, 'i');
        const usedNumbers = new Set();
        
        for (const w of wallet.wallets) {
          const match = w.name?.match(regex);
          if (match) {
            usedNumbers.add(parseInt(match[1], 10));
          }
        }
        
        // Find available numbers starting from 1
        let num = 1;
        while (availableNumbers.length < derivedAddresses.length) {
          if (!usedNumbers.has(num)) {
            availableNumbers.push(num);
          }
          num++;
        }
      } else if (shouldNumber) {
        // No existing wallets, start from 1
        availableNumbers = derivedAddresses.map((_, i) => i + 1);
      }
      
      for (let i = 0; i < derivedAddresses.length; i++) {
        const addr = derivedAddresses[i];
        // Use sequential numbering starting from after existing wallets
        const walletName = shouldNumber 
          ? `${cleanBaseName} ${availableNumbers[i]}`
          : cleanBaseName;
        
        // Use accountIndex for derivation (not the sorted display index)
        // Also pass the derivation path if it differs from standard
        const derivationIndex = addr.accountIndex ?? addr.index;
        
        try {
          logger.log(`[ImportMultiple] Importing wallet ${i + 1}/${derivedAddresses.length}: ${walletName} (derivation index ${derivationIndex}, path: ${addr.path || 'standard'})`);
          await wallet.importWallet(mnemonic, walletName, password, derivationIndex);
          importedCount++;
          logger.log(`[ImportMultiple] Successfully imported: ${walletName}`);
          
          // Small delay between imports to ensure storage is synced
          if (i < derivedAddresses.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } catch (importErr) {
          // Skip if wallet already exists
          if (importErr.message?.includes('already been imported')) {
            logger.log(`[ImportMultiple] Skipping already imported wallet: ${walletName}`);
            skippedCount++;
            continue;
          }
          // Re-throw other errors
          throw importErr;
        }
      }
      
      logger.log(`[ImportMultiple] Complete: ${importedCount} imported, ${skippedCount} skipped`);
      
      // Cache password in session
      setSessionPassword(password);
      
      // Import always turns ON password protection
      storage.set('passwordProtection', true);
      setPasswordProtection(true);
      setHasPasswordAsync(true);
      localStorage.setItem('x1wallet_encrypted', 'true');
      
      storage.set('lastActivity', Date.now());
      
      // Refresh wallet balance after import
      if (wallet.refreshBalance) {
        logger.log('[ImportMultiple] Refreshing balance...');
        setTimeout(() => wallet.refreshBalance(), 500);
      }
      
      // Show result message if some were skipped
      if (skippedCount > 0 && importedCount === 0) {
        showAlert('All selected accounts were already imported.', 'Already Imported', 'info');
      } else if (skippedCount > 0) {
        showAlert(`Imported ${importedCount} account${importedCount > 1 ? 's' : ''}. ${skippedCount} already existed.`, 'Import Complete', 'info');
      }
      
      setScreen('main');
    } catch (err) {
      logger.error('Failed to import multiple wallets:', err);
      showAlert(err.message || 'Failed to import wallets', 'Import Failed', 'warning');
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
      
      // Clear tokens immediately for instant UI update (no stale data)
      setUserTokens([]);
      
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
      
      // Pass password directly to saveWallets (avoids React state timing issue)
      await wallet.saveWallets([...existingWallets, newWallet], password);
      wallet.selectWallet(newWallet.id);
      
      // Set up password hash if first time
      if (!effectivePasswordExists) {
        await setupPassword(password);
      }
      
      // Cache password in session for subsequent wallet creations
      setSessionPassword(password);
      
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

  // Handle watch-only wallet import
  const handleImportWatchOnly = async (walletData) => {
    try {
      // Watch-only wallets don't need password since there's nothing to encrypt
      // But if there are existing wallets with encryption, we need the password to add to encrypted storage
      
      // Check if wallet already exists
      const existingWallets = wallet.wallets || [];
      const existingMatch = existingWallets.find(w => 
        w.publicKey === walletData.publicKey || 
        w.addresses?.some(a => a.publicKey === walletData.publicKey)
      );
      if (existingMatch) {
        showAlert(`This address is already being watched as "${existingMatch.name}"`, 'Address Already Exists', 'warning');
        return;
      }
      
      // Clear tokens immediately for instant UI update
      setUserTokens([]);
      
      // Build the watch-only wallet object
      const newWallet = {
        id: Date.now().toString(),
        name: walletData.name || 'Watch Wallet',
        publicKey: walletData.publicKey,
        privateKey: null,  // No private key for watch-only
        mnemonic: null,    // No mnemonic
        type: 'watchonly',
        isWatchOnly: true,
        createdAt: new Date().toISOString(),
        addresses: [{
          index: 0,
          publicKey: walletData.publicKey,
          privateKey: null,
          name: 'Address 1'
        }],
        activeAddressIndex: 0
      };
      
      // For watch-only, we can use the session password if available
      // Or the password passed from the ImportWallet component
      const effectivePassword = walletData.password || sessionPassword || null;
      
      if (existingWallets.length > 0) {
        // If there are existing wallets, we need to use the existing password
        const isEncrypted = localStorage.getItem('x1wallet_encrypted') === 'true';
        if (isEncrypted && !effectivePassword) {
          // Show themed password prompt
          const { checkPassword } = await import('@x1-wallet/core/services/wallet');
          const enteredPassword = await promptPassword(
            'Enter Password',
            'Enter your wallet password to add this watch-only address.'
          );
          if (!enteredPassword) {
            showAlert('Password required to add wallet to encrypted storage', 'Password Required', 'warning');
            return;
          }
          const isValid = await checkPassword(enteredPassword);
          if (!isValid) {
            showAlert('Incorrect password', 'Invalid Password', 'error');
            return;
          }
          // Use the entered password
          await wallet.saveWallets([...existingWallets, newWallet], enteredPassword);
          setSessionPassword(enteredPassword); // Cache for future use
        } else {
          await wallet.saveWallets([...existingWallets, newWallet], effectivePassword);
        }
      } else {
        // First wallet - watch-only doesn't need encryption
        await wallet.saveWallets([newWallet], null);
      }
      
      wallet.selectWallet(newWallet.id);
      storage.set('lastActivity', Date.now());
      setScreen('main');
    } catch (err) {
      logger.error('Failed to add watch-only wallet:', err);
      showAlert('Failed to add watch-only wallet: ' + err.message, 'Add Failed', 'error');
    }
  };

  // Handle lock/reset
  // BUG FIX: Use lockWallet() to lock, NOT clearWallet() which wipes data!
  const handleLock = () => {
    wallet.lockWallet();
    setSessionPassword(null); // Clear session password on lock
    setIsLocked(true);
  };

  // Navigate to create from manager
  const handleManagerCreate = () => {
    setReturnScreen('main');
    setScreen('create');
  };

  // Navigate to import from manager
  const handleManagerImport = () => {
    setReturnScreen('main');
    setImportInitialType('phrase');
    setScreen('import');
  };

  // Navigate to watch-only import from manager
  const handleManagerWatchOnly = () => {
    setReturnScreen('main');
    setImportInitialType('watchonly');
    setScreen('import');
  };

  // Navigate to hardware wallet from manager
  const handleManagerHardware = () => {
    // Check if we're in extension popup
    const isExtensionPopup = typeof chrome !== 'undefined' && 
                             chrome.runtime && 
                             chrome.runtime.id &&
                             window.innerWidth < 500;
    
    if (isExtensionPopup) {
      // Open in full tab for better HID support
      const extensionUrl = chrome.runtime.getURL('index.html');
      chrome.tabs.create({ url: extensionUrl + '?hw=1' });
      window.close();
    } else {
      setReturnScreen('main');
      setScreen('hardware');
    }
  };

  // Track hardware wallet import in progress to prevent double-calls
  const [hwImportInProgress, setHwImportInProgress] = useState(false);

  // Handle hardware wallet complete
  const handleHardwareComplete = async (hwWalletOrArray) => {
    // Prevent double-execution
    if (hwImportInProgress) {
      logger.warn('[App] Hardware wallet import already in progress, ignoring duplicate call');
      return;
    }
    
    setHwImportInProgress(true);
    
    try {
      let passwordUsed = null;
      
      // Handle array of wallets (multi-select)
      if (Array.isArray(hwWalletOrArray)) {
        // Extract password from first wallet (if this is first wallet setup)
        if (hwWalletOrArray.length > 0 && hwWalletOrArray[0].password) {
          passwordUsed = hwWalletOrArray[0].password;
        }
        
        for (let i = 0; i < hwWalletOrArray.length; i++) {
          const { password, ...walletData } = hwWalletOrArray[i];
          // Pass password to ALL wallets - they need it to decrypt localStorage for duplicate check
          await wallet.addHardwareWallet(walletData, passwordUsed);
        }
      } else {
        // Single wallet
        const { password, ...walletData } = hwWalletOrArray;
        passwordUsed = password;
        await wallet.addHardwareWallet(walletData, password);
      }
      
      // If password was provided (first wallet setup), set up password hash and protection flags
      if (passwordUsed) {
        const { setupPassword, hasPassword: checkHasPassword } = await import('@x1-wallet/core/services/wallet');
        const passwordExists = await checkHasPassword();
        
        if (!passwordExists) {
          await setupPassword(passwordUsed);
        }
        
        // Set password protection flags
        storage.set('passwordProtection', true);
        setPasswordProtection(true);
        setHasPasswordAsync(true);
        localStorage.setItem('x1wallet_encrypted', 'true');
      }
      
      storage.set('lastActivity', Date.now());
      
      // If we're in a full tab (hw=1 param), show success screen
      const urlParams = new URLSearchParams(window.location.search);
      const isFullTab = urlParams.get('hw') === '1' && window.innerWidth >= 500;
      
      if (isFullTab) {
        setScreen('hardware-success');
      } else {
        setScreen('main');
      }
    } catch (err) {
      logger.error('Failed to add hardware wallet:', err);
      showAlert(err.message || 'Failed to add hardware wallet', 'Error', 'warning');
    } finally {
      setHwImportInProgress(false);
    }
  };

  // Loading screen
  if (screen === 'loading' || wallet.loading) {
    return (
      <div className="app loading" style={{ background: '#0a0a0a', minHeight: '100vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  // DApp request with lock: when there's a pending dApp request AND the wallet is locked,
  // show a single combined lock screen that satisfies both auto-lock AND reauth.
  // This prevents the user from having to enter their password twice and avoids
  // the request timing out in the background while the user is authenticating.
  if (hasDAppRequest && isLocked && screen !== 'welcome') {
    return (
      <div className="app">
        <LockScreen
          onUnlock={(password) => {
            // Single password entry satisfies both auto-lock AND dApp reauth
            setDappRequiresReauth(false);
            handleUnlock(password);
          }}
          walletUnlock={wallet.isEncrypted ? wallet.unlockWallet : null}
          title="Authentication Required"
          subtitle="Enter your password to approve this transaction"
        />
      </div>
    );
  }

  // Lock screen (normal, no pending dApp request)
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
          onHardwareWallet={() => {
            // In full tab mode, proceed directly
            // (Popup mode is handled inside WelcomeScreen itself)
            setReturnScreen('welcome'); 
            setScreen('hardware');
          }}
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
          sessionPassword={sessionPassword}
          existingWallets={wallet.wallets || []}
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
        {passwordPrompt.show ? (
          <PasswordPromptModal
            title={passwordPrompt.title}
            message={passwordPrompt.message}
            onSubmit={handlePasswordSubmit}
            onCancel={handlePasswordCancel}
          />
        ) : (
          <ImportWallet
            onComplete={handleImportComplete}
            onCompleteMultiple={handleImportMultiple}
            onCompletePrivateKey={handleImportPrivateKey}
            onCompleteWatchOnly={handleImportWatchOnly}
            onBack={() => { setImportInitialType('phrase'); setScreen(returnScreen === 'manage' ? 'manage' : 'welcome'); }}
            sessionPassword={sessionPassword}
            existingWallets={wallet.wallets || []}
            initialImportType={importInitialType}
          />
        )}
      </div>
    );
  }

  // Hardware wallet flow
  if (screen === 'hardware') {
    // Check if we're in full tab mode (hw=1 parameter present and wide window)
    const isFullTab = window.innerWidth >= 500;
    
    // Full tab mode - centered card like Phantom
    if (isFullTab) {
      return (
        <div className="hardware-fullpage">
          <div className="hardware-fullpage-bg" />
          <div className="hardware-fullpage-logo">
            <img src="/icons/128-x1.png" alt="X1" />
          </div>
          <div className="hardware-fullpage-card">
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
              onBack={() => {
                // In full tab, go back to welcome or close tab
                if (wallet.wallets && wallet.wallets.length > 0) {
                  setScreen('main');
                } else {
                  setScreen('welcome');
                }
              }}
              isFirstWallet={!wallet.wallets || wallet.wallets.length === 0}
              existingWallets={wallet.wallets || []}
              network={wallet.network}
              isFullTab={true}
            />
          </div>
        </div>
      );
    }
    
    // Popup mode (shouldn't normally happen, but fallback)
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
          isFirstWallet={!wallet.wallets || wallet.wallets.length === 0}
          existingWallets={wallet.wallets || []}
          network={wallet.network}
        />
      </div>
    );
  }

  // Hardware wallet success screen (full tab only)
  if (screen === 'hardware-success') {
    return (
      <div className="hardware-fullpage">
        <div className="hardware-fullpage-bg" />
        <div className="hardware-fullpage-logo">
          <img src="/icons/128-x1.png" alt="X1" />
        </div>
        <div className="hardware-fullpage-card" style={{ textAlign: 'center', padding: '48px 32px' }}>
          {/* Success checkmark */}
          <div style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: 'rgba(34, 197, 94, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 24px'
          }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="3">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          
          <h2 style={{ marginBottom: 12, fontSize: 24 }}>Wallet Imported!</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: 32, fontSize: 15, lineHeight: 1.5 }}>
            Your hardware wallet has been successfully connected. Click the X1 Wallet extension icon in your browser toolbar to access your wallet.
          </p>
          
          {/* Extension icon hint */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: '16px 20px',
            background: 'var(--bg-secondary)',
            borderRadius: 12,
            marginBottom: 32
          }}>
            <img src="/icons/128-x1.png" alt="X1" style={{ width: 40, height: 40, objectFit: 'contain' }} />
            <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
              Click the extension icon to open your wallet
            </span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
              <path d="M7 17L17 7M17 7H7M17 7V17" />
            </svg>
          </div>
          
          <button 
            className="btn-secondary"
            onClick={() => {
              // Close the tab
              if (typeof chrome !== 'undefined' && chrome.tabs) {
                chrome.tabs.getCurrent((tab) => {
                  if (tab?.id) {
                    chrome.tabs.remove(tab.id);
                  }
                });
              } else {
                window.close();
              }
            }}
            style={{ width: '100%', height: 48 }}
          >
            Close This Tab
          </button>
        </div>
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
          onSwap={(token) => { setSelectedToken(token); setScreen('swap'); }}
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
          onSwapComplete={(updatedTokens) => {
            // Apply optimistic token updates immediately if provided
            if (updatedTokens && updatedTokens.length > 0) {
              setUserTokens(updatedTokens);
            }
            triggerActivityRefresh();
            triggerBalanceRefresh();
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
          userTokens={userTokens}
          onBack={(action) => {
            setScreen('main');
            if (action === 'network') {
              sessionStorage.setItem('openNetworkPanel', 'true');
            }
          }}
          onNetworkSwitch={(targetNetwork) => {
            wallet.setNetwork(targetNetwork);
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
        logo: '/icons/48-x1.png',
        desc: 'Layer-1 Blockchain' 
      },
      { 
        name: 'XDEX', 
        url: 'https://xdex.xyz', 
        logo: '/icons/48-xdex.png',
        desc: 'X1 Native DEX' 
      },
      { 
        name: 'Degen', 
        url: 'https://degen.fyi', 
        logo: '/icons/48-degen.png',
        desc: 'Launchpad' 
      },
      { 
        name: 'CORE', 
        url: 'https://core.x1.xyz', 
        logo: '/icons/48-core.png',
        desc: 'Staking & Rewards' 
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
  // X1W-SEC: If reauth is required, show password screen first
  if (hasDAppRequest && wallet.wallet) {
    if (dappRequiresReauth) {
      // Show lock screen to verify password before allowing signing
      return (
        <div className="app">
          <LockScreen 
            onUnlock={(password) => {
              // Password verified, clear reauth requirement and proceed to approval
              setDappRequiresReauth(false);
              handleUnlock(password);
            }} 
            walletUnlock={wallet.isEncrypted ? wallet.unlockWallet : null}
            title="Re-authentication Required"
            subtitle="Enter your password to approve this transaction"
          />
        </div>
      );
    }
    
    return (
      <div className="app">
        <DAppApproval 
          wallet={wallet} 
          requestId={currentRequestId}  // X1W-SEC: Pass request ID for proper routing
          onComplete={() => {
            // Check if a new request arrived while processing the current one
            // The ref will be updated by the port message handler before this callback fires
            const completedId = currentRequestId;
            
            // Small delay to allow port message to arrive and update state
            setTimeout(() => {
              // Only clear state if no new request has arrived
              // If pendingRequestRef has a different ID, a new request came in
              if (pendingRequestRef.current === completedId || pendingRequestRef.current === null) {
                logger.log('[App] DApp request completed, no more pending requests');
                setHasDAppRequest(false);
                setCurrentRequestId(null);
                pendingRequestRef.current = null;
              } else {
                logger.log('[App] New pending request detected:', pendingRequestRef.current, '- keeping approval screen open');
                // State already updated by port message handler, just reset reauth flag
                setDappRequiresReauth(false);
              }
            }, 100);  // 100ms delay to allow port message to be processed
          }} 
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
      {passwordPrompt.show && (
        <PasswordPromptModal
          title={passwordPrompt.title}
          message={passwordPrompt.message}
          onSubmit={handlePasswordSubmit}
          onCancel={handlePasswordCancel}
        />
      )}
      <WalletMain
        key={`${wallet.wallet?.publicKey}-${wallet.network}`}
        wallet={wallet}
        userTokens={userTokens}
        onTokensUpdate={setUserTokens}
        onWalletSwitch={() => setUserTokens([])}
        onSend={(token) => { setSelectedToken(token || null); setScreen('send'); }}
        onReceive={() => setScreen('receive')}
        onSwap={(token) => { setSelectedToken(token || null); setScreen('swap'); }}
        onBridge={() => setScreen('bridge')}
        onStake={() => { logger.log('[App] Setting screen to stake'); setScreen('stake'); }}
        onSettings={() => setScreen('settings')}
        onCreateWallet={handleManagerCreate}
        onImportWallet={handleManagerImport}
        onHardwareWallet={handleManagerHardware}
        onWatchOnly={handleManagerWatchOnly}
        activityRefreshKey={activityRefreshKey}
        balanceRefreshKey={balanceRefreshKey}
        onTokenClick={(token) => { setSelectedToken(token); setScreen('tokenDetail'); }}
      />
      <BottomNav />
    </div>
  );
}

// Wrap App with ErrorBoundary to prevent black screen on errors
function AppWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

export default AppWithErrorBoundary;