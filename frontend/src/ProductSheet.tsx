import { useRef, useState } from 'react'
import { formatPrice } from './format'
import { tapHandlers } from './tapHandlers'

export interface ProductSearchResult {
  product_id: string
  product_name: string
  amount?: number | null
  old_price: number
  new_price: number
  store_id: string
  store_name: string
  town: string
  street: string
  street_number: string
  latitude: number
  longitude: number
  distance_km?: number | null
}

const PEEK_HEIGHT = 236
const EXPAND_SNAP_RATIO = 0.45

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
  const dragRef = useRef<{ startY: number; wasExpanded: boolean } | null>(null)

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
        const base = start.wasExpanded ? window.innerHeight : PEEK_HEIGHT
        const desired = base + start.startY - ev.clientY
        setExpanded(desired > window.innerHeight * EXPAND_SNAP_RATIO)
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
  const visibleProducts = expanded ? products : products.slice(0, 3)

  return (
    <div
      className={`pointer-events-auto fixed inset-x-0 bottom-0 z-[1500] flex flex-col overflow-hidden rounded-t-2xl bg-white shadow-[0_-10px_40px_rgba(0,0,0,0.18)] ${expanded ? 'h-screen' : ''} ${
        dragHeight === null ? 'transition-[height] duration-300 ease-out' : ''
      }`}
      style={{ height: dragHeight !== null ? `${dragHeight}px` : expanded ? '100dvh' : `${PEEK_HEIGHT}px` }}
    >
      <div className="shrink-0 px-3 pt-1.5 pb-1">
        <button
          type="button"
          aria-expanded={expanded}
          onPointerDown={beginDrag}
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full touch-none flex-col items-center gap-1.5 rounded-lg pt-1 pb-1.5 outline-none select-none"
        >
          <span className="h-1 w-10 rounded-full bg-slate-300" />
          {!expanded && (
            <span className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
              Pretraži proizvode
            </span>
          )}
        </button>
      </div>

      {expanded && (
        <div className="shrink-0 px-3 pb-2">
          <div className="relative">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-slate-400"
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
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-9 pl-9 text-sm font-medium text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
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
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
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
        ) : visibleProducts.length === 0 ? (
          <p className="px-3 py-3 text-center text-sm text-slate-400">
            {hasQuery ? 'Nema rezultata' : 'Nema proizvoda'}
          </p>
        ) : (
          visibleProducts.map((r) => (
            <button
              key={r.product_id}
              type="button"
              {...tapHandlers(() => onSelect(r))}
              onClick={() => onSelect(r)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-blue-50 active:bg-blue-50"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">{r.product_name}</p>
                <p className="truncate text-xs text-slate-500">
                  {r.store_name} · {r.street} {r.street_number}, {r.town}
                  {r.distance_km != null && <span> · {r.distance_km} km</span>}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-bold text-red-600">{formatPrice(r.new_price)}</p>
                {r.old_price > r.new_price && (
                  <p className="text-xs text-slate-400 line-through">{formatPrice(r.old_price)}</p>
                )}
              </div>
            </button>
          ))
        )}
        {!expanded && products.length > 3 && (
          <div className="pointer-events-none absolute right-0 bottom-0 left-0 h-12 bg-gradient-to-t from-white to-transparent" />
        )}
      </div>
    </div>
  )
}