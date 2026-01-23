// BIP-44 HD Wallet Derivation for Solana/X1
// Implements SLIP-10 Ed25519 derivation compatible with Phantom/Solflare

const ED25519_CURVE = 'ed25519 seed';
const HARDENED_OFFSET = 0x80000000;

// HMAC-SHA512 using Web Crypto API
async function hmacSha512(key, data) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, data);
  return new Uint8Array(signature);
}

// Convert string to Uint8Array
function stringToBytes(str) {
  return new TextEncoder().encode(str);
}

// Convert number to 4-byte big-endian Uint8Array
function numberToBytes(num) {
  const arr = new Uint8Array(4);
  arr[0] = (num >>> 24) & 0xff;
  arr[1] = (num >>> 16) & 0xff;
  arr[2] = (num >>> 8) & 0xff;
  arr[3] = num & 0xff;
  return arr;
}

// Concatenate multiple Uint8Arrays
function concat(...arrays) {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// BIP-39: Convert mnemonic to seed (512 bits)
export async function mnemonicToSeed(mnemonic, passphrase = '') {
  const mnemonicBytes = stringToBytes(mnemonic.normalize('NFKD'));
  const saltBytes = stringToBytes('mnemonic' + passphrase.normalize('NFKD'));
  
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    mnemonicBytes,
    'PBKDF2',
    false,
    ['deriveBits']
  );
  
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 2048,
      hash: 'SHA-512'
    },
    keyMaterial,
    512
  );
  
  return new Uint8Array(derivedBits);
}

// SLIP-10: Get master key from seed
async function getMasterKeyFromSeed(seed) {
  const I = await hmacSha512(stringToBytes(ED25519_CURVE), seed);
  const IL = I.slice(0, 32); // Private key
  const IR = I.slice(32); // Chain code
  return { key: IL, chainCode: IR };
}

// SLIP-10: Derive child key (hardened only for Ed25519)
async function deriveHardened(parentKey, parentChainCode, index) {
  // For Ed25519, only hardened derivation is supported
  const indexBuffer = numberToBytes(HARDENED_OFFSET + index);
  const data = concat(new Uint8Array([0]), parentKey, indexBuffer);
  
  const I = await hmacSha512(parentChainCode, data);
  const IL = I.slice(0, 32);
  const IR = I.slice(32);
  
  return { key: IL, chainCode: IR };
}

// Parse derivation path string (e.g., "m/44'/501'/0'/0'")
function parsePath(path) {
  const parts = path.split('/');
  const result = [];
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === 'm' || part === '') continue;
    
    const isHardened = part.endsWith("'") || part.endsWith('h');
    const index = parseInt(isHardened ? part.slice(0, -1) : part, 10);
    
    if (isNaN(index)) {
      throw new Error(`Invalid path component: ${part}`);
    }
    
    result.push({ index, hardened: isHardened });
  }
  
  return result;
}

// Derive key from path
export async function derivePath(path, seed) {
  const { key, chainCode } = await getMasterKeyFromSeed(seed);
  const segments = parsePath(path);
  
  let currentKey = key;
  let currentChainCode = chainCode;
  
  for (const segment of segments) {
    if (!segment.hardened) {
      throw new Error('Ed25519 only supports hardened derivation');
    }
    const result = await deriveHardened(currentKey, currentChainCode, segment.index);
    currentKey = result.key;
    currentChainCode = result.chainCode;
  }
  
  return currentKey;
}

// Ed25519 constants for key generation
const gf = (init) => {
  const r = new Float64Array(16);
  if (init) for (let i = 0; i < init.length; i++) r[i] = init[i];
  return r;
};

const gf0 = gf();
const gf1 = gf([1]);
const D = gf([0x78a3, 0x1359, 0x4dca, 0x75eb, 0xd8ab, 0x4141, 0x0a4d, 0x0070, 0xe898, 0x7779, 0x4079, 0x8cc7, 0xfe73, 0x2b6f, 0x6cee, 0x5203]);
const D2 = gf([0xf159, 0x26b2, 0x9b94, 0xebd6, 0xb156, 0x8283, 0x149a, 0x00e0, 0xd130, 0xeef3, 0x80f2, 0x198e, 0xfce7, 0x56df, 0xd9dc, 0x2406]);
const X = gf([0xd51a, 0x8f25, 0x2d60, 0xc956, 0xa7b2, 0x9525, 0xc760, 0x692c, 0xdc5c, 0xfdd6, 0xe231, 0xc0a4, 0x53fe, 0xcd6e, 0x36d3, 0x2169]);
const Y = gf([0x6658, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666]);

