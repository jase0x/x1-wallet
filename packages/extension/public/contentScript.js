/**
 * X1 Wallet Content Script
 * Bridges between the injected provider and the extension
 * X1W-SEC: Uses MessageChannel for secure communication (prevents spoofing)
 */

(function() {
  'use strict';

  // X1W-008: Cache the current origin for secure postMessage
  const currentOrigin = window.location.origin;
  
  // X1W-SEC: Private MessagePort for secure provider communication
  let providerPort = null;

  // Inject the provider script into the page
  function injectProvider() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('provider.js');
      script.onload = function() {
        this.remove();
        // After provider is injected, establish secure channel
        establishSecureChannel();
      };
      (document.head || document.documentElement).appendChild(script);
      console.log('[X1 Wallet] Provider script injected');
    } catch (error) {
      console.error('[X1 Wallet] Failed to inject provider:', error);
    }
  }

  // X1W-SEC: Establish secure MessageChannel with provider
  // Fixed: Added handshake token verification to prevent race condition attacks
  function establishSecureChannel() {
    // Create a MessageChannel - two entangled ports
    const channel = new MessageChannel();
    
    // We keep port1, send port2 to provider
    providerPort = channel.port1;
    
    // X1W-SEC: Generate cryptographically secure handshake token
    // No fallback to Math.random - crypto.randomUUID is supported in all modern browsers
    const handshakeToken = crypto.randomUUID();
    let handshakeVerified = false;
    
    // Handler to verify handshake acknowledgment from provider
    const verifyHandshake = (event) => {
      if (event.data && 
          event.data.type === 'handshake-ack' && 
          event.data.token === handshakeToken) {
        handshakeVerified = true;
        console.log('[X1 Wallet] Handshake verified successfully');
        
        // Now set up the real message handler
        providerPort.onmessage = handleProviderMessage;
      }
    };
    
    // Real message handler for after handshake is verified
    const handleProviderMessage = async (event) => {
      const { type, method, params, id } = event.data;
      
      if (type === 'request') {
        try {
          // Forward request to extension background script
          const response = await chrome.runtime.sendMessage({
            type: 'provider-request',
            method,
            params,
            origin: currentOrigin,
            favicon: getFavicon()
          });

          // Send response back through secure port
          providerPort.postMessage({
            type: 'response',
            id,
            payload: response
          });
        } catch (error) {
          // Send error back through secure port
          providerPort.postMessage({
            type: 'response',
            id,
            payload: { error: error.message || 'Request failed' }
          });
        }
      }
    };
    
    // Start with handshake verification handler
    providerPort.onmessage = verifyHandshake;
    
    // Start the port
    providerPort.start();
    
    // Send port2 to the provider via one-time postMessage
    // Include the handshake token for verification
    window.postMessage({
      target: 'x1-wallet-provider-handshake',
      token: handshakeToken,
      extensionId: chrome.runtime.id
    }, currentOrigin, [channel.port2]);
    
    // X1W-SEC: Timeout for handshake verification
    setTimeout(() => {
      if (!handshakeVerified) {
        console.warn('[X1 Wallet] Handshake not verified within timeout - possible security issue');
      }
    }, 5000);
    
    console.log('[X1 Wallet] Secure channel initiated, awaiting verification');
  }

  // Listen for messages from extension (events like disconnect, account change)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target === 'x1-wallet-content') {
      console.log('[X1 Wallet Content] Forwarding to provider:', message.type, message.payload);
      
      // Use secure port if available, fallback to postMessage
      if (providerPort) {
        providerPort.postMessage({
          type: message.type,
          payload: message.payload
        });
      } else {
        // Fallback for race condition during initialization
        window.postMessage({
          target: 'x1-wallet-provider',
          type: message.type,
          payload: message.payload
        }, currentOrigin);
      }
    }
    // Return false - we don't send async responses
    return false;
  });

  // Get favicon URL
  function getFavicon() {
    const link = document.querySelector("link[rel*='icon']") || 
                 document.querySelector("link[rel='shortcut icon']");
    return link ? link.href : `${window.location.origin}/favicon.ico`;
  }

  // Inject immediately
  injectProvider();

  console.log('[X1 Wallet] Content script loaded for:', window.location.origin);
})();