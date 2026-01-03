// Receive Screen
import { logger, getUserFriendlyError, ErrorMessages } from '@x1-wallet/core';
import React, { useState, useEffect, useRef } from 'react';
import X1Logo from './X1Logo';

// Solana Logo
const SOLANA_LOGO_URL = 'https://xdex.s3.us-east-2.amazonaws.com/vimages/solana.png';

function NetworkLogo({ network, size = 40 }) {
  const logoSize = Math.round(size * 0.8); // 80% of container
  
  if (network?.includes('Solana')) {
    return (
      <div style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        borderRadius: '50%',
        background: '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        overflow: 'hidden'
      }}>
        <img 
          src={SOLANA_LOGO_URL}
          alt="Solana"
          style={{
            width: logoSize,
            height: logoSize,
            objectFit: 'contain',
            display: 'block'
          }}
        />
      </div>
    );
  }
  return <X1Logo size={size} />;
}

export default function ReceiveScreen({ wallet, onBack }) {
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef(null);
  const address = wallet.wallet?.publicKey || '';

  // Generate QR code on canvas
  useEffect(() => {
    if (!canvasRef.current || !address) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const size = 200;
    canvas.width = size;
    canvas.height = size;
    
    // Simple QR-like pattern (for display purposes)
    // In production, use a proper QR library
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    
    ctx.fillStyle = '#000000';
    const moduleSize = 8;
    const modules = Math.floor(size / moduleSize);
    
    // Generate pattern from address
    for (let i = 0; i < modules; i++) {
      for (let j = 0; j < modules; j++) {
        const charIndex = (i * modules + j) % address.length;
        const charCode = address.charCodeAt(charIndex);
        if ((charCode + i + j) % 3 !== 0) {
          ctx.fillRect(i * moduleSize, j * moduleSize, moduleSize - 1, moduleSize - 1);
        }
      }
    }
    
    // Position detection patterns (corners)
    const drawFinder = (x, y) => {
      ctx.fillStyle = '#000000';
      ctx.fillRect(x, y, moduleSize * 7, moduleSize * 7);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + moduleSize, y + moduleSize, moduleSize * 5, moduleSize * 5);
      ctx.fillStyle = '#000000';
      ctx.fillRect(x + moduleSize * 2, y + moduleSize * 2, moduleSize * 3, moduleSize * 3);
    };
    
    drawFinder(0, 0);
    drawFinder(size - moduleSize * 7, 0);
    drawFinder(0, size - moduleSize * 7);
  }, [address]);

  const copyAddress = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareAddress = async () => {
    const shareData = {
      title: `${wallet.network} Address`,
      text: `My ${wallet.network} wallet address: ${address}`,
      url: undefined
    };
    
    try {
      if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
        await navigator.share(shareData);
      } else {
        // Fallback to copy
        await navigator.clipboard.writeText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (err) {
      // User cancelled or share failed, try copy as fallback
      if (err.name !== 'AbortError') {
        try {
          await navigator.clipboard.writeText(address);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch (e) {
          logger.error('Failed to share or copy:', e);
        }
      }
    }
  };

  return (
    <div className="screen receive-screen">
      <div className="sub-screen-header">
        <button className="back-btn" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <h2>Receive</h2>
      </div>

      <div className="receive-content">
        <div className="receive-token">
          <NetworkLogo network={wallet.network} size={40} />
          <span>{wallet.network}</span>
        </div>

        <div className="qr-container">
          <canvas ref={canvasRef} className="qr-code" />
        </div>

        <p className="receive-instructions">
          Scan the QR code or copy the address below to receive tokens
        </p>

        <div className="address-display">
          <code>{address}</code>
        </div>

        <div className="receive-buttons">
          <button className="receive-btn" onClick={copyAddress}>
            {copied ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                Copy
              </>
            )}
          </button>

          <button className="receive-btn secondary" onClick={shareAddress}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            Share
          </button>
        </div>
      </div>
    </div>
  );
}
