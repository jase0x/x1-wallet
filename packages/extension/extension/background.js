// X1 Wallet Background Script
// Handles provider requests from dApps
// Fixed: No spurious accountChanged events on tab switch or network change
// Fixed: Uses long-lived ports for reliable event broadcasting (no activeTab needed)

// X1W-SEC-011 FIX: Production-safe logging - disable verbose logs in production
const DEBUG_MODE = false; // Set to true for development debugging
const logger = {
  log: (...args) => DEBUG_MODE && console.log(...args),
  warn: (...args) => console.warn(...args), // Always show warnings
  error: (...args) => console.error(...args), // Always show errors
  // Redact sensitive data in production
  logSafe: (msg, data) => {
    if (DEBUG_MODE) {
      console.log(msg, data);
    } else if (data) {
      // In production, redact public keys and other potentially sensitive info
      const safeData = typeof data === 'string' && data.length > 20 
        ? data.slice(0, 8) + '...' + data.slice(-4)
        : '[REDACTED]';
      console.log(msg, safeData);
    }
  }
};

// Enable side panel on extension icon click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});

// Connected sites storage
const CONNECTED_SITES_KEY = 'x1wallet_connected_sites';
const PENDING_REQUESTS_KEY = 'x1wallet_pending_requests';

// ====== PORT-BASED COMMUNICATION FOR RELIABLE EVENT BROADCASTING ======
// Map of origin -> Set of ports (multiple tabs can have same origin)
const connectedPorts = new Map();

// ====== POPUP CONNECTION TRACKING ======
// Track connected popup for in-popup approval flow
let popupPort = null;
let popupConnected = false;

// Handle port connections from content scripts
chrome.runtime.onConnect.addListener((port) => {
  // Handle popup connection for in-popup approvals
  if (port.name === 'x1-wallet-popup') {
    logger.log('[Background] Popup connected');
    popupPort = port;
    popupConnected = true;
    
    port.onDisconnect.addListener(() => {
      logger.log('[Background] Popup disconnected');
      popupPort = null;
      popupConnected = false;
    });
    
    // If there's a pending request, notify popup immediately
    if (pendingRequest) {
      port.postMessage({ type: 'pending-request', request: pendingRequest });
    }
    return;
  }
  
  if (port.name !== 'x1-wallet-events') return;
  
  // Get origin from sender
  const origin = port.sender?.origin || (port.sender?.tab?.url ? new URL(port.sender.tab.url).origin : null);
  const tabId = port.sender?.tab?.id;
  
  if (!origin) {
    logger.log('[Background] Port connection without origin, ignoring');
    return;
  }
  
  logger.log('[Background] Port connected from:', origin, 'tabId:', tabId);
  
  // Store port by origin
  if (!connectedPorts.has(origin)) {
    connectedPorts.set(origin, new Set());
  }
  connectedPorts.get(origin).add(port);
  
  // Handle port disconnect
  port.onDisconnect.addListener(() => {
    logger.log('[Background] Port disconnected from:', origin, 'tabId:', tabId);
    const ports = connectedPorts.get(origin);
    if (ports) {
      ports.delete(port);
      if (ports.size === 0) {
        connectedPorts.delete(origin);
      }
    }
  });
  
  // Handle messages through port (optional - for future use)
  port.onMessage.addListener((message) => {
    logger.log('[Background] Port message from', origin, ':', message.type);
  });
});

// Broadcast message to all connected ports for specific origins
function broadcastToOrigins(origins, message) {
  let successCount = 0;
  let failCount = 0;
  
  for (const origin of origins) {
    const ports = connectedPorts.get(origin);
    if (ports && ports.size > 0) {
      for (const port of ports) {
        try {
          port.postMessage(message);
          successCount++;
          logger.log('[Background] Broadcasted to port for:', origin);
        } catch (err) {
          failCount++;
          logger.log('[Background] Failed to broadcast to port:', origin, err.message);
          // Remove dead port
          ports.delete(port);
        }
      }
    }
  }
  
  logger.log('[Background] Broadcast complete - success:', successCount, 'failed:', failCount);
  return { successCount, failCount };
}

// Broadcast to all connected ports
function broadcastToAll(message) {
  const allOrigins = Array.from(connectedPorts.keys());
  return broadcastToOrigins(allOrigins, message);
}
// ====== END PORT-BASED COMMUNICATION ======

// Session timeout constants
const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours
const SENSITIVE_OPS_REAUTH_MS = 60 * 60 * 1000; // 1 hour for sensitive operations

// Track last notified state per origin (in memory - cleared on service worker restart)
// This prevents emitting duplicate events
const lastNotifiedState = new Map();

