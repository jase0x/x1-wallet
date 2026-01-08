// Wallet Manager - Add, Edit, Remove, View Keys
import { logger, getUserFriendlyError, ErrorMessages } from '@x1-wallet/core';
import React, { useState, useEffect } from 'react';
import { WORDLIST } from '@x1-wallet/core/utils/bip39';

// Add Wallet Modal
function AddWalletModal({ onAdd, onClose }) {
  const [mode, setMode] = useState('choose'); // choose, create, import, hardware
  const [name, setName] = useState('');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content large" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{mode === 'choose' ? 'Add Wallet' : mode === 'create' ? 'Create New Wallet' : mode === 'import' ? 'Import Wallet' : 'Connect Hardware'}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        
        {mode === 'choose' && (
          <div className="modal-body">
            <div className="add-wallet-options">
              <button className="add-wallet-option" onClick={() => setMode('create')}>
                <div className="option-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="2">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </div>
                <div className="option-text">
                  <span className="option-title">Create New Wallet</span>
                  <span className="option-desc">Generate a new seed phrase</span>
                </div>
              </button>
              
              <button className="add-wallet-option" onClick={() => setMode('import')}>
                <div className="option-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </div>
                <div className="option-text">
                  <span className="option-title">Import Wallet</span>
                  <span className="option-desc">Use existing seed phrase</span>
                </div>
              </button>

              <button className="add-wallet-option" onClick={() => setMode('hardware')}>
                <div className="option-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="2">
                    <rect x="2" y="6" width="20" height="12" rx="2" />
                    <path d="M12 12h.01" />
                    <path d="M17 12h.01" />
                    <path d="M7 12h.01" />
                  </svg>
                </div>
                <div className="option-text">
                  <span className="option-title">Hardware Wallet</span>
                  <span className="option-desc">Connect Ledger via USB or Bluetooth</span>
                </div>
              </button>
            </div>
          </div>
        )}

        {mode === 'hardware' && (
          <div className="modal-body">
            <div className="form-group">
              <label>Wallet Name</label>
              <input 
                type="text" 
                className="form-input" 
                placeholder="My Ledger"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
            
            <div className="hardware-options">
              <button className="hardware-btn">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                  <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                </svg>
                Connect via USB
              </button>
              <button className="hardware-btn">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M7 7h10v10H7z" />
                  <path d="M17 14h2a2 2 0 0 0 0-4h-2" />
                  <path d="M7 14H5a2 2 0 0 1 0-4h2" />
                  <path d="M10 7V5a2 2 0 0 1 4 0v2" />
                  <path d="M10 17v2a2 2 0 0 0 4 0v-2" />
                </svg>
                Connect via Bluetooth
              </button>
            </div>
            
            <p className="hardware-note">
              Make sure your Ledger is unlocked and the Solana app is open.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// View Keys Modal
function ViewKeysModal({ wallet, onClose }) {
  const [showPrivate, setShowPrivate] = useState(false);
  const [showSeed, setShowSeed] = useState(false);
  const [copied, setCopied] = useState('');

  const copy = (text, type) => {
    navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(''), 2000);
  };

  if (wallet.type === 'ledger') {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <h3>Wallet Keys</h3>
            <button className="modal-close" onClick={onClose}>×</button>
          </div>
          <div className="modal-body">
            <div className="warning-box">
              <span>🔐</span>
              <span>Hardware wallet keys are stored securely on your device and cannot be exported.</span>
            </div>
            <div className="key-display">
              <label>Public Address</label>
              <div className="key-value">
                <code>{wallet.publicKey}</code>
                <button onClick={() => copy(wallet.publicKey, 'public')}>
                  {copied === 'public' ? '✓' : 'Copy'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content large" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Wallet Keys</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="warning-box danger">
            <span>⚠️</span>
            <span>Never share your private key or seed phrase. Anyone with access can steal your funds!</span>
          </div>

          <div className="key-display">
            <label>Public Address</label>
            <div className="key-value">
              <code>{wallet.publicKey}</code>
              <button onClick={() => copy(wallet.publicKey, 'public')}>
                {copied === 'public' ? '✓' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="key-display">
            <label>Private Key</label>
            {!showPrivate ? (
              <button className="reveal-btn" onClick={() => setShowPrivate(true)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                Reveal Private Key
              </button>
            ) : (
              <div className="key-value private">
                <code>{wallet.privateKey}</code>
                <button onClick={() => copy(wallet.privateKey, 'private')}>
                  {copied === 'private' ? '✓' : 'Copy'}
                </button>
              </div>
            )}
          </div>

          <div className="key-display">
            <label>Seed Phrase</label>
            {!showSeed ? (
              <button className="reveal-btn" onClick={() => setShowSeed(true)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                Reveal Seed Phrase
              </button>
            ) : (
              <>
                <div className="seed-grid compact">
                  {wallet.mnemonic?.split(' ').map((word, i) => (
                    <div key={i} className="seed-word">
                      <span className="seed-number">{i + 1}</span>
                      <span className="seed-text">{word}</span>
                    </div>
                  ))}
                </div>
                <button className="btn-copy" onClick={() => copy(wallet.mnemonic, 'seed')}>
                  {copied === 'seed' ? '✓ Copied!' : 'Copy Seed Phrase'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Edit Wallet Modal
function EditWalletModal({ wallet, onSave, onClose }) {
  const [name, setName] = useState(wallet.name);

  const handleSave = () => {
    onSave({ name });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Edit Wallet</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>Wallet Name</label>
            <input 
              type="text"
              className="form-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="My Wallet"
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}

// Format balance for display
function formatBalance(balance) {
  if (balance === null || balance === undefined) return '...';
  if (balance === 0) return '0';
  if (balance < 0.001) return '<0.001';
  if (balance < 1) return balance.toFixed(4);
  if (balance < 1000) return balance.toFixed(2);
  if (balance < 1000000) return (balance / 1000).toFixed(2) + 'K';
  return (balance / 1000000).toFixed(2) + 'M';
}

export default function WalletManager({ wallet, onBack, onCreateWallet, onImportWallet, onHardwareWallet }) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [showKeysModal, setShowKeysModal] = useState(null);
  const [showEditModal, setShowEditModal] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [balances, setBalances] = useState({});
  const [loadingBalances, setLoadingBalances] = useState(true);

  // Fetch balances for all wallets
  useEffect(() => {
    const fetchBalances = async () => {
      setLoadingBalances(true);
      const newBalances = {};
      
      for (const w of wallet.wallets) {
        try {
          const address = w.publicKey || w.addresses?.[0]?.publicKey;
          if (!address) continue;
          
          const rpcUrl = wallet.network?.includes('Devnet') 
            ? 'https://api.devnet.solana.com'
            : wallet.network?.includes('Testnet')
            ? 'https://api.testnet.solana.com'
            : 'https://xolana.xen.network';
          
          const response = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'getBalance',
              params: [address]
            })
          });
          
          const data = await response.json();
          if (data.result?.value !== undefined) {
            newBalances[w.id] = data.result.value / 1e9; // Convert lamports to SOL/X1
          }
        } catch (err) {
          logger.error(`Failed to fetch balance for ${w.name}:`, err);
          newBalances[w.id] = null;
        }
      }
      
      setBalances(newBalances);
      setLoadingBalances(false);
    };

    if (wallet.wallets?.length > 0) {
      fetchBalances();
    }
  }, [wallet.wallets, wallet.network]);

  const handleRemove = (w) => {
    if (confirmDelete === w.id) {
      wallet.removeWallet(w.id);
      setConfirmDelete(null);
    } else {
      setConfirmDelete(w.id);
      setTimeout(() => setConfirmDelete(null), 3000);
    }
  };

  const handleAddOption = (type) => {
    setShowAddModal(false);
    if (type === 'create') onCreateWallet();
    else if (type === 'import') onImportWallet();
    else if (type === 'hardware') onHardwareWallet?.();
  };

  // Get token symbol based on network
  const tokenSymbol = wallet.network?.includes('Solana') ? 'SOL' : 'X1';

  return (
    <div className="screen settings-screen">
      <div className="settings-header">
        <button className="back-btn" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <h2>Manage Wallets</h2>
      </div>

      <div className="settings-content">
        <div className="wallet-list">
          {wallet.wallets.map(w => (
            <div key={w.id} className={`wallet-card ${wallet.activeWalletId === w.id ? 'active' : ''}`}>
              <div className="wallet-card-main" onClick={() => wallet.switchWallet(w.id)}>
                <div className="wallet-card-icon">
                  {w.type === 'ledger' ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="2" y="6" width="20" height="12" rx="2" />
                      <path d="M12 12h.01" />
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" />
                      <path d="M4 6v12c0 1.1.9 2 2 2h14v-4" />
                      <path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z" />
                    </svg>
                  )}
                </div>
                <div className="wallet-card-info">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <span className="wallet-card-name">{w.name}</span>
                    <span style={{ 
                      fontSize: 13, 
                      fontWeight: 600, 
                      color: balances[w.id] > 0 ? 'var(--success)' : 'var(--text-muted)',
                      marginLeft: 8
                    }}>
                      {loadingBalances ? '...' : `${formatBalance(balances[w.id])} ${tokenSymbol}`}
                    </span>
                  </div>
                  <span className="wallet-card-address">{w.publicKey?.slice(0, 8)}...{w.publicKey?.slice(-6)}</span>
                  {w.type === 'ledger' && <span className="wallet-badge">Ledger</span>}
                </div>
                {wallet.activeWalletId === w.id && (
                  <span className="wallet-active-badge">Active</span>
                )}
              </div>
              <div className="wallet-card-actions">
                <button className="wallet-action-btn" onClick={() => setShowEditModal(w)} title="Edit">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button className="wallet-action-btn" onClick={() => setShowKeysModal(w)} title="View Keys">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                  </svg>
                </button>
                <button 
                  className={`wallet-action-btn danger ${confirmDelete === w.id ? 'confirming' : ''}`}
                  onClick={() => handleRemove(w)}
                  title="Remove"
                >
                  {confirmDelete === w.id ? (
                    <span style={{ fontSize: 10 }}>Confirm?</span>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>

        <button className="add-wallet-btn" onClick={() => setShowAddModal(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v8M8 12h8" />
          </svg>
          Add Wallet
        </button>
      </div>

      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content large" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add Wallet</h3>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="add-wallet-options">
                <button className="add-wallet-option" onClick={() => handleAddOption('create')}>
                  <div className="option-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="2">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </div>
                  <div className="option-text">
                    <span className="option-title">Create New Wallet</span>
                    <span className="option-desc">Generate a new seed phrase</span>
                  </div>
                </button>
                
                <button className="add-wallet-option" onClick={() => handleAddOption('import')}>
                  <div className="option-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </div>
                  <div className="option-text">
                    <span className="option-title">Import Wallet</span>
                    <span className="option-desc">Use existing seed phrase</span>
                  </div>
                </button>

                <button className="add-wallet-option" onClick={() => handleAddOption('hardware')}>
                  <div className="option-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="2">
                      <rect x="2" y="6" width="20" height="12" rx="2" />
                      <path d="M12 12h.01" />
                      <path d="M17 12h.01" />
                      <path d="M7 12h.01" />
                    </svg>
                  </div>
                  <div className="option-text">
                    <span className="option-title">Hardware Wallet</span>
                    <span className="option-desc">Connect Ledger via USB or Bluetooth</span>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showKeysModal && (
        <ViewKeysModal
          wallet={wallet.getWalletForBackup ? wallet.getWalletForBackup(showKeysModal.id) || showKeysModal : showKeysModal}
          onClose={() => setShowKeysModal(null)}
        />
      )}

      {showEditModal && (
        <EditWalletModal
          wallet={showEditModal}
          onSave={(updates) => wallet.updateWallet(showEditModal.id, updates)}
          onClose={() => setShowEditModal(null)}
        />
      )}
    </div>
  );
}