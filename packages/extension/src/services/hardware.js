// Hardware Wallet Service - Ledger and Trezor Integration
import { Buffer } from 'buffer';

// Production-safe logger (only logs in development)
const isDev = typeof process !== 'undefined' 
  ? process.env.NODE_ENV === 'development'
  : (typeof window !== 'undefined' && window.location?.hostname === 'localhost');

const logger = {
  log: (...args) => isDev && console.log('[Hardware]', ...args),
  warn: (...args) => console.warn('[Hardware]', ...args), // Always log warnings
  error: (...args) => console.error('[Hardware]', ...args), // Always log errors
};

// Make Buffer available globally for Ledger libs
if (typeof window !== 'undefined') {
  window.Buffer = Buffer;
}

// Device states
export const LEDGER_STATES = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  APP_CLOSED: 'app_closed',
  READY: 'ready',
  ERROR: 'error'
};

// Hardware wallet types
export const HW_TYPES = {
  LEDGER: 'ledger',
  TREZOR: 'trezor'
};

// Connection types
export const CONNECTION_TYPES = {
  USB: 'usb',
  BLUETOOTH: 'bluetooth'
};

// Derivation path schemes supported by different wallets
export const DERIVATION_SCHEMES = {
  // Standard BIP44: m/44'/501'/{account}'
  BIP44_STANDARD: {
    id: 'bip44_standard',
    name: 'Standard (BIP44)',
    description: "m/44'/501'/<account>'",
    getPath: (index) => `44'/501'/${index}'`
  },
  // Extended BIP44: m/44'/501'/{account}'/0'
  BIP44_EXTENDED: {
    id: 'bip44_extended',
    name: 'Extended (BIP44)',
    description: "m/44'/501'/<account>'/0'",
    getPath: (index) => `44'/501'/${index}'/0'`
  },
  // Legacy BIP44 Change: m/44'/501'/0'/{account}'
  BIP44_LEGACY: {
    id: 'bip44_legacy',
    name: 'Legacy',
    description: "m/44'/501'/0'/<account>'",
    getPath: (index) => `44'/501'/0'/${index}'`
  }
};

class HardwareWalletService {
  constructor() {
    this.transport = null;
    this.solanaApp = null;
    this.deviceType = null;
    this.connectionType = null;
    this.state = LEDGER_STATES.DISCONNECTED;
    this.publicKey = null;
    this.derivationPath = "44'/501'/0'/0'"; // Solana default, works for X1 too
    this.currentScheme = DERIVATION_SCHEMES.BIP44_EXTENDED; // Default scheme
    
    // Session invalid flag - forces reconnection after Ledger errors
    // This prevents 0x6a81 errors from corrupted transport state
    this.sessionInvalid = false;
  }
  
  // Mark session as invalid and close transport
  // Call this after ANY Ledger transport/status error
  async invalidateSession(reason = 'unknown') {
    logger.warn('[Hardware] Invalidating session:', reason);
    this.sessionInvalid = true;
    await this.disconnect();
  }
  
  // Check if session is valid, throw if not
  ensureValidSession() {
    if (this.sessionInvalid) {
      throw new Error('Ledger session expired. Please reconnect your device and open the Solana app.');
    }
  }
  
  // Preflight check - verify Solana app is responsive before signing
  async preflightCheck() {
    if (!this.solanaApp) {
      throw new Error('Solana app not initialized');
    }
    
    try {
      // Quick check that the app is responsive
      await this.solanaApp.getAppConfiguration();
      return true;
    } catch (err) {
      logger.error('[Hardware] Preflight check failed:', err.message);
      await this.invalidateSession('preflight failed: ' + err.message);
      throw new Error('Ledger not ready. Please unlock your device and open the Solana app.');
    }
  }

  // Check if WebUSB/WebHID is supported
  isSupported() {
    return typeof navigator !== 'undefined' && 
           (navigator.usb !== undefined || navigator.hid !== undefined || navigator.bluetooth !== undefined);
  }

  // Check if Bluetooth is supported
  isBluetoothSupported() {
    return typeof navigator !== 'undefined' && navigator.bluetooth !== undefined;
  }

  // Get transport type available
  getAvailableTransport() {
    if (navigator.hid) return 'webhid';
    if (navigator.usb) return 'webusb';
    return null;
  }

