import { useEffect, useRef, useState } from 'react'

function cameraErrorMessage(err: unknown): string {
  if (!window.isSecureContext) {
    return 'Pristup kameri je dozvoljen samo preko HTTPS veze (ili localhost-a). Otvorite aplikaciju preko https:// adrese.'
  }
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return 'Ovaj pregledač ne podržava pristup kameri.'
  }
  const name = err instanceof Error ? err.name : undefined
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return 'Kamera je blokirana za ovaj sajt. Otvorite podešavanja pregledača (ikonica brave/podešavanja pored adrese) → Dozvole → Kamera → Dozvoli, pa osvežite stranicu.'
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'Kamera nije pronađena na ovom uređaju.'
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Kamera je zauzeta u drugoj aplikaciji. Zatvorite druge aplikacije i pokušajte ponovo.'
  }
  if (name === 'OverconstrainedError') {
    return 'Kamera ne podržava traženi način rada.'
  }
  return 'Kamera nije dostupna ili pristup nije dozvoljen.'
}

async function cameraPermissionState(): Promise<PermissionState | null> {
  try {
    if (!navigator.permissions?.query) return null
    const status = await navigator.permissions.query({ name: 'camera' as PermissionName })
    return status.state
  } catch {
    return null
  }
}

async function openCameraStream(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    })
  } catch (err) {
    const name = err instanceof Error ? err.name : undefined
    if (name === 'OverconstrainedError' || name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    }
    throw err
  }
}

function CameraCapture({ onCapture, onClose }: { onCapture: (file: File) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    let alive = true
    const start = async () => {
      try {
        setError(null)
        if (!window.isSecureContext) {
          throw new Error('insecure')
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('unsupported')
        }
        if ((await cameraPermissionState()) === 'denied') {
          if (alive) {
            setError(
              'Kamera je blokirana za ovaj sajt. Otvorite podešavanja pregledača (ikonica brave/podešavanja pored adrese) → Dozvole → Kamera → Dozvoli, pa osvežite stranicu.',
            )
          }
          return
        }
        const stream = await openCameraStream()
        if (!alive) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const v = videoRef.current
        if (v) {
          v.srcObject = stream
          await v.play().catch(() => {})
        }
      } catch (err) {
        if (alive) setError(cameraErrorMessage(err))
      }
    }
    start()
    return () => {
      alive = false
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
    }
  }, [])

  async function retry() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    const v = videoRef.current
    if (v) v.srcObject = null
    setError(null)
    try {
      const stream = await openCameraStream()
      streamRef.current = stream
      if (v) {
        v.srcObject = stream
        await v.play().catch(() => {})
      }
    } catch (err) {
      setError(cameraErrorMessage(err))
    }
  }

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
        {error && (
          <div className="absolute inset-x-0 bottom-4 flex flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="px-2 text-sm font-medium text-red-400">{error}</p>
            <button
              type="button"
              onClick={retry}
              className="rounded-lg bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-900 active:bg-white"
            >
              Pokušaj ponovo
            </button>
          </div>
        )}
      </div>
      <div className="flex items-center justify-center py-6">
        <button
          type="button"
          onClick={capture}
          aria-label="Uslikaj"
          disabled={!!error}
          className="h-16 w-16 rounded-full border-4 border-white bg-white/25 disabled:opacity-40"
        >
          <span className="h-12 w-12 rounded-full bg-white" />
        </button>
      </div>
    </div>
  )
}

export default CameraCapture