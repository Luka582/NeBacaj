import { useState } from 'react'
import { CharCounter } from './CharCounter'
import { useBackLayer } from './backStack'

export const REPORT_COMMENT_MAX = 500
export const REPORT_COMMENT_MIN = 50

const REASONS: { value: string; label: string }[] = [
  { value: 'wrong_price', label: 'Netačna cena' },
  { value: 'wrong_info', label: 'Netačni podaci' },
  { value: 'unavailable', label: 'Nema više proizvoda' },
  { value: 'closed', label: 'Radnja je zatvorena' },
  { value: 'offensive', label: 'Uvredljiv ili neprikladan sadržaj' },
  { value: 'other', label: 'Drugo' },
]

function ReportDialog({
  open,
  onClose,
  storeId,
  storeName,
  productId,
  productName,
}: {
  open: boolean
  onClose: () => void
  storeId: string
  storeName: string
  productId?: string | null
  productName?: string | null
}) {
  const [reason, setReason] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(false)

  const reset = () => {
    setReason(null)
    setComment('')
    setSending(false)
    setSent(false)
    setError(false)
  }

  const close = () => {
    reset()
    onClose()
  }

  useBackLayer(open, close)

  if (!open) return null

  const submit = async () => {
    if (!reason || sending) return
    setSending(true)
    setError(false)
    try {
      const trimmed = comment.trim()
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: storeId,
          product_id: productId ?? null,
          reason,
          comment: trimmed || null,
        }),
      })
      if (!res.ok) throw new Error()
      setSent(true)
    } catch {
      setError(true)
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[4000] flex items-center justify-center bg-black/40 px-4"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          close()
        }
      }}
    >
      <div className="absolute inset-0" onClick={close} />
      <div className="relative max-h-[85vh] w-full max-w-sm overflow-y-auto overscroll-contain rounded-2xl bg-white p-4">
        {sent ? (
          <div className="py-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-50 text-green-600">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <p className="mt-3 text-sm font-semibold text-slate-800">Prijava je poslata</p>
            <p className="mt-1 text-sm text-slate-500">Hvala što pomažete da NeBacaj bude tačniji.</p>
            <button
              type="button"
              onClick={close}
              className="mt-4 w-full rounded-lg bg-brand-600 py-2 text-sm font-semibold text-white active:bg-brand-700"
            >
              U redu
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm font-semibold text-slate-800">Prijavi problem</p>
            <p className="mt-1 text-sm text-slate-500">
              {productName ? `${productName} - ${storeName}` : storeName}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              {REASONS.map((r) => {
                const selected = reason === r.value
                return (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setReason(r.value)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                      selected
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-slate-200 text-slate-600 active:bg-slate-50'
                    }`}
                  >
                    {r.label}
                  </button>
                )
              })}
            </div>

            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between">
                <label htmlFor="report-comment" className="text-xs font-semibold text-slate-500">
                  Komentar (opciono)
                </label>
                <CharCounter current={comment.length} max={REPORT_COMMENT_MAX} />
              </div>
              <textarea
                id="report-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, REPORT_COMMENT_MAX))}
                rows={3}
                placeholder="Opišite problem... (najmanje 50 karaktera)"
                className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none"
              />
            </div>

            {error && <p className="mt-2 text-xs font-semibold text-red-600">Nešto je pošlo po zlu. Pokušaj ponovo.</p>}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={close}
                className="flex-1 rounded-lg border border-slate-200 py-2 text-sm font-semibold text-slate-600 active:bg-slate-50"
              >
                Otkaži
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!reason || sending || comment.trim().length < REPORT_COMMENT_MIN || comment.length > REPORT_COMMENT_MAX}
                className="flex-1 rounded-lg bg-brand-600 py-2 text-sm font-semibold text-white active:bg-brand-700 disabled:opacity-50"
              >
                {sending ? 'Šaljem...' : 'Pošalji'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default ReportDialog
