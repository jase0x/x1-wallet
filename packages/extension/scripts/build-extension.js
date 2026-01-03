// Build script for browser extension
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const distDir = './extension';
const publicDir = './public';

// Ensure extension directory exists
if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

// Copy manifest
copyFileSync(
  join(publicDir, 'manifest.json'),
  join(distDir, 'manifest.json')
);

// Copy background script
if (existsSync(join(publicDir, 'background.js'))) {
  copyFileSync(
    join(publicDir, 'background.js'),
    join(distDir, 'background.js')
  );
}

// Copy logo images
['x1.png', 'x1-wallet-logo.png', 'x1-login-logo.png'].forEach(img => {
  if (existsSync(join(publicDir, img))) {
    copyFileSync(
      join(publicDir, img),
      join(distDir, img)
    );
  }
});

// Copy icons folder if exists
const iconsDir = join(distDir, 'icons');
if (existsSync(join(publicDir, 'icons'))) {
  if (!existsSync(iconsDir)) {
    mkdirSync(iconsDir, { recursive: true });
  }
  ['icon16.png', 'icon48.png', 'icon128.png'].forEach(icon => {
    if (existsSync(join(publicDir, 'icons', icon))) {
      copyFileSync(
        join(publicDir, 'icons', icon),
        join(iconsDir, icon)
      );
    }
  });
}

console.log('✓ Extension build complete!');
console.log('  Load the "extension" folder as an unpacked extension.');
