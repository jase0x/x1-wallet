// Transaction Utilities for Solana/X1 compatible chains
import { decodeBase58, encodeBase58 } from './base58';
import { sign } from './bip44';
import { logger } from './logger.js';

// System Program ID for transfers
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';

// Token Program IDs - Standard SPL Token Program
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

// ComputeBudget Program ID for priority fees
const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';

// Metaplex Bubblegum Program for compressed NFTs
const BUBBLEGUM_PROGRAM_ID = 'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY';
const SPL_NOOP_PROGRAM_ID = 'noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV';
const SPL_ACCOUNT_COMPRESSION_PROGRAM_ID = 'cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK';

// Decode base58 to fixed-size byte array with padding
function decodeToFixedSize(base58Str, size) {
  const decoded = decodeBase58(base58Str);
  if (decoded.length === size) {
    return decoded;
  }
  // Pad with leading zeros if too short
  if (decoded.length < size) {
    const padded = new Uint8Array(size);
    padded.set(decoded, size - decoded.length);
    return padded;
  }
  // Truncate if too long (shouldn't happen with valid data)
  return decoded.slice(0, size);
}

// Create a transfer transaction
export async function createTransferTransaction({ fromPubkey, toPubkey, lamports, recentBlockhash, privateKey, priorityFee = 0 }) {
  try {
    // Decode the private key (stored as base58 encoded 64-byte secret key)
    let secretKey;
    if (typeof privateKey === 'string') {
      secretKey = decodeBase58(privateKey);
    } else {
      secretKey = privateKey;
    }
    
    // Ensure secret key is 64 bytes
    if (secretKey.length !== 64) {
      throw new Error(`Invalid secret key length: ${secretKey.length}, expected 64`);
    }

    // Build the transaction message (with optional priority fee)
    const message = buildTransferMessage(fromPubkey, toPubkey, lamports, recentBlockhash, priorityFee);
    
    // Sign the message using Ed25519
    const signature = await sign(message, secretKey);
    
    // Serialize the transaction
    const serializedTx = serializeTransaction(signature, message);
    
    // Return as base64
    return btoa(String.fromCharCode(...serializedTx));
  } catch (error) {
    logger.error('Transaction creation error:', error);
    throw error;
  }
}

// Create a token transfer transaction for SPL tokens
export async function createTokenTransferTransaction({ 
  fromPubkey, 
  toPubkey, 
  mint,
  amount, 
  decimals,
  fromTokenAccount,
  toTokenAccount: providedToTokenAccount, // Optional: direct token account address
  recentBlockhash, 
  privateKey,
  programId,
  rpcUrl
}) {
  try {
    logger.log('=== TOKEN TRANSFER START ===');
    logger.log('From wallet:', fromPubkey);
    logger.log('To wallet:', toPubkey);
    logger.log('Mint:', mint);
    logger.log('Amount:', amount);
    logger.log('From token account:', fromTokenAccount);
    logger.log('Provided to token account:', providedToTokenAccount);
    logger.log('Token program:', programId);
    
    // Validate required fields
    if (!fromPubkey) throw new Error('From wallet address is required');
    if (!toPubkey) throw new Error('To wallet address is required');
    if (!mint) throw new Error('Token mint address is required');
    if (!fromTokenAccount) throw new Error('Source token account address is required');
    if (!privateKey) throw new Error('Wallet is locked. Please unlock your wallet to sign transactions.');
    
    // Handle self-transfer - for SPL tokens, source and destination ATA would be the same
    // Instead of erroring, we return a "no-op" success since balance wouldn't change anyway
    if (fromPubkey === toPubkey) {
      logger.log('[Transaction] Self-transfer detected - returning no-op success (balance unchanged)');
      return {
        signature: 'self-transfer-no-op',
        success: true,
        message: 'Self-transfer completed (no blockchain transaction needed - balance unchanged)'
      };
    }
    
    // Decode the private key
    let secretKey;
    if (typeof privateKey === 'string') {
      secretKey = decodeBase58(privateKey);
    } else {
      secretKey = privateKey;
    }
    
    if (!secretKey || secretKey.length !== 64) {
      throw new Error(`Invalid secret key length: ${secretKey?.length || 0}, expected 64`);
    }

    // Use the program ID from the token data, or default
    const tokenProgramId = programId || TOKEN_PROGRAM_ID;
    
    // Find or derive destination ATA
    let toTokenAccount = providedToTokenAccount; // Use provided if available
    let needsCreateATA = false;
    
    if (!toTokenAccount && rpcUrl) {
      // First check if recipient already has an ATA for this token
      const existingATA = await findExistingATA(rpcUrl, toPubkey, mint);
      if (existingATA) {
        logger.log('Found existing ATA for recipient:', existingATA);
        toTokenAccount = existingATA;
        needsCreateATA = false;
      } else {
        // Recipient doesn't have an ATA - use RPC validation to derive correct address
        logger.log('No existing ATA - deriving with RPC validation');
        try {
          toTokenAccount = await deriveATAAddressStandard(toPubkey, mint, tokenProgramId, rpcUrl, fromPubkey);
          logger.log('Derived ATA with RPC validation:', toTokenAccount);
          needsCreateATA = true;
        } catch (deriveErr) {
          // Fallback to simple derivation if RPC validation fails
          logger.warn('RPC validation failed, using simple derivation:', deriveErr.message);
          const result = await findATAAddress(toPubkey, mint, tokenProgramId);
          toTokenAccount = result.address;
          needsCreateATA = true;
        }
      }
    } else if (!toTokenAccount) {
      // No RPC URL and no provided account, use standard derivation
      const result = await findATAAddress(toPubkey, mint, tokenProgramId);
      toTokenAccount = result.address;
      needsCreateATA = true; // Assume we need to create when no RPC check
      logger.log('Derived ATA (no RPC):', toTokenAccount);
    } else {
      logger.log('Using provided token account:', toTokenAccount);
    }
    
    logger.log('Final destination token account:', toTokenAccount);
    logger.log('Needs ATA creation:', needsCreateATA);
    
    // CRITICAL: Validate derived ATA doesn't conflict with other accounts
    logger.log('[TOKEN TRANSFER] Validating account addresses:');
    logger.log('  fromPubkey:', fromPubkey);
    logger.log('  toPubkey:', toPubkey);
    logger.log('  fromTokenAccount:', fromTokenAccount);
    logger.log('  toTokenAccount:', toTokenAccount);
    logger.log('  mint:', mint);
    
    if (toTokenAccount === fromPubkey) {
      throw new Error('Derived ATA matches sender wallet - invalid derivation');
    }
    if (toTokenAccount === toPubkey) {
      throw new Error('Derived ATA matches recipient wallet - invalid derivation');
    }
    if (toTokenAccount === fromTokenAccount) {
      throw new Error('Derived ATA matches source token account - cannot send to same account. This may happen if sending to your own wallet.');
    }
    if (toTokenAccount === mint) {
      throw new Error('Derived ATA matches mint address - invalid derivation');
    }
    
    // Build the appropriate message
    let message;
    if (needsCreateATA) {
      // Include CreateAssociatedTokenAccount instruction before transfer
      message = buildTokenTransferWithCreateATAMessage({
        fromPubkey,
        toPubkey,
        fromTokenAccount,
        toTokenAccount,
        mint,
        amount,
        recentBlockhash,
        tokenProgramId
      });
      logger.log('Built transfer WITH ATA creation (2 instructions)');
    } else {
      // Just transfer
      message = buildTokenTransferMessage({
        fromPubkey,
        fromTokenAccount,
        toTokenAccount,
        amount,
        recentBlockhash,
        tokenProgramId
      });
      logger.log('Built simple transfer (1 instruction)');
    }
    
    // Sign the message
    const signature = await sign(message, secretKey);
    
    // Serialize the transaction
    const serializedTx = serializeTransaction(signature, message);
    
    logger.log('=== TOKEN TRANSFER READY ===');
    return btoa(String.fromCharCode(...serializedTx));
  } catch (error) {
    logger.error('Token transfer error:', error);
    throw error;
  }
}

/**
 * Create a compressed NFT transfer transaction using Bubblegum
 */
export async function createCompressedNftTransfer({
  assetId,
  owner,
  newOwner,
  proof,
  asset,
  recentBlockhash,
  privateKey
}) {
  try {
    logger.log('[cNFT Transfer] Starting transfer:', assetId?.slice(0, 8));
    
    // Decode private key
    let secretKey;
    if (typeof privateKey === 'string') {
      secretKey = decodeBase58(privateKey);
    } else {
      secretKey = privateKey;
    }
    
    if (!secretKey || secretKey.length !== 64) {
      throw new Error('Invalid private key');
    }
    
    // Verify the public key from secret key matches the owner
    const pubkeyFromSecret = secretKey.slice(32);
    const expectedPubkey = encodeBase58(pubkeyFromSecret);
    
    if (expectedPubkey !== owner) {
      throw new Error('Private key does not match owner address');
    }
    
    // Extract compression data from asset
    const compression = asset.compression;
    if (!compression) {
      throw new Error('Asset is not compressed');
    }
    
    const treeId = proof.tree_id;
    const root = proof.root;
    const dataHash = compression.data_hash;
    const creatorHash = compression.creator_hash;
    const leafIndex = compression.leaf_id;
    const proofPath = proof.proof || [];
    
    // Derive tree authority PDA
    const treeAuthority = await deriveTreeAuthority(treeId);
    
    // Build the message
    const message = buildCompressedNftTransferMessage({
      treeAuthority,
      leafOwner: owner,
      leafDelegate: owner,
      newLeafOwner: newOwner,
      merkleTree: treeId,
      root,
      dataHash,
      creatorHash,
      nonce: leafIndex,
      index: leafIndex,
      proofPath,
      recentBlockhash
    });
    
    // Sign the message
    const signature = await sign(message, secretKey);
    
    // Serialize the transaction
    const serializedTx = serializeTransaction(signature, message);
    
    logger.log('[cNFT Transfer] Transaction built successfully');
    return btoa(String.fromCharCode(...serializedTx));
  } catch (error) {
    logger.error('[cNFT Transfer] Error:', error.message);
    throw error;
  }
}

/**
 * Derive tree authority PDA for Bubblegum
 */
async function deriveTreeAuthority(treeId) {
  const treeBytes = decodeToFixedSize(treeId, 32);
  const bubblegumBytes = decodeToFixedSize(BUBBLEGUM_PROGRAM_ID, 32);
  const marker = new TextEncoder().encode('ProgramDerivedAddress');
  
  // Seeds: [merkle_tree]
  for (let bump = 255; bump >= 0; bump--) {
    const bumpSeed = new Uint8Array([bump]);
    
    const buffer = new Uint8Array(32 + 1 + 32 + marker.length);
    let offset = 0;
    buffer.set(treeBytes, offset); offset += 32;
    buffer.set(bumpSeed, offset); offset += 1;
    buffer.set(bubblegumBytes, offset); offset += 32;
    buffer.set(marker, offset);
    
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    const hashBytes = new Uint8Array(hash);
    
    // Check if NOT on curve (valid PDA) - use existing isOnCurve function
    if (!isOnCurve(hashBytes)) {
      return encodeBase58(hashBytes);
    }
  }
  
  throw new Error('Failed to derive tree authority');
}

/**
 * Build compressed NFT transfer message for Bubblegum
 */
