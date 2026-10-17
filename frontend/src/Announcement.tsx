import { useEffect, useRef, useState } from 'react'
import { loadSession, clearSession, isWorker } from './auth'
import type { Session } from './auth'
import { belgradeDateKey, cropImageUrl, formatMinutes, getSerbiaWeekday, getSerbiaMinutes } from './format'
import CameraCapture from './CameraCapture'
import { dismissKeyboard } from './tapHandlers'
import { useViewportHeight } from './useViewportHeight'
import { useBackLayer } from './backStack'
import { DESC_MAX, CharCounter } from './CharCounter'

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

const API_ERRORS: Record<string, string> = {
  'You do not manage this store': 'Nemate pravo pristupa ovoj prodavnici.',
  'Not authenticated': 'Niste prijavljeni.',
  'Invalid or expired token': 'Sesija je istekla, prijavite se ponovo.',
  'Store not found': 'Prodavnica nije pronađena.',
  'Store is closed': 'Prodavnica je trenutno zatvorena. Obaveštenje možete aktivirati dok je prodavnica otvorena.',
  'A schedule can only be set in periodic mode': 'Raspored je moguć samo u periodičnom režimu.',
  'Announcement schedule needs both start and duration': 'Unesite i početak i kraj za svaki izabrani dan.',
  'Announcement working minutes must be positive': 'Kraj mora biti posle početka.',
  'Announcements cannot be scheduled on a closed day': 'Obaveštenje ne može biti zakazano na dan kada je prodavnica zatvorena.',
  "Announcement schedule must fall within the store's working hours": 'Obaveštenje mora biti u okviru radnog vremena prodavnice.',
  'Uploaded file must be an image': 'Dodati fajl mora biti slika.',
  'Image too large (max 10 MB)': 'Slika je prevelika (maks. 10 MB).',
  'Provide either image_url or an image file, not both': 'Izaberite ili sliku ili URL, ne oboje.',
  'Image upload failed': 'Slanje slike nije uspelo. Pokušajte ponovo.',
}

function submitError(data: unknown): string {
  if (data && typeof data === 'object' && 'detail' in data) {
    const detail = (data as { detail: unknown }).detail
    if (typeof detail === 'string') return API_ERRORS[detail] ?? detail
  }
  return 'Uneti podaci nisu ispravni.'
}

interface ApiStore {
  id: string
  name: string
  announcement_description: string | null
  announcement_image_url: string | null
  announcement_periodic: boolean
  announcement_activated_at: string | null
  [key: string]: unknown
}

const DAYS = [
  { key: 'mon', label: 'Ponedeljak', js: 1 },
  { key: 'tue', label: 'Utorak', js: 2 },
  { key: 'wed', label: 'Sreda', js: 3 },
  { key: 'thu', label: 'Četvrtak', js: 4 },
  { key: 'fri', label: 'Petak', js: 5 },
  { key: 'sat', label: 'Subota', js: 6 },
  { key: 'sun', label: 'Nedelja', js: 0 },
]

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function storeOpenNow(s: ApiStore): boolean {
  const js = getSerbiaWeekday()
  const day = DAYS.find((d) => d.js === js)
  if (!day) return false
  const open = num(s[`opening_minute_${day.key}`]) ?? 0
  const work = num(s[`working_minutes_${day.key}`]) ?? 0
  const cur = getSerbiaMinutes()
  if (work > 0 && open <= cur && cur < open + work) return true
  const prev = DAYS.find((d) => d.js === (js + 6) % 7)
  if (!prev) return false
  const pOpen = num(s[`opening_minute_${prev.key}`]) ?? 0
  const pWork = num(s[`working_minutes_${prev.key}`]) ?? 0
  return pWork > 0 && pOpen + pWork > 1440 && cur < pOpen + pWork - 1440
}

// Serbia wall-clock components of an ISO string as an epoch-ms-like number.
// The backend sends naive wall time; the immediate toggle response is timezone-aware
// but always Europe/Belgrade, so the leading Y-M-D H:M(:S) components are wall time either way.
function wallMs(iso: string | null): number | null {
  if (!iso) return null
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return null
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0))
}

