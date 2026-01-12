// Wallet Hook with Multi-Address Support and Encrypted Storage
import { logger } from '../utils/logger.js';
import { useState, useEffect, useCallback } from 'react';
import { mnemonicToKeypair, SOLANA_PATH } from '../utils/bip44';
import { encodeBase58 } from '../utils/base58';
import { NETWORKS, DEFAULT_NETWORK } from '../services/networks';
import { encryptData, decryptData, isEncrypted } from '../utils/encryption';

const STORAGE_KEY = 'x1wallet_wallets';
const ACTIVE_KEY = 'x1wallet_active';
const NETWORK_KEY = 'x1wallet_network';
const CUSTOM_NETWORKS_KEY = 'x1wallet_customRpcs';
const ENCRYPTION_ENABLED_KEY = 'x1wallet_encrypted';

// Helper to get network config (built-in or custom)
function getNetworkConfig(networkName) {
  // First check built-in networks
  if (NETWORKS[networkName]) {
    return NETWORKS[networkName];
  }
  
  // Then check custom networks
  try {
    const customNetworks = JSON.parse(localStorage.getItem(CUSTOM_NETWORKS_KEY) || '[]');
    const customNet = customNetworks.find(n => n.name === networkName);
    if (customNet) {
      return {
        name: customNet.name,
        providerId: `custom-${customNet.id || Date.now()}`,
        rpcUrl: customNet.url,
        symbol: customNet.symbol || 'TOKEN',
        decimals: parseInt(customNet.decimals) || 9,
        explorer: customNet.explorer || '',
        explorerTx: customNet.explorer ? `${customNet.explorer.replace(/\/$/, '')}/tx` : '',
        explorerToken: customNet.explorer ? `${customNet.explorer.replace(/\/$/, '')}/token` : '',
        isCustom: true,
        isSVM: true // Assume SVM compatible
      };
    }
  } catch (e) {
    logger.warn('Failed to load custom networks:', e);
  }
  
  // Return default network config if nothing found
  return NETWORKS[DEFAULT_NETWORK];
}

