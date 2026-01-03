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
  set: (key, value) => localStorage.setItem(`x1wallet_${key}`, JSON.stringify(value))
};

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
      
      // Fallback to legacy password check
      const storedHash = storage.get('passwordHash', null);
      const inputHash = btoa(password);
      
      if (storedHash === inputHash) {
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
  const wallet = useWallet();
  const [screen, setScreen] = useState('loading');
  const [returnScreen, setReturnScreen] = useState('main');
  const [isLocked, setIsLocked] = useState(false);
  const [initialCheckDone, setInitialCheckDone] = useState(false);
  const [selectedToken, setSelectedToken] = useState(null);
  const [activityRefreshKey, setActivityRefreshKey] = useState(0);
  const [balanceRefreshKey, setBalanceRefreshKey] = useState(0);
  const [userTokens, setUserTokens] = useState([]);
  const [hasDAppRequest, setHasDAppRequest] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const lockTimerRef = useRef(null);
  
  // Function to trigger activity refresh
  const triggerActivityRefresh = useCallback(() => {
    setActivityRefreshKey(prev => prev + 1);
  }, []);
  
  // Function to trigger balance refresh
  const triggerBalanceRefresh = useCallback(() => {
    setBalanceRefreshKey(prev => prev + 1);
  }, []);

  // Check for pending dApp requests
  useEffect(() => {
    const checkDAppRequest = async () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          const response = await chrome.runtime.sendMessage({ type: 'get-pending-request' });
          setHasDAppRequest(response && response.type ? true : false);
        }
      } catch (err) {
        setHasDAppRequest(false);
      }
    };
    
    checkDAppRequest();
    const interval = setInterval(checkDAppRequest, 500);
    return () => clearInterval(interval);
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
  const passwordProtection = storage.get('passwordProtection', false);
  const hasPassword = storage.get('passwordHash', null) !== null;
  const autoLockMinutes = storage.get('autoLock', 5);

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
      const elapsed = (Date.now() - lastActivityRef.current) / 1000 / 60;
      if (elapsed >= autoLockMinutes && !isLocked && screen !== 'welcome' && screen !== 'loading') {
        setIsLocked(true);
      }
    };

    lockTimerRef.current = setInterval(checkLock, 10000); // Check every 10 seconds

    // Activity listeners
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach(e => window.addEventListener(e, updateActivity));

    return () => {
      if (lockTimerRef.current) clearInterval(lockTimerRef.current);
      events.forEach(e => window.removeEventListener(e, updateActivity));
    };
  }, [passwordProtection, hasPassword, autoLockMinutes, isLocked, screen, updateActivity]);

  // Check for existing wallet on mount - only run ONCE
  useEffect(() => {
    if (wallet.loading || initialCheckDone) return;
    
    const checkWallet = async () => {
      await new Promise(r => setTimeout(r, 500));
      
      // Check URL params for hardware wallet redirect
      const urlParams = new URLSearchParams(window.location.search);
      const hwParam = urlParams.get('hw');
      
      if (wallet.wallets.length > 0) {
        // Check if should be locked on open based on ACTUAL elapsed time
        if (passwordProtection && hasPassword) {
          // Get last activity from persistent storage
          const lastActivity = storage.get('lastActivity', 0);
          const elapsedMinutes = (Date.now() - lastActivity) / 1000 / 60;
          
          // Only lock if auto-lock timeout has actually elapsed
          // Or if no activity recorded yet (first time setup)
          if (lastActivity === 0 || (autoLockMinutes !== -1 && elapsedMinutes >= autoLockMinutes)) {
            setIsLocked(true);
          } else {
            // Restore the last activity time to the ref
            lastActivityRef.current = lastActivity;
          }
        }
        
        // If hw=1 param, go to hardware wallet screen
        if (hwParam === '1') {
          setReturnScreen('main');
          setScreen('hardware');
        } else {
          setScreen('main');
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
  }, [wallet.loading, initialCheckDone]);

  // Handle unlock - supports both legacy password and encrypted wallet
  const handleUnlock = async (password) => {
    setIsLocked(false);
    const now = Date.now();
    lastActivityRef.current = now;
    storage.set('lastActivity', now); // Persist unlock time
  };

  // Handle wallet creation
  const handleCreateComplete = async (mnemonic, name) => {
    try {
      await wallet.createWallet(mnemonic, name);
      setScreen('main');
    } catch (err) {
      logger.error('Failed to create wallet:', err);
    }
  };

  // Handle wallet import
  const handleImportComplete = async (mnemonic, name) => {
    try {
      await wallet.importWallet(mnemonic, name);
      setScreen('main');
    } catch (err) {
      logger.error('Failed to import wallet:', err);
    }
  };

  // Handle private key import
  const handleImportPrivateKey = async (walletData) => {
    try {
      // Add wallet directly with private key data
      const newWallet = {
        id: Date.now().toString(),
        name: walletData.name || 'Imported Wallet',
        publicKey: walletData.publicKey,
        privateKey: walletData.privateKey,
        mnemonic: null, // No mnemonic for private key imports
        type: 'imported',
        createdAt: new Date().toISOString()
      };
      
      // Get existing wallets
      const existingWallets = JSON.parse(localStorage.getItem('x1wallet_wallets') || '[]');
      
      // Check if already exists
      if (existingWallets.some(w => w.publicKey === newWallet.publicKey)) {
        alert('This wallet is already imported');
        return;
      }
      
      existingWallets.push(newWallet);
      localStorage.setItem('x1wallet_wallets', JSON.stringify(existingWallets));
      localStorage.setItem('x1wallet_active', newWallet.id);
      
      // Refresh wallet state
      await wallet.loadWallets();
      wallet.selectWallet(newWallet.id);
      
      setScreen('main');
    } catch (err) {
      logger.error('Failed to import private key wallet:', err);
      alert('Failed to import wallet: ' + err.message);
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
          onBack={wallet.wallets?.length > 0 ? () => setScreen('main') : null}
        />
      </div>
    );
  }

  // Create wallet flow
  if (screen === 'create') {
    return (
      <div className="app">
        <CreateWallet
          onComplete={handleCreateComplete}
          onBack={() => setScreen(returnScreen === 'manage' ? 'manage' : 'welcome')}
        />
      </div>
    );
  }

  // Import wallet flow
  if (screen === 'import') {
    return (
      <div className="app">
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
          wallet={wallet}
          onBack={() => setScreen('main')}
          onLock={handleLock}
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
  return (
    <div className="app">
      {hasDAppRequest && wallet.wallet && (
        <DAppApproval 
          wallet={wallet} 
          onComplete={() => setHasDAppRequest(false)} 
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