function car25519(o) {
  let c;
  for (let i = 0; i < 16; i++) {
    o[i] += 65536;
    c = Math.floor(o[i] / 65536);
    o[(i + 1) * (i < 15 ? 1 : 0)] += c - 1 + 37 * (c - 1) * (i === 15 ? 1 : 0);
    o[i] -= c * 65536;
  }
}

function sel25519(p, q, b) {
  let t, c = ~(b - 1);
  for (let i = 0; i < 16; i++) {
    t = c & (p[i] ^ q[i]);
    p[i] ^= t;
    q[i] ^= t;
  }
}

function pack25519(o, n) {
  let m = gf(), t = gf();
  for (let i = 0; i < 16; i++) t[i] = n[i];
  car25519(t); car25519(t); car25519(t);
  for (let j = 0; j < 2; j++) {
    m[0] = t[0] - 0xffed;
    for (let i = 1; i < 15; i++) {
      m[i] = t[i] - 0xffff - ((m[i - 1] >> 16) & 1);
      m[i - 1] &= 0xffff;
    }
    m[15] = t[15] - 0x7fff - ((m[14] >> 16) & 1);
    let b = (m[15] >> 16) & 1;
    m[14] &= 0xffff;
    sel25519(t, m, 1 - b);
  }
  for (let i = 0; i < 16; i++) {
    o[2 * i] = t[i] & 0xff;
    o[2 * i + 1] = t[i] >> 8;
  }
}

function par25519(a) {
  const d = new Uint8Array(32);
  pack25519(d, a);
  return d[0] & 1;
}

function A(o, a, b) { for (let i = 0; i < 16; i++) o[i] = a[i] + b[i]; }
function Z(o, a, b) { for (let i = 0; i < 16; i++) o[i] = a[i] - b[i]; }

