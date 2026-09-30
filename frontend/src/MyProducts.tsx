import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { loadSession, saveSession, clearSession, isWorker } from './auth'
import type { Session } from './auth'
import { cropImageUrl, formatPrice, formatShortDate } from './format'
import { dismissKeyboard } from './tapHandlers'

const SERBIA_MIN_OFFSET = 120

function serbiaNow(): Date {
  const now = new Date()
  return new Date(now.getTime() + (now.getTimezoneOffset() + SERBIA_MIN_OFFSET) * 60000)
}

function dateKey(d: Date): string {
  const y = d.getFullYear()
  const m = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  return `${y}-${m}-${day}`
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

const API_ERRORS: Record<string, string> = {
  'You do not manage this store': 'Nemate pravo pristupa ovoj prodavnici.',
  'Not authenticated': 'Niste prijavljeni.',
  'Invalid or expired token': 'Sesija je istekla, prijavite se ponovo.',
  'Store not found': 'Prodavnica nije pronađena.',
  'Product not found': 'Proizvod nije pronađen.',
  'Uploaded file must be an image': 'Dodati fajl mora biti slika.',
  'Image too large (max 10 MB)': 'Slika je prevelika (maks. 10 MB).',
}

function submitError(data: unknown): string {
  if (data && typeof data === 'object' && 'detail' in data) {
    const detail = (data as { detail: unknown }).detail
    if (typeof detail === 'string') return API_ERRORS[detail] ?? detail
  }
  return 'Uneti podaci nisu ispravni.'
}

interface ApiMin {
  id: string
  name: string
  amount: number | null
  old_price: number
  new_price: number
  image_url?: string | null
  creation_date: string
}

interface ApiFull extends ApiMin {
  store_id: string
  description: string | null
  image_url: string | null
  is_active: boolean
}

interface RowProduct extends ApiMin {
  is_active: boolean
}

type FormMode = 'create' | 'edit' | 'reactivate'

interface ProductFormProps {
  mode: FormMode
  token: string
  storeId: string
  productId: string | null
  onSaved: () => void
  onCancel: () => void
}

function CameraCapture({ onCapture, onClose }: { onCapture: (file: File) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    let stream: MediaStream | null = null
    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        })
        if (!alive) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        const v = videoRef.current
        if (v) {
          v.srcObject = stream
          await v.play().catch(() => {})
        }
      } catch {
        if (alive) setError('Kamera nije dostupna ili pristup nije dozvoljen.')
      }
    }
    start()
    return () => {
      alive = false
      if (stream) stream.getTracks().forEach((t) => t.stop())
    }
  }, [])

  function capture() {
    const v = videoRef.current
    if (!v || v.videoWidth === 0) return
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth
    canvas.height = v.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(new File([blob], 'photo.jpg', { type: 'image/jpeg' }))
      },
      'image/jpeg',
      0.9,
    )
  }

  return (
    <div className="fixed inset-0 z-[2200] flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="Zatvori"
          className="flex h-10 w-10 -ml-1 items-center justify-center rounded-full text-white active:bg-white/20"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-6 w-6"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
        <span className="text-sm font-semibold text-white">Slikaj proizvod</span>
        <span className="w-10" />
      </div>
      <div className="relative min-h-0 flex-1">
        <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover" />
        {error && <p className="absolute inset-x-0 bottom-4 px-6 text-center text-sm font-medium text-red-400">{error}</p>}
      </div>
      <div className="flex items-center justify-center py-6">
        <button
          type="button"
          onClick={capture}
          aria-label="Uslikaj"
          disabled={!!error}
          className="h-16 w-16 rounded-full border-4 border-white bg-white/25 active:scale-95 disabled:opacity-40"
        >
          <span className="h-12 w-12 rounded-full bg-white" />
        </button>
      </div>
    </div>
  )
}