  // Get all supported derivation schemes
  getDerivationSchemes() {
    return Object.values(DERIVATION_SCHEMES);
  }

  // Set the current derivation scheme
  setDerivationScheme(schemeId) {
    const scheme = Object.values(DERIVATION_SCHEMES).find(s => s.id === schemeId);
    if (scheme) {
      this.currentScheme = scheme;
      logger.log('Derivation scheme set to:', scheme.name);
    }
  }

  // Get current derivation scheme
  getCurrentScheme() {
    return this.currentScheme;
  }

  // Connect to Ledger device via USB or Bluetooth
  async connect(connectionType = CONNECTION_TYPES.USB) {
    if (!this.isSupported()) {
      throw new Error('WebUSB/WebHID not supported in this browser');
    }

    // If already connected with a transport, close it first
    if (this.transport) {
      logger.log('Transport already exists, closing it first...');
      try {
        await this.transport.close();
      } catch (e) {
        logger.warn('Error closing existing transport:', e);
      }
      this.transport = null;
      this.solanaApp = null;
    }

    this.state = LEDGER_STATES.CONNECTING;
    this.connectionType = connectionType;

    try {
      // Handle Bluetooth connection
      if (connectionType === CONNECTION_TYPES.BLUETOOTH) {
        logger.log('Using Bluetooth transport');
        
        if (!this.isBluetoothSupported()) {
          throw new Error('Bluetooth is not supported in this browser. Please use Chrome or Edge.');
        }
        
        const TransportModule = await import('@ledgerhq/hw-transport-web-ble');
        const Transport = TransportModule.default;
        
        try {
          logger.log('Requesting Bluetooth Ledger device...');
          this.transport = await Transport.create();
          logger.log('Bluetooth transport created successfully');
        } catch (e) {
          logger.error('Bluetooth connection failed:', e);
          logger.error('Error name:', e?.name);
          logger.error('Error message:', e?.message);
          logger.error('Error stack:', e?.stack);
          
          if (e.message?.includes('User cancelled') || e.name === 'TransportOpenUserCancelled') {
            throw new Error('Bluetooth pairing cancelled. Please try again.');
          }
          if (e.message?.includes('Bluetooth adapter not available')) {
            throw new Error('Bluetooth is not available. Please enable Bluetooth on your device.');
          }
          if (e.message?.includes('GATT')) {
            throw new Error('Bluetooth connection dropped. Please:\n• Keep tapping your Ledger to keep it awake\n• Move it closer to your computer\n• Try again');
          }
          throw new Error(`Bluetooth connection failed: ${e?.message || e?.name || 'Unknown error'}`);
        }
      } else {
        // Handle USB connection (WebHID or WebUSB)
        const transportType = this.getAvailableTransport();
        logger.log('Transport type available:', transportType);
        
        if (transportType === 'webhid') {
          logger.log('Using WebHID transport');
          
          // First check if we have any previously authorized devices
          let existingDevices = [];
          try {
            existingDevices = await navigator.hid.getDevices();
            logger.log('Existing authorized HID devices:', existingDevices.length);
            
            // Filter for Ledger devices (vendorId 0x2c97)
            const ledgerDevices = existingDevices.filter(d => d.vendorId === 0x2c97);
            logger.log('Ledger devices found:', ledgerDevices.length);
            
            // Log detailed info about each Ledger device to help debug Nano X issues
            for (const device of ledgerDevices) {
              console.log('[Hardware] Ledger device:', {
                productId: '0x' + device.productId.toString(16),
                productName: device.productName,
                collections: device.collections?.map(c => ({
                  usagePage: '0x' + c.usagePage.toString(16),
                  usage: '0x' + c.usage.toString(16)
                }))
              });
              
              // Check if this is a FIDO interface (usagePage 0xF1D0)
              const isFido = device.collections?.some(c => c.usagePage === 0xF1D0);
              if (isFido) {
                console.warn('[Hardware] ⚠️ This device is a FIDO interface - may not work for signing!');
              }
              
              // Check for main Ledger interface (usagePage 0xFFA0)
              const isMain = device.collections?.some(c => c.usagePage === 0xFFA0);
              if (isMain) {
                console.log('[Hardware] ✅ This device is the main Ledger interface');
              }
            }
          } catch (e) {
            logger.log('Could not enumerate existing devices:', e.message);
          }
          
          // Import and create transport
          try {
            const TransportModule = await import('@ledgerhq/hw-transport-webhid');
            const Transport = TransportModule.default;
            
            logger.log('Requesting Ledger device via WebHID...');
            console.log('[Hardware] About to call Transport.create() - device picker should appear');
            console.log('[Hardware] Note: For Nano X, make sure to select the main interface, not FIDO');
            
            // Add a timeout to detect if device picker never appears
            // This can happen on macOS due to focus/permission issues
            const transportPromise = Transport.create();
            const timeoutPromise = new Promise((_, reject) => {
              setTimeout(() => {
                reject(new Error('Device picker timeout. This can happen if:\n• Chrome blocked the popup (check for blocked popup icon)\n• The extension window lost focus\n• macOS requires additional permissions\n\nTry: Click this window, ensure it has focus, then click Connect again.'));
              }, 30000); // 30 second timeout
            });
            
            this.transport = await Promise.race([transportPromise, timeoutPromise]);
            console.log('[Hardware] Transport.create() returned successfully');
            
            // Log transport details to verify correct interface
            if (this.transport?.device) {
              const device = this.transport.device;
              console.log('[Hardware] Connected to device:', {
                productId: '0x' + device.productId?.toString(16),
                productName: device.productName,
                collections: device.collections?.map(c => ({
                  usagePage: '0x' + c.usagePage?.toString(16),
                  usage: '0x' + c.usage?.toString(16)
                }))
              });
              
              // Warn if connected to FIDO interface
              const isFido = device.collections?.some(c => c.usagePage === 0xF1D0);
              if (isFido) {
                console.error('[Hardware] ❌ Connected to FIDO interface! This will cause 0x6a81 errors.');
                console.error('[Hardware] Please disconnect and reconnect, selecting a different interface.');
              }
            }
            
            logger.log('Transport created successfully');
          } catch (e) {
            logger.error('WebHID transport creation failed:', e);
            console.error('[Hardware] WebHID error:', e?.name, e?.message);
            
            // Re-throw with better message
            if (e?.name === 'TransportOpenUserCancelled') {
              throw new Error('Device selection cancelled. Please try again and select your Ledger.');
            }
            if (e?.message?.includes('No device selected')) {
              throw new Error('No Ledger device selected. Please try again.');
            }
            if (e?.message?.includes('timeout') || e?.message?.includes('Device picker')) {
              throw e; // Already has a good message
            }
            if (e?.name === 'NotAllowedError') {
              throw new Error('Chrome blocked device access. Ensure this window has focus and try again.');
            }
            throw new Error(`WebHID connection failed: ${e?.message || e?.name || 'Unknown error'}`);
          }
        } else if (transportType === 'webusb') {
          logger.log('Using WebUSB transport');
          const TransportModule = await import('@ledgerhq/hw-transport-webusb');
          const Transport = TransportModule.default;
          this.transport = await Transport.create();
        } else {
          throw new Error('No compatible transport available (WebHID or WebUSB required)');
        }
      }
      
      this.deviceType = HW_TYPES.LEDGER;
      this.state = LEDGER_STATES.CONNECTED;
      
      logger.log('Ledger connected via', connectionType);
      return true;
    } catch (error) {
      this.state = LEDGER_STATES.ERROR;
      logger.error('Ledger connection error:', error);
      logger.error('Error name:', error.name);
      logger.error('Error message:', error.message);
      
      // Handle specific error types
      if (error.name === 'TransportOpenUserCancelled' || error.message?.includes('user cancelled')) {
        throw new Error('Connection cancelled. Please click Connect and select your Ledger device from the popup.');
      }
      if (error.message?.includes('No device selected')) {
        throw new Error('No Ledger device selected. Please try again and select your device.');
      }
      if (error.message?.includes('Access denied')) {
        throw new Error('Access denied. Please:\n• Make sure Ledger Live is closed\n• Unlock your Ledger device\n• Open the Solana app on the device\n• Try unplugging and replugging the USB');
      }
      if (error.message?.includes('Unable to claim interface')) {
        throw new Error('Another application is using your Ledger. Please close Ledger Live and any other wallet apps.');
      }
      if (error.message?.includes('NotFoundError') || error.message?.includes('no device')) {
        throw new Error('No Ledger device found. Please:\n• Connect your Ledger via USB\n• Unlock it with your PIN\n• Open the Solana app');
      }
      
      throw new Error(`Failed to connect: ${error.message || 'Unknown error'}`);
    }
  }

