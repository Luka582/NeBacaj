import { useEffect, useRef, useState } from 'react'
import { cropImageUrl, formatPrice } from './format'
import FreeTag from './FreeTag'
import { tapHandlers, dismissKeyboard } from './tapHandlers'

export interface ProductSearchResult {
  product_id: string
  product_name: string
  amount?: number | null
  old_price: number
  new_price: number
  image_url?: string | null
  store_id: string
  store_name: string
  town: string
  street: string
  street_number: string
  latitude: number
  longitude: number
  distance_km?: number | null
}

const PEEK_HEIGHT = 140
const SNAP_DRAG_DISTANCE = 100
export const SIDE_PANEL_WIDTH = 380

interface ProductSheetProps {
  products: ProductSearchResult[]
  loading: boolean
  error: boolean
  query: string
  onQueryChange: (q: string) => void
  onSelect: (result: ProductSearchResult) => void
  focusedSearch: { current: 'town' | 'product' | null }
  onSearchFocused: (focused: boolean) => void
  onTownDropdown: (open: boolean) => void
}

export default function ProductSheet({
  products,
  loading,
  error,
  query,
  onQueryChange,
  onSelect,
  focusedSearch,
  onSearchFocused,
  onTownDropdown,
}: ProductSheetProps) {
  const [expanded, setExpanded] = useState(false)
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const [vh] = useState(() => window.innerHeight)
  const dragRef = useRef<{ startY: number; wasExpanded: boolean } | null>(null)

  useEffect(() => {
    if (!expanded && focusedSearch.current === 'product') {
      focusedSearch.current = null
      onSearchFocused(false)
    }
  }, [expanded, focusedSearch, onSearchFocused])

  function beginDrag(e: React.PointerEvent) {
    if (e.button !== 0) return
    dragRef.current = { startY: e.clientY, wasExpanded: expanded }
    setDragHeight(expanded ? window.innerHeight : PEEK_HEIGHT)
    const move = (ev: PointerEvent) => {
      const start = dragRef.current
      if (!start) return
      const base = start.wasExpanded ? window.innerHeight : PEEK_HEIGHT
      const next = Math.min(window.innerHeight, Math.max(PEEK_HEIGHT, base + start.startY - ev.clientY))
      setDragHeight(next)
    }
    const end = (ev: PointerEvent) => {
      const start = dragRef.current
      if (start) {
        const delta = start.startY - ev.clientY
        if (delta > SNAP_DRAG_DISTANCE) setExpanded(true)
        else if (delta < -SNAP_DRAG_DISTANCE) setExpanded(false)
        else setExpanded(start.wasExpanded)
      }
      dragRef.current = null
      setDragHeight(null)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  const hasQuery = query.trim().length > 0

  const searchInput = (
    <div className="relative">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-brand-400"
      >
        <path d="m21 21-4.35-4.35" />
        <circle cx="11" cy="11" r="8" />
      </svg>
      <input
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onFocus={() => {
          focusedSearch.current = 'product'
          onTownDropdown(false)
          onSearchFocused(true)
        }}
        onBlur={() => {
          focusedSearch.current = null
          onSearchFocused(false)
        }}
        onPointerDown={(e) => {
          if (focusedSearch.current === 'town') e.preventDefault()
        }}
        placeholder="Pretraži proizvode..."
        className="w-full rounded-full border border-slate-200 bg-white py-2.5 pr-9 pl-9 text-sm font-semibold text-slate-800 outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-100"
      />
      {hasQuery && (
        <button
          type="button"
          onClick={() => onQueryChange('')}
          aria-label="Očisti pretragu"
          className="absolute top-1/2 right-2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-600 active:bg-slate-300"
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
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      )}
    </div>
  )

  const resultsList = (
    <>
      {loading ? (
        <>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl px-3 py-2.5">
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="h-3.5 w-3/4 animate-pulse rounded bg-slate-100" />
                <div className="h-2.5 w-1/2 animate-pulse rounded bg-slate-100" />
              </div>
              <div className="h-3.5 w-12 animate-pulse rounded bg-slate-100" />
            </div>
          ))}
        </>
      ) : error ? (
        <p className="px-3 py-3 text-center text-sm text-red-500">Greška pri učitavanju proizvoda</p>
      ) : products.length === 0 ? (
        <p className="px-3 py-3 text-center text-sm text-slate-400">
          {hasQuery ? 'Nema rezultata' : 'Nema proizvoda'}
        </p>
      ) : (
        products.map((r) => (
          <button
            key={r.product_id}
            type="button"
            {...tapHandlers(() => onSelect(r))}
            onClick={() => onSelect(r)}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-brand-50 active:bg-brand-50"
          >
            {r.image_url ? (
              <img
                src={cropImageUrl(r.image_url, 96, 96)}
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
              <p className="truncate text-sm font-semibold text-slate-900">{r.product_name}</p>
              <p className="truncate text-xs text-slate-500">
                {r.store_name} · {r.street} {r.street_number}, {r.town}
                {r.distance_km != null && <span> · {r.distance_km} km</span>}
              </p>
            </div>
            <div className="shrink-0 text-right">
              {r.new_price === 0 ? (
                <FreeTag />
              ) : (
                <p className="text-sm font-bold text-red-600">{formatPrice(r.new_price)}</p>
              )}
              {r.old_price > r.new_price && r.new_price !== 0 && (
                <span className="mt-0.5 inline-block rounded-full bg-red-500 px-1.5 py-px text-[10px] font-bold text-white">
                  −{Math.round((1 - r.new_price / r.old_price) * 100)}%
                </span>
              )}
              {r.old_price > r.new_price && (
                <p className="text-xs text-slate-400 line-through">{formatPrice(r.old_price)}</p>
              )}
            </div>
          </button>
        ))
      )}
    </>
  )

  return (
    <>
      <div
        className={`pointer-events-auto fixed inset-x-0 bottom-0 z-[1500] flex flex-col overflow-hidden rounded-t-2xl bg-white shadow-[0_-10px_40px_rgba(0,0,0,0.18)] md:hidden ${
          expanded ? 'h-screen' : ''
        } ${dragHeight === null ? 'transition-[height] duration-300 ease-out' : ''}`}
        style={{ height: dragHeight !== null ? `${dragHeight}px` : expanded ? `${vh}px` : `${PEEK_HEIGHT}px` }}
      >
        <div className="shrink-0 border-b border-slate-100 px-3 pt-2 pb-2">
          <button
            type="button"
            aria-expanded={expanded}
            onPointerDown={beginDrag}
            onClick={() => setExpanded((v) => !v)}
            className={`flex w-full touch-none flex-col items-center rounded-xl outline-none select-none active:bg-brand-50 ${
              expanded ? 'py-4' : 'py-1'
            }`}
          >
            <span className="h-1.5 w-12 rounded-full bg-brand-200" />
          </button>
        </div>

        {expanded && <div className="shrink-0 px-3 pt-2 pb-2">{searchInput}</div>}

        <div
          onWheel={dismissKeyboard}
          onTouchMove={dismissKeyboard}
          className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
        >
          {resultsList}
        </div>
      </div>

      <div className="pointer-events-auto fixed top-1/2 right-0 z-[1500] hidden h-2/3 w-[380px] -translate-y-1/2 flex-col overflow-hidden rounded-l-2xl border-l border-t border-b border-slate-100 bg-white shadow-[-10px_0_40px_rgba(0,0,0,0.12)] md:flex">
        <div className="shrink-0 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-bold text-slate-900">Pretraga proizvoda</h2>
        </div>
        <div className="shrink-0 px-3 pt-2 pb-2">{searchInput}</div>
        <div
          onWheel={dismissKeyboard}
          onTouchMove={dismissKeyboard}
          className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3"
        >
          {resultsList}
        </div>
      </div>
    </>
  )
}