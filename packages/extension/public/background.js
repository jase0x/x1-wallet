// X1 Wallet Background Script
// Handles provider requests from dApps

// Enable side panel on extension icon click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});

// Connected sites storage
const CONNECTED_SITES_KEY = 'x1wallet_connected_sites';
const PENDING_REQUESTS_KEY = 'x1wallet_pending_requests';

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
  return result.x1wallet_network || 'X1 Mainnet';
}

// Store pending request for popup to handle
let pendingRequest = null;
let pendingRequestCallback = null;

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
  
  // Handle provider requests from content script
  if (message.type === 'provider-request') {
    handleProviderRequest(message, sender).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true; // Keep channel open for async response
  }
  
  // Handle responses from popup
  if (message.type === 'provider-response') {
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
          console.log('[Background] Saved connected site:', currentRequest.origin);
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
  if (message.type === 'get-pending-request') {
    sendResponse(pendingRequest);
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
  
  // Get all tabs and send network change to connected ones
  try {
    const tabs = await chrome.tabs.query({});
    
    for (const tab of tabs) {
      if (!tab.url) continue;
      
      try {
        const tabOrigin = new URL(tab.url).origin;
        
        // Only notify connected sites
        if (origins.includes(tabOrigin)) {
          console.log('[Background] Notifying tab:', tab.id, tabOrigin);
          
          // Send message to content script
          chrome.tabs.sendMessage(tab.id, {
            type: 'network-changed',
            target: 'x1-wallet-content',
            payload: { network, chain }
          }).catch(err => {
            // Tab might not have content script loaded
            console.log('[Background] Could not notify tab:', tab.id, err.message);
          });
        }
      } catch (e) {
        // Invalid URL, skip
      }
    }
  } catch (err) {
    console.error('[Background] Error broadcasting network change:', err);
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
      return { result: { publicKey: wallet.publicKey, network, chain } };
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
    pendingRequest = {
      type: 'connect',
      origin,
      favicon,
      chain: params.chain, // Pass requested chain to popup
      timestamp: Date.now()
    };
    
    pendingRequestCallback = resolve;
    
    // Use windows.create directly - more reliable than openPopup
    console.log('[Background] Opening approval window for connect');
    chrome.windows.create({
      url: 'index.html?request=connect',
      type: 'popup',
      width: 400,
      height: 620,
      focused: true
    }).then(win => {
      console.log('[Background] Approval window opened:', win?.id);
    }).catch(err => {
      console.error('[Background] Failed to open approval window:', err);
    });
    
    // Timeout after 60 seconds
    setTimeout(() => {
      if (pendingRequestCallback === resolve) {
        pendingRequestCallback = null;
        pendingRequest = null;
        resolve({ error: 'Request timeout' });
      }
    }, 60000);
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
  
  return new Promise((resolve) => {
    pendingRequest = {
      type: 'signTransaction',
      origin,
      transaction: params.transaction,
      timestamp: Date.now()
    };
    
    pendingRequestCallback = resolve;
    
    // Use windows.create directly - more reliable than openPopup
    // openPopup requires user gesture context which may not exist
    console.log('[Background] Opening approval window for signTransaction');
    chrome.windows.create({
      url: 'index.html?request=sign',
      type: 'popup',
      width: 400,
      height: 620,
      focused: true
    }).then(win => {
      console.log('[Background] Approval window opened:', win?.id);
    }).catch(err => {
      console.error('[Background] Failed to open approval window:', err);
    });
    
    setTimeout(() => {
      if (pendingRequestCallback === resolve) {
        pendingRequestCallback = null;
        pendingRequest = null;
        resolve({ error: 'Request timeout' });
      }
    }, 60000);
  });
}

// Handle sign all transactions
async function handleSignAllTransactions(params, origin, sender) {
  const connected = await isSiteConnected(origin);
  if (!connected) {
    throw new Error('Site not connected');
  }
  
  return new Promise((resolve) => {
    pendingRequest = {
      type: 'signAllTransactions',
      origin,
      transactions: params.transactions,
      timestamp: Date.now()
    };
    
    pendingRequestCallback = resolve;
    
    // Use windows.create directly - more reliable than openPopup
    console.log('[Background] Opening approval window for signAllTransactions');
    chrome.windows.create({
      url: 'index.html?request=signAll',
      type: 'popup',
      width: 400,
      height: 620,
      focused: true
    }).then(win => {
      console.log('[Background] Approval window opened:', win?.id);
    }).catch(err => {
      console.error('[Background] Failed to open approval window:', err);
    });
    
    setTimeout(() => {
      if (pendingRequestCallback === resolve) {
        pendingRequestCallback = null;
        pendingRequest = null;
        resolve({ error: 'Request timeout' });
      }
    }, 60000);
  });
}

// Handle sign and send transaction
async function handleSignAndSendTransaction(params, origin, sender) {
  const connected = await isSiteConnected(origin);
  if (!connected) {
    throw new Error('Site not connected');
  }
  
  return new Promise((resolve) => {
    pendingRequest = {
      type: 'signAndSendTransaction',
      origin,
      transaction: params.transaction,
      options: params.options,
      timestamp: Date.now()
    };
    
    pendingRequestCallback = resolve;
    
    // Use windows.create directly - more reliable than openPopup
    console.log('[Background] Opening approval window for signAndSendTransaction');
    chrome.windows.create({
      url: 'index.html?request=signAndSend',
      type: 'popup',
      width: 400,
      height: 620,
      focused: true
    }).then(win => {
      console.log('[Background] Approval window opened:', win?.id);
    }).catch(err => {
      console.error('[Background] Failed to open approval window:', err);
    });
    
    setTimeout(() => {
      if (pendingRequestCallback === resolve) {
        pendingRequestCallback = null;
        pendingRequest = null;
        resolve({ error: 'Request timeout' });
      }
    }, 60000);
  });
}

// Handle sign message
async function handleSignMessage(params, origin, sender) {
  const connected = await isSiteConnected(origin);
  if (!connected) {
    throw new Error('Site not connected');
  }
  
  return new Promise((resolve) => {
    pendingRequest = {
      type: 'signMessage',
      origin,
      message: params.message,
      timestamp: Date.now()
    };
    
    pendingRequestCallback = resolve;
    
    // Use windows.create directly - more reliable than openPopup
    console.log('[Background] Opening approval window for signMessage');
    chrome.windows.create({
      url: 'index.html?request=signMessage',
      type: 'popup',
      width: 400,
      height: 620,
      focused: true
    }).then(win => {
      console.log('[Background] Approval window opened:', win?.id);
    }).catch(err => {
      console.error('[Background] Failed to open approval window:', err);
    });
    
    setTimeout(() => {
      if (pendingRequestCallback === resolve) {
        pendingRequestCallback = null;
        pendingRequest = null;
        resolve({ error: 'Request timeout' });
      }
    }, 60000);
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
  
  if (message.signedTransaction && pendingRequestCallback) {
    console.log('[Background] Sending signedTransaction back to DApp');
    pendingRequestCallback({ result: { signedTransaction: message.signedTransaction } });
    pendingRequestCallback = null;
    pendingRequest = null;
    return { success: true };
  }
  
  if (message.signedTransactions && pendingRequestCallback) {
    console.log('[Background] Sending signedTransactions back to DApp');
    pendingRequestCallback({ result: { signedTransactions: message.signedTransactions } });
    pendingRequestCallback = null;
    pendingRequest = null;
    return { success: true };
  }
  
  if (message.signature && pendingRequestCallback) {
    console.log('[Background] Sending signature back to DApp:', message.signature);
    pendingRequestCallback({ result: { signature: message.signature } });
    pendingRequestCallback = null;
    pendingRequest = null;
    return { success: true };
  }
  
  if (message.error) {
    console.log('[Background] Sending error back to DApp:', message.error);
    if (pendingRequestCallback) {
      pendingRequestCallback({ error: message.error });
      pendingRequestCallback = null;
      pendingRequest = null;
    }
    return { success: false };
  }
  
  console.log('[Background] Invalid approve-sign message, pendingRequestCallback:', !!pendingRequestCallback);
  return { error: 'Invalid approve-sign message' };
}

// Handle approve sign message from popup
async function handleApproveSignMessage(message) {
  console.log('[Background] handleApproveSignMessage received');
  
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