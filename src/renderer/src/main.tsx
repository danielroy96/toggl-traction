import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import './styles/global.css'
import './styles/components.css'
import './styles/app.css'

// Preview outside Electron:
//   `/?demo`   installs an in-memory mock bridge (fake data, any token works)
//   `/?server` installs a bridge to the local dev server (real Toggl account)
if (location.search.includes('server')) {
  const { installHttpBridge } = await import('./lib/httpBridge.js')
  installHttpBridge()
} else if (location.search.includes('demo')) {
  const { installDemoBridge } = await import('./lib/demoBridge.js')
  installDemoBridge()
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
