// X1 Wallet Background Script
// Handles provider requests from dApps

// Enable side panel on extension icon click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});

// Connected sites storage
const CONNECTED_SITES_KEY = 'x1wallet_connected_sites';
const PENDING_REQUESTS_KEY = 'x1wallet_pending_requests';

// X1W-006: Session timeout constants (reduced for security)
const SESSION_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours
const SENSITIVE_OPS_REAUTH_MS = 30 * 60 * 1000; // 30 minutes for sensitive operations

// ============================================================================
// X1W-SEC-PATCH: Security enhancements
// ============================================================================

// Rate limiting per origin to prevent DoS/spam attacks
const ORIGIN_RATE_LIMITS = new Map(); // origin -> { count, resetTime }
const MAX_REQUESTS_PER_MINUTE = 30;
const MAX_PENDING_PER_ORIGIN = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

// Known phishing domains - update this list regularly
const KNOWN_PHISHING_DOMAINS = new Set([
  'phantom-wallet.com',
  'phantomwallet.io', 
  'solanawallet.com',
  'sollet-wallet.com',
  'phantom-app.com',
  'solflare-wallet.com',
  'x1wallet.com',
  'x1-wallet.com',
  'x1wallet.io',
  'x1-wallet.io'
]);

// Suspicious URL patterns that may indicate phishing
const SUSPICIOUS_PATTERNS = [
  /phantom.*wallet/i,
  /free.*airdrop/i,
  /claim.*token/i,
  /connect.*wallet.*verify/i
];

// ============================================================================
// End security constants
// ============================================================================

// Track connected popup/side panel ports for approval notifications
// Map port -> requestId that was displayed to that popup
const connectedPorts = new Map();

// Track last broadcast public key to avoid duplicate accountChanged events
let lastBroadcastPublicKey = null;

// Initialize lastBroadcastPublicKey from current wallet on startup
chrome.storage.local.get(['x1wallet_active', 'x1wallet_wallets'], (result) => {
  try {
    const activeId = result.x1wallet_active;
    let walletsData = result.x1wallet_wallets;
    
    // Skip if encrypted
    if (typeof walletsData === 'string' && walletsData.startsWith('X1W:')) {
      console.log('[Background] Wallet data encrypted, skipping init');
      return;
    }
    
    // Parse if needed
    if (typeof walletsData === 'string') {
      walletsData = JSON.parse(walletsData);
    }
    
    if (Array.isArray(walletsData) && activeId) {
      const activeWallet = walletsData.find(w => w.id === activeId);
      if (activeWallet && activeWallet.publicKey) {
        lastBroadcastPublicKey = activeWallet.publicKey;
        console.log('[Background] Initialized lastBroadcastPublicKey:', lastBroadcastPublicKey);
      }
    }
  } catch (e) {
    console.log('[Background] Could not init lastBroadcastPublicKey:', e.message);
  }
});

// Clear the badge helper
function clearBadge() {
  chrome.action.setBadgeText({ text: '' }).catch(() => {});
}

// Listen for port connections from popup/side panel
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'x1-wallet-popup') {
    console.log('[Background] Popup/side panel connected');
    
    // Clear badge - user has seen the notification by clicking the icon
    clearBadge();
    
    // Send oldest pending request if any (FIFO - first in, first out)
    const oldest = getOldestPendingRequest();
    let displayedRequestId = null;

    if (oldest) {
      displayedRequestId = oldest.id;

      // Reset timeout: user has opened the popup and may need to authenticate.
      // The original 30s timeout is too short when password entry is required.
      const entry = pendingRequests.get(oldest.id);
      if (entry && entry.timeoutId) {
        clearTimeout(entry.timeoutId);
        entry.timeoutId = setTimeout(() => {
          const e = getPendingRequestById(oldest.id);
          if (e) {
            console.log('[Background] Request timeout (extended) for:', oldest.id);
            e.callback({ error: 'Request timeout' });
            removePendingRequest(oldest.id);
            if (pendingRequests.size > 0) {
              chrome.action.setBadgeText({ text: pendingRequests.size.toString() });
            } else {
              clearBadge();
            }
          }
        }, 120000); // 2 minutes when popup is open (user may need to enter password)
        console.log('[Background] Extended timeout for request:', oldest.id);
      }

      port.postMessage({
        type: 'pending-request',
        request: oldest.request,
        requestId: oldest.id
      });
    }
    
    // Track which request this popup is handling
    connectedPorts.set(port, displayedRequestId);
    
    port.onDisconnect.addListener(() => {
      console.log('[Background] Popup/side panel disconnected');
      
      // Get the request ID this popup was displaying
      const handledRequestId = connectedPorts.get(port);
      connectedPorts.delete(port);
      
      // Always clear badge when popup closes
      clearBadge();
      
      // Only reject the request that THIS popup was displaying (if it still exists)
      // This prevents rejecting requests that arrived after the popup opened
      if (handledRequestId) {
        const entry = getPendingRequestById(handledRequestId);
        if (entry) {
          console.log('[Background] Popup closed without response, rejecting displayed request:', handledRequestId);
          entry.callback({ error: 'User rejected the request.' });
          removePendingRequest(handledRequestId);
        }
      }
      
      // If there are more pending requests, show badge
      if (pendingRequests.size > 0) {
        chrome.action.setBadgeText({ text: pendingRequests.size.toString() });
        chrome.action.setBadgeBackgroundColor({ color: '#FF6B00' });
      }
    });
  }
});