function M(o, a, b) {
  let t0 = 0, t1 = 0, t2 = 0, t3 = 0, t4 = 0, t5 = 0, t6 = 0, t7 = 0,
      t8 = 0, t9 = 0, t10 = 0, t11 = 0, t12 = 0, t13 = 0, t14 = 0, t15 = 0,
      t16 = 0, t17 = 0, t18 = 0, t19 = 0, t20 = 0, t21 = 0, t22 = 0, t23 = 0,
      t24 = 0, t25 = 0, t26 = 0, t27 = 0, t28 = 0, t29 = 0, t30 = 0;
  const b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3], b4 = b[4], b5 = b[5],
        b6 = b[6], b7 = b[7], b8 = b[8], b9 = b[9], b10 = b[10], b11 = b[11],
        b12 = b[12], b13 = b[13], b14 = b[14], b15 = b[15];
  
  let v = a[0]; t0 += v * b0; t1 += v * b1; t2 += v * b2; t3 += v * b3; t4 += v * b4; t5 += v * b5; t6 += v * b6; t7 += v * b7; t8 += v * b8; t9 += v * b9; t10 += v * b10; t11 += v * b11; t12 += v * b12; t13 += v * b13; t14 += v * b14; t15 += v * b15;
  v = a[1]; t1 += v * b0; t2 += v * b1; t3 += v * b2; t4 += v * b3; t5 += v * b4; t6 += v * b5; t7 += v * b6; t8 += v * b7; t9 += v * b8; t10 += v * b9; t11 += v * b10; t12 += v * b11; t13 += v * b12; t14 += v * b13; t15 += v * b14; t16 += v * b15;
  v = a[2]; t2 += v * b0; t3 += v * b1; t4 += v * b2; t5 += v * b3; t6 += v * b4; t7 += v * b5; t8 += v * b6; t9 += v * b7; t10 += v * b8; t11 += v * b9; t12 += v * b10; t13 += v * b11; t14 += v * b12; t15 += v * b13; t16 += v * b14; t17 += v * b15;
  v = a[3]; t3 += v * b0; t4 += v * b1; t5 += v * b2; t6 += v * b3; t7 += v * b4; t8 += v * b5; t9 += v * b6; t10 += v * b7; t11 += v * b8; t12 += v * b9; t13 += v * b10; t14 += v * b11; t15 += v * b12; t16 += v * b13; t17 += v * b14; t18 += v * b15;
  v = a[4]; t4 += v * b0; t5 += v * b1; t6 += v * b2; t7 += v * b3; t8 += v * b4; t9 += v * b5; t10 += v * b6; t11 += v * b7; t12 += v * b8; t13 += v * b9; t14 += v * b10; t15 += v * b11; t16 += v * b12; t17 += v * b13; t18 += v * b14; t19 += v * b15;
  v = a[5]; t5 += v * b0; t6 += v * b1; t7 += v * b2; t8 += v * b3; t9 += v * b4; t10 += v * b5; t11 += v * b6; t12 += v * b7; t13 += v * b8; t14 += v * b9; t15 += v * b10; t16 += v * b11; t17 += v * b12; t18 += v * b13; t19 += v * b14; t20 += v * b15;
  v = a[6]; t6 += v * b0; t7 += v * b1; t8 += v * b2; t9 += v * b3; t10 += v * b4; t11 += v * b5; t12 += v * b6; t13 += v * b7; t14 += v * b8; t15 += v * b9; t16 += v * b10; t17 += v * b11; t18 += v * b12; t19 += v * b13; t20 += v * b14; t21 += v * b15;
  v = a[7]; t7 += v * b0; t8 += v * b1; t9 += v * b2; t10 += v * b3; t11 += v * b4; t12 += v * b5; t13 += v * b6; t14 += v * b7; t15 += v * b8; t16 += v * b9; t17 += v * b10; t18 += v * b11; t19 += v * b12; t20 += v * b13; t21 += v * b14; t22 += v * b15;
  v = a[8]; t8 += v * b0; t9 += v * b1; t10 += v * b2; t11 += v * b3; t12 += v * b4; t13 += v * b5; t14 += v * b6; t15 += v * b7; t16 += v * b8; t17 += v * b9; t18 += v * b10; t19 += v * b11; t20 += v * b12; t21 += v * b13; t22 += v * b14; t23 += v * b15;
  v = a[9]; t9 += v * b0; t10 += v * b1; t11 += v * b2; t12 += v * b3; t13 += v * b4; t14 += v * b5; t15 += v * b6; t16 += v * b7; t17 += v * b8; t18 += v * b9; t19 += v * b10; t20 += v * b11; t21 += v * b12; t22 += v * b13; t23 += v * b14; t24 += v * b15;
  v = a[10]; t10 += v * b0; t11 += v * b1; t12 += v * b2; t13 += v * b3; t14 += v * b4; t15 += v * b5; t16 += v * b6; t17 += v * b7; t18 += v * b8; t19 += v * b9; t20 += v * b10; t21 += v * b11; t22 += v * b12; t23 += v * b13; t24 += v * b14; t25 += v * b15;
  v = a[11]; t11 += v * b0; t12 += v * b1; t13 += v * b2; t14 += v * b3; t15 += v * b4; t16 += v * b5; t17 += v * b6; t18 += v * b7; t19 += v * b8; t20 += v * b9; t21 += v * b10; t22 += v * b11; t23 += v * b12; t24 += v * b13; t25 += v * b14; t26 += v * b15;
  v = a[12]; t12 += v * b0; t13 += v * b1; t14 += v * b2; t15 += v * b3; t16 += v * b4; t17 += v * b5; t18 += v * b6; t19 += v * b7; t20 += v * b8; t21 += v * b9; t22 += v * b10; t23 += v * b11; t24 += v * b12; t25 += v * b13; t26 += v * b14; t27 += v * b15;
  v = a[13]; t13 += v * b0; t14 += v * b1; t15 += v * b2; t16 += v * b3; t17 += v * b4; t18 += v * b5; t19 += v * b6; t20 += v * b7; t21 += v * b8; t22 += v * b9; t23 += v * b10; t24 += v * b11; t25 += v * b12; t26 += v * b13; t27 += v * b14; t28 += v * b15;
  v = a[14]; t14 += v * b0; t15 += v * b1; t16 += v * b2; t17 += v * b3; t18 += v * b4; t19 += v * b5; t20 += v * b6; t21 += v * b7; t22 += v * b8; t23 += v * b9; t24 += v * b10; t25 += v * b11; t26 += v * b12; t27 += v * b13; t28 += v * b14; t29 += v * b15;
  v = a[15]; t15 += v * b0; t16 += v * b1; t17 += v * b2; t18 += v * b3; t19 += v * b4; t20 += v * b5; t21 += v * b6; t22 += v * b7; t23 += v * b8; t24 += v * b9; t25 += v * b10; t26 += v * b11; t27 += v * b12; t28 += v * b13; t29 += v * b14; t30 += v * b15;

  t0 += 38 * t16; t1 += 38 * t17; t2 += 38 * t18; t3 += 38 * t19; t4 += 38 * t20;
  t5 += 38 * t21; t6 += 38 * t22; t7 += 38 * t23; t8 += 38 * t24; t9 += 38 * t25;
  t10 += 38 * t26; t11 += 38 * t27; t12 += 38 * t28; t13 += 38 * t29; t14 += 38 * t30;

  let c = 1;
  v = t0 + c + 65535; c = Math.floor(v / 65536); t0 = v - c * 65536;
  v = t1 + c + 65535; c = Math.floor(v / 65536); t1 = v - c * 65536;
  v = t2 + c + 65535; c = Math.floor(v / 65536); t2 = v - c * 65536;
  v = t3 + c + 65535; c = Math.floor(v / 65536); t3 = v - c * 65536;
  v = t4 + c + 65535; c = Math.floor(v / 65536); t4 = v - c * 65536;
  v = t5 + c + 65535; c = Math.floor(v / 65536); t5 = v - c * 65536;
  v = t6 + c + 65535; c = Math.floor(v / 65536); t6 = v - c * 65536;
  v = t7 + c + 65535; c = Math.floor(v / 65536); t7 = v - c * 65536;
  v = t8 + c + 65535; c = Math.floor(v / 65536); t8 = v - c * 65536;
  v = t9 + c + 65535; c = Math.floor(v / 65536); t9 = v - c * 65536;
  v = t10 + c + 65535; c = Math.floor(v / 65536); t10 = v - c * 65536;
  v = t11 + c + 65535; c = Math.floor(v / 65536); t11 = v - c * 65536;
  v = t12 + c + 65535; c = Math.floor(v / 65536); t12 = v - c * 65536;
  v = t13 + c + 65535; c = Math.floor(v / 65536); t13 = v - c * 65536;
  v = t14 + c + 65535; c = Math.floor(v / 65536); t14 = v - c * 65536;
  v = t15 + c + 65535; c = Math.floor(v / 65536); t15 = v - c * 65536;
  t0 += c - 1 + 37 * (c - 1);

  c = 1;
  v = t0 + c + 65535; c = Math.floor(v / 65536); t0 = v - c * 65536;
  v = t1 + c + 65535; c = Math.floor(v / 65536); t1 = v - c * 65536;
  v = t2 + c + 65535; c = Math.floor(v / 65536); t2 = v - c * 65536;
  v = t3 + c + 65535; c = Math.floor(v / 65536); t3 = v - c * 65536;
  v = t4 + c + 65535; c = Math.floor(v / 65536); t4 = v - c * 65536;
  v = t5 + c + 65535; c = Math.floor(v / 65536); t5 = v - c * 65536;
  v = t6 + c + 65535; c = Math.floor(v / 65536); t6 = v - c * 65536;
  v = t7 + c + 65535; c = Math.floor(v / 65536); t7 = v - c * 65536;
  v = t8 + c + 65535; c = Math.floor(v / 65536); t8 = v - c * 65536;
  v = t9 + c + 65535; c = Math.floor(v / 65536); t9 = v - c * 65536;
  v = t10 + c + 65535; c = Math.floor(v / 65536); t10 = v - c * 65536;
  v = t11 + c + 65535; c = Math.floor(v / 65536); t11 = v - c * 65536;
  v = t12 + c + 65535; c = Math.floor(v / 65536); t12 = v - c * 65536;
  v = t13 + c + 65535; c = Math.floor(v / 65536); t13 = v - c * 65536;
  v = t14 + c + 65535; c = Math.floor(v / 65536); t14 = v - c * 65536;
  v = t15 + c + 65535; c = Math.floor(v / 65536); t15 = v - c * 65536;
  t0 += c - 1 + 37 * (c - 1);

  o[0] = t0; o[1] = t1; o[2] = t2; o[3] = t3; o[4] = t4; o[5] = t5; o[6] = t6; o[7] = t7;
  o[8] = t8; o[9] = t9; o[10] = t10; o[11] = t11; o[12] = t12; o[13] = t13; o[14] = t14; o[15] = t15;
}

