import { useEffect, useState } from 'react'
import { cropImageUrl, formatMinutes, formatPrice, getSerbiaWeekday, getSerbiaMinutes, relativeTimeAgo } from './format'
import ProductDetail from './ProductDetail'

interface StoreDetailData {
  id: string
  link?: string | null
  phone_number?: number | null
  town: string
  street: string
  street_number: string
  name: string
  description?: string | null
  image_url?: string | null
  store_type: string
  opening_minute_mon: number
  closing_minute_mon: number
  opening_minute_tue: number
  closing_minute_tue: number
  opening_minute_wed: number
  closing_minute_wed: number
  opening_minute_thu: number
  closing_minute_thu: number
  opening_minute_fri: number
  closing_minute_fri: number
  opening_minute_sat: number
  closing_minute_sat: number
  opening_minute_sun: number
  closing_minute_sun: number
}

interface Product {
  id: string
  amount?: number | null
  old_price: number
  new_price: number
  name: string
  creation_date: string
}

const STORE_LABELS: Record<string, string> = {
  market: 'Market',
  bakery: 'Pekara',
  restaurant: 'Restoran',
  other: 'Ostalo',
}

const STORE_COLORS: Record<string, string> = {
  market: '#3b82f6',
  bakery: '#f59e0b',
  restaurant: '#ef4444',
  other: '#8b5cf6',
}

type MinutesKey =
  | 'opening_minute_mon'
  | 'closing_minute_mon'
  | 'opening_minute_tue'
  | 'closing_minute_tue'
  | 'opening_minute_wed'
  | 'closing_minute_wed'
  | 'opening_minute_thu'
  | 'closing_minute_thu'
  | 'opening_minute_fri'
  | 'closing_minute_fri'
  | 'opening_minute_sat'
  | 'closing_minute_sat'
  | 'opening_minute_sun'
  | 'closing_minute_sun'

const DAY_ROWS: { label: string; open: MinutesKey; close: MinutesKey }[] = [
  { label: 'Ponedeljak', open: 'opening_minute_mon', close: 'closing_minute_mon' },
  { label: 'Utorak', open: 'opening_minute_tue', close: 'closing_minute_tue' },
  { label: 'Sreda', open: 'opening_minute_wed', close: 'closing_minute_wed' },
  { label: 'Četvrtak', open: 'opening_minute_thu', close: 'closing_minute_thu' },
  { label: 'Petak', open: 'opening_minute_fri', close: 'closing_minute_fri' },
  { label: 'Subota', open: 'opening_minute_sat', close: 'closing_minute_sat' },
  { label: 'Nedelja', open: 'opening_minute_sun', close: 'closing_minute_sun' },
]