  // Open Solana/X1 app on Ledger
  async openApp() {
    logger.log('[Hardware] openApp called, transport exists:', !!this.transport);
    
    // If no transport, try to reconnect using existing authorized device
    if (!this.transport) {
      logger.log('[Hardware] No transport, attempting to reconnect...');
      try {
        const transportType = this.getAvailableTransport();
        if (transportType === 'webhid') {
          const TransportModule = await import('@ledgerhq/hw-transport-webhid');
          const Transport = TransportModule.default;
          
          // Try to open already connected device
          try {
            this.transport = await Transport.openConnected();
          } catch (e) {
            logger.log('[Hardware] openConnected failed:', e.message);
            this.transport = null;
          }
          
          if (!this.transport) {
            // Fall back to create (will prompt if needed)
            this.transport = await Transport.create();
          }
          logger.log('[Hardware] Reconnected via', transportType);
        } else {
          throw new Error('Ledger not connected. Please go back and connect again.');
        }
      } catch (e) {
        logger.error('[Hardware] Reconnection failed:', e);
        throw new Error('Ledger not connected. Please go back and connect again.');
      }
    }

    try {
      const SolanaModule = await import('@ledgerhq/hw-app-solana');
      const Solana = SolanaModule.default;
      this.solanaApp = new Solana(this.transport);
      
      // Try to get config to verify app is open
      const config = await this.solanaApp.getAppConfiguration();
      logger.log('Solana app version:', config.version);
      
      // Clear session invalid flag - we have a good connection now
      this.sessionInvalid = false;
      
      this.state = LEDGER_STATES.READY;
      return config;
    } catch (error) {
      this.state = LEDGER_STATES.APP_CLOSED;
      logger.error('Solana app error:', error);
      
      // Mark session as invalid on connection failure
      await this.invalidateSession('openApp failed: ' + error.message);
      
      if (error.statusCode === 0x6e00 || error.statusCode === 0x6d00) {
        throw new Error('Please open the Solana app on your Ledger device.');
      }
      if (error.statusCode === 0x6e01) {
        throw new Error('Ledger is locked. Please unlock it and try again.');
      }
      throw new Error('Could not connect to Solana app. Please make sure it is open on your Ledger.');
    }
  }

