import { useEffect } from 'react'
import type { AppSettings } from '../../../shared/types.js'

/**
 * Applies theme and font scaling to the document root.
 *
 * Font scaling: `--user-font-scale` multiplies the OS/browser default font
 * size (the tokens set `font-size: calc(100% * var(--user-font-scale))`), so
 * 'system' (=1) means "respect the OS accessibility text size exactly", and a
 * numeric value scales further on top of that.
 */
export function useAppearance(settings: AppSettings | null): void {
  useEffect(() => {
    if (!settings) return
    const root = document.documentElement

    // Theme. 'system' follows the OS via prefers-color-scheme.
    if (settings.theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: light)')
      const apply = (): void =>
        root.setAttribute('data-theme', mq.matches ? 'light' : 'dark')
      apply()
      mq.addEventListener('change', apply)
      // Font scale still needs applying below; return cleanup for the listener.
      const scale = settings.fontScale === 'system' ? 1 : settings.fontScale
      root.style.setProperty('--user-font-scale', String(scale))
      return () => mq.removeEventListener('change', apply)
    }

    root.setAttribute('data-theme', settings.theme)
    const scale = settings.fontScale === 'system' ? 1 : settings.fontScale
    root.style.setProperty('--user-font-scale', String(scale))
    return undefined
  }, [settings])
}
