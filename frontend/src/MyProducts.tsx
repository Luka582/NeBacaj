import { useMemo } from 'react'
import { loadSession, isWorker } from './auth'

interface MyProductsProps {
  onClose: () => void
}

function MyProducts({ onClose }: MyProductsProps) {
  const loggedIn = useMemo(() => isWorker(loadSession()), [])

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
          <h1 className="min-w-0 flex-1 truncate text-lg leading-tight font-bold text-slate-900">
            Moji proizvodi
          </h1>
        </div>
      </header>
      <div className="mx-auto w-full max-w-lg flex-1 px-4 pt-8 pb-10 text-center text-sm text-slate-500">
        {loggedIn
          ? 'Vaši proizvodi će se uskoro pojaviti ovde.'
          : 'Prijavite se u meniju podešavanja da biste videli svoje proizvode.'}
      </div>
    </div>
  )
}

export default MyProducts