  // Get public key from Ledger
  async getPublicKey(path = null, display = false) {
    if (!this.solanaApp) {
      await this.openApp();
    }

    const derivePath = path || this.derivationPath;
    
    try {
      const result = await this.solanaApp.getAddress(derivePath, display);
      this.publicKey = result.address.toString('hex');
      
      // Convert to base58
      const publicKeyBase58 = this.bufferToBase58(result.address);
      return publicKeyBase58;
    } catch (error) {
      logger.error('Get public key error:', error);
      
      if (error.statusCode === 0x6985) {
        throw new Error('Transaction rejected by user');
      }
      throw error;
    }
  }

  // Get accounts for a specific derivation scheme
  async getAccountsForScheme(scheme, startIndex = 0, count = 5) {
    const accounts = [];
    
    for (let i = startIndex; i < startIndex + count; i++) {
      const path = scheme.getPath(i);
      try {
        const address = await this.getPublicKey(path, false);
        accounts.push({
          index: i,
          path,
          address,
          scheme: scheme.id,
          schemeName: scheme.name,
          label: `Account ${i + 1}`
        });
      } catch (e) {
        logger.warn(`Could not get account ${i} for scheme ${scheme.id}:`, e);
        break;
      }
    }
    
    return accounts;
  }

  // Get accounts from all schemes (for discovery)
  async discoverAccounts(count = 5) {
    const allAccounts = [];
    const seenAddresses = new Set();
    
    for (const scheme of Object.values(DERIVATION_SCHEMES)) {
      try {
        const accounts = await this.getAccountsForScheme(scheme, 0, count);
        for (const account of accounts) {
          // Avoid duplicates (same address from different paths)
          if (!seenAddresses.has(account.address)) {
            seenAddresses.add(account.address);
            allAccounts.push(account);
          }
        }
      } catch (e) {
        logger.warn(`Failed to get accounts for scheme ${scheme.id}:`, e);
      }
    }
    
    return allAccounts;
  }

