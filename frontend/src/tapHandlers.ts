import type { PointerEvent as ReactPointerEvent } from 'react'

type TapSession = { sx: number; sy: number; fn: (() => void) | null }
const tapSessions: Record<number, TapSession> = {}

export function tapHandlers(fn: () => void) {
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      e.preventDefault()
      tapSessions[e.pointerId] = { sx: e.clientX, sy: e.clientY, fn }
    },
    onPointerUp: (e: ReactPointerEvent) => {
      const s = tapSessions[e.pointerId]
      delete tapSessions[e.pointerId]
      if (!s) return
      const dx = e.clientX - s.sx
      const dy = e.clientY - s.sy
      if (Math.abs(dx) <= 10 && Math.abs(dy) <= 10) {
        swallowImminentClick()
        s.fn?.()
      }
    },
    onPointerCancel: (e: ReactPointerEvent) => {
      delete tapSessions[e.pointerId]
    },
  }
}

let lastFocusAt = 0
try {
  document.addEventListener('focusin', () => {
    lastFocusAt = Date.now()
  })
} catch {
  lastFocusAt = 0
}

function swallowImminentClick() {
  let removed = false
  const remove = () => {
    if (removed) return
    removed = true
    document.removeEventListener('click', swallow, true)
  }
  const swallow = (ev: MouseEvent) => {
    ev.stopPropagation()
    ev.preventDefault()
    remove()
  }
  document.addEventListener('click', swallow, true)
  window.setTimeout(remove, 200)
}

export function dismissKeyboard() {
  if (Date.now() - lastFocusAt < 800) return
  const el = document.activeElement
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.blur()
}