import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// OAuth client credentials for the Google Calendar integration are baked into
// the main-process bundle at build time from the build environment (CI secrets
// on release, or a local shell for testing). They are NOT confidential for a
// "Desktop app" client — Google expects them to ship inside the installed app,
// with PKCE providing the real protection — so embedding them is by design.
// When absent (ordinary `npm run build`) the constants are empty and the app
// falls back to a `google-oauth.json` in userData or runtime env vars.
const GOOGLE_OAUTH_CLIENT_ID = JSON.stringify(process.env.GOOGLE_OAUTH_CLIENT_ID ?? '')
const GOOGLE_OAUTH_CLIENT_SECRET = JSON.stringify(process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __GOOGLE_OAUTH_CLIENT_ID__: GOOGLE_OAUTH_CLIENT_ID,
      __GOOGLE_OAUTH_CLIENT_SECRET__: GOOGLE_OAUTH_CLIENT_SECRET
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          // Two HTML entry points: the full app window and the always-on-top mini timer.
          index: resolve(__dirname, 'src/renderer/index.html'),
          mini: resolve(__dirname, 'src/renderer/mini.html')
        }
      }
    }
  }
})
