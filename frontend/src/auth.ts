import { useSyncExternalStore } from 'react'

export interface Session {
  token: string
  role: string
  email: string
  must_change_password: boolean
  store_id?: string
}

const STORAGE_KEY = 'nebacaj_session'

let cachedSession: Session | null = loadSession()
const subscribers = new Set<() => void>()

function emit() {
  for (const cb of subscribers) cb()
}

function handleStorage(e: StorageEvent) {
  if (e.key === STORAGE_KEY) {
    cachedSession = loadSession()
    emit()
  }
}

window.addEventListener('storage', handleStorage)

function subscribeSession(cb: () => void): () => void {
  subscribers.add(cb)
  return () => {
    subscribers.delete(cb)
  }
}

function getSessionSnapshot(): Session | null {
  return cachedSession
}

export function useSession(): Session | null {
  return useSyncExternalStore(subscribeSession, getSessionSnapshot)
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || typeof data.token !== 'string' || typeof data.role !== 'string') return null
    return data as Session
  } catch {
    return null
  }
}

export function saveSession(session: Session): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  cachedSession = session
  emit()
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY)
  cachedSession = null
  emit()
}

export function isWorker(session: Session | null): boolean {
  return session !== null && session.role === 'worker'
}