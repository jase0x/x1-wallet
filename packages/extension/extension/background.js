// X1 Wallet Background Script
// Handles provider requests from dApps

// Enable side panel on extension icon click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});

// Connected sites storage
const CONNECTED_SITES_KEY = 'x1wallet_connected_sites';
const PENDING_REQUESTS_KEY = 'x1wallet_pending_requests';

// Tab registration for broadcasting (no tabs permission needed)
// Maps tabId -> { origin, publicKey }
const connectedTabs = new Map();

// Track last broadcasted values to prevent spam
let lastBroadcastedPublicKey = null;
let lastBroadcastedNetwork = null;

// Clean up when tab closes
chrome.tabs.onRemoved.addListener((tabId) => {
  if (connectedTabs.has(tabId)) {
    console.log('[Background] Tab closed, removing from connectedTabs:', tabId);
    connectedTabs.delete(tabId);
  }
});

// Clean up when tab navigates away from connected site
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && connectedTabs.has(tabId)) {
    const stored = connectedTabs.get(tabId);
    try {
      const newOrigin = new URL(changeInfo.url).origin;
      if (newOrigin !== stored.origin) {
        console.log('[Background] Tab navigated away, removing:', tabId);
        connectedTabs.delete(tabId);
      }
    } catch (e) {
      connectedTabs.delete(tabId);
    }
  }
});

// X1W-006: Session timeout constants
const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours
const SENSITIVE_OPS_REAUTH_MS = 60 * 60 * 1000; // 1 hour for sensitive operations

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
  
  return true;
}

// X1W-006: Check if sensitive operation requires re-authentication
async function requiresReauth(origin) {
  const sites = await getConnectedSites();
  const siteData = sites[origin];
  
  if (!siteData || !siteData.lastSensitiveOp) return false;
  
  const timeSinceLastOp = Date.now() - siteData.lastSensitiveOp;
  return timeSinceLastOp > SENSITIVE_OPS_REAUTH_MS;
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
// SEC-FIX: Background script should NEVER access private keys
// Signing happens in the popup approval flow, not here
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
  
  // SEC-FIX: Only return public info - NEVER return privateKey/mnemonic/secretKey
  return {
    id: wallet.id,
    name: wallet.name,
    type: wallet.type,
    publicKey: activeAddress?.publicKey || wallet.publicKey,
    activeAddressIndex: wallet.activeAddressIndex || 0
    // privateKey intentionally omitted - signing happens in popup
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

// Request queue for sequential processing
const requestQueue = [];
let isProcessingQueue = false;

// Track approval window to reuse it
let approvalWindowId = null;

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle side panel open
  if (message.action === 'openSidePanel') {
    chrome.sidePanel.open({ windowId: sender.tab?.windowId }).catch(() => {});
    return false;
  }
  
  // Handle network change from popup - broadcast to all connected tabs
  if (message.type === 'network-changed') {
    handleNetworkChanged(message.network);
    sendResponse({ success: true });
    return false;
  }
  
  // Handle wallet/account change from popup - broadcast to all connected tabs
  if (message.type === 'wallet-changed' || message.type === 'account-changed') {
    handleAccountChanged(message.publicKey);
    sendResponse({ success: true });
    return false;
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
    // Close fallback approval window if open
    if (approvalWindowId) {
      chrome.windows.remove(approvalWindowId).catch(() => {});
      approvalWindowId = null;
    }
    
    if (pendingRequestCallback) {
      const payload = message.payload;
      const currentRequest = pendingRequest;
      
      // If this is a successful connection, save the connected site and register tab
      if (currentRequest && currentRequest.type === 'connect' && payload.result && !payload.error) {
        const tabId = currentRequest.tabId;
        const origin = currentRequest.origin;
        const publicKey = payload.result.publicKey;
        
        // Register tab for broadcasts
        if (tabId) {
          connectedTabs.set(tabId, { origin, publicKey });
          console.log('[Background] Registered tab for broadcasts:', tabId, origin);
        }
        
        getConnectedSites().then(sites => {
          sites[origin] = {
            connectedAt: Date.now(),
            publicKey: publicKey
          };
          return saveConnectedSites(sites);
        }).then(() => {
          console.log('[Background] Saved connected site:', origin);
          pendingRequestCallback(payload);
          pendingRequestCallback = null;
          pendingRequest = null;
          // Process next queued request after short delay
          setTimeout(processNextRequest, 100);
        }).catch(err => {
          console.error('[Background] Error saving site:', err);
          pendingRequestCallback(payload);
          pendingRequestCallback = null;
          pendingRequest = null;
          setTimeout(processNextRequest, 100);
        });
      } else {
        pendingRequestCallback(payload);
        pendingRequestCallback = null;
        pendingRequest = null;
        // Process next queued request after short delay
        setTimeout(processNextRequest, 100);
      }
    }
    sendResponse({ received: true });
    return false;
  }
  
  // Handle get pending request from popup
  if (message.type === 'get-pending-request') {
    sendResponse(pendingRequest);
    return false;
  }
  
  // Handle approve-sign from popup
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
  
  // Unknown message type
  return false;
});

