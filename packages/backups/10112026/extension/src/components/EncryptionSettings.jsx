// EncryptionSettings.jsx - Add this to your SettingsScreen.jsx
// This handles enabling/disabling wallet encryption and changing password
//
// INTEGRATION: Add to your SettingsScreen's Security section:
// 
// import EncryptionSettings from './EncryptionSettings';
// 
// Then in the Security section, add:
// <EncryptionSettings 
//   isEncrypted={wallet.isEncrypted}
//   onEnableEncryption={wallet.enableEncryption}
//   onDisableEncryption={wallet.disableEncryption}
//   onChangePassword={wallet.changePassword}
//   onLock={wallet.lockWallet}
// />

import React, { useState } from 'react';

export default function EncryptionSettings({ 
  isEncrypted, 
  onEnableEncryption, 
  onDisableEncryption, 
  onChangePassword,
  onLock 
}) {
  const [showModal, setShowModal] = useState(null); // 'enable' | 'disable' | 'change'
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const resetForm = () => {
    setPassword('');
    setConfirmPassword('');
    setCurrentPassword('');
    setError('');
    setLoading(false);
    setSuccess(false);
  };

  const closeModal = () => {
    setShowModal(null);
    resetForm();
  };

  const handleEnableEncryption = async () => {
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await onEnableEncryption(password);
      setSuccess(true);
      setTimeout(() => {
        closeModal();
      }, 1500);
    } catch (err) {
      setError(err.message || 'Failed to enable encryption');
    } finally {
      setLoading(false);
    }
  };

  const handleDisableEncryption = async () => {
    if (!currentPassword) {
      setError('Please enter your current password');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await onDisableEncryption(currentPassword);
      setSuccess(true);
      setTimeout(() => {
        closeModal();
      }, 1500);
    } catch (err) {
      setError(err.message || 'Incorrect password');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword) {
      setError('Please enter your current password');
      return;
    }
    if (password.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await onChangePassword(currentPassword, password);
      setSuccess(true);
      setTimeout(() => {
        closeModal();
      }, 1500);
    } catch (err) {
      setError(err.message || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Encryption Status Row */}
      <div className="settings-item" onClick={() => setShowModal(isEncrypted ? 'change' : 'enable')}>
        <div className="settings-item-left">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          <div>
            <span>Wallet Encryption</span>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {isEncrypted ? 'AES-256-GCM with PBKDF2' : 'Encrypt wallet data with password'}
            </div>
          </div>
        </div>
        <div className="settings-item-right">
          <span className={`settings-badge ${isEncrypted ? 'active' : ''}`}>
            {isEncrypted ? 'Active' : 'Off'}
          </span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </div>
      </div>

      {/* Lock Now Button (only when encrypted) */}
      {isEncrypted && (
        <div className="settings-item" onClick={onLock}>
          <div className="settings-item-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <span>Lock Wallet Now</span>
          </div>
          <div className="settings-item-right">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </div>
        </div>
      )}

      {/* Disable Encryption (only when encrypted) */}
      {isEncrypted && (
        <div className="settings-item" onClick={() => setShowModal('disable')}>
          <div className="settings-item-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              <line x1="4" y1="4" x2="20" y2="20"/>
            </svg>
            <span style={{ color: 'var(--warning)' }}>Disable Encryption</span>
          </div>
        </div>
      )}

      {/* Enable Encryption Modal */}
      {showModal === 'enable' && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Enable Encryption</h3>
              <button className="modal-close" onClick={closeModal}>×</button>
            </div>
            
            <div className="modal-body">
              {success ? (
                <div className="success-message">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                  <p>Encryption enabled successfully!</p>
                </div>
              ) : (
                <>
                  <div className="info-box">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="12" y1="16" x2="12" y2="12"/>
                      <line x1="12" y1="8" x2="12.01" y2="8"/>
                    </svg>
                    <span>Your wallet will be encrypted with AES-256. You'll need this password to access your wallet.</span>
                  </div>

                  <div className="warning-box">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/>
                      <line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                    <span>If you forget this password, you'll need your seed phrase to recover your wallet.</span>
                  </div>

                  <div className="form-group">
                    <label>Password (min 8 characters)</label>
                    <input
                      type="password"
                      className="form-input"
                      placeholder="Enter password"
                      value={password}
                      onChange={e => { setPassword(e.target.value); setError(''); }}
                      autoFocus
                    />
                  </div>

                  <div className="form-group">
                    <label>Confirm Password</label>
                    <input
                      type="password"
                      className="form-input"
                      placeholder="Confirm password"
                      value={confirmPassword}
                      onChange={e => { setConfirmPassword(e.target.value); setError(''); }}
                    />
                  </div>

                  {error && <div className="error-message">{error}</div>}

                  <button 
                    className="btn-primary" 
                    onClick={handleEnableEncryption}
                    disabled={loading || !password || !confirmPassword}
                  >
                    {loading ? 'Encrypting...' : 'Enable Encryption'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Disable Encryption Modal */}
      {showModal === 'disable' && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Disable Encryption</h3>
              <button className="modal-close" onClick={closeModal}>×</button>
            </div>
            
            <div className="modal-body">
              {success ? (
                <div className="success-message">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                  <p>Encryption disabled</p>
                </div>
              ) : (
                <>
                  <div className="warning-box">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/>
                      <line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                    <span>Your wallet data will be stored without encryption. This is less secure.</span>
                  </div>

                  <div className="form-group">
                    <label>Enter your current password</label>
                    <input
                      type="password"
                      className="form-input"
                      placeholder="Current password"
                      value={currentPassword}
                      onChange={e => { setCurrentPassword(e.target.value); setError(''); }}
                      autoFocus
                    />
                  </div>

                  {error && <div className="error-message">{error}</div>}

                  <button 
                    className="btn-danger" 
                    onClick={handleDisableEncryption}
                    disabled={loading || !currentPassword}
                  >
                    {loading ? 'Processing...' : 'Disable Encryption'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {showModal === 'change' && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Change Encryption Password</h3>
              <button className="modal-close" onClick={closeModal}>×</button>
            </div>
            
            <div className="modal-body">
              {success ? (
                <div className="success-message">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                  <p>Password changed successfully!</p>
                </div>
              ) : (
                <>
                  <div className="form-group">
                    <label>Current Password</label>
                    <input
                      type="password"
                      className="form-input"
                      placeholder="Enter current password"
                      value={currentPassword}
                      onChange={e => { setCurrentPassword(e.target.value); setError(''); }}
                      autoFocus
                    />
                  </div>

                  <div className="form-group">
                    <label>New Password (min 8 characters)</label>
                    <input
                      type="password"
                      className="form-input"
                      placeholder="Enter new password"
                      value={password}
                      onChange={e => { setPassword(e.target.value); setError(''); }}
                    />
                  </div>

                  <div className="form-group">
                    <label>Confirm New Password</label>
                    <input
                      type="password"
                      className="form-input"
                      placeholder="Confirm new password"
                      value={confirmPassword}
                      onChange={e => { setConfirmPassword(e.target.value); setError(''); }}
                    />
                  </div>

                  {error && <div className="error-message">{error}</div>}

                  <button 
                    className="btn-primary" 
                    onClick={handleChangePassword}
                    disabled={loading || !currentPassword || !password || !confirmPassword}
                  >
                    {loading ? 'Changing...' : 'Change Password'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        .settings-badge {
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
          background: var(--bg-tertiary);
          color: var(--text-secondary);
        }
        .settings-badge.active {
          background: rgba(34, 197, 94, 0.15);
          color: var(--success);
        }
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 16px;
        }
        .modal-content {
          background: var(--bg-secondary);
          border-radius: 16px;
          width: 100%;
          max-width: 360px;
          max-height: 90vh;
          overflow-y: auto;
        }
        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid var(--border);
        }
        .modal-header h3 {
          margin: 0;
          font-size: 18px;
          color: var(--text-primary);
        }
        .modal-close {
          background: none;
          border: none;
          font-size: 24px;
          color: var(--text-secondary);
          cursor: pointer;
          padding: 0;
          line-height: 1;
        }
        .modal-body {
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .success-message {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          padding: 24px 0;
          text-align: center;
          color: var(--text-primary);
        }
        .info-box, .warning-box {
          display: flex;
          gap: 12px;
          padding: 12px;
          border-radius: 8px;
          font-size: 13px;
          line-height: 1.4;
        }
        .info-box {
          background: rgba(59, 130, 246, 0.1);
          color: var(--text-secondary);
        }
        .info-box svg {
          flex-shrink: 0;
          color: var(--x1-blue);
        }
        .warning-box {
          background: rgba(245, 158, 11, 0.1);
          color: var(--warning);
        }
        .warning-box svg {
          flex-shrink: 0;
        }
        .btn-danger {
          background: var(--error);
          color: white;
        }
      `}</style>
    </>
  );
}
