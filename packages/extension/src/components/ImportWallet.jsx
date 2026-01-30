// Import Wallet Component with Private Key Support
import { logger, getUserFriendlyError, ErrorMessages } from '@x1-wallet/core';
import React, { useState, useRef, useEffect } from 'react';
import { validateMnemonic, WORDLIST } from '@x1-wallet/core/utils/bip39';
import { mnemonicToKeypair } from '@x1-wallet/core/utils/bip44';
import { encodeBase58 } from '@x1-wallet/core/utils/base58';
import { NETWORKS } from '@x1-wallet/core/services/networks';

// Derivation path schemes for Solana
const DERIVATION_SCHEMES = {
  STANDARD: {
    id: 'standard',
    name: 'Standard (Phantom)',
    description: "m/44'/501'/<account>'/0'",
    getPath: (index) => `m/44'/501'/${index}'/0'`
  },
  LEGACY: {
    id: 'legacy', 
    name: 'Legacy (Solflare)',
    description: "m/44'/501'/<account>'",
    getPath: (index) => `m/44'/501'/${index}'`
  }
};

export default function ImportWallet({ onComplete, onBack, onCompletePrivateKey, onCompleteMultiple, onCompleteWatchOnly, sessionPassword, existingWallets = [], initialImportType = 'phrase' }) {
  const [importType, setImportType] = useState(initialImportType); // 'phrase', 'privatekey', or 'watchonly'
  const [seedLength, setSeedLength] = useState(12);
  const [words, setWords] = useState(Array(12).fill(''));
  
  // Watch-only address state
  const [watchAddress, setWatchAddress] = useState('');
  
  // Multi-wallet selection state
  const [derivedAddresses, setDerivedAddresses] = useState([]);
  const [selectedAddresses, setSelectedAddresses] = useState(new Set()); // No default selection
  const [loadingAddresses, setLoadingAddresses] = useState(false);
  const [addressBalances, setAddressBalances] = useState({});
  const [scanMode, setScanMode] = useState('default'); // 'default', 'scan', 'custom'
  const [isScanning, setIsScanning] = useState(false);
  
  // Compute next available wallet number (fills gaps)
  const getNextWalletNumber = () => {
    const usedNumbers = new Set();
    existingWallets.forEach(w => {
      // Match patterns like "Wallet 1", "Wallet 2", etc.
      const match = w.name?.match(/^Wallet\s+(\d+)$/i);
      if (match) {
        usedNumbers.add(parseInt(match[1], 10));
      }
    });
    
    // Find first available number starting from 1
    let num = 1;
    while (usedNumbers.has(num)) {
      num++;
    }
    return num;
  };
  
  const nextWalletNumber = getNextWalletNumber();
  const suggestedName = `Wallet ${nextWalletNumber}`;
  
  const [walletName, setWalletName] = useState('');
  const [step, setStep] = useState('import'); // import, select-derivation, select-addresses, name, password, verify-password, name-pk, password-pk, verify-password-pk
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [activeInput, setActiveInput] = useState(-1);
  const inputRefs = useRef([]);
  
  // Custom derivation path state
  const [customPath, setCustomPath] = useState("m/44'/501'/0'/0'");
  
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
    
    // Go to derivation path selection
    setError('');
    setStep('select-derivation');
  };
  
  // Handle derivation path selection
  const handleDerivationSelect = async (mode) => {
    setScanMode(mode);
    setLoadingAddresses(true);
    setError('');
    
    const phrase = words.join(' ');
    
    try {
      if (mode === 'scan') {
        // Scan all derivation paths for accounts with balances
        await scanAllPaths(phrase);
      } else if (mode === 'custom') {
        // Custom path - derive single account
        // For now, just use index 0 with standard derivation
        // TODO: Add proper custom path derivation when mnemonicToKeypairWithPath is available
        const addresses = [];
        const { publicKey } = await mnemonicToKeypair(phrase, 0);
        const address = encodeBase58(publicKey);
        addresses.push({ 
          index: 0, 
          accountIndex: 0,
          publicKey: address, 
          path: customPath,
          scheme: 'custom',
          uniqueKey: `custom-0`
        });
        setDerivedAddresses(addresses);
        setSelectedAddresses(new Set([0]));
        fetchAddressBalances(addresses);
      } else {
        // Default mode - derive first 5 accounts on standard path
        const addresses = [];
        for (let i = 0; i < 5; i++) {
          const { publicKey } = await mnemonicToKeypair(phrase, i);
          const address = encodeBase58(publicKey);
          addresses.push({ 
            index: i, 
            accountIndex: i,
            publicKey: address, 
            path: DERIVATION_SCHEMES.STANDARD.getPath(i),
            scheme: 'standard',
            uniqueKey: `standard-${i}`
          });
        }
        setDerivedAddresses(addresses);
        setSelectedAddresses(new Set()); // No default selection - user must choose
        
        // Fetch balances in background
        fetchAddressBalances(addresses);
      }
      
      setStep('select-addresses');
    } catch (err) {
      logger.error('[ImportWallet] Failed to derive addresses:', err);
      setError('Failed to derive addresses from seed phrase');
    } finally {
      setLoadingAddresses(false);
    }
  };
  
  // Scan all derivation paths to find accounts with balances
  const scanAllPaths = async (phrase) => {
    setIsScanning(true);
    const allAddresses = [];
    const seenPublicKeys = new Set();
    
    // Get network config for balance checking
    let network = localStorage.getItem('x1wallet_network');
    if (network && network.startsWith('"')) {
      try { network = JSON.parse(network); } catch (e) { /* ignore */ }
    }
    network = network || 'X1 Mainnet';
    const networkConfig = NETWORKS[network];
    
    // Check balance for an address
    const checkBalance = async (publicKey) => {
      if (!networkConfig?.rpcUrl) return 0;
      try {
        const response = await fetch(networkConfig.rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getBalance',
            params: [publicKey, { commitment: 'confirmed' }]
          })
        });
        if (!response.ok) return 0;
        const data = await response.json();
        return (data.result?.value || 0) / Math.pow(10, networkConfig.decimals || 9);
      } catch {
        return 0;
      }
    };
    
    // Derive using standard path (Phantom style: m/44'/501'/{i}'/0')
    const deriveStandard = async (index) => {
      const { publicKey } = await mnemonicToKeypair(phrase, index);
      return encodeBase58(publicKey);
    };
    
    // Derive using legacy path (Solflare style: m/44'/501'/{i}')
    // Note: mnemonicToKeypair uses standard path, so legacy may derive same address
    // We'll try both and deduplicate
    const deriveLegacy = async (index) => {
      // Try to use mnemonicToKeypairWithPath if available, otherwise skip legacy
      try {
        const { mnemonicToKeypairWithPath } = await import('@x1-wallet/core/utils/bip44');
        if (mnemonicToKeypairWithPath) {
          const { publicKey } = await mnemonicToKeypairWithPath(phrase, DERIVATION_SCHEMES.LEGACY.getPath(index));
          return encodeBase58(publicKey);
        }
      } catch {
        // Legacy derivation not available - standard only
      }
      return null;
    };
    
    const balances = {};
    let globalIndex = 0;
    let consecutiveEmpty = 0;
    const MAX_EMPTY = 5; // Stop after 5 consecutive accounts with no balance
    const MAX_ACCOUNTS = 20; // Max accounts to scan per path
    
    // Scan standard path first (most common)
    logger.log('[ImportWallet] Scanning standard path...');
    for (let i = 0; i < MAX_ACCOUNTS && consecutiveEmpty < MAX_EMPTY; i++) {
      try {
        const publicKey = await deriveStandard(i);
        if (seenPublicKeys.has(publicKey)) continue;
        seenPublicKeys.add(publicKey);
        
        const balance = await checkBalance(publicKey);
        const uniqueKey = `standard-${i}`;
        const addrEntry = {
          index: globalIndex,
          accountIndex: i,
          publicKey,
          path: DERIVATION_SCHEMES.STANDARD.getPath(i),
          scheme: 'standard',
          schemeName: DERIVATION_SCHEMES.STANDARD.name,
          uniqueKey,
          balance // Store balance on address entry for sorting
        };
        
        allAddresses.push(addrEntry);
        balances[uniqueKey] = balance;
        globalIndex++;
        
        if (balance > 0) {
          consecutiveEmpty = 0;
        } else {
          consecutiveEmpty++;
        }
      } catch (err) {
        logger.warn('[ImportWallet] Error deriving standard path:', i, err);
        break;
      }
    }
    
    // Try legacy path (Solflare style)
    logger.log('[ImportWallet] Scanning legacy path...');
    consecutiveEmpty = 0;
    for (let i = 0; i < MAX_ACCOUNTS && consecutiveEmpty < MAX_EMPTY; i++) {
      try {
        const publicKey = await deriveLegacy(i);
        if (!publicKey || seenPublicKeys.has(publicKey)) {
          // Legacy derivation not available or duplicate
          if (i === 0) break; // If first one fails, legacy not supported
          continue;
        }
        seenPublicKeys.add(publicKey);
        
        const balance = await checkBalance(publicKey);
        const uniqueKey = `legacy-${i}`;
        const addrEntry = {
          index: globalIndex,
          accountIndex: i,
          publicKey,
          path: DERIVATION_SCHEMES.LEGACY.getPath(i),
          scheme: 'legacy',
          schemeName: DERIVATION_SCHEMES.LEGACY.name,
          uniqueKey,
          balance // Store balance on address entry for sorting
        };
        
        allAddresses.push(addrEntry);
        balances[uniqueKey] = balance;
        globalIndex++;
        
        if (balance > 0) {
          consecutiveEmpty = 0;
        } else {
          consecutiveEmpty++;
        }
      } catch (err) {
        logger.warn('[ImportWallet] Error deriving legacy path:', i, err);
        break;
      }
    }
    
    // Sort: accounts with balance first, then by scheme and index
    allAddresses.sort((a, b) => {
      const balA = a.balance || 0;
      const balB = b.balance || 0;
      if (balA > 0 && balB === 0) return -1;
      if (balB > 0 && balA === 0) return 1;
      if (a.scheme !== b.scheme) return a.scheme === 'standard' ? -1 : 1;
      return a.accountIndex - b.accountIndex;
    });
    
    // Re-index after sorting and build final balances map by new index
    const finalBalances = {};
    const autoSelect = new Set();
    allAddresses.forEach((addr, idx) => {
      addr.index = idx;
      finalBalances[idx] = balances[addr.uniqueKey] || 0;
      if (finalBalances[idx] > 0) {
        autoSelect.add(idx);
      }
    });
    
    setDerivedAddresses(allAddresses);
    setAddressBalances(finalBalances);
    setSelectedAddresses(autoSelect);
    setIsScanning(false);
  };
  
  // Fetch balances for derived addresses
  const fetchAddressBalances = async (addresses) => {
    // Get network from localStorage - handle both raw and JSON formats
    let network = localStorage.getItem('x1wallet_network');
    if (network && network.startsWith('"')) {
      try { network = JSON.parse(network); } catch (e) { /* ignore */ }
    }
    network = network || 'X1 Mainnet';
    
    const networkConfig = NETWORKS[network];
    if (!networkConfig || !networkConfig.rpcUrl) return;
    
    const balances = {};
    for (const addr of addresses) {
      try {
        const response = await fetch(networkConfig.rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getBalance',
            params: [addr.publicKey, { commitment: 'confirmed' }]
          })
        });
        
        if (!response.ok) continue;
        
        const data = await response.json();
        
        if (data.result?.value !== undefined) {
          balances[addr.index] = data.result.value / Math.pow(10, networkConfig.decimals || 9);
        }
      } catch (e) {
        // Ignore balance fetch errors
      }
    }
    
    setAddressBalances(prev => ({ ...prev, ...balances }));
  };
  
  // Toggle address selection
  const toggleAddressSelection = (index) => {
    setSelectedAddresses(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        // Don't allow deselecting if it's the only one
        if (next.size > 1) next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };
  
  // Continue from address selection
  const handleAddressSelectionContinue = () => {
    if (selectedAddresses.size === 0) {
      setError('Please select at least one address');
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
    // Build completion data based on selected addresses
    const completionData = {
      mnemonic: words.join(' '),
      walletName: walletName || suggestedName,
      selectedAddresses: Array.from(selectedAddresses).sort((a, b) => a - b),
      derivedAddresses: derivedAddresses.filter(a => selectedAddresses.has(a.index))
    };
    
    if (!passwordRequired) {
      // Password protection is OFF - complete without password
      if (onCompleteMultiple && completionData.selectedAddresses.length > 1) {
        onCompleteMultiple(completionData.mnemonic, completionData.walletName, null, completionData.derivedAddresses);
      } else {
        // Single address - use standard completion
        const firstAddr = completionData.derivedAddresses[0];
        onComplete(completionData.mnemonic, completionData.walletName, null, firstAddr?.index || 0);
      }
      return;
    }
    
    // If we have a session password, verify it and skip password entry
    if (sessionPassword) {
      try {
        const { checkPassword } = await import('@x1-wallet/core/services/wallet');
        const isValid = await checkPassword(sessionPassword);
        if (isValid) {
          // Session password is valid - complete with it
          if (onCompleteMultiple && completionData.selectedAddresses.length > 1) {
            onCompleteMultiple(completionData.mnemonic, completionData.walletName, sessionPassword, completionData.derivedAddresses);
          } else {
            const firstAddr = completionData.derivedAddresses[0];
            onComplete(completionData.mnemonic, completionData.walletName, sessionPassword, firstAddr?.index || 0);
          }
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
      const selectedAddrsArray = derivedAddresses.filter(a => selectedAddresses.has(a.index));
      if (onCompleteMultiple && selectedAddrsArray.length > 1) {
        onCompleteMultiple(words.join(' '), walletName || suggestedName, password, selectedAddrsArray);
      } else {
        const firstAddr = selectedAddrsArray[0];
        onComplete(words.join(' '), walletName || suggestedName, password, firstAddr?.index || 0);
      }
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
    
    const selectedAddrsArray = derivedAddresses.filter(a => selectedAddresses.has(a.index));
    if (onCompleteMultiple && selectedAddrsArray.length > 1) {
      onCompleteMultiple(words.join(' '), walletName || suggestedName, password, selectedAddrsArray);
    } else {
      const firstAddr = selectedAddrsArray[0];
      onComplete(words.join(' '), walletName || suggestedName, password, firstAddr?.index || 0);
    }
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

  // Load more addresses from seed (standard path only)
  const loadMoreAddresses = async () => {
    if (scanMode === 'scan') return; // Don't allow load more in scan mode
    
    setLoadingAddresses(true);
    try {
      const phrase = words.join(' ');
      // Find highest account index in standard scheme
      const standardAddresses = derivedAddresses.filter(a => a.scheme === 'standard');
      const maxIndex = standardAddresses.length > 0 
        ? Math.max(...standardAddresses.map(a => a.accountIndex ?? a.index)) 
        : -1;
      const startIndex = maxIndex + 1;
      const newAddresses = [];
      
      for (let i = startIndex; i < startIndex + 5; i++) {
        const { publicKey } = await mnemonicToKeypair(phrase, i);
        const address = encodeBase58(publicKey);
        newAddresses.push({ 
          index: derivedAddresses.length + (i - startIndex), 
          accountIndex: i,
          publicKey: address, 
          path: DERIVATION_SCHEMES.STANDARD.getPath(i),
          scheme: 'standard',
          uniqueKey: `standard-${i}`
        });
      }
      
      setDerivedAddresses(prev => [...prev, ...newAddresses]);
      
      // Fetch balances for new addresses
      fetchAddressBalances(newAddresses);
    } catch (err) {
      logger.error('[ImportWallet] Failed to load more addresses:', err);
    } finally {
      setLoadingAddresses(false);
    }
  };

  // Select derivation path step - styled like hardware wallet
  if (step === 'select-derivation') {
    return (
      <div className="screen hardware-screen no-nav" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <button className="back-btn" onClick={() => setStep('import')} style={{ alignSelf: 'flex-start', flexShrink: 0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>

        <h2 style={{ marginBottom: 8, textAlign: 'center', flexShrink: 0 }}>Select Derivation Path</h2>
        <p style={{ margin: '0 0 24px 0', fontSize: 14, color: 'var(--text-muted)', textAlign: 'center', flexShrink: 0 }}>
          Choose how to set up your wallet
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: '1 1 auto' }}>
          {/* Default Option */}
          <button
            onClick={() => handleDerivationSelect('default')}
            disabled={loadingAddresses}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 4,
              padding: 16,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 12,
              cursor: loadingAddresses ? 'not-allowed' : 'pointer',
              textAlign: 'left',
              position: 'relative'
            }}
          >
            <span style={{
              position: 'absolute',
              top: 12,
              right: 12,
              fontSize: 10,
              fontWeight: 600,
              color: '#fff',
              background: 'var(--x1-blue)',
              padding: '3px 8px',
              borderRadius: 4,
              textTransform: 'uppercase'
            }}>
              Recommended
            </span>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
              Default
            </span>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Extended derivation path for most wallets
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 4 }}>
              m/44'/501'/&#123;account&#125;'/0'
            </span>
          </button>

          {/* Scan to Find Option */}
          <button
            onClick={() => handleDerivationSelect('scan')}
            disabled={loadingAddresses}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 4,
              padding: 16,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 12,
              cursor: loadingAddresses ? 'not-allowed' : 'pointer',
              textAlign: 'left'
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
              Scan to Find
            </span>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Search Solflare, deprecated, and legacy paths for existing accounts
            </span>
          </button>

          {/* Custom Path Option */}
          <button
            onClick={() => {
              // Show custom path input
              const path = prompt("Enter derivation path:", customPath);
              if (path) {
                setCustomPath(path);
                handleDerivationSelect('custom');
              }
            }}
            disabled={loadingAddresses}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 4,
              padding: 16,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 12,
              cursor: loadingAddresses ? 'not-allowed' : 'pointer',
              textAlign: 'left'
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
              Custom Path
            </span>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Enter a specific path (e.g., m/44'/501'/0'/0')
            </span>
          </button>
        </div>

        {/* Loading indicator */}
        {loadingAddresses && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: 16,
            color: 'var(--text-muted)',
            fontSize: 13
          }}>
            <div style={{
              width: 16,
              height: 16,
              border: '2px solid var(--border-color)',
              borderTopColor: 'var(--x1-blue)',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }} />
            {scanMode === 'scan' ? 'Scanning for accounts...' : 'Loading accounts...'}
          </div>
        )}

        {error && <div className="error-message" style={{ marginTop: 12 }}>{error}</div>}
      </div>
    );
  }

  // Select addresses step - styled like hardware wallet
  if (step === 'select-addresses') {
    // Get network - handle both raw and JSON formats
    let network = localStorage.getItem('x1wallet_network');
    if (network && network.startsWith('"')) {
      try { network = JSON.parse(network); } catch (e) { /* ignore */ }
    }
    network = network || 'X1 Mainnet';
    
    const networkConfig = NETWORKS[network];
    const symbol = networkConfig?.symbol || 'XNT';
    
    // Check if address is already imported
    const isAlreadyImported = (publicKey) => {
      return existingWallets.some(w => 
        w.publicKey === publicKey || 
        w.addresses?.some(a => a.publicKey === publicKey)
      );
    };
    
    return (
      <div className="screen hardware-screen no-nav" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <button className="back-btn" onClick={() => setStep('select-derivation')} style={{ alignSelf: 'flex-start', flexShrink: 0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>

        <h2 style={{ marginBottom: 6, textAlign: 'left', flexShrink: 0 }}>Select Accounts</h2>
        <p style={{ margin: '0 0 8px 0', fontSize: 14, color: 'var(--text-muted)', flexShrink: 0 }}>
          {scanMode === 'scan' 
            ? 'Accounts found across all derivation paths' 
            : 'Choose accounts to import'}
        </p>
        {selectedAddresses.size > 0 && (
          <p style={{ margin: '0 0 12px 0', fontSize: 13, color: 'var(--x1-blue)', flexShrink: 0 }}>
            {selectedAddresses.size} account{selectedAddresses.size > 1 ? 's' : ''} selected
          </p>
        )}
        
        {/* Scanning indicator */}
        {isScanning && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '12px',
            background: 'var(--bg-secondary)',
            borderRadius: 8,
            marginBottom: 12,
            color: 'var(--text-muted)',
            fontSize: 13
          }}>
            <div style={{
              width: 16,
              height: 16,
              border: '2px solid var(--border-color)',
              borderTopColor: 'var(--x1-blue)',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }} />
            Scanning paths for accounts with balances...
          </div>
        )}

        {/* Account list - flex grow with overflow when needed */}
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          gap: 6, 
          flex: '1 1 auto',
          overflowY: 'auto',
          minHeight: 0,
          paddingRight: 4,
          marginBottom: 12
        }}>
          {derivedAddresses.map((addr) => {
            const alreadyImported = isAlreadyImported(addr.publicKey);
            const isSelected = selectedAddresses.has(addr.index);
            const balance = addressBalances[addr.index] ?? addressBalances[addr.accountIndex];
            
            return (
              <div 
                key={addr.uniqueKey || addr.index}
                onClick={() => !alreadyImported && toggleAddressSelection(addr.index)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  background: alreadyImported 
                    ? 'var(--bg-tertiary)' 
                    : isSelected 
                      ? 'rgba(2, 116, 251, 0.1)' 
                      : 'var(--bg-secondary)',
                  border: isSelected 
                    ? '1px solid var(--x1-blue)' 
                    : '1px solid var(--border-color)',
                  borderRadius: 8,
                  cursor: alreadyImported ? 'not-allowed' : 'pointer',
                  opacity: alreadyImported ? 0.5 : 1,
                  transition: 'all 0.15s ease',
                  flexShrink: 0
                }}
              >
                {/* Account icon */}
                <div style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  background: 'var(--bg-tertiary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
                    <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" />
                    <path d="M4 6v12c0 1.1.9 2 2 2h14v-4" />
                    <path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z" />
                  </svg>
                </div>
                
                {/* Account info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>
                        Account {(addr.accountIndex ?? addr.index) + 1}
                      </span>
                      {/* Show path badge if scanning all paths */}
                      {addr.schemeName && (
                        <span style={{ 
                          fontSize: 9, 
                          color: addr.scheme === 'legacy' ? '#ffc107' : 'var(--x1-blue)', 
                          background: addr.scheme === 'legacy' ? 'rgba(255, 193, 7, 0.1)' : 'rgba(2, 116, 251, 0.1)',
                          padding: '1px 4px',
                          borderRadius: 3
                        }}>
                          {addr.scheme === 'legacy' ? 'Legacy' : 'Standard'}
                        </span>
                      )}
                    </div>
                    {alreadyImported && (
                      <span style={{ 
                        fontSize: 9, 
                        color: 'var(--text-muted)', 
                        background: 'var(--bg-secondary)',
                        padding: '1px 4px',
                        borderRadius: 3
                      }}>
                        Added
                      </span>
                    )}
                  </div>
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    marginTop: 1
                  }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      {addr.publicKey.slice(0, 5)}...{addr.publicKey.slice(-5)}
                    </span>
                    <span style={{ 
                      fontSize: 11, 
                      color: balance > 0 ? 'var(--success)' : 'var(--text-muted)',
                      fontWeight: balance > 0 ? 600 : 400
                    }}>
                      {balance !== undefined ? `${balance.toFixed(4)} ${symbol}` : '...'}
                    </span>
                  </div>
                </div>
                
                {/* Checkmark when selected */}
                {isSelected && !alreadyImported && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--x1-blue)" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
            );
          })}
          
          {/* Load More - only in standard mode */}
          {scanMode !== 'scan' && (
            <button
              onClick={loadMoreAddresses}
              disabled={loadingAddresses}
              style={{
                padding: '6px',
                background: 'transparent',
                border: '1px dashed var(--border-color)',
                borderRadius: 6,
                color: 'var(--text-muted)',
                fontSize: 12,
                cursor: loadingAddresses ? 'not-allowed' : 'pointer',
                flexShrink: 0
              }}
            >
              {loadingAddresses ? 'Loading...' : '+ Load More'}
            </button>
          )}
        </div>
        
        {error && <div className="error-message" style={{ marginBottom: 12, flexShrink: 0 }}>{error}</div>}
        
        <div style={{ flexShrink: 0, paddingBottom: 16 }}>
          <button 
            className="btn-primary" 
            type="button" 
            onClick={handleAddressSelectionContinue}
            disabled={selectedAddresses.size === 0}
            style={{ width: '100%' }}
          >
            Continue{selectedAddresses.size > 0 ? ` with ${selectedAddresses.size} Account${selectedAddresses.size > 1 ? 's' : ''}` : ''}
          </button>
        </div>
      </div>
    );
  }

  // Name step for seed phrase
  if (step === 'name') {
    return (
      <div className="screen no-nav">
        <div className="page-header">
          <div className="header-left">
            <button className="back-btn" type="button" onClick={() => setStep('select-addresses')}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
          <h2 className="header-title">Name Your Wallet</h2>
          <div className="header-right" />
        </div>
        <div className="screen-content seed-container" style={{ paddingTop: 0 }}>
          <p className="seed-subtitle">
            {selectedAddresses.size > 1 
              ? `Name for ${selectedAddresses.size} wallets (will be numbered)`
              : 'Give your imported wallet a name'}
          </p>
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
            Private Key
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
          <button className="btn-primary" type="button" onClick={handleContinue}>
            Continue
          </button>
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
      
      {importType === 'watchonly' && (
        <>
          <div className="info-box" style={{ marginTop: 16, marginBottom: 16 }}>
            <span>👁️</span>
            <span>Watch-only wallets let you monitor an address without being able to send from it.</span>
          </div>
          
          <div className="form-group">
            <label>Public Address</label>
            <input
              type="text"
              className="form-input"
              placeholder="Enter Solana/X1 address to watch"
              value={watchAddress}
              onChange={(e) => { setWatchAddress(e.target.value); setError(''); }}
              autoFocus
            />
          </div>
          
          <div className="form-group" style={{ marginTop: 16 }}>
            <label>Name (optional)</label>
            <input
              type="text"
              className="form-input"
              placeholder={suggestedName}
              value={walletName}
              onChange={(e) => setWalletName(e.target.value)}
            />
          </div>
          
          {error && <div className="error-message" style={{ marginTop: 16 }}>{error}</div>}
          
          <button 
            className="btn-primary" 
            type="button" 
            onClick={() => {
              if (!watchAddress.trim()) {
                setError('Please enter an address to watch');
                return;
              }
              // Validate address format (basic Solana/X1 address validation)
              const addr = watchAddress.trim();
              if (addr.length < 32 || addr.length > 44) {
                setError('Invalid address format');
                return;
              }
              // Check for valid base58 characters
              if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(addr)) {
                setError('Address contains invalid characters');
                return;
              }
              // Call the watch-only completion handler
              if (onCompleteWatchOnly) {
                onCompleteWatchOnly({
                  publicKey: addr,
                  name: walletName || suggestedName,
                  type: 'watchonly'
                });
              } else {
                setError('Watch-only wallets are not supported yet');
              }
            }} 
            style={{ marginTop: 20 }}
          >
            Add Watch-Only Wallet
          </button>
        </>
      )}
      </div>
    </div>
  );
}