// Handle network change - broadcast to all registered connected tabs
async function handleNetworkChanged(network) {
  // Skip if same as last broadcast (prevents spam)
  if (network === lastBroadcastedNetwork) {
    console.log('[Background] Network unchanged, skipping broadcast');
    return;
  }
  
  console.log('[Background] Network changed to:', network);
  lastBroadcastedNetwork = network;
  
  const chain = networkToChain(network);
  
  if (connectedTabs.size === 0) {
    console.log('[Background] No connected tabs to notify');
    return;
  }
  
  console.log('[Background] Broadcasting to', connectedTabs.size, 'connected tabs');
  
  // Broadcast to all registered tabs
  for (const [tabId, data] of connectedTabs) {
    chrome.tabs.sendMessage(tabId, {
      type: 'network-changed',
      target: 'x1-wallet-content',
      payload: { network, chain }
    }).then(() => {
      console.log('[Background] Notified tab:', tabId, data.origin);
    }).catch(err => {
      console.log('[Background] Tab unreachable, removing:', tabId);
      connectedTabs.delete(tabId);
    });
  }
}

// Handle account/wallet change - broadcast to all registered connected tabs
async function handleAccountChanged(publicKey) {
  // Skip if same as last broadcast (prevents spam from popup reloads)
  if (publicKey === lastBroadcastedPublicKey) {
    console.log('[Background] Account unchanged, skipping broadcast');
    return;
  }
  
  console.log('[Background] Account changed to:', publicKey);
  lastBroadcastedPublicKey = publicKey;
  
  if (!publicKey) return;
  
  if (connectedTabs.size === 0) {
    console.log('[Background] No connected tabs to notify');
    return;
  }
  
  // Update stored public key for all connected sites
  const connectedSites = await getConnectedSites();
  for (const origin of Object.keys(connectedSites)) {
    connectedSites[origin].publicKey = publicKey;
  }
  await saveConnectedSites(connectedSites);
  
  // Update in-memory tab data
  for (const [tabId, data] of connectedTabs) {
    data.publicKey = publicKey;
  }
  
  console.log('[Background] Broadcasting account change to', connectedTabs.size, 'tabs');
  
  // Broadcast to all registered tabs
  for (const [tabId, data] of connectedTabs) {
    chrome.tabs.sendMessage(tabId, {
      type: 'accountChanged',
      target: 'x1-wallet-content',
      payload: { publicKey }
    }).then(() => {
      console.log('[Background] Notified tab of account change:', tabId);
    }).catch(err => {
      console.log('[Background] Tab unreachable, removing:', tabId);
      connectedTabs.delete(tabId);
    });
  }
}

// Handle provider requests
async function handleProviderRequest(message, sender) {
  const { method, params, favicon } = message;
  
  // X1W-006: Use secure origin validation
  const origin = validateOrigin(message.origin, sender);
  
  console.log('[Background] Provider request:', method, 'from:', origin, 'params:', params);
  
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
      
    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

// Open approval popup window positioned in the dApp's browser window
async function openApprovalPopup(windowId) {
  // Check if we already have an approval window open - reuse it
  if (approvalWindowId) {
    try {
      const existingWindow = await chrome.windows.get(approvalWindowId);
      if (existingWindow) {
        await chrome.windows.update(approvalWindowId, { focused: true });
        console.log('[Background] Reusing existing approval window:', approvalWindowId);
        return;
      }
    } catch (e) {
      approvalWindowId = null;
    }
  }
  
  // Check if any extension popup is already open (toolbar dropdown or other)
  // If so, don't open another - let the existing one handle it
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['POPUP'] });
    if (contexts && contexts.length > 0) {
      console.log('[Background] Extension popup already open, not opening another');
      return;
    }
  } catch (e) {
    // getContexts might not be available, continue
  }
  
  // Get the target window (where the dApp is)
  let targetWindow;
  try {
    if (windowId) {
      targetWindow = await chrome.windows.get(windowId);
    } else {
      targetWindow = await chrome.windows.getCurrent();
    }
  } catch (e) {
    try {
      targetWindow = await chrome.windows.getCurrent();
    } catch (e2) {
      console.error('[Background] No window available');
      return;
    }
  }
  
  // Position popup in top-right of the target window
  const popupWidth = 400;
  const popupHeight = 620;
  const left = Math.max(0, targetWindow.left + targetWindow.width - popupWidth - 20);
  const top = Math.max(0, targetWindow.top + 80);
  
  try {
    const win = await chrome.windows.create({
      url: 'index.html',
      type: 'popup',
      width: popupWidth,
      height: popupHeight,
      left,
      top,
      focused: true
    });
    
    approvalWindowId = win.id;
    console.log('[Background] Opened approval window:', win.id, 'at position', left, top);
  } catch (err) {
    console.error('[Background] Failed to open approval window:', err);
  }
}

