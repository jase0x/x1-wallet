/**
 * X1 Wallet Adapter for Solana Wallet Adapter (JavaScript)
 * 
 * Usage:
 *   import { X1WalletAdapter } from './X1WalletAdapter';
 *   
 *   const wallets = [
 *     new X1WalletAdapter(),
 *     new PhantomWalletAdapter(),
 *     new BackpackWalletAdapter(),
 *   ];
 */

import {
  BaseMessageSignerWalletAdapter,
  WalletReadyState,
  WalletConnectionError,
  WalletDisconnectionError,
  WalletNotConnectedError,
  WalletNotReadyError,
  WalletSignMessageError,
  WalletSignTransactionError,
} from '@solana/wallet-adapter-base';
import { PublicKey } from '@solana/web3.js';

export const X1WalletName = 'X1 Wallet';

// X1 Wallet icon as base64 SVG
const X1_WALLET_ICON = 
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgdmlld0JveD0iMCAwIDEyOCAxMjgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiByeD0iMjQiIGZpbGw9IiMwMjc0RkIiLz4KPHRleHQgeD0iNjQiIHk9Ijg1IiBmb250LWZhbWlseT0iQXJpYWwgQmxhY2ssIHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iNzAiIGZvbnQtd2VpZ2h0PSI5MDAiIGZpbGw9IndoaXRlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5YMTwvdGV4dD4KPC9zdmc+';

export class X1WalletAdapter extends BaseMessageSignerWalletAdapter {
  name = X1WalletName;
  url = 'https://x1.xyz';
  icon = X1_WALLET_ICON;
  supportedTransactionVersions = new Set(['legacy', 0]);

  _connecting = false;
  _wallet = null;
  _publicKey = null;
  _readyState = WalletReadyState.NotDetected;

  constructor() {
    super();
    
    if (typeof window !== 'undefined') {
      this._checkWallet();
      
      // Listen for wallet injection
      window.addEventListener('x1Wallet#initialized', this._handleWalletInit);
    }
  }

  _handleWalletInit = () => {
    this._checkWallet();
  };

  _checkWallet() {
    if (typeof window === 'undefined') return;

    const wallet = window.x1Wallet;
    
    if (wallet?.isX1Wallet) {
      this._wallet = wallet;
      this._readyState = WalletReadyState.Installed;
      
      if (wallet.isConnected && wallet.publicKey) {
        this._publicKey = new PublicKey(wallet.publicKey);
      }
      
      this.emit('readyStateChange', this._readyState);
    }
  }

  get publicKey() {
    return this._publicKey;
  }

  get connecting() {
    return this._connecting;
  }

  get connected() {
    return !!this._publicKey && !!this._wallet?.isConnected;
  }

  get readyState() {
    return this._readyState;
  }

  async connect() {
    try {
      if (this.connected || this.connecting) return;
      
      if (this._readyState !== WalletReadyState.Installed) {
        throw new WalletNotReadyError();
      }

      this._connecting = true;

      const wallet = this._wallet;
      if (!wallet) throw new WalletNotReadyError();

      try {
        const { publicKey } = await wallet.connect();
        this._publicKey = new PublicKey(publicKey);
      } catch (error) {
        throw new WalletConnectionError(error?.message, error);
      }

      wallet.on('disconnect', this._handleDisconnect);
      wallet.on('accountChanged', this._handleAccountChanged);

      this.emit('connect', this._publicKey);
    } catch (error) {
      this.emit('error', error);
      throw error;
    } finally {
      this._connecting = false;
    }
  }

  async disconnect() {
    const wallet = this._wallet;
    
    if (wallet) {
      wallet.off('disconnect', this._handleDisconnect);
      wallet.off('accountChanged', this._handleAccountChanged);

      this._publicKey = null;

      try {
        await wallet.disconnect();
      } catch (error) {
        this.emit('error', new WalletDisconnectionError(error?.message, error));
      }
    }

    this.emit('disconnect');
  }

  _handleDisconnect = () => {
    this._publicKey = null;
    this.emit('disconnect');
  };

  _handleAccountChanged = (data) => {
    if (data.publicKey) {
      const publicKey = new PublicKey(data.publicKey);
      this._publicKey = publicKey;
      this.emit('connect', publicKey);
    } else {
      this._publicKey = null;
      this.emit('disconnect');
    }
  };

  async signTransaction(transaction) {
    try {
      const wallet = this._wallet;
      if (!wallet || !this._publicKey) throw new WalletNotConnectedError();

      try {
        return await wallet.signTransaction(transaction);
      } catch (error) {
        throw new WalletSignTransactionError(error?.message, error);
      }
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  async signAllTransactions(transactions) {
    try {
      const wallet = this._wallet;
      if (!wallet || !this._publicKey) throw new WalletNotConnectedError();

      try {
        return await wallet.signAllTransactions(transactions);
      } catch (error) {
        throw new WalletSignTransactionError(error?.message, error);
      }
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  async signMessage(message) {
    try {
      const wallet = this._wallet;
      if (!wallet || !this._publicKey) throw new WalletNotConnectedError();

      try {
        const { signature } = await wallet.signMessage(message);
        return signature;
      } catch (error) {
        throw new WalletSignMessageError(error?.message, error);
      }
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }
}

export default X1WalletAdapter;
