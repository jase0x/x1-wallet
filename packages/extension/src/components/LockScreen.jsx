// LockScreen.jsx - Display when wallet is locked (encrypted)
// Import this in your App.jsx and render when wallet.isLocked is true
import React, { useState } from 'react';

export default function LockScreen({ onUnlock }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleUnlock = async (e) => {
    e.preventDefault();
    if (!password) {
      setError('Please enter your password');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await onUnlock(password);
      setPassword('');
    } catch (err) {
      setError(err.message || 'Incorrect password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="screen lock-screen no-nav">
      <div className="lock-screen-content">
        <div className="lock-icon">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="1.5">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            <circle cx="12" cy="16" r="1"/>
          </svg>
        </div>
        
        <h2>Wallet Locked</h2>
        <p className="lock-subtitle">Enter your password to unlock</p>

        <form onSubmit={handleUnlock} className="lock-form">
          <div className="form-group">
            <input
              type="password"
              className="form-input"
              placeholder="Enter password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              autoFocus
              disabled={loading}
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <button 
            type="submit" 
            className="btn-primary"
            disabled={loading || !password}
          >
            {loading ? 'Unlocking...' : 'Unlock Wallet'}
          </button>
        </form>

        <div className="lock-footer">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          <span>Protected with AES-256 encryption</span>
        </div>
      </div>
    </div>
  );
}