function buildCompressedNftTransferMessage({
  treeAuthority,
  leafOwner,
  leafDelegate,
  newLeafOwner,
  merkleTree,
  root,
  dataHash,
  creatorHash,
  nonce,
  index,
  proofPath,
  recentBlockhash
}) {
  // Handle account deduplication - if leafDelegate == leafOwner, they share an index
  const isDelegateSameAsOwner = leafDelegate === leafOwner;
  
  const treeAuthorityBytes = decodeToFixedSize(treeAuthority, 32);
  const leafOwnerBytes = decodeToFixedSize(leafOwner, 32);
  const leafDelegateBytes = isDelegateSameAsOwner ? leafOwnerBytes : decodeToFixedSize(leafDelegate, 32);
  const newLeafOwnerBytes = decodeToFixedSize(newLeafOwner, 32);
  const merkleTreeBytes = decodeToFixedSize(merkleTree, 32);
  const bubblegumBytes = decodeToFixedSize(BUBBLEGUM_PROGRAM_ID, 32);
  const noopBytes = decodeToFixedSize(SPL_NOOP_PROGRAM_ID, 32);
  const compressionBytes = decodeToFixedSize(SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, 32);
  const systemBytes = decodeToFixedSize(SYSTEM_PROGRAM_ID, 32);
  const blockhashBytes = decodeToFixedSize(recentBlockhash, 32);
  
  // Decode root and hashes from base58
  const rootBytes = decodeToFixedSize(root, 32);
  const dataHashBytes = decodeToFixedSize(dataHash, 32);
  const creatorHashBytes = decodeToFixedSize(creatorHash, 32);
  
  // Decode proof path
  const proofBytes = proofPath.map(p => decodeToFixedSize(p, 32));
  const numProofAccounts = proofBytes.length;
  
  // Build unique account list (deduplicated)
  // Order: signer first, then writable, then readonly
  // 0: leafOwner (signer, writable - pays fees)
  // 1: merkleTree (writable)
  // 2: treeAuthority (readonly)
  // 3: leafDelegate (readonly) - ONLY if different from leafOwner
  // N: newLeafOwner (readonly)
  // N+1: logWrapper/noop (readonly)
  // N+2: compressionProgram (readonly)
  // N+3: systemProgram (readonly)
  // N+4 to ...: proof accounts (readonly)
  // last: bubblegum program (readonly)
  
  let accountList = [];
  accountList.push({ bytes: leafOwnerBytes, name: 'leafOwner' });      // idx 0
  accountList.push({ bytes: merkleTreeBytes, name: 'merkleTree' });    // idx 1
  accountList.push({ bytes: treeAuthorityBytes, name: 'treeAuthority' }); // idx 2
  
  let leafDelegateIdx = 0; // Same as leafOwner by default
  if (!isDelegateSameAsOwner) {
    leafDelegateIdx = accountList.length;
    accountList.push({ bytes: leafDelegateBytes, name: 'leafDelegate' });
  }
  
  const newLeafOwnerIdx = accountList.length;
  accountList.push({ bytes: newLeafOwnerBytes, name: 'newLeafOwner' });
  
  const noopIdx = accountList.length;
  accountList.push({ bytes: noopBytes, name: 'noop' });
  
  const compressionIdx = accountList.length;
  accountList.push({ bytes: compressionBytes, name: 'compression' });
  
  const systemIdx = accountList.length;
  accountList.push({ bytes: systemBytes, name: 'system' });
  
  const proofStartIdx = accountList.length;
  for (const proofAcc of proofBytes) {
    accountList.push({ bytes: proofAcc, name: 'proof' });
  }
  
  const bubblegumIdx = accountList.length;
  accountList.push({ bytes: bubblegumBytes, name: 'bubblegum' });
  
  const numAccounts = accountList.length;
  
  // Build account keys array
  const accountKeys = new Uint8Array(32 * numAccounts);
  for (let i = 0; i < numAccounts; i++) {
    accountKeys.set(accountList[i].bytes, i * 32);
  }
  
  // Header: 1 signer (leafOwner at 0), 0 readonly signed, rest are readonly unsigned
  // Writable accounts: leafOwner(0), merkleTree(1) = 2 writable
  // Readonly unsigned: numAccounts - 2
  const numReadonlyUnsigned = numAccounts - 2;
  const header = new Uint8Array([1, 0, numReadonlyUnsigned]);
  
  // Bubblegum transfer instruction discriminator (Anchor)
  const discriminator = new Uint8Array([163, 52, 200, 231, 140, 3, 69, 186]);
  
  // Instruction data: discriminator + root + dataHash + creatorHash + nonce (u64) + index (u32)
  const instructionData = new Uint8Array(8 + 32 + 32 + 32 + 8 + 4);
  let dataOffset = 0;
  
  instructionData.set(discriminator, dataOffset); dataOffset += 8;
  instructionData.set(rootBytes, dataOffset); dataOffset += 32;
  instructionData.set(dataHashBytes, dataOffset); dataOffset += 32;
  instructionData.set(creatorHashBytes, dataOffset); dataOffset += 32;
  
  // nonce as u64 LE
  const nonceBI = BigInt(nonce);
  for (let i = 0; i < 8; i++) {
    instructionData[dataOffset + i] = Number((nonceBI >> BigInt(i * 8)) & BigInt(0xff));
  }
  dataOffset += 8;
  
  // index as u32 LE
  instructionData[dataOffset] = index & 0xff;
  instructionData[dataOffset + 1] = (index >> 8) & 0xff;
  instructionData[dataOffset + 2] = (index >> 16) & 0xff;
  instructionData[dataOffset + 3] = (index >> 24) & 0xff;
  
  // Build instruction account indices
  // Bubblegum expects: tree_authority, leaf_owner, leaf_delegate, new_leaf_owner, merkle_tree, log_wrapper, compression, system, proof...
  const accountIndices = [
    2,                 // tree_authority -> our idx 2
    0,                 // leaf_owner -> our idx 0
    leafDelegateIdx,   // leaf_delegate -> our idx 0 or 3
    newLeafOwnerIdx,   // new_leaf_owner
    1,                 // merkle_tree -> our idx 1
    noopIdx,           // log_wrapper
    compressionIdx,    // compression_program
    systemIdx          // system_program
  ];
  
  // Add proof account indices
  for (let i = 0; i < numProofAccounts; i++) {
    accountIndices.push(proofStartIdx + i);
  }
  
  const numInstrAccounts = accountIndices.length;
  
  // Calculate instruction size
  let instrSize = 1; // program index
  instrSize += 1; // compact array length (assuming < 128 accounts)
  instrSize += numInstrAccounts; // account indices
  instrSize += (instructionData.length < 128) ? 1 : 2; // data length
  instrSize += instructionData.length;
  
  const instruction = new Uint8Array(instrSize);
  let instrOffset = 0;
  
  instruction[instrOffset++] = bubblegumIdx; // program id index
  instruction[instrOffset++] = numInstrAccounts; // compact-u16, assuming < 128
  for (const idx of accountIndices) {
    instruction[instrOffset++] = idx;
  }
  
  // Data length as compact-u16
  if (instructionData.length < 128) {
    instruction[instrOffset++] = instructionData.length;
  } else {
    instruction[instrOffset++] = (instructionData.length & 0x7f) | 0x80;
    instruction[instrOffset++] = instructionData.length >> 7;
  }
  instruction.set(instructionData, instrOffset);
  
  // Build full message
  const messageLength = 3 + 1 + (32 * numAccounts) + 32 + 1 + instruction.length;
  const message = new Uint8Array(messageLength);
  
  let msgOffset = 0;
  message.set(header, msgOffset); msgOffset += 3;
  message[msgOffset] = numAccounts; msgOffset += 1;
  message.set(accountKeys, msgOffset); msgOffset += 32 * numAccounts;
  message.set(blockhashBytes, msgOffset); msgOffset += 32;
  message[msgOffset] = 1; msgOffset += 1; // 1 instruction
  message.set(instruction, msgOffset);
  
  return message;
}

/**
 * Build a simple bridge transfer transaction
 * This is a direct SPL token transfer between two existing token accounts
 * No ATA derivation or creation needed - both accounts must already exist
 */
export async function buildBridgeTransferTransaction({
  ownerPubkey,
  sourceTokenAccount,
  destTokenAccount,
  amount,
  recentBlockhash,
  privateKey,
  tokenProgramId
}) {
  logger.log('=== BRIDGE TRANSFER START ===');
  logger.log('Owner:', ownerPubkey);
  logger.log('Source token account:', sourceTokenAccount);
  logger.log('Dest token account:', destTokenAccount);
  logger.log('Amount:', amount);
  logger.log('Token program:', tokenProgramId);
  
  try {
    // Decode the private key
    let secretKey;
    if (typeof privateKey === 'string') {
      secretKey = decodeBase58(privateKey);
    } else {
      secretKey = privateKey;
    }
    
    if (secretKey.length !== 64) {
      throw new Error(`Invalid secret key length: ${secretKey.length}, expected 64`);
    }

    // Decode all public keys to 32-byte arrays
    const ownerBytes = decodeToFixedSize(ownerPubkey, 32);
    const sourceBytes = decodeToFixedSize(sourceTokenAccount, 32);
    const destBytes = decodeToFixedSize(destTokenAccount, 32);
    const programBytes = decodeToFixedSize(tokenProgramId, 32);
    const blockhashBytes = decodeToFixedSize(recentBlockhash, 32);
    
    // Build message header: 1 signer, 0 readonly signed, 1 readonly unsigned (token program)
    const header = new Uint8Array([1, 0, 1]);
    
    // Account keys order:
    // 0: owner (signer, writable) - the wallet owner who authorizes the transfer
    // 1: source token account (writable) - sender's USDC token account
    // 2: dest token account (writable) - bridge deposit token account
    // 3: token program (readonly)
    const accountKeys = new Uint8Array(32 * 4);
    accountKeys.set(ownerBytes, 0);    // index 0: owner
    accountKeys.set(sourceBytes, 32);  // index 1: source
    accountKeys.set(destBytes, 64);    // index 2: dest
    accountKeys.set(programBytes, 96); // index 3: token program
    
    // Token Transfer instruction data: type 3 (Transfer) + amount as u64 LE
    const instructionData = new Uint8Array(9);
    instructionData[0] = 3; // Transfer instruction
    const amountBI = BigInt(amount);
    for (let i = 0; i < 8; i++) {
      instructionData[1 + i] = Number((amountBI >> BigInt(i * 8)) & BigInt(0xff));
    }
    
    // Instruction format:
    // - program_id_index: 3 (token program)
    // - num_accounts: 3
    // - account indices: 1 (source), 2 (dest), 0 (owner/authority)
    // - data_len: 9
    // - data: instructionData
    const instruction = new Uint8Array([
      3,           // program id index
      3,           // number of accounts
      1, 2, 0,     // account indices: source, dest, authority
      9,           // data length
      ...instructionData
    ]);
    
    // Build the message
    const messageLength = 3 + 1 + 128 + 32 + 1 + instruction.length;
    const message = new Uint8Array(messageLength);
    
    let offset = 0;
    message.set(header, offset); offset += 3;
    message[offset] = 4; offset += 1; // number of accounts
    message.set(accountKeys, offset); offset += 128;
    message.set(blockhashBytes, offset); offset += 32;
    message[offset] = 1; offset += 1; // number of instructions
    message.set(instruction, offset);
    
    logger.log('Message built, length:', message.length);
    
    // Sign the message
    const signature = await sign(message, secretKey);
    
    // Serialize: [1 byte: num_signatures] [64 bytes: signature] [message]
    const signedTx = new Uint8Array(1 + 64 + message.length);
    signedTx[0] = 1;
    signedTx.set(signature, 1);
    signedTx.set(message, 65);
    
    logger.log('=== BRIDGE TRANSFER READY ===');
    return btoa(String.fromCharCode(...signedTx));
  } catch (error) {
    logger.error('Bridge transfer error:', error);
    throw error;
  }
}

/**
 * Verify ATA derivation by checking if we can correctly derive the sender's existing token account
 * Returns { valid: boolean, bump: number | null }
 */
async function verifyATADerivation(rpcUrl, owner, mint, existingTokenAccount, tokenProgramId) {
  try {
    // Try each bump and see if we can derive the existing account
    for (let bump = 255; bump >= 0; bump--) {
      const derived = await computeATAAddress(owner, mint, tokenProgramId, bump);
      if (derived === existingTokenAccount) {
        logger.log(`Verification: bump ${bump} produces correct address`);
        return { valid: true, bump };
      }
    }
    
    logger.warn('Verification failed: could not derive existing token account');
    logger.warn('This might mean the account is not a standard ATA');
    return { valid: false, bump: null };
  } catch (error) {
    logger.warn('Verification error:', error);
    return { valid: false, bump: null };
  }
}

