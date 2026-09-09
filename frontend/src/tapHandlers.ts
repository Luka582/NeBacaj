import type { PointerEvent as ReactPointerEvent } from 'react'

type TapSession = { sx: number; sy: number; fn: (() => void) | null }
const tapSessions: Record<number, TapSession> = {}

export function tapHandlers(fn: () => void) {
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      tapSessions[e.pointerId] = { sx: e.clientX, sy: e.clientY, fn }
    },
    onPointerUp: (e: ReactPointerEvent) => {
      const s = tapSessions[e.pointerId]
      delete tapSessions[e.pointerId]
      if (!s) return
      const dx = e.clientX - s.sx
      const dy = e.clientY - s.sy
      if (Math.abs(dx) <= 10 && Math.abs(dy) <= 10) s.fn?.()
    },
    onPointerCancel: (e: ReactPointerEvent) => {
      delete tapSessions[e.pointerId]
    },
  }
}