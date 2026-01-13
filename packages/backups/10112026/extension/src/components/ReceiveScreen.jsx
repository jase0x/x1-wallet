// Receive Screen with QR code
import { logger } from '@x1-wallet/core';
import React, { useState, useEffect, useRef } from 'react';
import X1Logo from './X1Logo';

const SOLANA_LOGO_URL = 'https://xdex.s3.us-east-2.amazonaws.com/vimages/solana.png';

function NetworkLogo({ network, size = 40 }) {
  const logoSize = Math.round(size * 0.8);
  if (network?.includes('Solana')) {
    return (
      <div style={{ width: size, height: size, minWidth: size, minHeight: size, borderRadius: '50%', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
        <img src={SOLANA_LOGO_URL} alt="Solana" style={{ width: logoSize, height: logoSize, objectFit: 'contain', display: 'block' }} />
      </div>
    );
  }
  return <X1Logo size={size} />;
}

export default function ReceiveScreen({ wallet, onBack }) {
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef(null);
  const address = wallet.wallet?.publicKey || '';

  useEffect(() => {
    if (!canvasRef.current || !address) return;
    
    // Use solana: URI scheme so wallets/cameras recognize it
    const qrData = `solana:${address}`;
    
    // Dynamically import qrcode library
    import('qrcode').then(QRCode => {
      QRCode.toCanvas(canvasRef.current, qrData, {
        width: 200,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff'
        },
        errorCorrectionLevel: 'M'
      }, (err) => {
        if (err) logger.error('QR generation failed:', err);
      });
    }).catch(err => {
      logger.error('Failed to load QR library:', err);
    });
  }, [address]);

  const copyAddress = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareAddress = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: `${wallet.network} Address`, text: address });
      } else {
        copyAddress();
      }
    } catch (err) {
      if (err.name !== 'AbortError') copyAddress();
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

        <div className="qr-container" style={{ marginBottom: 24 }}>
          <canvas ref={canvasRef} className="qr-code" style={{ borderRadius: 12 }} />
        </div>

        <p className="receive-instructions" style={{ marginBottom: 16 }}>Scan the QR code or copy the address below</p>

        <div className="address-display" style={{ textAlign: 'center', marginBottom: 20 }}><code>{address}</code></div>

        <div className="receive-buttons">
          <button className="receive-btn" onClick={copyAddress}>
            {copied ? (
              <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>Copied!</>
            ) : (
              <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>Copy</>
            )}
          </button>
          <button className="receive-btn secondary" onClick={shareAddress}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg>Share
          </button>
        </div>
      </div>
    </div>
  );
}