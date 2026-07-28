import React from 'react'
import { createRoot } from 'react-dom/client'
import { MiniTimer } from './mini/MiniTimer.js'
import './styles/global.css'
import './styles/components.css'
import './styles/mini.css'

if (location.search.includes('server')) {
  const { installHttpBridge } = await import('./lib/httpBridge.js')
  installHttpBridge()
} else if (location.search.includes('demo')) {
  const { installDemoBridge } = await import('./lib/demoBridge.js')
  installDemoBridge()
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MiniTimer />
  </React.StrictMode>
)