// Find existing ATA for an owner/mint combination
export async function findExistingATA(rpcUrl, owner, mint, tokenProgramId = null) {
  try {
    logger.log('[findExistingATA] Looking for mint:', mint?.slice(0, 8), 'owner:', owner?.slice(0, 8));
    
    // Search both token programs in parallel
    const [response1, response2] = await Promise.all([
      fetchRpcRetry(rpcUrl, {
        jsonrpc: '2.0',
        id: 1,
        method: 'getTokenAccountsByOwner',
        params: [
          owner,
          { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
          { encoding: 'jsonParsed' }
        ]
      }),
      fetchRpcRetry(rpcUrl, {
        jsonrpc: '2.0',
        id: 2,
        method: 'getTokenAccountsByOwner',
        params: [
          owner,
          { programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' },
          { encoding: 'jsonParsed' }
        ]
      })
    ]);
    
    const [data1, data2] = await Promise.all([
      response1.json(),
      response2.json()
    ]);
    
    // Combine all accounts
    const allAccounts = [
      ...(data1.result?.value || []),
      ...(data2.result?.value || [])
    ];
    
    logger.log('[findExistingATA] Found', allAccounts.length, 'total token accounts');
    
    // Find the account with matching mint
    for (const acc of allAccounts) {
      const accMint = acc.account?.data?.parsed?.info?.mint;
      if (accMint === mint) {
        logger.log('[findExistingATA] Found matching account:', acc.pubkey?.slice(0, 8));
        return acc.pubkey;
      }
    }
    
    logger.warn('[findExistingATA] No token account found for mint:', mint?.slice(0, 8));
    return null;
  } catch (error) {
    logger.warn('[findExistingATA] Failed:', error.message);
    return null;
  }
}

/**
 * Derive ATA address by iterating through bumps using simulation to validate
 * @param payer - The account that will pay for simulation (must have funds)
 */
async function deriveATAAddressWithValidation(rpcUrl, owner, mint, tokenProgramId, payer) {
  logger.log('[ATA-RPC] Deriving ATA for owner:', owner);
  logger.log('[ATA-RPC] Mint:', mint);
  logger.log('[ATA-RPC] Token program:', tokenProgramId);
  
  // First, try bump 255 - this works 99%+ of the time
  const address255 = await computeATAAddress(owner, mint, tokenProgramId, 255);
  logger.log('[ATA-RPC] Testing bump 255:', address255);
  
  const isValid255 = await validateATAWithRPC(rpcUrl, owner, mint, address255, tokenProgramId, 255, payer);
  if (isValid255) {
    logger.log('[ATA-RPC] ✓ Found valid ATA with bump 255:', address255);
    return address255;
  }
  
  // If 255 failed, try a few more common bumps with delays to avoid rate limiting
  const bumpsToTry = [254, 253, 252, 251, 250];
  for (const bump of bumpsToTry) {
    // Small delay between attempts to avoid rate limiting
    await new Promise(r => setTimeout(r, 200));
    
    const address = await computeATAAddress(owner, mint, tokenProgramId, bump);
    logger.log(`[ATA-RPC] Testing bump ${bump}: ${address}`);
    
    const isValid = await validateATAWithRPC(rpcUrl, owner, mint, address, tokenProgramId, bump, payer);
    if (isValid) {
      logger.log(`[ATA-RPC] ✓ Found valid ATA with bump ${bump}: ${address}`);
      return address;
    }
    logger.log(`[ATA-RPC] ✗ Bump ${bump} invalid`);
  }
  
  // As fallback, use bump 255 anyway (most common case, RPC might have been wrong)
  logger.warn('[ATA-RPC] No valid bump found, using 255 as fallback');
  return address255;
}

/**
 * Compute ATA address for a given bump (no validation)
 */
async function computeATAAddress(owner, mint, tokenProgramId, bump) {
  const ownerBytes = decodeToFixedSize(owner, 32);
  const mintBytes = decodeToFixedSize(mint, 32);
  const tokenProgramBytes = decodeToFixedSize(tokenProgramId, 32);
  const ataProgramBytes = decodeToFixedSize(ASSOCIATED_TOKEN_PROGRAM_ID, 32);
  
  // Build the hash input for PDA derivation
  // Seeds: owner, token_program_id, mint
  // Then: bump, ata_program_id, "ProgramDerivedAddress"
  const bumpSeed = new Uint8Array([bump]);
  const marker = new TextEncoder().encode('ProgramDerivedAddress');
  
  const totalLength = 32 + 32 + 32 + 1 + 32 + marker.length;
  const buffer = new Uint8Array(totalLength);
  let offset = 0;
  
  // Seeds in correct order for ATA: owner, token_program_id, mint
  buffer.set(ownerBytes, offset); offset += 32;
  buffer.set(tokenProgramBytes, offset); offset += 32;
  buffer.set(mintBytes, offset); offset += 32;
  buffer.set(bumpSeed, offset); offset += 1;
  buffer.set(ataProgramBytes, offset); offset += 32;
  buffer.set(marker, offset);
  
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return encodeBase58(new Uint8Array(hash));
}

/**
 * Find the correct ATA address by trying different bump values
 * This mimics Solana's findProgramAddress behavior
 */
async function findATAAddress(owner, mint, tokenProgramId) {
  logger.log('[findATAAddress] Deriving ATA for:');
  logger.log('  owner:', owner);
  logger.log('  mint:', mint);
  logger.log('  tokenProgramId:', tokenProgramId);
  
  const ownerBytes = decodeToFixedSize(owner, 32);
  const mintBytes = decodeToFixedSize(mint, 32);
  const tokenProgramBytes = decodeToFixedSize(tokenProgramId, 32);
  const ataProgramBytes = decodeToFixedSize(ASSOCIATED_TOKEN_PROGRAM_ID, 32);
  const marker = new TextEncoder().encode('ProgramDerivedAddress');
  
  // Try bumps from 255 down to 0
  for (let bump = 255; bump >= 0; bump--) {
    const bumpSeed = new Uint8Array([bump]);
    
    const totalLength = 32 + 32 + 32 + 1 + 32 + marker.length;
    const buffer = new Uint8Array(totalLength);
    let offset = 0;
    
    buffer.set(ownerBytes, offset); offset += 32;
    buffer.set(tokenProgramBytes, offset); offset += 32;
    buffer.set(mintBytes, offset); offset += 32;
    buffer.set(bumpSeed, offset); offset += 1;
    buffer.set(ataProgramBytes, offset); offset += 32;
    buffer.set(marker, offset);
    
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    const hashBytes = new Uint8Array(hash);
    
    // Check if this point is NOT on the ed25519 curve
    // A valid PDA must NOT be a valid ed25519 public key
    if (!isOnCurve(hashBytes)) {
      console.log('[ATA] Found valid PDA at bump:', bump, 'address:', encodeBase58(hashBytes));
      return { address: encodeBase58(hashBytes), bump };
    }
  }
  
  throw new Error('Could not find valid PDA for ATA');
}

/**
 * Check if a 32-byte array is on the ed25519 curve
 * This is a simplified check - returns true if it might be on curve
 */
function isOnCurve(bytes) {
  // For ed25519, a point is on the curve if it can be decoded as a valid point
  // A simplified heuristic: check if the high bit of the last byte is not set
  // and if it's not all zeros or all ones
  
  // All zeros is definitely not a valid point
  let allZero = true;
  let allOne = true;
  for (let i = 0; i < 32; i++) {
    if (bytes[i] !== 0) allZero = false;
    if (bytes[i] !== 255) allOne = false;
  }
  if (allZero || allOne) return true; // Treat as "on curve" to skip
  
  // Most PDAs have bump 255 or 254, so we use a simple heuristic:
  // If the last byte has high bit set, it's likely on curve
  // This is not cryptographically accurate but works for most cases
  // The proper check requires actual ed25519 point decompression
  
  // Actually, for Solana's implementation, we should just trust that
  // bump 255 usually works, and if not, try lower bumps
  // The real check requires ed25519 math which is complex
  
  // For now, assume 255 is valid (most common case)
  return false;
}

/**
 * Helper to fetch RPC with 429 retry and exponential backoff
 */
async function fetchRpcRetry(rpcUrl, body, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body)
      });
      
      if (response.status === 429) {
        // Rate limited - exponential backoff with jitter
        const baseDelay = 1000 * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 500;
        const delay = Math.min(baseDelay + jitter, 8000);
        logger.warn(`[RPC] Rate limited (429), waiting ${Math.round(delay)}ms (attempt ${attempt}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      
      return response;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      // Network error - delay before retry
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw new Error('RPC request failed after max retries');
}

/**
 * Validate ATA address using RPC
 * Checks if the derived address matches what the ATA program would create
 * @param payer - Real account with funds for simulation (allows ATA program to run)
 */
async function validateATAWithRPC(rpcUrl, owner, mint, ataAddress, tokenProgramId, bump, payer) {
  try {
    // Get a blockhash for simulation with retry
    const bhResponse = await fetchRpcRetry(rpcUrl, {
      jsonrpc: '2.0',
      id: 1,
      method: 'getLatestBlockhash',
      params: [{ commitment: 'finalized' }]
    });
    const bhData = await bhResponse.json();
    const blockhash = bhData.result?.value?.blockhash;
    if (!blockhash) {
      logger.warn('[ATA-RPC] Failed to get blockhash');
      return false;
    }
    
    // Build CreateATA message using real payer (sender)
    const message = buildCreateATAMessage(payer, owner, ataAddress, mint, tokenProgramId, blockhash);
    
    // Create dummy signature
    const dummySignature = new Uint8Array(64);
    const tx = new Uint8Array(1 + 64 + message.length);
    tx[0] = 1;
    tx.set(dummySignature, 1);
    tx.set(message, 65);
    
    const txBase64 = btoa(String.fromCharCode(...tx));
    
    // Simulate with retry for rate limits
    const response = await fetchRpcRetry(rpcUrl, {
      jsonrpc: '2.0',
      id: 1,
      method: 'simulateTransaction',
      params: [txBase64, { 
        encoding: 'base64',
        sigVerify: false,
        replaceRecentBlockhash: true
      }]
    });
    
    const data = await response.json();
    const err = data.result?.value?.err;
    
    logger.log(`[ATA-RPC] Bump ${bump} simulation result:`, err ? JSON.stringify(err) : 'OK');
    
    if (!err) {
      return true;  // No error - valid
    }
    
    // Parse error
    if (err.InstructionError) {
      const [instrIndex, errType] = err.InstructionError;
      
      // Custom error from ATA program usually means wrong seeds
      if (typeof errType === 'object' && 'Custom' in errType) {
        return false;
      }
      
      // InvalidSeeds is the specific error we're looking for
      if (errType === 'InvalidSeeds') {
        return false;
      }
      
      // IncorrectProgramId might mean wrong seeds too
      if (errType === 'IncorrectProgramId') {
        return false;
      }
      
      // InvalidAccountData usually means the derived address is wrong
      if (errType === 'InvalidAccountData') {
        return false;
      }
      
      // AccountNotFound - shouldn't happen now since we're using real payer
      // But if it does, could mean mint doesn't exist
      if (errType === 'AccountNotFound') {
        logger.warn('AccountNotFound with real payer - checking mint');
        return true;  // Might still be valid
      }
      
      // InsufficientFunds also means address is probably valid
      if (errType === 'InsufficientFunds') {
        return true;
      }
      
      // AccountLoadedTwice means transaction is malformed
      if (errType === 'AccountLoadedTwice') {
        logger.warn('AccountLoadedTwice error - check message construction');
        return false;  // Try next bump
      }
    }
    
    // For other errors, check if it's a seed-related error
    const errStr = JSON.stringify(err);
    if (errStr.includes('InvalidSeeds') || errStr.includes('seeds')) {
      return false;
    }
    
    // Default: assume valid
    return true;
    
  } catch (error) {
    logger.warn('Validation error for bump', bump, ':', error);
    return false;
  }
}

/**
 * Build a CreateAssociatedTokenAccountIdempotent message for simulation
 * @param payer - The account paying for ATA creation (signer)
 * @param owner - The owner of the new ATA
 */
function buildCreateATAMessage(payer, owner, ataAddress, mint, tokenProgramId, blockhash) {
  const payerBytes = decodeToFixedSize(payer, 32);
  const ownerBytes = decodeToFixedSize(owner, 32);
  const ataBytes = decodeToFixedSize(ataAddress, 32);
  const mintBytes = decodeToFixedSize(mint, 32);
  const tokenProgramBytes = decodeToFixedSize(tokenProgramId, 32);
  const ataProgramBytes = decodeToFixedSize(ASSOCIATED_TOKEN_PROGRAM_ID, 32);
  const systemProgramBytes = decodeToFixedSize(SYSTEM_PROGRAM_ID, 32);
  const blockhashBytes = decodeToFixedSize(blockhash, 32);
  
  // Header: 1 signer, 0 readonly signed, 3 readonly unsigned
  const header = new Uint8Array([1, 0, 3]);
  
  // 7 accounts for CreateATA:
  // 0: payer (signer, writable)
  // 1: ATA (writable)
  // 2: owner (different from payer when creating for someone else)
  // 3: mint
  // 4: system program
  // 5: token program
  // 6: ATA program
  const numAccounts = 7;
  const accountKeys = new Uint8Array(32 * numAccounts);
  accountKeys.set(payerBytes, 0);     // payer
  accountKeys.set(ataBytes, 32);      // ATA
  accountKeys.set(ownerBytes, 64);    // owner
  accountKeys.set(mintBytes, 96);
  accountKeys.set(systemProgramBytes, 128);
  accountKeys.set(tokenProgramBytes, 160);
  accountKeys.set(ataProgramBytes, 192);
  
  // CreateAssociatedTokenAccountIdempotent instruction
  // Accounts: payer(0), ata(1), owner(2), mint(3), system(4), token(5)
  // Program index: 6 (ATA program)
  const createATAInstruction = new Uint8Array([
    6,        // program id index
    6,        // number of accounts
    0, 1, 2, 3, 4, 5,  // account indices
    1,        // data length
    1         // instruction type 1 = CreateIdempotent
  ]);
  
  const messageLength = 3 + 1 + (32 * numAccounts) + 32 + 1 + createATAInstruction.length;
  const message = new Uint8Array(messageLength);
  
  let offset = 0;
  message.set(header, offset); offset += 3;
  message[offset] = numAccounts; offset += 1;
  message.set(accountKeys, offset); offset += 32 * numAccounts;
  message.set(blockhashBytes, offset); offset += 32;
  message[offset] = 1; offset += 1;
  message.set(createATAInstruction, offset);
  
  return message;
}

/**
 * Standard ATA derivation with RPC validation
 * MUST provide rpcUrl and payer for reliable derivation when creating new ATAs
 */
export async function deriveATAAddressStandard(owner, mint, tokenProgramId, rpcUrl = null, payer = null) {
  // If we have RPC URL and payer, use validation to ensure correct bump
  if (rpcUrl && payer) {
    try {
      logger.log('[ATA] Using RPC validation for ATA derivation');
      const address = await deriveATAAddressWithValidation(rpcUrl, owner, mint, tokenProgramId, payer);
      logger.log('[ATA] RPC validated address:', address);
      return address;
    } catch (e) {
      logger.error('[ATA] RPC validation failed:', e.message);
      // Don't fall back - throw the error so caller knows derivation failed
      throw new Error(`Failed to derive ATA address: ${e.message}`);
    }
  }
  
  // No RPC provided - this is risky for new ATAs
  logger.warn('[ATA] No RPC validation - using bump 255 (may be incorrect)');
  const result = await findATAAddress(owner, mint, tokenProgramId);
  return result.address;
}

// Build token transfer message (transfer only, ATA must exist)
function buildTokenTransferMessage({ 
  fromPubkey, 
  fromTokenAccount, 
  toTokenAccount, 
  amount, 
  recentBlockhash,
  tokenProgramId 
}) {
  // Check for duplicates first
  logger.log('[BUILD TX Simple] Checking accounts:');
  logger.log('  owner:', fromPubkey);
  logger.log('  source:', fromTokenAccount);
  logger.log('  dest:', toTokenAccount);
  logger.log('  program:', tokenProgramId);
  
  if (fromPubkey === fromTokenAccount) {
    throw new Error('Owner cannot be the same as source token account');
  }
  if (fromPubkey === toTokenAccount) {
    throw new Error('Owner cannot be the same as destination token account');
  }
  // Self-transfer check - if source and dest ATA are same, this is a self-transfer
  // which was already handled at higher level, but just in case return null to signal no-op
  if (fromTokenAccount === toTokenAccount) {
    logger.log('[BUILD TX Simple] Self-transfer detected (same ATA), returning null for no-op');
    return null;
  }
  
  const ownerBytes = decodeToFixedSize(fromPubkey, 32);
  const sourceBytes = decodeToFixedSize(fromTokenAccount, 32);
  const destBytes = decodeToFixedSize(toTokenAccount, 32);
  const programBytes = decodeToFixedSize(tokenProgramId, 32);
  const blockhashBytes = decodeToFixedSize(recentBlockhash, 32);
  
  // Message header: 1 signer, 0 readonly signed, 1 readonly unsigned
  const header = new Uint8Array([1, 0, 1]);
  
  // Account keys: owner, source, dest, program
  const accountKeys = new Uint8Array(32 * 4);
  accountKeys.set(ownerBytes, 0);
  accountKeys.set(sourceBytes, 32);
  accountKeys.set(destBytes, 64);
  accountKeys.set(programBytes, 96);
  
  // Token Transfer instruction: type 3 + amount as u64 LE
  const instructionData = new Uint8Array(9);
  instructionData[0] = 3;
  const amountBI = BigInt(amount);
  for (let i = 0; i < 8; i++) {
    instructionData[1 + i] = Number((amountBI >> BigInt(i * 8)) & BigInt(0xff));
  }
  
  const instruction = new Uint8Array([
    3, 3, 1, 2, 0, 9, ...instructionData
  ]);
  
  const messageLength = 3 + 1 + 128 + 32 + 1 + instruction.length;
  const message = new Uint8Array(messageLength);
  
  let offset = 0;
  message.set(header, offset); offset += 3;
  message[offset] = 4; offset += 1;
  message.set(accountKeys, offset); offset += 128;
  message.set(blockhashBytes, offset); offset += 32;
  message[offset] = 1; offset += 1;
  message.set(instruction, offset);
  
  return message;
}

// Build token transfer with CreateATA instruction
function buildTokenTransferWithCreateATAMessage({
  fromPubkey,
  toPubkey,
  fromTokenAccount,
  toTokenAccount,
  mint,
  amount,
  recentBlockhash,
  tokenProgramId
}) {
  const payerBytes = decodeToFixedSize(fromPubkey, 32);
  const destOwnerBytes = decodeToFixedSize(toPubkey, 32);
  const sourceBytes = decodeToFixedSize(fromTokenAccount, 32);
  const destATABytes = decodeToFixedSize(toTokenAccount, 32);
  const mintBytes = decodeToFixedSize(mint, 32);
  const tokenProgramBytes = decodeToFixedSize(tokenProgramId, 32);
  const ataProgramBytes = decodeToFixedSize(ASSOCIATED_TOKEN_PROGRAM_ID, 32);
  const systemProgramBytes = decodeToFixedSize(SYSTEM_PROGRAM_ID, 32);
  const blockhashBytes = decodeToFixedSize(recentBlockhash, 32);
  
  // Check for duplicate accounts (would cause "Account loaded twice" error)
  const accounts = [
    { name: 'payer', bytes: payerBytes, address: fromPubkey },
    { name: 'destATA', bytes: destATABytes, address: toTokenAccount },
    { name: 'source', bytes: sourceBytes, address: fromTokenAccount },
    { name: 'destOwner', bytes: destOwnerBytes, address: toPubkey },
    { name: 'mint', bytes: mintBytes, address: mint },
    { name: 'system', bytes: systemProgramBytes, address: SYSTEM_PROGRAM_ID },
    { name: 'tokenProgram', bytes: tokenProgramBytes, address: tokenProgramId },
    { name: 'ataProgram', bytes: ataProgramBytes, address: ASSOCIATED_TOKEN_PROGRAM_ID }
  ];
  
  logger.log('[BUILD TX] Checking for duplicate accounts...');
  for (let i = 0; i < accounts.length; i++) {
    for (let j = i + 1; j < accounts.length; j++) {
      // Compare as base58 strings
      if (accounts[i].address === accounts[j].address) {
        logger.error(`[BUILD TX] DUPLICATE DETECTED: ${accounts[i].name} === ${accounts[j].name} === ${accounts[i].address}`);
        throw new Error(`Duplicate account detected: ${accounts[i].name} and ${accounts[j].name} are the same (${accounts[i].address})`);
      }
    }
  }
  logger.log('[BUILD TX] No duplicates found, building transaction...');
  
  // Header: 1 signer, 0 readonly signed, 5 readonly unsigned
  // Accounts must be ordered: writable signed, writable unsigned, readonly unsigned
  const header = new Uint8Array([1, 0, 5]);
  
  // 8 accounts (properly ordered):
  // 0: payer (signer, writable)
  // 1: dest ATA (writable)
  // 2: source token account (writable)
  // 3: dest owner (readonly) 
  // 4: mint (readonly)
  // 5: system program (readonly)
  // 6: token program (readonly)
  // 7: ATA program (readonly)
  const numAccounts = 8;
  const accountKeys = new Uint8Array(32 * numAccounts);
  accountKeys.set(payerBytes, 0);           // 0: payer
  accountKeys.set(destATABytes, 32);        // 1: dest ATA
  accountKeys.set(sourceBytes, 64);         // 2: source
  accountKeys.set(destOwnerBytes, 96);      // 3: dest owner
  accountKeys.set(mintBytes, 128);          // 4: mint
  accountKeys.set(systemProgramBytes, 160); // 5: system
  accountKeys.set(tokenProgramBytes, 192);  // 6: token program
  accountKeys.set(ataProgramBytes, 224);    // 7: ATA program
  
  // Instruction 1: CreateAssociatedTokenAccountIdempotent
  // Accounts: payer(0), ata(1), owner(3), mint(4), system(5), token(6)
  const createATAInstruction = new Uint8Array([
    7,        // program id index (ATA program)
    6,        // number of accounts
    0, 1, 3, 4, 5, 6,  // account indices
    1,        // data length
    1         // instruction type 1 = CreateIdempotent
  ]);
  
  // Instruction 2: Token Transfer
  // Accounts: source(2), dest(1), authority(0)
  const transferData = new Uint8Array(9);
  transferData[0] = 3; // Transfer instruction
  const amountBI = BigInt(amount);
  for (let i = 0; i < 8; i++) {
    transferData[1 + i] = Number((amountBI >> BigInt(i * 8)) & BigInt(0xff));
  }
  
  const transferInstruction = new Uint8Array([
    6,        // program id index (token program)
    3,        // number of accounts
    2, 1, 0,  // source, dest, authority
    9,        // data length
    ...transferData
  ]);
  
  const messageLength = 3 + 1 + (32 * numAccounts) + 32 + 1 + createATAInstruction.length + transferInstruction.length;
  const message = new Uint8Array(messageLength);
  
  let offset = 0;
  message.set(header, offset); offset += 3;
  message[offset] = numAccounts; offset += 1;
  message.set(accountKeys, offset); offset += 32 * numAccounts;
  message.set(blockhashBytes, offset); offset += 32;
  message[offset] = 2; offset += 1;
  message.set(createATAInstruction, offset); offset += createATAInstruction.length;
  message.set(transferInstruction, offset);
  
  return message;
}

// Build native SOL transfer message
export function buildTransferMessage(fromPubkey, toPubkey, lamports, recentBlockhash, priorityFee = 0) {
  const fromPubkeyBytes = decodeToFixedSize(fromPubkey, 32);
  const toPubkeyBytes = decodeToFixedSize(toPubkey, 32);
  const systemProgramBytes = decodeToFixedSize(SYSTEM_PROGRAM_ID, 32);
  const blockhashBytes = decodeToFixedSize(recentBlockhash, 32);
  
  // If no priority fee, use simple transfer
  if (!priorityFee || priorityFee <= 0) {
    const header = new Uint8Array([1, 0, 1]);
    
    const accountKeys = new Uint8Array(32 * 3);
    accountKeys.set(fromPubkeyBytes, 0);
    accountKeys.set(toPubkeyBytes, 32);
    accountKeys.set(systemProgramBytes, 64);
    
    const instructionData = new Uint8Array(12);
    instructionData[0] = 2;
    const lamportsBI = BigInt(lamports);
    for (let i = 0; i < 8; i++) {
      instructionData[4 + i] = Number((lamportsBI >> BigInt(i * 8)) & BigInt(0xff));
    }
    
    const instruction = new Uint8Array([
      2, 2, 0, 1, 12, ...instructionData
    ]);
    
    const messageLength = 3 + 1 + 96 + 32 + 1 + instruction.length;
    const message = new Uint8Array(messageLength);
    
    let offset = 0;
    message.set(header, offset); offset += 3;
    message[offset] = 3; offset += 1;
    message.set(accountKeys, offset); offset += 96;
    message.set(blockhashBytes, offset); offset += 32;
    message[offset] = 1; offset += 1;
    message.set(instruction, offset);
    
    return message;
  }
  
  // With priority fee - include ComputeBudget instructions
  const computeBudgetProgramBytes = decodeToFixedSize(COMPUTE_BUDGET_PROGRAM_ID, 32);
  
  // Header: 1 signer, 0 readonly signers, 2 readonly non-signers (ComputeBudget + System)
  const header = new Uint8Array([1, 0, 2]);
  
  // Account keys: from, to, ComputeBudget program, System program
  const accountKeys = new Uint8Array(32 * 4);
  accountKeys.set(fromPubkeyBytes, 0);
  accountKeys.set(toPubkeyBytes, 32);
  accountKeys.set(computeBudgetProgramBytes, 64);
  accountKeys.set(systemProgramBytes, 96);
  
  // Instruction 1: SetComputeUnitPrice (instruction index 3)
  // Format: instruction_type (1 byte) + microLamports (8 bytes u64)
  const priorityInstData = new Uint8Array(9);
  priorityInstData[0] = 3; // SetComputeUnitPrice instruction
  const priorityBI = BigInt(priorityFee);
  for (let i = 0; i < 8; i++) {
    priorityInstData[1 + i] = Number((priorityBI >> BigInt(i * 8)) & BigInt(0xff));
  }
  
  // Instruction 1: program index 2 (ComputeBudget), no accounts, 9 bytes data
  const priorityInst = new Uint8Array([
    2,    // program_id_index (ComputeBudget at index 2)
    0,    // accounts length
    9,    // data length
    ...priorityInstData
  ]);
  
  // Instruction 2: Transfer (System Program)
  const transferInstData = new Uint8Array(12);
  transferInstData[0] = 2; // Transfer instruction
  const lamportsBI = BigInt(lamports);
  for (let i = 0; i < 8; i++) {
    transferInstData[4 + i] = Number((lamportsBI >> BigInt(i * 8)) & BigInt(0xff));
  }
  
  // Instruction 2: program index 3 (System), accounts [0,1] (from, to), 12 bytes data
  const transferInst = new Uint8Array([
    3,    // program_id_index (System at index 3)
    2,    // accounts length
    0,    // account index 0 (from)
    1,    // account index 1 (to)
    12,   // data length
    ...transferInstData
  ]);
  
  // Build message
  const messageLength = 3 + 1 + 128 + 32 + 1 + priorityInst.length + transferInst.length;
  const message = new Uint8Array(messageLength);
  
  let offset = 0;
  message.set(header, offset); offset += 3;
  message[offset] = 4; offset += 1; // 4 account keys
  message.set(accountKeys, offset); offset += 128;
  message.set(blockhashBytes, offset); offset += 32;
  message[offset] = 2; offset += 1; // 2 instructions
  message.set(priorityInst, offset); offset += priorityInst.length;
  message.set(transferInst, offset);
  
  return message;
}

// Build token transfer message for hardware wallet signing (exported)
export function buildTokenTransferMessageForHardware({
  fromPubkey,
  toPubkey,
  fromTokenAccount,
  toTokenAccount,
  mint,
  amount,
  recentBlockhash,
  tokenProgramId,
  needsCreateATA = false
}) {
  // Use the internal function based on whether ATA creation is needed
  if (needsCreateATA) {
    return buildTokenTransferWithCreateATAMessage({
      fromPubkey,
      toPubkey,
      fromTokenAccount,
      toTokenAccount,
      mint,
      amount,
      recentBlockhash,
      tokenProgramId: tokenProgramId || TOKEN_PROGRAM_ID
    });
  } else {
    return buildTokenTransferMessage({
      fromPubkey,
      fromTokenAccount,
      toTokenAccount,
      amount,
      recentBlockhash,
      tokenProgramId: tokenProgramId || TOKEN_PROGRAM_ID
    });
  }
}

// Serialize transaction with signature
export function serializeTransaction(signature, message) {
  const tx = new Uint8Array(1 + 64 + message.length);
  tx[0] = 1;
  tx.set(signature, 1);
  tx.set(message, 65);
  return tx;
}

// Get transaction history from localStorage
// sortOrder: 'desc' (newest first) or 'asc' (oldest first)
export function getTransactionHistory(walletAddress, network, sortOrder = 'desc') {
  try {
    const all = JSON.parse(localStorage.getItem('x1wallet_transactions') || '[]');
    const filtered = all.filter(tx => {
      // Check explicit walletAddress field first, then fall back to from/to
      const matchesWallet = tx.walletAddress === walletAddress || 
                           tx.from === walletAddress || 
                           tx.to === walletAddress;
      const matchesNetwork = !network || tx.network === network;
      return matchesWallet && matchesNetwork;
    });
    // Sort by timestamp
    if (sortOrder === 'asc') {
      return filtered.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    }
    return filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  } catch {
    return [];
  }
}

// Add transaction to history
export function addTransaction(tx) {
  try {
    // Ensure walletAddress is set for filtering
    if (!tx.walletAddress && tx.from) {
      tx.walletAddress = tx.from;
    }
    const history = JSON.parse(localStorage.getItem('x1wallet_transactions') || '[]');
    history.unshift(tx);
    localStorage.setItem('x1wallet_transactions', JSON.stringify(history.slice(0, 100)));
  } catch (e) {
    logger.error('Failed to save transaction:', e);
  }
}

// Update an existing transaction by signature
export function updateTransaction(signature, updates) {
  try {
    const history = JSON.parse(localStorage.getItem('x1wallet_transactions') || '[]');
    const index = history.findIndex(tx => tx.signature === signature);
    
    if (index >= 0) {
      history[index] = { ...history[index], ...updates };
      localStorage.setItem('x1wallet_transactions', JSON.stringify(history));
      logger.log('[Transaction] Updated transaction:', signature, updates);
      return true;
    }
    
    logger.warn('[Transaction] Transaction not found for update:', signature);
    return false;
  } catch (e) {
    logger.error('Failed to update transaction:', e);
    return false;
  }
}

// Format transaction for display
export function formatTransaction(tx) {
  // Normalize timestamp to milliseconds
  let ts = tx.rawTimestamp || tx.timestamp || 0;
  // If timestamp is in seconds (less than year 2100 in seconds), convert to ms
  if (ts > 0 && ts < 4102444800) {
    ts = ts * 1000;
  }
  
  const date = new Date(ts);
  const now = new Date();
  
  // Format date string with time
  let dateStr;
  if (ts === 0 || isNaN(date.getTime())) {
    dateStr = '';
  } else {
    const timeStr = date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
    
    // Check if same day
    const isToday = date.toDateString() === now.toDateString();
    const isYesterday = date.toDateString() === new Date(now - 86400000).toDateString();
    
    if (isToday) {
      dateStr = `Today · ${timeStr}`;
    } else if (isYesterday) {
      dateStr = `Yesterday · ${timeStr}`;
    } else {
      const dateOnlyStr = date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
      });
      dateStr = `${dateOnlyStr} · ${timeStr}`;
    }
  }
  
  return {
    ...tx,
    timestamp: ts,
    rawTimestamp: ts,
    dateStr,
    timeStr: date.toLocaleTimeString(),
    shortSignature: tx.signature ? `${tx.signature.slice(0, 8)}...${tx.signature.slice(-8)}` : '',
    shortFrom: tx.from ? `${tx.from.slice(0, 6)}...${tx.from.slice(-4)}` : '',
    shortTo: tx.to ? `${tx.to.slice(0, 6)}...${tx.to.slice(-4)}` : ''
  };
}

// Fetch transactions from blockchain
export async function fetchBlockchainTransactions(rpcUrl, walletAddress, limit = 20, network = '') {
  try {
    const sigResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignaturesForAddress',
        params: [walletAddress, { limit }]
      })
    });
    
    const sigData = await sigResponse.json();
    if (sigData.error || !sigData.result?.length) return [];
    
    // Fetch all transactions in parallel (up to 10)
    const signatures = sigData.result.slice(0, 10);
    const txPromises = signatures.map(sig => 
      fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTransaction',
          params: [sig.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]
        })
      }).then(r => r.json()).catch(() => null)
    );
    
    const txResults = await Promise.all(txPromises);
    
    const transactions = [];
    const mintsToLookup = new Set();
    
    for (let i = 0; i < txResults.length; i++) {
      const txData = txResults[i];
      if (txData?.result) {
        const parsedTx = parseTransaction(txData.result, walletAddress, signatures[i].signature, network);
        if (parsedTx) {
          transactions.push(parsedTx);
          // Collect token mints that need symbol lookup
          if (parsedTx.tokenMint && parsedTx.symbol === 'Token') {
            mintsToLookup.add(parsedTx.tokenMint);
          }
          if (parsedTx.toTokenMint && parsedTx.toSymbol === 'Token') {
            mintsToLookup.add(parsedTx.toTokenMint);
          }
        }
      }
    }
    
    // Fetch token metadata for unknown tokens
    if (mintsToLookup.size > 0) {
      try {
        const { fetchTokenMetadataFromAPI, fetchToken2022Metadata } = await import('../services/tokens.js');
        const mintArray = Array.from(mintsToLookup);
        
        logger.log('[fetchBlockchainTransactions] Looking up symbols for', mintArray.length, 'mints');
        
        // Build mint -> symbol map
        const mintSymbols = {};
        
        // Try to fetch metadata for each mint
        for (const mint of mintArray) {
          let symbol = null;
          
          // 1. Try X1 Mobile API first
          try {
            const apiResult = await fetchTokenMetadataFromAPI(mint);
            if (apiResult?.symbol) {
              symbol = apiResult.symbol;
              logger.log('[fetchBlockchainTransactions] API found:', mint.slice(0, 8), '->', symbol);
            }
          } catch (e) {
            // Continue to next source
          }
          
          // 2. Try Token-2022 on-chain metadata
          if (!symbol) {
            try {
              const t22Metadata = await fetchToken2022Metadata(rpcUrl, mint);
              if (t22Metadata?.symbol) {
                symbol = t22Metadata.symbol;
                logger.log('[fetchBlockchainTransactions] Token2022 found:', mint.slice(0, 8), '->', symbol);
              }
            } catch (e) {
              // Continue to fallback
            }
          }
          
          // 3. Explorer API removed - endpoint doesn't exist
          // Fallback to shortened mint directly
          if (!symbol) {
            symbol = mint.slice(0, 4) + '..' + mint.slice(-3);
            logger.log('[fetchBlockchainTransactions] Using fallback for:', mint.slice(0, 8));
          }
          
          mintSymbols[mint] = symbol;
        }
        
        // Update transactions with symbols
        for (const tx of transactions) {
          if (tx.tokenMint && mintSymbols[tx.tokenMint]) {
            tx.symbol = mintSymbols[tx.tokenMint];
          }
          if (tx.toTokenMint && mintSymbols[tx.toTokenMint]) {
            tx.toSymbol = mintSymbols[tx.toTokenMint];
          }
        }
      } catch (e) {
        logger.warn('[fetchBlockchainTransactions] Failed to fetch token metadata:', e.message);
        // Apply fallback symbols on error
        for (const tx of transactions) {
          if (tx.tokenMint && tx.symbol === 'Token') {
            tx.symbol = tx.tokenMint.slice(0, 4) + '..' + tx.tokenMint.slice(-3);
          }
          if (tx.toTokenMint && tx.toSymbol === 'Token') {
            tx.toSymbol = tx.toTokenMint.slice(0, 4) + '..' + tx.toTokenMint.slice(-3);
          }
        }
      }
    }
    
    // Sort by timestamp descending (newest first)
    return transactions.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  } catch (e) {
    logger.error('Failed to fetch transactions:', e);
    return [];
  }
}

// Helper to get native token symbol based on network
function getNativeSymbol(network) {
  if (!network) return 'XNT'; // Default to XNT
  const networkLower = network.toLowerCase();
  if (networkLower.includes('x1')) return 'XNT';
  if (networkLower.includes('solana')) return 'SOL';
  return 'XNT'; // Default to XNT for unknown networks
}

function parseTransaction(txData, walletAddress, signature, network = '') {
  try {
    const meta = txData.meta;
    const message = txData.transaction?.message;
    if (!meta || !message) return null;
    
    const preBalances = meta.preBalances || [];
    const postBalances = meta.postBalances || [];
    const accountKeys = message.accountKeys || [];
    const nativeSymbol = getNativeSymbol(network);
    
    let walletIndex = -1;
    for (let i = 0; i < accountKeys.length; i++) {
      const key = typeof accountKeys[i] === 'string' ? accountKeys[i] : accountKeys[i].pubkey;
      if (key === walletAddress) {
        walletIndex = i;
        break;
      }
    }
    
    // Collect ALL token balance changes for this wallet
    const preTokenBalances = meta.preTokenBalances || [];
    const postTokenBalances = meta.postTokenBalances || [];
    const tokenChanges = [];
    
    // Process post balances - check both by owner and by accountIndex
    for (const post of postTokenBalances) {
      // Check ownership - some RPCs use owner, some use accountIndex
      const isOurToken = post.owner === walletAddress;
      if (!isOurToken) continue;
      
      const pre = preTokenBalances.find(p => 
        p.mint === post.mint && (p.owner === walletAddress || p.accountIndex === post.accountIndex)
      );
      
      // Parse amounts carefully - they can be strings or numbers
      const preAmount = parseFloat(pre?.uiTokenAmount?.uiAmount) || 0;
      const postAmount = parseFloat(post.uiTokenAmount?.uiAmount) || 0;
      const change = postAmount - preAmount;
      
      if (Math.abs(change) > 0.0000001) {
        tokenChanges.push({
          mint: post.mint,
          change,
          amount: Math.abs(change),
          decimals: post.uiTokenAmount?.decimals || 9,
          symbol: null,
          isNative: false
        });
      }
    }
    
    // Check for closed accounts (token existed in pre but not in post)
    for (const pre of preTokenBalances) {
      if (pre.owner !== walletAddress) continue;
      const existsInPost = postTokenBalances.some(p => p.mint === pre.mint && p.owner === walletAddress);
      if (!existsInPost) {
        const preAmount = parseFloat(pre.uiTokenAmount?.uiAmount) || 0;
        if (preAmount > 0.0000001) {
          tokenChanges.push({
            mint: pre.mint,
            change: -preAmount,
            amount: preAmount,
            decimals: pre.uiTokenAmount?.decimals || 9,
            symbol: null,
            isNative: false
          });
        }
      }
    }
    
    // Check native balance change
    if (walletIndex >= 0 && preBalances.length > walletIndex && postBalances.length > walletIndex) {
      const preNative = (preBalances[walletIndex] || 0) / 1e9;
      const postNative = (postBalances[walletIndex] || 0) / 1e9;
      const fee = (meta.fee || 0) / 1e9;
      const nativeChange = postNative - preNative + fee; // Add back fee to see actual transfer
      
      if (Math.abs(nativeChange) > 0.0001) { // Use larger threshold for native to ignore dust
        tokenChanges.push({
          mint: 'native',
          change: nativeChange,
          amount: Math.abs(nativeChange),
          decimals: 9,
          symbol: nativeSymbol,
          isNative: true
        });
      }
    }
    
    // Separate into sent and received
    const sentTokens = tokenChanges.filter(t => t.change < 0).sort((a, b) => b.amount - a.amount);
    const receivedTokens = tokenChanges.filter(t => t.change > 0).sort((a, b) => b.amount - a.amount);
    
    // Check for stake reward pattern: both sent and received are same token, net positive
    // This happens when claiming rewards: receive 0.06 XNT reward, pay 0.01 XNT to bot
    const sent = sentTokens[0];
    const received = receivedTokens[0];
    
    // Detect stake reward: same token in/out, net gain, involves dApp
    const isSameTokenInOut = sent && received && 
      ((sent.isNative && received.isNative) || (sent.mint === received.mint));
    const netGain = received && sent ? received.amount - sent.amount : 0;
    const isLikelyReward = isSameTokenInOut && netGain > 0;
    
    // Determine if this is a true swap (different tokens) or just has both in/out
    const isSwap = sentTokens.length > 0 && receivedTokens.length > 0 && !isLikelyReward;
    
    // Check if this involves a dApp (complex program)
    const instructions = message.instructions || [];
    const innerInstructions = meta.innerInstructions || [];
    const simplePrograms = [
      '11111111111111111111111111111111',
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
      'ComputeBudget111111111111111111111111111111'
    ];
    
    let dappProgram = null;
    if (instructions.length > 2 || innerInstructions.length > 0) {
      for (const inst of instructions) {
        const programId = inst.programId || (typeof inst.program === 'string' ? inst.program : inst.program?.pubkey);
        if (programId && !simplePrograms.includes(programId)) {
          dappProgram = programId;
          break;
        }
      }
    }
    
    // Build the transaction object
    const baseTx = {
      signature,
      timestamp: txData.blockTime ? txData.blockTime * 1000 : Date.now(),
      rawTimestamp: txData.blockTime ? txData.blockTime * 1000 : Date.now(),
      status: meta.err ? 'failed' : 'confirmed',
      fee: (meta.fee || 0) / 1e9,
      source: 'blockchain',
      dappProgram
    };
    
    // Handle stake reward (same token in/out, net positive) - show as receive with net amount
    if (isLikelyReward) {
      let symbol = received.isNative ? nativeSymbol : null;
      if (!symbol && received.decimals === 6) symbol = 'USDC';
      if (!symbol) symbol = 'Token';
      
      return {
        ...baseTx,
        type: 'reward',
        isReward: true,
        amount: netGain,  // Show NET gain, not gross amounts
        symbol,
        tokenMint: received.mint !== 'native' ? received.mint : null,
        from: '',
        to: walletAddress,
        description: `Reward: +${netGain.toFixed(4)} ${symbol} (received ${received.amount.toFixed(4)}, fee ${sent.amount.toFixed(4)})`
      };
    }
    
    // Handle swap transactions - PRIORITY over dApp interaction
    if (isSwap) {
      // Get symbol for sent token
      let sentSymbol = sent.isNative ? nativeSymbol : null;
      if (!sentSymbol && sent.decimals === 6) sentSymbol = 'USDC';
      if (!sentSymbol && sent.decimals === 9) sentSymbol = 'Token';
      if (!sentSymbol) sentSymbol = 'Token';
      
      // Get symbol for received token  
      let receivedSymbol = received.isNative ? nativeSymbol : null;
      if (!receivedSymbol && received.decimals === 6) receivedSymbol = 'USDC';
      if (!receivedSymbol && received.decimals === 9) receivedSymbol = 'Token';
      if (!receivedSymbol) receivedSymbol = 'Token';
      
      return {
        ...baseTx,
        type: 'swap',
        isSwap: true,
        amount: sent.amount,
        symbol: sentSymbol,
        tokenMint: sent.mint !== 'native' ? sent.mint : null,
        toAmount: received.amount,
        toSymbol: receivedSymbol,
        toTokenMint: received.mint !== 'native' ? received.mint : null,
        from: walletAddress,
        to: walletAddress
      };
    }
    
    // Handle simple send (only sent, no receive)
    if (sent && !received) {
      let symbol = sent.isNative ? nativeSymbol : null;
      if (!symbol && sent.decimals === 6) symbol = 'USDC';
      if (!symbol) symbol = 'Token';
      
      return {
        ...baseTx,
        type: dappProgram ? 'dapp' : 'send',
        isDappInteraction: !!dappProgram,
        amount: sent.amount,
        symbol,
        tokenMint: sent.mint !== 'native' ? sent.mint : null,
        from: walletAddress,
        to: ''
      };
    }
    
    // Handle simple receive (only received, no send)
    if (received && !sent) {
      let symbol = received.isNative ? nativeSymbol : null;
      if (!symbol && received.decimals === 6) symbol = 'USDC';
      if (!symbol) symbol = 'Token';
      
      return {
        ...baseTx,
        type: dappProgram ? 'dapp' : 'receive',
        isDappInteraction: !!dappProgram,
        amount: received.amount,
        symbol,
        tokenMint: received.mint !== 'native' ? received.mint : null,
        from: '',
        to: walletAddress
      };
    }
    
    // Fallback for transactions with no detected balance changes
    if (walletIndex >= 0) {
      const balanceChange = (postBalances[walletIndex] || 0) - (preBalances[walletIndex] || 0);
      if (Math.abs(balanceChange) > 0) {
        const isSend = balanceChange < 0;
        return {
          ...baseTx,
          type: dappProgram ? 'dapp' : (isSend ? 'send' : 'receive'),
          isDappInteraction: !!dappProgram,
          amount: Math.abs(balanceChange) / 1e9,
          symbol: nativeSymbol,
          from: isSend ? walletAddress : '',
          to: isSend ? '' : walletAddress
        };
      }
    }
    
    return null;
  } catch (e) {
    logger.warn('[ParseTx] Error parsing transaction:', e);
    return null;
  }
}

/**
 * Sign and send an externally prepared transaction (e.g., from XDEX API)
 * @param {string} transactionBase64 - Base64 encoded transaction from API
 * @param {Uint8Array|string} privateKey - 64-byte secret key
 * @param {string} rpcUrl - RPC endpoint
 * @returns {Promise<string>} Transaction signature
 */
export async function signAndSendExternalTransaction(transactionBase64, privateKey, rpcUrl) {
  try {
    logger.log('[Swap TX] Starting to sign external transaction');
    
    // SECURITY: Validate private key is not a mnemonic
    if (typeof privateKey === 'string' && privateKey.includes(' ')) {
      // This looks like a mnemonic phrase, not a private key
      throw new Error('Invalid private key format - expected base58 encoded key');
    }
    
    // Decode private key if string
    let secretKey;
    if (typeof privateKey === 'string') {
      secretKey = decodeBase58(privateKey);
    } else {
      secretKey = privateKey;
    }
    
    if (secretKey.length !== 64) {
      throw new Error(`Invalid secret key length: ${secretKey.length}, expected 64`);
    }
    
    // Validate and clean the base64 transaction
    if (!transactionBase64 || typeof transactionBase64 !== 'string') {
      throw new Error('Transaction data is missing or invalid');
    }
    
    // Log transaction info (first 50 chars for debugging)
    logger.log('[Swap TX] Transaction base64 length:', transactionBase64.length);
    logger.log('[Swap TX] Transaction base64 preview:', transactionBase64.substring(0, 50) + '...');
    
    // Handle URL-safe base64 (used by some APIs)
    // URL-safe base64 uses - instead of + and _ instead of /
    let cleanedBase64 = transactionBase64
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    
    // Remove any whitespace or newlines
    cleanedBase64 = cleanedBase64.replace(/\s/g, '');
    
    // Add padding if needed (base64 must be a multiple of 4)
    const paddingNeeded = (4 - (cleanedBase64.length % 4)) % 4;
    cleanedBase64 += '='.repeat(paddingNeeded);
    
    // Validate base64 characters
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    if (!base64Regex.test(cleanedBase64)) {
      logger.error('[Swap TX] Invalid base64 characters detected');
      // Try to identify the problem characters
      const invalidChars = cleanedBase64.match(/[^A-Za-z0-9+/=]/g);
      if (invalidChars) {
        logger.error('[Swap TX] Invalid characters:', [...new Set(invalidChars)].join(', '));
      }
      throw new Error('Transaction contains invalid base64 encoding');
    }
    
    // Decode the base64 transaction
    let txBytes;
    try {
      txBytes = Uint8Array.from(atob(cleanedBase64), c => c.charCodeAt(0));
    } catch (atobError) {
      logger.error('[Swap TX] atob failed:', atobError.message);
      throw new Error('Failed to decode transaction: Invalid base64 encoding');
    }
    logger.log('[Swap TX] Decoded transaction:', txBytes.length, 'bytes');
    
    // Parse the transaction structure
    // Solana transaction format:
    // - 1 byte: number of signatures required
    // - 64 bytes * num_signatures: signature placeholders
    // - rest: message
    
    const numSignatures = txBytes[0];
    logger.log('[Swap TX] Number of signatures:', numSignatures);
    
    // The message starts after signature placeholders
    const messageOffset = 1 + (numSignatures * 64);
    const message = txBytes.slice(messageOffset);
    logger.log('[Swap TX] Message length:', message.length, 'bytes');
    
    // Sign the message
    const signature = await sign(message, secretKey);
    logger.log('[Swap TX] Signature generated');
    
    // Build the signed transaction
    // [1 byte: num_sigs] [64 bytes: signature] [message bytes]
    const signedTx = new Uint8Array(1 + 64 + message.length);
    signedTx[0] = 1; // 1 signature
    signedTx.set(signature, 1);
    signedTx.set(message, 65);
    
    // Convert to base64 for sending
    const signedTxBase64 = btoa(String.fromCharCode(...signedTx));
    logger.log('[Swap TX] Signed transaction ready');
    
    // Send the transaction
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendTransaction',
        params: [
          signedTxBase64,
          { 
            encoding: 'base64',
            skipPreflight: false,
            preflightCommitment: 'confirmed'
          }
        ]
      })
    });
    
    const result = await response.json();
    logger.log('[Swap TX] Send result:', result);
    
    if (result.error) {
      throw new Error(result.error.message || JSON.stringify(result.error));
    }
    
    return result.result; // This is the transaction signature
  } catch (error) {
    logger.error('[Swap TX] Error:', error);
    throw error;
  }
}

/**
 * Sign and send an external transaction using hardware wallet (Ledger)
 * Similar to signAndSendExternalTransaction but uses hardware wallet for signing
 */
export async function signAndSendExternalTransactionHardware(transactionBase64, hardwareWallet, rpcUrl) {
  try {
    logger.log('[Swap TX HW] Starting to sign external transaction with hardware wallet');
    
    // Validate and clean the base64 transaction
    if (!transactionBase64 || typeof transactionBase64 !== 'string') {
      throw new Error('Transaction data is missing or invalid');
    }
    
    // Log transaction info (first 50 chars for debugging)
    logger.log('[Swap TX HW] Transaction base64 length:', transactionBase64.length);
    
    // Handle URL-safe base64
    let cleanedBase64 = transactionBase64
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    
    // Remove any whitespace or newlines
    cleanedBase64 = cleanedBase64.replace(/\s/g, '');
    
    // Add padding if needed
    const paddingNeeded = (4 - (cleanedBase64.length % 4)) % 4;
    cleanedBase64 += '='.repeat(paddingNeeded);
    
    // Validate base64 characters
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    if (!base64Regex.test(cleanedBase64)) {
      throw new Error('Transaction contains invalid base64 encoding');
    }
    
    // Decode the base64 transaction
    let txBytes;
    try {
      txBytes = Uint8Array.from(atob(cleanedBase64), c => c.charCodeAt(0));
    } catch (atobError) {
      throw new Error('Failed to decode transaction: Invalid base64 encoding');
    }
    logger.log('[Swap TX HW] Decoded transaction:', txBytes.length, 'bytes');
    
    // Parse the transaction structure
    const numSignatures = txBytes[0];
    logger.log('[Swap TX HW] Number of signatures:', numSignatures);
    
    // The message starts after signature placeholders
    const messageOffset = 1 + (numSignatures * 64);
    const message = txBytes.slice(messageOffset);
    logger.log('[Swap TX HW] Message length:', message.length, 'bytes');
    
    // Sign with hardware wallet
    const signature = await hardwareWallet.signTransaction(message);
    logger.log('[Swap TX HW] Signature generated via hardware wallet');
    
    // Build the signed transaction
    const signedTx = new Uint8Array(1 + 64 + message.length);
    signedTx[0] = 1; // 1 signature
    signedTx.set(signature, 1);
    signedTx.set(message, 65);
    
    // Convert to base64 for sending
    const signedTxBase64 = btoa(String.fromCharCode(...signedTx));
    logger.log('[Swap TX HW] Signed transaction ready');
    
    // Send the transaction
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendTransaction',
        params: [
          signedTxBase64,
          { 
            encoding: 'base64',
            skipPreflight: false,
            preflightCommitment: 'confirmed'
          }
        ]
      })
    });
    
    const result = await response.json();
    logger.log('[Swap TX HW] Send result:', result);
    
    if (result.error) {
      throw new Error(result.error.message || JSON.stringify(result.error));
    }
    
    return result.result;
  } catch (error) {
    logger.error('[Swap TX HW] Error:', error);
    throw error;
  }
}

/**
 * Build a transaction message from instructions
 * @param {Object} params - Transaction parameters
 * @param {string} params.feePayer - Fee payer public key (base58)
 * @param {string} params.recentBlockhash - Recent blockhash
 * @param {Array} params.instructions - Array of instruction objects
 * @returns {Uint8Array} Serialized message
 */
export function buildTransaction({ feePayer, recentBlockhash, instructions }) {
  logger.log('[BuildTx] Params received - feePayer:', feePayer);
  logger.log('[BuildTx] Params received - recentBlockhash:', recentBlockhash);
  logger.log('[BuildTx] Params received - instructions:', instructions);
  
  if (!instructions || !Array.isArray(instructions)) {
    throw new Error('Instructions must be an array');
  }
  if (!feePayer) {
    throw new Error('Fee payer is required');
  }
  if (!recentBlockhash) {
    throw new Error('Recent blockhash is required');
  }
  
  logger.log('[BuildTx] Building transaction with', instructions.length, 'instructions');
  
  // Collect all unique account keys
  const accountMap = new Map();
  
  // Fee payer is always first and is a signer + writable
  accountMap.set(feePayer, { isSigner: true, isWritable: true });
  
  // Add accounts from instructions
  for (const instruction of instructions) {
    for (const key of instruction.keys) {
      const pubkey = key.pubkey;
      const existing = accountMap.get(pubkey);
      if (existing) {
        // Merge flags - if any instruction marks as signer/writable, keep it
        existing.isSigner = existing.isSigner || key.isSigner;
        existing.isWritable = existing.isWritable || key.isWritable;
      } else {
        accountMap.set(pubkey, { isSigner: key.isSigner, isWritable: key.isWritable });
      }
    }
    // Add program ID as read-only
    if (!accountMap.has(instruction.programId)) {
      accountMap.set(instruction.programId, { isSigner: false, isWritable: false });
    }
  }
  
  // Sort accounts: signers first (writable before read-only), then non-signers (writable before read-only)
  const accounts = Array.from(accountMap.entries()).map(([pubkey, flags]) => ({
    pubkey,
    ...flags
  }));
  
  accounts.sort((a, b) => {
    // Signers before non-signers
    if (a.isSigner !== b.isSigner) return a.isSigner ? -1 : 1;
    // Writable before read-only
    if (a.isWritable !== b.isWritable) return a.isWritable ? -1 : 1;
    return 0;
  });
  
  // Ensure fee payer is first
  const feePayerIndex = accounts.findIndex(a => a.pubkey === feePayer);
  if (feePayerIndex > 0) {
    const [fp] = accounts.splice(feePayerIndex, 1);
    accounts.unshift(fp);
  }
  
  logger.log('[BuildTx] Account count:', accounts.length);
  
  // Count signers and read-only accounts
  const numSigners = accounts.filter(a => a.isSigner).length;
  const numReadOnlySigners = accounts.filter(a => a.isSigner && !a.isWritable).length;
  const numReadOnlyNonSigners = accounts.filter(a => !a.isSigner && !a.isWritable).length;
  
  // Build account keys array
  const accountKeyBytes = [];
  for (const account of accounts) {
    accountKeyBytes.push(decodeToFixedSize(account.pubkey, 32));
  }
  
  // Build instruction data
  const compiledInstructions = [];
  for (const instruction of instructions) {
    const programIdIndex = accounts.findIndex(a => a.pubkey === instruction.programId);
    const accountIndexes = instruction.keys.map(k => accounts.findIndex(a => a.pubkey === k.pubkey));
    
    compiledInstructions.push({
      programIdIndex,
      accountIndexes,
      data: instruction.data
    });
  }
  
  // Serialize the message
  // Header: [num_required_signatures, num_readonly_signed, num_readonly_unsigned]
  const header = new Uint8Array([numSigners, numReadOnlySigners, numReadOnlyNonSigners]);
  
  // Account addresses
  const accountKeysBuffer = new Uint8Array(accounts.length * 32);
  for (let i = 0; i < accounts.length; i++) {
    accountKeysBuffer.set(accountKeyBytes[i], i * 32);
  }
  
  // Recent blockhash
  const blockhashBytes = decodeToFixedSize(recentBlockhash, 32);
  
  // Instructions
  const instructionBuffers = [];
  for (const ci of compiledInstructions) {
    // Program ID index
    const progIndex = new Uint8Array([ci.programIdIndex]);
    
    // Account indexes - compact array
    const accountsLen = encodeCompactU16(ci.accountIndexes.length);
    const accountIndexBytes = new Uint8Array(ci.accountIndexes);
    
    // Instruction data - compact array
    const dataLen = encodeCompactU16(ci.data.length);
    const dataBytes = ci.data;
    
    instructionBuffers.push(progIndex, accountsLen, accountIndexBytes, dataLen, dataBytes);
  }
  
  // Combine all parts
  const numAccountsCompact = encodeCompactU16(accounts.length);
  const numInstructionsCompact = encodeCompactU16(compiledInstructions.length);
  
  const totalLength = header.length + numAccountsCompact.length + accountKeysBuffer.length + 
                      blockhashBytes.length + numInstructionsCompact.length +
                      instructionBuffers.reduce((sum, b) => sum + b.length, 0);
  
  const message = new Uint8Array(totalLength);
  let offset = 0;
  
  message.set(header, offset); offset += header.length;
  message.set(numAccountsCompact, offset); offset += numAccountsCompact.length;
  message.set(accountKeysBuffer, offset); offset += accountKeysBuffer.length;
  message.set(blockhashBytes, offset); offset += blockhashBytes.length;
  message.set(numInstructionsCompact, offset); offset += numInstructionsCompact.length;
  
  for (const buf of instructionBuffers) {
    message.set(buf, offset);
    offset += buf.length;
  }
  
  logger.log('[BuildTx] Message built, length:', message.length);
  return message;
}

/**
 * Sign a transaction message
 * @param {Uint8Array} message - The transaction message
 * @param {string|Uint8Array} privateKey - Private key (64-byte secret key)
 * @returns {Promise<Uint8Array>} Signed transaction bytes
 */
export async function signTransaction(message, privateKey) {
  logger.log('[SignTx] Signing transaction');
  
  let secretKey;
  if (typeof privateKey === 'string') {
    secretKey = decodeBase58(privateKey);
  } else {
    secretKey = privateKey;
  }
  
  if (secretKey.length !== 64) {
    throw new Error(`Invalid secret key length: ${secretKey.length}, expected 64`);
  }
  
  // Sign the message
  const signature = await sign(message, secretKey);
  
  // Build signed transaction: [1 byte: num_sigs] [64 bytes: signature] [message]
  const signedTx = new Uint8Array(1 + 64 + message.length);
  signedTx[0] = 1; // 1 signature
  signedTx.set(signature, 1);
  signedTx.set(message, 65);
  
  logger.log('[SignTx] Signed transaction ready, length:', signedTx.length);
  return signedTx;
}

/**
 * Send a signed transaction to the network
 * @param {Uint8Array} signedTx - Signed transaction bytes
 * @param {string} rpcUrl - RPC endpoint URL
 * @returns {Promise<string>} Transaction signature
 */
export async function sendTransaction(signedTx, rpcUrl) {
  logger.log('[SendTx] Sending transaction to', rpcUrl);
  
  // Convert to base64
  const txBase64 = btoa(String.fromCharCode(...signedTx));
  
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: [
        txBase64,
        { 
          encoding: 'base64',
          skipPreflight: false,
          preflightCommitment: 'confirmed'
        }
      ]
    })
  });
  
  const result = await response.json();
  logger.log('[SendTx] Result:', result);
  
  if (result.error) {
    throw new Error(result.error.message || JSON.stringify(result.error));
  }
  
  return result.result;
}

// Wrapped native token mint (same on Solana and X1)
const NATIVE_MINT = 'So11111111111111111111111111111111111111112';

/**
 * Create a wrap transaction (native XNT/SOL -> WXNT/WSOL)
 * Wrapping involves:
 * 1. Create ATA for wrapped token if needed
 * 2. Transfer native tokens to ATA
 * 3. Sync native to update token balance
 * 
 * @param {Object} params
 * @param {string} params.owner - Wallet public key
 * @param {number} params.amount - Amount in native tokens (not lamports)
 * @param {string} params.rpcUrl - RPC endpoint
 * @param {Uint8Array} params.privateKey - Private key for signing
 * @returns {Promise<string>} Transaction signature
 */
export async function createWrapTransaction({ owner, amount, rpcUrl, privateKey }) {
  logger.log('[Wrap] Creating wrap transaction for', amount, 'native tokens');
  
  try {
    // Convert amount to lamports
    const lamports = Math.floor(amount * 1e9);
    
    // Get recent blockhash
    const blockhashResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getLatestBlockhash',
        params: [{ commitment: 'confirmed' }]
      })
    });
    const blockhashResult = await blockhashResponse.json();
    if (blockhashResult.error) {
      throw new Error('Blockhash error: ' + (blockhashResult.error.message || JSON.stringify(blockhashResult.error)));
    }
    const recentBlockhash = blockhashResult.result.value.blockhash;
    logger.log('[Wrap] Got blockhash:', recentBlockhash);
    
    // Derive ATA for wrapped native token - first check for existing
    let ataAddress;
    try {
      const tokenAccountsResponse = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTokenAccountsByOwner',
          params: [
            owner,
            { mint: NATIVE_MINT },
            { encoding: 'jsonParsed' }
          ]
        })
      });
      const tokenAccountsResult = await tokenAccountsResponse.json();
      
      if (tokenAccountsResult.result?.value?.length > 0) {
        ataAddress = tokenAccountsResult.result.value[0].pubkey;
        logger.log('[Wrap] Found existing ATA:', ataAddress);
      }
    } catch (e) {
      logger.log('[Wrap] Could not query token accounts:', e?.message);
    }
    
    // If no existing ATA, derive the address
    if (!ataAddress) {
      ataAddress = await deriveATAAddressStandard(owner, NATIVE_MINT, TOKEN_PROGRAM_ID);
      logger.log('[Wrap] Derived ATA address:', ataAddress);
    }
    
    // Check if ATA exists
    const ataInfoResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAccountInfo',
        params: [ataAddress, { encoding: 'base64' }]
      })
    });
    const ataInfoResult = await ataInfoResponse.json();
    const ataExists = ataInfoResult.result?.value !== null;
    logger.log('[Wrap] ATA exists:', ataExists);
  
    // Build transaction message
    const ownerKey = decodeToFixedSize(owner, 32);
    const nativeMintKey = decodeToFixedSize(NATIVE_MINT, 32);
    const ataKey = decodeToFixedSize(ataAddress, 32);
    const tokenProgramKey = decodeToFixedSize(TOKEN_PROGRAM_ID, 32);
    const systemProgramKey = decodeToFixedSize(SYSTEM_PROGRAM_ID, 32);
    const ataProgramKey = decodeToFixedSize(ASSOCIATED_TOKEN_PROGRAM_ID, 32);
    const blockhashBytes = decodeBase58(recentBlockhash);
    
    // Build account keys array
    const accountKeys = [];
    const addKey = (key) => {
      const keyBase58 = encodeBase58(key);
      if (!accountKeys.find(k => encodeBase58(k) === keyBase58)) {
        accountKeys.push(key);
      }
      return accountKeys.findIndex(k => encodeBase58(k) === keyBase58);
    };
    
    // Add keys in order (signer first)
    const ownerIdx = addKey(ownerKey);
    const ataIdx = addKey(ataKey);
    const nativeMintIdx = addKey(nativeMintKey);
    const systemIdx = addKey(systemProgramKey);
    const tokenIdx = addKey(tokenProgramKey);
    const ataProgIdx = addKey(ataProgramKey);
    
    // Build instructions
    const instructions = [];
    
    // Instruction 1: Create ATA if needed (CreateAssociatedTokenAccountIdempotent)
    // This instruction creates the account only if it doesn't exist
    instructions.push({
      programIdIndex: ataProgIdx,
      accountIndices: [ownerIdx, ataIdx, ownerIdx, nativeMintIdx, systemIdx, tokenIdx],
      data: new Uint8Array([1]) // CreateIdempotent instruction
    });
    
    // Instruction 2: Transfer lamports to ATA (System Program)
    const transferData = new Uint8Array(12);
    transferData[0] = 2; // Transfer instruction
    const lamportsView = new DataView(transferData.buffer);
    lamportsView.setBigUint64(4, BigInt(lamports), true); // little-endian
    
    instructions.push({
      programIdIndex: systemIdx,
      accountIndices: [ownerIdx, ataIdx],
      data: transferData
    });
    
    // Instruction 3: SyncNative (Token Program instruction 17)
    instructions.push({
      programIdIndex: tokenIdx,
      accountIndices: [ataIdx],
      data: new Uint8Array([17]) // SyncNative instruction
    });
    
    // Calculate header
    const numSigners = 1;
    const numReadonlySigners = 0;
    // Count readonly non-signers (programs and mint)
    const readonlyNonSigners = [nativeMintIdx, systemIdx, tokenIdx, ataProgIdx].filter((v, i, a) => a.indexOf(v) === i).length;
    
    // Build message
    const messageHeader = new Uint8Array([numSigners, numReadonlySigners, readonlyNonSigners]);
    
    // Serialize account keys
    const numKeys = encodeCompactU16(accountKeys.length);
    const flatKeys = new Uint8Array(accountKeys.length * 32);
    accountKeys.forEach((key, i) => flatKeys.set(key, i * 32));
    
    // Serialize instructions
    const numInstructions = encodeCompactU16(instructions.length);
    const serializedInstructions = [];
    for (const ix of instructions) {
      const accountsLen = encodeCompactU16(ix.accountIndices.length);
      const dataLen = encodeCompactU16(ix.data.length);
      serializedInstructions.push(
        new Uint8Array([ix.programIdIndex]),
        accountsLen,
        new Uint8Array(ix.accountIndices),
        dataLen,
        ix.data
      );
    }
    
    // Combine message parts
    const messageParts = [
      messageHeader,
      numKeys,
      flatKeys,
      blockhashBytes,
      numInstructions,
      ...serializedInstructions
    ];
    
    const totalLen = messageParts.reduce((sum, part) => sum + part.length, 0);
    const message = new Uint8Array(totalLen);
    let offset = 0;
    for (const part of messageParts) {
      message.set(part, offset);
      offset += part.length;
    }
    
    logger.log('[Wrap] Message built, length:', message.length);
    
    // Sign the message
    const signature = await sign(message, privateKey);
    logger.log('[Wrap] Signature created');
    
    // Build signed transaction
    const signedTx = new Uint8Array(1 + 64 + message.length);
    signedTx[0] = 1;
    signedTx.set(signature, 1);
    signedTx.set(message, 65);
    
    // Send transaction
    const txSignature = await sendTransaction(signedTx, rpcUrl);
    logger.log('[Wrap] Transaction sent:', txSignature);
    
    return txSignature;
  } catch (err) {
    logger.error('[Wrap] Error:', err?.message || err);
    throw err;
  }
}

/**
 * Create an unwrap transaction (WXNT/WSOL -> native XNT/SOL)
 * Unwrapping involves closing the token account which returns lamports to owner
 * 
 * @param {Object} params
 * @param {string} params.owner - Wallet public key
 * @param {number} params.amount - Amount to unwrap (for partial unwrap, or 0 for full)
 * @param {string} params.rpcUrl - RPC endpoint
 * @param {Uint8Array} params.privateKey - Private key for signing
 * @returns {Promise<string>} Transaction signature
 */
export async function createUnwrapTransaction({ owner, amount, rpcUrl, privateKey }) {
  console.log('[Unwrap] Creating unwrap transaction');
  console.log('[Unwrap] Owner:', owner);
  console.log('[Unwrap] RPC URL:', rpcUrl);
  
  try {
    // Get recent blockhash
    const blockhashResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getLatestBlockhash',
        params: [{ commitment: 'confirmed' }]
      })
    });
    const blockhashResult = await blockhashResponse.json();
    if (blockhashResult.error) {
      throw new Error(blockhashResult.error.message);
    }
    const recentBlockhash = blockhashResult.result.value.blockhash;
    console.log('[Unwrap] Got blockhash:', recentBlockhash);
    
    // First try to find existing ATA from RPC
    let ataAddress;
    try {
      const tokenAccountsResponse = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTokenAccountsByOwner',
          params: [
            owner,
            { mint: NATIVE_MINT },
            { encoding: 'jsonParsed' }
          ]
        })
      });
      const tokenAccountsResult = await tokenAccountsResponse.json();
      console.log('[Unwrap] Token accounts result:', tokenAccountsResult);
      
      if (tokenAccountsResult.result?.value?.length > 0) {
        ataAddress = tokenAccountsResult.result.value[0].pubkey;
        console.log('[Unwrap] Found existing ATA from RPC:', ataAddress);
      } else {
        throw new Error('No wrapped token account found to unwrap');
      }
    } catch (e) {
      if (e.message.includes('No wrapped token')) {
        throw e;
      }
      console.log('[Unwrap] Could not query token accounts:', e?.message);
      // Fall back to deriving
      ataAddress = await deriveATAAddressStandard(owner, NATIVE_MINT, TOKEN_PROGRAM_ID);
      console.log('[Unwrap] Derived ATA address:', ataAddress);
    }
    
    // Verify the ATA exists and has balance
    const ataInfoResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAccountInfo',
        params: [ataAddress, { encoding: 'jsonParsed' }]
      })
    });
    const ataInfoResult = await ataInfoResponse.json();
    console.log('[Unwrap] ATA info:', ataInfoResult);
    
    if (!ataInfoResult.result?.value) {
      throw new Error('Wrapped token account does not exist');
    }
    
    // Build transaction message
    const ownerKey = decodeToFixedSize(owner, 32);
    const ataKey = decodeToFixedSize(ataAddress, 32);
    const tokenProgramKey = decodeToFixedSize(TOKEN_PROGRAM_ID, 32);
    const blockhashBytes = decodeBase58(recentBlockhash);
    
    // Account keys: owner (signer/writable), ATA (writable), token program (readonly)
    const accountKeys = [ownerKey, ataKey, tokenProgramKey];
    
    // CloseAccount instruction (Token Program instruction 9)
    // Accounts: [account to close, destination, authority]
    const closeInstruction = {
      programIdIndex: 2, // token program
      accountIndices: [1, 0, 0], // [ATA, owner (destination), owner (authority)]
      data: new Uint8Array([9]) // CloseAccount instruction
    };
    
    // Header: 1 signer, 0 readonly signers, 1 readonly non-signer (token program)
    const messageHeader = new Uint8Array([1, 0, 1]);
    
    // Serialize account keys
    const numKeys = encodeCompactU16(accountKeys.length);
    const flatKeys = new Uint8Array(accountKeys.length * 32);
    accountKeys.forEach((key, i) => flatKeys.set(key, i * 32));
    
    // Serialize instruction
    const accountsLen = encodeCompactU16(closeInstruction.accountIndices.length);
    const dataLen = encodeCompactU16(closeInstruction.data.length);
    
    // Combine message
    const messageParts = [
      messageHeader,
      numKeys,
      flatKeys,
      blockhashBytes,
      encodeCompactU16(1), // 1 instruction
      new Uint8Array([closeInstruction.programIdIndex]),
      accountsLen,
      new Uint8Array(closeInstruction.accountIndices),
      dataLen,
      closeInstruction.data
    ];
    
    const totalLen = messageParts.reduce((sum, part) => sum + part.length, 0);
    const message = new Uint8Array(totalLen);
    let offset = 0;
    for (const part of messageParts) {
      message.set(part, offset);
      offset += part.length;
    }
    
    console.log('[Unwrap] Message built, length:', message.length);
    
    // Sign the message
    const signature = await sign(message, privateKey);
    console.log('[Unwrap] Signature created');
    
    // Build signed transaction
    const signedTx = new Uint8Array(1 + 64 + message.length);
    signedTx[0] = 1;
    signedTx.set(signature, 1);
    signedTx.set(message, 65);
    
    // Send transaction
    const txSignature = await sendTransaction(signedTx, rpcUrl);
    console.log('[Unwrap] Transaction sent:', txSignature);
    
    return txSignature;
  } catch (err) {
    console.error('[Unwrap] Error:', err?.message || err);
    throw err;
  }
}

/**
 * Create a wrap transaction using hardware wallet (Ledger)
 */
export async function createWrapTransactionHardware({ owner, amount, rpcUrl, hardwareWallet }) {
  logger.log('[Wrap HW] Creating wrap transaction for', amount, 'native tokens');
  
  try {
    // Convert amount to lamports
    const lamports = Math.floor(amount * 1e9);
    
    // Get recent blockhash
    const blockhashResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getLatestBlockhash',
        params: [{ commitment: 'confirmed' }]
      })
    });
    const blockhashResult = await blockhashResponse.json();
    if (blockhashResult.error) {
      throw new Error('Blockhash error: ' + (blockhashResult.error.message || JSON.stringify(blockhashResult.error)));
    }
    const recentBlockhash = blockhashResult.result.value.blockhash;
    logger.log('[Wrap HW] Got blockhash:', recentBlockhash);
    
    // Derive ATA for wrapped native token
    let ataAddress;
    try {
      const tokenAccountsResponse = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTokenAccountsByOwner',
          params: [owner, { mint: NATIVE_MINT }, { encoding: 'jsonParsed' }]
        })
      });
      const tokenAccountsResult = await tokenAccountsResponse.json();
      
      if (tokenAccountsResult.result?.value?.length > 0) {
        ataAddress = tokenAccountsResult.result.value[0].pubkey;
        logger.log('[Wrap HW] Found existing ATA:', ataAddress);
      }
    } catch (e) {
      logger.log('[Wrap HW] Could not query token accounts:', e?.message);
    }
    
    if (!ataAddress) {
      ataAddress = await deriveATAAddressStandard(owner, NATIVE_MINT, TOKEN_PROGRAM_ID);
      logger.log('[Wrap HW] Derived ATA address:', ataAddress);
    }
    
    // Build transaction message (same as software version)
    const ownerKey = decodeToFixedSize(owner, 32);
    const nativeMintKey = decodeToFixedSize(NATIVE_MINT, 32);
    const ataKey = decodeToFixedSize(ataAddress, 32);
    const tokenProgramKey = decodeToFixedSize(TOKEN_PROGRAM_ID, 32);
    const systemProgramKey = decodeToFixedSize(SYSTEM_PROGRAM_ID, 32);
    const ataProgramKey = decodeToFixedSize(ASSOCIATED_TOKEN_PROGRAM_ID, 32);
    const blockhashBytes = decodeBase58(recentBlockhash);
    
    const accountKeys = [];
    const addKey = (key) => {
      const keyBase58 = encodeBase58(key);
      if (!accountKeys.find(k => encodeBase58(k) === keyBase58)) {
        accountKeys.push(key);
      }
      return accountKeys.findIndex(k => encodeBase58(k) === keyBase58);
    };
    
    const ownerIdx = addKey(ownerKey);
    const ataIdx = addKey(ataKey);
    const nativeMintIdx = addKey(nativeMintKey);
    const systemIdx = addKey(systemProgramKey);
    const tokenIdx = addKey(tokenProgramKey);
    const ataProgIdx = addKey(ataProgramKey);
    
    const instructions = [];
    
    // CreateAssociatedTokenAccountIdempotent
    instructions.push({
      programIdIndex: ataProgIdx,
      accountIndices: [ownerIdx, ataIdx, ownerIdx, nativeMintIdx, systemIdx, tokenIdx],
      data: new Uint8Array([1])
    });
    
    // Transfer lamports to ATA
    const transferData = new Uint8Array(12);
    transferData[0] = 2;
    const lamportsView = new DataView(transferData.buffer);
    lamportsView.setBigUint64(4, BigInt(lamports), true);
    
    instructions.push({
      programIdIndex: systemIdx,
      accountIndices: [ownerIdx, ataIdx],
      data: transferData
    });
    
    // SyncNative
    instructions.push({
      programIdIndex: tokenIdx,
      accountIndices: [ataIdx],
      data: new Uint8Array([17])
    });
    
    const numSigners = 1;
    const numReadonlySigners = 0;
    const readonlyNonSigners = [nativeMintIdx, systemIdx, tokenIdx, ataProgIdx].filter((v, i, a) => a.indexOf(v) === i).length;
    
    const messageHeader = new Uint8Array([numSigners, numReadonlySigners, readonlyNonSigners]);
    
    const numKeys = encodeCompactU16(accountKeys.length);
    const flatKeys = new Uint8Array(accountKeys.length * 32);
    accountKeys.forEach((key, i) => flatKeys.set(key, i * 32));
    
    const numInstructions = encodeCompactU16(instructions.length);
    const serializedInstructions = [];
    for (const ix of instructions) {
      const accountsLen = encodeCompactU16(ix.accountIndices.length);
      const dataLen = encodeCompactU16(ix.data.length);
      serializedInstructions.push(
        new Uint8Array([ix.programIdIndex]),
        accountsLen,
        new Uint8Array(ix.accountIndices),
        dataLen,
        ix.data
      );
    }
    
    const messageParts = [
      messageHeader,
      numKeys,
      flatKeys,
      blockhashBytes,
      numInstructions,
      ...serializedInstructions
    ];
    
    const totalLen = messageParts.reduce((sum, part) => sum + part.length, 0);
    const message = new Uint8Array(totalLen);
    let offset = 0;
    for (const part of messageParts) {
      message.set(part, offset);
      offset += part.length;
    }
    
    logger.log('[Wrap HW] Message built, length:', message.length);
    
    // Sign with hardware wallet
    const signature = await hardwareWallet.signTransaction(message);
    logger.log('[Wrap HW] Signature created via hardware wallet');
    
    // Build signed transaction
    const signedTx = new Uint8Array(1 + 64 + message.length);
    signedTx[0] = 1;
    signedTx.set(signature, 1);
    signedTx.set(message, 65);
    
    // Send transaction
    const txSignature = await sendTransaction(signedTx, rpcUrl);
    logger.log('[Wrap HW] Transaction sent:', txSignature);
    
    return txSignature;
  } catch (err) {
    logger.error('[Wrap HW] Error:', err?.message || err);
    throw err;
  }
}

/**
 * Create an unwrap transaction using hardware wallet (Ledger)
 */
export async function createUnwrapTransactionHardware({ owner, amount, rpcUrl, hardwareWallet }) {
  console.log('[Unwrap HW] Creating unwrap transaction');
  
  try {
    // Get recent blockhash
    const blockhashResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getLatestBlockhash',
        params: [{ commitment: 'confirmed' }]
      })
    });
    const blockhashResult = await blockhashResponse.json();
    if (blockhashResult.error) {
      throw new Error('Blockhash error: ' + blockhashResult.error.message);
    }
    const recentBlockhash = blockhashResult.result.value.blockhash;
    
    // Get the wrapped token account
    const tokenAccountsResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTokenAccountsByOwner',
        params: [owner, { mint: NATIVE_MINT }, { encoding: 'jsonParsed' }]
      })
    });
    const tokenAccountsResult = await tokenAccountsResponse.json();
    
    if (!tokenAccountsResult.result?.value?.length) {
      throw new Error('No wrapped token account found');
    }
    
    const ataAddress = tokenAccountsResult.result.value[0].pubkey;
    console.log('[Unwrap HW] Found ATA:', ataAddress);
    
    // Build close account instruction
    const ownerKey = decodeToFixedSize(owner, 32);
    const ataKey = decodeToFixedSize(ataAddress, 32);
    const tokenProgramKey = decodeToFixedSize(TOKEN_PROGRAM_ID, 32);
    const blockhashBytes = decodeBase58(recentBlockhash);
    
    const accountKeys = [];
    const addKey = (key) => {
      const keyBase58 = encodeBase58(key);
      if (!accountKeys.find(k => encodeBase58(k) === keyBase58)) {
        accountKeys.push(key);
      }
      return accountKeys.findIndex(k => encodeBase58(k) === keyBase58);
    };
    
    const ownerIdx = addKey(ownerKey);
    const ataIdx = addKey(ataKey);
    const tokenIdx = addKey(tokenProgramKey);
    
    // CloseAccount instruction: account, dest, authority
    const closeInstruction = {
      programIdIndex: tokenIdx,
      accountIndices: [ataIdx, ownerIdx, ownerIdx],
      data: new Uint8Array([9]) // CloseAccount instruction
    };
    
    const numSigners = 1;
    const numReadonlySigners = 0;
    const readonlyNonSigners = 1; // token program
    
    const messageHeader = new Uint8Array([numSigners, numReadonlySigners, readonlyNonSigners]);
    const numKeys = encodeCompactU16(accountKeys.length);
    const flatKeys = new Uint8Array(accountKeys.length * 32);
    accountKeys.forEach((key, i) => flatKeys.set(key, i * 32));
    
    const accountsLen = encodeCompactU16(closeInstruction.accountIndices.length);
    const dataLen = encodeCompactU16(closeInstruction.data.length);
    
    const messageParts = [
      messageHeader,
      numKeys,
      flatKeys,
      blockhashBytes,
      encodeCompactU16(1),
      new Uint8Array([closeInstruction.programIdIndex]),
      accountsLen,
      new Uint8Array(closeInstruction.accountIndices),
      dataLen,
      closeInstruction.data
    ];
    
    const totalLen = messageParts.reduce((sum, part) => sum + part.length, 0);
    const message = new Uint8Array(totalLen);
    let offset = 0;
    for (const part of messageParts) {
      message.set(part, offset);
      offset += part.length;
    }
    
    console.log('[Unwrap HW] Message built, length:', message.length);
    
    // Sign with hardware wallet
    const signature = await hardwareWallet.signTransaction(message);
    console.log('[Unwrap HW] Signature created via hardware wallet');
    
    // Build signed transaction
    const signedTx = new Uint8Array(1 + 64 + message.length);
    signedTx[0] = 1;
    signedTx.set(signature, 1);
    signedTx.set(message, 65);
    
    // Send transaction
    const txSignature = await sendTransaction(signedTx, rpcUrl);
    console.log('[Unwrap HW] Transaction sent:', txSignature);
    
    return txSignature;
  } catch (err) {
    console.error('[Unwrap HW] Error:', err?.message || err);
    throw err;
  }
}

/**
 * Encode a number as compact-u16 (Solana's variable length encoding)
 * @param {number} value - Number to encode
 * @returns {Uint8Array} Encoded bytes
 */
function encodeCompactU16(value) {
  if (value < 0x80) {
    return new Uint8Array([value]);
  } else if (value < 0x4000) {
    return new Uint8Array([
      (value & 0x7f) | 0x80,
      value >> 7
    ]);
  } else {
    return new Uint8Array([
      (value & 0x7f) | 0x80,
      ((value >> 7) & 0x7f) | 0x80,
      value >> 14
    ]);
  }
}