// Swap Screen - Uses XDEX for X1, Jupiter for Solana
import React, { useState, useEffect, useCallback, useRef } from 'react';
import X1Logo from './X1Logo';
import { NETWORKS } from '@x1-wallet/core/services/networks';
import { getQuote, prepareSwap, getSwapTokens, getSwapProvider, isSolanaNetwork, XDEX_LOGOS, searchXDEXTokens, fetchTokenMetadata } from '@x1-wallet/core/services/xdex';
import { signAndSendExternalTransaction, addTransaction, createWrapTransaction, createUnwrapTransaction, signAndSendExternalTransactionHardware, createWrapTransactionHardware, createUnwrapTransactionHardware } from '@x1-wallet/core/utils/transaction';
import { trackSwapXP } from '@x1-wallet/core/services/xp';
import { logger, getUserFriendlyError, ErrorMessages } from '@x1-wallet/core';
import { hardwareWallet } from '../services/hardware';

// Priority fee options for transaction speed
const PRIORITY_OPTIONS = [
  { id: 'auto', name: 'Auto', fee: 0, description: 'Standard speed' },
  { id: 'fast', name: 'Fast', fee: 0.000005, description: 'Higher priority' },
  { id: 'turbo', name: 'Turbo', fee: 0.00005, description: 'Very high priority' },
  { id: 'degen', name: 'Degen', fee: 0.001, description: 'Maximum priority' },
  { id: 'custom', name: 'Custom', fee: 0, description: 'Custom fee' }
];

// Global image cache to prevent re-fetching
const imageCache = new Map();

// Preload and cache an image
function preloadImage(url) {
  if (!url || imageCache.has(url)) return;
  const img = new Image();
  img.src = url;
  imageCache.set(url, img);
}

// Preload multiple images
function preloadImages(tokens) {
  if (!tokens) return;
  tokens.forEach(token => {
    if (token.logoURI) preloadImage(token.logoURI);
  });
}

// Storage keys for custom tokens
const CUSTOM_TOKENS_KEY = 'x1wallet_custom_tokens';

// Load custom tokens from localStorage (deduplicates on load)
function loadCustomTokens(network) {
  try {
    const stored = localStorage.getItem(CUSTOM_TOKENS_KEY);
    logger.log('[CustomTokens] Loading for network:', network, 'Raw stored:', stored);
    if (stored) {
      const all = JSON.parse(stored);
      const tokens = all[network] || [];
      logger.log('[CustomTokens] Found tokens for network:', tokens.length, tokens);
      
      // Deduplicate by mint address and symbol
      const seen = new Set();
      const deduplicated = tokens.filter(t => {
        const key = t.mint || t.symbol;
        if (seen.has(key) || seen.has(t.symbol)) {
          return false;
        }
        seen.add(t.mint);
        seen.add(t.symbol);
        return true;
      });
      
      // If we deduplicated, save the clean list
      if (deduplicated.length !== tokens.length) {
        all[network] = deduplicated;
        localStorage.setItem(CUSTOM_TOKENS_KEY, JSON.stringify(all));
        logger.log('[CustomTokens] Deduplicated and saved:', deduplicated.length);
      }
      
      return deduplicated;
    }
  } catch (e) {
    logger.error('Failed to load custom tokens:', e);
  }
  return [];
}

// Save custom tokens to localStorage
function saveCustomTokens(network, tokens) {
  try {
    logger.log('[CustomTokens] Saving for network:', network, 'Tokens:', tokens);
    const stored = localStorage.getItem(CUSTOM_TOKENS_KEY);
    const all = stored ? JSON.parse(stored) : {};
    all[network] = tokens;
    localStorage.setItem(CUSTOM_TOKENS_KEY, JSON.stringify(all));
    logger.log('[CustomTokens] Saved. New stored:', localStorage.getItem(CUSTOM_TOKENS_KEY));
  } catch (e) {
    logger.error('Failed to save custom tokens:', e);
  }
}

// Force clear all custom tokens for all networks
function forceResetCustomTokens() {
  try {
    localStorage.removeItem(CUSTOM_TOKENS_KEY);
    logger.log('[CustomTokens] Force reset - removed all custom tokens');
  } catch (e) {
    logger.error('Failed to force reset custom tokens:', e);
  }
}

// Check if string looks like a token address
// X1W-009 FIX: Use proper base58 validation with decode verification
function isTokenAddress(str) {
  if (!str || typeof str !== 'string') return false;
  
  // Basic length check (Solana addresses are 32-44 characters)
  if (str.length < 32 || str.length > 44) return false;
  
  // Base58 character set check (excludes 0, O, I, l)
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
  if (!base58Regex.test(str)) return false;
  
  // Attempt to decode and verify length
  try {
    // Import the validation function from base58 module
    // This performs full decode/re-encode verification
    const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    
    // Decode base58
    const bytes = [0];
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      let value = BASE58_ALPHABET.indexOf(char);
      if (value < 0) return false;
      for (let j = 0; j < bytes.length; j++) {
        value += bytes[j] * 58;
        bytes[j] = value & 0xff;
        value >>= 8;
      }
      while (value > 0) {
        bytes.push(value & 0xff);
        value >>= 8;
      }
    }
    for (let i = 0; i < str.length && str[i] === BASE58_ALPHABET[0]; i++) {
      bytes.push(0);
    }
    const decoded = new Uint8Array(bytes.reverse());
    
    // Solana/X1 public keys should be exactly 32 bytes
    if (decoded.length !== 32) return false;
    
    return true;
  } catch (e) {
    return false;
  }
}

