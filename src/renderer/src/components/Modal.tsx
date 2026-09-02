import { useEffect, useRef } from 'react'
import type { JSX } from 'react'

interface Props {
  title: string
  onClose: () => void
  children: React.ReactNode
}

/**
 * Accessible modal dialog: role="dialog" + aria-modal, focus is moved in on
 * open and restored on close, Tab is trapped inside, and Escape / backdrop
 * click close it. Kept dependency-free.
 *
 * Escape is claimed innermost-first: a dropdown open inside the dialog gets the
 * key press, and only once nothing inside wants it does the dialog itself
 * close. See the listener registration below for how that is arranged.
 */
export function Modal({ title, onClose, children }: Props): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const titleId = 'modal-title'

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null
    // Focus the first focusable element in the dialog.
    const focusables = getFocusable(dialogRef.current)
    focusables[0]?.focus()

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'Tab') {
        const items = getFocusable(dialogRef.current)
        if (items.length === 0) return
        const first = items[0]!
        const last = items[items.length - 1]!
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    /*
     * Bubble phase, deliberately — this used to capture, which meant the dialog
     * saw Escape before anything inside it did and one key press closed both an
     * open dropdown and the dialog behind it. Listening on the way back up lets
     * a nested overlay handle Escape and stop it, and anything that reaches
     * here unclaimed is genuinely meant for the dialog.
     *
     * The Tab trap is unaffected: it works by preventing the default focus
     * move, which is still ahead of it in the bubble phase.
     */
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused.current?.focus?.()
    }
  }, [])

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="modal card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
      >
        <div className="modal__header">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close dialog">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function getFocusable(root: HTMLElement | null): HTMLElement[] {
  if (!root) return []
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)
}