// Track last known active public key for detecting wallet switches via storage changes
let lastKnownPublicKey = null;

// Get connected sites
async function getConnectedSites() {
  const result = await chrome.storage.local.get(CONNECTED_SITES_KEY);
  return result[CONNECTED_SITES_KEY] || {};
}

// Save connected sites
async function saveConnectedSites(sites) {
  await chrome.storage.local.set({ [CONNECTED_SITES_KEY]: sites });
}

// Check if site is connected with session timeout validation
async function isSiteConnected(origin) {
  const sites = await getConnectedSites();
  const siteData = sites[origin];
  
  if (!siteData) return false;
  
  // Check session timeout
  if (siteData.connectedAt) {
    const sessionAge = Date.now() - siteData.connectedAt;
    if (sessionAge > SESSION_TIMEOUT_MS) {
      // Session expired - remove connection
      logger.log('[Background] Session expired for:', origin);
      delete sites[origin];
      await saveConnectedSites(sites);
      return false;
    }
  }
  
  return true;
}

// Check if sensitive operation requires re-authentication
async function requiresReauth(origin) {
  const sites = await getConnectedSites();
  const siteData = sites[origin];
  
  if (!siteData || !siteData.lastSensitiveOp) return false;
  
  const timeSinceLastOp = Date.now() - siteData.lastSensitiveOp;
  return timeSinceLastOp > SENSITIVE_OPS_REAUTH_MS;
}

// Update last sensitive operation timestamp
async function updateLastSensitiveOp(origin) {
  const sites = await getConnectedSites();
  if (sites[origin]) {
    sites[origin].lastSensitiveOp = Date.now();
    await saveConnectedSites(sites);
  }
}

// Validate origin from Chrome's sender object (more secure than content script)
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
  const wallets = JSON.parse(result.x1wallet_wallets || '[]');
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

// Store pending request for popup to handle
let pendingRequest = null;
let pendingRequestCallback = null;
let approvalWindowId = null; // Track the open approval window
let mostRecentActiveOrigin = null; // Track which origin last interacted
let mostRecentActiveTime = 0;

// Track when each origin last sent a request (for determining active tab)
const originLastRequestTime = new Map();

// ====== REQUEST QUEUE SYSTEM (like Backpack) ======
// Queue of pending approval requests - processed one at a time
const requestQueue = [];
let isProcessingQueue = false;

// Ledger device lock - prevents concurrent Ledger operations and wallet switching during signing
let ledgerBusy = false;
let currentLedgerOrigin = null;

// Clear pending requests for a specific origin (called on account change)
function clearPendingRequestsForOrigin(origin) {
  const removed = [];
  for (let i = requestQueue.length - 1; i >= 0; i--) {
    if (requestQueue[i].request.origin === origin) {
      const item = requestQueue.splice(i, 1)[0];
      item.resolve({ error: 'Account changed - request cancelled' });
      removed.push(item.request.type);
    }
  }
  if (removed.length > 0) {
    logger.log('[Background] Cleared', removed.length, 'pending requests for', origin, ':', removed);
  }
  return removed.length;
}

// Clear ALL pending requests (called on global account change)
function clearAllPendingRequests() {
  const count = requestQueue.length;
  while (requestQueue.length > 0) {
    const item = requestQueue.shift();
    item.resolve({ error: 'Account changed - request cancelled' });
  }
  if (count > 0) {
    logger.log('[Background] Cleared all', count, 'pending requests due to account change');
  }
  return count;
}

// Check if Ledger is currently busy
function isLedgerBusy() {
  return ledgerBusy;
}

// Set Ledger busy state (called from popup via message)
function setLedgerBusy(busy, origin = null) {
  ledgerBusy = busy;
  currentLedgerOrigin = busy ? origin : null;
  logger.log('[Background] Ledger busy:', busy, origin ? `for ${origin}` : '');
}

// Add request to queue and process
async function queueApprovalRequest(requestData, url) {
  return new Promise((resolve) => {
    requestQueue.push({
      request: requestData,
      url: url,
      resolve: resolve,
      timestamp: Date.now()
    });
    
    logger.log('[Background] Request queued, queue length:', requestQueue.length);
    
    // Start processing if not already
    processNextInQueue();
  });
}

