import { useEffect, useState } from 'react'
import { formatPrice, formatShortDate, relativeTimeAgo } from './format'

interface ProductData {
  id: string
  store_id: string
  amount?: number | null
  old_price: number
  new_price: number
  name: string
  description?: string | null
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
    <div className="fixed inset-0 z-[3000] flex flex-col overflow-y-auto overscroll-contain bg-white">
      <header className="sticky top-0 z-10 border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur">
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
              onClick={onBack}
              className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white active:bg-blue-700"
            >
              Nazad
            </button>
          </div>
        )}

        {!loading && !error && product && (
          <>
            <section className="mt-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              {!product.is_active && (
                <span className="mb-2 inline-block rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700">
                  Nije aktivan
                </span>
              )}
              <p className="text-3xl font-extrabold text-red-600">{formatPrice(product.new_price)}</p>
              {product.old_price > product.new_price && (
                <p className="mt-1 text-base text-slate-400 line-through">{formatPrice(product.old_price)}</p>
              )}
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
                    <p className="text-sm leading-relaxed text-slate-700">{product.description}</p>
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
                className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white active:bg-blue-700"
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
    </div>
  )
}

export default ProductDetail