// Notify all connected ports about a new pending request
function notifyPendingRequest(requestId, request) {
  console.log('[Background] Notifying', connectedPorts.size, 'connected ports about pending request:', requestId);
  for (const [port, currentRequestId] of connectedPorts) {
    // Only notify ports that aren't already handling a request
    if (!currentRequestId) {
      try {
        port.postMessage({ type: 'pending-request', request, requestId });
        // Update the port's tracked request
        connectedPorts.set(port, requestId);
      } catch (e) {
        console.log('[Background] Failed to notify port:', e.message);
        connectedPorts.delete(port);
      }
    }
  }
}

// Track last active wallet to detect changes
let lastActiveWalletId = null;
let lastActiveAddressIndex = null;

// Listen for storage changes to detect wallet switches
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  
  console.log('[Background] Storage changed, keys:', Object.keys(changes));
  
  let shouldBroadcast = false;
  
  // Check if active wallet ID changed
  if (changes.x1wallet_active) {
    const newId = changes.x1wallet_active.newValue;
    const oldId = changes.x1wallet_active.oldValue;
    console.log('[Background] Active wallet ID changed:', oldId, '->', newId);
    shouldBroadcast = true;
  }
  
  // Check if wallets array changed (could be address index change)
  if (changes.x1wallet_wallets) {
    console.log('[Background] Wallets data changed');
    shouldBroadcast = true;
  }
  
  if (shouldBroadcast) {
    // Get the current active wallet and broadcast
    getActiveWallet().then(wallet => {
      if (wallet && wallet.publicKey) {
        console.log('[Background] Broadcasting wallet change:', wallet.publicKey);
        handleWalletChanged(wallet.publicKey);
      } else {
        console.log('[Background] No wallet found to broadcast');
      }
    }).catch(err => {
      console.error('[Background] Error getting wallet for broadcast:', err);
    });
  }
});

// Get connected sites
async function getConnectedSites() {
  const result = await chrome.storage.local.get(CONNECTED_SITES_KEY);
  return result[CONNECTED_SITES_KEY] || {};
}

// Save connected sites
async function saveConnectedSites(sites) {
  await chrome.storage.local.set({ [CONNECTED_SITES_KEY]: sites });
}

// X1W-006: Check if site is connected with session timeout validation
async function isSiteConnected(origin) {
  const sites = await getConnectedSites();
  const siteData = sites[origin];
  
  if (!siteData) return false;
  
  // Check session timeout
  if (siteData.connectedAt) {
    const sessionAge = Date.now() - siteData.connectedAt;
    if (sessionAge > SESSION_TIMEOUT_MS) {
      // Session expired - remove connection
      console.log('[Background] Session expired for:', origin);
      delete sites[origin];
      await saveConnectedSites(sites);
      return false;
    }
  }
  
  // X1W-SEC-PATCH: Re-check if domain has become a known phishing site since connection
  const phishingCheck = isPhishingDomain(origin);
  if (phishingCheck.isPhishing) {
    console.warn('[Background] Previously connected site now flagged as phishing:', origin, phishingCheck.reason);
    delete sites[origin];
    await saveConnectedSites(sites);
    return false;
  }
  
  return true;
}

// X1W-006: Check if sensitive operation requires re-authentication
// SECURITY FIX: Re-enabled - users must re-authenticate after 30 minutes of inactivity
async function requiresReauth(origin) {
  const sites = await getConnectedSites();
  const siteData = sites[origin];
  
  // First sensitive operation doesn't require reauth
  if (!siteData || !siteData.lastSensitiveOp) {
    return false;
  }
  
  const timeSinceLastOp = Date.now() - siteData.lastSensitiveOp;
  const needsReauth = timeSinceLastOp > SENSITIVE_OPS_REAUTH_MS;
  
  if (needsReauth) {
    console.log('[Background] Re-authentication required for:', origin,
                'Time since last op:', Math.round(timeSinceLastOp / 60000), 'minutes');
  }
  
  return needsReauth;
}

// X1W-006: Update last sensitive operation timestamp
async function updateLastSensitiveOp(origin) {
  const sites = await getConnectedSites();
  if (sites[origin]) {
    sites[origin].lastSensitiveOp = Date.now();
    await saveConnectedSites(sites);
  }
}

// X1W-006: Validate origin from Chrome's sender object (more secure than content script)
function validateOrigin(providedOrigin, sender) {
  // Use Chrome's sender.origin when available (more trustworthy)
  if (sender && sender.origin) {
    if (sender.origin !== providedOrigin) {
      console.warn('[Background] Origin mismatch:', providedOrigin, 'vs', sender.origin);
      return sender.origin; // Use Chrome's verified origin
    }
  }
  
  // Fall back to tab URL origin validation
  if (sender && sender.tab && sender.tab.url) {
    try {
      const tabOrigin = new URL(sender.tab.url).origin;
      if (tabOrigin !== providedOrigin) {
        console.warn('[Background] Tab URL origin mismatch');
        return tabOrigin;
      }
    } catch (e) {
      console.error('[Background] Failed to parse tab URL');
    }
  }
  
  return providedOrigin;
}

