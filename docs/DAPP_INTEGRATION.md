# X1 Wallet - dApp Integration Guide

This guide explains how to integrate X1 Wallet as a wallet option in your dApp alongside Phantom, Backpack, and other Solana wallets.

---

## Quick Start

X1 Wallet injects a provider at `window.x1Wallet` that implements a Phantom-compatible API.

```javascript
// Check if X1 Wallet is installed
if (window.x1Wallet) {
  console.log('X1 Wallet is installed!');
}
```

---

## Option 1: Solana Wallet Adapter (Recommended)

If your dApp uses `@solana/wallet-adapter`, create a custom adapter:

### Install Dependencies

```bash
npm install @solana/wallet-adapter-base @solana/web3.js
```

### Create X1 Wallet Adapter

```typescript
// x1-wallet-adapter.ts
import {
  BaseMessageSignerWalletAdapter,
  WalletName,
  WalletReadyState,
  WalletConnectionError,
  WalletDisconnectionError,
  WalletNotConnectedError,
  WalletNotReadyError,
  WalletSignMessageError,
  WalletSignTransactionError,
} from '@solana/wallet-adapter-base';
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

interface X1WalletProvider {
  isX1Wallet: boolean;
  isConnected: boolean;
  publicKey: string | null;
  connect(): Promise<{ publicKey: string }>;
  disconnect(): Promise<void>;
  signTransaction(transaction: Transaction | VersionedTransaction): Promise<Transaction | VersionedTransaction>;
  signAllTransactions(transactions: (Transaction | VersionedTransaction)[]): Promise<(Transaction | VersionedTransaction)[]>;
  signMessage(message: Uint8Array): Promise<{ signature: Uint8Array }>;
  signAndSendTransaction(transaction: Transaction | VersionedTransaction, options?: any): Promise<string>;
  on(event: string, callback: (data: any) => void): () => void;
  off(event: string, callback: (data: any) => void): void;
}

interface X1WalletWindow extends Window {
  x1Wallet?: X1WalletProvider;
}

declare const window: X1WalletWindow;

export const X1WalletName = 'X1 Wallet' as WalletName<'X1 Wallet'>;

export class X1WalletAdapter extends BaseMessageSignerWalletAdapter {
  name = X1WalletName;
  url = 'https://x1.xyz';
  icon = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgdmlld0JveD0iMCAwIDEyOCAxMjgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjEyOCIgaGVpZ2h0PSIxMjgiIHJ4PSIyNCIgZmlsbD0iIzAyNzRGQiIvPjxwYXRoIGQ9Ik0zMiA0MEw2NCA4OEw5NiA0MCIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIxMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+PHBhdGggZD0iTTY0IDg4VjQwIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjEyIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48L3N2Zz4=';

  private _connecting = false;
  private _wallet: X1WalletProvider | null = null;
  private _publicKey: PublicKey | null = null;
  private _readyState: WalletReadyState = WalletReadyState.NotDetected;

  constructor() {
    super();
    this._checkWallet();
  }

  private _checkWallet(): void {
    if (typeof window !== 'undefined') {
      if (window.x1Wallet?.isX1Wallet) {
        this._readyState = WalletReadyState.Installed;
        this._wallet = window.x1Wallet;
      } else {
        // Listen for wallet injection
        window.addEventListener('x1Wallet#initialized', () => {
          if (window.x1Wallet?.isX1Wallet) {
            this._readyState = WalletReadyState.Installed;
            this._wallet = window.x1Wallet;
            this.emit('readyStateChange', this._readyState);
          }
        });
      }
    }
  }

  get publicKey(): PublicKey | null {
    return this._publicKey;
  }

  get connecting(): boolean {
    return this._connecting;
  }

  get connected(): boolean {
    return !!this._wallet?.isConnected;
  }

  get readyState(): WalletReadyState {
    return this._readyState;
  }

  async connect(): Promise<void> {
    try {
      if (this.connected || this.connecting) return;
      if (this._readyState !== WalletReadyState.Installed) {
        throw new WalletNotReadyError();
      }

      this._connecting = true;

      const wallet = this._wallet!;
      const { publicKey } = await wallet.connect();
      
      this._publicKey = new PublicKey(publicKey);

      // Set up event listeners
      wallet.on('disconnect', this._onDisconnect);
      wallet.on('accountChanged', this._onAccountChanged);

      this.emit('connect', this._publicKey);
    } catch (error: any) {
      throw new WalletConnectionError(error?.message, error);
    } finally {
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    const wallet = this._wallet;
    if (wallet) {
      wallet.off('disconnect', this._onDisconnect);
      wallet.off('accountChanged', this._onAccountChanged);

      try {
        await wallet.disconnect();
      } catch (error: any) {
        throw new WalletDisconnectionError(error?.message, error);
      }
    }

    this._publicKey = null;
    this.emit('disconnect');
  }

  private _onDisconnect = () => {
    this._publicKey = null;
    this.emit('disconnect');
  };

  private _onAccountChanged = (data: { publicKey: string }) => {
    if (data.publicKey) {
      this._publicKey = new PublicKey(data.publicKey);
      this.emit('connect', this._publicKey);
    } else {
      this._publicKey = null;
      this.emit('disconnect');
    }
  };

  async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
    try {
      const wallet = this._wallet;
      if (!wallet) throw new WalletNotConnectedError();

      const signedTransaction = await wallet.signTransaction(transaction);
      return signedTransaction as T;
    } catch (error: any) {
      throw new WalletSignTransactionError(error?.message, error);
    }
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]> {
    try {
      const wallet = this._wallet;
      if (!wallet) throw new WalletNotConnectedError();

      const signedTransactions = await wallet.signAllTransactions(transactions);
      return signedTransactions as T[];
    } catch (error: any) {
      throw new WalletSignTransactionError(error?.message, error);
    }
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    try {
      const wallet = this._wallet;
      if (!wallet) throw new WalletNotConnectedError();

      const { signature } = await wallet.signMessage(message);
      return signature;
    } catch (error: any) {
      throw new WalletSignMessageError(error?.message, error);
    }
  }
}
```