export default function SwapScreen({ wallet, onBack, onSwapComplete, userTokens = [], initialFromToken = null }) {
  const [tokens, setTokens] = useState([]);
  const [fromToken, setFromToken] = useState(null);
  const [toToken, setToToken] = useState(null);
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [inputMode, setInputMode] = useState('from'); // 'from' | 'to' - which field user is editing
  const [selectingToken, setSelectingToken] = useState(null); // 'from' | 'to' | null
  const [slippage, setSlippage] = useState(0.5);
  const [customSlippage, setCustomSlippage] = useState('');
  const slippageOptions = [0.1, 0.5, 1.0, 3.0];
  const [loading, setLoading] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState('');
  const [swapStatus, setSwapStatus] = useState(''); // '' | 'confirming' | 'success' | 'error'
  const [hwStatus, setHwStatus] = useState(''); // Hardware wallet status message
  const [showConfirm, setShowConfirm] = useState(false); // Show confirmation screen
  const [txHash, setTxHash] = useState(''); // Transaction hash for success screen
  const [swapPriority, setSwapPriority] = useState('auto'); // Transaction priority
  const [customFee, setCustomFee] = useState(''); // Custom fee amount
  
  // Check if hardware wallet
  const isHardwareWallet = wallet?.wallet?.isHardware || 
                           wallet?.activeWallet?.isHardware || 
                           wallet?.isHardware || false;
  
  // Token management state
  const [showManageTokens, setShowManageTokens] = useState(false);
  const [customTokens, setCustomTokens] = useState([]);
  const [newTokenAddress, setNewTokenAddress] = useState('');
  const [addingToken, setAddingToken] = useState(false);
  const [tokenSearchQuery, setTokenSearchQuery] = useState('');
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  
  // Search state
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  
  // Pool tokens from API
  const [poolTokens, setPoolTokens] = useState([]);
  const [poolTokensLoading, setPoolTokensLoading] = useState(false);
  
  // Locally fetched token balances (when userTokens prop is empty)
  const [localTokens, setLocalTokens] = useState([]);
  const [fetchingLocalTokens, setFetchingLocalTokens] = useState(false);
  const localTokensFetchedRef = useRef(false);
  
  // Track if initial token has been set
  const [initialTokenSet, setInitialTokenSet] = useState(false);

  // Safety check - compute safe values even if wallet is not ready
  const walletReady = !!(wallet && wallet.network);
  const currentNetwork = wallet?.network || 'X1 Mainnet';
  
  // Get network config - check custom networks first, then built-in
  const getNetworkConfig = () => {
    // First check built-in networks
    if (NETWORKS[currentNetwork]) {
      return NETWORKS[currentNetwork];
    }
    // Then check custom networks from localStorage
    try {
      const customNetworks = JSON.parse(localStorage.getItem('x1wallet_customRpcs') || '[]');
      const customNet = customNetworks.find(n => n.name === currentNetwork);
      if (customNet) {
        return {
          name: customNet.name,
          rpcUrl: customNet.url,
          symbol: customNet.symbol || 'XNT',
          decimals: customNet.decimals || 9,
          explorer: customNet.explorer || '',
          isX1: true, // Custom networks are assumed to be X1-based
          isSVM: true
        };
      }
    } catch (e) {
      logger.warn('[SwapScreen] Failed to load custom networks:', e);
    }
    // Fallback to X1 Mainnet
    return NETWORKS['X1 Mainnet'];
  };
  
  const networkConfig = getNetworkConfig();
  const nativeSymbol = networkConfig?.symbol || 'XNT';
  const provider = getSwapProvider(currentNetwork);
  const isSolana = isSolanaNetwork(currentNetwork);
  const walletBalance = wallet?.balance ?? 0;

  // Set initial from token when provided and tokens are loaded
  useEffect(() => {
    if (initialFromToken && !initialTokenSet && tokens.length > 0) {
      logger.log('[SwapScreen] Setting initial from token:', initialFromToken.symbol);
      
      // Find the token in our tokens list to get full data including balance
      const matchedToken = tokens.find(t => 
        t.mint === initialFromToken.mint || 
        t.address === initialFromToken.address ||
        (t.symbol === initialFromToken.symbol && t.isNative === initialFromToken.isNative)
      );
      
      if (matchedToken) {
        setFromToken(matchedToken);
        setInitialTokenSet(true);
      } else if (initialFromToken.isNative) {
        // For native token, create it with current balance
        const nativeToken = {
          symbol: nativeSymbol,
          name: networkConfig?.name || 'Native Token',
          mint: 'native',
          isNative: true,
          decimals: networkConfig?.decimals || 9,
          balance: walletBalance,
          logoURI: null
        };
        setFromToken(nativeToken);
        setInitialTokenSet(true);
      }
    }
  }, [initialFromToken, tokens, initialTokenSet, nativeSymbol, networkConfig, walletBalance]);

  // Log when userTokens prop changes
  useEffect(() => {
    logger.log('[SwapScreen] userTokens prop changed:', userTokens?.length, userTokens?.map(t => t.symbol || t.mint?.slice(0, 6)));
  }, [userTokens]);

  // Reset selected tokens and clear state when network changes
  useEffect(() => {
    logger.log('[SwapScreen] Network changed to:', currentNetwork, '- resetting swap state');
    setFromToken(null);
    setToToken(null);
    setFromAmount('');
    setToAmount('');
    setQuote(null);
    setTokens([]);
    setPoolTokens([]);
    setSearchResults([]);
    setError('');
    setInitialTokenSet(false);
    // Reset local token fetch state so we fetch fresh for new network
    setLocalTokens([]);
    localTokensFetchedRef.current = false;
  }, [currentNetwork]);

  // Known Solana-only tokens that should NEVER appear on X1 networks
  const SOLANA_ONLY_SYMBOLS = ['SOL', 'WSOL', 'RAY', 'SRM', 'ORCA', 'MNGO', 'STEP', 'COPE', 'FIDA', 'MAPS', 'OXY', 'mSOL', 'stSOL', 'jitoSOL', 'bSOL'];
  const X1_ONLY_SYMBOLS = ['XNT', 'WXNT', 'pXNT'];

  // Fetch token balances directly if userTokens prop is empty
  // This handles the case when SwapScreen is opened before WalletMain has fetched tokens
  useEffect(() => {
    // Skip if we already have userTokens from parent
    if (userTokens && userTokens.length > 0) {
      logger.log('[SwapScreen] Using userTokens from parent:', userTokens.length);
      localTokensFetchedRef.current = false; // Reset so we can fetch again if needed
      return;
    }
    
    // Skip if wallet not ready
    if (!walletReady || !networkConfig?.rpcUrl || !wallet?.wallet?.publicKey) {
      return;
    }
    
    // Skip if already fetching or already fetched for this session
    if (fetchingLocalTokens || localTokensFetchedRef.current) {
      return;
    }
    
    const fetchLocalTokens = async () => {
      logger.log('[SwapScreen] Fetching token balances directly (userTokens empty)');
      setFetchingLocalTokens(true);
      
      try {
        const { fetchTokenAccounts } = await import('@x1-wallet/core/services/tokens');
        const allTokens = await fetchTokenAccounts(
          networkConfig.rpcUrl, 
          wallet.wallet.publicKey, 
          currentNetwork
        );
        
        // Filter out NFTs
        const tokenList = allTokens.filter(token => {
          const isNFT = token.decimals === 0 && token.uiAmount === 1;
          return !isNFT;
        });
        
        logger.log('[SwapScreen] Directly fetched tokens:', tokenList.length, tokenList.map(t => `${t.symbol}:${t.balance || t.uiAmount}`));
        setLocalTokens(tokenList);
        localTokensFetchedRef.current = true;
      } catch (err) {
        logger.error('[SwapScreen] Failed to fetch tokens directly:', err);
      } finally {
        setFetchingLocalTokens(false);
      }
    };
    
    fetchLocalTokens();
  }, [userTokens, walletReady, networkConfig?.rpcUrl, wallet?.wallet?.publicKey, currentNetwork, fetchingLocalTokens]);

  // Combine userTokens with localTokens - prefer userTokens if available
  const effectiveUserTokens = React.useMemo(() => {
    if (userTokens && userTokens.length > 0) {
      return userTokens;
    }
    return localTokens;
  }, [userTokens, localTokens]);

  // Filter effectiveUserTokens to only include tokens appropriate for current network
  const filteredUserTokens = React.useMemo(() => {
    if (!effectiveUserTokens || effectiveUserTokens.length === 0) return [];
    
    return effectiveUserTokens.filter(token => {
      const symbol = token.symbol?.toUpperCase() || '';
      
      // On X1 networks, exclude Solana-only tokens
      if (!isSolana) {
        if (SOLANA_ONLY_SYMBOLS.includes(symbol)) {
          logger.log('[SwapScreen] Filtering out Solana token on X1:', symbol);
          return false;
        }
      }
      
      // On Solana networks, exclude X1-only tokens  
      if (isSolana) {
        if (X1_ONLY_SYMBOLS.includes(symbol)) {
          logger.log('[SwapScreen] Filtering out X1 token on Solana:', symbol);
          return false;
        }
      }
      
      return true;
    });
  }, [effectiveUserTokens, isSolana]);
  useEffect(() => {
    logger.log('[SwapScreen] Pool tokens useEffect triggered - network:', currentNetwork, 'isSolana:', isSolana, 'walletReady:', walletReady);
    
    const fetchPoolTokens = async () => {
      logger.log('[SwapScreen] fetchPoolTokens called - network:', currentNetwork);
      
      // Don't fetch if wallet not ready
      if (!walletReady) {
        logger.log('[SwapScreen] Skipping pool fetch - wallet not ready');
        return;
      }
      
      // For Solana networks, use getSwapTokens (hardcoded + Jupiter)
      if (isSolana) {
        logger.log('[SwapScreen] Loading Solana tokens from getSwapTokens');
        setPoolTokensLoading(true);
        try {
          const solanaTokens = await getSwapTokens(currentNetwork);
          logger.log('[SwapScreen] Solana tokens loaded:', solanaTokens.length, solanaTokens.map(t => t.symbol));
          // Filter out native token for the "All Tokens" section
          const nonNativeTokens = solanaTokens.filter(t => t.symbol !== 'SOL' && t.mint !== 'native' && !t.isNative);
          setPoolTokens(nonNativeTokens.map(t => ({ ...t, isPoolToken: true })));
        } catch (e) {
          logger.error('[SwapScreen] Failed to load Solana tokens:', e);
          setPoolTokens([]);
        }
        setPoolTokensLoading(false);
        return;
      }
      
      logger.log('[SwapScreen] Starting pool tokens fetch for:', currentNetwork);
      setPoolTokensLoading(true);
      
      // Use correct network parameter format: "X1 Mainnet" or "X1 Testnet"
      const networkParam = currentNetwork === 'X1 Testnet' ? 'X1 Testnet' : 'X1 Mainnet';
      const encodedNetwork = encodeURIComponent(networkParam);
      
      // Primary endpoint from Code Maestro
      const endpoints = [
        { url: `https://devapi.xdex.xyz/api/xendex/wallet/tokens/pool?network=${encodedNetwork}`, name: 'devapi-pool' },
        { url: `https://api.xdex.xyz/api/xendex/wallet/tokens/pool?network=${encodedNetwork}`, name: 'api-pool' },
      ];
      
      let tokenList = [];
      let succeeded = false;
      
      for (const endpoint of endpoints) {
        if (succeeded) break;
        
        try {
          logger.log('[SwapScreen] Trying pool tokens from:', endpoint.name, endpoint.url);
          const response = await fetch(endpoint.url, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            }
          });
          
          logger.log('[SwapScreen] Response status:', response.status, 'from', endpoint.name);
          
          if (response.ok) {
            const data = await response.json();
            logger.log('[SwapScreen] Raw response:', JSON.stringify(data).slice(0, 500));
            
            // Handle various response formats
            if (Array.isArray(data)) {
              tokenList = data;
            } else if (data.data?.tokens && Array.isArray(data.data.tokens)) {
              // Format: { success: true, data: { network: "X1 Mainnet", tokens: [...] } }
              tokenList = data.data.tokens;
            } else if (data.data && Array.isArray(data.data)) {
              tokenList = data.data;
            } else if (data.tokens && Array.isArray(data.tokens)) {
              tokenList = data.tokens;
            } else if (data.result && Array.isArray(data.result)) {
              tokenList = data.result;
            } else {
              logger.log('[SwapScreen] Unknown response format, keys:', Object.keys(data), 'data keys:', data.data ? Object.keys(data.data) : 'N/A');
              continue; // Try next endpoint
            }
            
            if (tokenList.length > 0) {
              succeeded = true;
              logger.log('[SwapScreen] Token list from API:', tokenList.length);
            }
          }
        } catch (e) {
          logger.log('[SwapScreen] API error:', endpoint.name, e.message);
        }
      }
      
      if (succeeded && tokenList.length > 0) {
        // Normalize token data - handle various field names from different APIs
        const normalized = tokenList.map(t => {
          // Get the logo URL and fix relative paths
          let logoURI = t.logoURI || t.imageUrl || t.logo || t.image || t.LogoURI || t.Icon || '';
          
          // Fix relative URLs by prepending XDEX base URL
          if (logoURI && logoURI.startsWith('/')) {
            logoURI = `https://xdex.xyz${logoURI}`;
          }
          
          return {
            symbol: t.symbol || t.ticker || t.Symbol || 'UNK',
            name: t.name || t.Name || t.symbol || 'Unknown',
            mint: t.mint || t.address || t.tokenAddress || t.Mint || t.Address,
            logoURI,
            decimals: t.decimals || t.Decimals || 9,
            isPoolToken: true
          };
        }).filter(t => t.mint); // Only keep tokens with a valid mint
        
        logger.log('[SwapScreen] Normalized pool tokens:', normalized.length, normalized.map(t => t.symbol));
        setPoolTokens(normalized);
      } else {
        logger.warn('[SwapScreen] All API endpoints failed, using fallback');
        // Use fallback - get all tokens from the base list
        try {
          const baseTokens = await getSwapTokens(currentNetwork);
          const poolFallback = baseTokens.filter(t => !t.isNative && t.mint !== 'native');
          logger.log('[SwapScreen] Using fallback tokens:', poolFallback.length);
          setPoolTokens(poolFallback.map(t => ({ ...t, isPoolToken: true })));
        } catch (e2) {
          logger.error('[SwapScreen] Fallback also failed:', e2);
          setPoolTokens([]);
        }
      }
      
      setPoolTokensLoading(false);
    };
    
    fetchPoolTokens();
  }, [currentNetwork, isSolana, walletReady]);

  // Format balance - show minimal decimals, no trailing zeros
  const formatBalance = (balance, maxDecimals = 6) => {
    if (balance === 0 || balance === null || balance === undefined) return '0';
    if (balance < 0.000001) return balance.toExponential(2);
    return parseFloat(balance.toFixed(maxDecimals)).toString();
  };

  // Load custom tokens on mount
  useEffect(() => {
    const custom = loadCustomTokens(currentNetwork);
    logger.log('[SwapScreen] Loaded custom tokens:', custom.length, custom);
    setCustomTokens(custom);
  }, [currentNetwork]);

  // Load available tokens for network + merge with user's holdings
  useEffect(() => {
    // Don't load if wallet not ready
    if (!walletReady) {
      logger.log('[SwapScreen] Skipping token load - wallet not ready');
      return;
    }
    
    const loadTokens = async () => {
      logger.log('[SwapScreen] Loading tokens for network:', currentNetwork, 'filteredUserTokens:', filteredUserTokens?.length);
      logger.log('[SwapScreen] UserTokens detail:', filteredUserTokens?.map(t => ({ symbol: t.symbol, mint: t.mint?.slice(0,8), balance: t.balance || t.uiAmount })));
      
      const swapTokens = await getSwapTokens(currentNetwork);
      logger.log('[SwapScreen] Base swap tokens:', swapTokens.length, swapTokens.map(t => t.symbol));
      
      const custom = loadCustomTokens(currentNetwork);
      logger.log('[SwapScreen] Custom tokens from storage:', custom.length, custom.map(t => t.symbol));
      
      // Create a map keyed by mint address for efficient lookup
      const tokenMap = new Map();
      
      // Add base swap tokens first
      for (const token of swapTokens) {
        const key = token.mint || token.symbol;
        tokenMap.set(key, { ...token });
      }
      
      // Add custom tokens
      for (const ct of custom) {
        const key = ct.mint || ct.symbol;
        if (!tokenMap.has(key)) {
          tokenMap.set(key, { ...ct, isCustom: true });
        }
      }
      
      // Add user's token holdings - these have ACTUAL balances
      if (filteredUserTokens && filteredUserTokens.length > 0) {
        for (const ut of filteredUserTokens) {
          const key = ut.mint || ut.symbol;
          const existing = tokenMap.get(key) || tokenMap.get(ut.symbol);
          const balance = parseFloat(ut.balance || ut.uiAmount) || 0;
          
          if (existing) {
            // Update existing token with user's balance and logo
            existing.balance = balance;
            existing.logoURI = ut.logoURI || existing.logoURI;
            existing.name = ut.name || existing.name;
            existing.isToken2022 = ut.isToken2022 || existing.isToken2022 || false;
          } else {
            // Add new token from user holdings
            logger.log('[SwapScreen] Adding user token:', ut.symbol || ut.mint?.slice(0, 8), 'balance:', balance);
            tokenMap.set(key, {
              symbol: ut.symbol || ut.mint?.slice(0, 4).toUpperCase(),
              name: ut.name || ut.symbol || 'Token',
              mint: ut.mint,
              logoURI: ut.logoURI,
              decimals: ut.decimals,
              isToken2022: ut.isToken2022 || false,
              balance: balance
            });
          }
        }
      }
      
      // Convert map to array and update native token balance
      const tokensWithBalances = Array.from(tokenMap.values()).map(token => {
        // Native token gets wallet balance
        if (token.symbol === nativeSymbol || token.mint === 'native') {
          return { ...token, balance: walletBalance };
        }
        return token;
      });
      
      logger.log('[SwapScreen] Final tokens:', tokensWithBalances.length, tokensWithBalances.map(t => `${t.symbol}:${t.balance}`));
      setTokens(tokensWithBalances);
      
      // Preload token images for faster rendering
      preloadImages(tokensWithBalances);
      
      // Set defaults - native token as from, USDC as to
      // Solana: SOL -> USDC, X1: XNT -> USDC.X
      if (tokensWithBalances.length >= 2) {
        // Find native token (SOL on Solana, XNT on X1)
        const nativeToken = tokensWithBalances.find(t => 
          t.isNative || 
          t.mint === 'native' || 
          t.symbol === nativeSymbol ||
          t.symbol === 'SOL' ||
          t.symbol === 'XNT'
        ) || tokensWithBalances[0];
        
        // Find default "to" token based on network
        // X1: USDC.X, Solana: USDC
        const isX1Network = currentNetwork?.startsWith('X1');
        
        let otherToken;
        if (isX1Network) {
          // For X1, default to USDC.X
          otherToken = tokensWithBalances.find(t => t.symbol === 'USDC.X');
        }
        
        // Fallback to USDC if not X1 or USDC.X not found
        if (!otherToken) {
          const usdcToken = tokensWithBalances.find(t => 
            t.symbol === 'USDC' || 
            t.symbol === 'USDC.X' || 
            t.symbol?.toUpperCase() === 'USDC'
          );
          otherToken = usdcToken || tokensWithBalances.find(t => 
            t.symbol !== nativeSymbol && 
            t.mint !== 'native' && 
            t.symbol !== 'SOL' && 
            t.symbol !== 'XNT' &&
            !t.isNative
          ) || tokensWithBalances[1];
        }
        
        // Only set if not already set (to preserve user selection within same network)
        setFromToken(prev => prev || nativeToken);
        setToToken(prev => prev || otherToken);
      }
    };
    loadTokens();
  }, [currentNetwork, walletBalance, nativeSymbol, filteredUserTokens, walletReady]);

  // Sync selected token balances when tokens list updates
  useEffect(() => {
    if (fromToken && tokens.length > 0) {
      const updatedFrom = tokens.find(t => t.mint === fromToken.mint || t.symbol === fromToken.symbol);
      if (updatedFrom && updatedFrom.balance !== fromToken.balance) {
        setFromToken(prev => ({ ...prev, balance: updatedFrom.balance }));
      }
    }
    if (toToken && tokens.length > 0) {
      const updatedTo = tokens.find(t => t.mint === toToken.mint || t.symbol === toToken.symbol);
      if (updatedTo && updatedTo.balance !== toToken.balance) {
        setToToken(prev => ({ ...prev, balance: updatedTo.balance }));
      }
    }
  }, [tokens]);

  // Also sync balances directly from userTokens when they update
  useEffect(() => {
    if (!filteredUserTokens || filteredUserTokens.length === 0) return;
    
    // Update fromToken balance if it exists in userTokens
    if (fromToken && fromToken.symbol !== nativeSymbol) {
      const userToken = filteredUserTokens.find(ut => 
        ut.mint === fromToken.mint || ut.symbol === fromToken.symbol
      );
      if (userToken) {
        const newBalance = parseFloat(userToken.balance || userToken.uiAmount) || 0;
        if (newBalance !== fromToken.balance) {
          logger.log('[SwapScreen] Syncing fromToken balance from userTokens:', fromToken.symbol, newBalance);
          setFromToken(prev => ({ ...prev, balance: newBalance }));
        }
      }
    }
    
    // Update toToken balance if it exists in userTokens
    if (toToken && toToken.symbol !== nativeSymbol) {
      const userToken = filteredUserTokens.find(ut => 
        ut.mint === toToken.mint || ut.symbol === toToken.symbol
      );
      if (userToken) {
        const newBalance = parseFloat(userToken.balance || userToken.uiAmount) || 0;
        if (newBalance !== toToken.balance) {
          logger.log('[SwapScreen] Syncing toToken balance from userTokens:', toToken.symbol, newBalance);
          setToToken(prev => ({ ...prev, balance: newBalance }));
        }
      }
    }
  }, [filteredUserTokens, nativeSymbol]);

  // Sync native token balance with walletBalance
  useEffect(() => {
    if (fromToken && (fromToken.mint === 'native' || fromToken.isNative || fromToken.symbol === nativeSymbol)) {
      if (fromToken.balance !== walletBalance) {
        setFromToken(prev => ({ ...prev, balance: walletBalance }));
      }
    }
    if (toToken && (toToken.mint === 'native' || toToken.isNative || toToken.symbol === nativeSymbol)) {
      if (toToken.balance !== walletBalance) {
        setToToken(prev => ({ ...prev, balance: walletBalance }));
      }
    }
  }, [walletBalance, nativeSymbol]);

  // Debounced token search
  useEffect(() => {
    if (!tokenSearchQuery || tokenSearchQuery.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    const searchTokens = async () => {
      setSearching(true);
      
      try {
        // Helper to enrich token with user's balance and logo if available
        const enrichWithUserData = (token) => {
          // Check if user has this token in their holdings
          const userToken = filteredUserTokens?.find(ut => 
            ut.mint === token.mint || 
            ut.symbol === token.symbol
          );
          
          if (userToken) {
            return {
              ...token,
              balance: parseFloat(userToken.balance || userToken.uiAmount) || token.balance || 0,
              logoURI: userToken.logoURI || token.logoURI,
              name: token.name || userToken.name,
            };
          }
          return token;
        };
        
        // If it looks like an address, try to fetch token metadata
        if (isTokenAddress(tokenSearchQuery)) {
          logger.log('[Swap] Searching by address:', tokenSearchQuery, 'on', currentNetwork);
          
          // First check if it's already in the tokens list
          const existingToken = tokens.find(t => t.mint === tokenSearchQuery);
          if (existingToken) {
            setSearchResults([existingToken]);
            setSearching(false);
            return;
          }
          
          try {
            const tokenInfo = await fetchTokenMetadata(networkConfig.rpcUrl, tokenSearchQuery, currentNetwork);
            if (tokenInfo) {
              // Enrich with user data
              setSearchResults([enrichWithUserData(tokenInfo)]);
              setSearching(false);
              return;
            }
          } catch (e) {
            logger.log('[Swap] Address lookup failed:', e.message);
            setError(e.message);
          }
        }
        
        // Try XDEX token search
        const xdexResults = await searchXDEXTokens(tokenSearchQuery, currentNetwork);
        if (xdexResults && xdexResults.length > 0) {
          setSearchResults(xdexResults.map(enrichWithUserData));
          setSearching(false);
          return;
        }
        
        // For Solana, also search Jupiter
        if (isSolana) {
          const { searchTokens: searchJupiter } = await import('@x1-wallet/core/services/xdex');
          const jupResults = await searchJupiter(tokenSearchQuery, currentNetwork);
          if (jupResults && jupResults.length > 0) {
            setSearchResults(jupResults.map(enrichWithUserData));
            setSearching(false);
            return;
          }
        }
        
        // Fallback: search local tokens list AND pool tokens by name/symbol
        const query = tokenSearchQuery.toLowerCase();
        const seen = new Set();
        const localResults = [];
        
        // Search local tokens (user's holdings + base tokens)
        for (const t of tokens) {
          if ((t.symbol?.toLowerCase().includes(query) || t.name?.toLowerCase().includes(query)) && !seen.has(t.mint)) {
            seen.add(t.mint);
            localResults.push(enrichWithUserData(t));
          }
        }
        
        // Also search pool tokens (DEX tokens)
        for (const t of poolTokens) {
          if ((t.symbol?.toLowerCase().includes(query) || t.name?.toLowerCase().includes(query)) && !seen.has(t.mint)) {
            seen.add(t.mint);
            localResults.push(enrichWithUserData(t));
          }
        }
        
        if (localResults.length > 0) {
          setSearchResults(localResults);
          setSearching(false);
          return;
        }
        
        // No results found
        setSearchResults([]);
      } catch (err) {
        logger.error('[Swap] Search error:', err);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    };

    // Debounce search
    const timeoutId = setTimeout(searchTokens, 300);
    return () => clearTimeout(timeoutId);
  }, [tokenSearchQuery, currentNetwork, networkConfig.rpcUrl, isSolana, filteredUserTokens, tokens, poolTokens]);

  // WXNT uses the same underlying mint as Wrapped SOL (So111...)
  // Detection must be symbol-based, not mint-based
  
  // Check if this is a wrap/unwrap operation (XNT <-> WXNT)
  const isWrapUnwrap = (from, to) => {
    if (!from || !to) return false;
    // Native XNT -> Wrapped XNT (wrap)
    const isFromNativeXNT = from.symbol === 'XNT' && (from.isNative || !from.mint || from.mint === 'native');
    const isToWXNT = to.symbol === 'WXNT';
    // Wrapped XNT -> Native XNT (unwrap)
    const isFromWXNT = from.symbol === 'WXNT';
    const isToNativeXNT = to.symbol === 'XNT' && (to.isNative || !to.mint || to.mint === 'native');
    return (isFromNativeXNT && isToWXNT) || (isFromWXNT && isToNativeXNT);
  };
  
  // Get wrap/unwrap direction
  const getWrapDirection = (from, to) => {
    if (!from || !to) return null;
    const isFromNativeXNT = from.symbol === 'XNT' && (from.isNative || !from.mint || from.mint === 'native');
    const isToWXNT = to.symbol === 'WXNT';
    const isFromWXNT = from.symbol === 'WXNT';
    const isToNativeXNT = to.symbol === 'XNT' && (to.isNative || !to.mint || to.mint === 'native');
    if (isFromNativeXNT && isToWXNT) return 'wrap';
    if (isFromWXNT && isToNativeXNT) return 'unwrap';
    return null;
  };
  
  const wrapDirection = getWrapDirection(fromToken, toToken);
  const isWrapOperation = wrapDirection !== null;

  // Track which amount to watch based on inputMode
  const activeAmount = inputMode === 'from' ? fromAmount : toAmount;
  
  // Debounced quote fetching - supports both forward and reverse calculation
  useEffect(() => {
    if (!activeAmount || !fromToken || !toToken || parseFloat(activeAmount) <= 0) {
      setQuote(null);
      return;
    }

    // XNT/WXNT wrap/unwrap is always 1:1
    if (isWrapUnwrap(fromToken, toToken)) {
      logger.log('[Swap] Wrap/Unwrap detected - 1:1 rate');
      setQuote({ 
        isWrapUnwrap: true, 
        direction: getWrapDirection(fromToken, toToken),
        rate: 1,
        data: { rate: 1, outputAmount: parseFloat(activeAmount) }
      });
      if (inputMode === 'from') setToAmount(activeAmount);
      else setFromAmount(activeAmount);
      setQuoteLoading(false);
      return;
    }

    const fetchQuote = async () => {
      setQuoteLoading(true);
      setError('');
      
      try {
        // For reverse mode, we get quote from toToken to fromToken, then invert
        const quoteFromToken = inputMode === 'from' ? fromToken : toToken;
        const quoteToToken = inputMode === 'from' ? toToken : fromToken;
        const quoteAmount = parseFloat(activeAmount);
        
        const quoteData = await getQuote(
          quoteFromToken.symbol,
          quoteToToken.symbol,
          quoteAmount,
          currentNetwork,
          quoteFromToken,
          quoteToToken
        );
        
        logger.log('[Swap] Quote data received:', quoteData);
        setQuote(quoteData);
        
        // Extract output amount from quote
        const outputAmount = quoteData?.data?.outputAmount || 
                            quoteData?.data?.token_out_amount ||
                            quoteData?.outputAmount ||
                            quoteData?.token_out_amount ||
                            quoteData?.estimatedOutput ||
                            quoteData?.outAmount;
        
        logger.log('[Swap] Output amount:', outputAmount);
        
        if (outputAmount !== undefined && outputAmount !== null) {
          if (inputMode === 'from') {
            setToAmount(parseFloat(parseFloat(outputAmount).toFixed(4)).toString());
          } else {
            // Reverse mode - the output is actually what we need to put in fromAmount
            setFromAmount(parseFloat(parseFloat(outputAmount).toFixed(4)).toString());
          }
        } else {
          // Try to calculate from rate if available
          const rate = quoteData?.data?.rate || quoteData?.rate;
          if (rate) {
            const calculated = quoteAmount * rate;
            logger.log('[Swap] Calculated from rate:', calculated);
            if (inputMode === 'from') {
              setToAmount(parseFloat(calculated.toFixed(4)).toString());
            } else {
              setFromAmount(parseFloat(calculated.toFixed(4)).toString());
            }
          }
        }
      } catch (err) {
        logger.error('[Swap] Quote error:', err);
        setError(getUserFriendlyError(err, ErrorMessages.swap.quoteFailed));
        if (inputMode === 'from') setToAmount('');
        else setFromAmount('');
      } finally {
        setQuoteLoading(false);
      }
    };

    // Debounce the quote fetch
    const timeoutId = setTimeout(fetchQuote, 500);
    return () => clearTimeout(timeoutId);
  }, [activeAmount, inputMode, fromToken, toToken, currentNetwork]);

  // CRITICAL: Early return if wallet is not ready - placed AFTER all hooks to comply with React rules
  if (!walletReady) {
    return (
      <div className="swap-screen">
        <div className="swap-header">
          <button className="back-button" onClick={onBack}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <h2>Swap</h2>
        </div>
        <div className="swap-body" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: 40, minHeight: 200 }}>
          <div className="spinner" />
          <span style={{ marginTop: 12, color: 'var(--text-muted)' }}>Loading wallet...</span>
        </div>
      </div>
    );
  }

  const handleFromAmountChange = (value) => {
    // Reject negative values
    if (value.startsWith('-') || parseFloat(value) < 0) {
      return;
    }
    setFromAmount(value);
    setError('');
  };

  const handleSwapTokens = () => {
    // Helper to get latest balance for a token
    const getLatestBalance = (t) => {
      if (!t) return 0;
      // For native token, use wallet balance
      if (t.symbol === nativeSymbol || t.mint === 'native' || t.isNative) {
        return walletBalance;
      }
      // Check userTokens for the most current balance
      const userToken = filteredUserTokens?.find(ut => 
        ut.mint === t.mint || ut.symbol === t.symbol
      );
      if (userToken) {
        return parseFloat(userToken.balance || userToken.uiAmount) || 0;
      }
      // Check tokens list
      const tokenInList = tokens.find(lt => lt.mint === t.mint || lt.symbol === t.symbol);
      if (tokenInList?.balance) {
        return tokenInList.balance;
      }
      return t.balance || 0;
    };
    
    // Swap with updated balances
    const newFromToken = toToken ? { ...toToken, balance: getLatestBalance(toToken) } : null;
    const newToToken = fromToken ? { ...fromToken, balance: getLatestBalance(fromToken) } : null;
    
    setFromToken(newFromToken);
    setToToken(newToToken);
    setFromAmount('');
    setToAmount('');
    setQuote(null);
    setError('');
  };

  const setMaxAmount = () => {
    // Leave a small amount for gas (0.002 SOL is plenty for most transactions)
    const gasReserve = 0.002;
    const rawMax = fromToken.symbol === nativeSymbol 
      ? Math.max(0, (fromToken.balance || walletBalance) - gasReserve) 
      : (fromToken.balance || 0);
    // Round to token's decimals (default 9) to avoid floating point artifacts
    const decimals = fromToken.decimals || 9;
    const maxAmount = Math.floor(rawMax * Math.pow(10, decimals)) / Math.pow(10, decimals);
    handleFromAmountChange(maxAmount.toString());
  };

  // Add custom token
  const handleAddToken = async () => {
    if (!newTokenAddress.trim()) return;
    
    setAddingToken(true);
    setError('');
    
    try {
      const mintAddress = newTokenAddress.trim();
      
      // Validate it's a valid address (basic check)
      if (mintAddress.length < 32 || mintAddress.length > 50) {
        throw new Error('Invalid token address');
      }
      
      // Check if already exists by mint address
      if (customTokens.find(t => t.mint === mintAddress)) {
        throw new Error('Token already added');
      }
      
      if (tokens.find(t => t.mint === mintAddress)) {
        throw new Error('Token already exists in list');
      }
      
      logger.log('[AddToken] Fetching metadata for:', mintAddress);
      
      // Try to fetch token metadata from RPC
      let tokenInfo = {
        symbol: mintAddress.slice(0, 4).toUpperCase(),
        name: 'Unknown Token',
        mint: mintAddress,
        logoURI: null,
        decimals: 9,
        isCustom: true
      };
      
      // Try to get token info from RPC/metadata
      try {
        const fetchedInfo = await fetchTokenMetadata(networkConfig.rpcUrl, mintAddress, currentNetwork);
        logger.log('[AddToken] Fetched metadata:', fetchedInfo);
        if (fetchedInfo) {
          tokenInfo = {
            symbol: fetchedInfo.symbol || tokenInfo.symbol,
            name: fetchedInfo.name || tokenInfo.name,
            mint: mintAddress,
            logoURI: fetchedInfo.logoURI || null,
            decimals: fetchedInfo.decimals || 9,
            isToken2022: fetchedInfo.isToken2022 || false,
            isCustom: true
          };
        }
      } catch (e) {
        logger.warn('[AddToken] Could not fetch token metadata:', e);
        // Token might still exist, just can't get metadata
        // Check if it's a valid account on chain
        try {
          const checkResponse = await fetch(networkConfig.rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'getAccountInfo',
              params: [mintAddress, { encoding: 'base64' }]
            })
          });
          const checkData = await checkResponse.json();
          if (!checkData.result?.value) {
            throw new Error('Token not found on this network');
          }
        } catch (checkErr) {
          throw new Error('Token not found on this network');
        }
      }
      
      // If Solana, also try Jupiter for better metadata
      if (isSolana && (!tokenInfo.logoURI || tokenInfo.name === 'Unknown Token')) {
        try {
          const response = await fetch(`https://lite-api.jup.ag/tokens/v2/tag?query=verified`);
          const jupTokens = await response.json();
          const found = jupTokens.find(t => (t.id || t.address) === mintAddress);
          if (found) {
            tokenInfo = {
              symbol: found.symbol,
              name: found.name,
              mint: found.id || found.address,
              logoURI: found.icon || found.logoURI,
              decimals: found.decimals,
              isCustom: true
            };
          }
        } catch (e) {
          logger.warn('[AddToken] Could not fetch Jupiter token info:', e);
        }
      }
      
      // Now check if token with same symbol already exists (only if we got metadata)
      if (tokenInfo.symbol && tokenInfo.symbol.length < 10) {
        const existsBySymbol = tokens.find(t => t.symbol === tokenInfo.symbol && t.mint !== mintAddress) || 
                               customTokens.find(t => t.symbol === tokenInfo.symbol && t.mint !== mintAddress);
        if (existsBySymbol) {
          throw new Error(`Token ${tokenInfo.symbol} already exists in list`);
        }
      }
      
      logger.log('[AddToken] Adding token:', tokenInfo);
      
      const newCustomTokens = [...customTokens, tokenInfo];
      setCustomTokens(newCustomTokens);
      saveCustomTokens(currentNetwork, newCustomTokens);
      
      // Add to available tokens
      setTokens(prev => [...prev, { ...tokenInfo, balance: 0 }]);
      
      setNewTokenAddress('');
    } catch (err) {
      logger.error('[AddToken] Error:', err.message || err);
      setError(err.message || 'Failed to add token. Please verify the address.');
    } finally {
      setAddingToken(false);
    }
  };

  // Remove custom token
  const handleRemoveToken = (mint) => {
    const newCustomTokens = customTokens.filter(t => t.mint !== mint);
    setCustomTokens(newCustomTokens);
    saveCustomTokens(currentNetwork, newCustomTokens);
    setTokens(prev => prev.filter(t => t.mint !== mint || !t.isCustom));
  };

  // Show confirmation screen before executing swap
  const showSwapConfirm = () => {
    // Validate inputs
    if (!fromAmount || parseFloat(fromAmount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    
    // Only require quote for non-wrap operations
    if (!isWrapOperation && !quote) {
      setError('Please wait for quote');
      return;
    }

    if (parseFloat(fromAmount) > (fromToken?.balance || 0)) {
      setError('Insufficient balance');
      return;
    }

    // Show confirmation screen
    setError('');
    setShowConfirm(true);
  };

  // Execute the actual swap after user confirms
  const handleSwap = async () => {
    logger.log('[Swap] Executing swap...');
    logger.log('[Swap] isHardwareWallet:', isHardwareWallet);
    logger.log('[Swap] wallet?.wallet?.isHardware:', wallet?.wallet?.isHardware);
    logger.log('[Swap] wallet?.activeWallet?.isHardware:', wallet?.activeWallet?.isHardware);
    logger.log('[Swap] wallet?.isHardware:', wallet?.isHardware);
    logger.log('[Swap] wallet structure:', JSON.stringify(Object.keys(wallet || {})));
    logger.log('[Swap] wallet.wallet structure:', JSON.stringify(Object.keys(wallet?.wallet || {})));

    setLoading(true);
    setSwapStatus('confirming');
    setError('');
    setHwStatus('');

    // Debug: Log wallet structure (keys only, no values)
    logger.log('[Swap] === BUILD VERSION: 2025-01-05-hw-v2 ===');
    logger.log('[Swap] Wallet object keys:', Object.keys(wallet || {}));
    logger.log('[Swap] wallet.wallet keys:', Object.keys(wallet?.wallet || {}));

    try {
      // Get public key from the sanitized wallet object
      const walletPublicKey = wallet?.wallet?.publicKey || wallet?.activeAddress?.publicKey;
      const privateKey = wallet?.wallet?.privateKey || wallet?.activeAddress?.privateKey;
      
      logger.log('[Swap] Found publicKey:', walletPublicKey ? walletPublicKey.slice(0, 8) + '...' : 'null');
      logger.log('[Swap] privateKey available:', !!privateKey);
      logger.log('[Swap] Final isHardwareWallet check:', isHardwareWallet);
      
      // Validate wallet public key
      if (!walletPublicKey || typeof walletPublicKey !== 'string') {
        throw new Error('Could not find wallet public key');
      }
      
      // Safety check: ensure it's not a mnemonic (contains spaces = multiple words)
      if (walletPublicKey.includes(' ')) {
        logger.error('[Swap] SECURITY: Detected mnemonic instead of public key!');
        throw new Error('Invalid wallet address format');
      }
      
      // Base58 addresses should be 32-44 characters
      if (walletPublicKey.length < 32 || walletPublicKey.length > 50) {
        logger.error('[Swap] Invalid wallet address length:', walletPublicKey.length);
        throw new Error('Invalid wallet address');
      }
      
      // For software wallets, require private key
      // For hardware wallets, we don't need private key
      if (!isHardwareWallet && !privateKey) {
        logger.error('[Swap] No private key and not hardware wallet!');
        throw new Error('Wallet private key not available');
      }

      // Handle wrap/unwrap specially - build transaction directly
      if (isWrapOperation) {
        console.log('[Swap] Starting wrap operation:', wrapDirection);
        console.log('[Swap] networkConfig.rpcUrl:', networkConfig?.rpcUrl);
        console.log('[Swap] isHardwareWallet:', isHardwareWallet);
        
        try {
          let signature;
          
          if (isHardwareWallet) {
            // Hardware wallet wrap/unwrap
            setHwStatus('Connecting to Ledger...');
            
            if (!hardwareWallet.isReady()) {
              await hardwareWallet.connect('hid');
              await hardwareWallet.openApp();
            }
            
            setHwStatus('Please confirm on your Ledger...');
            
            if (wrapDirection === 'wrap') {
              signature = await createWrapTransactionHardware({
                owner: walletPublicKey,
                amount: parseFloat(fromAmount),
                rpcUrl: networkConfig.rpcUrl,
                hardwareWallet
              });
            } else {
              signature = await createUnwrapTransactionHardware({
                owner: walletPublicKey,
                amount: parseFloat(fromAmount),
                rpcUrl: networkConfig.rpcUrl,
                hardwareWallet
              });
            }
            setHwStatus('');
          } else {
            // Software wallet wrap/unwrap
            // Decode private key if needed
            let secretKey = privateKey;
            
            if (typeof privateKey === 'string') {
              const { decodeBase58 } = await import('@x1-wallet/core/utils/base58');
              secretKey = decodeBase58(privateKey);
            }
            
            if (wrapDirection === 'wrap') {
              // Wrap: native XNT -> WXNT
              signature = await createWrapTransaction({
                owner: walletPublicKey,
                amount: parseFloat(fromAmount),
                rpcUrl: networkConfig.rpcUrl,
                privateKey: secretKey
              });
            } else {
              // Unwrap: WXNT -> native XNT
              signature = await createUnwrapTransaction({
                owner: walletPublicKey,
                amount: parseFloat(fromAmount),
                rpcUrl: networkConfig.rpcUrl,
                privateKey: secretKey
              });
            }
          }
          
          console.log('[Swap] Transaction sent:', signature);
          
          // Log the transaction
          addTransaction({
            signature,
            type: wrapDirection === 'wrap' ? 'wrap' : 'unwrap',
            amount: parseFloat(fromAmount),
            symbol: fromToken.symbol,
            toSymbol: toToken.symbol,
            toAmount: parseFloat(toAmount),
            from: walletPublicKey,
            to: walletPublicKey,
            timestamp: Date.now(),
            status: 'confirmed',
            network: currentNetwork,
            isSwap: true
          });
          
          setTxHash(signature);
          setSwapStatus('success');
          setShowConfirm(false);
          
          // Refresh balance immediately
          if (wallet.refreshBalance) {
            wallet.refreshBalance();
          }
          
          // Capture amounts before reset
          const swappedFromAmount = parseFloat(fromAmount);
          const swappedToAmount = parseFloat(toAmount);
          const swappedFromToken = { ...fromToken };
          const swappedToToken = { ...toToken };
          
          setLoading(false);
          
          // Trigger parent refresh and update balances after a short delay
          setTimeout(() => {
            // Trigger parent refresh
            if (onSwapComplete) onSwapComplete();
            
            // Update local token balances
            setTokens(prev => prev.map(t => {
              if (t.symbol === swappedFromToken.symbol || t.mint === swappedFromToken.mint) {
                return { ...t, balance: Math.max(0, (t.balance || 0) - swappedFromAmount) };
              }
              if (t.symbol === swappedToToken.symbol || t.mint === swappedToToken.mint) {
                return { ...t, balance: (t.balance || 0) + swappedToAmount };
              }
              return t;
            }));
          }, 2000);
          
          return;
        } catch (wrapErr) {
          // Detailed error logging
          console.error('[Swap] RAW ERROR:', wrapErr);
          console.error('[Swap] Error type:', typeof wrapErr);
          console.error('[Swap] Error message:', wrapErr?.message);
          console.error('[Swap] Error stack:', wrapErr?.stack);
          
          // Extract error message
          let errorMsg = 'Transaction failed';
          if (wrapErr?.message) {
            errorMsg = wrapErr.message;
          } else if (typeof wrapErr === 'string') {
            errorMsg = wrapErr;
          }
          
          setError(`${wrapDirection === 'wrap' ? 'Wrap' : 'Unwrap'} failed: ${errorMsg}`);
          setLoading(false);
          setSwapStatus('');
          return;
        }
      }
      
      // Regular swap flow - only for non-wrap operations
      // XDEX API uses this address for native tokens on all networks
      const NATIVE_TOKEN_ADDRESS = 'So11111111111111111111111111111111111111112';
      
      // Determine token identifiers - use native address for native tokens, mint for SPL
      let tokenInParam = fromToken.symbol;
      let tokenOutParam = toToken.symbol;
      
      // Check if tokens are native or have specific mints
      const isFromNative = fromToken.mint === 'native' || fromToken.isNative || !fromToken.mint || fromToken.mint.startsWith('native_');
      const isToNative = toToken.mint === 'native' || toToken.isNative || !toToken.mint || toToken.mint.startsWith('native_');
      
      // Set tokenInParam - WXNT uses the wrapped SOL mint address
      if (fromToken.symbol === 'WXNT') {
        tokenInParam = NATIVE_TOKEN_ADDRESS; // WXNT uses So111... mint
      } else if (isFromNative) {
        tokenInParam = NATIVE_TOKEN_ADDRESS;
      } else if (fromToken.mint) {
        tokenInParam = fromToken.mint;
      }
      
      // Set tokenOutParam - WXNT uses the wrapped SOL mint address
      if (toToken.symbol === 'WXNT') {
        tokenOutParam = NATIVE_TOKEN_ADDRESS; // WXNT uses So111... mint
      } else if (isToNative) {
        tokenOutParam = NATIVE_TOKEN_ADDRESS;
      } else if (toToken.mint) {
        tokenOutParam = toToken.mint;
      }
      
      logger.log('[Swap] Preparing with tokens:', { tokenIn: tokenInParam, tokenOut: tokenOutParam, slippage });
      
      // Convert slippage percentage to basis points (0.5% = 50 bps)
      const slippageBps = Math.round(slippage * 100);
      
      // Prepare the swap transaction
      const txData = await prepareSwap(
        walletPublicKey,
        tokenInParam,
        tokenOutParam,
        parseFloat(fromAmount),
        currentNetwork,
        slippageBps
      );

      logger.log('[Swap] Transaction prepared:', txData);

      // Get transaction data - XDEX API may return it in various formats
      // It can be a single base64 string OR an array of base64 strings (for ATA creation + swap)
      let transactions = [];
      
      // Check for array of transactions (ATA creation + swap scenario)
      if (Array.isArray(txData?.data?.transaction)) {
        transactions = txData.data.transaction;
        logger.log('[Swap] Received array of', transactions.length, 'transactions');
      } else if (Array.isArray(txData?.transaction)) {
        transactions = txData.transaction;
        logger.log('[Swap] Received array of', transactions.length, 'transactions');
      }
      // Single string transaction
      else if (typeof txData?.transaction === 'string') {
        transactions = [txData.transaction];
      } else if (typeof txData?.data?.transaction === 'string') {
        transactions = [txData.data.transaction];
      }
      // Object with serializedTransaction field
      else if (typeof txData?.transaction?.serializedTransaction === 'string') {
        transactions = [txData.transaction.serializedTransaction];
      } else if (typeof txData?.data?.transaction?.serializedTransaction === 'string') {
        transactions = [txData.data.transaction.serializedTransaction];
      }
      // Try swapTransaction field (Jupiter API style)
      else if (typeof txData?.swapTransaction === 'string') {
        transactions = [txData.swapTransaction];
      } else if (typeof txData?.data?.swapTransaction === 'string') {
        transactions = [txData.data.swapTransaction];
      }
      
      if (transactions.length === 0) {
        // Log the full response structure for debugging
        logger.error('[Swap] Could not find transaction string in response');
        logger.error('[Swap] Full API response:', JSON.stringify(txData));
        throw new Error('No transaction data received from API');
      }
      
      // Validate all transactions are strings
      for (let i = 0; i < transactions.length; i++) {
        if (typeof transactions[i] !== 'string') {
          logger.error('[Swap] Transaction', i, 'is not a string:', typeof transactions[i]);
          throw new Error('Invalid transaction format from API');
        }
      }
      
      logger.log('[Swap] Processing', transactions.length, 'transaction(s)');
      logger.log('[Swap] isHardwareWallet:', isHardwareWallet);
      logger.log('[Swap] Private key available:', !!privateKey);

      // Sign and send all transactions in order
      let lastSignature = null;
      
      if (isHardwareWallet) {
        // Hardware wallet signing
        setHwStatus('Connecting to Ledger...');
        
        if (!hardwareWallet.isReady()) {
          await hardwareWallet.connect('hid');
          await hardwareWallet.openApp();
        }
        
        for (let i = 0; i < transactions.length; i++) {
          const tx = transactions[i];
          logger.log(`[Swap] Signing transaction ${i + 1}/${transactions.length} with Ledger`);
          
          setHwStatus(`Please confirm transaction ${i + 1}/${transactions.length} on your Ledger...`);
          
          try {
            const signature = await signAndSendExternalTransactionHardware(
              tx,
              hardwareWallet,
              networkConfig.rpcUrl
            );
            
            logger.log(`[Swap] Transaction ${i + 1} sent! Signature:`, signature);
            lastSignature = signature;
            
            if (i < transactions.length - 1) {
              setHwStatus('Waiting for confirmation...');
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          } catch (txErr) {
            logger.error(`[Swap] Transaction ${i + 1} failed:`, txErr);
            if (i === 0 && transactions.length > 1) {
              logger.log('[Swap] ATA creation may have failed (account might exist), trying swap transaction...');
              continue;
            }
            throw txErr;
          }
        }
        setHwStatus('');
      } else {
        // Software wallet signing
        for (let i = 0; i < transactions.length; i++) {
          const tx = transactions[i];
          logger.log(`[Swap] Signing transaction ${i + 1}/${transactions.length}, length:`, tx.length);
          logger.log('[Swap] Transaction preview:', tx.substring(0, 80) + '...');
          
          try {
            const signature = await signAndSendExternalTransaction(
              tx,
              privateKey,
              networkConfig.rpcUrl
            );
            
            logger.log(`[Swap] Transaction ${i + 1} sent! Signature:`, signature);
            lastSignature = signature;
            
            // If there are more transactions, wait a bit for the first one to be confirmed
            if (i < transactions.length - 1) {
              logger.log('[Swap] Waiting for transaction to be processed before next...');
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          } catch (txErr) {
            logger.error(`[Swap] Transaction ${i + 1} failed:`, txErr);
            // If it's the ATA creation tx and it fails, the account might already exist
            // Try to continue with the next transaction
            if (i === 0 && transactions.length > 1) {
              logger.log('[Swap] ATA creation may have failed (account might exist), trying swap transaction...');
              continue;
            }
            throw txErr;
          }
        }
      }
      
      if (!lastSignature) {
        throw new Error('No transactions were successfully sent');
      }
      
      const signature = lastSignature;
      logger.log('[Swap] All transactions complete! Final signature:', signature);
      
      // Log the transaction to activity - use wrap/unwrap type if applicable
      addTransaction({
        signature,
        type: isWrapOperation ? wrapDirection : 'swap',
        amount: parseFloat(fromAmount),
        symbol: fromToken.symbol,
        toSymbol: toToken.symbol,
        toAmount: parseFloat(toAmount),
        from: walletPublicKey,
        to: walletPublicKey,
        timestamp: Date.now(),
        status: 'confirmed',
        network: currentNetwork,
        isSwap: true
      });
      
      // Track XP for the swap (fire and forget, don't block UI)
      trackSwapXP({
        user: walletPublicKey,
        network: currentNetwork,
        transactionSignature: signature,
        inputMint: tokenInParam,
        outputMint: tokenOutParam,
        inputAmount: parseFloat(fromAmount),
        outputAmount: parseFloat(toAmount)
      }).then(result => {
        if (result?.success) {
          logger.log('[Swap] XP tracked successfully');
        }
      }).catch(err => {
        logger.warn('[Swap] XP tracking failed:', err);
      });
      
      setTxHash(signature);
      setSwapStatus('success');
      setShowConfirm(false);
      
      // Refresh balance immediately
      if (wallet.refreshBalance) {
        wallet.refreshBalance();
      }
      
      // Capture amounts before reset
      const swappedFromAmount = parseFloat(fromAmount);
      const swappedToAmount = parseFloat(toAmount);
      const swappedFromToken = { ...fromToken };
      const swappedToToken = { ...toToken };
      
      // Reset form after success and trigger refresh
      setTimeout(() => {
        // Trigger parent refresh (fetches new token balances)
        if (onSwapComplete) {
          onSwapComplete();
        }
        
        // Update local token balances using captured values
        setTokens(prev => prev.map(t => {
          if (t.symbol === swappedFromToken.symbol || t.mint === swappedFromToken.mint) {
            return { ...t, balance: Math.max(0, (t.balance || 0) - swappedFromAmount) };
          }
          if (t.symbol === swappedToToken.symbol || t.mint === swappedToToken.mint) {
            return { ...t, balance: (t.balance || 0) + swappedToAmount };
          }
          return t;
        }));
        
        // Update fromToken and toToken balances using captured values
        setFromToken(prev => {
          if (!prev) return prev;
          if (prev.symbol === swappedFromToken.symbol || prev.mint === swappedFromToken.mint) {
            return { ...prev, balance: Math.max(0, (prev.balance || 0) - swappedFromAmount) };
          }
          return prev;
        });
        setToToken(prev => {
          if (!prev) return prev;
          if (prev.symbol === swappedToToken.symbol || prev.mint === swappedToToken.mint) {
            return { ...prev, balance: (prev.balance || 0) + swappedToAmount };
          }
          return prev;
        });
        
      }, 2000);

    } catch (err) {
      logger.error('[Swap] Error:', err);
      logger.error('[Swap] Error message:', err?.message);
      logger.error('[Swap] Error details:', JSON.stringify(err, Object.getOwnPropertyNames(err)));
      
      // Parse specific error types for better user messaging
      let userMessage = err?.message || getUserFriendlyError(err, ErrorMessages.swap.failed);
      
      // Check for XDEX fee account creation error (backend issue)
      if (userMessage.includes('Failed to create fee token account')) {
        userMessage = 'Swap service temporarily unavailable. The XDEX API is experiencing issues with fee account creation. Please try again later or contact XDEX support.';
      }
      // Check for insufficient lamports error (user's account)
      else if (userMessage.includes('insufficient lamports')) {
        const match = userMessage.match(/insufficient lamports (\d+), need (\d+)/);
        if (match) {
          const have = parseInt(match[1]) / 1e9;
          const need = parseInt(match[2]) / 1e9;
          const shortfall = (need - have).toFixed(6);
          userMessage = `Insufficient SOL for transaction fees. You need approximately ${shortfall} more SOL to cover token account creation costs. Please add more SOL and try again.`;
        } else {
          userMessage = 'Insufficient SOL for transaction fees. Please add more SOL to cover network fees and token account creation costs.';
        }
      }
      // Check for simulation failure
      else if (userMessage.includes('Simulation failed') || userMessage.includes('custom program error')) {
        // Check for specific error codes
        if (userMessage.includes('0x1787') || userMessage.includes('6023')) {
          // Jupiter/Raydium error - usually route or liquidity issue
          userMessage = 'Swap route expired or liquidity changed. Please try again. If the issue persists, try a smaller amount or different slippage.';
        } else if (userMessage.includes('0x1786') || userMessage.includes('6022')) {
          userMessage = 'Invalid market state. The liquidity pool may be temporarily unavailable. Please try again later.';
        } else if (userMessage.includes('0x1') && !userMessage.includes('0x1786') && !userMessage.includes('0x1787')) {
          userMessage = 'Slippage tolerance exceeded. Try increasing slippage or reducing the swap amount.';
        } else if (userMessage.includes('0x0')) {
          userMessage = 'Transaction simulation failed. This may be a temporary API issue. Please try again in a few minutes.';
        } else {
          // Extract error code if present for debugging
          const errorCodeMatch = userMessage.match(/0x[0-9a-fA-F]+/);
          const errorCode = errorCodeMatch ? ` (Error: ${errorCodeMatch[0]})` : '';
          userMessage = `Swap failed${errorCode}. This may be due to network congestion, expired quote, or liquidity changes. Please try again.`;
        }
      }
      // Check for blockhash errors (quote expired)
      else if (userMessage.includes('blockhash') || userMessage.includes('Blockhash')) {
        userMessage = 'Transaction expired. Please try again - quotes are time-sensitive.';
      }
      
      setError(userMessage);
      setSwapStatus('error');
    } finally {
      setLoading(false);
    }
  };

  // Token icon component
  // TokenIcon component with error handling via React state
  const TokenIcon = ({ token, size = 24 }) => {
    const [imgError, setImgError] = React.useState(false);
    const logoSize = Math.round(size * 0.8); // 80% of container
    
    if (!token) return null;
    
    // Use X1Logo component for XNT/native X1 token
    if (token.symbol === 'XNT' || (token.symbol === nativeSymbol && !isSolana)) {
      return <X1Logo size={size} />;
    }
    
    // Use logoURI if available and not errored
    if (token.logoURI && !imgError) {
      return (
        <div style={{
          width: size,
          height: size,
          minWidth: size,
          minHeight: size,
          borderRadius: '50%',
          background: '#000',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          flexShrink: 0
        }}>
          <img 
            src={token.logoURI} 
            alt={token.symbol}
            style={{ 
              width: logoSize, 
              height: logoSize, 
              objectFit: 'contain'
            }}
            onError={() => setImgError(true)}
          />
        </div>
      );
    }
    
    // Fallback to letter placeholder
    return (
      <div style={{ 
        width: size, 
        height: size, 
        fontSize: size * 0.4,
        background: '#000000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '50%',
        color: 'white',
        fontWeight: 600,
        flexShrink: 0
      }}>
        {token.symbol?.[0] || '?'}
      </div>
    );
  };

  // Filter tokens based on search
  const filteredTokens = tokens.filter(t => {
    if (!tokenSearchQuery) return true;
    const q = tokenSearchQuery.toLowerCase();
    return t.symbol.toLowerCase().includes(q) || 
           t.name?.toLowerCase().includes(q) ||
           t.mint?.toLowerCase().includes(q);
  });

  // Get tokens available for "from" selection (user's holdings + native)
  const fromTokenOptions = filteredTokens.filter(t => {
    // Show native token always
    if (t.symbol === nativeSymbol) return true;
    // Show tokens user has balance for
    if (t.balance > 0) return true;
    // Show custom tokens
    if (t.isCustom) return true;
    return false;
  });

  // Manage Tokens Screen
  if (showManageTokens) {
    const handleClearAllCustomTokens = () => {
      logger.log('[ClearAll] Clearing all custom tokens for network:', currentNetwork);
      
      // Clear from localStorage completely
      try {
        const stored = localStorage.getItem(CUSTOM_TOKENS_KEY);
        if (stored) {
          const all = JSON.parse(stored);
          delete all[currentNetwork];
          localStorage.setItem(CUSTOM_TOKENS_KEY, JSON.stringify(all));
          logger.log('[ClearAll] Cleared from localStorage');
        }
      } catch (e) {
        logger.error('[ClearAll] Error clearing localStorage:', e);
      }
      
      // Clear state
      setCustomTokens([]);
      
      // Get base swap tokens (non-custom)
      getSwapTokens(currentNetwork).then(baseTokens => {
        // Only keep base tokens that aren't marked as custom
        const cleanTokens = baseTokens.filter(t => !t.isCustom);
        
        // Add balances from user tokens
        const tokensWithBalances = cleanTokens.map(token => {
          if (token.symbol === nativeSymbol || token.mint === 'native') {
            return { ...token, balance: walletBalance };
          }
          const userToken = userTokens.find(ut => ut.mint === token.mint || ut.symbol === token.symbol);
          return { 
            ...token, 
            balance: userToken ? parseFloat(userToken.balance || userToken.uiAmount) : 0
          };
        });
        
        setTokens(tokensWithBalances);
        logger.log('[ClearAll] Reset to base tokens:', tokensWithBalances.length);
      });
      
      setConfirmClearAll(false);
    };
    
    return (
      <div className="screen swap-screen">
        <div className="page-header">
          <div className="header-left">
            <button className="back-btn" onClick={() => { setShowManageTokens(false); setConfirmClearAll(false); }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
          <h2 className="header-title">Manage Tokens</h2>
          <div className="header-right">
            {customTokens.length > 0 && !confirmClearAll && (
              <button 
                className="header-btn"
                onClick={() => setConfirmClearAll(true)}
                style={{ color: '#ff3b30', fontSize: 12 }}
              >
                Clear All
              </button>
            )}
            {confirmClearAll && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button 
                  onClick={handleClearAllCustomTokens}
                  style={{
                    background: '#ff3b30',
                    border: 'none',
                    color: 'white',
                    fontSize: 11,
                    cursor: 'pointer',
                    padding: '4px 10px',
                    borderRadius: 4
                  }}
                >
                  Confirm
                </button>
                <button 
                  onClick={() => setConfirmClearAll(false)}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-muted)',
                    fontSize: 11,
                    cursor: 'pointer',
                    padding: '4px 10px',
                    borderRadius: 4
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="slide-panel-content">
          {/* Add Token Input */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6, display: 'block' }}>
              Add Token by Address
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                placeholder="Token mint address..."
                value={newTokenAddress}
                onChange={e => setNewTokenAddress(e.target.value)}
                style={{
                  flex: 1,
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  color: 'var(--text-primary)',
                  fontSize: 13
                }}
              />
              <button
                onClick={handleAddToken}
                disabled={addingToken || !newTokenAddress.trim()}
                style={{
                  background: 'var(--x1-blue)',
                  border: 'none',
                  borderRadius: 8,
                  padding: '10px 16px',
                  color: 'white',
                  fontWeight: 600,
                  cursor: 'pointer',
                  opacity: addingToken || !newTokenAddress.trim() ? 0.5 : 1
                }}
              >
                {addingToken ? '...' : 'Add'}
              </button>
            </div>
          </div>

          {error && (
            <div style={{ 
              background: 'rgba(255, 59, 48, 0.1)', 
              border: '1px solid rgba(255, 59, 48, 0.3)',
              borderRadius: 8,
              padding: '10px 12px',
              marginBottom: 16,
              color: '#ff3b30',
              fontSize: 13
            }}>
              {error}
            </div>
          )}

          {/* Custom Tokens List */}
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            Custom Tokens ({customTokens.length})
          </div>
          
          {customTokens.length === 0 ? (
            <div style={{ 
              padding: 20, 
              textAlign: 'center', 
              color: 'var(--text-muted)',
              fontSize: 13
            }}>
              No custom tokens added yet
              <div style={{ marginTop: 12 }}>
                <button
                  onClick={() => {
                    forceResetCustomTokens();
                    setCustomTokens([]);
                    getSwapTokens(currentNetwork).then(baseTokens => {
                      setTokens(baseTokens.map(t => ({
                        ...t,
                        balance: t.symbol === nativeSymbol ? walletBalance : 0
                      })));
                    });
                  }}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border-color)',
                    borderRadius: 6,
                    padding: '6px 12px',
                    color: 'var(--text-muted)',
                    fontSize: 11,
                    cursor: 'pointer'
                  }}
                >
                  Reset Token Cache
                </button>
              </div>
            </div>
          ) : (
            customTokens.map((token, i) => (
              <div 
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px',
                  background: 'var(--bg-secondary)',
                  borderRadius: 8,
                  marginBottom: 8
                }}
              >
                <TokenIcon token={token} size={40} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{token.symbol}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                    {token.mint.slice(0, 8)}...{token.mint.slice(-6)}
                  </div>
                </div>
                <button
                  onClick={() => handleRemoveToken(token.mint)}
                  style={{
                    background: 'rgba(255, 59, 48, 0.15)',
                    border: 'none',
                    borderRadius: 6,
                    padding: '6px 12px',
                    color: '#ff3b30',
                    fontSize: 12,
                    cursor: 'pointer'
                  }}
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // Token Selection Screen
  if (selectingToken) {
    // Determine which tokens to show
    let displayTokens = [];
    
    if (tokenSearchQuery.length >= 2) {
      // Show search results if searching
      if (searchResults.length > 0) {
        displayTokens = searchResults;
      } else if (!searching) {
        // Show filtered local tokens
        displayTokens = selectingToken === 'from' 
          ? fromTokenOptions.filter(t => t.symbol !== toToken?.symbol)
          : filteredTokens.filter(t => t.symbol !== fromToken?.symbol);
      }
    } else {
      // No search query - show normal list
      displayTokens = selectingToken === 'from' 
        ? fromTokenOptions.filter(t => t.symbol !== toToken?.symbol)
        : filteredTokens.filter(t => t.symbol !== fromToken?.symbol);
    }

    const handleSelectToken = (token) => {
      // Add to custom tokens if from search results and not already in any list
      const isFromSearch = searchResults.find(t => t.mint === token.mint);
      const existsInTokens = tokens.find(t => t.mint === token.mint || t.symbol === token.symbol);
      const existsInCustom = customTokens.find(t => t.mint === token.mint || t.symbol === token.symbol);
      
      if (isFromSearch && !existsInTokens && !existsInCustom) {
        const newCustomTokens = [...customTokens, { ...token, isCustom: true }];
        setCustomTokens(newCustomTokens);
        saveCustomTokens(currentNetwork, newCustomTokens);
        setTokens(prev => [...prev, { ...token, balance: 0, isCustom: true }]);
      }
      
      // Always look up the most current balance from userTokens or tokens list
      const getLatestBalance = (t) => {
        // For native token, use wallet balance
        if (t.symbol === nativeSymbol || t.mint === 'native' || t.isNative) {
          return walletBalance;
        }
        // Check userTokens for the most current balance
        const userToken = filteredUserTokens?.find(ut => 
          ut.mint === t.mint || ut.symbol === t.symbol
        );
        if (userToken) {
          return parseFloat(userToken.balance || userToken.uiAmount) || 0;
        }
        // Check tokens list
        const tokenInList = tokens.find(lt => lt.mint === t.mint || lt.symbol === t.symbol);
        if (tokenInList?.balance) {
          return tokenInList.balance;
        }
        // Fall back to token's own balance or 0
        return t.balance || 0;
      };
      
      const latestBalance = getLatestBalance(token);
      
      if (selectingToken === 'from') {
        setFromToken({ ...token, balance: latestBalance });
      } else {
        setToToken({ ...token, balance: latestBalance });
      }
      setSelectingToken(null);
      setTokenSearchQuery('');
      setSearchResults([]);
      setFromAmount('');
      setToAmount('');
      setQuote(null);
    };

    return (
      <div className="screen swap-screen">
        <div className="page-header">
          <div className="header-left">
            <button className="back-btn" onClick={() => { setSelectingToken(null); setTokenSearchQuery(''); setSearchResults([]); }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
          <h2 className="header-title">Select Token</h2>
          <div className="header-right">
            <button 
              className="header-btn primary"
              onClick={() => { setSelectingToken(null); setShowManageTokens(true); setTokenSearchQuery(''); setSearchResults([]); }}
              title="Add Token"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
        </div>
        <div className="slide-panel-content" style={{ padding: '16px 20px 24px' }}>
          {/* Search - negative margins to match grid width */}
          <div style={{ margin: '0 -20px 16px', padding: '0 16px' }}>
            <input
              type="text"
              placeholder="Search by name, symbol, or paste address..."
              value={tokenSearchQuery}
              onChange={e => setTokenSearchQuery(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: 8,
                padding: '10px 12px',
                color: 'var(--text-primary)',
                fontSize: 14,
                boxSizing: 'border-box'
              }}
            />
          </div>
          
          {/* Token list wrapper - negative margins to go edge to edge */}
          <div style={{ margin: '0 -20px' }}>
          
          {/* Search Status */}
          {searching && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, gap: 8 }}>
              <div className="spinner-small" />
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Searching...</span>
            </div>
          )}
          
          {/* Search hint for address */}
          {tokenSearchQuery.length >= 2 && !searching && searchResults.length === 0 && isTokenAddress(tokenSearchQuery) && (
            <div style={{ 
              padding: '12px 20px', 
              background: 'rgba(2, 116, 251, 0.1)', 
              fontSize: 12,
              color: 'var(--text-muted)'
            }}>
              Looking up token by address...
            </div>
          )}
          
          {/* Search Results */}
          {searchResults.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '12px 16px 8px', fontWeight: 600 }}>
                Search Results ({searchResults.length})
              </div>
              {searchResults.map((token, i) => (
                <div 
                  key={token.mint || i}
                  className={`token-select-option ${(selectingToken === 'from' ? fromToken : toToken)?.symbol === token.symbol ? 'selected' : ''}`}
                  onClick={() => handleSelectToken(token)}
                >
                  <div className="token-select-icon">
                    <TokenIcon token={token} size={32} />
                  </div>
                  <div className="token-select-info">
                    <span className="token-select-symbol">{token.symbol}</span>
                    <span className="token-select-name">{token.name}</span>
                  </div>
                  <span className="token-select-balance">
                    {formatBalance(token.balance || 0)}
                  </span>
                </div>
              ))}
            </>
          )}
          
          {/* Your Tokens Section - tokens with balance */}
          {!searching && !tokenSearchQuery && (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '12px 16px 8px', fontWeight: 600, marginTop: searchResults.length > 0 ? 8 : 0 }}>
                Your Tokens
              </div>
              {fromTokenOptions.filter(t => t.symbol !== (selectingToken === 'from' ? toToken : fromToken)?.symbol).map((token, i) => (
                <div 
                  key={token.mint || `wallet-${i}`}
                  className={`token-select-option ${(selectingToken === 'from' ? fromToken : toToken)?.symbol === token.symbol ? 'selected' : ''}`}
                  onClick={() => handleSelectToken(token)}
                >
                  <div className="token-select-icon">
                    <TokenIcon token={token} size={32} />
                  </div>
                  <div className="token-select-info">
                    <span className="token-select-symbol">
                      {token.symbol}
                      {(token.isNative || token.mint === 'native') && <span className="token-badge spl" style={{ marginLeft: 6 }}>Native</span>}
                      {token.isToken2022 && <span className="token-badge token-2022" style={{ marginLeft: 6 }}>Token-2022</span>}
                    </span>
                    <span className="token-select-name">{token.name}</span>
                  </div>
                  <span className="token-select-balance">
                    {formatBalance(token.balance || 0)}
                  </span>
                  {token.isCustom && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRemoveToken(token.mint); }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        padding: '4px',
                        cursor: 'pointer',
                        color: '#ff3b30',
                        marginLeft: 4
                      }}
                      title="Remove token"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
              
              {fromTokenOptions.filter(t => t.symbol !== (selectingToken === 'from' ? toToken : fromToken)?.symbol).length === 0 && (
                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                  No tokens in wallet
                </div>
              )}
            </>
          )}
          
          {/* All Tokens Section - pool tokens from API (only for "to" selector) */}
          {!searching && !tokenSearchQuery && selectingToken === 'to' && (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '12px 16px 8px', fontWeight: 600 }}>
                All Tokens {poolTokens.length > 0 && `(${poolTokens.length})`}
              </div>
              {poolTokensLoading && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, gap: 8 }}>
                  <div className="spinner-small" />
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading tokens...</span>
                </div>
              )}
              {!poolTokensLoading && poolTokens.length > 0 && poolTokens
                .filter(t => {
                  // Don't show if it's the currently selected fromToken
                  if (fromToken?.symbol === t.symbol || fromToken?.mint === t.mint) return false;
                  // Don't show if already in wallet with balance
                  const inWallet = fromTokenOptions.find(wt => 
                    (wt.mint && t.mint && wt.mint === t.mint) || 
                    (wt.symbol === t.symbol && wt.balance > 0)
                  );
                  return !inWallet;
                })
                .map((token, i) => (
                <div 
                  key={token.mint || `pool-${i}`}
                  className={`token-select-option ${toToken?.symbol === token.symbol ? 'selected' : ''}`}
                  onClick={() => handleSelectToken(token)}
                >
                  <div className="token-select-icon">
                    <TokenIcon token={token} size={32} />
                  </div>
                  <div className="token-select-info">
                    <span className="token-select-symbol">{token.symbol}</span>
                    <span className="token-select-name">{token.name}</span>
                  </div>
                </div>
              ))}
              {!poolTokensLoading && poolTokens.length === 0 && (
                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                  No additional tokens available
                </div>
              )}
            </>
          )}
          
          {/* Filtered search through local tokens */}
          {!searching && tokenSearchQuery.length >= 2 && searchResults.length === 0 && (
            <>
              {displayTokens.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '12px 16px 8px', fontWeight: 600 }}>
                  Matching Tokens
                </div>
              )}
              {displayTokens.map((token, i) => (
                <div 
                  key={token.mint || i}
                  className={`token-select-option ${(selectingToken === 'from' ? fromToken : toToken)?.symbol === token.symbol ? 'selected' : ''}`}
                  onClick={() => handleSelectToken(token)}
                >
                  <div className="token-select-icon">
                    <TokenIcon token={token} size={32} />
                  </div>
                  <div className="token-select-info">
                    <span className="token-select-symbol">
                      {token.symbol}
                      {(token.isNative || token.mint === 'native') && <span className="token-badge spl" style={{ marginLeft: 6 }}>Native</span>}
                      {token.isToken2022 && <span className="token-badge token-2022" style={{ marginLeft: 6 }}>Token-2022</span>}
                      {token.isCustom && <span className="token-badge spl" style={{ marginLeft: 6 }}>Custom</span>}
                    </span>
                    <span className="token-select-name">{token.name}</span>
                  </div>
                  <span className="token-select-balance">
                    {formatBalance(token.balance || 0)}
                  </span>
                  {token.isCustom && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRemoveToken(token.mint); }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        padding: '4px',
                        cursor: 'pointer',
                        color: '#ff3b30',
                        marginLeft: 4
                      }}
                      title="Remove token"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
              {displayTokens.length === 0 && (
                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                  No tokens found for "{tokenSearchQuery}"
                </div>
              )}
            </>
          )}
          
          </div>{/* End token list wrapper */}
        </div>
      </div>
    );
  }

  // Loading state
  if (!fromToken || !toToken) {
    return (
      <div className="screen swap-screen">
        <div className="slide-panel-header">
          <button className="back-btn" onClick={onBack}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <h2>Swap</h2>
        </div>
        <div className="slide-panel-content" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  // Success screen
  if (swapStatus === 'success') {
    return (
      <div className="screen swap-screen">
        <div className="page-header">
          <h2 className="header-title">Swap</h2>
        </div>
        <div className="slide-panel-content">
          <div className="send-step-content send-success">
            <div className="success-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <h2 className="send-success-title">
              {isWrapOperation ? (wrapDirection === 'wrap' ? 'Wrapped!' : 'Unwrapped!') : 'Swapped!'}
            </h2>
            <p className="send-success-amount">{fromAmount} {fromToken?.symbol}</p>
            <p className="send-success-to">to {toAmount} {toToken?.symbol}</p>
            
            {txHash && (
              <button 
                className="btn-secondary" 
                onClick={() => window.open(`${networkConfig.explorerTx}/${txHash}`, '_blank')}
                style={{ marginTop: 16 }}
              >
                View on Explorer
              </button>
            )}
            <button 
              className="btn-primary" 
              onClick={() => {
                setSwapStatus('');
                setTxHash('');
                setFromAmount('');
                setToAmount('');
                setQuote(null);
              }} 
              style={{ marginTop: 12 }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Confirmation screen
  if (showConfirm) {
    return (
      <div className="screen swap-screen">
        <div className="page-header">
          <div className="header-left">
            <button className="back-btn" onClick={() => setShowConfirm(false)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
            </button>
          </div>
          <h2 className="header-title">Confirm {isWrapOperation ? (wrapDirection === 'wrap' ? 'Wrap' : 'Unwrap') : 'Swap'}</h2>
          <div className="header-right" />
        </div>
        <div className="slide-panel-content">
          <div className="send-step-content">
            {/* Transaction Summary */}
            <div className="send-summary-card">
              <div className="send-summary-row">
                <span className="send-summary-label">From</span>
                <span className="send-summary-value">{fromAmount} {fromToken?.symbol}</span>
              </div>
              <div className="send-summary-row">
                <span className="send-summary-label">To</span>
                <span className="send-summary-value">{toAmount} {toToken?.symbol}</span>
              </div>
              {!isWrapOperation && (
                <div className="send-summary-row">
                  <span className="send-summary-label">Rate</span>
                  <span className="send-summary-value">
                    1 {fromToken?.symbol} ≈ {(parseFloat(toAmount) / parseFloat(fromAmount)).toFixed(6)} {toToken?.symbol}
                  </span>
                </div>
              )}
              {isWrapOperation && (
                <div className="send-summary-row">
                  <span className="send-summary-label">Type</span>
                  <span className="send-summary-value" style={{ color: '#34c759' }}>
                    1:1 {wrapDirection === 'wrap' ? 'Wrap' : 'Unwrap'}
                  </span>
                </div>
              )}
              <div className="send-summary-row">
                <span className="send-summary-label">Network Fee</span>
                <span className="send-summary-value">
                  ~{(0.000005 + (swapPriority === 'custom' ? parseFloat(customFee) || 0 : PRIORITY_OPTIONS.find(p => p.id === swapPriority)?.fee || 0)).toFixed(6)} {networkConfig.symbol}
                </span>
              </div>
            </div>

            {/* Priority Selector */}
            <div className="send-priority-section">
              <div className="send-priority-label">Transaction Priority</div>
              <div className="send-priority-selector">
                {PRIORITY_OPTIONS.filter(opt => opt.id !== 'custom').map(opt => (
                  <button
                    key={opt.id}
                    className={`send-priority-btn ${swapPriority === opt.id ? 'active' : ''}`}
                    onClick={() => { setSwapPriority(opt.id); setCustomFee(''); }}
                    type="button"
                    disabled={loading}
                  >
                    {opt.name}
                  </button>
                ))}
                <button
                  className={`send-priority-btn ${swapPriority === 'custom' ? 'active' : ''}`}
                  onClick={() => setSwapPriority('custom')}
                  type="button"
                  disabled={loading}
                >
                  ⚙
                </button>
              </div>
              
              {/* Custom Fee Input - only show when custom selected */}
              {swapPriority === 'custom' && (
                <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <input
                    type="number"
                    min="0"
                    style={{
                      width: 100,
                      padding: '8px 12px',
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 8,
                      color: 'var(--text-primary)',
                      fontSize: 13,
                      textAlign: 'right'
                    }}
                    placeholder="0.0001"
                    value={customFee}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value.startsWith('-') || parseFloat(value) < 0) return;
                      setCustomFee(value);
                    }}
                    step="0.0001"
                    disabled={loading}
                  />
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{networkConfig.symbol}</span>
                </div>
              )}
            </div>

            {/* Slippage Settings - only for non-wrap operations */}
            {!isWrapOperation && (
              <div className="send-priority-section" style={{ marginTop: 16 }}>
                <div className="send-priority-label">Slippage Tolerance</div>
                <div className="send-priority-selector">
                  {slippageOptions.map(opt => (
                    <button
                      key={opt}
                      className={`send-priority-btn ${slippage === opt && !customSlippage ? 'active' : ''}`}
                      onClick={() => {
                        setSlippage(opt);
                        setCustomSlippage('');
                      }}
                      type="button"
                    >
                      {opt}%
                    </button>
                  ))}
                  <button
                    className={`send-priority-btn ${customSlippage ? 'active' : ''}`}
                    onClick={() => {
                      const input = document.getElementById('slippage-custom-input');
                      if (input) input.focus();
                    }}
                    type="button"
                    style={{ padding: 0, minWidth: 60 }}
                  >
                    <input
                      id="slippage-custom-input"
                      type="number"
                      min="0"
                      value={customSlippage}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val.startsWith('-') || parseFloat(val) < 0) return;
                        setCustomSlippage(val);
                        if (val && !isNaN(parseFloat(val))) {
                          setSlippage(parseFloat(val));
                        }
                      }}
                      placeholder="Custom"
                      style={{
                        width: '100%',
                        padding: '8px 4px',
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--text-primary)',
                        fontSize: 12,
                        textAlign: 'center',
                        outline: 'none'
                      }}
                    />
                  </button>
                </div>
                {slippage > 5 && (
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--warning)', textAlign: 'center' }}>
                    ⚠️ High slippage may result in unfavorable trades
                  </div>
                )}
              </div>
            )}

            {error && <div className="error-message" style={{ marginTop: 16 }}>{error}</div>}

            {/* Action Buttons */}
            <div className="send-confirm-actions">
              <button 
                className="btn-secondary send-deny-btn"
                onClick={() => {
                  setShowConfirm(false);
                  setError('');
                }}
                disabled={loading}
              >
                Deny
              </button>
              <button 
                className="btn-primary send-approve-btn"
                onClick={handleSwap}
                disabled={loading}
              >
                {loading ? 'Processing...' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Main Swap Form
  return (
    <div className="screen swap-screen">
      <div className="page-header">
        <h2 className="header-title">Swap</h2>
        <div className="header-right" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button 
            className="header-btn primary"
            onClick={() => setShowManageTokens(true)}
            title="Add Token"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>

      <div className="slide-panel-content">
        {/* Loading state when wallet is not ready */}
        {!walletReady ? (
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: 40, minHeight: 200 }}>
            <div className="spinner" />
            <span style={{ marginTop: 12, color: 'var(--text-muted)' }}>Loading wallet...</span>
          </div>
        ) : (
          <>
        {/* Error Message */}
        {error && (
          <div style={{ 
            background: 'rgba(255, 59, 48, 0.1)', 
            border: '1px solid rgba(255, 59, 48, 0.3)',
            borderRadius: 8,
            padding: '10px 12px',
            marginBottom: 16,
            color: '#ff3b30',
            fontSize: 13
          }}>
            {error}
          </div>
        )}

        {/* Success Message */}
        {swapStatus === 'success' && (
          <div style={{ 
            background: 'rgba(52, 199, 89, 0.1)', 
            border: '1px solid rgba(52, 199, 89, 0.3)',
            borderRadius: 8,
            padding: '10px 12px',
            marginBottom: 16,
            color: '#34c759',
            fontSize: 13
          }}>
            ✓ Swap successful!
          </div>
        )}

        {/* From Token */}
        <div className="swap-box">
          <div className="swap-box-header">
            <span>Balance</span>
            <span className="swap-balance" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {formatBalance(fromToken.balance || 0)} {fromToken.symbol}
              {(fromToken.balance || 0) > 0 && (
                <button 
                  onClick={setMaxAmount}
                  disabled={loading}
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
                >
                  MAX
                </button>
              )}
            </span>
          </div>
          <div className="swap-box-main">
            <div className="swap-token-icon" onClick={() => !loading && setSelectingToken('from')}>
              <TokenIcon token={fromToken} size={32} />
            </div>
            <div className="swap-token-info" onClick={() => !loading && setSelectingToken('from')}>
              <span className="swap-token-symbol">
                {fromToken.symbol}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </span>
              <span className="swap-token-name">{fromToken.name}</span>
            </div>
            <div className="swap-input-area">
              <input
                type="number"
                min="0"
                className="swap-amount-input"
                placeholder={quoteLoading && inputMode === 'to' ? '...' : '0.00'}
                value={quoteLoading && inputMode === 'to' ? '' : fromAmount}
                onChange={e => {
                  const value = e.target.value;
                  // Reject negative values
                  if (value.startsWith('-') || parseFloat(value) < 0) return;
                  setInputMode('from');
                  handleFromAmountChange(value);
                }}
                onFocus={() => setInputMode('from')}
                disabled={loading}
              />
            </div>
          </div>
        </div>

        {/* Swap Direction Button */}
        <div className="swap-direction-wrapper">
          <button className="swap-direction-btn" onClick={handleSwapTokens} disabled={loading} title="Swap direction">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 10l5-5 5 5" />
              <path d="M7 14l5 5 5-5" />
            </svg>
          </button>
        </div>

        {/* To Token */}
        <div className="swap-box">
          <div className="swap-box-header">
            <span>Balance</span>
            <span className="swap-balance">{formatBalance(toToken.balance || 0)} {toToken.symbol}</span>
          </div>
          <div className="swap-box-main">
            <div className="swap-token-icon" onClick={() => !loading && setSelectingToken('to')}>
              <TokenIcon token={toToken} size={32} />
            </div>
            <div className="swap-token-info" onClick={() => !loading && setSelectingToken('to')}>
              <span className="swap-token-symbol">
                {toToken.symbol}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </span>
              <span className="swap-token-name">{toToken.name}</span>
            </div>
            <div className="swap-input-area">
              <input
                type="number"
                min="0"
                className="swap-amount-input"
                placeholder={quoteLoading && inputMode === 'from' ? '...' : '0.00'}
                value={quoteLoading && inputMode === 'from' ? '' : toAmount}
                onChange={(e) => {
                  const value = e.target.value;
                  // Reject negative values
                  if (value.startsWith('-') || parseFloat(value) < 0) return;
                  setInputMode('to');
                  setToAmount(value);
                }}
                onFocus={() => setInputMode('to')}
              />
            </div>
          </div>
        </div>

        {/* Swap Details - Above button */}
        {quote && fromAmount && toAmount && (
          <div className="swap-details" style={{ marginTop: 16 }}>
            {/* Stats Row */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 8,
              padding: '8px 0',
              marginBottom: 0
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
                  {isWrapOperation ? 'Type' : 'Rate'}
                </div>
                <div style={{ fontSize: 11, fontWeight: 500 }}>
                  {isWrapOperation ? (
                    <span style={{ color: '#34c759' }}>1:1 {wrapDirection === 'wrap' ? 'Wrap' : 'Unwrap'}</span>
                  ) : (
                    `1 ${fromToken.symbol} ≈ ${(parseFloat(toAmount) / parseFloat(fromAmount)).toFixed(2)} ${toToken.symbol}`
                  )}
                </div>
              </div>
              <div style={{ textAlign: 'center', borderLeft: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Price Impact</div>
                <div style={{ 
                  fontSize: 11, 
                  fontWeight: 500,
                  color: (() => {
                    if (isWrapOperation) return '#34c759';
                    
                    // Only calculate 1:1 impact for pegged pairs (XNT/WXNT, XNT/pXNT, WXNT/pXNT)
                    const xntVariants = ['XNT', 'WXNT', 'pXNT'];
                    const fromIsXntVariant = xntVariants.includes(fromToken?.symbol);
                    const toIsXntVariant = xntVariants.includes(toToken?.symbol);
                    const isPeggedPair = fromIsXntVariant && toIsXntVariant;
                    
                    let impact = 0;
                    if (isPeggedPair) {
                      // For pegged pairs, impact is deviation from 1:1
                      const actualRate = parseFloat(toAmount) / parseFloat(fromAmount);
                      if (actualRate > 0) {
                        impact = Math.abs(1 - actualRate);
                      }
                    } else {
                      // For non-pegged pairs, use API price impact (includes fees/slippage)
                      let apiImpact = quote?.data?.priceImpactPct || quote?.priceImpact || quote?.data?.price_impact || 0;
                      // API returns as percentage (e.g., 2.38 for 2.38%)
                      if (apiImpact > 0) {
                        impact = apiImpact / 100;
                      }
                    }
                    
                    // Green (<1%), orange (1-5%), red (>5%)
                    if (impact < 0.01) return '#34c759';
                    if (impact < 0.05) return '#ff9500';
                    return '#ff3b30';
                  })()
                }}>
                  {(() => {
                    if (isWrapOperation) return '0%';
                    
                    // Only calculate 1:1 impact for pegged pairs (XNT/WXNT, XNT/pXNT, WXNT/pXNT)
                    const xntVariants = ['XNT', 'WXNT', 'pXNT'];
                    const fromIsXntVariant = xntVariants.includes(fromToken?.symbol);
                    const toIsXntVariant = xntVariants.includes(toToken?.symbol);
                    const isPeggedPair = fromIsXntVariant && toIsXntVariant;
                    
                    let impact = 0;
                    if (isPeggedPair) {
                      // For pegged pairs, impact is deviation from 1:1
                      const actualRate = parseFloat(toAmount) / parseFloat(fromAmount);
                      if (actualRate > 0) {
                        impact = Math.abs(1 - actualRate);
                      }
                    } else {
                      // For non-pegged pairs, use API price impact (includes fees/slippage)
                      let apiImpact = quote?.data?.priceImpactPct || quote?.priceImpact || quote?.data?.price_impact || 0;
                      // API returns as percentage (e.g., 2.38 for 2.38%)
                      if (apiImpact > 0) {
                        impact = apiImpact / 100;
                      }
                    }
                    
                    return `${(impact * 100).toFixed(2)}%`;
                  })()}
                </div>
              </div>
              <div style={{ textAlign: 'center', borderLeft: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Est. Gas</div>
                <div style={{ fontSize: 11, fontWeight: 500 }}>~0.0002 {nativeSymbol}</div>
              </div>
              <div 
                style={{ 
                  textAlign: 'center', 
                  borderLeft: '1px solid var(--border-color)',
                  cursor: isWrapOperation ? 'default' : 'pointer'
                }}
                onClick={() => !isWrapOperation && setShowSlippageSettings(true)}
                title={isWrapOperation ? '' : 'Click to change slippage'}
              >
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Slippage</div>
                <div style={{ 
                  fontSize: 11, 
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4
                }}>
                  {isWrapOperation ? 'N/A' : `${slippage}%`}
                  {!isWrapOperation && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                  )}
                </div>
              </div>
            </div>

            {/* Route Visualization */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '8px 0'
            }}>
              {/* From Token */}
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 6,
                background: 'var(--bg-secondary)',
                padding: '6px 10px',
                borderRadius: 8
              }}>
                <TokenIcon token={fromToken} size={20} />
                <span style={{ fontSize: 12, fontWeight: 500 }}>{fromToken.symbol}</span>
              </div>
              
              {/* Arrow */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              
              {/* Pool */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'var(--bg-secondary)',
                padding: '6px 10px',
                borderRadius: 8
              }}>
                <span style={{ fontSize: 12, fontWeight: 500 }}>Pool</span>
              </div>
              
              {/* Arrow */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              
              {/* To Token */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'var(--bg-secondary)',
                padding: '6px 10px',
                borderRadius: 8
              }}>
                <TokenIcon token={toToken} size={20} />
                <span style={{ fontSize: 12, fontWeight: 500 }}>{toToken.symbol}</span>
              </div>
            </div>
          </div>
        )}

        {/* Review Button */}
        <div className="send-bottom-action">
          <button 
            className="btn-primary"
            onClick={showSwapConfirm}
            disabled={loading || quoteLoading || !fromAmount || parseFloat(fromAmount) <= 0 || (!isWrapOperation && !quote)}
          >
            {loading ? (
              swapStatus === 'confirming' ? 'Confirming...' : 'Processing...'
            ) : quoteLoading ? (
              'Getting Quote...'
            ) : !quote && !isWrapOperation && fromAmount ? (
              'No Route Found'
            ) : isWrapOperation ? (
              `${wrapDirection === 'wrap' ? 'Wrap' : 'Unwrap'} XNT`
            ) : (
              'Review Swap'
            )}
          </button>
        </div>
          </>
        )}
      </div>
    </div>
  );
}