// Get active wallet from storage
async function getActiveWallet() {
  const result = await chrome.storage.local.get(['x1wallet_wallets', 'x1wallet_active']);
  
  // X1W-SEC: Safe JSON parsing with error handling
  let wallets = [];
  try {
    const rawWallets = JSON.parse(result.x1wallet_wallets || '[]');
    wallets = Array.isArray(rawWallets) ? rawWallets : [];
  } catch (e) {
    console.error('[Background] Failed to parse wallet data - may be corrupted');
    wallets = [];
  }
  
  const activeId = result.x1wallet_active;
  
  if (!activeId || wallets.length === 0) return null;
  
  const wallet = wallets.find(w => w.id === activeId);
  if (!wallet) return wallets[0];
  
  // Get active address from wallet
  const addresses = wallet.addresses || [];
  const activeAddressIndex = wallet.activeAddressIndex || 0;
  const activeAddress = addresses[activeAddressIndex] || addresses[0];
  
  return {
    ...wallet,
    publicKey: activeAddress?.publicKey || wallet.publicKey,
    privateKey: activeAddress?.privateKey || wallet.privateKey
  };
}

// Get current network
async function getCurrentNetwork() {
  const result = await chrome.storage.local.get('x1wallet_network');
  return result.x1wallet_network || 'X1 Testnet';
}

// Store pending requests in a Map for handling multiple concurrent requests
// X1W-SEC: Fixes race condition where multiple tabs requesting signatures could lose callbacks
const pendingRequests = new Map(); // key: requestId → { request, callback, timeoutId }

// Generate unique request ID
// X1W-SEC: Use cryptographically secure random for unpredictable request IDs
function generateRequestId() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

// Get the oldest pending request (first in, first served)
function getOldestPendingRequest() {
  if (pendingRequests.size === 0) return null;
  
  let oldest = null;
  let oldestTime = Infinity;
  
  for (const [id, entry] of pendingRequests) {
    if (entry.request.timestamp < oldestTime) {
      oldestTime = entry.request.timestamp;
      oldest = { id, ...entry };
    }
  }
  
  return oldest;
}

// Get pending request by ID
function getPendingRequestById(id) {
  return pendingRequests.get(id);
}

// Remove pending request and clear its timeout
function removePendingRequest(id) {
  const entry = pendingRequests.get(id);
  if (entry) {
    if (entry.timeoutId) clearTimeout(entry.timeoutId);
    pendingRequests.delete(id);
    console.log('[Background] Removed pending request:', id, 'Remaining:', pendingRequests.size);
    
    // If there are more pending requests, notify the popup to show the next one
    if (pendingRequests.size > 0) {
      const next = getOldestPendingRequest();
      if (next) {
        console.log('[Background] Pushing next pending request to popup:', next.id);
        for (const [port, currentRequestId] of connectedPorts) {
          // Update ports that were handling the removed request
          if (currentRequestId === id) {
            try {
              port.postMessage({ 
                type: 'pending-request', 
                request: next.request,
                requestId: next.id 
              });
              connectedPorts.set(port, next.id);
              console.log('[Background] Sent next request to popup');
            } catch (e) {
              console.log('[Background] Failed to send next request to port:', e.message);
              connectedPorts.delete(port);
            }
          }
        }
        // Update badge to show remaining count
        chrome.action.setBadgeText({ text: pendingRequests.size.toString() });
        chrome.action.setBadgeBackgroundColor({ color: '#FF6B00' });
      }
    } else {
      // Clear badge when no more requests
      clearBadge();
    }
  }
}

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle side panel open
  if (message.action === 'openSidePanel') {
    chrome.sidePanel.open({ windowId: sender.tab?.windowId });
    return;
  }
  
  // Handle network change from popup - broadcast to all connected sites
  if (message.type === 'network-changed') {
    handleNetworkChanged(message.network);
    sendResponse({ success: true });
    return;
  }
  
  // Handle wallet/account change from popup - broadcast to all connected sites
  if (message.type === 'wallet-changed' || message.type === 'account-changed') {
    handleWalletChanged(message.publicKey);
    sendResponse({ success: true });
    return;
  }
  
  // Handle wallet unlock - reset lastSensitiveOp for all connected sites
  // This allows signing immediately after password entry without re-auth
  if (message.type === 'wallet-unlocked') {
    console.log('[Background] Wallet unlocked - resetting lastSensitiveOp for all sites');
    getConnectedSites().then(sites => {
      const now = Date.now();
      Object.keys(sites).forEach(origin => {
        sites[origin].lastSensitiveOp = now;
      });
      return saveConnectedSites(sites);
    }).then(() => {
      console.log('[Background] Reset lastSensitiveOp for all connected sites');
      sendResponse({ success: true });
    }).catch(err => {
      console.error('[Background] Error resetting lastSensitiveOp:', err);
      sendResponse({ success: false, error: err.message });
    });
    return true; // Keep channel open for async response
  }
  
  // Handle provider requests from content script
  if (message.type === 'provider-request') {
    handleProviderRequest(message, sender).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true; // Keep channel open for async response
  }
  
  // Handle responses from popup
  if (message.type === 'provider-response') {
    const requestId = message.requestId;
    const entry = requestId ? getPendingRequestById(requestId) : getOldestPendingRequest();
    
    if (entry) {
      const id = requestId || entry.id;
      const payload = message.payload;
      const currentRequest = entry.request;
      const callback = entry.callback;
      
      // Clear badge since request is being handled
      clearBadge();
      
      // If this is a successful connection, save the connected site BEFORE resolving
      if (currentRequest && currentRequest.type === 'connect' && payload.result && !payload.error) {
        console.log('[Background] Saving connection for origin:', currentRequest.origin);
        // Save synchronously before resolving the promise
        getConnectedSites().then(sites => {
          console.log('[Background] Current sites before save:', Object.keys(sites));
          sites[currentRequest.origin] = {
            connectedAt: Date.now(),
            lastSensitiveOp: Date.now(),
            publicKey: payload.result.publicKey
          };
          return saveConnectedSites(sites);
        }).then(() => {
          console.log('[Background] Saved connected site:', currentRequest.origin);
          // Now resolve the promise
          callback(payload);
          removePendingRequest(id);
        }).catch(err => {
          console.error('[Background] Error saving site:', err);
          callback(payload);
          removePendingRequest(id);
        });
        return; // Don't fall through
      }
      
      // X1W-SEC: Update lastSensitiveOp for successful signing operations
      if (currentRequest && ['signTransaction', 'signAllTransactions', 'signAndSendTransaction', 'signMessage'].includes(currentRequest.type)) {
        if (payload.result && !payload.error) {
          updateLastSensitiveOp(currentRequest.origin).catch(console.error);
        }
      }
      
      callback(payload);
      removePendingRequest(id);
    }
    return;
  }
  
  // Handle get pending request from popup
  if (message.type === 'get-pending-request') {
    const oldest = getOldestPendingRequest();
    if (oldest) {
      sendResponse({ request: oldest.request, requestId: oldest.id });
    } else {
      sendResponse(null);
    }
    return;
  }
  
  // Handle approve-sign from popup - do the actual signing
  if (message.type === 'approve-sign') {
    handleApproveSign(message).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }
  
  // Handle approve-sign-message from popup
  if (message.type === 'approve-sign-message') {
    handleApproveSignMessage(message).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }
});

