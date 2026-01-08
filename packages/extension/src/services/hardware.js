// Hardware Wallet Service - Ledger Integration
import { Buffer } from 'buffer';

// Production-safe logger (only logs in development)
const isDev = typeof process !== 'undefined' 
  ? process.env.NODE_ENV === 'development'
  : (typeof window !== 'undefined' && window.location?.hostname === 'localhost');

const logger = {
  log: (...args) => isDev && console.log('[Hardware]', ...args),
  warn: (...args) => isDev && console.warn('[Hardware]', ...args),
  error: (...args) => isDev && console.error('[Hardware]', ...args),
};

// Make Buffer available globally for Ledger libs
if (typeof window !== 'undefined') {
  window.Buffer = Buffer;
}

// Ledger device states
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
  TREZOR: 'trezor'  // Keep for compatibility, but not implemented
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
          } catch (e) {
            logger.log('Could not enumerate existing devices:', e.message);
          }
          
          // Import and create transport
          try {
            const TransportModule = await import('@ledgerhq/hw-transport-webhid');
            const Transport = TransportModule.default;
            
            logger.log('Requesting Ledger device via WebHID...');
            this.transport = await Transport.create();
            logger.log('Transport created successfully');
          } catch (e) {
            logger.error('WebHID transport creation failed:', e);
            logger.error('Error name:', e?.name);
            logger.error('Error message:', e?.message);
            logger.error('Error statusCode:', e?.statusCode);
            
            // Re-throw with better message
            if (e?.name === 'TransportOpenUserCancelled') {
              throw new Error('Device selection cancelled. Please try again and select your Ledger.');
            }
            if (e?.message?.includes('No device selected')) {
              throw new Error('No Ledger device selected. Please try again.');
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
      
      this.state = LEDGER_STATES.READY;
      return config;
    } catch (error) {
      this.state = LEDGER_STATES.APP_CLOSED;
      logger.error('Solana app error:', error);
      
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
    if (!this.solanaApp) {
      await this.openApp();
    }

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
      throw error;
    }
  }

  // Sign message with Ledger (off-chain)
  async signMessage(message, path = null) {
    if (!this.solanaApp) {
      await this.openApp();
    }

    const derivePath = path || this.derivationPath;
    
    try {
      const msgBuffer = Buffer.isBuffer(message)
        ? message
        : Buffer.from(message, 'utf8');
      
      const result = await this.solanaApp.signOffchainMessage(derivePath, msgBuffer);
      return result.signature;
    } catch (error) {
      logger.error('Sign message error:', error);
      
      // Handle Ledger v1.4+ off-chain message signing restrictions
      if (error.statusCode === 0x6a81) {
        throw new Error(
          'Ledger cannot sign this message. The updated Ledger Solana app (v1.4+) has stricter requirements for off-chain message signing. ' +
          'This dApp may not be compatible with Ledger hardware wallets. Try using a software wallet instead.'
        );
      }
      
      throw error;
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

// Export singleton instance
export const hardwareWallet = new HardwareWalletService();

// Trezor placeholder (not implemented in this version)
export const trezorWallet = null;

// Factory function for compatibility
export function getHardwareWallet(type) {
  // Only Ledger is supported in this version
  return hardwareWallet;
}

export default hardwareWallet;