import { useEffect, useState } from 'react'
import { cropImageUrl } from './format'

interface AnnouncementStore {
  id: string
  name: string
  announcement_description?: string | null
  announcement_image_url?: string | null
}

function AnnouncementDetail({
  storeId,
  storeName,
  onBack,
  onViewStore,
}: {
  storeId: string
  storeName: string
  onBack: () => void
  onViewStore?: (storeId: string) => void
}) {
  const [store, setStore] = useState<AnnouncementStore | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    setStore(null)
    fetch(`/api/store/${storeId}`)
      .then((r) => {
        if (!r.ok) throw new Error()
        return r.json()
      })
      .then((data) => {
        if (!cancelled) setStore(data)
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
        <div className="mx-auto flex w-full max-w-lg items-center gap-3 px-4 py-3 md:max-w-2xl">
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
            <h1 className="truncate text-lg leading-tight font-bold text-slate-900">Opšte obaveštenje</h1>
            <p className="truncate text-xs text-slate-500">{store?.name ?? storeName}</p>
          </div>
        </div>
      </header>

      <div
        className="mx-auto w-full max-w-lg flex-1 px-4 md:max-w-2xl"
        style={{ paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom, 0px))' }}
      >
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

        {!loading && !error && store && (
          <>
            {store.announcement_image_url ? (
              <img
                src={cropImageUrl(store.announcement_image_url, 800, 800)}
                alt=""
                className="mt-4 w-full rounded-2xl object-cover"
              />
            ) : (
              <div className="mt-4 flex aspect-square w-full items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-12 w-12"
                >
                  <path d="m7.5 4.27 9 5.15" />
                  <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
                  <path d="m3.3 7 8.7 5 8.7-5" />
                  <path d="M12 22V12" />
                </svg>
              </div>
            )}

            <section className="mt-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              {store.announcement_description ? (
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-700">
                  {store.announcement_description}
                </p>
              ) : (
                <p className="text-sm text-slate-400">Nema opisa</p>
              )}
            </section>

            {onViewStore && (
              <button
                type="button"
                onClick={() => onViewStore(storeId)}
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
    </div>
  )
}

export default AnnouncementDetail