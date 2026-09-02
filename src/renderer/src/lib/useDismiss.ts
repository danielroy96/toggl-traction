import { useEffect, useRef } from 'react'

/** Why an overlay is being dismissed. Callers that restore focus need to know:
 *  a pointer press elsewhere has already moved focus, an Escape has not. */
export type DismissReason = 'pointer' | 'focus-left' | 'window-blur'

/**
 * Dismiss an open overlay when the user has plainly moved on from it: a pointer
 * press outside it, keyboard focus leaving it, or the whole window being
 * deactivated.
 *
 * Escape is deliberately NOT handled here. It is a key press, so it belongs on
 * the overlay's own element rather than on the document — and unlike the three
 * cases above it leaves focus where it was, so what should happen next differs
 * per overlay.
 *
 * `ref` must wrap the whole overlay *including its trigger*: a click on the
 * trigger is a toggle, not an outside press, and focus moving between the two
 * is not focus leaving.
 */
export function useDismiss(
  open: boolean,
  ref: React.RefObject<HTMLElement | null>,
  onDismiss: (reason: DismissReason) => void
): void {
  // Read through a ref so a caller does not have to memoise the callback to
  // avoid tearing the listeners down and rebuilding them on every render.
  const cb = useRef(onDismiss)
  useEffect(() => {
    cb.current = onDismiss
  })

  useEffect(() => {
    if (!open) return
    const root = ref.current
    const outside = (target: EventTarget | null): boolean =>
      !root || !(target instanceof Node) || !root.contains(target)

    // Capture phase, and pointerdown rather than click: dismiss on the way
    // down, before the press can act on whatever is underneath, and before any
    // handler on the way up can stop the event.
    const onPointerDown = (e: PointerEvent): void => {
      if (outside(e.target)) cb.current('pointer')
    }
    // focusout, not blur: blur does not bubble, and focusout names where focus
    // is going. A null relatedTarget means it left the document altogether —
    // a press on something unfocusable, which the pointerdown above already
    // caught, or window deactivation, which is the next handler's job.
    const onFocusOut = (e: FocusEvent): void => {
      if (e.relatedTarget && outside(e.relatedTarget)) cb.current('focus-left')
    }
    const onWindowBlur = (): void => cb.current('window-blur')

    document.addEventListener('pointerdown', onPointerDown, true)
    root?.addEventListener('focusout', onFocusOut)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      root?.removeEventListener('focusout', onFocusOut)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [open, ref])
}
