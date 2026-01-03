// Import Wallet Component with Private Key Support
import { logger, getUserFriendlyError, ErrorMessages } from '@x1-wallet/core';
import React, { useState, useRef } from 'react';
import { validateMnemonic, WORDLIST } from '@x1-wallet/core/utils/bip39';

export default function ImportWallet({ onComplete, onBack, onCompletePrivateKey }) {
  const [importType, setImportType] = useState('phrase'); // 'phrase' or 'privatekey'
  const [seedLength, setSeedLength] = useState(12);
  const [words, setWords] = useState(Array(12).fill(''));
  const [walletName, setWalletName] = useState('');
  const [step, setStep] = useState('import');
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [activeInput, setActiveInput] = useState(-1);
  const inputRefs = useRef([]);
  
  // Private key state
  const [privateKeyInput, setPrivateKeyInput] = useState('');

  const handleLengthChange = (len) => {
    setSeedLength(len);
    setWords(Array(len).fill(''));
    setError('');
  };

  const handleWordChange = (index, value) => {
    const word = value.toLowerCase().trim();
    const newWords = [...words];
    newWords[index] = word;
    setWords(newWords);
    setError('');

    if (word.length > 0) {
      const matches = WORDLIST.filter(w => w.startsWith(word)).slice(0, 5);
      setSuggestions(matches);
      setActiveInput(index);
    } else {
      setSuggestions([]);
    }
  };

  const selectSuggestion = (word) => {
    const newWords = [...words];
    newWords[activeInput] = word;
    setWords(newWords);
    setSuggestions([]);
    if (activeInput < seedLength - 1) {
      inputRefs.current[activeInput + 1]?.focus();
    }
  };

  const handleKeyDown = (e, index) => {
    if (e.key === 'Tab' || e.key === 'Enter') {
      if (suggestions.length > 0) {
        e.preventDefault();
        selectSuggestion(suggestions[0]);
      }
    } else if (e.key === ' ' && words[index]) {
      e.preventDefault();
      if (index < seedLength - 1) inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const pastedWords = text.trim().toLowerCase().split(/\s+/);
      if (pastedWords.length === 12 || pastedWords.length === 24) {
        setSeedLength(pastedWords.length);
        setWords(pastedWords);
        setError('');
      } else {
        setError('Invalid phrase. Must be 12 or 24 words.');
      }
    } catch {
      setError('Failed to paste from clipboard');
    }
  };

  const isValidWord = (word) => {
    if (!word) return null;
    return WORDLIST.includes(word.toLowerCase());
  };

  const handleContinue = async () => {
    const filledWords = words.filter(w => w.trim());
    if (filledWords.length !== seedLength) {
      setError(`Please fill in all ${seedLength} words`);
      return;
    }
    const invalidWords = filledWords.filter(w => !WORDLIST.includes(w.toLowerCase()));
    if (invalidWords.length > 0) {
      setError(`Invalid words: ${invalidWords.join(', ')}`);
      return;
    }
    const phrase = filledWords.join(' ');
    const isValid = await validateMnemonic(phrase);
    if (!isValid) {
      setError('Invalid seed phrase checksum');
      return;
    }
    setStep('name');
  };

  const handleComplete = () => {
    onComplete(words.join(' '), walletName || 'Imported Wallet');
  };
  
  // Private Key Import
  const handlePrivateKeyImport = async () => {
    setError('');
    
    if (!privateKeyInput.trim()) {
      setError('Please enter a private key');
      return;
    }
    
    try {
      const trimmedKey = privateKeyInput.trim();
      
      // Base58 character set check
      const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
      if (!base58Regex.test(trimmedKey)) {
        setError('Invalid private key format (not base58)');
        return;
      }
      
      // Decode to verify length
      const { decodeBase58, encodeBase58 } = await import('@x1-wallet/core/utils/base58');
      const decoded = decodeBase58(trimmedKey);
      
      // Solana private keys are 64 bytes (secret key) or 32 bytes (seed)
      if (decoded.length !== 64 && decoded.length !== 32) {
        setError(`Invalid key length: ${decoded.length} bytes (expected 32 or 64)`);
        return;
      }
      
      // If 32 bytes, we need to derive the public key
      let secretKey = decoded;
      let publicKey;
      
      if (decoded.length === 32) {
        // Need to derive keypair from seed
        const { getPublicKey } = await import('@x1-wallet/core/utils/bip44');
        publicKey = getPublicKey(decoded);
        // Create full 64-byte secret key
        secretKey = new Uint8Array(64);
        secretKey.set(decoded, 0);
        secretKey.set(publicKey, 32);
      } else {
        // Already 64 bytes - extract public key
        publicKey = decoded.slice(32);
      }
      
      const publicKeyBase58 = encodeBase58(publicKey);
      const privateKeyBase58 = encodeBase58(secretKey);
      
      // Move to naming step with private key data
      setStep('name-pk');
      
    } catch (err) {
      logger.error('Import error:', err);
      setError('Failed to import: ' + err.message);
    }
  };
  
  const handleCompletePrivateKey = async () => {
    // X1W-004 FIX: Always require the secure onCompletePrivateKey handler
    // Never fall back to direct localStorage storage without encryption
    if (!onCompletePrivateKey) {
      setError('Secure import handler not available. Please try again or contact support.');
      logger.error('[ImportWallet] onCompletePrivateKey handler not provided - this is a security requirement');
      return;
    }
    
    try {
      const trimmedKey = privateKeyInput.trim();
      const { decodeBase58, encodeBase58 } = await import('@x1-wallet/core/utils/base58');
      const decoded = decodeBase58(trimmedKey);
      
      let secretKey = decoded;
      let publicKey;
      
      if (decoded.length === 32) {
        const { getPublicKey } = await import('@x1-wallet/core/utils/bip44');
        publicKey = getPublicKey(decoded);
        secretKey = new Uint8Array(64);
        secretKey.set(decoded, 0);
        secretKey.set(publicKey, 32);
      } else {
        publicKey = decoded.slice(32);
      }
      
      const publicKeyBase58 = encodeBase58(publicKey);
      const privateKeyBase58 = encodeBase58(secretKey);
      
      // Call the secure completion handler (will encrypt before storage)
      onCompletePrivateKey({
        publicKey: publicKeyBase58,
        privateKey: privateKeyBase58,
        name: walletName || 'Imported Wallet'
      });
    } catch (err) {
      setError('Failed to complete import: ' + err.message);
    }
  };

  // Name step for seed phrase
  if (step === 'name') {
    return (
      <div className="screen no-nav">
        <div className="page-header">
          <div className="header-left">
            <button className="back-btn" onClick={() => setStep('import')}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
          <h2 className="header-title">Name Your Wallet</h2>
          <div className="header-right" />
        </div>
        <div className="screen-content seed-container" style={{ paddingTop: 0 }}>
          <p className="seed-subtitle">Give your imported wallet a name</p>
          <div className="form-group" style={{ marginTop: 24 }}>
            <input type="text" className="form-input" value={walletName} onChange={e => setWalletName(e.target.value)} placeholder="My Imported Wallet" autoFocus />
          </div>
          <button className="btn-primary" onClick={handleComplete} style={{ marginTop: 24 }}>Import Wallet</button>
        </div>
      </div>
    );
  }
  
  // Name step for private key
  if (step === 'name-pk') {
    return (
      <div className="screen no-nav">
        <div className="page-header">
          <div className="header-left">
            <button className="back-btn" onClick={() => setStep('import')}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
          <h2 className="header-title">Name Your Wallet</h2>
          <div className="header-right" />
        </div>
        <div className="screen-content seed-container" style={{ paddingTop: 0 }}>
          <p className="seed-subtitle">Give your imported wallet a name</p>
          <div className="form-group" style={{ marginTop: 24 }}>
            <input type="text" className="form-input" value={walletName} onChange={e => setWalletName(e.target.value)} placeholder="My Imported Wallet" autoFocus />
          </div>
          {error && <div className="error-message">{error}</div>}
          <button className="btn-primary" onClick={handleCompletePrivateKey} style={{ marginTop: 24 }}>Import Wallet</button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen no-nav">
      {/* Header */}
      <div className="page-header">
        <div className="header-left">
          <button className="back-btn" onClick={onBack}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
        <h2 className="header-title">Import Wallet</h2>
        <div className="header-right" />
      </div>
      
      <div className="screen-content seed-container" style={{ paddingTop: 0 }}>
        <p className="seed-subtitle">Choose how to import your wallet</p>
        
        {/* Import Type Selector */}
        <div className="import-type-selector">
          <button 
            className={`import-type-btn ${importType === 'phrase' ? 'active' : ''}`} 
            onClick={() => { setImportType('phrase'); setError(''); }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            Seed Phrase
          </button>
          <button 
            className={`import-type-btn ${importType === 'privatekey' ? 'active' : ''}`} 
            onClick={() => { setImportType('privatekey'); setError(''); }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
            Private Key
          </button>
        </div>
      
      {importType === 'phrase' && (
        <>
          <div className="seed-length-selector">
            <button className={`seed-length-btn ${seedLength === 12 ? 'active' : ''}`} onClick={() => handleLengthChange(12)}>12 Words</button>
            <button className={`seed-length-btn ${seedLength === 24 ? 'active' : ''}`} onClick={() => handleLengthChange(24)}>24 Words</button>
          </div>
          <button className="paste-btn" onClick={handlePaste}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
            </svg>
            Paste from Clipboard
          </button>
          <div className="seed-input-grid">
            {words.map((word, i) => (
              <div key={i} className="seed-input-word">
                <span className="seed-input-number">{i + 1}</span>
                <input
                  ref={el => inputRefs.current[i] = el}
                  type="text"
                  value={word}
                  onChange={e => handleWordChange(i, e.target.value)}
                  onKeyDown={e => handleKeyDown(e, i)}
                  onFocus={() => { setActiveInput(i); if (word) setSuggestions(WORDLIST.filter(w => w.startsWith(word)).slice(0, 5)); }}
                  onBlur={() => setTimeout(() => setSuggestions([]), 200)}
                  className={isValidWord(word) === true ? 'valid' : isValidWord(word) === false ? 'error' : ''}
                  placeholder="word"
                  autoComplete="off"
                  autoCapitalize="off"
                />
              </div>
            ))}
          </div>
          {suggestions.length > 0 && activeInput >= 0 && (
            <div className="suggestions-dropdown">
              {suggestions.map((word, i) => (
                <div key={word} className={`suggestion ${i === 0 ? 'first' : ''}`} onClick={() => selectSuggestion(word)}>{word}</div>
              ))}
            </div>
          )}
          {error && <div className="error-message">{error}</div>}
          <button className="btn-primary" onClick={handleContinue}>Continue</button>
        </>
      )}
      
      {importType === 'privatekey' && (
        <>
          <div className="warning-box" style={{ marginTop: 16 }}>
            <span>⚠️</span>
            <span>Enter your base58-encoded private key. Never share this with anyone.</span>
          </div>
          
          <div className="form-group" style={{ marginTop: 16 }}>
            <label>Private Key</label>
            <textarea
              className="form-input private-key-input"
              placeholder="Enter your private key (base58)"
              value={privateKeyInput}
              onChange={(e) => { setPrivateKeyInput(e.target.value); setError(''); }}
              rows={4}
            />
          </div>
          
          <div className="info-box" style={{ marginTop: 12 }}>
            <span>ℹ️</span>
            <span>Accepts 64-byte secret keys (88 chars) or 32-byte seeds (44 chars) in base58 format.</span>
          </div>
          
          {error && <div className="error-message" style={{ marginTop: 16 }}>{error}</div>}
          
          <button className="btn-primary" onClick={handlePrivateKeyImport} style={{ marginTop: 20 }}>Continue</button>
        </>
      )}
      </div>
    </div>
  );
}