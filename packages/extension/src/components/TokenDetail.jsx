// TokenDetail.jsx - Token information screen with price and market data
import React, { useState, useEffect } from 'react';
import X1Logo from './X1Logo';
import { NETWORKS } from '@x1-wallet/core/services/networks';
import { logger } from '@x1-wallet/core';

// API endpoints
const JUPITER_PRICE_API = 'https://price.jup.ag/v6/price';
const COINGECKO_API = 'https://api.coingecko.com/api/v3/simple/price';
const XDEX_API = 'https://api.xdex.xyz/api/xendex';
const XDEX_DEVAPI = 'https://devapi.xdex.xyz/api/xendex';

// =======================================================
// XNT PRICE - Fetched from XDEX swap/quote API
// =======================================================

/**
 * Get the current XNT price from cache or fetch from API
 * @param {string} network - Network name
 * @returns {Promise<number>} The current XNT price in USD
 */
const getXNTPrice = async (network = 'X1 Mainnet') => {
  // Check cache first
  try {
    const cached = localStorage.getItem('x1wallet_xnt_price');
    if (cached) {
      const { price, timestamp } = JSON.parse(cached);
      // Use cache if less than 5 minutes old
      if (Date.now() - timestamp < 5 * 60 * 1000 && price > 0) {
        return price;
      }
    }
  } catch {}
  
  // Fetch from XDEX swap/quote (1 XNT -> USDC.X)
  try {
    const USDC_X_MINT = 'B69chRzqzDCmdB5WYB8NRu5Yv5ZA95ABiZcdzCgGm9Tq';
    const NATIVE_MINT = 'So11111111111111111111111111111111111111112';
    
    // Use full network name
    const networkName = network || 'X1 Mainnet';
    
    const params = new URLSearchParams({
      network: networkName,
      token_in: NATIVE_MINT,
      token_out: USDC_X_MINT,
      token_in_amount: '1',
      is_exact_amount_in: 'true'
    });
    
    const response = await fetch(`${XDEX_API}/swap/quote?${params}`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000)
    });
    
    if (response.ok) {
      const data = await response.json();
      // API returns: { success: true, data: { rate: 0.547, outputAmount: 0.547, ... } }
      const price = parseFloat(data?.data?.rate || data?.data?.outputAmount || data?.rate || data?.outputAmount || 0);
      
      if (price > 0 && price < 1000) {
        // Cache the price
        localStorage.setItem('x1wallet_xnt_price', JSON.stringify({
          price,
          timestamp: Date.now()
        }));
        logger.log('[TokenDetail] XNT price from XDEX:', price);
        return price;
      }
    }
  } catch (e) {
    logger.warn('[TokenDetail] Failed to fetch XNT price:', e.message);
  }
  
  // Fallback - no price available
  return null;
};