// Process next request in queue
async function processNextInQueue() {
  // If already processing or queue empty, return
  if (isProcessingQueue || requestQueue.length === 0) {
    return;
  }
  
  // If there's still an approval window open, wait for it to close
  if (approvalWindowId) {
    logger.log('[Background] Waiting for current approval window to close');
    return;
  }
  
  isProcessingQueue = true;
  
  const item = requestQueue.shift();
  logger.log('[Background] Processing queued request:', item.request.type, 'from:', item.request.origin);
  
  // Set up the pending request
  pendingRequest = item.request;
  pendingRequestCallback = (response) => {
    item.resolve(response);
    // After resolving, process next in queue
    setTimeout(() => {
      isProcessingQueue = false;
      processNextInQueue();
    }, 100); // Small delay to let popup update
  };
  
  // ====== IN-POPUP APPROVAL FLOW ======
  // Priority: 1) Use existing popup, 2) Open popup, 3) Fall back to window
  
  // Option 1: If popup is already open, just notify it
  if (popupConnected && popupPort) {
    logger.log('[Background] Popup already open, sending pending request');
    try {
      popupPort.postMessage({ type: 'pending-request', request: pendingRequest });
      // No approval window needed - popup handles it
      approvalWindowId = null;
    } catch (err) {
      logger.log('[Background] Failed to message popup, will open new');
      popupConnected = false;
      popupPort = null;
    }
  }
  
  // Option 2: Try to open the extension popup (MV3)
  if (!popupConnected) {
    try {
      // chrome.action.openPopup() opens the default_popup from manifest
      // The popup will detect the pending request on load
      await chrome.action.openPopup();
      logger.log('[Background] Extension popup opened via action.openPopup()');
      // Give popup time to connect
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (err) {
      logger.log('[Background] action.openPopup() failed:', err.message);
      
      // Option 3: Fall back to separate window (last resort)
      try {
        const win = await chrome.windows.create({
          url: item.url,
          type: 'popup',
          width: 400,
          height: 620,
          focused: true
        });
        approvalWindowId = win?.id;
        logger.log('[Background] Fallback approval window opened:', approvalWindowId);
      } catch (winErr) {
        console.error('[Background] Failed to open approval window:', winErr);
        approvalWindowId = null;
        pendingRequestCallback({ error: 'Failed to open approval window' });
        return;
      }
    }
  }
  
  // Timeout after 60 seconds
  setTimeout(() => {
    if (pendingRequest === item.request && pendingRequestCallback) {
      logger.log('[Background] Request timeout for:', item.request.type);
      closeApprovalWindow();
      pendingRequestCallback({ error: 'Request timeout' });
      pendingRequestCallback = null;
      pendingRequest = null;
      isProcessingQueue = false;
      processNextInQueue();
    }
  }, 60000);
}

// Close approval window helper
async function closeApprovalWindow() {
  if (approvalWindowId) {
    const windowToClose = approvalWindowId;
    approvalWindowId = null;
    try {
      await chrome.windows.remove(windowToClose);
    } catch (e) {
      // Window might already be closed
    }
  }
}

// Listen for approval window being closed by user
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === approvalWindowId) {
    logger.log('[Background] Approval window closed by user');
    approvalWindowId = null;
    
    // If there's a pending request, reject it
    if (pendingRequestCallback) {
      pendingRequestCallback({ error: 'User closed the approval window' });
      pendingRequestCallback = null;
      pendingRequest = null;
    }
    
    // Process next in queue
    isProcessingQueue = false;
    processNextInQueue();
  }
});

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle side panel open
  if (message.action === 'openSidePanel') {
    chrome.sidePanel.open({ windowId: sender.tab?.windowId });
    return;
  }
  
  // Handle network change from popup - broadcast to all connected sites
  // BUT DO NOT emit accountChanged - only emit networkChanged
  if (message.type === 'network-changed') {
    handleNetworkChanged(message.network);
    sendResponse({ success: true });
    return;
  }
  
  // Handle ACTUAL account change from popup (when user switches wallet)
  if (message.type === 'account-changed') {
    logger.log('[Background] Received account-changed message from popup:', message.publicKey);
    handleAccountChanged(message.publicKey).then(result => {
      sendResponse(result || { success: true });
    }).catch(err => {
      sendResponse({ error: err.message });
    });
    return true; // Keep channel open for async response
  }
  
  // Handle Ledger busy state from popup
  if (message.type === 'ledger-busy') {
    setLedgerBusy(message.busy, message.origin);
    sendResponse({ success: true });
    return;
  }
  
  // Check if Ledger is busy (for popup to query before wallet switch)
  if (message.type === 'check-ledger-busy') {
    sendResponse({ busy: ledgerBusy, origin: currentLedgerOrigin });
    return;
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
    // Close approval window immediately to allow queue to process next
    const windowToClose = approvalWindowId;
    approvalWindowId = null;
    if (windowToClose) {
      chrome.windows.remove(windowToClose).catch(() => {});
    }
    
    // Process next in queue
    isProcessingQueue = false;
    setTimeout(() => processNextInQueue(), 50);
    
    if (pendingRequestCallback) {
      const payload = message.payload;
      const currentRequest = pendingRequest; // Save reference before clearing
      
      // If this is a successful connection, save the connected site BEFORE resolving
      if (currentRequest && currentRequest.type === 'connect' && payload.result && !payload.error) {
        // Save synchronously before resolving the promise
        getConnectedSites().then(sites => {
          sites[currentRequest.origin] = {
            connectedAt: Date.now(),
            publicKey: payload.result.publicKey
          };
          return saveConnectedSites(sites);
        }).then(() => {
          logger.log('[Background] Saved connected site:', currentRequest.origin);
          // Now resolve the promise
          pendingRequestCallback(payload);
          pendingRequestCallback = null;
          pendingRequest = null;
        }).catch(err => {
          console.error('[Background] Error saving site:', err);
          pendingRequestCallback(payload);
          pendingRequestCallback = null;
          pendingRequest = null;
        });
        return; // Don't fall through
      }
      
      pendingRequestCallback(payload);
      pendingRequestCallback = null;
      pendingRequest = null;
    }
    return;
  }
  
  // Handle get pending request from popup
  // Returns both the pending request AND the approval window ID
  // so the popup can determine if it should show approval UI
  if (message.type === 'get-pending-request') {
    sendResponse({
      request: pendingRequest,
      approvalWindowId: approvalWindowId
    });
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

// Handle network change - broadcast ONLY networkChanged to all connected tabs
// DO NOT emit accountChanged - that should only happen when account actually changes
async function handleNetworkChanged(network) {
  logger.log('[Background] ====== NETWORK CHANGE START ======');
  logger.log('[Background] Network changed to:', network);
  
  const chain = networkToChain(network);
  logger.log('[Background] Chain ID:', chain);
  
  const connectedSites = await getConnectedSites();
  const origins = Object.keys(connectedSites);
  
  logger.log('[Background] Connected sites:', origins);
  logger.log('[Background] Active ports:', Array.from(connectedPorts.keys()));
  
  if (origins.length === 0) {
    logger.log('[Background] No connected sites to notify');
    return;
  }
  
  // Use port-based broadcasting (primary method - more reliable)
  const message = {
    type: 'network-changed',
    target: 'x1-wallet-content',
    payload: { network, chain }
  };
  
  logger.log('[Background] Broadcasting message:', JSON.stringify(message));
  
  const { successCount, failCount } = broadcastToOrigins(origins, message);
  logger.log('[Background] Broadcast result - success:', successCount, 'failed:', failCount);
  
  // Fallback: Also try tabs.sendMessage for tabs that might not have port connection yet
  // This handles edge cases where content script loaded but port not yet connected
  if (successCount < origins.length) {
    logger.log('[Background] Using fallback tabs.sendMessage for remaining sites');
    try {
      const tabs = await chrome.tabs.query({});
      
      for (const tab of tabs) {
        if (!tab.url) continue;
        
        try {
          const tabOrigin = new URL(tab.url).origin;
          
          // Only notify connected sites that weren't reached via port
          if (origins.includes(tabOrigin)) {
            logger.log('[Background] Fallback sending to tab:', tab.id, tabOrigin);
            chrome.tabs.sendMessage(tab.id, message).catch((e) => {
              logger.log('[Background] Fallback failed for tab:', tab.id, e.message);
            });
          }
        } catch (e) {
          // Invalid URL, skip
        }
      }
    } catch (err) {
      console.error('[Background] Error in fallback network broadcast:', err);
    }
  }
  logger.log('[Background] ====== NETWORK CHANGE END ======');
}

// Handle ACTUAL account change - when user switches wallet in the extension
// Broadcast to ALL connected dApps so they can update their UI
async function handleAccountChanged(newPublicKey, forceSwitch = false) {
  logger.log('[Background] ====== ACCOUNT CHANGE START ======');
  logger.log('[Background] handleAccountChanged called with:', newPublicKey);
  
  // Check if Ledger is busy - block account switching during Ledger operations
  if (ledgerBusy && !forceSwitch) {
    logger.log('[Background] ⚠️ BLOCKED: Cannot switch accounts while Ledger is busy');
    logger.log('[Background] ====== ACCOUNT CHANGE END (blocked - Ledger busy) ======');
    // Return error that popup can display
    return { error: 'Cannot switch accounts while Ledger signing is in progress. Please complete or cancel the current operation.' };
  }
  
  // Deduplicate - don't broadcast if key hasn't actually changed
  if (newPublicKey === lastKnownPublicKey) {
    logger.log('[Background] Same public key, skipping broadcast');
    logger.log('[Background] ====== ACCOUNT CHANGE END (skipped) ======');
    return { success: true, skipped: true };
  }
  
  logger.log('[Background] Previous key:', lastKnownPublicKey);
  logger.log('[Background] New key:', newPublicKey);
  
  // IMPORTANT: Clear ALL pending requests when account changes
  // Old requests should not execute against the new account
  const clearedCount = clearAllPendingRequests();
  if (clearedCount > 0) {
    logger.log('[Background] Cleared', clearedCount, 'pending requests due to account change');
  }
  
  // Update last known public key
  lastKnownPublicKey = newPublicKey;
  
  // Store the new key globally
  await chrome.storage.local.set({ currentPublicKey: newPublicKey });
  
  // Get all connected sites
  const connectedSites = await getConnectedSites();
  const origins = Object.keys(connectedSites);
  
  logger.log('[Background] Connected sites:', origins);
  logger.log('[Background] Active ports:', Array.from(connectedPorts.keys()));
  
  if (origins.length === 0) {
    logger.log('[Background] No connected sites to notify about account change');
    logger.log('[Background] ====== ACCOUNT CHANGE END (no sites) ======');
    return { success: true };
  }
  
  // Update stored publicKey for all connected sites
  for (const origin of origins) {
    connectedSites[origin].publicKey = newPublicKey;
    lastNotifiedState.set(origin, { publicKey: newPublicKey });
  }
  await saveConnectedSites(connectedSites);
  
  // Broadcast accountChanged to ALL connected sites via ports
  const message = {
    type: 'accountChanged',
    target: 'x1-wallet-content',
    payload: { publicKey: newPublicKey }
  };
  
  logger.log('[Background] Broadcasting message:', JSON.stringify(message));
  
  const { successCount, failCount } = broadcastToOrigins(origins, message);
  logger.log('[Background] Broadcast result - success:', successCount, 'failed:', failCount);
  
  // Fallback: Also try tabs.sendMessage for tabs without port connection
  if (successCount < origins.length) {
    logger.log('[Background] Using fallback tabs.sendMessage for remaining sites');
    try {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (!tab.url) continue;
        try {
          const tabOrigin = new URL(tab.url).origin;
          if (origins.includes(tabOrigin)) {
            logger.log('[Background] Fallback sending to tab:', tab.id, tabOrigin);
            chrome.tabs.sendMessage(tab.id, message).catch((e) => {
              logger.log('[Background] Fallback failed for tab:', tab.id, e.message);
            });
          }
        } catch (e) {}
      }
    } catch (err) {
      console.error('[Background] Error in fallback account broadcast:', err);
    }
  }
  logger.log('[Background] ====== ACCOUNT CHANGE END ======');
}