function ProductForm({ mode, token, storeId, productId, onSaved, onCancel }: ProductFormProps) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [oldPrice, setOldPrice] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const [description, setDescription] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [filePreview, setFilePreview] = useState<string | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [removeImage, setRemoveImage] = useState(false)
  const [loading, setLoading] = useState(mode !== 'create')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null)

  function autoResizeTextarea(el: HTMLTextAreaElement | null) {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  useEffect(() => {
    if (mode === 'create' || !productId) return
    let alive = true
    fetch(`/api/product/${productId}`, { headers: bearer(token) })
      .then((res) => {
        if (!res.ok) throw new Error('Ne mogu da učitam proizvod.')
        return res.json()
      })
      .then((p: ApiFull) => {
        if (!alive) return
        setName(p.name)
        setAmount(p.amount != null ? String(p.amount) : '')
        setOldPrice(String(p.old_price))
        setNewPrice(String(p.new_price))
        setDescription(p.description ?? '')
        setImageUrl(p.image_url ?? null)
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : 'Greška pri učitavanju.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [mode, productId, token])

  useEffect(() => {
    if (!file) {
      setFilePreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setFilePreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    autoResizeTextarea(descriptionRef.current)
  }, [description])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const trimmed = name.trim()
    const op = Number(oldPrice)
    const np = Number(newPrice)
    const amt = amount.trim() === '' ? null : Number(amount)
    if (!trimmed) {
      setError('Unesite naziv proizvoda.')
      return
    }
    if (!Number.isFinite(op) || !Number.isFinite(np) || op < 0 || np < 0 || op < np) {
      setError('Stara cena mora biti veća ili jednaka novoj ceni.')
      return
    }
    if (amt != null && (!Number.isInteger(amt) || amt < 1)) {
      setError('Količina mora biti ceo broj od 1 naviše.')
      return
    }
    const payload: Record<string, unknown> = { name: trimmed, old_price: op, new_price: np }
    if (mode === 'create') payload.store_id = storeId
    if (amt != null) payload.amount = amt
    if (description.trim() !== '') payload.description = description.trim()
    if (mode === 'edit' || mode === 'reactivate') {
      payload.is_active = true
      if (removeImage) payload.image_url = null
    }
    const fd = new FormData()
    fd.append('data', JSON.stringify(payload))
    if (file) fd.append('image', file)

    setBusy(true)
    try {
      if (mode === 'create') {
        const res = await fetch('/api/products', { method: 'POST', headers: bearer(token), body: fd })
        if (!res.ok) throw new Error(submitError(await res.json().catch(() => null)))
      } else if (productId != null) {
        const res = await fetch(`/api/products/${productId}`, {
          method: 'PUT',
          headers: bearer(token),
          body: fd,
        })
        if (!res.ok) throw new Error(submitError(await res.json().catch(() => null)))
        if (mode === 'reactivate') {
          const react = await fetch(`/api/products/${productId}/reactivate`, {
            method: 'POST',
            headers: bearer(token),
          })
          if (!react.ok) throw new Error('Reaktivacija nije uspela.')
        }
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Došlo je do greške.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-[2100] flex items-center justify-center bg-white">
        <p className="text-sm text-slate-500">Učitavam...</p>
      </div>
    )
  }

  const inputClass =
    'w-full rounded-lg border border-slate-200 bg-slate-50 py-2 px-3 text-sm font-medium text-slate-700 outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-100'

  return (
    <>
      <form onSubmit={handleSubmit} className="fixed inset-0 z-[2100] flex flex-col bg-white">
      <header className="sticky top-0 z-10 shrink-0 border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            aria-label="Nazad"
            className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 active:bg-slate-100"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-6 w-6"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <h1 className="min-w-0 flex-1 truncate text-lg leading-tight font-bold text-slate-900">
            {mode === 'create' ? 'Novi proizvod' : mode === 'reactivate' ? 'Reaktiviraj proizvod' : 'Izmeni proizvod'}
          </h1>
        </div>
      </header>

      <div
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4"
        onWheel={dismissKeyboard}
        onTouchMove={dismissKeyboard}
      >
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">Naziv *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Naziv proizvoda"
            className={inputClass}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Stara cena (RSD) *</label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={oldPrice}
              onChange={(e) => setOldPrice(e.target.value)}
              placeholder="0"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Nova cena (RSD) *</label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              placeholder="0"
              className={inputClass}
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">Količina (opciono)</label>
          <input
            type="number"
            inputMode="numeric"
            min="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="npr. 3"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">Opis</label>
          <textarea
            ref={descriptionRef}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              autoResizeTextarea(e.target)
            }}
            placeholder="Kratak opis proizvoda"
            rows={3}
            className="w-full resize-none overflow-hidden rounded-lg border border-slate-200 bg-slate-50 py-2 px-3 text-sm font-medium text-slate-700 outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">Slika</label>
          {imageUrl && !file && !removeImage && (
            <div className="mb-2 flex flex-col gap-2">
              <img
                src={cropImageUrl(imageUrl, 960, 540)}
                alt=""
                className="w-full rounded-xl object-cover"
                style={{ aspectRatio: '16 / 9' }}
              />
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={removeImage}
                  onChange={(e) => setRemoveImage(e.target.checked)}
                  className="h-4 w-4 accent-blue-600"
                />
                Ukloni trenutnu sliku
              </label>
            </div>
          )}
          <div className="mt-1 flex gap-2">
            <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 py-2.5 text-sm font-semibold text-slate-700 active:bg-slate-100">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                <circle cx="9" cy="9" r="2" />
                <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
              </svg>
              Biraj iz galerije
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null
                  setFile(f)
                  e.target.value = ''
                }}
                className="hidden"
              />
            </label>
            <button
              type="button"
              onClick={() => setCameraOpen(true)}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-brand-100 bg-brand-50 py-2.5 text-sm font-semibold text-brand-600 active:bg-brand-100"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                <circle cx="12" cy="13" r="3" />
              </svg>
              Uslikaj kamerom
            </button>
          </div>
          {file && (
            <div className="mt-2 flex flex-col gap-2">
              {filePreview && (
                <img
                  src={filePreview}
                  alt=""
                  className="w-full rounded-xl object-cover"
                  style={{ aspectRatio: '16 / 9' }}
                />
              )}
              <button
                type="button"
                onClick={() => {
                  setFile(null)
                  if (fileInputRef.current) fileInputRef.current.value = ''
                }}
                className="self-start text-xs font-semibold text-red-500"
              >
                Ukloni izabranu sliku
              </button>
            </div>
          )}
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="space-y-2 pt-1">
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white active:bg-brand-700 disabled:opacity-50"
          >
            {mode === 'reactivate' ? 'Reaktiviraj za danas' : mode === 'create' ? 'Napravi proizvod' : 'Sačuvaj izmene'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="w-full rounded-lg border border-slate-200 py-2 text-sm font-semibold text-slate-600 active:bg-slate-50"
          >
            Otkaži
          </button>
        </div>
      </div>
      </form>
      {cameraOpen && (
        <CameraCapture
          onCapture={(f) => {
            setFile(f)
            setCameraOpen(false)
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </>
  )
}

interface MyProductsProps {
  onClose: () => void
  onChanged?: () => void
}

function MyProducts({ onClose, onChanged }: MyProductsProps) {
  const [session, setSession] = useState<Session | null>(() => loadSession())
  const [storeName, setStoreName] = useState('')
  const [today, setToday] = useState<RowProduct[]>([])
  const [old, setOld] = useState<RowProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<{ mode: FormMode; id: string | null } | null>(null)
  const storeIdRef = useRef<string | null>(null)

  async function ensureStoreId(s: Session): Promise<string | null> {
    if (storeIdRef.current) return storeIdRef.current
    const res = await fetch('/api/auth/me', { headers: bearer(s.token) })
    if (res.status === 401) {
      clearSession()
      setSession(null)
      return null
    }
    if (!res.ok) throw new Error('Nije moguće učitati podatke o nalogu.')
    const me = (await res.json()) as { store_id: string | null }
    if (!me.store_id) throw new Error('Nalog nije povezan ni sa jednom prodavnicom.')
    storeIdRef.current = me.store_id
    const updated: Session = { ...s, store_id: me.store_id }
    if (s.store_id !== me.store_id) {
      saveSession(updated)
      setSession(updated)
    }
    return me.store_id
  }

  function toRow(item: ApiMin, isActive: boolean): RowProduct {
    return {
      id: item.id,
      name: item.name,
      amount: item.amount ?? null,
      old_price: item.old_price,
      new_price: item.new_price,
      image_url: item.image_url ?? null,
      creation_date: item.creation_date,
      is_active: isActive,
    }
  }

  async function refresh(s: Session): Promise<string | null> {
    const storeId = await ensureStoreId(s)
    if (!storeId) return null
    setError(null)
    const base = `/api/products/${storeId}`
    const [t, a, d] = await Promise.all([
      fetch(`${base}?is_active=true&today_only=true`),
      fetch(`${base}?is_active=true&today_only=false`),
      fetch(`${base}?is_active=false&today_only=false`),
    ])
    if (!t.ok || !a.ok || !d.ok) throw new Error('Ne mogu da učitam proizvode.')
    const [tj, aj, dj] = (await Promise.all([t.json(), a.json(), d.json()])) as [ApiMin[], ApiMin[], ApiMin[]]
    const todayRows = tj.map((x) => toRow(x, true))
    const todayIds = new Set(todayRows.map((p) => p.id))
    const cutoff = dateKey(new Date(serbiaNow().getTime() - 2 * 86400000))
    const oldRows = [...aj.map((x) => toRow(x, true)), ...dj.map((x) => toRow(x, false))].filter(
      (p) => p.creation_date.slice(0, 10) >= cutoff && !todayIds.has(p.id),
    )
    todayRows.sort((x, y) => (x.creation_date < y.creation_date ? 1 : -1))
    oldRows.sort((x, y) => (x.creation_date < y.creation_date ? 1 : -1))
    setToday(todayRows)
    setOld(oldRows)
    fetch(`/api/store/${storeId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((store) => {
        if (store && typeof store.name === 'string') setStoreName(store.name)
      })
      .catch(() => {})
    return storeId
  }

  useEffect(() => {
    const s = session
    if (!s || !isWorker(s)) {
      setLoading(false)
      return
    }
    refresh(s)
      .catch((err) => setError(err instanceof Error ? err.message : 'Greška pri učitavanju.'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleDelete(p: RowProduct) {
    if (!session) return
    if (!window.confirm(`Obrisati proizvod „${p.name}“?`)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/products/${p.id}`, { method: 'DELETE', headers: bearer(session.token) })
      if (res.status === 401) {
        clearSession()
        setSession(null)
        return
      }
      if (!res.ok) throw new Error('Brisanje nije uspelo.')
      await refresh(session)
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Došlo je do greške.')
    } finally {
      setBusy(false)
    }
  }

  function handleSaved() {
    setForm(null)
    if (session) refresh(session).catch((err) => setError(err instanceof Error ? err.message : 'Greška.'))
    onChanged?.()
  }

  const primaryBtn =
    'w-full rounded-lg bg-brand-600 py-3 text-sm font-semibold text-white active:bg-brand-700 disabled:opacity-50'
  const pillEdit =
    'rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 active:bg-slate-50'
  const pillRevive =
    'rounded-lg border border-brand-100 px-2.5 py-1.5 text-xs font-semibold text-brand-600 active:bg-brand-50'
  const pillDelete = 'rounded-lg border border-red-100 px-2.5 py-1.5 text-xs font-semibold text-red-500 active:bg-red-50'

  return (
    <div className="fixed inset-0 z-[2000] flex flex-col bg-white">
      <header className="sticky top-0 z-10 border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Nazad"
            className="-ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 active:bg-slate-100"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-6 w-6"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <h1 className="min-w-0 flex-1 truncate text-lg leading-tight font-bold text-slate-900">
            Moji proizvodi
          </h1>
        </div>
      </header>

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4"
        onWheel={dismissKeyboard}
        onTouchMove={dismissKeyboard}
      >
        {!isWorker(session) ? (
          <div className="pt-10 text-center">
            <p className="text-sm text-slate-500">
              Prijavite se u meniju podešavanja da biste videli svoje proizvode.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 rounded-lg border border-slate-200 px-5 py-2 text-sm font-semibold text-slate-600 active:bg-slate-50"
            >
              Nazad
            </button>
          </div>
        ) : loading && !error ? (
          <p className="py-10 text-center text-sm text-slate-500">Učitavam...</p>
        ) : (
          <div className="mx-auto w-full max-w-lg space-y-5">
            {storeName !== '' && (
              <p className="text-xs font-semibold text-slate-400">Prodavnica: {storeName}</p>
            )}
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button
              type="button"
              onClick={() => setForm({ mode: 'create', id: null })}
              className={primaryBtn}
              disabled={busy}
            >
              Novi proizvod
            </button>

            <section className="space-y-2">
              <h2 className="text-xs font-bold tracking-wide text-slate-400 uppercase">
                Danas {today.length > 0 && `(${today.length})`}
              </h2>
              {today.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 px-4 py-3 text-center text-sm text-slate-400">
                  Nema proizvoda za danas.
                </p>
              ) : (
                <ul className="space-y-2">
                  {today.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-2.5">
                      {p.image_url ? (
                        <img
                          src={cropImageUrl(p.image_url, 96, 96)}
                          alt=""
                          loading="lazy"
                          className="h-11 w-11 shrink-0 rounded-lg bg-slate-100 object-cover"
                        />
                      ) : (
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-5 w-5"
                          >
                            <path d="m7.5 4.27 9 5.15" />
                            <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
                            <path d="m3.3 7 8.7 5 8.7-5" />
                            <path d="M12 22V12" />
                          </svg>
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">{p.name}</p>
                        <div className="mt-0.5 flex items-center gap-2">
                          <p className="text-sm font-bold text-red-600">{formatPrice(p.new_price)}</p>
                          {p.old_price > p.new_price && (
                            <p className="text-xs text-slate-400 line-through">{formatPrice(p.old_price)}</p>
                          )}
                        </div>
                        {p.amount != null && <p className="text-xs text-slate-500">Količina: {p.amount}</p>}
                      </div>
                      <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
                        <button type="button" onClick={() => setForm({ mode: 'edit', id: p.id })} className={pillEdit}>
                          Izmeni
                        </button>
                        <button type="button" onClick={() => handleDelete(p)} className={pillDelete} disabled={busy}>
                          Obriši
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-2">
              <h2 className="text-xs font-bold tracking-wide text-slate-400 uppercase">
                Prethodni dani (2 dana) {old.length > 0 && `(${old.length})`}
              </h2>
              {old.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 px-4 py-3 text-center text-sm text-slate-400">
                  Nema proizvoda iz prethodnih dana.
                </p>
              ) : (
                <ul className="space-y-2">
                  {old.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-2.5">
                      {p.image_url ? (
                        <img
                          src={cropImageUrl(p.image_url, 96, 96)}
                          alt=""
                          loading="lazy"
                          className="h-11 w-11 shrink-0 rounded-lg bg-slate-100 object-cover"
                        />
                      ) : (
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-5 w-5"
                          >
                            <path d="m7.5 4.27 9 5.15" />
                            <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
                            <path d="m3.3 7 8.7 5 8.7-5" />
                            <path d="M12 22V12" />
                          </svg>
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">{p.name}</p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          od {formatShortDate(p.creation_date)}
                          {!p.is_active && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">neaktivan</span>}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
                        <button
                          type="button"
                          onClick={() => setForm({ mode: 'reactivate', id: p.id })}
                          className={pillRevive}
                        >
                          Reaktiviraj
                        </button>
                        <button type="button" onClick={() => handleDelete(p)} className={pillDelete} disabled={busy}>
                          Obriši
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>

      {form && session && (
        <ProductForm
          mode={form.mode}
          token={session.token}
          storeId={storeIdRef.current ?? ''}
          productId={form.id}
          onSaved={handleSaved}
          onCancel={() => setForm(null)}
        />
      )}
    </div>
  )
}

export default MyProducts