// Clean up approval window tracking when window closes
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === approvalWindowId) {
    approvalWindowId = null;
    console.log('[Background] Approval window closed');
    
    // Process next queued request if any
    processNextRequest();
  }
});

// Queue a request and process it
function queueRequest(request, resolve, windowId) {
  requestQueue.push({ request, resolve, windowId });
  console.log('[Background] Queued request, queue length:', requestQueue.length);
  
  if (!isProcessingQueue) {
    processNextRequest();
  }
}

// Process the next request in queue
function processNextRequest() {
  console.log('[Background] processNextRequest called, queue length:', requestQueue.length, 'pendingRequest:', !!pendingRequest);
  
  if (requestQueue.length === 0) {
    isProcessingQueue = false;
    console.log('[Background] Queue empty, done processing');
    // Close fallback window if open and queue is empty
    if (approvalWindowId) {
      chrome.windows.remove(approvalWindowId).catch(() => {});
      approvalWindowId = null;
    }
    return;
  }
  
  // Don't process if there's already a pending request
  if (pendingRequest) {
    console.log('[Background] Pending request exists, waiting');
    return;
  }
  
  isProcessingQueue = true;
  const { request, resolve, windowId } = requestQueue.shift();
  
  pendingRequest = request;
  pendingRequestCallback = resolve;
  
  console.log('[Background] Processing request:', request.type, 'from:', request.origin, 'remaining in queue:', requestQueue.length);
  openApprovalPopup(windowId);
  
  // Timeout for this request
  setTimeout(() => {
    if (pendingRequest === request && pendingRequestCallback === resolve) {
      console.log('[Background] Request timeout:', request.type);
      pendingRequestCallback({ error: 'Request timeout' });
      pendingRequestCallback = null;
      pendingRequest = null;
      processNextRequest();
    }
  }, 60000);
}