  // Sign transaction with Ledger
  async signTransaction(transaction, path = null) {
    // Check if session is valid first
    this.ensureValidSession();
    
    if (!this.solanaApp) {
      await this.openApp();
    }
    
    // Preflight check - verify Solana app is still responsive
    await this.preflightCheck();

    const derivePath = path || this.derivationPath;
    
    try {
      // Transaction should be a Buffer or Uint8Array
      const txBuffer = Buffer.isBuffer(transaction) 
        ? transaction 
        : Buffer.from(transaction);
      
      const result = await this.solanaApp.signTransaction(derivePath, txBuffer);
      return result.signature;
    } catch (error) {
      logger.error('Sign transaction error:', error);
      
      if (error.statusCode === 0x6985) {
        throw new Error('Transaction rejected by user');
      }
      if (error.statusCode === 0x6a80) {
        throw new Error('Invalid transaction data');
      }
      
      // 0x6a81 = Function not supported - usually means blind signing is disabled
      if (error.statusCode === 27265 || error.statusCode === 0x6a81 || 
          error.message?.includes('0x6a81') || error.message?.includes('UNKNOWN_ERROR')) {
        await this.invalidateSession('signTransaction transport error: ' + error.message);
        throw new Error('Blind signing required. Please enable "Blind Sign" in your Ledger Solana app settings, then try again.');
      }
      
      // On other transport errors, invalidate session to force clean reconnection
      if (error.name === 'TransportStatusError') {
        await this.invalidateSession('signTransaction transport error: ' + error.message);
      }
      
      throw error;
    }
  }

  // Sign message with Ledger (off-chain)
  async signMessage(message, path = null) {
    // Check if session is valid first
    this.ensureValidSession();
    
    if (!this.solanaApp) {
      await this.openApp();
    }
    
    // Preflight check - verify Solana app is still responsive
    await this.preflightCheck();

    const derivePath = path || this.derivationPath;
    
    // Handle Buffer, Uint8Array, or string
    const msgBuffer = Buffer.isBuffer(message)
      ? message
      : message instanceof Uint8Array
        ? Buffer.from(message)
        : Buffer.from(message, 'utf8');
    
    try {
      const result = await this.solanaApp.signOffchainMessage(derivePath, msgBuffer);
      return result.signature;
    } catch (err) {
      // 0x6a81 = Function not supported - usually means blind signing is disabled
      if (err.statusCode === 27265 || err.statusCode === 0x6a81 || 
          err.message?.includes('0x6a81') || err.message?.includes('UNKNOWN_ERROR')) {
        await this.invalidateSession('signMessage transport error: ' + err.message);
        throw new Error('Blind signing required. Please enable "Blind Sign" in your Ledger Solana app settings, then try again.');
      }
      
      // On other transport errors, invalidate session to force clean reconnection
      if (err.name === 'TransportStatusError') {
        await this.invalidateSession('signMessage transport error: ' + err.message);
      }
      
      throw err;
    }
  }

  // Disconnect from Ledger
  async disconnect() {
    if (this.transport) {
      try {
        await this.transport.close();
      } catch (e) {
        logger.warn('Error closing transport:', e);
      }
    }
    
    this.transport = null;
    this.solanaApp = null;
    this.deviceType = null;
    this.connectionType = null;
    this.state = LEDGER_STATES.DISCONNECTED;
    this.publicKey = null;
  }

  // Get different derivation paths (legacy method for compatibility)
  getDerivationPaths() {
    return [
      { path: "44'/501'/0'/0'", label: "Default (m/44'/501'/0'/0')" },
      { path: "44'/501'/0'", label: "Legacy (m/44'/501'/0')" },
      { path: "44'/501'/1'/0'", label: "Account 2 (m/44'/501'/1'/0')" },
      { path: "44'/501'/2'/0'", label: "Account 3 (m/44'/501'/2'/0')" },
      { path: "44'/501'/3'/0'", label: "Account 4 (m/44'/501'/3'/0')" },
    ];
  }

  // Set derivation path
  setDerivationPath(path) {
    this.derivationPath = path;
  }

