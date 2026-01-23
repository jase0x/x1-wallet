// Import Wallet Component with Private Key Support
import { logger, getUserFriendlyError, ErrorMessages } from '@x1-wallet/core';
import React, { useState, useRef, useEffect } from 'react';
import { validateMnemonic, WORDLIST } from '@x1-wallet/core/utils/bip39';

export default function ImportWallet({ onComplete, onBack, onCompletePrivateKey, sessionPassword, existingWallets = [] }) {
  const [importType, setImportType] = useState('phrase'); // 'phrase' or 'privatekey'
  const [seedLength, setSeedLength] = useState(12);
  const [words, setWords] = useState(Array(12).fill(''));
  
  // Compute next wallet number from existing wallets
  const getNextWalletNumber = () => {
    let maxNumber = 0;
    existingWallets.forEach(w => {
      // Match patterns like "Wallet 1", "My Wallet 2", "Imported Wallet 3", etc.
      const match = w.name?.match(/(\d+)\s*$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNumber) maxNumber = num;
      }
    });
    // If no numbered wallets found, use wallet count
    return Math.max(maxNumber, existingWallets.length) + 1;
  };
  
  const nextWalletNumber = getNextWalletNumber();
  const suggestedName = `Wallet ${nextWalletNumber}`;
  
  const [walletName, setWalletName] = useState('');
  const [step, setStep] = useState('import'); // import, name, password, verify-password, name-pk, password-pk, verify-password-pk
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [activeInput, setActiveInput] = useState(-1);
  const inputRefs = useRef([]);
  
  // Private key state
  const [privateKeyInput, setPrivateKeyInput] = useState('');
  
  // Password state (mandatory encryption)
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [existingPasswordDetected, setExistingPasswordDetected] = useState(false);
  const [passwordRequired, setPasswordRequired] = useState(true); // Whether password step is needed
  const [verifying, setVerifying] = useState(false);
  
  // Check for existing password on mount using wallet service
  useEffect(() => {
    const checkPassword = async () => {
      try {
        // IMPORT wallet: ALWAYS requires password (existing funds need protection)
        // This will also turn ON password protection if it was OFF
        setPasswordRequired(true);
        
        // Check if encryption is already enabled (data is encrypted)
        const encryptionEnabled = localStorage.getItem('x1wallet_encrypted') === 'true';
        
        // Check if password protection is currently OFF
        // If OFF, auth was cleared so always create new password
        const storedProtection = localStorage.getItem('x1wallet_passwordProtection');
        const protectionIsOff = !storedProtection || storedProtection === 'false';
        
        // If encryption is enabled but protection is "off", encryption takes precedence
        if (protectionIsOff && !encryptionEnabled) {
          // Protection is OFF and no encryption = no valid password exists, create new
          setExistingPasswordDetected(false);
          logger.log('[ImportWallet] Protection is OFF and no encryption - will create new password');
          return;
        }
        
        // Protection is ON or encryption is enabled - check if password already exists
        const localAuth = localStorage.getItem('x1wallet_auth');
        const hasLocalAuth = localAuth && localAuth !== 'null' && localAuth.length > 10;
        
        const { hasPassword } = await import('@x1-wallet/core/services/wallet');
        const has = await hasPassword();
        
        // Check if there are any wallets
        const walletsData = localStorage.getItem('x1wallet_wallets');
        const isEmpty = !walletsData || walletsData === '[]' || walletsData === 'null' || walletsData === '';
        
        // Show verify if: (password exists OR encryption enabled) AND wallets exist
        const passwordExists = has || hasLocalAuth || encryptionEnabled;
        setExistingPasswordDetected(passwordExists && !isEmpty);
        logger.log('[ImportWallet] Password check - service:', has, 'localStorage:', hasLocalAuth, 'encrypted:', encryptionEnabled, 'wallets:', !isEmpty);
      } catch (e) {
        logger.error('[ImportWallet] Error checking password:', e);
        setExistingPasswordDetected(false);
        setPasswordRequired(true);
      }
    };
    checkPassword();
  }, []);

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
      e.preventDefault(); // Always prevent default for Enter/Tab
      if (suggestions.length > 0) {
        selectSuggestion(suggestions[0]);
      } else if (e.key === 'Enter') {
        // If on last word and all filled, trigger continue
        // Otherwise move to next field
        if (index === seedLength - 1) {
          const filledWords = words.filter(w => w.trim());
          if (filledWords.length === seedLength) {
            handleContinue();
          }
        } else {
          inputRefs.current[index + 1]?.focus();
        }
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

  // Password validation (Option 1: min 8 chars, at least one letter + one number)
  const validatePassword = (pwd) => {
    if (!pwd || pwd.length < 8) {
      return 'Password must be at least 8 characters';
    }
    if (!/[a-zA-Z]/.test(pwd)) {
      return 'Password must contain at least one letter';
    }
    if (!/[0-9]/.test(pwd)) {
      return 'Password must contain at least one number';
    }
    // Check for common weak patterns
    const commonPatterns = ['password', '12345678', 'qwerty', 'abcdef', 'letmein'];
    const lowerPwd = String(pwd).toLowerCase();
    for (const pattern of commonPatterns) {
      if (lowerPwd.includes(pattern)) {
        return 'Password contains a common weak pattern';
      }
    }
    return null;
  };

  // Move to password step after naming (or verify if password exists, or skip if not required)
  const handleNameContinue = async () => {
    if (!passwordRequired) {
      // Password protection is OFF - complete without password
      onComplete(words.join(' '), walletName || suggestedName, null);
      return;
    }
    
    // If we have a session password, verify it and skip password entry
    if (sessionPassword) {
      try {
        const { checkPassword } = await import('@x1-wallet/core/services/wallet');
        const isValid = await checkPassword(sessionPassword);
        if (isValid) {
          // Session password is valid - complete with it
          onComplete(words.join(' '), walletName || suggestedName, sessionPassword);
          return;
        }
      } catch (e) {
        logger.warn('[ImportWallet] Session password verification failed:', e);
      }
      // Session password invalid - fall through to password entry
    }
    
    if (existingPasswordDetected) {
      // Password already exists - require verification
      setStep('verify-password');
      setPassword('');
      setError('');
    } else {
      setStep('password');
      setError('');
    }
  };
  
  // Verify existing password and complete import
  const handleVerifyAndComplete = async () => {
    if (!password) {
      setError('Please enter your password');
      return;
    }
    
    setVerifying(true);
    setError('');
    
    try {
      const { checkPassword } = await import('@x1-wallet/core/services/wallet');
      const isValid = await checkPassword(password);
      if (!isValid) {
        setError('Incorrect password');
        setVerifying(false);
        return;
      }
      
      // Password verified - complete import with password for encryption
      onComplete(words.join(' '), walletName || suggestedName, password);
    } catch (err) {
      logger.error('Password verification error:', err);
      // If verification throws an error, it might mean no valid password exists
      // Fall back to creating a new password
      logger.log('[ImportWallet] Verification failed, falling back to password creation');
      setStep('password');
      setPassword('');
      setError('');
      setVerifying(false);
    }
  };

  // Complete with password (seed phrase import)
  const handleComplete = () => {
    const pwdError = validatePassword(password);
    if (pwdError) {
      setError(pwdError);
      return;
    }
    
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    
    onComplete(words.join(' '), walletName || suggestedName, password);
  };
  
  // Private Key Import (handles base58 and byte array formats)
  const handlePrivateKeyImport = async () => {
    setError('');
    
    if (!privateKeyInput.trim()) {
      setError('Please enter a private key');
      return;
    }
    
    try {
      const trimmedInput = privateKeyInput.trim();
      let keyBytes = null;
      
      // Check if it's a byte array format [1,2,3,...]
      if (trimmedInput.startsWith('[') && trimmedInput.endsWith(']')) {
        try {
          const parsed = JSON.parse(trimmedInput);
          if (Array.isArray(parsed) && parsed.every(n => typeof n === 'number' && n >= 0 && n <= 255)) {
            keyBytes = new Uint8Array(parsed);
          } else {
            setError('Invalid byte array format');
            return;
          }
        } catch (jsonErr) {
          setError('Invalid byte array format');
          return;
        }
      } else {
        // Base58 format
        const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
        if (!base58Regex.test(trimmedInput)) {
          setError('Invalid private key format');
          return;
        }
        
        const { decodeBase58 } = await import('@x1-wallet/core/utils/base58');
        keyBytes = decodeBase58(trimmedInput);
      }
      
      // Validate key length
      if (keyBytes.length !== 64 && keyBytes.length !== 32) {
        setError(`Invalid key length: ${keyBytes.length} bytes (expected 32 or 64)`);
        return;
      }
      
      // If 32 bytes, we need to derive the public key
      let secretKey = keyBytes;
      let publicKey;
      
      if (keyBytes.length === 32) {
        // Need to derive keypair from seed
        const { getPublicKey } = await import('@x1-wallet/core/utils/bip44');
        publicKey = getPublicKey(keyBytes);
        // Create full 64-byte secret key
        secretKey = new Uint8Array(64);
        secretKey.set(keyBytes, 0);
        secretKey.set(publicKey, 32);
      } else {
        // Already 64 bytes - extract public key
        publicKey = keyBytes.slice(32);
      }
      
      const { encodeBase58 } = await import('@x1-wallet/core/utils/base58');
      const privateKeyBase58 = encodeBase58(secretKey);
      
      // Store the base58 version for completion
      setPrivateKeyInput(privateKeyBase58);
      
      // Move to naming step with private key data
      setStep('name-pk');
      
    } catch (err) {
      logger.error('Import error:', err);
      setError('Failed to import: ' + err.message);
    }
  };
  
  // Move to password step after naming (private key) - or verify if password exists, or skip if not required
  const handleNamePkContinue = async () => {
    if (!passwordRequired) {
      // Password protection is OFF - complete without password
      await completePrivateKeyImport(null);
      return;
    }
    
    // If we have a session password, verify it and skip password entry
    if (sessionPassword) {
      try {
        const { checkPassword } = await import('@x1-wallet/core/services/wallet');
        const isValid = await checkPassword(sessionPassword);
        if (isValid) {
          // Session password is valid - complete with it
          await completePrivateKeyImport(sessionPassword);
          return;
        }
      } catch (e) {
        logger.warn('[ImportWallet] Session password verification failed:', e);
      }
      // Session password invalid - fall through to password entry
    }
    
    if (existingPasswordDetected) {
      // Password already exists - require verification
      setStep('verify-password-pk');
      setPassword('');
      setError('');
    } else {
      setStep('password-pk');
      setError('');
    }
  };
  
  // Verify existing password and complete private key import
  const handleVerifyAndCompletePk = async () => {
    if (!password) {
      setError('Please enter your password');
      return;
    }
    
    setVerifying(true);
    setError('');
    
    try {
      const { checkPassword } = await import('@x1-wallet/core/services/wallet');
      const isValid = await checkPassword(password);
      if (!isValid) {
        setError('Incorrect password');
        setVerifying(false);
        return;
      }
      
      // Password verified - complete import with password for encryption
      await completePrivateKeyImport(password);
    } catch (err) {
      logger.error('Password verification error:', err);
      // If verification throws an error, fall back to creating a new password
      logger.log('[ImportWallet] Verification failed, falling back to password creation');
      setStep('password-pk');
      setPassword('');
      setError('');
      setVerifying(false);
    }
  };
  
  // Helper to complete private key import
  const completePrivateKeyImport = async (pwd) => {
    try {
      const trimmedInput = privateKeyInput.trim();
      const { decodeBase58, encodeBase58 } = await import('@x1-wallet/core/utils/base58');
      
      // Parse the private key (it should already be base58 at this point)
      let keyBytes;
      if (trimmedInput.startsWith('[')) {
        keyBytes = new Uint8Array(JSON.parse(trimmedInput));
      } else {
        keyBytes = decodeBase58(trimmedInput);
      }
      
      // Get public key
      let publicKeyBytes;
      if (keyBytes.length === 64) {
        publicKeyBytes = keyBytes.slice(32);
      } else {
        const { getPublicKey } = await import('@x1-wallet/core/utils/bip44');
        publicKeyBytes = getPublicKey(keyBytes);
      }
      
      const publicKeyBase58 = encodeBase58(publicKeyBytes);
      const privateKeyBase58 = trimmedInput;
      
      onCompletePrivateKey({
        publicKey: publicKeyBase58,
        privateKey: privateKeyBase58,
        name: walletName || suggestedName,
        password: pwd
      });
    } catch (err) {
      logger.error('Private key import error:', err);
      setError('Failed to import: ' + err.message);
    }
  };
  
  const handleCompletePrivateKey = async () => {
    // Validate password
    const pwdError = validatePassword(password);
    if (pwdError) {
      setError(pwdError);
      return;
    }
    
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    
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
        name: walletName || suggestedName,
        password: password
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
            <button className="back-btn" type="button" onClick={() => setStep('import')}>
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
            <input type="text" className="form-input" value={walletName} onChange={e => setWalletName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleNameContinue()} placeholder={suggestedName} autoFocus />
          </div>
          <button className="btn-primary" type="button" onClick={handleNameContinue} style={{ marginTop: 24 }}>Continue</button>
        </div>
      </div>
    );
  }

  // Password step for seed phrase import
  if (step === 'password') {
    return (
      <div className="screen no-nav">
        <div className="page-header">
          <div className="header-left">
            <button className="back-btn" type="button" onClick={() => setStep('name')}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
          <h2 className="header-title">Secure Wallet</h2>
          <div className="header-right" />
        </div>
        <div className="screen-content seed-container" style={{ paddingTop: 0 }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ 
              width: 64, 
              height: 64, 
              borderRadius: '50%', 
              background: 'rgba(var(--x1-blue-rgb), 0.1)', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              margin: '0 auto 16px'
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <p className="seed-subtitle">Create a password to encrypt your wallet</p>
          </div>

          <div className="form-group" style={{ marginBottom: 16 }}>
            <label>Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                className="form-input"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                placeholder="Enter password"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 4
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2">
                  {showPassword ? (
                    <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>
                  ) : (
                    <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
                  )}
                </svg>
              </button>
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 16 }}>
            <label>Confirm Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                className="form-input"
                value={confirmPassword}
                onChange={e => { setConfirmPassword(e.target.value); setError(''); }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 4
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2">
                  {showPassword ? (
                    <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>
                  ) : (
                    <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
                  )}
                </svg>
              </button>
            </div>
          </div>

          <div className="info-box" style={{ marginBottom: 16 }}>
            <span>🔒</span>
            <span>Min 8 characters with at least one letter and one number.</span>
          </div>

          {error && <div className="error-message" style={{ marginBottom: 16 }}>{error}</div>}

          <button className="btn-primary" type="button" onClick={handleComplete}>Import Wallet</button>
        </div>
      </div>
    );
  }
  
  // Verify existing password step (mnemonic)
  if (step === 'verify-password') {
    return (
      <div className="screen no-nav">
        <div className="page-header">
          <div className="header-left">
            <button className="back-btn" type="button" onClick={() => setStep('name')}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
          <h2 className="header-title">Verify Password</h2>
          <div className="header-right" />
        </div>
        <div className="screen-content seed-container" style={{ paddingTop: 0 }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ 
              width: 64, 
              height: 64, 
              borderRadius: '50%', 
              background: 'rgba(var(--x1-blue-rgb), 0.1)', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              margin: '0 auto 16px'
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <p className="seed-subtitle">Enter your existing password to import this wallet</p>
          </div>

          <div className="form-group" style={{ marginBottom: 16 }}>
            <label>Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                className="form-input"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                placeholder="Enter your password"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleVerifyAndComplete()}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 4
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2">
                  {showPassword ? (
                    <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>
                  ) : (
                    <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
                  )}
                </svg>
              </button>
            </div>
          </div>

          {error && <div className="error-message" style={{ marginBottom: 16 }}>{error}</div>}

          <button 
            className="btn-primary" 
            type="button"
            onClick={handleVerifyAndComplete}
            disabled={verifying}
          >
            {verifying ? 'Verifying...' : 'Import Wallet'}
          </button>
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
            <button className="back-btn" type="button" onClick={() => setStep('import')}>
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
            <input type="text" className="form-input" value={walletName} onChange={e => setWalletName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleNamePkContinue()} placeholder={suggestedName} autoFocus />
          </div>
          {error && <div className="error-message">{error}</div>}
          <button className="btn-primary" type="button" onClick={handleNamePkContinue} style={{ marginTop: 24 }}>Continue</button>
        </div>
      </div>
    );
  }

  // Password step for private key import
  if (step === 'password-pk') {
    return (
      <div className="screen no-nav">
        <div className="page-header">
          <div className="header-left">
            <button className="back-btn" type="button" onClick={() => setStep('name-pk')}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
          <h2 className="header-title">Secure Wallet</h2>
          <div className="header-right" />
        </div>
        <div className="screen-content seed-container" style={{ paddingTop: 0 }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ 
              width: 64, 
              height: 64, 
              borderRadius: '50%', 
              background: 'rgba(var(--x1-blue-rgb), 0.1)', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              margin: '0 auto 16px'
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <p className="seed-subtitle">Create a password to encrypt your wallet</p>
          </div>

          <div className="form-group" style={{ marginBottom: 16 }}>
            <label>Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                className="form-input"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                placeholder="Enter password"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 4
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2">
                  {showPassword ? (
                    <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>
                  ) : (
                    <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
                  )}
                </svg>
              </button>
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 16 }}>
            <label>Confirm Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                className="form-input"
                value={confirmPassword}
                onChange={e => { setConfirmPassword(e.target.value); setError(''); }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 4
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2">
                  {showPassword ? (
                    <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>
                  ) : (
                    <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
                  )}
                </svg>
              </button>
            </div>
          </div>

          <div className="info-box" style={{ marginBottom: 16 }}>
            <span>🔒</span>
            <span>Min 8 characters with at least one letter and one number.</span>
          </div>

          {error && <div className="error-message" style={{ marginBottom: 16 }}>{error}</div>}

          <button className="btn-primary" type="button" onClick={handleCompletePrivateKey}>Import Wallet</button>
        </div>
      </div>
    );
  }
  
  // Verify existing password step (private key)
  if (step === 'verify-password-pk') {
    return (
      <div className="screen no-nav">
        <div className="page-header">
          <div className="header-left">
            <button className="back-btn" type="button" onClick={() => setStep('name-pk')}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
          <h2 className="header-title">Verify Password</h2>
          <div className="header-right" />
        </div>
        <div className="screen-content seed-container" style={{ paddingTop: 0 }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ 
              width: 64, 
              height: 64, 
              borderRadius: '50%', 
              background: 'rgba(var(--x1-blue-rgb), 0.1)', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              margin: '0 auto 16px'
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <p className="seed-subtitle">Enter your existing password to import this wallet</p>
          </div>

          <div className="form-group" style={{ marginBottom: 16 }}>
            <label>Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                className="form-input"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                placeholder="Enter your password"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleVerifyAndCompletePk()}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 4
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2">
                  {showPassword ? (
                    <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>
                  ) : (
                    <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
                  )}
                </svg>
              </button>
            </div>
          </div>

          {error && <div className="error-message" style={{ marginBottom: 16 }}>{error}</div>}

          <button 
            className="btn-primary" 
            type="button"
            onClick={handleVerifyAndCompletePk}
            disabled={verifying}
          >
            {verifying ? 'Verifying...' : 'Import Wallet'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen no-nav">
      {/* Header */}
      <div className="page-header">
        <div className="header-left">
          <button className="back-btn" type="button" onClick={onBack}>
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
            type="button"
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
            type="button"
            className={`import-type-btn ${importType === 'privatekey' ? 'active' : ''}`} 
            onClick={() => { setImportType('privatekey'); setError(''); }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
            Private Key / Bytes
          </button>
        </div>
      
      {importType === 'phrase' && (
        <>
          <div className="seed-length-selector">
            <button type="button" className={`seed-length-btn ${seedLength === 12 ? 'active' : ''}`} onClick={() => handleLengthChange(12)}>12 Words</button>
            <button type="button" className={`seed-length-btn ${seedLength === 24 ? 'active' : ''}`} onClick={() => handleLengthChange(24)}>24 Words</button>
          </div>
          <button type="button" className="paste-btn" onClick={handlePaste}>
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
          <button className="btn-primary" type="button" onClick={handleContinue}>Continue</button>
        </>
      )}
      
      {importType === 'privatekey' && (
        <>
          <div className="warning-box" style={{ marginTop: 16 }}>
            <span>⚠️</span>
            <span>Enter your private key. Never share this with anyone.</span>
          </div>
          
          <div className="form-group" style={{ marginTop: 16 }}>
            <label>Private Key</label>
            <textarea
              className="form-input private-key-input"
              placeholder="Paste Key (private or byte array)"
              value={privateKeyInput}
              onChange={(e) => { setPrivateKeyInput(e.target.value); setError(''); }}
              rows={4}
            />
          </div>
          
          <div className="info-box" style={{ marginTop: 12 }}>
            <span>ℹ️</span>
            <span>Accepts base58 format or byte array [1,2,3,...] format.</span>
          </div>
          
          {error && <div className="error-message" style={{ marginTop: 16 }}>{error}</div>}
          
          <button className="btn-primary" type="button" onClick={handlePrivateKeyImport} style={{ marginTop: 20 }}>Continue</button>
        </>
      )}
      </div>
    </div>
  );
}