function S(o, a) { M(o, a, a); }

function inv25519(o, i) {
  const c = gf();
  for (let a = 0; a < 16; a++) c[a] = i[a];
  for (let a = 253; a >= 0; a--) {
    S(c, c);
    if (a !== 2 && a !== 4) M(c, c, i);
  }
  for (let a = 0; a < 16; a++) o[a] = c[a];
}

function set25519(r, a) { for (let i = 0; i < 16; i++) r[i] = a[i] | 0; }

function scalarmult(p, q, s) {
  set25519(p[0], gf0);
  set25519(p[1], gf1);
  set25519(p[2], gf1);
  set25519(p[3], gf0);
  for (let i = 255; i >= 0; --i) {
    const b = (s[(i / 8) | 0] >> (i & 7)) & 1;
    cswap(p, q, b);
    add(q, p);
    add(p, p);
    cswap(p, q, b);
  }
}

function scalarbase(p, s) {
  const q = [gf(), gf(), gf(), gf()];
  set25519(q[0], X);
  set25519(q[1], Y);
  set25519(q[2], gf1);
  M(q[3], X, Y);
  scalarmult(p, q, s);
}

function cswap(p, q, b) { for (let i = 0; i < 4; i++) sel25519(p[i], q[i], b); }

function add(p, q) {
  const a = gf(), b = gf(), c = gf(), d = gf(), e = gf(), f = gf(), g = gf(), h = gf(), t = gf();
  Z(a, p[1], p[0]); Z(t, q[1], q[0]); M(a, a, t);
  A(b, p[0], p[1]); A(t, q[0], q[1]); M(b, b, t);
  M(c, p[3], q[3]); M(c, c, D2);
  M(d, p[2], q[2]); A(d, d, d);
  Z(e, b, a); Z(f, d, c); A(g, d, c); A(h, b, a);
  M(p[0], e, f); M(p[1], h, g); M(p[2], g, f); M(p[3], e, h);
}

