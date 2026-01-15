/**
 * X1 Wallet Provider
 * Solana-compatible wallet provider for dApp connections
 * Implements Wallet Standard for proper detection by wallet adapters
 */

(function () {
  "use strict";

  // X1W-NEW-003 FIX: Secure context check - don't inject on insecure HTTP pages
  // This prevents potential MITM attacks on non-HTTPS pages
  if (!window.isSecureContext && 
      !location.hostname.includes('localhost') && 
      !location.hostname.includes('127.0.0.1')) {
    console.warn("[X1 Wallet] Provider not injected - insecure context detected. Use HTTPS.");
    return;
  }

  // Prevent double injection
  if (window.x1Wallet && window.x1Wallet._initialized) {
    console.log("[X1 Wallet] Provider already injected");
    return;
  }

  // Base58 alphabet for encoding/decoding
  const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

  // Decode base58 string to Uint8Array
  // For Solana public keys, this should produce exactly 32 bytes
  function decodeBase58(str) {
    if (!str || typeof str !== 'string') {
      throw new Error('Invalid base58 input');
    }
    
    // Count leading '1's (they represent leading zero bytes)
    let leadingZeros = 0;
    for (let i = 0; i < str.length && str[i] === "1"; i++) {
      leadingZeros++;
    }
    
    // Convert base58 to big integer
    let num = BigInt(0);
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      const index = BASE58_ALPHABET.indexOf(char);
      if (index === -1) throw new Error(`Invalid base58 character: ${char}`);
      num = num * BigInt(58) + BigInt(index);
    }
    
    // Convert big integer to bytes
    const bytes = [];
    while (num > BigInt(0)) {
      bytes.unshift(Number(num % BigInt(256)));
      num = num / BigInt(256);
    }
    
    // Add leading zeros
    for (let i = 0; i < leadingZeros; i++) {
      bytes.unshift(0);
    }
    
    return new Uint8Array(bytes);
  }

  // Encode Uint8Array to base58 string
  function encodeBase58(bytes) {
    const digits = [0];
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
    let str = "";
    for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
      str += "1";
    }
    for (let i = digits.length - 1; i >= 0; i--) {
      str += BASE58_ALPHABET[digits[i]];
    }
    return str;
  }

  // PublicKey class - mimics @solana/web3.js PublicKey
  class PublicKey {
    constructor(value) {
      if (typeof value === "string") {
        this._key = decodeBase58(value);
        this._base58 = value;
      } else if (value instanceof Uint8Array) {
        this._key = value;
        this._base58 = encodeBase58(value);
      } else if (value instanceof PublicKey) {
        this._key = value._key;
        this._base58 = value._base58;
      } else if (value && value._key) {
        this._key = value._key;
        this._base58 = value._base58 || encodeBase58(value._key);
      } else {
        throw new Error("Invalid public key input");
      }
    }

    toBase58() {
      return this._base58;
    }

    toString() {
      return this._base58;
    }

    toBytes() {
      return this._key;
    }

    toBuffer() {
      return this._key;
    }

    equals(other) {
      if (!other) return false;
      const otherKey = other instanceof PublicKey ? other : new PublicKey(other);
      return this._base58 === otherKey._base58;
    }

    toJSON() {
      return this._base58;
    }
  }

  // Event emitter for wallet events
  class EventEmitter {
    constructor() {
      this._events = {};
    }

    on(event, callback) {
      if (!this._events[event]) this._events[event] = [];
      this._events[event].push(callback);
      return () => this.off(event, callback);
    }

    off(event, callback) {
      if (!this._events[event]) return;
      this._events[event] = this._events[event].filter((cb) => cb !== callback);
    }

    emit(event, ...args) {
      if (!this._events[event]) return;
      this._events[event].forEach((cb) => {
        try {
          cb(...args);
        } catch (e) {
          console.error("[X1 Wallet] Event handler error:", e);
        }
      });
    }

    addListener(event, callback) {
      return this.on(event, callback);
    }

    removeListener(event, callback) {
      return this.off(event, callback);
    }

    removeAllListeners(event) {
      if (event) {
        delete this._events[event];
      } else {
        this._events = {};
      }
    }
  }

  // Request ID counter for message correlation
  let requestId = 0;
  const pendingRequests = new Map();

  // X1 Wallet icon as data URI
  const X1_WALLET_ICON = "https://x1logos.s3.us-east-1.amazonaws.com/128+-+wallet.png";

  // X1 Wallet Provider Class
  class X1WalletProvider extends EventEmitter {
    constructor() {
      super();

      // Identity flags
      this.isX1Wallet = true;
      this.isPhantom = false;
      this.isSolana = true;
      
      // State
      this._connected = false;
      this._publicKey = null;
      this._initialized = true;
      this._chain = "x1:mainnet"; // Default chain - will be updated from storage
      this._network = "X1 Mainnet"; // Human readable - will be updated from storage
      this._connectionCheckPromise = null; // Promise for initial connection check
      
      // Listen for messages from content script - MUST be set up before any requests
      window.addEventListener("message", this._handleMessage.bind(this));

      console.log("[X1 Wallet] Provider initialized");
      
      // Load saved network from storage (async)
      this._loadSavedNetwork();
      
      // Check if already connected (restore connection on page refresh)
      // Store the promise so connect() can wait for it
      this._connectionCheckPromise = this._checkExistingConnection();
    }
    
    // Check if site is already connected and restore state
    async _checkExistingConnection() {
      try {
        console.log("[X1 Wallet] Checking existing connection...");
        const result = await this._sendRequest("getConnectionStatus", {});
        console.log("[X1 Wallet] getConnectionStatus result:", JSON.stringify(result));
        
        if (result && result.connected && result.publicKey) {
          this._connected = true;
          this._publicKey = new PublicKey(result.publicKey);
          
          if (result.chain) {
            this._chain = result.chain;
          }
          if (result.network) {
            this._network = result.network;
          }
          
          console.log("[X1 Wallet] Restored connection:", this._publicKey.toBase58());
          
          // Emit connect event so dApps know we're connected
          // Use setTimeout to ensure event listeners are set up by the dApp
          setTimeout(() => {
            console.log("[X1 Wallet] Emitting connect event for restored connection");
            this.emit("connect", this._publicKey);
            
            // Also emit accountChanged in case dApps listen for that
            this.emit("accountChanged", this._publicKey);
          }, 50);
          
          // Emit again after a longer delay for slower dApps
          setTimeout(() => {
            if (this._connected && this._publicKey) {
              console.log("[X1 Wallet] Re-emitting connect event (delayed)");
              this.emit("connect", this._publicKey);
            }
          }, 500);
          
          return true;
        } else {
          console.log("[X1 Wallet] No existing connection found");
          return false;
        }
      } catch (e) {
        // Ignore errors - site not connected
        console.log("[X1 Wallet] Error checking connection:", e.message);
        return false;
      }
    }
    
    // Load saved network from storage
    async _loadSavedNetwork() {
      try {
        // Request saved network from background script
        const result = await this._sendRequest("getNetwork", {});
        if (result && result.chain) {
          this._chain = result.chain;
          this._network = result.network || this._chainToNetwork(result.chain);
          console.log("[X1 Wallet] Loaded saved network:", this._chain, this._network);
        }
      } catch (e) {
        // Ignore errors - will use defaults
        console.log("[X1 Wallet] Could not load saved network, using defaults");
      }
    }
    
    // Helper to convert chain to network name
    _chainToNetwork(chain) {
      const map = {
        'x1:mainnet': 'X1 Mainnet',
        'x1:testnet': 'X1 Testnet',
        'solana:mainnet': 'Solana Mainnet',
        'solana:devnet': 'Solana Devnet',
        'solana:testnet': 'Solana Testnet'
      };
      return map[chain] || 'X1 Mainnet';
    }

    // Getters
    get isConnected() {
      return this._connected;
    }

    get publicKey() {
      return this._publicKey;
    }

    get connected() {
      return this._connected;
    }

    get chain() {
      return this._chain;
    }

    get network() {
      return this._network;
    }

    // Handle messages from content script
    _handleMessage(event) {
      if (event.source !== window) return;
      if (!event.data || event.data.target !== "x1-wallet-provider") return;

      const { type, payload, id } = event.data;

      console.log("[X1 Wallet] Message:", type, id ? `id:${id}` : "");

      // Handle responses to pending requests
      if (id && pendingRequests.has(id)) {
        const { resolve, reject, timeout } = pendingRequests.get(id);
        pendingRequests.delete(id);
        if (timeout) clearTimeout(timeout);

        if (payload && payload.error) {
          console.error("[X1 Wallet] Error:", payload.error);
          reject(new Error(payload.error));
        } else if (payload && payload.result !== undefined) {
          console.log("[X1 Wallet] Success:", JSON.stringify(payload.result).slice(0, 80));
          resolve(payload.result);
        } else {
          resolve(payload);
        }
        return;
      }

      // Handle push events from wallet
      switch (type) {
        case "connect":
          this._connected = true;
          if (payload && payload.publicKey) {
            this._publicKey = new PublicKey(payload.publicKey);
          }
          this.emit("connect", this._publicKey);
          break;

        case "disconnect":
          this._connected = false;
          this._publicKey = null;
          this.emit("disconnect");
          break;

        case "accountChanged":
          console.log("[X1 Wallet] Received accountChanged message:", payload);
          if (payload && payload.publicKey) {
            this._publicKey = new PublicKey(payload.publicKey);
            console.log("[X1 Wallet] Updated publicKey, emitting accountChanged");
            this.emit("accountChanged", this._publicKey);
          }
          break;

        case "networkChanged":
        case "chainChanged":
        case "network-changed":
          if (payload) {
            const oldChain = this._chain;
            if (payload.chain) this._chain = payload.chain;
            if (payload.network) this._network = payload.network;
            
            console.log("[X1 Wallet] Network changed:", oldChain, "->", this._chain);
            
            // Emit events for dApps to listen to
            this.emit("networkChanged", { chain: this._chain, network: this._network });
            this.emit("chainChanged", this._chain);
            
            // Some dApps expect accountsChanged when network changes
            // because the account might be different on different networks
            if (this._publicKey) {
              this.emit("accountChanged", this._publicKey);
            }
          }
          break;
      }
    }

    // Send request to content script
    _sendRequest(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++requestId;
        
        console.log("[X1 Wallet] Request:", method, "id:", id);

        const timeout = setTimeout(() => {
          if (pendingRequests.has(id)) {
            pendingRequests.delete(id);
            reject(new Error("Request timeout"));
          }
        }, 120000);

        pendingRequests.set(id, { resolve, reject, timeout });

        window.postMessage({
          target: "x1-wallet-content",
          type: "request",
          method,
          params,
          id,
        }, "*");
      });
    }

    /**
     * Connect to the wallet
     * @param {Object} options - Connection options
     * @param {string} options.chain - Chain identifier (e.g., "x1:mainnet", "x1:testnet", "solana:mainnet")
     * @param {boolean} options.onlyIfTrusted - Only connect if already trusted
     */
    async connect(options = {}) {
      console.log("[X1 Wallet] connect() called with options:", JSON.stringify(options));
      
      // If this is a silent/auto connect, wait for our connection check to complete first
      // This prevents race conditions where autoConnect fires before we've checked storage
      if (options.onlyIfTrusted && this._connectionCheckPromise) {
        console.log("[X1 Wallet] Waiting for connection check to complete...");
        try {
          await this._connectionCheckPromise;
        } catch (e) {
          // Ignore errors
        }
      }
      
      // If we're already connected and have a public key, return immediately
      if (this._connected && this._publicKey) {
        console.log("[X1 Wallet] Already connected, returning existing connection");
        return { publicKey: this._publicKey, chain: this._chain };
      }
      
      try {
        // Pass chain info to the wallet
        const connectParams = { ...options };
        
        // Normalize chain identifier if provided
        if (options.chain) {
          connectParams.chain = options.chain;
          console.log("[X1 Wallet] Requesting chain:", options.chain);
        }
        
        console.log("[X1 Wallet] Sending connect request to background...");
        const result = await this._sendRequest("connect", connectParams);
        console.log("[X1 Wallet] Connect result:", JSON.stringify(result));
        
        if (result && result.publicKey) {
          this._connected = true;
          this._publicKey = new PublicKey(result.publicKey);
          
          // Track if chain changed during connect
          const previousChain = this._chain;
          
          // Update chain/network if returned from wallet
          if (result.chain) {
            this._chain = result.chain;
          }
          if (result.network) {
            this._network = result.network;
          }
          
          // Emit connect event
          this.emit("connect", this._publicKey);
          
          // If chain changed during connect, emit chainChanged event
          // This is important for dApps that listen for chain changes
          if (result.chain && result.chain !== previousChain) {
            console.log("[X1 Wallet] Chain changed during connect:", previousChain, "->", this._chain);
            this.emit("chainChanged", this._chain);
            this.emit("networkChanged", { chain: this._chain, network: this._network });
          }
          
          console.log("[X1 Wallet] Connected:", this._publicKey.toBase58(), "on chain:", this._chain);
          return { publicKey: this._publicKey, chain: this._chain };
        }
        throw new Error("No public key returned");
      } catch (error) {
        console.error("[X1 Wallet] Connect failed:", error);
        this.emit("error", error);
        throw error;
      }
    }

    /**
     * Switch to a different chain/network
     * @param {string} chain - Chain identifier (e.g., "x1:mainnet", "x1:testnet")
     */
    async switchChain(chain) {
      console.log("[X1 Wallet] switchChain():", chain);
      
      const result = await this._sendRequest("switchChain", { chain });
      
      if (result) {
        if (result.chain) this._chain = result.chain;
        if (result.network) this._network = result.network;
        this.emit("networkChanged", { chain: this._chain, network: this._network });
        this.emit("chainChanged", this._chain);
        return { chain: this._chain, network: this._network };
      }
      throw new Error("Failed to switch chain");
    }

    /**
     * Get current network info
     */
    async getNetwork() {
      console.log("[X1 Wallet] getNetwork()");
      
      const result = await this._sendRequest("getNetwork", {});
      
      if (result) {
        if (result.chain) this._chain = result.chain;
        if (result.network) this._network = result.network;
        return { chain: this._chain, network: this._network };
      }
      return { chain: this._chain, network: this._network };
    }

    /**
     * Disconnect
     */
    async disconnect() {
      console.log("[X1 Wallet] disconnect()");
      try {
        await this._sendRequest("disconnect");
      } catch (e) {}
      this._connected = false;
      this._publicKey = null;
      this.emit("disconnect");
    }

    /**
     * Sign a transaction
     */
    async signTransaction(transaction) {
      console.log("[X1 Wallet] signTransaction()");
      
      if (!this._connected) {
        throw new Error("Wallet not connected");
      }

      let txBase64;
      if (typeof transaction === "string") {
        txBase64 = transaction;
      } else if (transaction.serialize) {
        const serialized = transaction.serialize({ 
          requireAllSignatures: false,
          verifySignatures: false 
        });
        txBase64 = btoa(String.fromCharCode(...new Uint8Array(serialized)));
      } else if (transaction instanceof Uint8Array) {
        txBase64 = btoa(String.fromCharCode(...transaction));
      } else {
        throw new Error("Invalid transaction format");
      }

      const result = await this._sendRequest("signTransaction", { transaction: txBase64 });

      if (result && result.signedTransaction) {
        const signedBytes = Uint8Array.from(atob(result.signedTransaction), c => c.charCodeAt(0));
        return {
          serialize: () => signedBytes,
          _signedBytes: signedBytes,
        };
      }
      throw new Error("No signed transaction returned");
    }

    /**
     * Sign multiple transactions
     */
    async signAllTransactions(transactions) {
      console.log("[X1 Wallet] signAllTransactions()");
      
      if (!this._connected) {
        throw new Error("Wallet not connected");
      }

      const txsBase64 = transactions.map((tx) => {
        if (typeof tx === "string") return tx;
        if (tx.serialize) {
          const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
          return btoa(String.fromCharCode(...new Uint8Array(serialized)));
        }
        if (tx instanceof Uint8Array) return btoa(String.fromCharCode(...tx));
        throw new Error("Invalid transaction format");
      });

      const result = await this._sendRequest("signAllTransactions", { transactions: txsBase64 });

      if (result && result.signedTransactions) {
        return result.signedTransactions.map(signedTx => {
          const signedBytes = Uint8Array.from(atob(signedTx), c => c.charCodeAt(0));
          return { serialize: () => signedBytes, _signedBytes: signedBytes };
        });
      }
      throw new Error("No signed transactions returned");
    }

    /**
     * Sign and send transaction
     */
    async signAndSendTransaction(transaction, options = {}) {
      console.log("[X1 Wallet] signAndSendTransaction()");
      
      if (!this._connected) {
        throw new Error("Wallet not connected");
      }

      let txBase64;
      if (typeof transaction === "string") {
        txBase64 = transaction;
      } else if (transaction.serialize) {
        const serialized = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
        txBase64 = btoa(String.fromCharCode(...new Uint8Array(serialized)));
      } else if (transaction instanceof Uint8Array) {
        txBase64 = btoa(String.fromCharCode(...transaction));
      } else {
        throw new Error("Invalid transaction format");
      }

      const result = await this._sendRequest("signAndSendTransaction", { transaction: txBase64, options });

      if (result && result.signature) {
        return { signature: result.signature };
      }
      throw new Error("No signature returned");
    }

    /**
     * Sign message
     */
    async signMessage(message, display = "utf8") {
      console.log("[X1 Wallet] signMessage()");
      
      if (!this._connected) {
        throw new Error("Wallet not connected");
      }

      let messageBase64;
      if (typeof message === "string") {
        messageBase64 = btoa(unescape(encodeURIComponent(message)));
      } else if (message instanceof Uint8Array) {
        messageBase64 = btoa(String.fromCharCode(...message));
      } else {
        throw new Error("Invalid message format");
      }

      const result = await this._sendRequest("signMessage", { message: messageBase64, display });

      if (result && result.signature) {
        const signatureBytes = Uint8Array.from(atob(result.signature), c => c.charCodeAt(0));
        return { signature: signatureBytes };
      }
      throw new Error("No signature returned");
    }
  }

  // Create the provider instance
  const provider = new X1WalletProvider();

  // ===== WALLET STANDARD REGISTRATION =====
  // This is crucial for wallet adapters to detect X1 Wallet
  
  // Create a WalletAccount-compliant object
  // CRITICAL: Wallet Standard requires publicKey to be exactly 32 bytes
  function createWalletAccount(publicKey, chain = null) {
    if (!publicKey) {
      console.error("[X1 Wallet] createWalletAccount: publicKey is null/undefined");
      return null;
    }
    
    const address = publicKey.toBase58();
    let pubkeyBytes = publicKey.toBytes();
    
    // Ensure exactly 32 bytes for Solana public keys
    // The base58 decoding might not produce exactly 32 bytes
    if (pubkeyBytes.length !== 32) {
      console.warn("[X1 Wallet] PublicKey bytes length:", pubkeyBytes.length, "- padding/trimming to 32");
      const normalized = new Uint8Array(32);
      if (pubkeyBytes.length < 32) {
        // Pad with leading zeros (Solana uses big-endian format)
        normalized.set(pubkeyBytes, 32 - pubkeyBytes.length);
      } else {
        // Take last 32 bytes if too long
        normalized.set(pubkeyBytes.slice(pubkeyBytes.length - 32));
      }
      pubkeyBytes = normalized;
    }
    
    // Determine which chains this account is valid for
    const currentChain = chain || provider._chain || "x1:mainnet";
    
    // IMPORTANT: Always include ALL supported chains for maximum compatibility
    // The Wallet Standard adapter checks if the account supports the requested chain
    // If we only include X1 chains, Solana dApps will reject the account
    // Since X1 is compatible with Solana, we expose all chains
    const accountChains = SUPPORTED_CHAINS;
    
    const account = {
      address: address,
      publicKey: pubkeyBytes,
      chains: accountChains,
      features: ["solana:signTransaction", "solana:signMessage", "solana:signAndSendTransaction"]
    };
    
    return account;
  }

  // All supported chains
  const SUPPORTED_CHAINS = [
    "x1:mainnet",
    "x1:testnet", 
    "solana:mainnet",
    "solana:mainnet-beta",  // Some dApps use this format
    "solana:devnet",
    "solana:testnet"
  ];

  // Track connected accounts
  let connectedAccounts = [];

  // Features implementation object
  const featuresImpl = {
    "standard:connect": {
        version: "1.0.0",
        connect: async (input) => {
          try {
            const options = {};
            
            // Check if there's a requested chain in the input
            if (input && input.chain) {
              options.chain = input.chain;
            }
            if (input && input.silent) {
              options.onlyIfTrusted = true;
            }
            
            const result = await provider.connect(options);
            
            if (result && result.publicKey) {
              const account = createWalletAccount(result.publicKey, provider._chain);
              
              if (account) {
                connectedAccounts = [account];
                return { accounts: connectedAccounts };
              } else {
                throw new Error("Failed to create wallet account");
              }
            }
            throw new Error("No public key returned from connect");
          } catch (error) {
            connectedAccounts = [];
            
            // For silent connect failures, return empty accounts instead of throwing
            if (input && input.silent) {
              return { accounts: [] };
            }
            
            throw error;
          }
        }
      },
      "standard:disconnect": {
        version: "1.0.0",
        disconnect: async () => {
          await provider.disconnect();
          connectedAccounts = [];
        }
      },
      "standard:events": {
        version: "1.0.0",
        on: (event, listener) => {
          if (event === "change") {
            // Map provider events to wallet standard change event
            const handleConnect = () => {
              if (provider._publicKey) {
                const account = createWalletAccount(provider._publicKey, provider._chain);
                if (account) {
                  connectedAccounts = [account];
                }
              }
              listener({ accounts: connectedAccounts });
            };
            const handleDisconnect = () => {
              connectedAccounts = [];
              listener({ accounts: [] });
            };
            const handleAccountChanged = () => {
              if (provider._publicKey) {
                const account = createWalletAccount(provider._publicKey, provider._chain);
                if (account) {
                  connectedAccounts = [account];
                }
              } else {
                connectedAccounts = [];
              }
              listener({ accounts: connectedAccounts });
            };
            const handleChainChanged = () => {
              // When chain changes, rebuild accounts with new chain
              if (provider._publicKey) {
                const account = createWalletAccount(provider._publicKey, provider._chain);
                if (account) {
                  connectedAccounts = [account];
                }
              }
              listener({ accounts: connectedAccounts });
            };
            provider.on("connect", handleConnect);
            provider.on("disconnect", handleDisconnect);
            provider.on("accountChanged", handleAccountChanged);
            provider.on("chainChanged", handleChainChanged);
            provider.on("networkChanged", handleChainChanged);
            return () => {
              provider.off("connect", handleConnect);
              provider.off("disconnect", handleDisconnect);
              provider.off("accountChanged", handleAccountChanged);
              provider.off("chainChanged", handleChainChanged);
              provider.off("networkChanged", handleChainChanged);
            };
          }
          provider.on(event, listener);
          return () => provider.off(event, listener);
        }
      },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: new Set(["legacy", 0]),
        signTransaction: async (...inputs) => {
          const results = [];
          for (const input of inputs) {
            const { transaction } = input;
            // transaction is a Uint8Array from the Wallet Standard
            const result = await provider.signTransaction(transaction);
            // Wallet Standard expects { signedTransaction: Uint8Array }
            const signedBytes = result._signedBytes || result.serialize();
            results.push({ signedTransaction: signedBytes });
          }
          return results;
        }
      },
      "solana:signAndSendTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: new Set(["legacy", 0]),
        signAndSendTransaction: async (...inputs) => {
          // Handle both array and single input formats
          const inputArray = Array.isArray(inputs[0]) ? inputs[0] : inputs;
          
          const results = [];
          for (let i = 0; i < inputArray.length; i++) {
            const input = inputArray[i];
            const { transaction, account, chain, options } = input || {};
            
            const result = await provider.signAndSendTransaction(transaction, options);
            
            // Return signature as Uint8Array as per spec
            // Solana signatures are base58-encoded strings, 64 bytes when decoded
            let signatureBytes;
            if (typeof result.signature === 'string') {
              // Signature is base58 encoded - decode it
              signatureBytes = decodeBase58(result.signature);
            } else if (result.signature instanceof Uint8Array) {
              signatureBytes = result.signature;
            } else {
              // Try to convert from array-like
              signatureBytes = new Uint8Array(result.signature);
            }
            
            results.push({ signature: signatureBytes });
          }
          return results;
        }
      },
      "solana:signMessage": {
        version: "1.0.0",
        signMessage: async (...inputs) => {
          const results = [];
          for (const input of inputs) {
            const { message } = input;
            const result = await provider.signMessage(message);
            results.push(result);
          }
          return results;
        }
      }
  };

  // Wallet Standard wallet object
  const x1StandardWallet = {
    // Identity
    name: "X1 Wallet",
    icon: X1_WALLET_ICON,
    
    // Version
    version: "1.0.0",
    
    // Chains supported - IMPORTANT: Include X1 chains!
    chains: SUPPORTED_CHAINS,
    
    // Accounts getter - returns current connected accounts
    get accounts() {
      if (provider._connected && provider._publicKey && connectedAccounts.length === 0) {
        const account = createWalletAccount(provider._publicKey, provider._chain);
        if (account) {
          connectedAccounts = [account];
        }
      } else if (!provider._connected) {
        connectedAccounts = [];
      }
      return connectedAccounts;
    },
    
    // Features
    features: featuresImpl
  };

  // Register with Wallet Standard using the official pattern from @wallet-standard/wallet
  function registerWalletStandard() {
    if (typeof window === "undefined") return;

    // Official Wallet Standard registration pattern
    const callback = ({ register }) => {
      return register(x1StandardWallet);
    };

    // Method 1: Dispatch register-wallet event (for apps that are already listening)
    try {
      window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", {
        detail: callback,
        bubbles: false,
        cancelable: false,
      }));
    } catch (error) {
      // Silently handle error
    }

    // Method 2: Listen for app-ready event (for apps that load after us)
    try {
      window.addEventListener("wallet-standard:app-ready", (event) => {
        callback(event.detail);
      });
    } catch (error) {
      // Silently handle error
    }

    // Method 3: Legacy pattern using navigator.wallets array (deprecated but still used)
    try {
      ((window.navigator.wallets ||= [])).push(callback);
    } catch (error) {
      // Silently handle error
    }
  }

  // ===== EXPOSE PROVIDER =====
  
  // Primary: window.x1Wallet
  window.x1Wallet = provider;
  window.x1 = provider;

  // Also set window.solana if not taken (for legacy dApps)
  if (!window.solana) {
    window.solana = provider;
    console.log("[X1 Wallet] Set as window.solana");
  } else {
    console.log("[X1 Wallet] window.solana exists (likely Phantom)");
  }

  // Register with wallet standard
  registerWalletStandard();

  // Dispatch ready events
  window.dispatchEvent(new Event("x1Wallet#initialized"));
  
  // For legacy Solana wallet detection
  queueMicrotask(() => {
    window.dispatchEvent(new Event("solana#initialized"));
  });

  console.log("[X1 Wallet] Provider ready");
})();