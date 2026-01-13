// Welcome Screen Component
import React from 'react';

export default function WelcomeScreen({ onCreateWallet, onImportWallet, onHardwareWallet, onBack }) {
  // Check if we're in the extension popup (small window)
  const isExtensionPopup = typeof chrome !== 'undefined' && 
                           chrome.runtime && 
                           chrome.runtime.id &&
                           window.innerWidth < 500;
  
  // Handle hardware wallet click - open full tab if in popup
  const handleHardwareWallet = () => {
    if (isExtensionPopup) {
      // Open in full tab for better HID support
      const extensionUrl = chrome.runtime.getURL('index.html');
      chrome.tabs.create({ url: extensionUrl + '?hw=1' });
      // Close the popup
      window.close();
    } else {
      // Already in full tab, proceed normally
      onHardwareWallet();
    }
  };
  
  return (
    <div className="screen welcome-screen no-nav">
      {onBack && (
        <button className="back-btn" onClick={onBack} style={{ position: 'absolute', top: 16, left: 16 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
      )}
      <div className="welcome-content">
        <img src="/icons/128-x1.png" alt="X1" className="welcome-logo" style={{ width: 100, height: 100, objectFit: 'contain' }} />
        <h1>X1 Wallet</h1>
        <p className="tagline">Built for X1. Designed for You.</p>
        
        <div className="welcome-buttons">
          <button className="btn-primary" onClick={onCreateWallet}>
            Create New Wallet
          </button>
          <button className="btn-secondary" onClick={onImportWallet}>
            Import Existing Wallet
          </button>
          <button className="btn-secondary" onClick={handleHardwareWallet} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <circle cx="8" cy="12" r="1.5" />
              <circle cx="16" cy="12" r="1.5" />
            </svg>
            Connect Hardware Wallet
          </button>
        </div>
      </div>
      
      <div className="welcome-footer">
        Powered by X1 Blockchain
      </div>
    </div>
  );
}