// Handle network change - broadcast to all connected tabs
async function handleNetworkChanged(network) {
  console.log('[Background] Network changed to:', network);
  
  const chain = networkToChain(network);
  const connectedSites = await getConnectedSites();
  const origins = Object.keys(connectedSites);
  
  if (origins.length === 0) {
    console.log('[Background] No connected sites to notify');
    return;
  }
  
  // Send to ALL tabs - content script/provider will handle it
  // We can't check URLs without tabs permission
  try {
    const tabs = await chrome.tabs.query({});
    
    for (const tab of tabs) {
      if (!tab.id || tab.id < 0) continue;
      
      // Send message to content script
      chrome.tabs.sendMessage(tab.id, {
        type: 'network-changed',
        target: 'x1-wallet-content',
        payload: { network, chain }
      }).catch(err => {
        // Tab might not have content script loaded - expected
      });
    }
  } catch (err) {
    console.error('[Background] Error broadcasting network change:', err);
  }
}

// Handle wallet/account change - broadcast to all connected sites
async function handleWalletChanged(publicKey, force = false) {
  console.log('[Background] handleWalletChanged called with:', publicKey);
  
  // Skip if public key hasn't actually changed (unless forced)
  if (!force && publicKey === lastBroadcastPublicKey) {
    console.log('[Background] Public key unchanged, skipping broadcast');
    return;
  }
  
  // Update tracking
  lastBroadcastPublicKey = publicKey;
  
  // Update all connected sites with new public key
  const sites = await getConnectedSites();
  const origins = Object.keys(sites);
  
  console.log('[Background] Connected sites to notify:', origins);
  
  // Update stored public key for all connected sites
  for (const origin of origins) {
    sites[origin].publicKey = publicKey;
  }
  await saveConnectedSites(sites);
  
  if (origins.length === 0) {
    console.log('[Background] No connected sites to notify of wallet change');
    return;
  }
  
  // Send to ALL tabs - content script/provider will check if connected
  // We can't check URLs without tabs permission, so broadcast to all
  try {
    const tabs = await chrome.tabs.query({});
    console.log('[Background] Broadcasting accountChanged to', tabs.length, 'tabs');
    
    for (const tab of tabs) {
      // Skip extension pages and chrome:// URLs
      if (!tab.id || tab.id < 0) continue;
      
      // Send message to content script - it will forward to provider
      // Provider already knows if it's connected
      chrome.tabs.sendMessage(tab.id, {
        type: 'accountChanged',
        target: 'x1-wallet-content',
        payload: { publicKey }
      }).then(() => {
        console.log('[Background] Sent accountChanged to tab:', tab.id);
      }).catch(err => {
        // Tab might not have content script loaded (chrome://, etc.)
        // This is expected - silently ignore
      });
    }
  } catch (err) {
    console.error('[Background] Error broadcasting wallet change:', err);
  }
}

// ============================================================================
// X1W-SEC-PATCH: Security helper functions
// ============================================================================

/**
 * Check rate limit for an origin
 * Prevents DoS attacks from malicious dApps
 */
function checkOriginRateLimit(origin) {
  const now = Date.now();
  let limits = ORIGIN_RATE_LIMITS.get(origin);
  
  if (!limits || now > limits.resetTime) {
    limits = { count: 0, resetTime: now + RATE_LIMIT_WINDOW_MS };
    ORIGIN_RATE_LIMITS.set(origin, limits);
  }
  
  limits.count++;
  
  if (limits.count > MAX_REQUESTS_PER_MINUTE) {
    console.warn('[Background] Rate limit exceeded for origin:', origin, 'Count:', limits.count);
    return false;
  }
  
  return true;
}

/**
 * Count pending requests for a specific origin
 * Prevents request queue flooding
 */
function countPendingForOrigin(origin) {
  let count = 0;
  for (const [, entry] of pendingRequests) {
    if (entry.request && entry.request.origin === origin) {
      count++;
    }
  }
  return count;
}

