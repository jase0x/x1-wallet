// Stake Screen - X1 Stake Pool Integration with On-Chain Staking
// Updated with Ledger Hardware Wallet Support
import React, { useState, useEffect, useCallback, useRef } from 'react';
import X1Logo from './X1Logo';
import { NETWORKS, getTxExplorerUrl } from '@x1-wallet/core/services/networks';
import { decodeBase58, encodeBase58 } from '@x1-wallet/core/utils/base58';
import { logger, getUserFriendlyError, ErrorMessages } from '@x1-wallet/core';
import { hardwareWallet } from '../services/hardware';

// Constants
const LAMPORTS_PER_SOL = 1_000_000_000;
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

// X1 Stake Pool Program (X1's fork of SPL Stake Pool)
const STAKE_POOL_PROGRAM_ID = 'XPoo1Fx6KNgeAzFcq2dPTo95bWGUSj5KdPVqYj9CZux';
const STAKE_POOL_ADDRESS = 'X1SPaMUM1A8E1vKL8XQAB5rxKarJbqtWFFSNFs8f7Av';

// Sysvars and programs for WithdrawSol
const SYSVAR_CLOCK_PUBKEY = 'SysvarC1ock11111111111111111111111111111111';
const SYSVAR_STAKE_HISTORY_PUBKEY = 'SysvarStakeHistory1111111111111111111111111';
const STAKE_PROGRAM_ID = 'Stake11111111111111111111111111111111111111';

// Helper to convert base58 to Uint8Array (32 bytes)
function pubkeyToBytes(base58Str) {
  const decoded = decodeBase58(base58Str);
  if (decoded.length === 32) return decoded;
  const result = new Uint8Array(32);
  result.set(decoded, 32 - decoded.length);
  return result;
}

// Derive PDA - uses Solana's standard format
// Note: This is a simplified implementation. For production, use @solana/web3.js
async function findProgramAddress(seeds, programId) {
  const programIdBytes = pubkeyToBytes(programId);
  const PDA_MARKER = new TextEncoder().encode('ProgramDerivedAddress');
  
  for (let bump = 255; bump >= 0; bump--) {
    const seedsWithBump = [...seeds, new Uint8Array([bump])];
    
    // Calculate total length: seeds + programId + marker
    const totalSeedsLen = seedsWithBump.reduce((acc, seed) => acc + seed.length, 0);
    const buffer = new Uint8Array(totalSeedsLen + 32 + PDA_MARKER.length);
    
    let offset = 0;
    for (const seed of seedsWithBump) {
      buffer.set(seed, offset);
      offset += seed.length;
    }
    buffer.set(programIdBytes, offset);
    offset += 32;
    buffer.set(PDA_MARKER, offset);
    
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = new Uint8Array(hash);
    
    // Check if point is likely off the ed25519 curve
    // Ed25519 points have specific properties - if the y-coordinate when decoded
    // doesn't have a valid x², it's off curve
    // Simplified check: most PDAs work at high bumps
    const isLikelyOffCurve = isOffCurve(hashArray);
    
    if (isLikelyOffCurve) {
      const pubkey = encodeBase58(hashArray);
      logger.log('[PDA] Found at bump', bump, ':', pubkey);
      return { pubkey, bump };
    }
  }
  throw new Error('Could not find PDA');
}

// Check if a 32-byte array is off the ed25519 curve
// This uses the mathematical property that a valid ed25519 point's 
// y-coordinate must produce a valid x² when decoded
function isOffCurve(bytes) {
  // Ed25519 prime: p = 2^255 - 19
  const p = BigInt('57896044618658097711785492504343953926634992332820282019728792003956564819949');
  const d = BigInt('37095705934669439343138083508754565189542113879843219016388785533085940283555');
  
  // Extract y from bytes (little-endian, clear top bit)
  let y = BigInt(0);
  for (let i = 0; i < 32; i++) {
    y |= BigInt(bytes[i]) << BigInt(i * 8);
  }
  y &= (BigInt(1) << BigInt(255)) - BigInt(1); // Clear top bit
  
  if (y >= p) return true; // Invalid y - off curve
  
  // Calculate x² = (y² - 1) / (d * y² + 1) mod p
  const y2 = (y * y) % p;
  const num = (y2 - BigInt(1) + p) % p;
  const den = (d * y2 + BigInt(1)) % p;
  
  // Check if num/den is a quadratic residue (has a square root mod p)
  // Using Euler's criterion: a^((p-1)/2) ≡ 1 mod p iff a is QR
  const denInv = modPow(den, p - BigInt(2), p); // Fermat's little theorem
  const x2 = (num * denInv) % p;
  
  const exp = (p - BigInt(1)) / BigInt(2);
  const legendre = modPow(x2, exp, p);
  
  // If x² is not a quadratic residue, point is off curve
  return legendre !== BigInt(1) && legendre !== BigInt(0);
}

// Modular exponentiation: base^exp mod mod
function modPow(base, exp, mod) {
  let result = BigInt(1);
  base = base % mod;
  while (exp > 0) {
    if (exp % BigInt(2) === BigInt(1)) {
      result = (result * base) % mod;
    }
    exp = exp / BigInt(2);
    base = (base * base) % mod;
  }
  return result;
}

