import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Custom plugin to remove eval patterns from protobufjs/similar dependencies
const removeEvalPlugin = () => {
  return {
    name: 'remove-eval',
    transform(code, id) {
      // Remove the protobufjs eval-based require pattern
      if (code.includes('eval("quire".replace')) {
        code = code.replace(
          /var\s+mod\s*=\s*eval\s*\(\s*["']quire["']\s*\.replace\s*\(\s*\/\^\/\s*,\s*["']re["']\s*\)\s*\)\s*\(\s*moduleName\s*\)\s*;?/g,
          'var mod = null; /* SEC-FIX: removed eval-based require for MV3 CSP compliance */'
        );
      }
      return code;
    },
    generateBundle(options, bundle) {
      // Also fix in final output bundle
      for (const fileName in bundle) {
        const chunk = bundle[fileName];
        if (chunk.type === 'chunk' && chunk.code) {
          chunk.code = chunk.code.replace(
            /var\s+mod\s*=\s*eval\s*\(\s*["']quire["']\s*\.replace\s*\(\s*\/\^\/\s*,\s*["']re["']\s*\)\s*\)\s*\(\s*moduleName\s*\)\s*;?/g,
            'var mod = null; /* SEC-FIX: removed eval-based require for MV3 CSP compliance */'
          );
        }
      }
    }
  };
};

export default defineConfig({
  plugins: [react(), removeEvalPlugin()],
  build: {
    outDir: 'extension',
    minify: false,
	rollupOptions: {
      input: {
        popup: resolve(__dirname, 'index.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]'
      }
    }
  },
  define: {
    'process.env': {},
    global: 'globalThis',
  },
  resolve: {
    alias: {
      buffer: 'buffer',
      // Handle @x1-wallet/core subpath imports (hooks, utils, services)
      '@x1-wallet/core/hooks': resolve(__dirname, '../core/src/hooks'),
      '@x1-wallet/core/utils': resolve(__dirname, '../core/src/utils'),
      '@x1-wallet/core/services': resolve(__dirname, '../core/src/services'),
      // Main package import
      '@x1-wallet/core': resolve(__dirname, '../core/src'),
    }
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis'
      }
    },
    include: ['buffer']
  }
});