// Notify a specific origin if the account has changed since last notification
// This is called when the dApp calls connect(), indicating user interaction
async function notifyIfAccountChanged(origin) {
  // Get the current wallet's public key
  const result = await chrome.storage.local.get(['currentPublicKey']);
  const currentKey = result.currentPublicKey;
  
  if (!currentKey) {
    return; // No current key set
  }
  
  // Check if we already notified this origin about this key
  const lastState = lastNotifiedState.get(origin);
  if (lastState && lastState.publicKey === currentKey) {
    return; // Already notified
  }
  
  const connectedSites = await getConnectedSites();
  const siteData = connectedSites[origin];
  
  if (!siteData) {
    return; // Not connected
  }
  
  // If site already has the current key, just update lastNotifiedState
  if (siteData.publicKey === currentKey) {
    lastNotifiedState.set(origin, { publicKey: currentKey });
    return;
  }
  
  logger.log('[Background] Site', origin, 'has old key, updating to:', currentKey);
  
  // Update the site's stored key
  connectedSites[origin].publicKey = currentKey;
  await saveConnectedSites(connectedSites);
  
  // Update last notified state
  lastNotifiedState.set(origin, { publicKey: currentKey });
  
  // Send accountChanged to this origin only
  const message = {
    type: 'accountChanged',
    target: 'x1-wallet-content',
    payload: { publicKey: currentKey }
  };
  
  const ports = connectedPorts.get(origin);
  if (ports && ports.size > 0) {
    for (const port of ports) {
      try {
        port.postMessage(message);
        logger.log('[Background] Sent accountChanged to:', origin);
      } catch (e) {
        // Port might be disconnected
      }
    }
  }
}