// Handle connect request
async function handleConnect(origin, favicon, sender, params = {}) {
  // Check if already connected
  const connected = await isSiteConnected(origin);
  if (connected) {
    const wallet = await getActiveWallet();
    const network = await getCurrentNetwork();
    const chain = networkToChain(network);
    
    // If a specific chain is requested and different from current, we may need to switch
    if (params.chain && params.chain !== chain) {
      console.log('[Background] Chain requested:', params.chain, 'current:', chain);
      // For now, just return current - switchChain should be used to change
    }
    
    if (wallet) {
      // Re-register tab if reconnecting
      const tabId = sender?.tab?.id;
      if (tabId) {
        connectedTabs.set(tabId, { origin, publicKey: wallet.publicKey });
        console.log('[Background] Re-registered tab on reconnect:', tabId);
      }
      return { result: { publicKey: wallet.publicKey, network, chain } };
    }
  }
  
  // If onlyIfTrusted is set and site is not connected, reject silently
  if (params.onlyIfTrusted) {
    console.log('[Background] Silent connect rejected - site not trusted:', origin);
    return { error: 'User rejected the request.' };
  }
  
  // Get tab info for registration after approval
  const tabId = sender?.tab?.id;
  const windowId = sender?.tab?.windowId;
  
  // Queue the request
  return new Promise((resolve) => {
    const request = {
      type: 'connect',
      origin,
      favicon,
      chain: params.chain,
      tabId,
      timestamp: Date.now()
    };
    
    queueRequest(request, resolve, windowId);
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
    const sites = await getConnectedSites();
    console.log('[Background] Connected sites:', Object.keys(sites));
    throw new Error('Site not connected');
  }
  
  const windowId = sender?.tab?.windowId;
  
  return new Promise((resolve) => {
    const request = {
      type: 'signTransaction',
      origin,
      transaction: params.transaction,
      timestamp: Date.now()
    };
    
    queueRequest(request, resolve, windowId);
  });
}

// Handle sign all transactions
async function handleSignAllTransactions(params, origin, sender) {
  const connected = await isSiteConnected(origin);
  if (!connected) {
    throw new Error('Site not connected');
  }
  
  const windowId = sender?.tab?.windowId;
  
  return new Promise((resolve) => {
    const request = {
      type: 'signAllTransactions',
      origin,
      transactions: params.transactions,
      timestamp: Date.now()
    };
    
    queueRequest(request, resolve, windowId);
  });
}

// Handle sign and send transaction
async function handleSignAndSendTransaction(params, origin, sender) {
  const connected = await isSiteConnected(origin);
  if (!connected) {
    throw new Error('Site not connected');
  }
  
  const windowId = sender?.tab?.windowId;
  
  return new Promise((resolve) => {
    const request = {
      type: 'signAndSendTransaction',
      origin,
      transaction: params.transaction,
      options: params.options,
      timestamp: Date.now()
    };
    
    queueRequest(request, resolve, windowId);
  });
}

// Handle sign message
async function handleSignMessage(params, origin, sender) {
  const connected = await isSiteConnected(origin);
  if (!connected) {
    throw new Error('Site not connected');
  }
  
  const windowId = sender?.tab?.windowId;
  
  return new Promise((resolve) => {
    const request = {
      type: 'signMessage',
      origin,
      message: params.message,
      timestamp: Date.now()
    };
    
    queueRequest(request, resolve, windowId);
  });
}

// Handle get network
async function handleGetNetwork() {
  const network = await getCurrentNetwork();
  const chain = networkToChain(network);
  return { result: { network, chain } };
}

// Handle approve sign from popup - the popup has already signed, just forward the result
async function handleApproveSign(message) {
  console.log('[Background] handleApproveSign received:', JSON.stringify(message));
  
  // Close fallback approval window if open
  if (approvalWindowId) {
    chrome.windows.remove(approvalWindowId).catch(() => {});
    approvalWindowId = null;
  }
  
  if (message.signedTransaction && pendingRequestCallback) {
    console.log('[Background] Sending signedTransaction back to DApp');
    pendingRequestCallback({ result: { signedTransaction: message.signedTransaction } });
    pendingRequestCallback = null;
    pendingRequest = null;
    setTimeout(processNextRequest, 100);
    return { success: true };
  }
  
  if (message.signedTransactions && pendingRequestCallback) {
    console.log('[Background] Sending signedTransactions back to DApp');
    pendingRequestCallback({ result: { signedTransactions: message.signedTransactions } });
    pendingRequestCallback = null;
    pendingRequest = null;
    setTimeout(processNextRequest, 100);
    return { success: true };
  }
  
  if (message.signature && pendingRequestCallback) {
    console.log('[Background] Sending signature back to DApp:', message.signature);
    pendingRequestCallback({ result: { signature: message.signature } });
    pendingRequestCallback = null;
    pendingRequest = null;
    setTimeout(processNextRequest, 100);
    return { success: true };
  }
  
  if (message.error) {
    console.log('[Background] Sending error back to DApp:', message.error);
    if (pendingRequestCallback) {
      pendingRequestCallback({ error: message.error });
      pendingRequestCallback = null;
      pendingRequest = null;
      setTimeout(processNextRequest, 100);
    }
    return { success: false };
  }
  
  console.log('[Background] Invalid approve-sign message, pendingRequestCallback:', !!pendingRequestCallback);
  return { error: 'Invalid approve-sign message' };
}

// Handle approve sign message from popup
async function handleApproveSignMessage(message) {
  console.log('[Background] handleApproveSignMessage received');
  
  // Close fallback approval window if open
  if (approvalWindowId) {
    chrome.windows.remove(approvalWindowId).catch(() => {});
    approvalWindowId = null;
  }
  
  if (message.signature && pendingRequestCallback) {
    pendingRequestCallback({ result: { signature: message.signature } });
    pendingRequestCallback = null;
    pendingRequest = null;
    setTimeout(processNextRequest, 100);
    return { success: true };
  }
  
  if (message.error) {
    if (pendingRequestCallback) {
      pendingRequestCallback({ error: message.error });
      pendingRequestCallback = null;
      pendingRequest = null;
      setTimeout(processNextRequest, 100);
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

console.log('[X1 Wallet] Background script loaded');