// Network configurations for X1 and Solana
import { logger } from '../utils/logger.js';

// Storage keys
const RPC_OVERRIDES_KEY = 'x1wallet_rpcOverrides';
const CUSTOM_NETWORKS_KEY = 'x1wallet_customRpcs';

// X1 is SVM-based (Solana fork), uses same address format and RPC methods
export const NETWORKS = {
  'X1 Mainnet': {
    name: 'X1 Mainnet',
    providerId: 'X1-mainnet',
    rpcUrl: 'https://rpc.mainnet.x1.xyz',
    symbol: 'XNT',
    explorer: 'https://explorer.mainnet.x1.xyz',
    explorerTx: 'https://explorer.mainnet.x1.xyz/tx',
    explorerToken: 'https://explorer.mainnet.x1.xyz/address',
    decimals: 9,
    isSVM: true,
    isX1: true
  },
  'X1 Testnet': {
    name: 'X1 Testnet',
    providerId: 'X1-testnet',
    rpcUrl: 'https://rpc.testnet.x1.xyz',
    symbol: 'XNT',
    explorer: 'https://explorer.testnet.x1.xyz',
    explorerTx: 'https://explorer.testnet.x1.xyz/tx',
    explorerToken: 'https://explorer.testnet.x1.xyz/token',
    decimals: 9,
    isSVM: true,
    isX1: true
  },
  'Solana Mainnet': {
    name: 'Solana Mainnet',
    providerId: 'SOLANA-mainnet',
    rpcUrl: 'https://jessamine-463apc-fast-mainnet.helius-rpc.com',
    symbol: 'SOL',
    explorer: 'https://solscan.io',
    explorerTx: 'https://solscan.io/tx',
    explorerToken: 'https://solscan.io/token',
    decimals: 9,
    isSVM: true,
    isSolana: true
  },
  'Solana Devnet': {
    name: 'Solana Devnet',
    providerId: 'SOLANA-devnet',
    rpcUrl: 'https://rose-l3rk46-fast-devnet.helius-rpc.com',
    symbol: 'SOL',
    explorer: 'https://solscan.io',
    explorerTx: 'https://solscan.io/tx',
    explorerToken: 'https://solscan.io/token',
    explorerSuffix: '?cluster=devnet',
    decimals: 9,
    isSVM: true,
    isSolana: true
  }
};

export const DEFAULT_NETWORK = 'X1 Mainnet';

// Get RPC overrides from localStorage
function getRpcOverrides() {
  try {
    return JSON.parse(localStorage.getItem(RPC_OVERRIDES_KEY)) || {};
  } catch (e) {
    logger.warn('Failed to load RPC overrides:', e);
    return {};
  }
}

// Set RPC override for a network
export function setRpcOverride(networkName, rpcUrl) {
  try {
    const overrides = getRpcOverrides();
    if (rpcUrl) {
      overrides[networkName] = rpcUrl;
    } else {
      delete overrides[networkName];
    }
    localStorage.setItem(RPC_OVERRIDES_KEY, JSON.stringify(overrides));
    return true;
  } catch (e) {
    logger.warn('Failed to save RPC override:', e);
    return false;
  }
}

// Get RPC override for a network
export function getRpcOverride(networkName) {
  const overrides = getRpcOverrides();
  return overrides[networkName] || null;
}

// Clear RPC override for a network
export function clearRpcOverride(networkName) {
  return setRpcOverride(networkName, null);
}

// Get network config with RPC override applied
export function getNetwork(name) {
  // Check built-in networks
  if (NETWORKS[name]) {
    const config = { ...NETWORKS[name] };
    
    // Apply RPC override if set
    try {
      const overrides = getRpcOverrides();
      if (overrides[name]) {
        config.rpcUrl = overrides[name];
        config.hasCustomRpc = true;
      }
    } catch (e) {
      logger.warn('Failed to load RPC overrides:', e);
    }
    
    return config;
  }
  
  // Check custom networks
  try {
    const customNetworks = JSON.parse(localStorage.getItem(CUSTOM_NETWORKS_KEY) || '[]');
    const customNet = customNetworks.find(n => n.name === name);
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
        isSVM: true
      };
    }
  } catch (e) {
    logger.warn('Failed to load custom networks:', e);
  }
  
  // Return default network if nothing found
  return NETWORKS[DEFAULT_NETWORK];
}

// Alias for getNetwork
export function getNetworkConfig(name) {
  return getNetwork(name);
}

export function getExplorerUrl(network, txSignature, customExplorer = null) {
  if (customExplorer) {
    const baseUrl = customExplorer.replace(/\/$/, '');
    return `${baseUrl}/tx/${txSignature}`;
  }
  
  const config = getNetwork(network);
  const suffix = config.explorerSuffix || '';
  return `${config.explorerTx}/${txSignature}${suffix}`;
}

export function getTokenExplorerUrl(network, mintAddress, customExplorer = null) {
  if (customExplorer) {
    const baseUrl = customExplorer.replace(/\/$/, '');
    return `${baseUrl}/token/${mintAddress}`;
  }
  
  const config = getNetwork(network);
  const suffix = config.explorerSuffix || '';
  return `${config.explorerToken}/${mintAddress}${suffix}`;
}

export function getAddressExplorerUrl(network, address, customExplorer = null) {
  if (customExplorer) {
    const baseUrl = customExplorer.replace(/\/$/, '');
    return `${baseUrl}/address/${address}`;
  }
  
  const config = getNetwork(network);
  const suffix = config.explorerSuffix || '';
  return `${config.explorer}/address/${address}${suffix}`;
}

// Helper to get custom explorer from localStorage
export function getCustomExplorer(network) {
  try {
    let key;
    if (network?.includes('Solana')) {
      key = network?.includes('Devnet') ? 'x1wallet_solanaDevnetExplorer' : 'x1wallet_solanaExplorer';
    } else {
      key = network?.includes('Testnet') ? 'x1wallet_x1TestnetExplorer' : 'x1wallet_x1Explorer';
    }
    
    const stored = localStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    logger.warn('Failed to get custom explorer:', e);
  }
  return null;
}

// Convenience functions
export function getTxExplorerUrl(network, txSignature) {
  const custom = getCustomExplorer(network);
  return getExplorerUrl(network, txSignature, custom);
}

export function getTokenUrl(network, mintAddress) {
  const custom = getCustomExplorer(network);
  return getTokenExplorerUrl(network, mintAddress, custom);
}

export function getAddressUrl(network, address) {
  const custom = getCustomExplorer(network);
  return getAddressExplorerUrl(network, address, custom);
}