/**
 * X1 Wallet Content Script
 * Bridges between the injected provider and the extension
 * Uses long-lived port connection for reliable event broadcasting
 */

(function() {
  'use strict';

  // X1W-008: Cache the current origin for secure postMessage
  const currentOrigin = window.location.origin;

  // ====== PORT-BASED CONNECTION FOR RELIABLE EVENT BROADCASTING ======
  let eventPort = null;
  let portReconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_DELAY_MS = 1000;

  // Establish port connection with background script
  function connectEventPort() {
    try {
      eventPort = chrome.runtime.connect({ name: 'x1-wallet-events' });
      console.log('[X1 Wallet] Event port connected');
      portReconnectAttempts = 0;
      
      // Handle messages from background via port
      eventPort.onMessage.addListener((message) => {
        console.log('[X1 Wallet ContentScript] Raw port message received:', message);
        
        if (message.target === 'x1-wallet-content') {
          console.log('[X1 Wallet ContentScript] ✅ Port received from background:', message.type, JSON.stringify(message.payload));
          
          // Forward to injected provider
          window.postMessage({
            target: 'x1-wallet-provider',
            type: message.type,
            payload: message.payload
          }, currentOrigin);
          
          console.log('[X1 Wallet ContentScript] ✅ Forwarded to page:', message.type);
        } else {
          console.log('[X1 Wallet ContentScript] ⚠️ Message ignored (wrong target):', message.target);
        }
      });
      
      // Handle port disconnect - attempt reconnection
      eventPort.onDisconnect.addListener(() => {
        console.log('[X1 Wallet] Event port disconnected');
        eventPort = null;
        
        // Attempt reconnection with backoff
        if (portReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          portReconnectAttempts++;
          const delay = RECONNECT_DELAY_MS * portReconnectAttempts;
          console.log('[X1 Wallet] Attempting reconnect in', delay, 'ms (attempt', portReconnectAttempts, ')');
          setTimeout(connectEventPort, delay);
        } else {
          console.log('[X1 Wallet] Max reconnect attempts reached, giving up');
        }
      });
    } catch (error) {
      console.error('[X1 Wallet] Failed to connect event port:', error);
      
      // Retry after delay
      if (portReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        portReconnectAttempts++;
        setTimeout(connectEventPort, RECONNECT_DELAY_MS * portReconnectAttempts);
      }
    }
  }

  // Connect port immediately
  connectEventPort();
  // ====== END PORT-BASED CONNECTION ======

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
  // This is a fallback - primary method is via port
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target === 'x1-wallet-content') {
      console.log('[X1 Wallet] Content script received from background (fallback):', message.type, message.payload);
      
      // X1W-008 FIX: Use specific origin instead of wildcard
      window.postMessage({
        target: 'x1-wallet-provider',
        type: message.type,
        payload: message.payload
      }, currentOrigin);
      
      console.log('[X1 Wallet] Content script forwarded to page:', message.type);
    }
    return true;
  });

  // Get favicon URL
  function getFavicon() {
    const link = document.querySelector("link[rel*='icon']") || 
                 document.querySelector("link[rel='shortcut icon']");
    return link ? link.href : `${window.location.origin}/favicon.ico`;
  }

  console.log('[X1 Wallet] Content script loaded for:', window.location.origin);
})();