function pack(r, p) {
  const tx = gf(), ty = gf(), zi = gf();
  inv25519(zi, p[2]);
  M(tx, p[0], zi);
  M(ty, p[1], zi);
  pack25519(r, ty);
  r[31] ^= par25519(tx) << 7;
}

// Generate public key from private key (seed)
async function getPublicKey(privateKey) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-512', privateKey));
  d[0] &= 248;
  d[31] &= 127;
  d[31] |= 64;

  const p = [gf(), gf(), gf(), gf()];
  const pk = new Uint8Array(32);

  scalarbase(p, d);
  pack(pk, p);

  return pk;
}

// Main function: Convert mnemonic to keypair using BIP-44 derivation
// Can pass a path string like "m/44'/501'/0'/0'" or an account index number
// Default path for Solana: m/44'/501'/0'/0'
export async function mnemonicToKeypair(mnemonic, pathOrIndex = 0) {
  // Determine the derivation path
  let path;
  if (typeof pathOrIndex === 'number') {
    // Account index provided - use standard Solana path with this account index
    path = `m/44'/501'/${pathOrIndex}'/0'`;
  } else if (typeof pathOrIndex === 'string') {
    // Full path provided
    path = pathOrIndex;
  } else {
    path = "m/44'/501'/0'/0'";
  }
  
  // Step 1: Convert mnemonic to 512-bit seed (BIP-39)
  const seed = await mnemonicToSeed(mnemonic);
  
  // Step 2: Derive private key using SLIP-10 with the path
  const privateKey = await derivePath(path, seed);
  
  // Step 3: Generate public key from private key
  const publicKey = await getPublicKey(privateKey);
  
  // Step 4: Create 64-byte secret key (private key + public key)
  const secretKey = new Uint8Array(64);
  secretKey.set(privateKey);
  secretKey.set(publicKey, 32);
  
  return { publicKey, secretKey };
}

