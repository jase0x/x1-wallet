// Create Wallet - Auto Generate or Custom Seed
import { logger, getUserFriendlyError, ErrorMessages } from '@x1-wallet/core';
import React, { useState, useRef, useEffect } from 'react';
import { generateMnemonic, validateMnemonic, WORDLIST } from '@x1-wallet/core/utils/bip39';

export default function CreateWallet({ onComplete, onBack }) {
  const [step, setStep] = useState('choose'); // choose, generate, custom, verify, name
  const [seedLength, setSeedLength] = useState(12);
  const [mnemonic, setMnemonic] = useState('');
  const [customWords, setCustomWords] = useState(Array(12).fill(''));
  const [suggestions, setSuggestions] = useState([]);
  const [activeInput, setActiveInput] = useState(-1);
  const [verifyIndices, setVerifyIndices] = useState([]);
  const [verifyInputs, setVerifyInputs] = useState({});
  const [walletName, setWalletName] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const inputRefs = useRef([]);
  
  // X1W-NEW-002 FIX: Mnemonic masking for shoulder-surfing protection
  const [wordsRevealed, setWordsRevealed] = useState(new Set());
  const [allRevealed, setAllRevealed] = useState(false);
  const [windowBlurred, setWindowBlurred] = useState(false);
  
  // Blur seed phrase when window loses focus (X1W-NEW-002)
  useEffect(() => {
    const handleBlur = () => setWindowBlurred(true);
    const handleFocus = () => setWindowBlurred(false);
    
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    
    return () => {
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);
  
  // Toggle individual word reveal
  const toggleWordReveal = (index) => {
    setWordsRevealed(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };
  
  // Toggle all words reveal
  const toggleAllRevealed = () => {
    if (allRevealed) {
      setWordsRevealed(new Set());
      setAllRevealed(false);
    } else {
      const allIndices = new Set(mnemonic.split(' ').map((_, i) => i));
      setWordsRevealed(allIndices);
      setAllRevealed(true);
    }
  };

  // Generate random mnemonic (async for proper BIP-39 checksum)
  const generateNew = async () => {
    try {
      setGenerating(true);
      const strength = seedLength === 12 ? 128 : 256;
      const newMnemonic = await generateMnemonic(strength);
      logger.log('Generated mnemonic:', newMnemonic.split(' ').length, 'words');
      setMnemonic(newMnemonic);
      setStep('generate');
    } catch (err) {
      logger.error('Error generating mnemonic:', err);
      setError('Failed to generate mnemonic. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  // Switch to custom mode
  const switchToCustom = () => {
    setCustomWords(Array(seedLength).fill(''));
    setStep('custom');
  };

  // Handle length change
  const handleLengthChange = (len) => {
    setSeedLength(len);
    setCustomWords(Array(len).fill(''));
  };

  // Handle custom word input
  const handleWordChange = (index, value) => {
    const word = value.toLowerCase().trim();
    const newWords = [...customWords];
    newWords[index] = word;
    setCustomWords(newWords);
    setError('');

    // Show suggestions
    if (word.length > 0) {
      const matches = WORDLIST.filter(w => w.startsWith(word)).slice(0, 5);
      setSuggestions(matches);
      setActiveInput(index);
    } else {
      setSuggestions([]);
    }
  };

  // Select suggestion
  const selectSuggestion = (word) => {
    const newWords = [...customWords];
    newWords[activeInput] = word;
    setCustomWords(newWords);
    setSuggestions([]);
    
    // Move to next input
    if (activeInput < seedLength - 1) {
      inputRefs.current[activeInput + 1]?.focus();
    }
  };

  // Handle key navigation
  const handleKeyDown = (e, index) => {
    if (e.key === 'Tab' || e.key === 'Enter') {
      if (suggestions.length > 0) {
        e.preventDefault();
        selectSuggestion(suggestions[0]);
      }
    } else if (e.key === ' ') {
      if (customWords[index]) {
        e.preventDefault();
        if (index < seedLength - 1) {
          inputRefs.current[index + 1]?.focus();
        }
      }
    }
  };

  // Validate word
  const isValidWord = (word) => {
    if (!word) return null;
    return WORDLIST.includes(word.toLowerCase());
  };

  // Paste handler
  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const words = text.trim().toLowerCase().split(/\s+/);
      
      if (words.length === 12 || words.length === 24) {
        setSeedLength(words.length);
        setCustomWords(words);
        setError('');
      } else {
        setError('Invalid phrase. Must be 12 or 24 words.');
      }
    } catch {
      setError('Failed to paste from clipboard');
    }
  };

  // Validate and continue from custom
  const validateCustomPhrase = async () => {
    const words = customWords.filter(w => w.trim());
    
    if (words.length !== seedLength) {
      setError(`Please fill in all ${seedLength} words`);
      return;
    }

    const invalidWords = words.filter(w => !WORDLIST.includes(w.toLowerCase()));
    if (invalidWords.length > 0) {
      setError(`Invalid words: ${invalidWords.join(', ')}`);
      return;
    }

    const phrase = words.join(' ');
    const isValid = await validateMnemonic(phrase);
    if (!isValid) {
      setError('Invalid seed phrase checksum. Please check your words.');
      return;
    }

    setMnemonic(phrase);
    setupVerification(phrase);
  };

  // Setup verification step
  const setupVerification = (phrase) => {
    const words = phrase.split(' ');
    const indices = [];
    while (indices.length < 3) {
      const idx = Math.floor(Math.random() * words.length);
      if (!indices.includes(idx)) indices.push(idx);
    }
    indices.sort((a, b) => a - b);
    setVerifyIndices(indices);
    setVerifyInputs({});
    setStep('verify');
  };

  // Check verification
  const checkVerification = () => {
    const words = mnemonic.split(' ');
    const allCorrect = verifyIndices.every(idx => 
      verifyInputs[idx]?.toLowerCase() === words[idx]
    );
    
    if (allCorrect) {
      setStep('name');
    } else {
      setError('Words do not match. Please try again.');
    }
  };

  // Complete wallet creation
  const handleComplete = () => {
    onComplete(mnemonic, walletName.trim() || 'My Wallet');
  };

  // Copy to clipboard with auto-clear (X1W-007)
  const copyMnemonic = () => {
    // Normalize the mnemonic: trim, lowercase, single spaces
    const cleanMnemonic = mnemonic.trim().toLowerCase().split(/\s+/).join(' ');
    logger.log('Copying mnemonic: [REDACTED]', cleanMnemonic.split(' ').length, 'words');
    navigator.clipboard.writeText(cleanMnemonic);
    setCopied(true);
    
    // X1W-007: Clear clipboard after 30 seconds for security
    setTimeout(() => {
      navigator.clipboard.writeText('').catch(() => {});
      logger.log('Clipboard cleared for security');
    }, 30000);
    
    setTimeout(() => setCopied(false), 2000);
  };

  // Choose screen
  if (step === 'choose') {
    return (
      <div className="screen seed-container no-nav">
        <button className="back-btn" onClick={onBack} style={{ alignSelf: 'flex-start', marginBottom: 16 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>

        <h2>Create New Wallet</h2>
        <p className="seed-subtitle">Choose how to create your seed phrase</p>

        <div className="seed-length-selector">
          <button 
            className={`seed-length-btn ${seedLength === 12 ? 'active' : ''}`}
            onClick={() => handleLengthChange(12)}
          >
            12 Words
          </button>
          <button 
            className={`seed-length-btn ${seedLength === 24 ? 'active' : ''}`}
            onClick={() => handleLengthChange(24)}
          >
            24 Words
          </button>
        </div>

        <div className="create-options">
          <button className="create-option" onClick={generateNew}>
            <div className="create-option-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="2">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="7.5 4.21 12 6.81 16.5 4.21" />
                <polyline points="7.5 19.79 7.5 14.6 3 12" />
                <polyline points="21 12 16.5 14.6 16.5 19.79" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
            </div>
            <div className="create-option-text">
              <span className="create-option-title">Generate Random Phrase</span>
              <span className="create-option-desc">Cryptographically secure (recommended)</span>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>

          <button className="create-option" onClick={switchToCustom}>
            <div className="create-option-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </div>
            <div className="create-option-text">
              <span className="create-option-title">Create Custom Phrase</span>
              <span className="create-option-desc">Select words from BIP-39 wordlist</span>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // Generate screen
  if (step === 'generate') {
    const words = mnemonic.split(' ');
    
    return (
      <div className={`screen seed-container no-nav ${windowBlurred ? 'window-blurred' : ''}`}>
        <button className="back-btn" onClick={() => setStep('choose')} style={{ alignSelf: 'flex-start', marginBottom: 16 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>

        <h2>Your Seed Phrase</h2>
        <p className="seed-subtitle">Write down these words in order and store safely</p>
        
        {/* X1W-NEW-002: Reveal toggle button */}
        <button 
          className="btn-secondary reveal-toggle" 
          onClick={toggleAllRevealed}
          style={{ marginBottom: 12, fontSize: 12 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {allRevealed ? (
              <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>
            ) : (
              <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
            )}
          </svg>
          {allRevealed ? 'Hide All Words' : 'Reveal All Words'}
        </button>

        {/* X1W-NEW-002: Blur overlay when window loses focus */}
        {windowBlurred && (
          <div className="blur-overlay">
            <span>🔒 Window not in focus - seed phrase hidden</span>
          </div>
        )}

        <div className={`seed-grid ${windowBlurred ? 'blurred' : ''}`}>
          {words.map((word, i) => (
            <div 
              key={i} 
              className={`seed-word ${wordsRevealed.has(i) || allRevealed ? 'revealed' : 'masked'}`}
              onClick={() => toggleWordReveal(i)}
              title="Click to reveal/hide"
            >
              <span className="seed-number">{i + 1}</span>
              <span className="seed-text">
                {(wordsRevealed.has(i) || allRevealed) && !windowBlurred ? word : '••••••'}
              </span>
            </div>
          ))}
        </div>

        <div className="seed-actions">
          <button className="btn-secondary" onClick={generateNew}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 4v6h-6" />
              <path d="M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            Regenerate
          </button>
          <button className="btn-secondary" onClick={copyMnemonic}>
            {copied ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        <div className="warning-box">
          <span>⚠️</span>
          <span>Never share your seed phrase. Anyone with these words can access your funds.</span>
        </div>

        <button className="btn-primary" onClick={() => setupVerification(mnemonic)}>
          I've Written It Down
        </button>
      </div>
    );
  }

  // Custom screen
  if (step === 'custom') {
    return (
      <div className="screen seed-container no-nav">
        <button className="back-btn" onClick={() => setStep('choose')} style={{ alignSelf: 'flex-start', marginBottom: 16 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>

        <h2>Custom Seed Phrase</h2>
        <p className="seed-subtitle">Enter {seedLength} words from the BIP-39 wordlist</p>

        <div className="seed-length-selector">
          <button 
            className={`seed-length-btn ${seedLength === 12 ? 'active' : ''}`}
            onClick={() => handleLengthChange(12)}
          >
            12 Words
          </button>
          <button 
            className={`seed-length-btn ${seedLength === 24 ? 'active' : ''}`}
            onClick={() => handleLengthChange(24)}
          >
            24 Words
          </button>
        </div>

        <button className="paste-btn" onClick={handlePaste}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
          </svg>
          Paste from Clipboard
        </button>

        <div className="seed-input-grid">
          {customWords.map((word, i) => (
            <div key={i} className="seed-input-word">
              <span className="seed-input-number">{i + 1}</span>
              <input
                ref={el => inputRefs.current[i] = el}
                type="text"
                value={word}
                onChange={e => handleWordChange(i, e.target.value)}
                onKeyDown={e => handleKeyDown(e, i)}
                onFocus={() => {
                  setActiveInput(i);
                  if (word) {
                    const matches = WORDLIST.filter(w => w.startsWith(word)).slice(0, 5);
                    setSuggestions(matches);
                  }
                }}
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
              <div 
                key={word} 
                className={`suggestion ${i === 0 ? 'first' : ''}`}
                onClick={() => selectSuggestion(word)}
              >
                {word}
              </div>
            ))}
          </div>
        )}

        {error && <div className="error-message">{error}</div>}

        <button className="btn-primary" onClick={validateCustomPhrase}>
          Continue
        </button>
      </div>
    );
  }

  // Verify screen
  if (step === 'verify') {
    const words = mnemonic.split(' ');
    
    return (
      <div className="screen seed-container no-nav">
        <button className="back-btn" onClick={() => setStep('generate')} style={{ alignSelf: 'flex-start', marginBottom: 16 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>

        <h2>Verify Phrase</h2>
        <p className="seed-subtitle">Enter the following words to confirm</p>

        <div className="verify-inputs">
          {verifyIndices.map(idx => (
            <div key={idx} className="verify-input">
              <label>Word #{idx + 1}</label>
              <input
                type="text"
                className="form-input"
                value={verifyInputs[idx] || ''}
                onChange={e => setVerifyInputs({ ...verifyInputs, [idx]: e.target.value })}
                placeholder={`Enter word #${idx + 1}`}
                autoComplete="off"
              />
            </div>
          ))}
        </div>

        {error && <div className="error-message">{error}</div>}

        <button className="btn-primary" onClick={checkVerification}>
          Verify & Continue
        </button>
      </div>
    );
  }

  // Name screen
  if (step === 'name') {
    return (
      <div className="screen seed-container no-nav">
        <button className="back-btn" onClick={() => setStep('verify')} style={{ alignSelf: 'flex-start', marginBottom: 16 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        
        <h2>Name Your Wallet</h2>
        <p className="seed-subtitle">Give your wallet a name to identify it</p>

        <div className="form-group" style={{ marginTop: 24 }}>
          <input
            type="text"
            className="form-input"
            value={walletName}
            onChange={e => setWalletName(e.target.value)}
            placeholder="My Wallet"
            autoFocus
          />
        </div>

        <button className="btn-primary" onClick={handleComplete} style={{ marginTop: 24 }}>
          Create Wallet
        </button>
      </div>
    );
  }

  return null;
}