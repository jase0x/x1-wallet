import React, { useState, useEffect } from 'react';
import { logger, getUserFriendlyError, ErrorMessages } from '@x1-wallet/core';
import { getTransactionHistory, formatTransaction } from '@x1-wallet/core/utils/transaction';
import { getTxExplorerUrl } from '@x1-wallet/core/services/networks';

export function ActivityTab({ wallet, network, networkConfig }) {
  const [transactions, setTransactions] = useState([]);
  const [sortOrder, setSortOrder] = useState('desc'); // 'desc' = newest first, 'asc' = oldest first
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (wallet?.wallet?.publicKey) {
      loadTransactions();
    }
  }, [wallet, network, sortOrder]);

  const loadTransactions = () => {
    setLoading(true);
    try {
      const walletAddress = wallet.wallet.publicKey;
      const history = getTransactionHistory(walletAddress, network, sortOrder);
      logger.log('[ActivityTab] Loading transactions for wallet:', walletAddress, 'network:', network, 'found:', history.length);
      setTransactions(history.map(formatTransaction));
    } catch (e) {
      logger.error('Failed to load transactions:', e);
    }
    setLoading(false);
  };

  const toggleSort = () => {
    setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc');
  };

  const openExplorer = (signature) => {
    const url = getTxExplorerUrl(network, signature);
    window.open(url, '_blank');
  };

  // Get transaction type info for display
  const getTxTypeInfo = (tx) => {
    switch (tx.type) {
      case 'send':
        return { label: 'Sent', icon: 'send', color: 'var(--error)' };
      case 'receive':
        return { label: 'Received', icon: 'receive', color: 'var(--success)' };
      case 'stake':
        return { label: 'Staked', icon: 'stake', color: 'var(--x1-blue)' };
      case 'unstake':
        return { label: 'Unstaked', icon: 'unstake', color: 'var(--warning)' };
      case 'wrap':
        return { label: 'Wrapped', icon: 'swap', color: 'var(--x1-blue)' };
      case 'unwrap':
        return { label: 'Unwrapped', icon: 'swap', color: 'var(--x1-blue)' };
      case 'swap':
        return { label: 'Swapped', icon: 'swap', color: 'var(--x1-blue)' };
      default:
        return { label: tx.type || 'Transaction', icon: 'default', color: 'var(--text-secondary)' };
    }
  };

  // Get transaction detail line
  const getTxDetail = (tx) => {
    const typeInfo = getTxTypeInfo(tx);
    
    if (tx.type === 'stake') {
      const match = tx.description?.match(/([\d.]+)\s*pXNT/);
      return match ? `→ ${match[1]} pXNT` : '→ pXNT';
    }
    if (tx.type === 'unstake') {
      const match = tx.description?.match(/([\d.]+)\s*pXNT/);
      return match ? `← ${match[1]} pXNT` : '← pXNT';
    }
    if (tx.type === 'wrap' || tx.type === 'unwrap' || tx.type === 'swap' || tx.isSwap) {
      if (tx.toSymbol && tx.toAmount) {
        return `→ ${tx.toAmount} ${tx.toSymbol}`;
      }
      return tx.type === 'wrap' ? '→ Wrapped' : tx.type === 'unwrap' ? '→ Native' : '→ Swapped';
    }
    if (tx.type === 'send') {
      return `To: ${tx.shortTo || tx.to?.slice(0, 6) + '...' + tx.to?.slice(-4)}`;
    }
    // Default: receive or unknown
    return `From: ${tx.shortFrom || tx.from?.slice(0, 6) + '...' + tx.from?.slice(-4)}`;
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    // Format the actual date
    const dateStr = date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
    const timeStr = date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
    
    // Less than 1 minute - show "Just now" + time
    if (diff < 60000) return `Just now · ${timeStr}`;
    // Less than 1 hour - show minutes + time
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago · ${timeStr}`;
    // Less than 24 hours - show hours + time
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago · ${timeStr}`;
    // Otherwise show date + time
    return `${dateStr} · ${timeStr}`;
  };

  if (loading) {
    return (
      <div className="activity-tab">
        <div className="activity-loading">Loading transactions...</div>
      </div>
    );
  }

  return (
    <div className="activity-tab">
      {/* Sort Toggle Header */}
      <div className="activity-header">
        <span className="activity-title">Transactions</span>
        <button className="sort-toggle" onClick={toggleSort}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {sortOrder === 'desc' ? (
              <>
                <path d="M12 5v14M5 12l7 7 7-7"/>
              </>
            ) : (
              <>
                <path d="M12 19V5M5 12l7-7 7 7"/>
              </>
            )}
          </svg>
          <span>{sortOrder === 'desc' ? 'Newest' : 'Oldest'}</span>
        </button>
      </div>

      {/* Transaction List */}
      {transactions.length === 0 ? (
        <div className="activity-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M3 9h18M9 21V9"/>
          </svg>
          <p>No transactions yet</p>
        </div>
      ) : (
        <div className="activity-list">
          {transactions.map((tx, index) => {
            const typeInfo = getTxTypeInfo(tx);
            return (
            <div 
              key={tx.signature || index} 
              className="activity-item"
              onClick={() => tx.signature && openExplorer(tx.signature)}
            >
              <div className="activity-icon-wrap">
                {typeInfo.icon === 'send' ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={typeInfo.color} strokeWidth="2">
                    <line x1="12" y1="19" x2="12" y2="5"/>
                    <polyline points="5 12 12 5 19 12"/>
                  </svg>
                ) : typeInfo.icon === 'stake' || typeInfo.icon === 'unstake' ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={typeInfo.color} strokeWidth="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5z" />
                    <path d="M2 17l10 5 10-5" />
                    <path d="M2 12l10 5 10-5" />
                  </svg>
                ) : typeInfo.icon === 'swap' ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={typeInfo.color} strokeWidth="2">
                    <path d="M7 16V4M7 4L3 8M7 4L11 8"/>
                    <path d="M17 8V20M17 20L21 16M17 20L13 16"/>
                  </svg>
                ) : typeInfo.icon === 'receive' ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={typeInfo.color} strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <polyline points="19 12 12 19 5 12"/>
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={typeInfo.color} strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 6v6l4 2"/>
                  </svg>
                )}
              </div>
              
              <div className="activity-details">
                <div className="activity-type-row">
                  <span className="activity-type-label">
                    {typeInfo.label} {tx.symbol || ''}
                  </span>
                  <span className="activity-time">{formatTime(tx.timestamp)}</span>
                </div>
                <div className="activity-address">
                  {getTxDetail(tx)}
                </div>
              </div>
              
              <div className={`activity-amount ${tx.type || 'default'}`}>
                {tx.type === 'send' ? '-' : 
                 tx.type === 'unstake' ? '+' : 
                 tx.type === 'stake' ? '' : 
                 (tx.type === 'wrap' || tx.type === 'unwrap' || tx.type === 'swap') ? '↔' :
                 '+'}{tx.amount} {tx.symbol || ''}
              </div>
            </div>
          )})}
        </div>
      )}

      <style>{`
        .activity-tab {
          display: flex;
          flex-direction: column;
          height: 100%;
        }
        
        .activity-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          border-bottom: 1px solid var(--border);
        }
        
        .activity-title {
          font-weight: 600;
          color: var(--text-primary);
        }
        
        .sort-toggle {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: 6px;
          color: var(--text-secondary);
          font-size: 12px;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .sort-toggle:hover {
          background: var(--bg-tertiary);
          color: var(--text-primary);
        }
        
        .activity-loading,
        .activity-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 48px 16px;
          color: var(--text-secondary);
          gap: 12px;
        }
        
        .activity-list {
          flex: 1;
          overflow-y: auto;
        }
        
        .activity-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 16px;
          border-bottom: 1px solid var(--border);
          cursor: pointer;
          transition: background 0.2s;
        }
        
        .activity-item:hover {
          background: var(--bg-secondary);
        }
        
        .activity-icon-wrap {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: var(--bg-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        
        .activity-details {
          flex: 1;
          min-width: 0;
        }
        
        .activity-type-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2px;
        }
        
        .activity-type-label {
          font-weight: 500;
          color: var(--text-primary);
          font-size: 14px;
        }
        
        .activity-time {
          font-size: 12px;
          color: var(--text-tertiary);
        }
        
        .activity-address {
          font-size: 12px;
          color: var(--text-secondary);
          font-family: monospace;
        }
        
        .activity-amount {
          font-weight: 600;
          font-size: 14px;
          text-align: right;
          white-space: nowrap;
        }
        
        .activity-amount.send {
          color: var(--error);
        }
        
        .activity-amount.receive {
          color: var(--success);
        }
        
        .activity-amount.stake {
          color: var(--x1-blue);
        }
        
        .activity-amount.unstake {
          color: var(--warning, #f59e0b);
        }
        
        .activity-amount.wrap,
        .activity-amount.unwrap,
        .activity-amount.swap {
          color: var(--x1-blue);
        }
        
        .activity-amount.default {
          color: var(--text-secondary);
        }
      `}</style>
    </div>
  );
}

export default ActivityTab;