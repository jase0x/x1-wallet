import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
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