export default function TokenDetail({ 
  token, 
  wallet, 
  onBack, 
  onSend, 
  onReceive, 
  onSwap,
  onBridge,
  onStake
}) {
  const [currentPrice, setCurrentPrice] = useState(null);
  const [priceChange24h, setPriceChange24h] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mintCopied, setMintCopied] = useState(false);
  
  // Currency setting - read from localStorage
  const [currency, setCurrency] = useState(() => {
    try {
      const saved = localStorage.getItem('x1wallet_currency');
      const parsed = saved ? JSON.parse(saved) : 'USD';
      return parsed === 'NATIVE' ? 'USD' : parsed;
    } catch {
      return 'USD';
    }
  });
  
  // Listen for currency changes
  useEffect(() => {
    const checkCurrency = () => {
      try {
        const saved = localStorage.getItem('x1wallet_currency');
        let newCurrency = saved ? JSON.parse(saved) : 'USD';
        if (newCurrency === 'NATIVE') newCurrency = 'USD';
        if (newCurrency !== currency) {
          setCurrency(newCurrency);
        }
      } catch {}
    };
    
    window.addEventListener('storage', checkCurrency);
    window.addEventListener('focus', checkCurrency);
    return () => {
      window.removeEventListener('storage', checkCurrency);
      window.removeEventListener('focus', checkCurrency);
    };
  }, [currency]);
  
  // Currency configuration - use cached live rates
  const getExchangeRates = () => {
    try {
      const cached = localStorage.getItem('x1wallet_exchange_rates');
      if (cached) {
        const { rates } = JSON.parse(cached);
        return rates;
      }
    } catch {}
    // Fallback rates
    return { EUR: 0.92, GBP: 0.79, PLN: 4.02, JPY: 156, CAD: 1.44, AUD: 1.57, CNY: 7.24, KRW: 1380 };
  };
  
  const exchangeRates = getExchangeRates();
  
  const currencyInfo = {
    USD: { symbol: '$', position: 'before', rate: 1 },
    EUR: { symbol: '€', position: 'before', rate: exchangeRates.EUR },
    GBP: { symbol: '£', position: 'before', rate: exchangeRates.GBP },
    PLN: { symbol: 'zł', position: 'after', rate: exchangeRates.PLN },
    JPY: { symbol: '¥', position: 'before', rate: exchangeRates.JPY },
    CAD: { symbol: 'C$', position: 'before', rate: exchangeRates.CAD },
    AUD: { symbol: 'A$', position: 'before', rate: exchangeRates.AUD },
    CNY: { symbol: '¥', position: 'before', rate: exchangeRates.CNY },
    KRW: { symbol: '₩', position: 'before', rate: exchangeRates.KRW }
  };

  // Network config
  const network = wallet?.network || 'X1 Mainnet';
  const networkConfig = NETWORKS[network] || {
    symbol: 'XNT',
    decimals: 9,
    explorer: 'https://explorer.x1.xyz'
  };

  // Token info
  const isNative = !token?.mint;
  const isX1Network = network.includes('X1');
  const isSolana = network.includes('Solana');
  const symbol = token?.symbol || networkConfig.symbol;
  const name = token?.name || (isSolana ? 'Solana' : 'X1 Native Token');
  const balance = parseFloat(token?.balance || token?.uiAmount || 0);
  const logoURI = token?.logoURI;
  const mint = token?.mint;

  // Fetch price data based on network
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      
      try {
        if (isSolana) {
          await fetchSolanaPrice();
        } else if (isX1Network) {
          await fetchX1Price();
        }
      } catch (err) {
        logger.error('[TokenDetail] Failed to fetch data:', err);
      }
      
      setLoading(false);
    };

    fetchData();
  }, [mint, symbol, network, token?.price]); // Added token.price to trigger updates when price becomes available

  // Fetch Solana token price from multiple sources with fallbacks
  const fetchSolanaPrice = async () => {
    const tokenAddress = mint || 'So11111111111111111111111111111111111111112'; // SOL native
    const isNativeSOL = !mint || tokenAddress === 'So11111111111111111111111111111111111111112';
    
    let price = null;
    
    // FIRST: Check if token already has a price from the tokens service (cached/XDEX)
    if (token?.price !== undefined && token?.price !== null && !isNaN(token.price)) {
      price = parseFloat(token.price);
      logger.log('[TokenDetail] Using existing token.price for Solana:', price, 'for', symbol);
    }
    
    // Try Jupiter API if no cached price
    if (!price) {
      try {
        const response = await fetch(`${JUPITER_PRICE_API}?ids=${tokenAddress}`);
        if (response.ok) {
          const data = await response.json();
          logger.log('[TokenDetail] Jupiter response:', data);
          
          if (data.data && data.data[tokenAddress]) {
            price = data.data[tokenAddress].price;
          }
        }
      } catch (e) {
        logger.warn('[TokenDetail] Jupiter fetch failed:', e.message);
      }
    }
    
    // Fallback to CoinGecko for native SOL
    if (!price && isNativeSOL) {
      try {
        const response = await fetch(`${COINGECKO_API}?ids=solana&vs_currencies=usd&include_24hr_change=true`);
        if (response.ok) {
          const data = await response.json();
          logger.log('[TokenDetail] CoinGecko response:', data);
          
          if (data.solana && data.solana.usd) {
            price = data.solana.usd;
            if (data.solana.usd_24h_change) {
              setPriceChange24h(data.solana.usd_24h_change);
            }
          }
        }
      } catch (e) {
        logger.warn('[TokenDetail] CoinGecko fetch failed:', e.message);
      }
    }
    
    // If still no price, use a reasonable fallback for SOL (will be updated on next successful fetch)
    if (!price && isNativeSOL) {
      // Fallback SOL price - this is just for display until API works
      // In production, this should be removed or use a more reliable source
      logger.warn('[TokenDetail] Using fallback SOL price');
      price = await getFallbackSolPrice();
    }
    
    if (price && price > 0) {
      setCurrentPrice(price);
      if (priceChange24h === null) {
        setPriceChange24h(0);
      }
    } else {
      logger.warn('[TokenDetail] No price data available for Solana token');
      setCurrentPrice(null);
    }
  };
  
  // Fallback price fetch using alternative methods
  const getFallbackSolPrice = async () => {
    // Try Binance public API
    try {
      const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT');
      if (response.ok) {
        const data = await response.json();
        if (data.price) {
          return parseFloat(data.price);
        }
      }
    } catch (e) {
      logger.warn('[TokenDetail] Binance fallback failed');
    }
    
    // Last resort: return null (will show "No price data")
    return null;
  };

  // Fetch X1 token price
  const fetchX1Price = async () => {
    try {
      let price = null;
      
      // FIRST: Check if token already has a price from the tokens service (cached/XDEX)
      // This is the most reliable source - prices come from XDEX wallet API
      if (token?.price !== undefined && token?.price !== null && !isNaN(token.price)) {
        price = parseFloat(token.price);
        logger.log('[TokenDetail] Using existing token.price:', price, 'for', symbol);
      }
      // Fallbacks for known tokens if no XDEX price available
      else if (isNative) {
        // XNT native token - fetch from XDEX swap/quote
        price = await getXNTPrice(network);
      } else if (symbol === 'USDC.X' || symbol === 'USDC' || symbol === 'USDT') {
        // Stablecoins are pegged to $1.00
        price = 1.00;
      } else if (symbol === 'pXNT') {
        // pXNT (staked XNT) is pegged 1:1 with XNT
        price = await getXNTPrice(network);
      } else if (symbol === 'WXNT') {
        // Wrapped XNT is pegged 1:1 with XNT
        price = await getXNTPrice(network);
      } else if (mint) {
        // For other X1 tokens, try to get price from XDEX
        // Try single token endpoint first
        try {
          const tokenResponse = await fetch(`${XDEX_API}/tokens/${mint}`, {
            signal: AbortSignal.timeout(3000)
          });
          
          if (tokenResponse.ok) {
            const tokenData = await tokenResponse.json();
            logger.log('[TokenDetail] XDEX token data for', symbol, ':', tokenData);
            
            const tokenPrice = tokenData.price ?? tokenData.priceUsd ?? tokenData.price_usd;
            if (tokenPrice !== undefined && tokenPrice !== null) {
              price = parseFloat(tokenPrice);
              logger.log('[TokenDetail] Got price from XDEX token endpoint:', price);
            }
          }
        } catch (e) {
          logger.log('[TokenDetail] XDEX token endpoint failed:', e.message);
        }
        
        // Fallback: try pools endpoint
        if (!price) {
          try {
            const response = await fetch(`${XDEX_API}/pools`, {
              signal: AbortSignal.timeout(3000)
            });
            
            if (response.ok) {
              const pools = await response.json();
              logger.log('[TokenDetail] XDEX pools:', pools?.length || 0);
              
              // Find pool for this token
              const tokenPool = pools.find(p => 
                p.tokenA?.mint === mint || p.tokenB?.mint === mint
              );
              
              if (tokenPool) {
                const isTokenA = tokenPool.tokenA?.mint === mint;
                const reserveToken = parseFloat(isTokenA ? tokenPool.reserveA : tokenPool.reserveB) || 0;
                const reserveOther = parseFloat(isTokenA ? tokenPool.reserveB : tokenPool.reserveA) || 0;
                
                if (reserveToken > 0 && reserveOther > 0) {
                  price = reserveOther / reserveToken;
                }
              }
            }
          } catch (e) {
            logger.log('[TokenDetail] XDEX pools endpoint failed:', e.message);
          }
        }
      }

      if (price && price > 0) {
        setCurrentPrice(price);
        setPriceChange24h(0);
      } else {
        setCurrentPrice(null);
      }
    } catch (e) {
      logger.error('[TokenDetail] X1 price fetch error:', e);
      setCurrentPrice(null);
    }
  };

  // Render price display (instead of chart)
  const renderPriceDisplay = () => {
    if (loading) {
      return (
        <div className="token-price-display">
          <div className="spinner-small" />
        </div>
      );
    }

    if (!currentPrice) {
      return (
        <div className="token-price-display">
          <span className="token-price-unavailable">Price unavailable</span>
        </div>
      );
    }

    return (
      <div className="token-price-display">
        <span className="token-price-label">Current Price</span>
        <span className="token-current-price">{formatUsd(currentPrice)}</span>
        {priceChange24h !== null && priceChange24h !== 0 && (
          <span className={`token-price-change ${priceChange24h >= 0 ? 'positive' : 'negative'}`}>
            {priceChange24h >= 0 ? '+' : ''}{priceChange24h.toFixed(2)}%
          </span>
        )}
      </div>
    );
  };

  // Format currency with conversion
  const formatUsd = (value) => {
    if (value === null || value === undefined || isNaN(value)) return '--';
    
    const info = currencyInfo[currency] || currencyInfo.USD;
    const convertedValue = value * (info.rate || 1);
    const decimals = (currency === 'JPY' || currency === 'KRW') ? 0 : 2;
    
    // Handle very small values
    if (convertedValue < 0.01 && decimals > 0) {
      return info.position === 'after' ? '<0.01 ' + info.symbol : '<' + info.symbol + '0.01';
    }
    
    const formatted = convertedValue.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
    
    return info.position === 'after' ? formatted + ' ' + info.symbol : info.symbol + formatted;
  };

  // Format balance
  const formatBalance = (value) => {
    if (!value || isNaN(value)) return '0';
    return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
  };

  // Calculate USD value
  const usdValue = currentPrice ? balance * currentPrice : null;

  // Open explorer
  const openExplorer = () => {
    if (mint) {
      const baseUrl = networkConfig.explorer || 'https://explorer.x1.xyz';
      const addressPath = baseUrl.includes('solscan') ? '/token/' : '/address/';
      window.open(`${baseUrl}${addressPath}${mint}`, '_blank');
    }
  };

  return (
    <div className="screen token-detail-screen">
      {/* Header */}
      <div className="page-header">
        <div className="header-left">
          <button className="back-btn" onClick={onBack}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
        <div className="token-detail-header-title">
          {isNative ? (
            isSolana ? (
              <img src="/icons/48-sol.png" alt="SOL" className="token-detail-header-icon" />
            ) : (
              <X1Logo size={24} />
            )
          ) : logoURI ? (
            <img src={logoURI} alt={symbol} className="token-detail-header-icon" />
          ) : (
            <div className="token-detail-header-initial">{symbol?.charAt(0)}</div>
          )}
          <span>{name}</span>
          <span className="token-detail-symbol">{symbol}</span>
        </div>
        <div className="header-right" />
      </div>

      {/* Content */}
      <div className="token-detail-content">
        {/* Price Section */}
        <div className="token-price-section">
          {renderPriceDisplay()}
        </div>

        {/* Action Buttons */}
        <div className="token-detail-actions">
          <button className="token-action-btn" onClick={onReceive}>
            <div className="token-action-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
            </div>
            <span>Receive</span>
          </button>
          <button className="token-action-btn" onClick={() => onSend(token)}>
            <div className="token-action-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </div>
            <span>Send</span>
          </button>
          <button className="token-action-btn" onClick={() => onSwap(token)}>
            <div className="token-action-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
                <path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
              </svg>
            </div>
            <span>Swap</span>
          </button>
          {/* Bridge for Solana */}
          {isSolana && onBridge && (
            <button className="token-action-btn" onClick={onBridge}>
              <div className="token-action-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                  <line x1="4" y1="22" x2="4" y2="15" />
                </svg>
              </div>
              <span>Bridge</span>
            </button>
          )}
          {/* Stake for native XNT */}
          {isX1Network && isNative && onStake && (
            <button className="token-action-btn" onClick={onStake}>
              <div className="token-action-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
              </div>
              <span>Stake</span>
            </button>
          )}
        </div>

        {/* Your Balance Section */}
        <div className="token-detail-section">
          <div className="token-section-header">Your Balance</div>
          <div className="token-balance-card">
            <div className="token-balance-left">
              {isNative ? (
                isSolana ? (
                  <img src="/icons/48-sol.png" alt="SOL" className="token-balance-icon" />
                ) : (
                  <X1Logo size={40} />
                )
              ) : logoURI ? (
                <img src={logoURI} alt={symbol} className="token-balance-icon" />
              ) : (
                <div className="token-balance-initial">{symbol?.charAt(0)}</div>
              )}
              <div className="token-balance-info">
                <span className="token-balance-name">{name}</span>
                <span className="token-balance-amount">{formatBalance(balance)} {symbol}</span>
              </div>
            </div>
            <div className="token-balance-right">
              <span className="token-balance-usd">{formatUsd(usdValue)}</span>
              {priceChange24h !== null && priceChange24h !== 0 && (
                <span className={`token-balance-change ${priceChange24h >= 0 ? 'positive' : 'negative'}`}>
                  {priceChange24h >= 0 ? '+' : ''}{priceChange24h.toFixed(2)}%
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Market & Additional Info */}
        <div className="token-detail-section">
          <div className="token-section-header">Market & Additional Info</div>
          <div className="token-info-card">
            {mint && (
              <div className="token-info-row" onClick={openExplorer} style={{ cursor: 'pointer' }}>
                <span className="token-info-label">Token</span>
                <span className="token-info-value token-info-link">
                  {name} ({symbol}) 
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M7 17L17 7M17 7H7M17 7v10" />
                  </svg>
                </span>
              </div>
            )}
            <div className="token-info-row">
              <span className="token-info-label">Price</span>
              <span className="token-info-value">
                {loading ? 'Loading...' : formatUsd(currentPrice)}
              </span>
            </div>
            {priceChange24h !== null && (
              <div className="token-info-row">
                <span className="token-info-label">24h Change</span>
                <span className={`token-info-value ${priceChange24h >= 0 ? 'positive' : 'negative'}`}>
                  {priceChange24h >= 0 ? '+' : ''}{priceChange24h.toFixed(2)}%
                </span>
              </div>
            )}
            {mint && (
              <div 
                className="token-info-row" 
                onClick={() => {
                  navigator.clipboard.writeText(mint);
                  setMintCopied(true);
                  setTimeout(() => setMintCopied(false), 2000);
                }} 
                style={{ cursor: 'pointer' }}
              >
                <span className="token-info-label">Mint</span>
                <span className="token-info-value token-info-address" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {mint.slice(0, 8)}...{mint.slice(-8)}
                  {mintCopied ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                    </svg>
                  )}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}