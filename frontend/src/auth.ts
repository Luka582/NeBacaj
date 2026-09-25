export interface Session {
  token: string
  role: string
  email: string
  must_change_password: boolean
  store_id?: string
}

const STORAGE_KEY = 'nebacaj_session'

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
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function isWorker(session: Session | null): boolean {
  return session !== null && session.role === 'worker'
}