// Handle provider requests
async function handleProviderRequest(message, sender) {
  const { method, params, favicon } = message;
  
  // Use secure origin validation
  const origin = validateOrigin(message.origin, sender);
  
  logger.log('[Background] Provider request:', method, 'from:', origin);
  
  // Track request time for this origin (helps determine active tab)
  originLastRequestTime.set(origin, Date.now());
  
  switch (method) {
    case 'connect':
      // Track NON-SILENT connect - user is actively on this site
      if (!params?.onlyIfTrusted) {
        mostRecentActiveOrigin = origin;
        mostRecentActiveTime = Date.now();
        logger.log('[Background] User connect (non-silent) from:', origin);
      }
      return handleConnect(origin, favicon, sender, params || {});
      
    case 'disconnect':
      return handleDisconnect(origin);
      
    case 'switchChain':
    case 'wallet_switchNetwork':  // EIP-3326 style method name
      return handleSwitchChain(params, origin);
      
    case 'signTransaction':
      // Track as active when user initiates a sign
      mostRecentActiveOrigin = origin;
      mostRecentActiveTime = Date.now();
      return handleSignTransaction(params, origin, sender);
      
    case 'signAllTransactions':
      mostRecentActiveOrigin = origin;
      mostRecentActiveTime = Date.now();
      return handleSignAllTransactions(params, origin, sender);
      
    case 'signAndSendTransaction':
      mostRecentActiveOrigin = origin;
      mostRecentActiveTime = Date.now();
      return handleSignAndSendTransaction(params, origin, sender);
      
    case 'signMessage':
      return handleSignMessage(params, origin, sender);
      
    case 'getNetwork':
      return handleGetNetwork();
      
    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

// Handle connect request
async function handleConnect(origin, favicon, sender, params = {}) {
  // Check if already connected
  const connected = await isSiteConnected(origin);
  
  if (connected) {
    const sites = await getConnectedSites();
    const siteData = sites[origin];
    const network = await getCurrentNetwork();
    const chain = networkToChain(network);
    
    // Return stored publicKey - don't update on reconnect
    if (siteData && siteData.publicKey) {
      logger.log('[Background] Site already connected, returning STORED wallet info:', origin);
      return { result: { publicKey: siteData.publicKey, network, chain } };
    }
    
    // Fallback: try to get active wallet
    const wallet = await getActiveWallet();
    if (wallet && wallet.publicKey) {
      sites[origin].publicKey = wallet.publicKey;
      await saveConnectedSites(sites);
      return { result: { publicKey: wallet.publicKey, network, chain } };
    }
    
    // Remove stale connection
    logger.log('[Background] Removing stale connection for:', origin);
    delete sites[origin];
    await saveConnectedSites(sites);
  }
  
  // If onlyIfTrusted is set and site is not connected, reject silently
  if (params.onlyIfTrusted) {
    logger.log('[Background] Silent connect rejected - site not trusted:', origin);
    return { error: 'User rejected the request.' };
  }
  
  // Queue the request
  logger.log('[Background] Queueing connect request for:', origin);
  return queueApprovalRequest({
    type: 'connect',
    origin,
    favicon,
    chain: params.chain,
    timestamp: Date.now()
  }, 'index.html?request=connect');
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

// Allowed networks for validation
const ALLOWED_NETWORKS = {
  'x1:mainnet': 'X1 Mainnet',
  'x1:testnet': 'X1 Testnet',
  'solana:mainnet': 'Solana Mainnet',
  'solana:devnet': 'Solana Devnet',
  'solana:testnet': 'Solana Testnet'
};

function isAllowedNetwork(chain) {
  return chain in ALLOWED_NETWORKS;
}

// Handle switch chain request - origin-bound, request-based
// This is the correct MV3 pattern: dApp explicitly requests network switch
async function handleSwitchChain(params, origin) {
  const { chain } = params;
  
  if (!chain) {
    throw new Error('Chain parameter required');
  }
  
  // Validate the requested network
  if (!isAllowedNetwork(chain)) {
    throw new Error(`Unsupported network: ${chain}`);
  }
  
  // Verify site is connected before allowing network switch
  const connected = await isSiteConnected(origin);
  if (!connected) {
    logger.log('[Background] Rejecting switchChain - site not connected:', origin);
    throw new Error('Site not connected. Please connect first.');
  }
  
  const network = chainToNetwork(chain);
  
  // Save the new global network preference
  await chrome.storage.local.set({ 'x1wallet_network': network });
  
  // Also store per-origin network preference
  const sites = await getConnectedSites();
  if (sites[origin]) {
    sites[origin].preferredNetwork = chain;
    await saveConnectedSites(sites);
  }
  
  logger.log('[Background] Switched to chain:', chain, 'network:', network, 'for origin:', origin);
  
  // Broadcast network change to the requesting origin (and all connected sites)
  const connectedOrigins = Object.keys(sites);
  const message = {
    type: 'network-changed',
    target: 'x1-wallet-content',
    payload: { network, chain }
  };
  
  broadcastToOrigins(connectedOrigins, message);
  
  return { result: { chain, network } };
}

// Handle disconnect
async function handleDisconnect(origin) {
  const sites = await getConnectedSites();
  delete sites[origin];
  await saveConnectedSites(sites);
  
  // Clear last notified state for this origin
  lastNotifiedState.delete(origin);
  
  return { result: true };
}

// Handle sign transaction
async function handleSignTransaction(params, origin, sender) {
  logger.log('[Background] signTransaction from origin:', origin);
  const connected = await isSiteConnected(origin);
  logger.log('[Background] Site connected:', connected);
  
  if (!connected) {
    const sites = await getConnectedSites();
    logger.log('[Background] Connected sites:', Object.keys(sites));
    throw new Error('Site not connected');
  }
  
  // Queue the request (like Backpack does)
  logger.log('[Background] Queueing signTransaction request for:', origin);
  return queueApprovalRequest({
    type: 'signTransaction',
    origin,
    transaction: params.transaction,
    timestamp: Date.now()
  }, 'index.html?request=sign');
}

// Handle sign all transactions
async function handleSignAllTransactions(params, origin, sender) {
  const connected = await isSiteConnected(origin);
  if (!connected) {
    throw new Error('Site not connected');
  }
  
  // Queue the request (like Backpack does)
  logger.log('[Background] Queueing signAllTransactions request for:', origin);
  return queueApprovalRequest({
    type: 'signAllTransactions',
    origin,
    transactions: params.transactions,
    timestamp: Date.now()
  }, 'index.html?request=signAll');
}

// Handle sign and send transaction
async function handleSignAndSendTransaction(params, origin, sender) {
  const connected = await isSiteConnected(origin);
  if (!connected) {
    throw new Error('Site not connected');
  }
  
  // Queue the request (like Backpack does)
  logger.log('[Background] Queueing signAndSendTransaction request for:', origin);
  return queueApprovalRequest({
    type: 'signAndSendTransaction',
    origin,
    transaction: params.transaction,
    options: params.options,
    timestamp: Date.now()
  }, 'index.html?request=signAndSend');
}

// Handle sign message
async function handleSignMessage(params, origin, sender) {
  const connected = await isSiteConnected(origin);
  if (!connected) {
    throw new Error('Site not connected');
  }
  
  // Queue the request - let user decide via popup
  logger.log('[Background] Queueing signMessage request for:', origin);
  return queueApprovalRequest({
    type: 'signMessage',
    origin,
    message: params.message,
    timestamp: Date.now()
  }, 'index.html?request=signMessage');
}

// Handle get network
async function handleGetNetwork() {
  const network = await getCurrentNetwork();
  const chain = networkToChain(network);
  return { result: { network, chain } };
}

// Handle approve sign from popup
async function handleApproveSign(message) {
  logger.log('[Background] handleApproveSign received:', JSON.stringify(message));
  
  // Close approval window immediately to allow queue to process next
  const windowToClose = approvalWindowId;
  approvalWindowId = null;
  if (windowToClose) {
    chrome.windows.remove(windowToClose).catch(() => {});
  }
  
  // Process next in queue regardless of success/failure
  isProcessingQueue = false;
  setTimeout(() => processNextInQueue(), 50);
  
  if (message.signedTransaction && pendingRequestCallback) {
    logger.log('[Background] Sending signedTransaction back to DApp');
    pendingRequestCallback({ result: { signedTransaction: message.signedTransaction } });
    pendingRequestCallback = null;
    pendingRequest = null;
    return { success: true };
  }
  
  if (message.signedTransactions && pendingRequestCallback) {
    logger.log('[Background] Sending signedTransactions back to DApp');
    pendingRequestCallback({ result: { signedTransactions: message.signedTransactions } });
    pendingRequestCallback = null;
    pendingRequest = null;
    return { success: true };
  }
  
  if (message.signature && pendingRequestCallback) {
    logger.log('[Background] Sending signature back to DApp:', message.signature);
    pendingRequestCallback({ result: { signature: message.signature } });
    pendingRequestCallback = null;
    pendingRequest = null;
    return { success: true };
  }
  
  if (message.error) {
    logger.log('[Background] Sending error back to DApp:', message.error);
    if (pendingRequestCallback) {
      pendingRequestCallback({ error: message.error });
      pendingRequestCallback = null;
      pendingRequest = null;
    }
    return { success: false };
  }
  
  logger.log('[Background] Invalid approve-sign message, pendingRequestCallback:', !!pendingRequestCallback);
  return { error: 'Invalid approve-sign message' };
}

// Handle approve sign message from popup
async function handleApproveSignMessage(message) {
  logger.log('[Background] handleApproveSignMessage received');
  
  // Clear Ledger busy state - signing operation is complete (success or failure)
  setLedgerBusy(false);
  
  // Close approval window
  const windowToClose = approvalWindowId;
  approvalWindowId = null;
  if (windowToClose) {
    chrome.windows.remove(windowToClose).catch(() => {});
  }
  
  // Check if this is a Ledger error - don't auto-process queue on Ledger errors
  const isLedgerError = message.error && (
    message.error.includes('Ledger') ||
    message.error.includes('0x6a81') ||
    message.error.includes('0x5515') ||
    message.error.includes('LockedDevice') ||
    message.error.includes('UNKNOWN_ERROR') ||
    message.error.includes('TransportStatusError')
  );
  
  if (isLedgerError) {
    logger.log('[Background] Ledger error detected - NOT auto-processing queue');
    logger.log('[Background] Error:', message.error);
    // Clear the entire queue on Ledger errors to prevent cascading failures
    clearAllPendingRequests();
  }
  
  // Process next in queue only if NOT a Ledger error
  isProcessingQueue = false;
  if (!isLedgerError) {
    setTimeout(() => processNextInQueue(), 50);
  }
  
  if (message.signature && pendingRequestCallback) {
    pendingRequestCallback({ result: { signature: message.signature } });
    pendingRequestCallback = null;
    pendingRequest = null;
    return { success: true };
  }
  
  if (message.error) {
    if (pendingRequestCallback) {
      pendingRequestCallback({ error: message.error });
      pendingRequestCallback = null;
      pendingRequest = null;
    }
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
  
  // Save connected site with session timestamp
  const sites = await getConnectedSites();
  sites[origin] = {
    connectedAt: Date.now(),
    lastSensitiveOp: Date.now(),
    publicKey: wallet.publicKey
  };
  await saveConnectedSites(sites);
  
  return { result: { publicKey: wallet.publicKey, network, chain } };
}

// Get list of connected sites for settings display
async function getConnectedSitesList() {
  const sites = await getConnectedSites();
  return Object.entries(sites).map(([origin, data]) => ({
    origin,
    connectedAt: data.connectedAt,
    publicKey: data.publicKey
  }));
}

// Revoke site connection
async function revokeSiteConnection(origin) {
  const sites = await getConnectedSites();
  if (sites[origin]) {
    delete sites[origin];
    await saveConnectedSites(sites);
    lastNotifiedState.delete(origin);
    return { success: true };
  }
  return { success: false, error: 'Site not connected' };
}

// Initialize last known public key on startup
(async () => {
  const wallet = await getActiveWallet();
  if (wallet && wallet.publicKey) {
    lastKnownPublicKey = wallet.publicKey;
    logger.log('[Background] Initialized lastKnownPublicKey:', lastKnownPublicKey);
  }
})();

// Listen for storage changes to detect wallet switches
// This handles the case where popup doesn't send account-changed message
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'local') return;
  
  // Check if wallet-related storage changed
  const walletChanged = changes.x1wallet_active || changes.x1wallet_wallets;
  
  if (walletChanged) {
    logger.log('[Background] Wallet storage changed:', 
      changes.x1wallet_active ? 'active wallet' : '', 
      changes.x1wallet_wallets ? 'wallets list' : '');
    
    // Get the new active wallet
    const wallet = await getActiveWallet();
    const newPublicKey = wallet?.publicKey;
    
    logger.log('[Background] Current lastKnownPublicKey:', lastKnownPublicKey);
    logger.log('[Background] New active wallet publicKey:', newPublicKey);
    
    if (newPublicKey && newPublicKey !== lastKnownPublicKey) {
      logger.log('[Background] Detected account change via storage, calling handleAccountChanged');
      lastKnownPublicKey = newPublicKey;
      
      // Broadcast account change to all connected sites
      handleAccountChanged(newPublicKey);
    } else {
      logger.log('[Background] No account change detected (same key or null)');
    }
  }
});

console.log('[X1 Wallet] Background script loaded');