/**
 * Check if a domain is a known phishing site
 * @returns {{ isPhishing: boolean, reason?: string }}
 */
function isPhishingDomain(origin) {
  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    
    // Check against known phishing domains
    if (KNOWN_PHISHING_DOMAINS.has(hostname)) {
      return { isPhishing: true, reason: 'Known phishing domain' };
    }
    
    // Check for homograph attacks (non-ASCII characters in domain)
    if (/[^\x00-\x7F]/.test(hostname)) {
      return { isPhishing: true, reason: 'Non-ASCII characters in domain (possible homograph attack)' };
    }
    
    // Check suspicious URL patterns
    for (const pattern of SUSPICIOUS_PATTERNS) {
      if (pattern.test(origin)) {
        return { isPhishing: true, reason: 'Suspicious URL pattern', pattern: pattern.toString() };
      }
    }
    
    return { isPhishing: false };
  } catch (e) {
    return { isPhishing: true, reason: 'Invalid origin URL' };
  }
}

/**
 * Validate request parameters for known methods
 */
function validateRequestParams(method, params) {
  const MAX_TRANSACTION_SIZE = 1232; // Solana max transaction size
  const MAX_MESSAGE_SIZE = 65536;    // 64KB max for messages
  const MAX_TRANSACTIONS_BATCH = 10;
  
  // Validate transaction size
  if (params && params.transaction) {
    try {
      const decoded = atob(params.transaction);
      if (decoded.length > MAX_TRANSACTION_SIZE) {
        return { valid: false, error: 'Transaction exceeds maximum size' };
      }
    } catch (e) {
      return { valid: false, error: 'Invalid transaction encoding' };
    }
  }
  
  // Validate transactions batch
  if (params && params.transactions) {
    if (!Array.isArray(params.transactions)) {
      return { valid: false, error: 'transactions must be an array' };
    }
    if (params.transactions.length > MAX_TRANSACTIONS_BATCH) {
      return { valid: false, error: `Too many transactions (max ${MAX_TRANSACTIONS_BATCH})` };
    }
  }
  
  // Validate message size
  if (params && params.message) {
    try {
      const decoded = atob(params.message);
      if (decoded.length > MAX_MESSAGE_SIZE) {
        return { valid: false, error: 'Message exceeds maximum size' };
      }
    } catch (e) {
      // Message might be raw string
      if (params.message.length > MAX_MESSAGE_SIZE) {
        return { valid: false, error: 'Message exceeds maximum size' };
      }
    }
  }
  
  return { valid: true };
}