// Sign message with secret key
export async function sign(message, secretKey) {
  const privateKey = secretKey.slice(0, 32);
  const publicKey = secretKey.slice(32);
  
  const d = new Uint8Array(await crypto.subtle.digest('SHA-512', privateKey));
  d[0] &= 248;
  d[31] &= 127;
  d[31] |= 64;

  const sm = new Uint8Array(64 + message.length);
  sm.set(message, 64);

  const tmp = new Uint8Array(64 + message.length);
  tmp.set(d.subarray(32), 0);
  tmp.set(message, 32);
  const r = new Uint8Array(await crypto.subtle.digest('SHA-512', tmp.subarray(0, 32 + message.length)));
  
  // Reduce r
  const x = new Float64Array(64);
  for (let i = 0; i < 64; i++) x[i] = r[i];
  for (let i = 0; i < 64; i++) r[i] = 0;
  
  const L = [0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14,
             0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x10];
  let carry;
  for (let i = 63; i >= 32; --i) {
    carry = 0;
    for (let j = i - 32, k = i - 12; j < k; ++j) {
      x[j] += carry - 16 * x[i] * L[j - (i - 32)];
      carry = Math.floor((x[j] + 128) / 256);
      x[j] -= carry * 256;
    }
    x[i - 32 + (i - 12 - (i - 32))] += carry;
    x[i] = 0;
  }
  carry = 0;
  for (let j = 0; j < 32; j++) {
    x[j] += carry - (x[31] >> 4) * L[j];
    carry = x[j] >> 8;
    x[j] &= 255;
  }
  for (let j = 0; j < 32; j++) x[j] -= carry * L[j];
  for (let i = 0; i < 32; i++) {
    x[i + 1] += x[i] >> 8;
    r[i] = x[i] & 255;
  }

  const p = [gf(), gf(), gf(), gf()];
  scalarbase(p, r);
  pack(sm, p);

  sm.set(publicKey, 32);

  const h = new Uint8Array(await crypto.subtle.digest('SHA-512', sm));
  
  // Reduce h
  for (let i = 0; i < 64; i++) x[i] = h[i];
  for (let i = 0; i < 64; i++) h[i] = 0;
  for (let i = 63; i >= 32; --i) {
    carry = 0;
    for (let j = i - 32, k = i - 12; j < k; ++j) {
      x[j] += carry - 16 * x[i] * L[j - (i - 32)];
      carry = Math.floor((x[j] + 128) / 256);
      x[j] -= carry * 256;
    }
    x[i - 32 + (i - 12 - (i - 32))] += carry;
    x[i] = 0;
  }
  carry = 0;
  for (let j = 0; j < 32; j++) {
    x[j] += carry - (x[31] >> 4) * L[j];
    carry = x[j] >> 8;
    x[j] &= 255;
  }
  for (let j = 0; j < 32; j++) x[j] -= carry * L[j];
  for (let i = 0; i < 32; i++) {
    x[i + 1] += x[i] >> 8;
    h[i] = x[i] & 255;
  }

  for (let i = 0; i < 32; i++) x[i] = r[i];
  for (let i = 0; i < 32; i++) {
    for (let j = 0; j < 32; j++) {
      x[i + j] += h[i] * d[j];
    }
  }

  // Final modL
  for (let i = 63; i >= 32; --i) {
    carry = 0;
    for (let j = i - 32, k = i - 12; j < k; ++j) {
      x[j] += carry - 16 * x[i] * L[j - (i - 32)];
      carry = Math.floor((x[j] + 128) / 256);
      x[j] -= carry * 256;
    }
    x[i - 32 + (i - 12 - (i - 32))] += carry;
    x[i] = 0;
  }
  carry = 0;
  for (let j = 0; j < 32; j++) {
    x[j] += carry - (x[31] >> 4) * L[j];
    carry = x[j] >> 8;
    x[j] &= 255;
  }
  for (let j = 0; j < 32; j++) x[j] -= carry * L[j];
  for (let i = 0; i < 32; i++) {
    x[i + 1] += x[i] >> 8;
    sm[32 + i] = x[i] & 255;
  }

  return sm.subarray(0, 64);
}

// Derivation path constants
// Default path matching Phantom/Backpack/Ledger
export const SOLANA_PATH = "m/44'/501'/0'/0'";
export const X1_PATH = "m/44'/501'/0'/0'"; // Same as Solana for compatibility