### Use in Your dApp

```tsx
// App.tsx
import { WalletProvider, ConnectionProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { BackpackWalletAdapter } from '@solana/wallet-adapter-backpack';
import { X1WalletAdapter } from './x1-wallet-adapter';

const wallets = [
  new X1WalletAdapter(),      // X1 Wallet
  new PhantomWalletAdapter(), // Phantom
  new BackpackWalletAdapter(), // Backpack
];

function App() {
  return (
    <ConnectionProvider endpoint="https://rpc.mainnet.x1.xyz">
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {/* Your app */}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
```

---

## Option 2: Direct Integration

For custom wallet UIs without the adapter library:

```javascript
// Wallet detection
const wallets = [];

if (window.x1Wallet?.isX1Wallet) {
  wallets.push({
    name: 'X1 Wallet',
    icon: 'https://x1.xyz/x1-logo.png',
    provider: window.x1Wallet
  });
}

if (window.phantom?.solana) {
  wallets.push({
    name: 'Phantom',
    icon: 'https://phantom.app/img/logo.png',
    provider: window.phantom.solana
  });
}

if (window.backpack) {
  wallets.push({
    name: 'Backpack',
    icon: 'https://backpack.app/icon.png',
    provider: window.backpack
  });
}

// Connect to selected wallet
async function connectWallet(wallet) {
  try {
    const { publicKey } = await wallet.provider.connect();
    console.log('Connected:', publicKey);
    return publicKey;
  } catch (err) {
    console.error('Connection failed:', err);
    throw err;
  }
}

// Sign transaction
async function signTransaction(wallet, transaction) {
  return await wallet.provider.signTransaction(transaction);
}

// Sign and send
async function signAndSend(wallet, transaction) {
  return await wallet.provider.signAndSendTransaction(transaction);
}

// Sign message
async function signMessage(wallet, message) {
  const encoder = new TextEncoder();
  const messageBytes = encoder.encode(message);
  const { signature } = await wallet.provider.signMessage(messageBytes);
  return signature;
}
```

---

## API Reference

### Provider Object: `window.x1Wallet`

| Property | Type | Description |
|----------|------|-------------|
| `isX1Wallet` | `boolean` | Always `true` for X1 Wallet |
| `isConnected` | `boolean` | Current connection status |
| `publicKey` | `string \| null` | Connected wallet's public key |
| `network` | `string \| null` | Current network name |

### Methods

#### `connect()`
Connect to the wallet.

```javascript
const { publicKey } = await window.x1Wallet.connect();
```

Returns: `Promise<{ publicKey: string }>`

---

#### `disconnect()`
Disconnect from the wallet.

```javascript
await window.x1Wallet.disconnect();
```

Returns: `Promise<void>`

---

#### `signTransaction(transaction)`
Sign a single transaction.

```javascript
const signedTx = await window.x1Wallet.signTransaction(transaction);
```

Parameters:
- `transaction`: `Transaction | VersionedTransaction | Uint8Array | string (base64)`

Returns: `Promise<Transaction>`

---

#### `signAllTransactions(transactions)`
Sign multiple transactions.

```javascript
const signedTxs = await window.x1Wallet.signAllTransactions([tx1, tx2]);
```

Parameters:
- `transactions`: `Array<Transaction>`

Returns: `Promise<Array<Transaction>>`

---

#### `signAndSendTransaction(transaction, options?)`
Sign and broadcast a transaction.

```javascript
const signature = await window.x1Wallet.signAndSendTransaction(transaction, {
  skipPreflight: false,
  preflightCommitment: 'confirmed'
});
```

Parameters:
- `transaction`: `Transaction | VersionedTransaction`
- `options`: `{ skipPreflight?: boolean, preflightCommitment?: string }`

