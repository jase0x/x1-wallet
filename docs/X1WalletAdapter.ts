/**
 * X1 Wallet Adapter for Solana Wallet Adapter
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

interface X1WalletEvents {
  connect: { publicKey: string };
  disconnect: void;
  accountChanged: { publicKey: string };
  networkChanged: { network: string };
}

interface X1WalletProvider {
  isX1Wallet: boolean;
  isConnected: boolean;
  publicKey: string | null;
  network: string | null;
  connect(): Promise<{ publicKey: string }>;
  disconnect(): Promise<void>;
  signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]>;
  signMessage(message: Uint8Array): Promise<{ signature: Uint8Array }>;
  signAndSendTransaction(
    transaction: Transaction | VersionedTransaction,
    options?: { skipPreflight?: boolean; preflightCommitment?: string }
  ): Promise<string>;
  getNetwork(): Promise<string>;
  on<E extends keyof X1WalletEvents>(event: E, callback: (data: X1WalletEvents[E]) => void): () => void;
  off<E extends keyof X1WalletEvents>(event: E, callback: (data: X1WalletEvents[E]) => void): void;
}

interface X1WalletWindow extends Window {
  x1Wallet?: X1WalletProvider;
}

declare const window: X1WalletWindow;

export const X1WalletName = 'X1 Wallet' as WalletName<'X1 Wallet'>;

// X1 Wallet icon as base64 SVG
const X1_WALLET_ICON = 
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgdmlld0JveD0iMCAwIDEyOCAxMjgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiByeD0iMjQiIGZpbGw9IiMwMjc0RkIiLz4KPHRleHQgeD0iNjQiIHk9Ijg1IiBmb250LWZhbWlseT0iQXJpYWwgQmxhY2ssIHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iNzAiIGZvbnQtd2VpZ2h0PSI5MDAiIGZpbGw9IndoaXRlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5YMTwvdGV4dD4KPC9zdmc+';

export class X1WalletAdapter extends BaseMessageSignerWalletAdapter {
  name = X1WalletName;
  url = 'https://x1.xyz';
  icon = X1_WALLET_ICON;
  supportedTransactionVersions = new Set(['legacy', 0] as const);

  private _connecting = false;
  private _wallet: X1WalletProvider | null = null;
  private _publicKey: PublicKey | null = null;
  private _readyState: WalletReadyState = WalletReadyState.NotDetected;

  constructor() {
    super();
    
    if (typeof window !== 'undefined') {
      this._checkWallet();
      
      // Listen for wallet injection (in case adapter loads before wallet)
      window.addEventListener('x1Wallet#initialized', this._handleWalletInit);
    }
  }

  private _handleWalletInit = (): void => {
    this._checkWallet();
  };

  private _checkWallet(): void {
    if (typeof window === 'undefined') return;

    const wallet = window.x1Wallet;
    
    if (wallet?.isX1Wallet) {
      this._wallet = wallet;
      this._readyState = WalletReadyState.Installed;
      
      // Check if already connected
      if (wallet.isConnected && wallet.publicKey) {
        this._publicKey = new PublicKey(wallet.publicKey);
      }
      
      this.emit('readyStateChange', this._readyState);
    }
  }

  get publicKey(): PublicKey | null {
    return this._publicKey;
  }

  get connecting(): boolean {
    return this._connecting;
  }

  get connected(): boolean {
    return !!this._publicKey && !!this._wallet?.isConnected;
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

      const wallet = this._wallet;
      if (!wallet) throw new WalletNotReadyError();

      try {
        const { publicKey } = await wallet.connect();
        this._publicKey = new PublicKey(publicKey);
      } catch (error: any) {
        throw new WalletConnectionError(error?.message, error);
      }

      // Set up event listeners
      wallet.on('disconnect', this._handleDisconnect);
      wallet.on('accountChanged', this._handleAccountChanged);

      this.emit('connect', this._publicKey);
    } catch (error: any) {
      this.emit('error', error);
      throw error;
    } finally {
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    const wallet = this._wallet;
    
    if (wallet) {
      wallet.off('disconnect', this._handleDisconnect);
      wallet.off('accountChanged', this._handleAccountChanged);

      this._publicKey = null;

      try {
        await wallet.disconnect();
      } catch (error: any) {
        this.emit('error', new WalletDisconnectionError(error?.message, error));
      }
    }

    this.emit('disconnect');
  }

  private _handleDisconnect = (): void => {
    this._publicKey = null;
    this.emit('disconnect');
  };

  private _handleAccountChanged = (data: { publicKey: string }): void => {
    if (data.publicKey) {
      const publicKey = new PublicKey(data.publicKey);
      this._publicKey = publicKey;
      this.emit('connect', publicKey);
    } else {
      this._publicKey = null;
      this.emit('disconnect');
    }
  };

  async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
    try {
      const wallet = this._wallet;
      if (!wallet || !this._publicKey) throw new WalletNotConnectedError();

      try {
        return await wallet.signTransaction(transaction);
      } catch (error: any) {
        throw new WalletSignTransactionError(error?.message, error);
      }
    } catch (error: any) {
      this.emit('error', error);
      throw error;
    }
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]> {
    try {
      const wallet = this._wallet;
      if (!wallet || !this._publicKey) throw new WalletNotConnectedError();

      try {
        return await wallet.signAllTransactions(transactions);
      } catch (error: any) {
        throw new WalletSignTransactionError(error?.message, error);
      }
    } catch (error: any) {
      this.emit('error', error);
      throw error;
    }
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    try {
      const wallet = this._wallet;
      if (!wallet || !this._publicKey) throw new WalletNotConnectedError();

      try {
        const { signature } = await wallet.signMessage(message);
        return signature;
      } catch (error: any) {
        throw new WalletSignMessageError(error?.message, error);
      }
    } catch (error: any) {
      this.emit('error', error);
      throw error;
    }
  }
}

export default X1WalletAdapter;
