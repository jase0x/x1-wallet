# x1-wallet
# X1 Wallet Monorepo

Multi-platform wallet for X1 Blockchain - Browser Extension & Mobile Apps.

## Structure

```
x1-wallet/
├── packages/
│   ├── core/           # Shared wallet logic (crypto, APIs, services)
│   ├── extension/      # Chrome/Firefox browser extension
│   └── mobile/         # React Native (iOS + Android)
```

## Packages

| Package | Description | Technology |
|---------|-------------|------------|
| `@x1-wallet/core` | Shared wallet logic | JavaScript |
| `@x1-wallet/extension` | Browser extension | React + Vite |
| `@x1-wallet/mobile` | Mobile apps | React Native |

## What's Shared (Core)

All platforms share the same:
- **Crypto** - BIP-39 seed generation, BIP-44 key derivation, Ed25519 signing
- **APIs** - XDEX swap, X1 Mobile API, token fetching
- **Networks** - RPC endpoints, explorer URLs
- **Wallet logic** - Transaction building, balance fetching

## Quick Start

### Prerequisites
- Node.js 18+
- pnpm (`npm install -g pnpm`)
- For mobile: Xcode (iOS) / Android Studio (Android)

### Install Dependencies

```bash
pnpm install
```

### Build Extension

```bash
# Development
pnpm dev:extension

# Production build
pnpm build:extension
```

Load the `packages/extension/extension/` folder in Chrome as unpacked extension.

### Run Mobile

```bash
# Install React Native dependencies
cd packages/mobile
npx react-native init X1Wallet --template react-native-template-typescript

# Start Metro bundler
pnpm dev:mobile

# Run on Android
pnpm build:android

# Run on iOS
pnpm build:ios
```

## Using Shared Core

Both extension and mobile import from `@x1-wallet/core`:

```javascript
// Generate wallet (same code everywhere!)
import { generateMnemonic } from '@x1-wallet/core/utils/bip39';
import { deriveKeypair } from '@x1-wallet/core/utils/bip44';

const mnemonic = await generateMnemonic(128);
const keypair = await deriveKeypair(mnemonic, 0);

// Use XDEX API
import { getQuote, prepareSwap } from '@x1-wallet/core/services/xdex';

const quote = await getQuote('X1 Mainnet', 'XNT', 'USDC', 100);
```

## Core Exports

### Utils
- `bip39.js` - Mnemonic generation/validation
- `bip44.js` - HD wallet key derivation
- `crypto.js` - Ed25519 signing, encryption
- `base58.js` - Address encoding
- `transaction.js` - Transaction building

### Services
- `networks.js` - Network configurations
- `xdex.js` - XDEX swap API
- `tokens.js` - Token fetching (SPL, Token-2022)
- `activity.js` - Transaction history
- `hardware.js` - Ledger integration

## Development

### Adding to Core

1. Add your module to `packages/core/src/`
2. Export from `packages/core/src/index.js`
3. Import in extension/mobile as `@x1-wallet/core/...`

### Platform-Specific Code

- **Extension**: React DOM components in `packages/extension/src/components/`
- **Mobile**: React Native components in `packages/mobile/src/screens/`

## Security Notes

- Private keys stored in:
  - Extension: `chrome.storage.local` (encrypted)
  - Mobile: `react-native-keychain` (secure enclave)
- Never expose mnemonics in logs
- All crypto operations use audited libraries

## License

MIT