// Get Associated Token Address
async function getAssociatedTokenAddress(mint, owner, tokenProgramId = TOKEN_PROGRAM_ID) {
  const mintBytes = pubkeyToBytes(mint);
  const ownerBytes = pubkeyToBytes(owner);
  const programBytes = pubkeyToBytes(tokenProgramId);
  
  const { pubkey } = await findProgramAddress(
    [ownerBytes, programBytes, mintBytes],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return pubkey;
}

// Parse stake pool account with correct layout from X1 stake pool source
function parseStakePoolAccount(base64Data) {
  const data = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
  
  logger.log('[Stake] Raw pool data length:', data.length);
  
  if (data.length < 300) {
    throw new Error('Invalid stake pool data length');
  }
  
  const getPubkey = (offset) => {
    try {
      const bytes = data.slice(offset, offset + 32);
      return encodeBase58(bytes);
    } catch {
      return null;
    }
  };
  
  const dataView = new DataView(data.buffer);
  
  // Correct layout from X1 stake-pool-main/clients/js-legacy/src/layouts.ts:
  // 0: u8 version
  // 1: u8 accountType
  // 2: pubkey manager (32 bytes)
  // 34: pubkey staker (32 bytes)
  // 66: pubkey stakeDepositAuthority (32 bytes)
  // 98: u8 stakeWithdrawBumpSeed
  // 99: pubkey validatorList (32 bytes)
  // 131: pubkey reserveStake (32 bytes)
  // 163: pubkey poolMint (32 bytes)
  // 195: pubkey managerFeeAccount (32 bytes)
  // 227: pubkey tokenProgramId (32 bytes)
  // 259: u64 totalLamports
  // 267: u64 poolTokenSupply
  // 275: u64 lastUpdateEpoch
  
  const parsed = {
    version: data[0],
    accountType: data[1],
    manager: getPubkey(2),
    staker: getPubkey(34),
    stakeDepositAuthority: getPubkey(66),
    stakeWithdrawBumpSeed: data[98],
    validatorList: getPubkey(99),
    reserveStake: getPubkey(131),
    poolMint: getPubkey(163),
    managerFeeAccount: getPubkey(195),
    tokenProgramId: getPubkey(227),
    totalLamports: Number(dataView.getBigUint64(259, true)),
    poolTokenSupply: Number(dataView.getBigUint64(267, true)),
    lastUpdateEpoch: Number(dataView.getBigUint64(275, true)),
  };
  
  logger.log('[Stake] Parsed version:', parsed.version);
  logger.log('[Stake] Parsed accountType:', parsed.accountType);
  logger.log('[Stake] Parsed poolMint:', parsed.poolMint);
  logger.log('[Stake] Parsed tokenProgramId:', parsed.tokenProgramId);
  
  return parsed;
}

export default function StakeScreen({ wallet, onBack, onRefreshBalance }) {
  const [amount, setAmount] = useState('');
  const [unstakeAll, setUnstakeAll] = useState(false); // Track if user clicked ALL STAKED
  const [unstakeAllAmount, setUnstakeAllAmount] = useState(0); // Store exact pXNT amount to unstake
  const [loading, setLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState(''); // 'stake' or 'unstake'
  const [poolLoading, setPoolLoading] = useState(true);
  const [poolInfo, setPoolInfo] = useState(null);
  const [poolData, setPoolData] = useState(null); // Raw parsed pool data
  const [userStake, setUserStake] = useState({ stakedAmount: 0, poolTokenBalance: 0 });
  const [epochInfo, setEpochInfo] = useState(null);
  const [showPoolInfo, setShowPoolInfo] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [txSignature, setTxSignature] = useState('');
  const [localBalance, setLocalBalance] = useState(null); // Local balance state for immediate updates
  const [hwStatus, setHwStatus] = useState(''); // Hardware wallet status messages
  
  // Ref to prevent duplicate fetches
  const isFetchingRef = useRef(false);
  const lastFetchKeyRef = useRef(null);

  const network = wallet?.network || 'X1 Mainnet';
  const networkConfig = NETWORKS[network] || NETWORKS['X1 Mainnet'];
  const walletAddress = wallet?.wallet?.publicKey;
  const propBalance = wallet?.balance || 0;
  const balance = localBalance !== null ? localBalance : propBalance; // Use local balance if available
  const privateKey = wallet?.wallet?.privateKey;
  
  // Hardware wallet detection
  const isHardwareWallet = wallet?.wallet?.isHardware || wallet?.activeWallet?.isHardware || false;
  
  // Sync localBalance with propBalance when it changes externally
  useEffect(() => {
    if (localBalance === null && propBalance > 0) {
      setLocalBalance(propBalance);
    }
  }, [propBalance, localBalance]);
  
  const isX1Mainnet = network === 'X1 Mainnet';

  // RPC helper
  const rpcCall = useCallback(async (method, params = []) => {
    if (!networkConfig?.rpcUrl) throw new Error('No RPC URL');
    const response = await fetch(networkConfig.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data.result;
  }, [networkConfig?.rpcUrl]);

  // Refresh local balance from RPC
  const refreshLocalBalance = useCallback(async () => {
    const rpcUrl = networkConfig?.rpcUrl;
    if (!walletAddress || !rpcUrl) return;
    try {
      logger.log('[Stake] Refreshing local balance from:', rpcUrl);
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          jsonrpc: '2.0', 
          id: Date.now(), 
          method: 'getBalance', 
          params: [walletAddress, { commitment: 'confirmed' }] 
        })
      });
      const data = await response.json();
      if (data.result?.value !== undefined) {
        const bal = data.result.value / Math.pow(10, networkConfig.decimals || 9);
        logger.log('[Stake] Updated local balance:', bal);
        setLocalBalance(bal);
      }
    } catch (e) {
      logger.warn('[Stake] Failed to refresh local balance:', e);
    }
  }, [walletAddress, networkConfig?.rpcUrl, networkConfig?.decimals]);

  // Fetch stake pool info
  const fetchPoolInfo = useCallback(async () => {
    if (!isX1Mainnet) {
      setPoolLoading(false);
      return;
    }
    
    try {
      setPoolLoading(true);
      setError('');
      
      logger.log('[Stake] Fetching pool info...');
      
      const accountData = await rpcCall('getAccountInfo', [
        STAKE_POOL_ADDRESS,
        { encoding: 'base64', commitment: 'confirmed' }
      ]);
      
      if (!accountData?.value?.data?.[0]) {
        throw new Error('Stake pool not found');
      }
      
      const parsed = parseStakePoolAccount(accountData.value.data[0]);
      logger.log('[Stake] Parsed pool:', parsed);
      logger.log('[Stake] Pool mint:', parsed.poolMint);
      logger.log('[Stake] Reserve stake:', parsed.reserveStake);
      logger.log('[Stake] Manager fee account:', parsed.managerFeeAccount);
      logger.log('[Stake] Pool tokenProgramId:', parsed.tokenProgramId);
      setPoolData(parsed);
      
      // pXNT is pegged 1:1 with XNT (rewards are paid via XP, not compounding)
      const exchangeRate = 1;
      
      setPoolInfo({
        address: STAKE_POOL_ADDRESS,
        programId: STAKE_POOL_PROGRAM_ID,
        totalStaked: parsed.totalLamports / LAMPORTS_PER_SOL,
        poolTokenSupply: parsed.poolTokenSupply / LAMPORTS_PER_SOL,
        exchangeRate,
        apy: 8.0,
        poolMint: parsed.poolMint,
        reserveStake: parsed.reserveStake,
        managerFeeAccount: parsed.managerFeeAccount,
      });
      
      // Fetch user's pool token balance
      if (walletAddress && parsed.poolMint) {
        try {
          const tokenAccounts = await rpcCall('getTokenAccountsByOwner', [
            walletAddress,
            { mint: parsed.poolMint },
            { encoding: 'jsonParsed', commitment: 'confirmed' }
          ]);
          
          if (tokenAccounts?.value?.length > 0) {
            const poolTokenBalance = parseFloat(
              tokenAccounts.value[0].account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0
            );
            setUserStake({
              stakedAmount: poolTokenBalance * exchangeRate,
              poolTokenBalance,
              poolTokenAccount: tokenAccounts.value[0].pubkey,
            });
          }
        } catch (e) {
          logger.warn('[Stake] Could not fetch user stake:', e);
        }
      }
      
      // Fetch epoch info
      try {
        const epoch = await rpcCall('getEpochInfo', [{ commitment: 'confirmed' }]);
        if (epoch) {
          // Calculate time remaining in epoch
          // X1 uses ~400ms slots like Solana
          const slotsRemaining = epoch.slotsInEpoch - epoch.slotIndex;
          const secondsRemaining = Math.floor(slotsRemaining * 0.4);
          const hoursRemaining = Math.floor(secondsRemaining / 3600);
          const minutesRemaining = Math.floor((secondsRemaining % 3600) / 60);
          
          setEpochInfo({
            epoch: epoch.epoch,
            slotIndex: epoch.slotIndex,
            slotsInEpoch: epoch.slotsInEpoch,
            progress: ((epoch.slotIndex / epoch.slotsInEpoch) * 100).toFixed(1),
            timeRemaining: hoursRemaining > 0 
              ? `~${hoursRemaining}h ${minutesRemaining}m`
              : `~${minutesRemaining}m`,
          });
        }
      } catch (e) {
        logger.warn('[Stake] Could not fetch epoch info:', e);
      }
    } catch (err) {
      logger.error('[Stake] Failed to fetch pool:', err);
      setError('Failed to load stake pool: ' + err.message);
      setPoolInfo({
        address: STAKE_POOL_ADDRESS,
        programId: STAKE_POOL_PROGRAM_ID,
        totalStaked: 0,
        poolTokenSupply: 0,
        exchangeRate: 1,
        apy: 8.0,
      });
    } finally {
      setPoolLoading(false);
    }
  }, [isX1Mainnet, rpcCall, walletAddress]);
  
  // Only fetch pool info on initial mount and manual refresh
  useEffect(() => {
    let mounted = true;
    
    const doFetch = async () => {
      // Skip if already fetching or already fetched for this wallet
      const fetchKey = `${walletAddress}-${network}`;
      if (isFetchingRef.current) {
        logger.log('[Stake] Already fetching, skipping');
        return;
      }
      if (lastFetchKeyRef.current === fetchKey && poolInfo) {
        logger.log('[Stake] Already fetched for:', fetchKey);
        return;
      }
      
      if (mounted && isX1Mainnet && walletAddress && networkConfig?.rpcUrl) {
        isFetchingRef.current = true;
        lastFetchKeyRef.current = fetchKey;
        try {
          await fetchPoolInfo();
        } finally {
          isFetchingRef.current = false;
        }
      }
    };
    
    doFetch();
    
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isX1Mainnet, walletAddress]); // Only refetch when network or wallet actually changes

  // Build and send stake transaction
  const handleStake = async () => {
    logger.log('[Stake] ===== handleStake START =====');
    logger.log('[Stake] amount:', amount);
    logger.log('[Stake] balance:', balance);
    logger.log('[Stake] privateKey exists:', !!privateKey);
    logger.log('[Stake] isHardwareWallet:', isHardwareWallet);
    logger.log('[Stake] walletAddress:', walletAddress);
    logger.log('[Stake] poolData:', poolData);
    logger.log('[Stake] poolData?.poolMint:', poolData?.poolMint);
    
    if (!amount || parseFloat(amount) <= 0) {
      logger.log('[Stake] FAIL: Invalid amount');
      setError('Enter a valid amount');
      return;
    }
    
    const stakeAmount = parseFloat(amount);
    logger.log('[Stake] stakeAmount:', stakeAmount);
    
    if (stakeAmount > balance - 0.01) {
      logger.log('[Stake] FAIL: Insufficient balance');
      setError('Insufficient balance (reserve 0.01 XNT for fees)');
      return;
    }
    
    // Updated wallet check - allow hardware wallets without privateKey
    if (!walletAddress) {
      logger.log('[Stake] FAIL: No wallet address');
      setError('Wallet not available');
      return;
    }
    
    if (!isHardwareWallet && !privateKey) {
      logger.log('[Stake] FAIL: No private key for software wallet');
      setError('Wallet not available');
      return;
    }
    
    if (!poolData?.poolMint) {
      logger.log('[Stake] FAIL: No pool mint');
      setError('Pool data not loaded - please refresh');
      return;
    }
    
    logger.log('[Stake] All checks PASSED, starting transaction...');
    setTxSignature('');
    setHwStatus('');
    
    try {
      logger.log('[Stake] Building transaction for', stakeAmount, 'XNT');
      
      // Import transaction builder
      const { buildTransaction, signTransaction, sendTransaction } = await import('@x1-wallet/core/utils/transaction');
      logger.log('[Stake] Transaction utils imported');
      
      // Use the token program from pool data (correctly parsed)
      const poolTokenProgram = poolData.tokenProgramId;
      logger.log('[Stake] Using pool token program:', poolTokenProgram);
      
      // Try to find user's existing token account for the pool mint
      let userPoolTokenATA = null;
      let ataExists = false;
      
      try {
        logger.log('[Stake] Searching for existing token account...');
        const tokenAccounts = await rpcCall('getTokenAccountsByOwner', [
          walletAddress,
          { mint: poolData.poolMint },
          { encoding: 'jsonParsed', commitment: 'confirmed' }
        ]);
        logger.log('[Stake] Token accounts response:', tokenAccounts);
        
        if (tokenAccounts?.value?.length > 0) {
          userPoolTokenATA = tokenAccounts.value[0].pubkey;
          ataExists = true;
          logger.log('[Stake] Found existing ATA:', userPoolTokenATA);
        }
      } catch (err) {
        logger.log('[Stake] Error searching token accounts:', err);
      }
      
      // If no existing account found, derive the ATA address
      if (!userPoolTokenATA) {
        logger.log('[Stake] No existing ATA found, deriving address...');
        logger.log('[Stake] Deriving ATA for mint:', poolData.poolMint, 'owner:', walletAddress, 'tokenProgram:', poolTokenProgram);
        userPoolTokenATA = await getAssociatedTokenAddress(poolData.poolMint, walletAddress, poolTokenProgram);
        logger.log('[Stake] Derived ATA:', userPoolTokenATA);
      }
      
      logger.log('[Stake] Final ATA to use:', userPoolTokenATA);
      
      // Derive withdraw authority PDA
      logger.log('[Stake] Deriving withdraw authority...');
      const stakePoolBytes = pubkeyToBytes(STAKE_POOL_ADDRESS);
      logger.log('[Stake] stakePoolBytes length:', stakePoolBytes.length);
      const withdrawAuthority = await findProgramAddress(
        [stakePoolBytes, new TextEncoder().encode('withdraw')],
        STAKE_POOL_PROGRAM_ID
      );
      logger.log('[Stake] Withdraw authority:', withdrawAuthority.pubkey);
      
      // Get recent blockhash
      logger.log('[Stake] Getting blockhash...');
      const blockhashResult = await rpcCall('getLatestBlockhash', [{ commitment: 'confirmed' }]);
      logger.log('[Stake] Blockhash result:', blockhashResult);
      const blockhash = blockhashResult?.value?.blockhash;
      if (!blockhash) {
        throw new Error('Failed to get blockhash');
      }
      logger.log('[Stake] Blockhash:', blockhash);
      
      // Build DepositSol instruction
      // Instruction index 14 = DepositSol
      const lamports = BigInt(Math.floor(stakeAmount * LAMPORTS_PER_SOL));
      const instructionData = new Uint8Array(9);
      instructionData[0] = 14; // DepositSol discriminator
      const dataView = new DataView(instructionData.buffer);
      dataView.setBigUint64(1, lamports, true);
      
      // Account keys for DepositSol:
      // 0. [w] Stake pool
      // 1. [] Withdraw authority
      // 2. [w] Reserve stake account
      // 3. [s] Funding account (user wallet - signer)
      // 4. [w] User pool token account (ATA)
      // 5. [w] Manager fee account
      // 6. [w] Referral fee account (same as user ATA)
      // 7. [w] Pool token mint
      // 8. [] System program
      // 9. [] Token program
      
      const instruction = {
        programId: STAKE_POOL_PROGRAM_ID,
        keys: [
          { pubkey: STAKE_POOL_ADDRESS, isSigner: false, isWritable: true },
          { pubkey: withdrawAuthority.pubkey, isSigner: false, isWritable: false },
          { pubkey: poolData.reserveStake, isSigner: false, isWritable: true },
          { pubkey: walletAddress, isSigner: true, isWritable: true },
          { pubkey: userPoolTokenATA, isSigner: false, isWritable: true },
          { pubkey: poolData.managerFeeAccount, isSigner: false, isWritable: true },
          { pubkey: userPoolTokenATA, isSigner: false, isWritable: true }, // Referral = user
          { pubkey: poolData.poolMint, isSigner: false, isWritable: true },
          { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: poolTokenProgram, isSigner: false, isWritable: false },
        ],
        data: instructionData,
      };
      
      // ataExists was already determined above when searching for token accounts
      logger.log('[Stake] ATA exists (from search):', ataExists);
      
      const instructions = [];
      
      if (!ataExists) {
        logger.log('[Stake] Creating ATA instruction for token program:', poolTokenProgram);
        // Create Associated Token Account instruction
        // Use standard Create instruction (byte 0)
        logger.log('[Stake] ATA Create accounts:');
        logger.log('[Stake]   0. Payer:', walletAddress);
        logger.log('[Stake]   1. ATA:', userPoolTokenATA);
        logger.log('[Stake]   2. Owner:', walletAddress);
        logger.log('[Stake]   3. Mint:', poolData.poolMint);
        logger.log('[Stake]   4. System:', SYSTEM_PROGRAM_ID);
        logger.log('[Stake]   5. Token:', poolTokenProgram);
        
        const createATAInstruction = {
          programId: ASSOCIATED_TOKEN_PROGRAM_ID,
          keys: [
            { pubkey: walletAddress, isSigner: true, isWritable: true },      // Payer
            { pubkey: userPoolTokenATA, isSigner: false, isWritable: true },  // ATA to create
            { pubkey: walletAddress, isSigner: false, isWritable: false },    // Wallet owner
            { pubkey: poolData.poolMint, isSigner: false, isWritable: false },// Mint
            { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },// System program
            { pubkey: poolTokenProgram, isSigner: false, isWritable: false }, // Token program
          ],
          data: new Uint8Array([]), // Empty data = Create instruction
        };
        instructions.push(createATAInstruction);
        logger.log('[Stake] ATA instruction programId:', ASSOCIATED_TOKEN_PROGRAM_ID);
      }
      
      logger.log('[Stake] DepositSol accounts:');
      logger.log('[Stake]   0. Pool:', STAKE_POOL_ADDRESS);
      logger.log('[Stake]   1. Withdraw Auth:', withdrawAuthority.pubkey);
      logger.log('[Stake]   2. Reserve:', poolData.reserveStake);
      logger.log('[Stake]   3. Funder:', walletAddress);
      logger.log('[Stake]   4. User ATA:', userPoolTokenATA);
      logger.log('[Stake]   5. Fee Acct:', poolData.managerFeeAccount);
      logger.log('[Stake]   6. Referral:', userPoolTokenATA);
      logger.log('[Stake]   7. Mint:', poolData.poolMint);
      logger.log('[Stake]   8. System:', SYSTEM_PROGRAM_ID);
      logger.log('[Stake]   9. Token:', poolTokenProgram);
      
      instructions.push(instruction);
      
      logger.log('[Stake] Instructions array:', instructions);
      logger.log('[Stake] Instructions length:', instructions.length);
      logger.log('[Stake] Calling buildTransaction with:');
      logger.log('[Stake]   feePayer:', walletAddress);
      logger.log('[Stake]   blockhash:', blockhash);
      logger.log('[Stake]   instructions count:', instructions.length);
      
      // Build transaction
      const tx = await buildTransaction({
        feePayer: walletAddress,
        recentBlockhash: blockhash,
        instructions,
      });
      logger.log('[Stake] Transaction built, tx length:', tx?.length);
      
      let signature;
      
      // Hardware wallet signing path
      if (isHardwareWallet) {
        logger.log('[Stake] Using hardware wallet for signing');
        setHwStatus('Connecting to Ledger...');
        
        try {
          // Connect to Ledger if not ready
          if (!hardwareWallet.isReady()) {
            await hardwareWallet.connect('hid');
            await hardwareWallet.openApp();
          }
          
          setHwStatus('Please confirm on your Ledger...');
          
          // buildTransaction returns the message (Uint8Array)
          // signAndSendExternalTransactionHardware expects a base64-encoded transaction
          // with format: [numSignatures, ...signatures(64 bytes each), ...message]
          // Create unsigned transaction with signature placeholder
          const unsignedTx = new Uint8Array(1 + 64 + tx.length);
          unsignedTx[0] = 1; // 1 signature required
          // Leave bytes 1-64 as zeros (signature placeholder)
          unsignedTx.set(tx, 65); // message starts at byte 65
          
          // Convert to base64
          const txBase64 = btoa(String.fromCharCode(...unsignedTx));
          logger.log('[Stake] Transaction base64 length:', txBase64.length);
          
          // Import hardware signing function
          const { signAndSendExternalTransactionHardware } = await import('@x1-wallet/core/utils/transaction');
          
          // Sign and send with hardware wallet
          signature = await signAndSendExternalTransactionHardware(
            txBase64,
            hardwareWallet,
            networkConfig.rpcUrl
          );
          
          setHwStatus('');
        } catch (hwErr) {
          setHwStatus('');
          logger.error('[Stake] Hardware wallet error:', hwErr);
          
          // Provide user-friendly error messages
          if (hwErr.message?.includes('0x6a81') || hwErr.message?.includes('Solana app')) {
            throw new Error('Please open the Solana app on your Ledger');
          } else if (hwErr.message?.includes('denied') || hwErr.message?.includes('rejected')) {
            throw new Error('Transaction rejected on Ledger');
          } else if (hwErr.message?.includes('not connected') || hwErr.message?.includes('Could not connect')) {
            throw new Error('Ledger not connected. Please connect and try again.');
          }
          throw hwErr;
        }
      } else {
        // Software wallet signing path
        const signedTx = await signTransaction(tx, privateKey);
        
        // Send transaction
        logger.log('[Stake] Sending transaction...');
        signature = await sendTransaction(signedTx, networkConfig.rpcUrl);
      }
      
      logger.log('[Stake] Transaction sent:', signature);
      setTxSignature(signature);
      // Calculate approximate pXNT received
      const pXNTReceived = poolData?.exchangeRate ? (stakeAmount / poolData.exchangeRate).toFixed(4) : stakeAmount;
      
      setSuccess(`Staked ${stakeAmount} XNT → Received ~${pXNTReceived} pXNT`);
      setAmount('');
      
      // Record transaction in local history
      try {
        const { addTransaction } = await import('@x1-wallet/core/utils/transaction');
        addTransaction({
          signature,
          type: 'stake',
          amount: stakeAmount,
          symbol: 'XNT',
          from: walletAddress,
          to: STAKE_POOL_ADDRESS,
          timestamp: Date.now(),
          status: 'confirmed',
          network: 'X1 Mainnet',
          isToken: false,
          description: `Staked ${stakeAmount} XNT → ${pXNTReceived} pXNT`
        });
      } catch (e) {
        logger.warn('[Stake] Failed to record transaction:', e);
      }
      
      // Track XP for staking (fire and forget)
      try {
        const { trackStakeXP } = await import('@x1-wallet/core/services/xp');
        trackStakeXP({
          user: walletAddress,
          network: 'X1 Mainnet',
          transactionSignature: signature,
          amount: stakeAmount,
          stakePool: STAKE_POOL_ADDRESS,
          action: 'stake'
        }).catch(() => { /* XP tracking is non-critical */ });
      } catch (e) {
        // XP tracking is non-critical
      }
      
      // Refresh pool info and balance once after delay to ensure blockchain confirmation
      setTimeout(() => {
        fetchPoolInfo();
        refreshLocalBalance();
        if (onRefreshBalance) onRefreshBalance();
      }, 3000);
      
    } catch (err) {
      logger.error('[Stake] Transaction failed:', err);
      setHwStatus('');
      throw err; // Re-throw for button handler
    }
  };

  // Build and send unstake (WithdrawSol) transaction
  const handleUnstake = async () => {
    logger.log('[Unstake] ===== handleUnstake START =====');
    logger.log('[Unstake] isHardwareWallet:', isHardwareWallet);
    
    const unstakeAmount = parseFloat(amount);
    if (!amount || unstakeAmount <= 0) {
      setError('Enter a valid amount');
      return;
    }
    
    if (!userStake.poolTokenAccount || userStake.poolTokenBalance <= 0) {
      setError('No staked balance to withdraw');
      return;
    }
    
    // Convert XNT amount to pool tokens - use stored amount if unstakeAll
    const poolTokensToWithdraw = unstakeAll && unstakeAllAmount > 0
      ? unstakeAllAmount 
      : unstakeAmount / (poolInfo?.exchangeRate || 1);
    
    // Skip validation if unstakeAll (we're using stored exact balance)
    if (!unstakeAll && poolTokensToWithdraw > userStake.poolTokenBalance) {
      setError(`Insufficient staked balance. Max: ${(userStake.poolTokenBalance * (poolInfo?.exchangeRate || 1)).toFixed(4)} XNT`);
      return;
    }
    
    // Updated wallet check - allow hardware wallets without privateKey
    if (!walletAddress || !poolData) {
      setError('Wallet or pool data not loaded');
      return;
    }
    
    if (!isHardwareWallet && !privateKey) {
      setError('Wallet not available');
      return;
    }
    
    setTxSignature('');
    setHwStatus('');
    
    try {
      logger.log('[Unstake] Withdrawing', unstakeAmount, 'XNT (~', poolTokensToWithdraw, 'pool tokens)');
      
      const { buildTransaction, signTransaction, sendTransaction } = await import('@x1-wallet/core/utils/transaction');
      
      // Get withdraw authority PDA
      const withdrawAuthority = await findProgramAddress(
        [pubkeyToBytes(STAKE_POOL_ADDRESS), new TextEncoder().encode('withdraw')],
        STAKE_POOL_PROGRAM_ID
      );
      logger.log('[Unstake] Withdraw authority:', withdrawAuthority.pubkey);
      
      // Get blockhash
      const blockhashResult = await rpcCall('getLatestBlockhash', [{ commitment: 'confirmed' }]);
      const blockhash = blockhashResult?.value?.blockhash;
      if (!blockhash) throw new Error('Failed to get blockhash');
      
      const poolTokenProgram = poolData.tokenProgramId;
      
      // WithdrawSol instruction: index 16
      // Data: u8 instruction (16) + u64 poolTokens
      const poolTokensLamports = BigInt(Math.floor(poolTokensToWithdraw * LAMPORTS_PER_SOL));
      const instructionData = new Uint8Array(9);
      instructionData[0] = 16; // WithdrawSol instruction index
      const dataView = new DataView(instructionData.buffer);
      dataView.setBigUint64(1, poolTokensLamports, true);
      
      // WithdrawSol accounts:
      // 0. stakePool (writable)
      // 1. withdrawAuthority (read-only)
      // 2. sourceTransferAuthority (signer) - wallet
      // 3. sourcePoolAccount (writable) - user's pool token account
      // 4. reserveStake (writable)
      // 5. destinationSystemAccount (writable) - wallet (receives XNT)
      // 6. managerFeeAccount (writable)
      // 7. poolMint (writable)
      // 8. SYSVAR_CLOCK
      // 9. SYSVAR_STAKE_HISTORY
      // 10. Stake Program
      // 11. Token Program
      
      const withdrawSolInstruction = {
        programId: STAKE_POOL_PROGRAM_ID,
        keys: [
          { pubkey: STAKE_POOL_ADDRESS, isSigner: false, isWritable: true },
          { pubkey: withdrawAuthority.pubkey, isSigner: false, isWritable: false },
          { pubkey: walletAddress, isSigner: true, isWritable: false },
          { pubkey: userStake.poolTokenAccount, isSigner: false, isWritable: true },
          { pubkey: poolData.reserveStake, isSigner: false, isWritable: true },
          { pubkey: walletAddress, isSigner: false, isWritable: true },
          { pubkey: poolData.managerFeeAccount, isSigner: false, isWritable: true },
          { pubkey: poolData.poolMint, isSigner: false, isWritable: true },
          { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_STAKE_HISTORY_PUBKEY, isSigner: false, isWritable: false },
          { pubkey: STAKE_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: poolTokenProgram, isSigner: false, isWritable: false },
        ],
        data: instructionData,
      };
      
      logger.log('[Unstake] Building transaction...');
      const tx = await buildTransaction({
        feePayer: walletAddress,
        recentBlockhash: blockhash,
        instructions: [withdrawSolInstruction],
      });
      
      let signature;
      
      // Hardware wallet signing path
      if (isHardwareWallet) {
        logger.log('[Unstake] Using hardware wallet for signing');
        setHwStatus('Connecting to Ledger...');
        
        try {
          // Connect to Ledger if not ready
          if (!hardwareWallet.isReady()) {
            await hardwareWallet.connect('hid');
            await hardwareWallet.openApp();
          }
          
          setHwStatus('Please confirm on your Ledger...');
          
          // buildTransaction returns the message (Uint8Array)
          // signAndSendExternalTransactionHardware expects a base64-encoded transaction
          // with format: [numSignatures, ...signatures(64 bytes each), ...message]
          // Create unsigned transaction with signature placeholder
          const unsignedTx = new Uint8Array(1 + 64 + tx.length);
          unsignedTx[0] = 1; // 1 signature required
          // Leave bytes 1-64 as zeros (signature placeholder)
          unsignedTx.set(tx, 65); // message starts at byte 65
          
          // Convert to base64
          const txBase64 = btoa(String.fromCharCode(...unsignedTx));
          logger.log('[Unstake] Transaction base64 length:', txBase64.length);
          
          // Import hardware signing function
          const { signAndSendExternalTransactionHardware } = await import('@x1-wallet/core/utils/transaction');
          
          // Sign and send with hardware wallet
          signature = await signAndSendExternalTransactionHardware(
            txBase64,
            hardwareWallet,
            networkConfig.rpcUrl
          );
          
          setHwStatus('');
        } catch (hwErr) {
          setHwStatus('');
          logger.error('[Unstake] Hardware wallet error:', hwErr);
          
          // Provide user-friendly error messages
          if (hwErr.message?.includes('0x6a81') || hwErr.message?.includes('Solana app')) {
            throw new Error('Please open the Solana app on your Ledger');
          } else if (hwErr.message?.includes('denied') || hwErr.message?.includes('rejected')) {
            throw new Error('Transaction rejected on Ledger');
          } else if (hwErr.message?.includes('not connected') || hwErr.message?.includes('Could not connect')) {
            throw new Error('Ledger not connected. Please connect and try again.');
          }
          throw hwErr;
        }
      } else {
        // Software wallet signing path
        const signedTx = await signTransaction(tx, privateKey);
        
        logger.log('[Unstake] Sending transaction...');
        signature = await sendTransaction(signedTx, networkConfig.rpcUrl);
      }
      
      logger.log('[Unstake] Transaction sent:', signature);
      setTxSignature(signature);
      // Calculate pXNT burned
      const pXNTBurned = poolData?.exchangeRate ? (unstakeAmount / poolData.exchangeRate).toFixed(4) : unstakeAmount;
      
      setSuccess(`Unstaked ${unstakeAmount} XNT ← Burned ~${pXNTBurned} pXNT`);
      setAmount('');
      
      // Record transaction in local history
      try {
        const { addTransaction } = await import('@x1-wallet/core/utils/transaction');
        addTransaction({
          signature,
          type: 'unstake',
          amount: unstakeAmount,
          symbol: 'XNT',
          from: STAKE_POOL_ADDRESS,
          to: walletAddress,
          timestamp: Date.now(),
          status: 'confirmed',
          network: 'X1 Mainnet',
          isToken: false,
          description: `Unstaked ${unstakeAmount} XNT ← ${pXNTBurned} pXNT`
        });
      } catch (e) {
        logger.warn('[Unstake] Failed to record transaction:', e);
      }
      
      // Track XP for unstaking (fire and forget)
      try {
        const { trackStakeXP } = await import('@x1-wallet/core/services/xp');
        trackStakeXP({
          user: walletAddress,
          network: 'X1 Mainnet',
          transactionSignature: signature,
          amount: unstakeAmount,
          stakePool: STAKE_POOL_ADDRESS,
          action: 'unstake'
        }).catch(() => { /* XP tracking is non-critical */ });
      } catch (e) {
        // XP tracking is non-critical
      }
      
      // Refresh pool info and balance once after delay to ensure blockchain confirmation
      setTimeout(() => {
        fetchPoolInfo();
        refreshLocalBalance();
        if (onRefreshBalance) onRefreshBalance();
      }, 3000);
      
    } catch (err) {
      logger.error('[Unstake] Transaction failed:', err);
      setHwStatus('');
      throw err; // Re-throw for button handler
    }
  };

  const formatNum = (num, dec = 4) => {
    if (num === null || num === undefined || isNaN(num)) return '0.00';
    const decimals = Math.max(0, Math.min(20, Math.floor(dec) || 2));
    return parseFloat(num).toLocaleString(undefined, { 
      minimumFractionDigits: 2,
      maximumFractionDigits: decimals 
    });
  };

  // Not X1 Mainnet
  if (!isX1Mainnet) {
    return (
      <div className="screen stake-screen">
        <div className="page-header">
          <div className="header-left">
            <button className="back-btn" onClick={onBack}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
          <h2 className="header-title">Stake XNT</h2>
        </div>
        <div className="screen-content" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
          </div>
          <h3 style={{ margin: '0 0 8px', fontSize: 16, color: 'var(--text-primary)' }}>Staking Unavailable</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', margin: '0 0 24px' }}>
            Staking is only available on X1 Mainnet.
          </p>
          <button 
            className="btn-primary"
            onClick={() => onBack && onBack('network')}
            style={{ width: 'auto', padding: '12px 32px' }}
          >
            Switch to X1 Mainnet
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen stake-screen">
      {/* Header */}
      <div className="page-header">
        <div className="header-left">
          <button className="back-btn" onClick={onBack}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
        <h2 className="header-title">Stake XNT</h2>
        <div className="header-right">
          <button 
            className="header-btn"
            onClick={() => fetchPoolInfo()}
            disabled={poolLoading}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: poolLoading ? 'spin 1s linear infinite' : 'none' }}>
              <path d="M23 4v6h-6M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>
      </div>

      <div className="screen-content stake-simple-content">
        {poolLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 20px' }}>
            <div className="spinner" style={{ marginBottom: 16 }} />
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading stake pool...</span>
          </div>
        ) : (
          <div className="send-step-content send-amount-step">
            {/* Staked Balance Display - like Recipient in send flow */}
            <div className="stake-balance-display">
              <span className="stake-balance-label">Your Staked Balance</span>
              <div className="stake-balance-value">
                {formatNum(userStake.poolTokenBalance * (poolInfo?.exchangeRate || 1), 4)} XNT
              </div>
              <span className="stake-balance-sub">
                {formatNum(userStake.poolTokenBalance || 0, 2)} pXNT
              </span>
            </div>

            {/* Amount Input */}
            <div className="send-amount-section">
              <input
                type="text"
                inputMode="decimal"
                className="send-amount-input"
                placeholder="0"
                value={amount}
                onChange={e => {
                  setAmount(e.target.value.replace(/[^0-9.]/g, ''));
                  setUnstakeAll(false);
                  setUnstakeAllAmount(0);
                }}
                disabled={loading}
              />
              <div className="send-amount-token">
                <X1Logo size={24} />
                <span>XNT</span>
              </div>
            </div>

            {/* MAX Button */}
            <button 
              className="send-max-pill"
              onClick={() => {
                const max = Math.max(0, balance - 0.01);
                setAmount(max > 0 ? max.toFixed(6) : '');
                setUnstakeAll(false);
                setUnstakeAllAmount(0);
              }}
              type="button"
            >
              Max: {formatNum(balance)} XNT
            </button>

            {/* Hardware Wallet Status */}
            {hwStatus && (
              <div className="hw-status" style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '12px 16px',
                background: 'var(--bg-tertiary)',
                borderRadius: 8,
                marginBottom: 12,
                color: 'var(--x1-blue)'
              }}>
                <div className="spinner-small" />
                <span>{hwStatus}</span>
              </div>
            )}

            {/* Action Buttons - moved above messages */}
            <div className="send-confirm-actions stake-actions">
              <button 
                className="btn-primary send-deny-btn"
                onClick={async () => {
                  if (!amount || parseFloat(amount) <= 0) {
                  setError('Enter an amount');
                  return;
                }
                if (parseFloat(amount) > balance) {
                  setError('Insufficient balance');
                  return;
                }
                setLoading(true);
                setLoadingAction('stake');
                setError('');
                setSuccess('');
                try {
                  await handleStake();
                } catch (err) {
                  setError(err.message || 'Staking failed');
                } finally {
                  setLoading(false);
                  setLoadingAction('');
                }
              }}
              disabled={loading || !amount || parseFloat(amount) <= 0}
            >
              {loadingAction === 'stake' ? (
                <span className="btn-loading"><span className="spinner-small" /></span>
              ) : 'Stake'}
            </button>
            <button 
              className="btn-secondary send-approve-btn"
              onClick={async () => {
                if (!amount || parseFloat(amount) <= 0) {
                  setError('Enter an amount');
                  return;
                }
                const maxXntValue = userStake.poolTokenBalance * (poolInfo?.exchangeRate || 1);
                if (parseFloat(amount) > maxXntValue) {
                  setError('Exceeds staked amount');
                  return;
                }
                setLoading(true);
                setLoadingAction('unstake');
                setError('');
                setSuccess('');
                try {
                  await handleUnstake();
                } catch (err) {
                  setError(err.message || 'Unstaking failed');
                } finally {
                  setLoading(false);
                  setLoadingAction('');
                }
              }}
              disabled={loading || !amount || parseFloat(amount) <= 0 || userStake.poolTokenBalance <= 0}
            >
              {loadingAction === 'unstake' ? (
                <span className="btn-loading"><span className="spinner-small" /></span>
              ) : 'Unstake'}
            </button>
          </div>

            {/* Messages - moved below buttons */}
            {error && <div className="error-message">{error}</div>}
            {success && (
              <div className="stake-success">
                {success}
                {txSignature && (
                  <a 
                    href={getTxExplorerUrl(wallet.network, txSignature)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tx-link"
                  >
                    View Transaction →
                  </a>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}