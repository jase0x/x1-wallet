// X1 Logo Component
import React, { useState } from 'react';

// X1 Logo URL - use the main X1 logo
const X1_LOGO_URL = '/icons/48-x1.png';

export default function X1Logo({ size = 40, className = '' }) {
  const [error, setError] = useState(false);
  
  // Logo at 80% of container (matches other token icons)
  const logoSize = Math.round(size * 0.8);

  if (error) {
    // Fallback SVG if image fails
    return (
      <svg 
        width={size} 
        height={size} 
        viewBox="0 0 100 100" 
        className={className}
        style={{ borderRadius: '50%', display: 'block', flexShrink: 0 }}
      >
        <circle cx="50" cy="50" r="50" fill="#000"/>
        <text 
          x="50" 
          y="64" 
          textAnchor="middle" 
          fill="#0274fb" 
          fontSize="40" 
          fontWeight="bold" 
          fontFamily="Arial, sans-serif"
        >
          X1
        </text>
      </svg>
    );
  }

  // Wrap logo in a circular dark background container
  return (
    <div
      className={`x1-logo-container ${className}`}
      style={{
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
      }}
    >
      <img
        src={X1_LOGO_URL}
        alt="X1"
        style={{ 
          width: logoSize,
          height: logoSize,
          objectFit: 'contain', 
          display: 'block'
        }}
        onError={() => setError(true)}
      />
    </div>
  );
}