function StoreDetail({ storeId, onClose }: { storeId: string; onClose: () => void }) {
  const [store, setStore] = useState<StoreDetailData | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [productDetailId, setProductDetailId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    setStore(null)
    setProducts([])
    Promise.all([
      fetch(`/api/store/${storeId}`).then((r) => {
        if (!r.ok) throw new Error()
        return r.json()
      }),
      fetch(`/api/products/${storeId}`).then((r) => {
        if (!r.ok) throw new Error()
        return r.json()
      }),
    ])
      .then(([storeData, productData]) => {
        if (cancelled) return
        setStore(storeData)
        setProducts(productData)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [storeId])

  const todayIndex = getSerbiaWeekday()
  const nowKey = `opening_minute_${['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][todayIndex]}` as MinutesKey
  const closeKey = nowKey.replace('opening', 'closing') as MinutesKey
  const nowMinutes = getSerbiaMinutes()
  const isClosed = store
    ? nowMinutes < store[nowKey] || nowMinutes >= store[closeKey]
    : false
  const typeColor = store ? STORE_COLORS[store.store_type] ?? '#6b7280' : '#6b7280'
  const typeLabel = store ? STORE_LABELS[store.store_type] ?? 'Ostalo' : ''

  return (
    <div className="fixed inset-0 z-[2000] flex flex-col overflow-y-auto overscroll-contain bg-white">
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
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg leading-tight font-bold text-slate-900">{store?.name ?? 'Radnja'}</h1>
            <p className="truncate text-xs text-slate-500">
              {store ? `${store.street} ${store.street_number}, ${store.town}` : ' '}
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-lg flex-1 px-4 pb-10">
        {loading && (
          <div className="flex flex-col items-center gap-3 pt-10">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
            <p className="text-sm text-slate-500">Učitavanje...</p>
          </div>
        )}

        {!loading && error && (
          <div className="pt-10 text-center">
            <p className="text-sm text-slate-500">Nešto je pošlo po zlu. Pokušaj ponovo.</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white active:bg-blue-700"
            >
              Nazad
            </button>
          </div>
        )}

        {!loading && !error && store && (
          <>
            {store.image_url && (
              <img
                src={cropImageUrl(store.image_url, 1200, 675)}
                alt={store.name}
                className="mt-4 aspect-video w-full rounded-2xl object-cover"
                loading="lazy"
              />
            )}
            <section className="mt-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
                  style={{ backgroundColor: `${typeColor}1a`, color: typeColor }}
                >
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: typeColor }} />
                  {typeLabel}
                </span>
              </div>

              {store.description && (
                <p className="mt-3 text-sm leading-relaxed text-slate-700">{store.description}</p>
              )}

              <div className="mt-4 grid grid-cols-1 gap-2">
                {store.phone_number != null
                  ? (
                  <a
                    href={`tel:${store.phone_number}`}
                    className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-800 active:bg-slate-100"
                  >
                    <span className="text-blue-600">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-4 w-4"
                      >
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
                      </svg>
                    </span>
                    <span>{store.phone_number}</span>
                  </a>
                )
                  : null}
                {store.link ? (
                  <a
                    href={store.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-800 active:bg-slate-100"
                  >
                    <span className="text-blue-600">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-4 w-4"
                      >
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <path d="M15 3h6v6" />
                        <path d="M10 14 21 3" />
                      </svg>
                    </span>
                    <span className="truncate text-blue-700">{store.link}</span>
                  </a>
                ) : null}
                {store.phone_number == null && !store.link && <p className="text-sm text-slate-400">Nema dodatnih informacija</p>}
              </div>
            </section>

            <section className="mt-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-bold text-slate-900">Radno vreme</h2>
              <ul className="mt-2">
                {DAY_ROWS.map((row) => {
                  const open = store[row.open]
                  const close = store[row.close]
                  const isToday = row.open === nowKey
                  return (
                    <li
                      key={row.label}
                      className={`flex items-center justify-between border-t border-slate-50 py-2 text-sm ${
                        isToday ? 'font-semibold text-slate-900' : 'text-slate-600'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {row.label}
                        {isToday && (
                          <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-600">
                            DANAS
                          </span>
                        )}
                      </span>
                      <span>{formatMinutes(open)} – {formatMinutes(close)}</span>
                    </li>
                  )
                })}
              </ul>
            </section>

            <section className="mt-4">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-sm font-bold text-slate-900">Proizvodi</h2>
                <span className="text-xs text-slate-400">danas</span>
              </div>

              {isClosed ? (
                <div className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
                  <p className="text-sm text-slate-500">Radnja je trenutno zatvorena</p>
                </div>
              ) : products.length === 0 ? (
                <div className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
                  <p className="text-sm text-slate-500">Danas nema proizvoda</p>
                </div>
              ) : (
                <ul className="mt-3 space-y-2">
                  {products.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setProductDetailId(p.id)}
                        className="flex w-full items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm active:bg-slate-50"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-900">{p.name}</p>
                          <p className="mt-0.5 text-xs text-slate-400">{relativeTimeAgo(p.creation_date)}</p>
                          {p.amount !== null && p.amount !== undefined && (
                            <p className="mt-0.5 text-xs text-slate-500">Količina: {p.amount}</p>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-bold text-red-600">{formatPrice(p.new_price)}</p>
                          {p.old_price > p.new_price && (
                            <p className="text-xs text-slate-400 line-through">{formatPrice(p.old_price)}</p>
                          )}
                        </div>
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="h-4 w-4 shrink-0 text-slate-300"
                        >
                          <path d="m9 18 6-6-6-6" />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
      {productDetailId && store && (
        <ProductDetail
          productId={productDetailId}
          storeName={store.name}
          onBack={() => setProductDetailId(null)}
          onViewStore={() => setProductDetailId(null)}
        />
      )}
    </div>
  )
}

export default StoreDetail