function serbiaDayMs(offsetDays: number): number {
  const [y, mo, d] = belgradeDateKey(offsetDays).split('-').map(Number)
  return Date.UTC(y, mo - 1, d)
}

function announcementActiveNow(s: ApiStore): boolean {
  if (!s.announcement_periodic) {
    // Mirrors backend `_announcement_active`: a manual announcement is visible only
    // while the activation timestamp falls inside the store's currently active shift.
    const act = wallMs(s.announcement_activated_at)
    if (act == null) return false
    const js = getSerbiaWeekday()
    const cur = getSerbiaMinutes()
    const today = DAYS.find((d) => d.js === js)
    const prev = DAYS.find((d) => d.js === (js + 6) % 7)
    if (!today || !prev) return false
    const tOpen = num(s[`opening_minute_${today.key}`]) ?? 0
    const tWork = num(s[`working_minutes_${today.key}`]) ?? 0
    if (tWork > 0 && cur >= tOpen && cur < tOpen + tWork) {
      const start = serbiaDayMs(0) + tOpen * 60000
      return act >= start && act < start + tWork * 60000
    }
    const pOpen = num(s[`opening_minute_${prev.key}`]) ?? 0
    const pWork = num(s[`working_minutes_${prev.key}`]) ?? 0
    if (pOpen + pWork > 1440 && cur < pOpen + pWork - 1440) {
      const start = serbiaDayMs(-1) + pOpen * 60000
      return act >= start && act < start + pWork * 60000
    }
    return false
  }
  const js = getSerbiaWeekday()
  const cur = getSerbiaMinutes()
  const day = DAYS.find((d) => d.js === js)
  if (!day) return false
  const open = num(s[`announcement_open_min_${day.key}`])
  const work = num(s[`announcement_work_min_${day.key}`])
  if (open != null && work != null && work > 0 && open <= cur && cur < open + work) return true
  const prev = DAYS.find((d) => d.js === (js + 6) % 7)
  if (!prev) return false
  const pOpen = num(s[`announcement_open_min_${prev.key}`])
  const pWork = num(s[`announcement_work_min_${prev.key}`])
  return pOpen != null && pWork != null && pWork > 0 && pOpen + pWork > 1440 && cur < pOpen + pWork - 1440
}

interface TimeEntry {
  enabled: boolean
  start: string
  end: string
}

function storeDefaultTimes(s: ApiStore): Record<string, TimeEntry> {
  const next: Record<string, TimeEntry> = {}
  for (const d of DAYS) {
    const open = num(s[`opening_minute_${d.key}`])
    const work = num(s[`working_minutes_${d.key}`])
    next[d.key] =
      open != null && work != null && work > 0
        ? { enabled: true, start: formatMinutes(open), end: formatMinutes((open + work) % 1440) }
        : { enabled: false, start: '', end: '' }
  }
  return next
}

function normalizeTime(value: string): string {
  if (!value) return value
  const m = value.match(/^(\d{1,2})(?::(\d{1,2}))?$/)
  if (!m) return value
  const h = m[1].padStart(2, '0')
  const minutes = (m[2] ?? '0').padStart(2, '0')
  return `${h}:${minutes}`
}

function parseClock(value: string): number | null | 'invalid' {
  if (!value) return null
  const m = value.match(/^(\d{1,2}):(\d{1,2})$/)
  if (!m) return 'invalid'
  const h = Number(m[1])
  const mi = Number(m[2])
  if (h > 24 || mi > 59 || (h === 24 && mi !== 0)) return 'invalid'
  return h * 60 + mi
}

function scheduleDayError(store: ApiStore | null, key: string, entry: TimeEntry): string | null {
  if (!entry.enabled) return null
  const start = parseClock(entry.start)
  const end = parseClock(entry.end)
  if (start === 'invalid' || end === 'invalid') return 'Vreme mora biti u formatu HH:MM (sati 0–24, minuti 0–59).'
  if (start === null || end === null) return 'Unesite i početak i kraj.'
  let work = end - start
  if (work < 0) work += 1440
  if (work === 0) return 'Kraj ne može biti jednak početku.'
  const storeOpen = store ? num(store[`opening_minute_${key}`]) : null
  const storeWork = store ? num(store[`working_minutes_${key}`]) : null
  if (storeWork == null || storeWork <= 0) return 'Prodavnica je tog dana zatvorena.'
  if (storeOpen == null) return null
  if (start < storeOpen || start + work > storeOpen + storeWork) {
    return 'Termin mora biti u okviru radnog vremena prodavnice.'
  }
  return null
}

function TimeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      placeholder="HH:MM"
      maxLength={5}
      value={value}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, '').slice(0, 4)
        const formatted = digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`
        onChange(formatted)
      }}
      onBlur={() => onChange(normalizeTime(value))}
      className="w-full min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-center text-sm font-normal text-slate-800 tabular-nums outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-100"
    />
  )
}

function Announcement({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const [session, setSession] = useState<Session | null>(loadSession())
  const vh = useViewportHeight()
  const [view, setView] = useState<'main' | 'general' | 'schedule'>('main')
  const [store, setStore] = useState<ApiStore | null>(null)
  const [storeId, setStoreId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMessage, setOkMessage] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [periodic, setPeriodic] = useState(false)
  const [times, setTimes] = useState<Record<string, { enabled: boolean; start: string; end: string }>>({})
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [filePreview, setFilePreview] = useState<string | null>(null)
  const [removeImage, setRemoveImage] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null)

  useBackLayer(view !== 'main', () => setView('main'))
  useBackLayer(cameraOpen, () => setCameraOpen(false))
  useBackLayer(confirmRemoveOpen, () => setConfirmRemoveOpen(false))

  function applyStore(s: ApiStore) {
    setDescription(s.announcement_description ?? '')
    setPeriodic(s.announcement_periodic)
    setImageUrl(s.announcement_image_url)
    setFile(null)
    setFilePreview(null)
    setRemoveImage(false)
    const next: Record<string, { enabled: boolean; start: string; end: string }> = {}
    for (const d of DAYS) {
      const o = num(s[`announcement_open_min_${d.key}`])
      const w = num(s[`announcement_work_min_${d.key}`])
      next[d.key] =
        o != null && w != null
          ? { enabled: true, start: formatMinutes(o), end: formatMinutes((o + w) % 1440) }
          : { enabled: false, start: '', end: '' }
    }
    setTimes(next)
  }

  async function load(s: Session) {
    setLoading(true)
    setError(null)
    try {
      let id = s.store_id ?? null
      if (!id) {
        const res = await fetch('/api/auth/me', { headers: bearer(s.token) })
        if (res.status === 401) {
          clearSession()
          setSession(null)
          return
        }
        if (!res.ok) throw new Error('Nije moguće učitati podatke o nalogu.')
        const me = (await res.json()) as { store_id: string | null }
        if (!me.store_id) throw new Error('Nalog nije povezan ni sa jednom prodavnicom.')
        id = me.store_id
        const updated = { ...s, store_id: id }
        setSession(updated)
      }
      const storeRes = await fetch(`/api/store/${id}`)
      if (!storeRes.ok) throw new Error('Ne mogu da učitam prodavnicu.')
      const data = (await storeRes.json()) as ApiStore
      setStoreId(id)
      setStore(data)
      applyStore(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Greška pri učitavanju.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (session && isWorker(session)) load(session)
    else setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function autoResizeTextarea(el: HTMLTextAreaElement | null) {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  function buildGeneralPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = { description, periodic }
    if (file) {
      // uploaded as a file part, no image_url field
    } else if (removeImage) {
      payload.image_url = null
    }
    return payload
  }

  function buildSchedulePayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {}
    for (const d of DAYS) {
      const entry = times[d.key]
      if (!entry || !entry.enabled) {
        payload[`open_min_${d.key}`] = null
        payload[`work_min_${d.key}`] = null
        continue
      }
      const start = parseClock(entry.start)
      const end = parseClock(entry.end)
      if (typeof start !== 'number' || typeof end !== 'number') continue
      let work = end - start
      if (work < 0) work += 1440
      payload[`open_min_${d.key}`] = start
      payload[`work_min_${d.key}`] = work
    }
    return payload
  }

  async function send(payload: Record<string, unknown>, withFile: boolean) {
    if (!session) return null
    const fd = new FormData()
    fd.append('data', JSON.stringify(payload))
    if (withFile && file) fd.append('image', file)
    const res = await fetch(`/api/stores/${storeId}/announcement`, {
      method: 'PUT',
      headers: bearer(session.token),
      body: fd,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setError(submitError(data))
      return null
    }
    return data as ApiStore
  }

  async function saveGeneral() {
    if (!storeId) return
    if (description.trim().length > DESC_MAX) {
      setError(`Opis može imati najviše ${DESC_MAX} karaktera.`)
      return
    }
    setBusy(true)
    setError(null)
    setOkMessage(null)
    try {
      const data = await send(buildGeneralPayload(), true)
      if (data) {
        setStore(data)
        applyStore(data)
        setOkMessage('Obaveštenje je sačuvano.')
        setView('main')
        onSaved?.()
      }
    } catch {
      setError('Greška u mreži.')
    } finally {
      setBusy(false)
    }
  }

  async function saveSchedule() {
    if (!storeId) return
    if (scheduleErrors.size > 0) {
      setError('Ispravite greške u rasporedu pre čuvanja.')
      return
    }
    setBusy(true)
    setError(null)
    setOkMessage(null)
    try {
      const data = await send(buildSchedulePayload(), false)
      if (data) {
        setStore(data)
        applyStore(data)
        setOkMessage('Raspored je sačuvan.')
        setView('main')
        onSaved?.()
      }
    } catch {
      setError('Greška u mreži.')
    } finally {
      setBusy(false)
    }
  }

  async function toggleManual(next: boolean) {
    if (!storeId) return
    setBusy(true)
    setError(null)
    setOkMessage(null)
    try {
      const data = await send({ manual_active: next }, false)
      if (data) {
        setStore(data)
        applyStore(data)
        setOkMessage(next ? 'Obaveštenje je aktivirano.' : 'Obaveštenje je deaktivirano.')
        onSaved?.()
      }
    } catch {
      setError('Greška u mreži.')
    } finally {
      setBusy(false)
    }
  }

  function pickFile(f: File | null) {
    if (filePreview) URL.revokeObjectURL(filePreview)
    if (!f) {
      setFile(null)
      setFilePreview(null)
      return
    }
    setFile(f)
    setFilePreview(URL.createObjectURL(f))
    setRemoveImage(false)
  }

  function choosePeriodic(value: boolean) {
    setPeriodic(value)
    const hasAny = Object.values(times).some((t) => t.start || t.end)
    if (value && !hasAny && store) setTimes(storeDefaultTimes(store))
  }

  const active = store ? announcementActiveNow(store) : false
  const openNow = store ? storeOpenNow(store) : false

  const scheduleErrors = new Map<string, string>()
  for (const d of DAYS) {
    const entry = times[d.key] ?? { enabled: false, start: '', end: '' }
    const msg = scheduleDayError(store, d.key, entry)
    if (msg) scheduleErrors.set(d.key, msg)
  }

  function statusBadge() {
    return (
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-bold ${
          active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
        }`}
      >
        {active ? 'Aktivno' : 'Neaktivno'}
      </span>
    )
  }

  return (
    <div
      className="fixed inset-0 z-[2000] flex flex-col bg-white"
      style={{ height: `${vh}px` }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <header className="shrink-0 border-b border-slate-100">
        <div className="mx-auto flex w-full max-w-lg items-center gap-3 px-4 py-3 md:max-w-2xl">
          <button
            type="button"
            onClick={onClose}
            aria-label="Nazad"
            className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 active:bg-slate-100"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-slate-900">Opšte obaveštenje</h1>
          {!loading && session && isWorker(session) && view !== 'main' && (
            <button
              type="button"
              onClick={() => setView('main')}
              className="shrink-0 text-sm font-semibold text-slate-500 active:text-slate-700"
            >
              Pregled
            </button>
          )}
        </div>
      </header>

      <div
        onWheel={dismissKeyboard}
        onTouchMove={dismissKeyboard}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div
          className="mx-auto w-full max-w-lg space-y-4 px-4 py-4 md:max-w-2xl"
          style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
        >
          {!session || !isWorker(session) ? (
            <p className="py-10 text-center text-sm text-slate-500">Prijavite se kao radnik.</p>
          ) : loading ? (
            <div className="flex flex-col items-center gap-3 pt-10">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
              <p className="text-sm text-slate-500">Učitavanje...</p>
            </div>
          ) : (
            <>
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
              {okMessage && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{okMessage}</p>}

              {view === 'main' ? (
                <>
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-700">Stanje obaveštenja</p>
                      {statusBadge()}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Režim: <span className="font-semibold">{periodic ? 'Periodično' : 'Ručno'}</span>
                    </p>

                    {(filePreview || imageUrl) && (
                      <img
                        src={filePreview ?? cropImageUrl(imageUrl as string, 640, 360)}
                        alt=""
                        className="mt-3 h-32 w-full rounded-xl object-cover"
                      />
                    )}
                    <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap text-slate-700">
                      {description || <span className="text-slate-400">Nema opisa</span>}
                    </p>
                  </div>

                  {!periodic && (
                    <div className="rounded-2xl border border-slate-200 p-4">
                      {!openNow && !active && (
                        <p className="mb-2 text-xs text-slate-500">
                          Prodavnica je zatvorena — aktiviranje je moguće dok je otvorena.
                        </p>
                      )}
                      <button
                        type="button"
                        disabled={busy || (!active && !openNow)}
                        onClick={() => toggleManual(!active)}
                        className={`w-full rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-40 ${
                          active ? 'bg-red-500 active:bg-red-600' : 'bg-brand-600 active:bg-brand-700'
                        }`}
                      >
                        {active ? 'Deaktiviraj' : 'Aktiviraj'}
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setError(null)
                      setOkMessage(null)
                      setView('general')
                    }}
                    className="w-full rounded-xl border border-slate-200 py-3 text-sm font-semibold text-brand-700 active:bg-brand-50"
                  >
                    Izmeni obaveštenje
                  </button>
                  {periodic && (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null)
                        setOkMessage(null)
                        setView('schedule')
                      }}
                      className="w-full rounded-xl border border-slate-200 py-3 text-sm font-semibold text-brand-700 active:bg-brand-50"
                    >
                      Izmeni raspored
                    </button>
                  )}
                </>
              ) : view === 'general' ? (
                <>
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <label className="block text-sm font-semibold text-slate-700">Opis</label>
                      <CharCounter current={description.length} max={DESC_MAX} />
                    </div>
                    <textarea
                      ref={descriptionRef}
                      maxLength={DESC_MAX}
                      value={description}
                      onChange={(e) => {
                        setDescription(e.target.value)
                        autoResizeTextarea(e.target)
                      }}
                      rows={3}
                      placeholder="Tekst obaveštenja..."
                      className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-100"
                    />
                  </div>

                  <div>
                    <p className="mb-1 text-sm font-semibold text-slate-700">Slika</p>
                    <div className="relative overflow-hidden rounded-xl border border-slate-200">
                      {filePreview || imageUrl ? (
                        <img
                          src={filePreview ?? cropImageUrl(imageUrl as string, 960, 540)}
                          alt=""
                          className="h-48 w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-48 items-center justify-center bg-slate-50 text-sm text-slate-400">
                          Nema slike
                        </div>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 active:bg-slate-100"
                      >
                        Biraj iz galerije
                      </button>
                      <button
                        type="button"
                        onClick={() => setCameraOpen(true)}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 active:bg-slate-100"
                      >
                        Uslikaj kamerom
                      </button>
                      {(file || imageUrl) && (
                        <button
                          type="button"
                          onClick={() => setConfirmRemoveOpen(true)}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 active:bg-red-50"
                        >
                          Ukloni sliku
                        </button>
                      )}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                      />
                    </div>
                  </div>

                  <div>
                    <p className="mb-1 text-sm font-semibold text-slate-700">Režim</p>
                    <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
                      {[
                        { value: false, label: 'Ručno' },
                        { value: true, label: 'Periodično' },
                      ].map((opt) => (
                        <button
                          key={String(opt.value)}
                          type="button"
                          onClick={() => choosePeriodic(opt.value)}
                          className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                            periodic === opt.value ? 'bg-brand-600 text-white' : 'text-slate-600'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {periodic
                        ? 'Obaveštenje se prikazuje automatski u zadatim terminima.'
                        : 'Obaveštenje uključujete i isključujete ručno na pregledu.'}
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={saveGeneral}
                    className="w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white active:bg-brand-700 disabled:opacity-50"
                  >
                    Sačuvaj
                  </button>
                  <button
                    type="button"
                    onClick={() => setView('main')}
                    className="w-full rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-600 active:bg-slate-50"
                  >
                    Otkaži
                  </button>
                </>
              ) : (
                <>
                  <div className="rounded-xl border border-slate-200 p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-700">Termini po danima</p>
                      <button
                        type="button"
                        onClick={() => store && setTimes(storeDefaultTimes(store))}
                        className="shrink-0 text-xs font-semibold text-brand-700"
                      >
                        Popuni radnim vremenom
                      </button>
                    </div>
                    {DAYS.map((d) => {
                      const storeOpen = num(store?.[`opening_minute_${d.key}`])
                      const storeWork = num(store?.[`working_minutes_${d.key}`]) ?? 0
                      const entry = times[d.key] ?? { enabled: false, start: '', end: '' }
                      const dayError = scheduleErrors.get(d.key)
                      if (storeWork <= 0) {
                        return (
                          <div
                            key={d.key}
                            className="flex items-center justify-between border-b border-slate-50 py-2 text-sm last:border-b-0"
                          >
                            <span className="text-slate-400">{d.label}</span>
                            <span className="text-xs text-slate-400">zatvoreno</span>
                          </div>
                        )
                      }
                      return (
                        <div key={d.key} className="border-b border-slate-50 py-2 last:border-b-0">
                          <div className="flex items-center justify-between gap-2">
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={entry.enabled}
                                onChange={(e) =>
                                  setTimes((t) => ({ ...t, [d.key]: { ...entry, enabled: e.target.checked } }))
                                }
                                className="h-4 w-4 accent-brand-600"
                              />
                              <span className="text-sm text-slate-600">{d.label}</span>
                            </label>
                            <span className="text-xs text-slate-400">
                              radno {formatMinutes(storeOpen ?? 0)}–{formatMinutes(((storeOpen ?? 0) + storeWork) % 1440)}
                            </span>
                          </div>
                          {entry.enabled && (
                            <>
                              <div className="mt-1.5 flex items-center gap-2">
                                <TimeField
                                  value={entry.start}
                                  onChange={(v) => setTimes((t) => ({ ...t, [d.key]: { ...entry, start: v } }))}
                                />
                                <span className="shrink-0 text-slate-400">–</span>
                                <TimeField
                                  value={entry.end}
                                  onChange={(v) => setTimes((t) => ({ ...t, [d.key]: { ...entry, end: v } }))}
                                />
                              </div>
                              {dayError && <p className="mt-1 text-xs text-red-600">{dayError}</p>}
                            </>
                          )}
                        </div>
                      )
                    })}
                    <p className="mt-2 text-xs text-slate-400">
                      Upišite vreme u formatu HH:MM (npr. 09:30). Preko ponoći je dozvoljeno (npr. 22:00–02:00).
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={busy || scheduleErrors.size > 0}
                    onClick={saveSchedule}
                    className="w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white active:bg-brand-700 disabled:opacity-50"
                  >
                    Sačuvaj raspored
                  </button>
                  <button
                    type="button"
                    onClick={() => setView('main')}
                    className="w-full rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-600 active:bg-slate-50"
                  >
                    Otkaži
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {cameraOpen && (
        <CameraCapture
          onCapture={(f) => {
            pickFile(f)
            setCameraOpen(false)
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}

      {confirmRemoveOpen && (
        <div className="fixed inset-0 z-[2300] flex items-center justify-center bg-black/40 px-4" onClick={() => setConfirmRemoveOpen(false)}>
          <div className="w-full max-w-xs rounded-2xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-slate-800">Ukloniti sliku obaveštenja?</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmRemoveOpen(false)}
                className="flex-1 rounded-lg border border-slate-200 py-2 text-sm font-semibold text-slate-600"
              >
                Otkaži
              </button>
              <button
                type="button"
                onClick={() => {
                  pickFile(null)
                  setImageUrl(null)
                  setRemoveImage(true)
                  setConfirmRemoveOpen(false)
                }}
                className="flex-1 rounded-lg bg-red-500 py-2 text-sm font-semibold text-white"
              >
                Ukloni
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Announcement