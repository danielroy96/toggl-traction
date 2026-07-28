import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Standalone renderer dev server for visual/UI verification WITHOUT Electron.
// The app degrades to the sign-in screen when window.toggl is absent.
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  server: {
    port: 5199,
    fs: { allow: [resolve(__dirname)] },
    // Proxy the dev bridge (npm run dev:server) so it's same-origin and the
    // renderer's `connect-src 'self'` CSP is satisfied without loosening it.
    proxy: {
      '/rpc': 'http://localhost:5178',
      '/events': {
        target: 'http://localhost:5178',
        changeOrigin: true
      }
    }
  }
})