// Clean up stale rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [origin, limits] of ORIGIN_RATE_LIMITS) {
    if (now > limits.resetTime + RATE_LIMIT_WINDOW_MS) {
      ORIGIN_RATE_LIMITS.delete(origin);
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes

// ============================================================================
// End security helpers
// ============================================================================

// Handle provider requests
async function handleProviderRequest(message, sender) {
  const { method, params, favicon } = message;
  
  // X1W-006: Use secure origin validation
  const origin = validateOrigin(message.origin, sender);
  
  // X1W-SEC-PATCH: Check rate limits
  if (!checkOriginRateLimit(origin)) {
    throw new Error('Rate limit exceeded. Please wait before making more requests.');
  }
  
  // X1W-SEC-PATCH: Check for phishing domains
  const phishingCheck = isPhishingDomain(origin);
  if (phishingCheck.isPhishing) {
    console.error('[Background] BLOCKED phishing attempt:', origin, phishingCheck.reason);
    throw new Error('This site has been flagged as potentially dangerous.');
  }
  
  // X1W-SEC-PATCH: Validate request parameters
  const validation = validateRequestParams(method, params);
  if (!validation.valid) {
    console.warn('[Background] Invalid request from:', origin, validation.error);
    throw new Error(validation.error);
  }
  
  // X1W-SEC-PATCH: Limit pending requests per origin for signing operations
  if (['signTransaction', 'signAllTransactions', 'signAndSendTransaction', 'signMessage'].includes(method)) {
    const pendingCount = countPendingForOrigin(origin);
    if (pendingCount >= MAX_PENDING_PER_ORIGIN) {
      throw new Error('Too many pending requests. Please approve or reject existing requests first.');
    }
  }
  
  console.log('[Background] Provider request:', method, 'from:', origin);
  
  switch (method) {
    case 'connect':
      return handleConnect(origin, favicon, sender, params || {});
      
    case 'disconnect':
      return handleDisconnect(origin);
      
    case 'switchChain':
      return handleSwitchChain(params, origin);
      
    case 'signTransaction':
      return handleSignTransaction(params, origin, sender);
      
    case 'signAllTransactions':
      return handleSignAllTransactions(params, origin, sender);
      
    case 'signAndSendTransaction':
      return handleSignAndSendTransaction(params, origin, sender);
      
    case 'signMessage':
      return handleSignMessage(params, origin, sender);
      
    case 'getNetwork':
      return handleGetNetwork();
      
    case 'getConnectionStatus':
      return handleGetConnectionStatus(origin);
      
    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

// Handle connect request
async function handleConnect(origin, favicon, sender, params = {}) {
  console.log('[Background] handleConnect called:', origin, 'params:', JSON.stringify(params));
  
  // Check if already connected
  const connected = await isSiteConnected(origin);
  console.log('[Background] Site already connected?', connected);
  
  if (connected) {
    const wallet = await getActiveWallet();
    const network = await getCurrentNetwork();
    const chain = networkToChain(network);
    
    console.log('[Background] Wallet found?', !!wallet, wallet?.publicKey?.slice(0, 8));
    
    // If a specific chain is requested and different from current, we may need to switch
    if (params.chain && params.chain !== chain) {
      console.log('[Background] Chain requested:', params.chain, 'current:', chain);
      // For now, just return current - switchChain should be used to change
    }
    
    if (wallet) {
      console.log('[Background] Returning existing connection:', wallet.publicKey);
      return { result: { publicKey: wallet.publicKey, network, chain } };
    } else {
      // Wallet not loaded yet but site is connected - try to get public key from stored connection
      const sites = await getConnectedSites();
      const siteData = sites[origin];
      if (siteData && siteData.publicKey) {
        console.log('[Background] Returning stored connection (wallet not loaded):', siteData.publicKey);
        return { result: { publicKey: siteData.publicKey, network, chain } };
      }
      console.log('[Background] Site connected but no wallet/publicKey available');
    }
  }
  
  // If onlyIfTrusted is set and site is not connected, reject silently
  // This is used for "silent connect" / auto-reconnect attempts
  if (params.onlyIfTrusted) {
    console.log('[Background] Silent connect rejected - site not trusted:', origin);
    return { error: 'User rejected the request.' };
  }
  
  // Need user approval - open popup
  return new Promise((resolve) => {
    const requestId = generateRequestId();
    const request = {
      type: 'connect',
      origin,
      favicon,
      chain: params.chain, // Pass requested chain to popup
      timestamp: Date.now(),
      requestId
    };
    
    const timeoutId = setTimeout(() => {
      const entry = getPendingRequestById(requestId);
      if (entry) {
        entry.callback({ error: 'Request timeout' });
        removePendingRequest(requestId);
        if (pendingRequests.size > 0) {
          chrome.action.setBadgeText({ text: pendingRequests.size.toString() });
        } else {
          clearBadge();
        }
      }
    }, 30000);  // X1W-SEC: Reduced timeout for security
    
    pendingRequests.set(requestId, { request, callback: resolve, timeoutId });
    
    // Notify connected popups about the pending request
    notifyPendingRequest(requestId, request);
    
    // Open the extension popup dropdown for approval
    console.log('[Background] Opening extension popup for connect');
    chrome.action.openPopup().catch(err => {
      console.log('[Background] openPopup requires user gesture, showing badge');
      chrome.action.setBadgeText({ text: pendingRequests.size.toString() });
      chrome.action.setBadgeBackgroundColor({ color: '#FF6B00' });
    });
  });
}

// Convert network name to chain identifier
function networkToChain(network) {
  const map = {
    'X1 Mainnet': 'x1:mainnet',
    'X1 Testnet': 'x1:testnet',
    'Solana Mainnet': 'solana:mainnet',
    'Solana Devnet': 'solana:devnet',
    'Solana Testnet': 'solana:testnet'
  };
  return map[network] || 'x1:mainnet';
}

// Convert chain identifier to network name
function chainToNetwork(chain) {
  const map = {
    'x1:mainnet': 'X1 Mainnet',
    'x1:testnet': 'X1 Testnet',
    'solana:mainnet': 'Solana Mainnet',
    'solana:devnet': 'Solana Devnet',
    'solana:testnet': 'Solana Testnet'
  };
  return map[chain] || 'X1 Mainnet';
}

// Handle switch chain request
async function handleSwitchChain(params, origin) {
  const { chain } = params;
  
  if (!chain) {
    throw new Error('Chain parameter required');
  }
  
  const network = chainToNetwork(chain);
  
  // Save the new network preference
  await chrome.storage.local.set({ 'x1wallet_network': network });
  
  console.log('[Background] Switched to chain:', chain, 'network:', network);
  
  return { result: { chain, network } };
}

// Handle disconnect
async function handleDisconnect(origin) {
  const sites = await getConnectedSites();
  delete sites[origin];
  await saveConnectedSites(sites);
  return { result: true };
}

// Handle sign transaction
async function handleSignTransaction(params, origin, sender) {
  console.log('[Background] signTransaction from origin:', origin);
  const connected = await isSiteConnected(origin);
  console.log('[Background] Site connected:', connected);
  
  if (!connected) {
    // Log what sites ARE connected for debugging
    const sites = await getConnectedSites();
    console.log('[Background] Connected sites:', Object.keys(sites));
    throw new Error('Site not connected');
  }
  
  // X1W-SEC: Check if reauth is required for sensitive operations
  const needsReauth = await requiresReauth(origin);
  console.log('[Background] Requires reauth:', needsReauth);
  
  return new Promise((resolve) => {
    const requestId = generateRequestId();
    const request = {
      type: 'signTransaction',
      origin,
      transaction: params.transaction,
      timestamp: Date.now(),
      requiresReauth: needsReauth,
      requestId  // Include ID in request for popup to use
    };
    
    // Set timeout for this specific request
    const timeoutId = setTimeout(() => {
      const entry = getPendingRequestById(requestId);
      if (entry) {
        console.log('[Background] Request timeout:', requestId);
        entry.callback({ error: 'Request timeout' });
        removePendingRequest(requestId);
        // Update badge to show remaining count
        if (pendingRequests.size > 0) {
          chrome.action.setBadgeText({ text: pendingRequests.size.toString() });
        } else {
          clearBadge();
        }
      }
    }, 30000);  // X1W-SEC: Reduced timeout for security
    
    // Store in Map
    pendingRequests.set(requestId, { request, callback: resolve, timeoutId });
    console.log('[Background] Added pending request:', requestId, 'Total:', pendingRequests.size);
    
    // Notify connected popups about the pending request
    notifyPendingRequest(requestId, request);
    
    // Open the extension popup dropdown for approval
    console.log('[Background] Opening extension popup for signTransaction');
    chrome.action.openPopup().catch(err => {
      console.log('[Background] openPopup requires user gesture, showing badge');
      chrome.action.setBadgeText({ text: pendingRequests.size.toString() });
      chrome.action.setBadgeBackgroundColor({ color: '#FF6B00' });
    });
  });
}

// Handle sign all transactions
async function handleSignAllTransactions(params, origin, sender) {
  const connected = await isSiteConnected(origin);
  if (!connected) {
    throw new Error('Site not connected');
  }
  
  // X1W-SEC: Check if reauth is required for sensitive operations
  const needsReauth = await requiresReauth(origin);
  
  return new Promise((resolve) => {
    const requestId = generateRequestId();
    const request = {
      type: 'signAllTransactions',
      origin,
      transactions: params.transactions,
      timestamp: Date.now(),
      requiresReauth: needsReauth,
      requestId
    };
    
    const timeoutId = setTimeout(() => {
      const entry = getPendingRequestById(requestId);
      if (entry) {
        entry.callback({ error: 'Request timeout' });
        removePendingRequest(requestId);
        if (pendingRequests.size > 0) {
          chrome.action.setBadgeText({ text: pendingRequests.size.toString() });
        } else {
          clearBadge();
        }
      }
    }, 30000);  // X1W-SEC: Reduced timeout for security
    
    pendingRequests.set(requestId, { request, callback: resolve, timeoutId });
    
    // Notify connected popups about the pending request
    notifyPendingRequest(requestId, request);
    
    // Open the extension popup dropdown for approval
    console.log('[Background] Opening extension popup for signAllTransactions');
    chrome.action.openPopup().catch(err => {
      console.log('[Background] openPopup requires user gesture, showing badge');
      chrome.action.setBadgeText({ text: pendingRequests.size.toString() });
      chrome.action.setBadgeBackgroundColor({ color: '#FF6B00' });
    });
  });
}

// Handle sign and send transaction
async function handleSignAndSendTransaction(params, origin, sender) {
  const connected = await isSiteConnected(origin);
  if (!connected) {
    throw new Error('Site not connected');
  }
  
  // X1W-SEC: Check if reauth is required for sensitive operations
  const needsReauth = await requiresReauth(origin);
  
  return new Promise((resolve) => {
    const requestId = generateRequestId();
    const request = {
      type: 'signAndSendTransaction',
      origin,
      transaction: params.transaction,
      options: params.options,
      timestamp: Date.now(),
      requiresReauth: needsReauth,
      requestId
    };
    
    const timeoutId = setTimeout(() => {
      const entry = getPendingRequestById(requestId);
      if (entry) {
        entry.callback({ error: 'Request timeout' });
        removePendingRequest(requestId);
        if (pendingRequests.size > 0) {
          chrome.action.setBadgeText({ text: pendingRequests.size.toString() });
        } else {
          clearBadge();
        }
      }
    }, 30000);  // X1W-SEC: Reduced timeout for security
    
    pendingRequests.set(requestId, { request, callback: resolve, timeoutId });
    
    // Notify connected popups about the pending request
    notifyPendingRequest(requestId, request);
    
    // Open the extension popup dropdown for approval
    console.log('[Background] Opening extension popup for signAndSendTransaction');
    chrome.action.openPopup().catch(err => {
      console.log('[Background] openPopup requires user gesture, showing badge');
      chrome.action.setBadgeText({ text: pendingRequests.size.toString() });
      chrome.action.setBadgeBackgroundColor({ color: '#FF6B00' });
    });
  });
}

// Handle sign message
async function handleSignMessage(params, origin, sender) {
  const connected = await isSiteConnected(origin);
  if (!connected) {
    throw new Error('Site not connected');
  }
  
  // X1W-SEC: Check if reauth is required for sensitive operations
  const needsReauth = await requiresReauth(origin);
  
  return new Promise((resolve) => {
    const requestId = generateRequestId();
    const request = {
      type: 'signMessage',
      origin,
      message: params.message,
      timestamp: Date.now(),
      requiresReauth: needsReauth,
      requestId
    };
    
    const timeoutId = setTimeout(() => {
      const entry = getPendingRequestById(requestId);
      if (entry) {
        entry.callback({ error: 'Request timeout' });
        removePendingRequest(requestId);
        if (pendingRequests.size > 0) {
          chrome.action.setBadgeText({ text: pendingRequests.size.toString() });
        } else {
          clearBadge();
        }
      }
    }, 30000);  // X1W-SEC: Reduced timeout for security
    
    pendingRequests.set(requestId, { request, callback: resolve, timeoutId });
    
    // Notify connected popups about the pending request
    notifyPendingRequest(requestId, request);
    
    // Open the extension popup dropdown for approval
    console.log('[Background] Opening extension popup for signMessage');
    chrome.action.openPopup().catch(err => {
      console.log('[Background] openPopup requires user gesture, showing badge');
      chrome.action.setBadgeText({ text: pendingRequests.size.toString() });
      chrome.action.setBadgeBackgroundColor({ color: '#FF6B00' });
    });
  });
}

// Handle get network
async function handleGetNetwork() {
  const network = await getCurrentNetwork();
  const chain = networkToChain(network);
  return { result: { network, chain } };
}

// Handle connection status check (silent - no popup)
// This allows the provider to restore connection state on page load
async function handleGetConnectionStatus(origin) {
  console.log('[Background] getConnectionStatus called for origin:', origin);
  
  const sites = await getConnectedSites();
  console.log('[Background] All connected sites:', Object.keys(sites));
  
  const connected = await isSiteConnected(origin);
  console.log('[Background] isSiteConnected result:', connected);
  
  if (connected) {
    const wallet = await getActiveWallet();
    const network = await getCurrentNetwork();
    const chain = networkToChain(network);
    
    // First try to get public key from wallet
    if (wallet && wallet.publicKey) {
      console.log('[Background] Connection status - CONNECTED (from wallet):', origin, wallet.publicKey);
      return { result: { connected: true, publicKey: wallet.publicKey, network, chain } };
    }
    
    // Fallback: get public key from stored connection
    const siteData = sites[origin];
    if (siteData && siteData.publicKey) {
      console.log('[Background] Connection status - CONNECTED (from storage):', origin, siteData.publicKey);
      return { result: { connected: true, publicKey: siteData.publicKey, network, chain } };
    }
    
    console.log('[Background] Connection status - connected but no publicKey found');
  }
  
  console.log('[Background] Connection status - NOT connected:', origin);
  return { result: { connected: false } };
}

// Handle approve sign from popup - the popup has already signed, just forward the result
async function handleApproveSign(message) {
  console.log('[Background] handleApproveSign received:', JSON.stringify(message));
  
  // Get the pending request (by ID if provided, otherwise oldest)
  const requestId = message.requestId;
  const entry = requestId ? getPendingRequestById(requestId) : getOldestPendingRequest();
  
  if (!entry) {
    console.log('[Background] No pending request found for:', requestId);
    return { error: 'No pending request' };
  }
  
  const id = requestId || entry.id;
  const callback = entry.callback;
  
  if (message.signedTransaction) {
    console.log('[Background] Sending signedTransaction back to DApp');
    callback({ result: { signedTransaction: message.signedTransaction } });
    removePendingRequest(id);
    return { success: true };
  }
  
  if (message.signedTransactions) {
    console.log('[Background] Sending signedTransactions back to DApp');
    callback({ result: { signedTransactions: message.signedTransactions } });
    removePendingRequest(id);
    return { success: true };
  }
  
  if (message.signature) {
    console.log('[Background] Sending signature back to DApp:', message.signature);
    callback({ result: { signature: message.signature } });
    removePendingRequest(id);
    
    // Trigger balance refresh in wallet UI
    broadcastBalanceRefresh();
    
    return { success: true };
  }
  
  if (message.error) {
    console.log('[Background] Sending error back to DApp:', message.error);
    callback({ error: message.error });
    removePendingRequest(id);
    return { success: false };
  }
  
  console.log('[Background] Invalid approve-sign message');
  return { error: 'Invalid approve-sign message' };
}

// Handle approve sign message from popup
async function handleApproveSignMessage(message) {
  console.log('[Background] handleApproveSignMessage received');
  
  // Get the pending request (by ID if provided, otherwise oldest)
  const requestId = message.requestId;
  const entry = requestId ? getPendingRequestById(requestId) : getOldestPendingRequest();
  
  if (!entry) {
    console.log('[Background] No pending request found for sign message');
    return { error: 'No pending request' };
  }
  
  const id = requestId || entry.id;
  const callback = entry.callback;
  
  if (message.signature) {
    callback({ result: { signature: message.signature } });
    removePendingRequest(id);
    return { success: true };
  }
  
  if (message.error) {
    callback({ error: message.error });
    removePendingRequest(id);
    return { success: false };
  }
  
  return { error: 'Invalid approve-sign-message' };
}

// Approve connection (called from popup)
async function approveConnection(origin) {
  const wallet = await getActiveWallet();
  const network = await getCurrentNetwork();
  const chain = networkToChain(network);
  
  if (!wallet) {
    return { error: 'No wallet available' };
  }
  
  // X1W-006: Save connected site with session timestamp
  const sites = await getConnectedSites();
  sites[origin] = {
    connectedAt: Date.now(),
    lastSensitiveOp: Date.now(),
    publicKey: wallet.publicKey
  };
  await saveConnectedSites(sites);
  
  return { result: { publicKey: wallet.publicKey, network, chain } };
}

// X1W-006: Get list of connected sites for settings display
async function getConnectedSitesList() {
  const sites = await getConnectedSites();
  return Object.entries(sites).map(([origin, data]) => ({
    origin,
    connectedAt: data.connectedAt,
    publicKey: data.publicKey
  }));
}

// X1W-006: Revoke site connection
async function revokeSiteConnection(origin) {
  const sites = await getConnectedSites();
  if (sites[origin]) {
    delete sites[origin];
    await saveConnectedSites(sites);
    return { success: true };
  }
  return { success: false, error: 'Site not connected' };
}

// Broadcast balance refresh to wallet UI after transactions
function broadcastBalanceRefresh() {
  console.log('[Background] Broadcasting balance refresh after transaction');
  chrome.storage.local.set({ 
    x1wallet_last_tx_time: Date.now() 
  }).catch(() => {});
}

console.log('[X1 Wallet] Background script loaded');