Returns: `Promise<string>` (transaction signature)

---

#### `signMessage(message)`
Sign an arbitrary message.

```javascript
const { signature } = await window.x1Wallet.signMessage(
  new TextEncoder().encode('Hello, X1!')
);
```

Parameters:
- `message`: `Uint8Array | string`

Returns: `Promise<{ signature: Uint8Array }>`

---

#### `getNetwork()`
Get current network.

```javascript
const network = await window.x1Wallet.getNetwork();
// Returns: "X1 Mainnet" | "X1 Testnet" | "Solana Mainnet" | "Solana Devnet"
```

Returns: `Promise<string>`

---

### Events

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
  console.log('Account changed:', publicKey);
});

// Network changed
window.x1Wallet.on('networkChanged', ({ network }) => {
  console.log('Network changed:', network);
});
```

---

## Detection & Installation Prompt

```javascript
function checkX1Wallet() {
  if (window.x1Wallet?.isX1Wallet) {
    return { installed: true, provider: window.x1Wallet };
  }
  
  return { 
    installed: false, 
    installUrl: 'https://x1.xyz/wallet' 
  };
}

// Usage
const { installed, provider, installUrl } = checkX1Wallet();
if (!installed) {
  // Show install prompt
  window.open(installUrl, '_blank');
}
```

---

## Full React Example

```tsx
import React, { useState, useEffect, useCallback } from 'react';

interface Wallet {
  name: string;
  icon: string;
  provider: any;
}

export function WalletConnect() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [connected, setConnected] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [selectedWallet, setSelectedWallet] = useState<Wallet | null>(null);

  // Detect available wallets
  useEffect(() => {
    const detectWallets = () => {
      const detected: Wallet[] = [];
      
      if (window.x1Wallet?.isX1Wallet) {
        detected.push({
          name: 'X1 Wallet',
          icon: 'https://logo44.s3.us-east-2.amazonaws.com/logos/X1.png',
          provider: window.x1Wallet
        });
      }
      
      if (window.phantom?.solana?.isPhantom) {
        detected.push({
          name: 'Phantom',
          icon: 'https://phantom.app/img/logo.png',
          provider: window.phantom.solana
        });
      }
      
      if (window.backpack) {
        detected.push({
          name: 'Backpack',
          icon: 'https://backpack.app/icon.png',
          provider: window.backpack
        });
      }
      
      setWallets(detected);
    };

    detectWallets();
    
    // Listen for X1 Wallet injection
    window.addEventListener('x1Wallet#initialized', detectWallets);
    return () => window.removeEventListener('x1Wallet#initialized', detectWallets);
  }, []);

  const connect = useCallback(async (wallet: Wallet) => {
    try {
      const { publicKey } = await wallet.provider.connect();
      setPublicKey(publicKey);
      setConnected(true);
      setSelectedWallet(wallet);
      
      // Set up disconnect listener
      wallet.provider.on('disconnect', () => {
        setConnected(false);
        setPublicKey(null);
        setSelectedWallet(null);
      });
    } catch (error) {
      console.error('Connection failed:', error);
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (selectedWallet) {
      await selectedWallet.provider.disconnect();
      setConnected(false);
      setPublicKey(null);
      setSelectedWallet(null);
    }
  }, [selectedWallet]);

  if (connected && publicKey) {
    return (
      <div>
        <p>Connected: {publicKey.slice(0, 4)}...{publicKey.slice(-4)}</p>
        <button onClick={disconnect}>Disconnect</button>
      </div>
    );
  }

  return (
    <div>
      <h3>Select Wallet</h3>
      {wallets.length === 0 ? (
        <p>No wallets detected. <a href="https://x1.xyz/wallet">Install X1 Wallet</a></p>
      ) : (
        wallets.map((wallet) => (
          <button key={wallet.name} onClick={() => connect(wallet)}>
            <img src={wallet.icon} alt={wallet.name} width={24} height={24} />
            {wallet.name}
          </button>
        ))
      )}
    </div>
  );
}
```

---

## Networks

X1 Wallet supports multiple networks:

| Network | RPC URL | Chain |
|---------|---------|-------|
| X1 Mainnet | `https://rpc.mainnet.x1.xyz` | X1 |
| X1 Testnet | `https://rpc.testnet.x1.xyz` | X1 |
| Solana Mainnet | `https://api.mainnet-beta.solana.com` | Solana |
| Solana Devnet | `https://api.devnet.solana.com` | Solana |

---

## Support

- Website: https://x1.xyz
- Documentation: https://docs.x1.xyz
- Discord: https://discord.gg/x1blockchain
- GitHub: https://github.com/x1blockchain

---

## NPM Package (Coming Soon)

```bash
npm install @x1-wallet/adapter
```

```javascript
import { X1WalletAdapter } from '@x1-wallet/adapter';
```
