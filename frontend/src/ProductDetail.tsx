import { useEffect, useState } from 'react'
import { cropImageUrl, formatPrice, formatShortDate, relativeTimeAgo } from './format'
import { useBackLayer } from './backStack'
import FreeTag from './FreeTag'
import ReportDialog from './ReportDialog'

interface ProductData {
  id: string
  store_id: string
  amount?: number | null
  old_price: number | null
  new_price: number | null
  name: string
  description?: string | null
  image_url?: string | null
  is_active: boolean
  expiration_date?: string | null
  creation_date: string
}

function ProductDetail({
  productId,
  storeName,
  onBack,
  onViewStore,
}: {
  productId: string
  storeName: string
  onBack: () => void
  onViewStore?: (storeId: string) => void
}) {
  const [product, setProduct] = useState<ProductData | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [imageFull, setImageFull] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)

  useBackLayer(imageFull, () => setImageFull(false))

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    setProduct(null)
    fetch(`/api/product/${productId}`)
      .then((r) => {
        if (!r.ok) throw new Error()
        return r.json()
      })
      .then((data) => {
        if (!cancelled) setProduct(data)
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
  }, [productId])

  return (
    <div
      className="fixed inset-0 z-[3000] flex flex-col overflow-y-auto overscroll-contain bg-white"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onBack()
        }
      }}
    >
      <header className="sticky top-0 z-10 border-b border-slate-100 bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-lg px-4 py-3 md:max-w-2xl">
          <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
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
            <h1 className="truncate text-lg leading-tight font-bold text-slate-900">{product?.name ?? 'Proizvod'}</h1>
            <p className="truncate text-xs text-slate-500">{storeName}</p>
          </div>
          {product && typeof navigator.share === 'function' && (
            <button
              type="button"
              onClick={() => {
                const sharePrice =
                  product.new_price == null
                    ? 'informacije o ceni nisu istaknute'
                    : product.new_price === 0
                      ? 'besplatno'
                      : `po ceni ${formatPrice(product.new_price)}`
                navigator
                  .share({
                    title: `${product.name} - ${sharePrice}`,
                    text: `Evo proizvoda na NeBacaj: ${product.name} ${sharePrice} (${storeName}).`,
                    url: window.location.href,
                  })
                  .catch(() => {})
              }}
              aria-label="Podeli"
              className="-mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 active:bg-brand-50"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
              >
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <path d="m8.59 13.51 6.83 3.98" />
                <path d="m15.41 6.51-6.82 3.98" />
              </svg>
            </button>
          )}
          {product && (
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              aria-label="Prijavi problem"
              className="-mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 active:bg-slate-100"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
              >
                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                <line x1="4" y1="22" x2="4" y2="15" />
              </svg>
            </button>
          )}
        </div>
      </div>
      </header>

      <div className="mx-auto w-full max-w-lg flex-1 px-4 md:max-w-2xl" style={{ paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom, 0px))' }}>
        {loading && (
          <div className="flex flex-col items-center gap-3 pt-10">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
            <p className="text-sm text-slate-500">Učitavanje...</p>
          </div>
        )}

        {!loading && error && (
          <div className="pt-10 text-center">
            <p className="text-sm text-slate-500">Nešto je pošlo po zlu. Pokušaj ponovo.</p>
            <button
              type="button"
              onClick={onBack}
              className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white active:bg-brand-700"
            >
              Nazad
            </button>
          </div>
        )}

        {!loading && !error && product && (
          <>
            {product.image_url && (
              <button
                type="button"
                className="mt-4 block w-full md:mx-auto md:max-w-[560px]"
                onClick={() => setImageFull(true)}
              >
                <img
                  src={cropImageUrl(product.image_url, 800, 800)}
                  alt={product.name}
                  className="aspect-square w-full rounded-2xl object-cover"
                  loading="lazy"
                />
              </button>
            )}
            <section className="mt-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              {!product.is_active && (
                <span className="mb-2 inline-block rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700">
                  Nije aktivan
                </span>
              )}
              <div className="flex items-end justify-between gap-2">
                <div>
                  {product.new_price == null ? (
                    <p className="text-xl font-bold text-slate-400">Cena nije istaknuta</p>
                  ) : product.new_price === 0 ? (
                    <FreeTag large />
                  ) : (
                    <p className="text-3xl font-extrabold text-red-600">{formatPrice(product.new_price)}</p>
                  )}
                  {product.old_price != null && product.new_price != null && product.old_price > product.new_price && (
                    <p className="mt-1 text-base text-slate-400 line-through">{formatPrice(product.old_price)}</p>
                  )}
                </div>
                {product.old_price != null &&
                  product.new_price != null &&
                  product.new_price !== 0 &&
                  product.old_price > product.new_price && (
                  <div className="shrink-0 rounded-xl bg-red-500 px-2.5 py-1.5 text-center">
                    <p className="text-lg leading-none font-extrabold text-white">
                      −{Math.round((1 - product.new_price / product.old_price) * 100)}%
                    </p>
                    <p className="mt-1 text-[10px] font-semibold text-white/90">
                      Uštedi {formatPrice(Math.round(product.old_price - product.new_price))}
                    </p>
                  </div>
                )}
              </div>
            </section>

            <section className="mt-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <ul>
                <li className="flex items-center justify-between border-b border-slate-50 py-2.5 text-sm text-slate-600">
                  <span>Objavljeno</span>
                  <span className="text-slate-900">{relativeTimeAgo(product.creation_date)}</span>
                </li>
                {product.amount != null && (
                  <li className="flex items-center justify-between border-b border-slate-50 py-2.5 text-sm text-slate-600">
                    <span>Količina</span>
                    <span className="font-semibold text-slate-900">{product.amount}</span>
                  </li>
                )}
                {product.expiration_date != null && (
                  <li className="flex items-center justify-between border-b border-slate-50 py-2.5 text-sm text-slate-600">
                    <span>Ističe</span>
                    <span className="text-slate-900">{formatShortDate(product.expiration_date)}</span>
                  </li>
                )}
                {product.description ? (
                  <li className="pt-3 pb-1">
                    <p className="text-sm leading-relaxed break-words text-slate-700">{product.description}</p>
                  </li>
                ) : (
                  <li className="py-2.5 text-sm text-slate-400">Nema opisa</li>
                )}
              </ul>
            </section>

            {onViewStore && (
              <button
                type="button"
                onClick={() => onViewStore(product.store_id)}
                className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white active:bg-brand-700"
              >
                Pogledaj radnju
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            )}
          </>
        )}
      </div>
      {imageFull && product && product.image_url && (
        <div
          className="fixed inset-0 z-[4000] flex items-center justify-center bg-black/90"
          onClick={() => setImageFull(false)}
        >
          <button
            type="button"
            aria-label="Zatvori"
            className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur active:bg-white/20"
            onClick={(e) => { e.stopPropagation(); setImageFull(false) }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
          <img
            src={product.image_url}
            alt={product.name}
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
      {product && (
        <ReportDialog
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          storeId={product.store_id}
          storeName={storeName}
          productId={product.id}
          productName={product.name}
        />
      )}
    </div>
  )
}

export default ProductDetail