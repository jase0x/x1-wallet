// TokenDetail.jsx - Token information screen with price and market data
import React, { useState, useEffect } from 'react';
import X1Logo from './X1Logo';
import { NETWORKS } from '@x1-wallet/core/services/networks';
import { logger } from '@x1-wallet/core';

// API endpoints
const JUPITER_PRICE_API = 'https://price.jup.ag/v6/price';
const COINGECKO_API = 'https://api.coingecko.com/api/v3/simple/price';

// =======================================================
// XNT PRICE CONFIGURATION
// Currently pegged to $1.00 USD
// TODO: Replace with oracle price feed when available
// =======================================================
const XNT_PEGGED_PRICE = 1.00;

/**
 * Get the current XNT price
 * Currently returns the pegged price of $1.00
 * Future: This will fetch from an oracle price feed
 * 
 * @returns {number} The current XNT price in USD
 */
const getXNTPrice = () => {
  // TODO: Replace with oracle integration
  return XNT_PEGGED_PRICE;
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
  }, [mint, symbol, network]);

  // Fetch Solana token price from multiple sources with fallbacks
  const fetchSolanaPrice = async () => {
    const tokenAddress = mint || 'So11111111111111111111111111111111111111112'; // SOL native
    const isNativeSOL = !mint || tokenAddress === 'So11111111111111111111111111111111111111112';
    
    let price = null;
    
    // Try Jupiter API first
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
      
      if (isNative) {
        // =======================================================
        // XNT PRICE SOURCE - Currently pegged to $1.00
        // TODO: Replace with oracle price feed when available
        // Future implementation:
        //   const oraclePrice = await fetchOraclePrice('XNT');
        //   price = oraclePrice;
        // =======================================================
        price = getXNTPrice();
      } else if (symbol === 'USDC.X' || symbol === 'USDC' || symbol === 'USDT') {
        // Stablecoins are pegged to $1.00
        price = 1.00;
      } else if (symbol === 'pXNT') {
        // pXNT (staked XNT) is pegged 1:1 with XNT
        price = getXNTPrice();
      } else if (symbol === 'WXNT') {
        // Wrapped XNT is pegged 1:1 with XNT
        price = getXNTPrice();
      } else if (mint) {
        // For other X1 tokens, try to get price from XDEX pools
        const response = await fetch(`${XDEX_API}/pools`);
        
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

  // Format currency
  const formatUsd = (value) => {
    if (value === null || value === undefined || isNaN(value)) return '--';
    if (value < 0.0001) return `$${value.toFixed(8)}`;
    if (value < 0.01) return `$${value.toFixed(6)}`;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
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
              <img src="https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png" alt="SOL" className="token-detail-header-icon" />
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
                  <img src="https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png" alt="SOL" className="token-balance-icon" />
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