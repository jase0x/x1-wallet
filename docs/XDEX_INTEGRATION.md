# X1 Wallet - XDEX Integration Guide

## Overview
X1 Wallet is a browser extension wallet for the X1 blockchain. This document provides all the information needed to integrate X1 Wallet as a wallet option in XDEX.

---

## Wallet Metadata

```javascript
{
  name: "X1 Wallet",
  icon: "https://x1.xyz/wallet/icon.png",  // Replace with actual URL
  url: "https://x1.xyz/wallet",
  rdns: "xyz.x1.wallet",
  description: "X1 Blockchain Wallet - Designed for the Chains That Win"
}
```

---

## Provider Detection

The wallet injects a provider at `window.x1Wallet`. To detect if X1 Wallet is installed:

```javascript
// Check if X1 Wallet is installed
const isX1WalletInstalled = () => {
  return typeof window.x1Wallet !== 'undefined' && window.x1Wallet.isX1Wallet;
};

// Or listen for the initialization event
window.addEventListener('x1Wallet#initialized', () => {
  console.log('X1 Wallet is ready');
});
```

---

## Provider Interface

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `isX1Wallet` | `boolean` | Always `true` - identifies the provider |
| `isConnected` | `boolean` | Whether a wallet is currently connected |
| `publicKey` | `string \| null` | Connected wallet's public key (base58) |
| `network` | `string \| null` | Current network (e.g., "X1 Testnet", "X1 Mainnet") |

### Methods

#### `connect()`
Connects to the wallet. Opens approval popup if not already connected.

```javascript
const { publicKey } = await window.x1Wallet.connect();
console.log('Connected:', publicKey);
// Returns: { publicKey: "6VwaLcGjRxAZaaF26Wvjr4aiJPQd84qUY4i62rCN2eX3" }
```

#### `disconnect()`
Disconnects the current session.

```javascript
await window.x1Wallet.disconnect();
```

#### `signTransaction(transaction)`
Signs a single transaction. Returns the signed transaction.

```javascript
// transaction can be:
// - Base64 encoded string
// - Uint8Array
// - Object with serialize() method (Solana Web3.js Transaction)

const signedTx = await window.x1Wallet.signTransaction(transaction);
```

#### `signAllTransactions(transactions)`
Signs multiple transactions at once.

```javascript
const signedTxs = await window.x1Wallet.signAllTransactions([tx1, tx2, tx3]);
```

#### `signAndSendTransaction(transaction, options?)`
Signs and submits a transaction to the network.

```javascript
const signature = await window.x1Wallet.signAndSendTransaction(transaction, {
  skipPreflight: false,
  preflightCommitment: 'confirmed'
});
console.log('Transaction signature:', signature);
```

#### `signMessage(message)`
Signs an arbitrary message (for authentication, etc.).

```javascript
// message can be string or Uint8Array
const { signature } = await window.x1Wallet.signMessage("Hello, X1!");
// signature is Uint8Array
```

#### `getNetwork()`
Returns the current network.

```javascript
const { network } = await window.x1Wallet.getNetwork();
// "X1 Testnet" or "X1 Mainnet" or "Solana Mainnet" etc.
```

---

## Events

The provider emits events for state changes:

```javascript
// Connection established
window.x1Wallet.on('connect', ({ publicKey }) => {
  console.log('Connected:', publicKey);
});

// Disconnected
window.x1Wallet.on('disconnect', () => {
  console.log('Disconnected');
});

// Account changed (user switched wallets)
window.x1Wallet.on('accountChanged', ({ publicKey }) => {
  console.log('Account changed to:', publicKey);
});

// Network changed
window.x1Wallet.on('networkChanged', ({ network }) => {
  console.log('Network changed to:', network);
});
```

---

## Integration Example

```javascript
// Full integration example for XDEX

class X1WalletAdapter {
  constructor() {
    this.name = 'X1 Wallet';
    this.icon = 'https://x1.xyz/wallet/icon.png';
    this.url = 'https://x1.xyz/wallet';
  }

  get installed() {
    return typeof window.x1Wallet !== 'undefined' && window.x1Wallet.isX1Wallet;
  }

  get connected() {
    return window.x1Wallet?.isConnected || false;
  }

  get publicKey() {
    return window.x1Wallet?.publicKey || null;
  }

  async connect() {
    if (!this.installed) {
      window.open(this.url, '_blank');
      throw new Error('X1 Wallet not installed');
    }
    return await window.x1Wallet.connect();
  }

  async disconnect() {
    return await window.x1Wallet.disconnect();
  }

  async signTransaction(transaction) {
    return await window.x1Wallet.signTransaction(transaction);
  }

  async signAllTransactions(transactions) {
    return await window.x1Wallet.signAllTransactions(transactions);
  }

  async signAndSendTransaction(transaction, options) {
    return await window.x1Wallet.signAndSendTransaction(transaction, options);
  }

  async signMessage(message) {
    return await window.x1Wallet.signMessage(message);
  }
}

// Usage
const x1Wallet = new X1WalletAdapter();

// Add to wallet list
const wallets = [
  { adapter: x1Wallet, readyState: x1Wallet.installed ? 'Installed' : 'NotDetected' },
  // ... other wallets
];
```

---

## Network Support

X1 Wallet supports the following networks:

| Network | Chain |
|---------|-------|
| X1 Mainnet | X1 |
| X1 Testnet | X1 |
| Solana Mainnet | Solana |
| Solana Devnet | Solana |

---

## Transaction Format

X1 Wallet accepts transactions in these formats:
1. **Base64 encoded string** - Most common for API responses
2. **Uint8Array** - Raw bytes
3. **Solana Web3.js Transaction object** - Has `serialize()` method

```javascript
// Example: Creating a transaction for signing
const transaction = /* your transaction */;

// If using @solana/web3.js
const signedTx = await window.x1Wallet.signTransaction(transaction);

// If using base64 from API
const signedTx = await window.x1Wallet.signTransaction(base64Transaction);
```

---

## Error Handling

```javascript
try {
  await window.x1Wallet.connect();
} catch (error) {
  if (error.message === 'User rejected the request') {
    // User cancelled
  } else if (error.message === 'Request timeout') {
    // User didn't respond in time
  } else {
    // Other error
    console.error('Connection failed:', error);
  }
}
```

---

## Contact

For integration support, contact:
- **Developer**: Jason (CEO, XIX Inc)
- **Project**: X1 Wallet by Blockspeed LLC

---

## Changelog

- **v1.0.0** - Initial provider implementation
  - Connect/disconnect
  - Transaction signing
  - Message signing
  - Multi-network support
