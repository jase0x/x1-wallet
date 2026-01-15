/**
 * X1 Wallet Content Script
 * Bridges between the injected provider and the extension
 */

(function() {
  'use strict';

  // X1W-008: Cache the current origin for secure postMessage
  const currentOrigin = window.location.origin;

  // Inject the provider script into the page
  function injectProvider() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('provider.js');
      script.onload = function() {
        this.remove();
      };
      (document.head || document.documentElement).appendChild(script);
      console.log('[X1 Wallet] Provider script injected');
    } catch (error) {
      console.error('[X1 Wallet] Failed to inject provider:', error);
    }
  }

  // Inject immediately
  injectProvider();

  // Listen for messages from the page (provider)
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.target !== 'x1-wallet-content') return;

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

        // X1W-008 FIX: Use specific origin instead of wildcard
        window.postMessage({
          target: 'x1-wallet-provider',
          type: 'response',
          id,
          payload: response
        }, currentOrigin);
      } catch (error) {
        // X1W-008 FIX: Use specific origin instead of wildcard
        window.postMessage({
          target: 'x1-wallet-provider',
          type: 'response',
          id,
          payload: { error: error.message || 'Request failed' }
        }, currentOrigin);
      }
    }
  });

  // Listen for messages from extension (events like disconnect, account change)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[X1 Wallet Content] Received message from extension:', message.type);
    
    if (message.target === 'x1-wallet-content') {
      console.log('[X1 Wallet Content] Forwarding to provider:', message.type, message.payload);
      // X1W-008 FIX: Use specific origin instead of wildcard
      window.postMessage({
        target: 'x1-wallet-provider',
        type: message.type,
        payload: message.payload
      }, currentOrigin);
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

  console.log('[X1 Wallet] Content script loaded for:', window.location.origin);
})();