export function useWallet() {
  const [wallets, setWallets] = useState([]);
  const [activeWalletId, setActiveWalletId] = useState(null);
  const [network, setNetworkState] = useState(DEFAULT_NETWORK);
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [encryptionPassword, setEncryptionPassword] = useState(null);

  // Check if wallet storage is encrypted
  const isStorageEncrypted = useCallback(() => {
    return localStorage.getItem(ENCRYPTION_ENABLED_KEY) === 'true';
  }, []);

  // Migrate old wallet format to new multi-address format
  const migrateWallet = (wallet) => {
    // Already new format
    if (wallet.addresses && Array.isArray(wallet.addresses)) {
      return wallet;
    }
    
    // Old format - convert to new format
    return {
      id: wallet.id,
      name: wallet.name,
      mnemonic: wallet.mnemonic,
      type: wallet.type || 'local',
      createdAt: wallet.createdAt,
      isHardware: wallet.isHardware || false,
      derivationPath: wallet.derivationPath,
      addresses: [{
        index: 0,
        publicKey: wallet.publicKey,
        privateKey: wallet.privateKey,
        name: 'Address 1'
      }],
      activeAddressIndex: 0
    };
  };

  // Load wallets from storage (encrypted or plain)
  const loadWalletsFromStorage = useCallback(async (password = null) => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return [];

      // Check if data is encrypted
      if (isEncrypted(saved)) {
        if (!password) {
          // Data is encrypted but no password provided - wallet is locked
          setIsLocked(true);
          return [];
        }
        try {
          const decrypted = await decryptData(saved, password);
          const parsed = JSON.parse(decrypted);
          setIsLocked(false);
          setEncryptionPassword(password);
          return parsed.map(migrateWallet);
        } catch (e) {
          logger.error('Failed to decrypt wallets:', e.message);
          throw new Error('Incorrect password');
        }
      } else {
        // Plain JSON (legacy or unencrypted)
        const parsed = JSON.parse(saved);
        setIsLocked(false);
        return parsed.map(migrateWallet);
      }
    } catch (e) {
      if (e.message === 'Incorrect password') throw e;
      logger.error('Failed to load wallets:', e);
      return [];
    }
  }, []);

  // Save wallets to storage (encrypted if password is set)
  // SEC-FIX: Encryption is now MANDATORY - no unencrypted save path
  // SAFETY: Added guards against accidental data loss
  const saveWalletsToStorage = useCallback(async (walletsToSave) => {
    // SAFETY GUARD 1: Never save empty array if we have existing data
    const existingData = localStorage.getItem(STORAGE_KEY);
    if ((!walletsToSave || walletsToSave.length === 0) && existingData && existingData.length > 10) {
      logger.warn('[useWallet] BLOCKED: Attempted to save empty wallets over existing data');
      throw new Error('Cannot overwrite existing wallet data with empty array');
    }
    
    // SAFETY GUARD 2: Require encryption password
    if (!encryptionPassword) {
      // If we have existing encrypted data, don't allow save without password
      if (existingData && isEncrypted(existingData)) {
        logger.warn('[useWallet] Cannot save: wallet is locked, unlock first');
        throw new Error('Wallet is locked. Please unlock before making changes.');
      }
      // If no existing data and no password, this is a new wallet without encryption
      // This is now blocked - encryption is mandatory
      throw new Error('Cannot save wallet: encryption password not set. Please set a password first.');
    }
    
    try {
      const jsonData = JSON.stringify(walletsToSave);
      
      // Encrypt and save
      const encrypted = await encryptData(jsonData, encryptionPassword);
      localStorage.setItem(STORAGE_KEY, encrypted);
      localStorage.setItem(ENCRYPTION_ENABLED_KEY, 'true');
      
      // ALWAYS update session storage when saving encrypted wallets
      // This prevents stale data issues when extension reloads
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
        try {
          await chrome.storage.session.set({
            x1wallet_session_wallets: jsonData,
            x1wallet_session_password: encryptionPassword
          });
          console.log('[useWallet] Session storage synced with', walletsToSave.length, 'wallets');
        } catch (e) {
          console.warn('[useWallet] Failed to sync session storage:', e.message);
        }
      }
    } catch (e) {
      logger.error('Failed to save wallets:', e);
      throw e;
    }
  }, [encryptionPassword]);

  // SEC-FIX: saveWalletsUnencrypted has been REMOVED
  // Encryption is mandatory - wallets must always be encrypted at rest
  // This matches Phantom and Backpack security model

  // Initial load
  useEffect(() => {
    const loadWallets = async () => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        const activeId = localStorage.getItem(ACTIVE_KEY);
        const savedNetwork = localStorage.getItem(NETWORK_KEY);
        
        console.log('[useWallet] Loading - saved data length:', saved?.length, 'first 50 chars:', saved?.substring(0, 50));
        
        // For encrypted wallets, check session storage first (allows auto-lock timer to work)
        if (saved && isEncrypted(saved)) {
          console.log('[useWallet] Data is encrypted - checking session storage...');
          
          // Try to load from session storage (previous unlock in same browser session)
          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
            try {
              const sessionData = await chrome.storage.session.get(['x1wallet_session_wallets', 'x1wallet_session_password']);
              if (sessionData.x1wallet_session_wallets && sessionData.x1wallet_session_password) {
                console.log('[useWallet] Found session data - loading from session');
                const sessionWallets = JSON.parse(sessionData.x1wallet_session_wallets);
                const migrated = sessionWallets.map(migrateWallet);
                setWallets(migrated);
                setActiveWalletId(activeId || (migrated.length > 0 ? migrated[0].id : null));
                setEncryptionPassword(sessionData.x1wallet_session_password);
                setIsLocked(false);
                console.log('[useWallet] Loaded', migrated.length, 'wallets from session');
              } else {
                console.log('[useWallet] No session data - need password');
                setIsLocked(true);
              }
            } catch (sessionErr) {
              console.log('[useWallet] Session storage error:', sessionErr.message);
              setIsLocked(true);
            }
          } else {
            console.log('[useWallet] No session storage available - need password');
            setIsLocked(true);
          }
        } else if (saved) {
          // Plain JSON - load directly
          console.log('[useWallet] Data is plain JSON - parsing...');
          const parsed = JSON.parse(saved);
          const migrated = parsed.map(migrateWallet);
          console.log('[useWallet] Loaded', migrated.length, 'wallets');
          setWallets(migrated);
          setActiveWalletId(activeId || (migrated.length > 0 ? migrated[0].id : null));
        } else {
          console.log('[useWallet] No saved data found');
        }
        
        if (savedNetwork) {
          setNetworkState(savedNetwork);
          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ [NETWORK_KEY]: savedNetwork });
          }
        } else {
          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ [NETWORK_KEY]: DEFAULT_NETWORK });
          }
        }
      } catch (e) {
        console.error('[useWallet] Failed to load wallets:', e);
        logger.error('Failed to load wallets:', e);
      }
      setLoading(false);
    };
    
    loadWallets();
  }, []);

  // Unlock wallet with password
  const unlockWallet = useCallback(async (password) => {
    if (!password) throw new Error('Password is required');
    
    const loadedWallets = await loadWalletsFromStorage(password);
    setWallets(loadedWallets);
    
    const activeId = localStorage.getItem(ACTIVE_KEY);
    setActiveWalletId(activeId || (loadedWallets.length > 0 ? loadedWallets[0].id : null));
    
    // Save to session storage for auto-lock timer to work
    // Session storage clears when browser closes - secure enough for this use case
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
      try {
        await chrome.storage.session.set({
          x1wallet_session_wallets: JSON.stringify(loadedWallets),
          x1wallet_session_password: password
        });
        console.log('[useWallet] Saved to session storage for auto-lock');
      } catch (e) {
        console.warn('[useWallet] Failed to save to session storage:', e.message);
      }
    }
    
    return true;
  }, [loadWalletsFromStorage]);

  // Lock wallet (clear in-memory data)
  const lockWallet = useCallback(() => {
    setWallets([]);
    setEncryptionPassword(null);
    setIsLocked(true);
    setBalance(0);
    
    // Clear session storage
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
      chrome.storage.session.remove(['x1wallet_session_wallets', 'x1wallet_session_password'])
        .catch(e => console.warn('[useWallet] Failed to clear session:', e.message));
    }
  }, []);

  // Enable encryption on existing wallet
  // X1W-SEC-008 FIX: Standardized to 12 char minimum
  const enableEncryption = useCallback(async (password) => {
    if (!password || password.length < 12) {
      throw new Error('Password must be at least 12 characters');
    }
    
    // Set the encryption password for future saves
    setEncryptionPassword(password);
    localStorage.setItem(ENCRYPTION_ENABLED_KEY, 'true');
    
    // Only save if there are existing wallets to encrypt
    // For new imports, the wallet will be saved encrypted when created
    if (wallets.length > 0) {
      const jsonData = JSON.stringify(wallets);
      const encrypted = await encryptData(jsonData, password);
      localStorage.setItem(STORAGE_KEY, encrypted);
      
      // Also update session storage so wallet doesn't disappear
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
        try {
          await chrome.storage.session.set({
            x1wallet_session_wallets: jsonData,
            x1wallet_session_password: password
          });
        } catch (e) {
          console.warn('[useWallet] Failed to update session storage:', e.message);
        }
      }
    }
    
    return true;
  }, [wallets]);

  // Set encryption password without re-encrypting existing wallets
  // Use this when importing a new wallet to avoid corrupting existing data if import fails
  const setEncryptionPasswordOnly = useCallback((password) => {
    if (!password || password.length < 12) {
      throw new Error('Password must be at least 12 characters');
    }
    setEncryptionPassword(password);
    localStorage.setItem(ENCRYPTION_ENABLED_KEY, 'true');
  }, []);

  // SEC-FIX: clearEncryptionPassword - just log warning, don't throw
  // Throwing here causes cascade failures in App component effects
  // Encryption remains mandatory via saveWalletsToStorage guard
  const clearEncryptionPassword = useCallback(() => {
    logger.warn('[useWallet] clearEncryptionPassword called but encryption is mandatory - ignoring');
    // Don't actually clear anything - encryption is mandatory
    // The saveWalletsToStorage guard prevents unencrypted saves
  }, []);

  // Change encryption password
  // X1W-SEC-008 FIX: Standardized to 12 char minimum
  const changePassword = useCallback(async (currentPassword, newPassword) => {
    if (!newPassword || newPassword.length < 12) {
      throw new Error('New password must be at least 12 characters');
    }
    
    // Verify current password by trying to decrypt
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isEncrypted(saved)) {
      try {
        await decryptData(saved, currentPassword);
      } catch {
        throw new Error('Current password is incorrect');
      }
    }
    
    // Re-encrypt with new password
    setEncryptionPassword(newPassword);
    const jsonData = JSON.stringify(wallets);
    const encrypted = await encryptData(jsonData, newPassword);
    localStorage.setItem(STORAGE_KEY, encrypted);
    
    // Also update session storage with new password
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
      try {
        await chrome.storage.session.set({
          x1wallet_session_wallets: jsonData,
          x1wallet_session_password: newPassword
        });
      } catch (e) {
        console.warn('[useWallet] Failed to update session storage:', e.message);
      }
    }
    
    return true;
  }, [wallets]);

  // X1W-SEC-003 FIX: disableEncryption removed for security
  // Encryption is now mandatory and cannot be disabled
  // Private keys and mnemonics must always be encrypted at rest
  const disableEncryption = useCallback(async () => {
    throw new Error('Encryption cannot be disabled. Your wallet data must remain encrypted for security.');
  }, []);

  // Save wallets to storage (session storage is updated automatically by saveWalletsToStorage)
  const saveWallets = useCallback(async (newWallets) => {
    await saveWalletsToStorage(newWallets);
    setWallets(newWallets);
  }, [saveWalletsToStorage]);

  // Load wallets (for external refresh)
  const loadWallets = useCallback(async () => {
    try {
      const loadedWallets = await loadWalletsFromStorage(encryptionPassword);
      setWallets(loadedWallets);
    } catch (e) {
      logger.error('Failed to reload wallets:', e);
    }
  }, [loadWalletsFromStorage, encryptionPassword]);

  // Get active wallet
  const activeWallet = wallets.find(w => w.id === activeWalletId) || wallets[0] || null;
  
  // Get active address from active wallet
  const getActiveAddress = useCallback((wallet) => {
    if (!wallet || !wallet.addresses || wallet.addresses.length === 0) return null;
    const idx = wallet.activeAddressIndex || 0;
    return wallet.addresses[idx] || wallet.addresses[0];
  }, []);
  
  const activeAddress = activeWallet ? getActiveAddress(activeWallet) : null;

  // Create new wallet from mnemonic
  const createWallet = useCallback(async (mnemonic, name = null) => {
    // SEC-FIX: Require encryption password before creating wallet
    // This ensures wallet data is never saved unencrypted
    if (!encryptionPassword) {
      throw new Error('Please set a password before creating a wallet. Your wallet data must be encrypted.');
    }
    
    try {
      const keypair = await mnemonicToKeypair(mnemonic, 0);
      const publicKey = encodeBase58(keypair.publicKey);
      const privateKey = encodeBase58(keypair.secretKey);
      
      // Check current storage state directly (not just React state which may be stale)
      let currentWallets = wallets;
      const savedData = localStorage.getItem(STORAGE_KEY);
      if (!savedData || savedData === '[]' || savedData === 'null') {
        // Storage is empty - fresh start
        currentWallets = [];
      }
      
      // Check if this wallet already exists (same public key)
      if (currentWallets.length > 0) {
        const existingWallet = currentWallets.find(w => 
          w.addresses?.some(a => a.publicKey === publicKey)
        );
        if (existingWallet) {
          throw new Error('This wallet has already been imported');
        }
      }
      
      const walletName = name || 'My Wallet';
      const newWallet = {
        id: Date.now().toString(),
        name: walletName,
        mnemonic,
        type: 'local',
        createdAt: new Date().toISOString(),
        addresses: [{
          index: 0,
          publicKey,
          privateKey,
          name: 'Address 1'
        }],
        activeAddressIndex: 0
      };
      
      const newWallets = [...currentWallets, newWallet];
      await saveWallets(newWallets);
      setActiveWalletId(newWallet.id);
      localStorage.setItem(ACTIVE_KEY, newWallet.id);
      
      return newWallet;
    } catch (e) {
      logger.error('Failed to create wallet:', e);
      throw e;
    }
  }, [wallets, saveWallets]);

  // Import wallet
  const importWallet = useCallback(async (mnemonic, name = null) => {
    return createWallet(mnemonic, name);
  }, [createWallet]);

  // Add new address to existing wallet
  const addAddress = useCallback(async (walletId, addressName = null) => {
    const wallet = wallets.find(w => w.id === walletId);
    if (!wallet || !wallet.mnemonic) {
      throw new Error('Cannot add address to this wallet (no mnemonic)');
    }
    
    const existingIndices = wallet.addresses.map(a => a.index);
    let newIndex = 0;
    while (existingIndices.includes(newIndex)) {
      newIndex++;
    }
    
    try {
      const keypair = await mnemonicToKeypair(wallet.mnemonic, newIndex);
      const publicKey = encodeBase58(keypair.publicKey);
      const privateKey = encodeBase58(keypair.secretKey);
      
      const newAddress = {
        index: newIndex,
        publicKey,
        privateKey,
        name: addressName || `Address ${wallet.addresses.length + 1}`
      };
      
      const newWallets = wallets.map(w => {
        if (w.id === walletId) {
          return {
            ...w,
            addresses: [...w.addresses, newAddress],
            activeAddressIndex: w.addresses.length
          };
        }
        return w;
      });
      
      await saveWallets(newWallets);
      return newAddress;
    } catch (e) {
      logger.error('Failed to add address:', e);
      throw e;
    }
  }, [wallets, saveWallets]);

  // Remove address from wallet
  const removeAddress = useCallback(async (walletId, addressIndex) => {
    const wallet = wallets.find(w => w.id === walletId);
    if (!wallet) return;
    
    if (wallet.addresses.length <= 1) {
      throw new Error('Cannot remove the last address');
    }
    
    const newWallets = wallets.map(w => {
      if (w.id === walletId) {
        const newAddresses = w.addresses.filter(a => a.index !== addressIndex);
        let newActiveIndex = w.activeAddressIndex;
        if (w.activeAddressIndex >= newAddresses.length) {
          newActiveIndex = newAddresses.length - 1;
        }
        return {
          ...w,
          addresses: newAddresses,
          activeAddressIndex: newActiveIndex
        };
      }
      return w;
    });
    
    await saveWallets(newWallets);
  }, [wallets, saveWallets]);

  // Switch active address within a wallet
  const switchAddress = useCallback(async (walletId, addressIndex) => {
    const newWallets = wallets.map(w => {
      if (w.id === walletId) {
        const idx = w.addresses.findIndex(a => a.index === addressIndex);
        if (idx !== -1) {
          return { ...w, activeAddressIndex: idx };
        }
      }
      return w;
    });
    await saveWallets(newWallets);
  }, [wallets, saveWallets]);

  // Rename an address
  const renameAddress = useCallback(async (walletId, addressIndex, newName) => {
    const newWallets = wallets.map(w => {
      if (w.id === walletId) {
        return {
          ...w,
          addresses: w.addresses.map(a => 
            a.index === addressIndex ? { ...a, name: newName } : a
          )
        };
      }
      return w;
    });
    await saveWallets(newWallets);
  }, [wallets, saveWallets]);

  // Add hardware wallet
  const addHardwareWallet = useCallback(async (walletDataOrPublicKey) => {
    // Support both object format and legacy (publicKey, name, derivationPath) format
    const isObject = typeof walletDataOrPublicKey === 'object' && walletDataOrPublicKey.publicKey;
    const publicKey = isObject ? walletDataOrPublicKey.publicKey : walletDataOrPublicKey;
    
    // Check if this wallet already exists (same public key)
    const existingWallet = wallets.find(w => 
      w.addresses?.some(a => a.publicKey === publicKey)
    );
    if (existingWallet) {
      throw new Error(`This wallet has already been imported as "${existingWallet.name}"`);
    }
    
    const newWallet = {
      id: Date.now().toString(),
      name: isObject ? walletDataOrPublicKey.name : 'Hardware Wallet',
      type: isObject && walletDataOrPublicKey.type || 'ledger',
      isHardware: true,
      mnemonic: null,
      createdAt: new Date().toISOString(),
      derivationPath: isObject ? walletDataOrPublicKey.derivationPath : "44'/501'/0'/0'",
      derivationScheme: isObject ? walletDataOrPublicKey.derivationScheme : null,
      connectionType: isObject ? walletDataOrPublicKey.connectionType : null,
      addresses: [{
        index: 0,
        publicKey,
        privateKey: null,
        name: 'Address 1'
      }],
      activeAddressIndex: 0
    };
    
    logger.log('Adding hardware wallet:', newWallet);

    const newWallets = [...wallets, newWallet];
    // Use saveWallets instead of saveWalletsToStorage to also update session storage
    await saveWallets(newWallets);
    localStorage.setItem(ACTIVE_KEY, newWallet.id);
    setActiveWalletId(newWallet.id);
    
    return new Promise((resolve) => {
      setTimeout(() => resolve(newWallet), 100);
    });
  }, [wallets, saveWallets]);

  // Switch active wallet
  const switchWallet = useCallback((walletId) => {
    setActiveWalletId(walletId);
    localStorage.setItem(ACTIVE_KEY, walletId);
    
    // Also sync to chrome.storage for background script storage listener
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [ACTIVE_KEY]: walletId });
    }
  }, []);

  const selectWallet = switchWallet;

  // Notify connected dApps when wallet/account changes
  useEffect(() => {
    if (!activeAddress?.publicKey) return;
    
    // Don't send account-changed from approval popups - it causes infinite loops
    // Approval popups have URLs like index.html?request=sign
    if (typeof window !== 'undefined' && window.location.search.includes('request=')) {
      return;
    }
    
    // Send account change notification to background script
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'account-changed',
        publicKey: activeAddress.publicKey
      }).catch(err => {
        logger.warn('[useWallet] Failed to notify account change:', err);
      });
    }
  }, [activeAddress?.publicKey]);

  // Update wallet
  const updateWallet = useCallback(async (walletId, updates) => {
    const newWallets = wallets.map(w => 
      w.id === walletId ? { ...w, ...updates } : w
    );
    await saveWallets(newWallets);
  }, [wallets, saveWallets]);

  // Remove wallet
  const removeWallet = useCallback(async (walletId) => {
    const newWallets = wallets.filter(w => w.id !== walletId);
    
    // If this will remove all wallets, clear wallet data only (keep user settings)
    if (newWallets.length === 0) {
      // Clear wallet data storage keys only
      localStorage.removeItem(STORAGE_KEY);  // x1wallet_wallets
      localStorage.removeItem('x1wallet');   // legacy key from wallet.js
      localStorage.removeItem(ACTIVE_KEY);
      localStorage.removeItem(ENCRYPTION_ENABLED_KEY);
      localStorage.removeItem('x1wallet_encrypted');
      // NOTE: Do NOT clear passwordProtection, x1wallet_auth, or passwordHash
      // These are user settings that should persist across wallet removal
      if (typeof chrome !== 'undefined' && chrome.storage) {
        try {
          await chrome.storage.local.remove([
            STORAGE_KEY, 
            'x1wallet',
            'x1wallet_encrypted'
          ]);
        } catch (e) {}
      }
      // Clear state
      setWallets([]);
      setActiveWalletId(null);
      setEncryptionPassword(null);
      setIsLocked(false);
      return;
    }
    
    // Normal case: save remaining wallets
    await saveWallets(newWallets);
    
    if (activeWalletId === walletId) {
      const newActive = newWallets[0].id;
      setActiveWalletId(newActive);
      localStorage.setItem(ACTIVE_KEY, newActive);
    }
  }, [wallets, activeWalletId, saveWallets]);

  // Reorder wallets
  const reorderWallets = useCallback(async (newWalletsOrder) => {
    const reorderedWallets = newWalletsOrder.map(newW => {
      return wallets.find(w => w.id === newW.id) || newW;
    });
    await saveWallets(reorderedWallets);
  }, [wallets, saveWallets]);

  // Clear all wallets
  const clearWallet = useCallback(async () => {
    // Clear ALL wallet storage keys (both old and new)
    localStorage.removeItem(STORAGE_KEY);  // x1wallet_wallets
    localStorage.removeItem('x1wallet');   // legacy key from wallet.js
    localStorage.removeItem(ACTIVE_KEY);
    localStorage.removeItem(ENCRYPTION_ENABLED_KEY);
    localStorage.removeItem('x1wallet_auth');
    localStorage.removeItem('x1wallet_encrypted');
    localStorage.removeItem('passwordProtection');
    localStorage.removeItem('passwordHash');
    if (typeof chrome !== 'undefined' && chrome.storage) {
      try {
        await chrome.storage.local.remove([
          'x1wallet_auth', 
          STORAGE_KEY, 
          'x1wallet',
          'x1wallet_encrypted'
        ]);
        // Also clear session storage
        if (chrome.storage.session) {
          await chrome.storage.session.remove(['x1wallet_session_wallets', 'x1wallet_session_password']);
        }
      } catch (e) {}
    }
    setWallets([]);
    setActiveWalletId(null);
    setEncryptionPassword(null);
    setIsLocked(false);
  }, []);

  // Set network
  const setNetwork = useCallback((net) => {
    setBalance(0);
    setNetworkState(net);
    localStorage.setItem(NETWORK_KEY, net);
    
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [NETWORK_KEY]: net });
      
      if (chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'network-changed',
          network: net
        }).catch(err => {
          logger.warn('[useWallet] Failed to notify network change:', err);
        });
      }
    }
  }, []);

  // Format address
  const formatAddress = useCallback((address, chars = 4) => {
    if (!address) return '';
    return `${address.slice(0, chars)}...${address.slice(-chars)}`;
  }, []);

  // Refresh balance
  const refreshBalance = useCallback(async () => {
    if (!activeAddress) return;
    
    const networkConfig = getNetworkConfig(network);
    if (!networkConfig) return;
    
    const rpcUrl = networkConfig.rpcUrl;
    
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getBalance',
          params: [activeAddress.publicKey, { commitment: 'confirmed' }]
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeout);
      
      if (!response.ok) return;
      
      const data = await response.json();
      if (data.error) return;
      
      let bal = 0;
      if (data.result?.value !== undefined) {
        bal = data.result.value / Math.pow(10, networkConfig.decimals);
      }
      
      setBalance(bal);
    } catch (e) {
      logger.error('[Balance] Failed to fetch:', e.message);
    }
  }, [activeAddress, network]);

  // Refresh on wallet/address/network change
  useEffect(() => {
    if (activeAddress && !isLocked) {
      refreshBalance();
    }
  }, [activeAddress, network, refreshBalance, isLocked]);

  // Build backwards-compatible wallet object
  const walletWithAddress = activeWallet ? {
    id: activeWallet.id,
    name: activeWallet.name,
    type: activeWallet.type,
    createdAt: activeWallet.createdAt,
    isHardware: activeWallet.isHardware,
    derivationPath: activeWallet.derivationPath,
    addresses: activeWallet.addresses,
    activeAddressIndex: activeWallet.activeAddressIndex,
    publicKey: activeAddress?.publicKey,
    privateKey: activeAddress?.privateKey,
    activeAddress
  } : null;

  // Secure method to get mnemonic
  const getMnemonic = useCallback((walletId) => {
    const targetWallet = walletId 
      ? wallets.find(w => w.id === walletId)
      : activeWallet;
    return targetWallet?.mnemonic || null;
  }, [wallets, activeWallet]);

  // Get full wallet data for backup
  const getWalletForBackup = useCallback((walletId) => {
    return wallets.find(w => w.id === walletId) || null;
  }, [wallets]);

  // Sanitized wallets array - include publicKey at wallet level for backwards compatibility
  const sanitizedWallets = wallets.map(w => {
    const activeAddr = w.addresses?.[w.activeAddressIndex || 0] || w.addresses?.[0];
    return {
      id: w.id,
      name: w.name,
      type: w.type,
      createdAt: w.createdAt,
      isHardware: w.isHardware,
      derivationPath: w.derivationPath,
      addresses: w.addresses,
      activeAddressIndex: w.activeAddressIndex,
      avatar: w.avatar,
      hasMnemonic: !!w.mnemonic,
      // Include publicKey at wallet level for backwards compatibility
      publicKey: activeAddr?.publicKey || w.publicKey
    };
  });

  return {
    // State
    wallets: sanitizedWallets,
    wallet: walletWithAddress,
    activeWallet: walletWithAddress,
    activeAddress,
    activeWalletId,
    network,
    loading,
    balance,
    isLocked,
    isEncrypted: isStorageEncrypted(),
    
    // Wallet Actions
    createWallet,
    importWallet,
    addHardwareWallet,
    switchWallet,
    selectWallet,
    updateWallet,
    removeWallet,
    reorderWallets,
    clearWallet,
    loadWallets,
    saveWallets, // Added for direct saving
    
    // Address Actions
    addAddress,
    removeAddress,
    switchAddress,
    renameAddress,
    
    // Encryption Actions
    unlockWallet,
    lockWallet,
    enableEncryption,
    setEncryptionPasswordOnly,
    clearEncryptionPassword,
    // saveWalletsUnencrypted REMOVED - encryption is mandatory
    changePassword,
    disableEncryption,
    
    // Other
    setNetwork,
    refreshBalance,
    formatAddress,
    getMnemonic,
    getWalletForBackup
  };
}

export { getNetworkConfig };