  // Helper: Buffer to Base58
  bufferToBase58(buffer) {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    
    let bytes = Array.from(buffer);
    let digits = [0];
    
    for (let i = 0; i < bytes.length; i++) {
      let carry = bytes[i];
      for (let j = 0; j < digits.length; j++) {
        carry += digits[j] << 8;
        digits[j] = carry % 58;
        carry = (carry / 58) | 0;
      }
      while (carry > 0) {
        digits.push(carry % 58);
        carry = (carry / 58) | 0;
      }
    }
    
    // Leading zeros
    for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
      digits.push(0);
    }
    
    return digits.reverse().map(d => ALPHABET[d]).join('');
  }

  // Get current state
  getState() {
    return this.state;
  }

  // Check if ready to sign
  isReady() {
    return this.state === LEDGER_STATES.READY;
  }
}

// Trezor Wallet Service
class TrezorWalletService {
  constructor() {
    this.trezorConnect = null;
    this.deviceType = HW_TYPES.TREZOR;
    this.state = LEDGER_STATES.DISCONNECTED;
    this.publicKey = null;
    this.derivationPath = "m/44'/501'/0'/0'";
    this.initialized = false;
  }

  // Initialize Trezor Connect
  async init() {
    if (this.initialized) return;
    
    try {
      logger.log('[Trezor] Starting initialization...');
      
      // Add timeout for import
      const importPromise = import('@trezor/connect-web');
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Trezor Connect import timeout')), 10000)
      );
      
      const TrezorConnect = await Promise.race([importPromise, timeoutPromise]);
      logger.log('[Trezor] Module imported');
      
      this.trezorConnect = TrezorConnect.default;
      
      // Check if already initialized
      if (this.trezorConnect.isInitialized && this.trezorConnect.isInitialized()) {
        logger.log('[Trezor] Already initialized');
        this.initialized = true;
        return;
      }
      
      logger.log('[Trezor] Calling init...');
      await this.trezorConnect.init({
        lazyLoad: true, // Let operations trigger the popup
        manifest: {
          email: 'support@x1.xyz',
          appUrl: typeof chrome !== 'undefined' && chrome.runtime?.id 
            ? `chrome-extension://${chrome.runtime.id}` 
            : window.location.origin
        },
        transports: ['BridgeTransport', 'WebUsbTransport'], // Try Bridge first, then WebUSB
        connectSrc: 'https://connect.trezor.io/9/',
        popup: true, // Use popup mode
        debug: isDev
      });
      
      this.initialized = true;
      logger.log('[Trezor] Connect initialized successfully');
    } catch (e) {
      // If already initialized, that's OK
      if (e.message?.includes('already initialized')) {
        this.initialized = true;
        logger.log('[Trezor] Was already initialized');
        return;
      }
      logger.error('[Trezor] Failed to initialize:', e);
      throw new Error('Failed to initialize Trezor: ' + e.message);
    }
  }

  // Check if supported
  isSupported() {
    return typeof navigator !== 'undefined' && navigator.usb !== undefined;
  }

  // Get derivation schemes (same as Ledger for Solana)
  getDerivationSchemes() {
    return Object.values(DERIVATION_SCHEMES);
  }

  // Connect to Trezor - just initialize, actual connection happens on first use
  async connect() {
    this.state = LEDGER_STATES.CONNECTING;
    
    try {
      await this.init();
      // Don't call getFeatures - it can hang. Let the first actual operation trigger the popup.
      this.state = LEDGER_STATES.CONNECTED;
      logger.log('Trezor Connect ready');
      return true;
    } catch (e) {
      this.state = LEDGER_STATES.ERROR;
      logger.error('Trezor initialization error:', e);
      throw e;
    }
  }

  // Open app (no-op for Trezor - Solana is built-in)
  async openApp() {
    await this.init();
    this.state = LEDGER_STATES.READY;
    return { version: 'native' };
  }

  // Get public key from Trezor
  async getPublicKey(path = null, display = false) {
    await this.init();
    
    const derivePath = path || this.derivationPath;
    // Convert path format: "44'/501'/0'" -> "m/44'/501'/0'"
    const fullPath = derivePath.startsWith('m/') ? derivePath : `m/${derivePath}`;
    
    try {
      const result = await this.trezorConnect.solanaGetPublicKey({
        path: fullPath,
        showOnTrezor: display
      });
      
      if (!result.success) {
        throw new Error(result.payload?.error || 'Failed to get public key');
      }
      
      this.publicKey = result.payload.publicKey;
      return result.payload.publicKey;
    } catch (e) {
      logger.error('Trezor getPublicKey error:', e);
      throw e;
    }
  }

  // Get accounts for a scheme
  async getAccountsForScheme(scheme, startIndex = 0, count = 5) {
    const accounts = [];
    
    for (let i = startIndex; i < startIndex + count; i++) {
      const path = scheme.getPath(i);
      try {
        const address = await this.getPublicKey(path, false);
        accounts.push({
          index: i,
          path,
          address,
          scheme: scheme.id,
          schemeName: scheme.name,
          label: `Account ${i + 1}`
        });
      } catch (e) {
        logger.warn(`Could not get Trezor account ${i}:`, e);
        break;
      }
    }
    
    return accounts;
  }

  // Discover accounts from all schemes
  async discoverAccounts(count = 5) {
    const allAccounts = [];
    const seenAddresses = new Set();
    
    for (const scheme of Object.values(DERIVATION_SCHEMES)) {
      try {
        const accounts = await this.getAccountsForScheme(scheme, 0, count);
        for (const account of accounts) {
          if (!seenAddresses.has(account.address)) {
            seenAddresses.add(account.address);
            allAccounts.push(account);
          }
        }
      } catch (e) {
        logger.warn(`Failed to get Trezor accounts for scheme ${scheme.id}:`, e);
      }
    }
    
    return allAccounts;
  }

  // Sign transaction with Trezor
  async signTransaction(transaction, path = null) {
    await this.init();
    
    const derivePath = path || this.derivationPath;
    const fullPath = derivePath.startsWith('m/') ? derivePath : `m/${derivePath}`;
    
    try {
      // Transaction should be a serialized transaction buffer
      const txBuffer = Buffer.isBuffer(transaction)
        ? transaction
        : Buffer.from(transaction);
      
      const result = await this.trezorConnect.solanaSignTransaction({
        path: fullPath,
        serializedTx: txBuffer.toString('hex')
      });
      
      if (!result.success) {
        if (result.payload?.code === 'Failure_ActionCancelled') {
          throw new Error('Transaction rejected by user');
        }
        throw new Error(result.payload?.error || 'Failed to sign transaction');
      }
      
      // Return signature as Buffer
      return Buffer.from(result.payload.signature, 'hex');
    } catch (e) {
      logger.error('Trezor signTransaction error:', e);
      throw e;
    }
  }

  // Sign message (off-chain) - Note: Trezor may have limited support
  async signMessage(message, path = null) {
    await this.init();
    
    // Trezor doesn't have native Solana message signing yet
    // This may need to use a workaround or may not be supported
    throw new Error('Message signing is not yet supported on Trezor for Solana');
  }

  // Disconnect
  async disconnect() {
    if (this.trezorConnect) {
      try {
        await this.trezorConnect.dispose();
      } catch (e) {
        logger.warn('Error disposing Trezor Connect:', e);
      }
    }
    this.initialized = false;
    this.state = LEDGER_STATES.DISCONNECTED;
    this.publicKey = null;
  }

  // Get derivation paths (legacy compatibility)
  getDerivationPaths() {
    return [
      { path: "44'/501'/0'/0'", label: "Default (m/44'/501'/0'/0')" },
      { path: "44'/501'/0'", label: "Legacy (m/44'/501'/0')" },
      { path: "44'/501'/1'/0'", label: "Account 2 (m/44'/501'/1'/0')" },
      { path: "44'/501'/2'/0'", label: "Account 3 (m/44'/501'/2'/0')" },
    ];
  }

  setDerivationPath(path) {
    this.derivationPath = path;
  }

  getState() {
    return this.state;
  }

  isReady() {
    return this.state === LEDGER_STATES.READY;
  }
}

// Export singleton instances
export const hardwareWallet = new HardwareWalletService();
export const trezorWallet = new TrezorWalletService();

// Factory function to get the right wallet service
export function getHardwareWallet(type) {
  if (type === HW_TYPES.TREZOR) {
    return trezorWallet;
  }
  return hardwareWallet;
}

export default hardwareWallet;