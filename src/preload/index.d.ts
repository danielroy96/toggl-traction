import type { TogglTractionApi } from './index.js'

declare global {
  interface Window {
    toggl: TogglTractionApi
  }
}

export {}
