import { useEffect, useRef } from 'react'

/**
 * Browser-back handling for in-app overlays.
 *
 * Each open overlay ("layer") has its own history entry, plus one permanent
 * "base guard" entry. Pressing back pops one layer (most recently opened
 * first). When no layer is open, back lands on the base guard and triggers a
 * leave request instead of navigating away, so the app can confirm first;
 * `confirmLeave` then steps past the guard and the base page.
 */

interface Layer {
  id: number
  close: () => void
  poppedByBack: boolean
}

const openLayers: Layer[] = []
let idSeq = 0
let guardCount = 0
let pendingPops = 0
let installed = false
let leaveRequest: (() => void) | null = null

function pushGuard() {
  if (typeof window === 'undefined') return
  guardCount += 1
  try {
    window.history.pushState({ ...(window.history.state ?? {}), nebacajGuard: true }, '')
  } catch {
    guardCount -= 1
  }
}

function onPopState() {
  if (pendingPops > 0) {
    pendingPops -= 1
    return
  }
  if (openLayers.length > 0) {
    guardCount = Math.max(0, guardCount - 1)
    const top = openLayers.pop()
    if (top) {
      top.poppedByBack = true
      top.close()
    }
    return
  }
  // Nothing open: re-arm the guard so we stay put, then ask to leave.
  guardCount = Math.max(0, guardCount - 1)
  pushGuard()
  leaveRequest?.()
}

function install() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('popstate', onPopState)
  pushGuard()
}

/** Register the callback fired when back is pressed with nothing open. */
export function enableBackGuard(onLeaveRequest: () => void): () => void {
  install()
  leaveRequest = onLeaveRequest
  return () => {
    if (leaveRequest === onLeaveRequest) leaveRequest = null
  }
}

/** Actually navigate away after the leave request was confirmed. */
export function confirmLeave() {
  if (typeof window === 'undefined') return
  const steps = guardCount + 1
  guardCount = 0
  pendingPops += 1
  window.history.go(-steps)
}

/** Register `onClose` as one back-button step while `active` is true. */
export function useBackLayer(active: boolean, onClose: () => void) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!active) return
    return openLayer(() => closeRef.current())
  }, [active])
}

function openLayer(close: () => void): () => void {
  install()
  const layer: Layer = { id: ++idSeq, close, poppedByBack: false }
  openLayers.push(layer)
  if (guardCount < openLayers.length + 1) pushGuard()
  return () => {
    const index = openLayers.indexOf(layer)
    if (index === -1) return
    openLayers.splice(index, 1)
    if (layer.poppedByBack) return
    if (guardCount > openLayers.length + 1) {
      guardCount -= 1
      pendingPops += 1
      window.history.back()
    }
  }
}