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
  const saveWalletsToStorage = useCallback(async (walletsToSave) => {
    try {
      const jsonData = JSON.stringify(walletsToSave);
      
      if (encryptionPassword) {
        // Encrypt and save
        const encrypted = await encryptData(jsonData, encryptionPassword);
        localStorage.setItem(STORAGE_KEY, encrypted);
        localStorage.setItem(ENCRYPTION_ENABLED_KEY, 'true');
      } else {
        // Save as plain JSON (legacy mode)
        localStorage.setItem(STORAGE_KEY, jsonData);
      }
    } catch (e) {
      logger.error('Failed to save wallets:', e);
      throw e;
    }
  }, [encryptionPassword]);

  // Initial load
  useEffect(() => {
    const loadWallets = async () => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        const activeId = localStorage.getItem(ACTIVE_KEY);
        const savedNetwork = localStorage.getItem(NETWORK_KEY);
        
        if (saved) {
          // Check if encrypted
          if (isEncrypted(saved)) {
            setIsLocked(true);
            // Don't try to load - user needs to unlock first
          } else {
            // Plain JSON - load directly
            const parsed = JSON.parse(saved);
            const migrated = parsed.map(migrateWallet);
            setWallets(migrated);
            setActiveWalletId(activeId || (migrated.length > 0 ? migrated[0].id : null));
          }
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
    
    return true;
  }, [loadWalletsFromStorage]);

  // Lock wallet (clear in-memory data)
  const lockWallet = useCallback(() => {
    setWallets([]);
    setEncryptionPassword(null);
    setIsLocked(true);
    setBalance(0);
  }, []);

  // Enable encryption on existing wallet
  const enableEncryption = useCallback(async (password) => {
    if (!password || password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }
    
    // Re-save all wallets with encryption
    setEncryptionPassword(password);
    const jsonData = JSON.stringify(wallets);
    const encrypted = await encryptData(jsonData, password);
    localStorage.setItem(STORAGE_KEY, encrypted);
    localStorage.setItem(ENCRYPTION_ENABLED_KEY, 'true');
    
    return true;
  }, [wallets]);

  // Change encryption password
  const changePassword = useCallback(async (currentPassword, newPassword) => {
    if (!newPassword || newPassword.length < 8) {
      throw new Error('New password must be at least 8 characters');
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
    
    return true;
  }, [wallets]);

  // Disable encryption (convert to plain storage)
  const disableEncryption = useCallback(async (password) => {
    // Verify password first
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isEncrypted(saved)) {
      try {
        await decryptData(saved, password);
      } catch {
        throw new Error('Incorrect password');
      }
    }
    
    // Save as plain JSON
    setEncryptionPassword(null);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wallets));
    localStorage.removeItem(ENCRYPTION_ENABLED_KEY);
    
    return true;
  }, [wallets]);

  // Save wallets to storage
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
    try {
      const keypair = await mnemonicToKeypair(mnemonic, 0);
      const publicKey = encodeBase58(keypair.publicKey);
      const privateKey = encodeBase58(keypair.secretKey);
      
      // Check if this wallet already exists (same public key)
      const existingWallet = wallets.find(w => 
        w.addresses?.some(a => a.publicKey === publicKey)
      );
      if (existingWallet) {
        throw new Error('This wallet has already been imported');
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
      
      const newWallets = [...wallets, newWallet];
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
    
    const newWallet = {
      id: Date.now().toString(),
      name: isObject ? walletDataOrPublicKey.name : 'Hardware Wallet',
      type: isObject && walletDataOrPublicKey.type || 'ledger',
      isHardware: true,
      mnemonic: null,
      createdAt: new Date().toISOString(),
      derivationPath: isObject ? walletDataOrPublicKey.derivationPath : "44'/501'/0'/0'",
      addresses: [{
        index: 0,
        publicKey: isObject ? walletDataOrPublicKey.publicKey : walletDataOrPublicKey,
        privateKey: null,
        name: 'Address 1'
      }],
      activeAddressIndex: 0
    };
    
    logger.log('Adding hardware wallet:', newWallet);

    const newWallets = [...wallets, newWallet];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newWallets));
    localStorage.setItem(ACTIVE_KEY, newWallet.id);
    setWallets(newWallets);
    setActiveWalletId(newWallet.id);
    
    return new Promise((resolve) => {
      setTimeout(() => resolve(newWallet), 100);
    });
  }, [wallets]);

  // Switch active wallet
  const switchWallet = useCallback((walletId) => {
    setActiveWalletId(walletId);
    localStorage.setItem(ACTIVE_KEY, walletId);
  }, []);

  const selectWallet = switchWallet;

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
    await saveWallets(newWallets);
    
    if (activeWalletId === walletId) {
      const newActive = newWallets.length > 0 ? newWallets[0].id : null;
      setActiveWalletId(newActive);
      if (newActive) {
        localStorage.setItem(ACTIVE_KEY, newActive);
      } else {
        localStorage.removeItem(ACTIVE_KEY);
      }
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
  const clearWallet = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ACTIVE_KEY);
    localStorage.removeItem(ENCRYPTION_ENABLED_KEY);
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

  // Sanitized wallets array
  const sanitizedWallets = wallets.map(w => ({
    id: w.id,
    name: w.name,
    type: w.type,
    createdAt: w.createdAt,
    isHardware: w.isHardware,
    derivationPath: w.derivationPath,
    addresses: w.addresses,
    activeAddressIndex: w.activeAddressIndex,
    avatar: w.avatar,
    hasMnemonic: !!w.mnemonic
  }));

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
    
    // Address Actions
    addAddress,
    removeAddress,
    switchAddress,
    renameAddress,
    
    // Encryption Actions
    unlockWallet,
    lockWallet,
    enableEncryption,
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