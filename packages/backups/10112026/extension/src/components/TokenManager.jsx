// Token Manager - Add and manage custom tokens
import { logger, getUserFriendlyError, ErrorMessages } from '@x1-wallet/core';
import React, { useState, useEffect } from 'react';
import X1Logo from './X1Logo';

const DEFAULT_TOKENS = [
  { symbol: 'XNT', name: 'X1 Native Token', address: 'native', decimals: 9, logo: 'x1', isNative: true },
  { symbol: 'USDC', name: 'USD Coin', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6, logo: null },
  { symbol: 'USDT', name: 'Tether USD', address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6, logo: null },
  { symbol: 'WETH', name: 'Wrapped ETH', address: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', decimals: 8, logo: null },
];

export default function TokenManager({ wallet, onBack, onTokensChange }) {
  const [view, setView] = useState('list'); // list, add, details
  const [tokens, setTokens] = useState([]);
  const [selectedToken, setSelectedToken] = useState(null);
  const [newToken, setNewToken] = useState({ address: '', symbol: '', name: '', decimals: 9 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Load tokens from storage
    const saved = localStorage.getItem('x1wallet_tokens');
    if (saved) {
      setTokens(JSON.parse(saved));
    } else {
      setTokens(DEFAULT_TOKENS);
    }
  }, []);

  const saveTokens = (newTokens) => {
    setTokens(newTokens);
    localStorage.setItem('x1wallet_tokens', JSON.stringify(newTokens));
    if (onTokensChange) onTokensChange(newTokens);
  };

  const handleAddToken = async () => {
    if (!newToken.address) {
      setError('Please enter a token address');
      return;
    }

    // Check if already exists
    if (tokens.find(t => t.address.toLowerCase() === newToken.address.toLowerCase())) {
      setError('Token already added');
      return;
    }

    setLoading(true);
    setError('');

    // In real implementation, would fetch token metadata from chain
    setTimeout(() => {
      const tokenToAdd = {
        ...newToken,
        symbol: newToken.symbol || 'UNKNOWN',
        name: newToken.name || 'Unknown Token',
        decimals: newToken.decimals || 9,
        logo: null,
        isCustom: true
      };

      saveTokens([...tokens, tokenToAdd]);
      setNewToken({ address: '', symbol: '', name: '', decimals: 9 });
      setView('list');
      setLoading(false);
    }, 1000);
  };

  const handleRemoveToken = (token) => {
    if (token.isNative) return;
    const newTokens = tokens.filter(t => t.address !== token.address);
    saveTokens(newTokens);
    setView('list');
    setSelectedToken(null);
  };

  const handleToggleToken = (token) => {
    const newTokens = tokens.map(t => 
      t.address === token.address ? { ...t, hidden: !t.hidden } : t
    );
    saveTokens(newTokens);
  };

  // Add Token Form
  if (view === 'add') {
    return (
      <div className="screen token-manager">
        <div className="slide-panel-header">
          <button className="back-btn" onClick={() => { setView('list'); setError(''); }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <h2>Add Token</h2>
        </div>
        <div className="slide-panel-content">
          <div className="form-group">
            <label>Token Address</label>
            <input
              type="text"
              className="form-input"
              placeholder="Enter token contract address"
              value={newToken.address}
              onChange={e => setNewToken({ ...newToken, address: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label>Symbol (optional)</label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g. USDC"
              value={newToken.symbol}
              onChange={e => setNewToken({ ...newToken, symbol: e.target.value.toUpperCase() })}
            />
          </div>

          <div className="form-group">
            <label>Name (optional)</label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g. USD Coin"
              value={newToken.name}
              onChange={e => setNewToken({ ...newToken, name: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label>Decimals</label>
            <input
              type="number"
              min="0"
              className="form-input"
              placeholder="9"
              value={newToken.decimals}
              onChange={e => {
                const value = e.target.value;
                if (value.startsWith('-') || parseFloat(value) < 0) return;
                setNewToken({ ...newToken, decimals: parseInt(value) || 9 });
              }}
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <button className="btn-primary" onClick={handleAddToken} disabled={loading}>
            {loading ? 'Adding...' : 'Add Token'}
          </button>
        </div>
      </div>
    );
  }

  // Token Details
  if (view === 'details' && selectedToken) {
    return (
      <div className="screen token-manager">
        <div className="slide-panel-header">
          <button className="back-btn" onClick={() => { setView('list'); setSelectedToken(null); }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <h2>Token Details</h2>
        </div>
        <div className="slide-panel-content">
          <div className="token-details-header">
            <div className="token-details-icon">
              {selectedToken.symbol === 'XNT' ? (
                <X1Logo size={56} />
              ) : (
                <div className="token-icon-large">{selectedToken.symbol[0]}</div>
              )}
            </div>
            <h3>{selectedToken.name}</h3>
            <span className="token-details-symbol">{selectedToken.symbol}</span>
          </div>

          <div className="token-details-info">
            <div className="detail-row">
              <span className="detail-label">Contract Address</span>
              <span className="detail-value mono">{selectedToken.isNative ? 'Native Token' : `${selectedToken.address.slice(0, 12)}...${selectedToken.address.slice(-8)}`}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Decimals</span>
              <span className="detail-value">{selectedToken.decimals}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">Type</span>
              <span className="detail-value">{selectedToken.isNative ? 'Native' : selectedToken.isCustom ? 'Custom' : 'Verified'}</span>
            </div>
          </div>

          {!selectedToken.isNative && (
            <button className="btn-danger" onClick={() => handleRemoveToken(selectedToken)}>
              Remove Token
            </button>
          )}
        </div>
      </div>
    );
  }

  // Token List
  return (
    <div className="screen token-manager">
      <div className="slide-panel-header">
        <button className="back-btn" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <h2>Manage Tokens</h2>
      </div>
      <div className="slide-panel-content">
        <button className="add-token-btn" onClick={() => setView('add')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v8M8 12h8" />
          </svg>
          Add Custom Token
        </button>

        <div className="token-list-manage">
          {tokens.filter(t => !t.hidden).map((token, i) => (
            <div key={i} className="token-manage-item" onClick={() => { setSelectedToken(token); setView('details'); }}>
              <div className="token-manage-icon">
                {token.symbol === 'XNT' ? (
                  <X1Logo size={36} />
                ) : (
                  <div className="token-icon-placeholder">{token.symbol[0]}</div>
                )}
              </div>
              <div className="token-manage-info">
                <span className="token-manage-symbol">{token.symbol}</span>
                <span className="token-manage-name">{token.name}</span>
              </div>
              <div className="token-manage-actions">
                {!token.isNative && (
                  <button 
                    className="toggle-visibility-btn"
                    onClick={(e) => { e.stopPropagation(); handleToggleToken(token); }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      {token.hidden ? (
                        <>
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </>
                      ) : (
                        <>
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </>
                      )}
                    </svg>
                  </button>
                )}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}