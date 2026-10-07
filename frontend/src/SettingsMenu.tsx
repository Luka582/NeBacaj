import { useState } from 'react'
import { dismissKeyboard } from './tapHandlers'
import type { Session } from './auth'
import { useSession, saveSession, clearSession } from './auth'
import { useViewportHeight } from './useViewportHeight'

// Public contact address, read from CONTACT_EMAIL in .env and inlined at build time by
// vite.config.ts. Falls back to the previous hardcoded address so a build without .env
// still renders a usable mailto.
const SUPPORT_EMAIL = __CONTACT_EMAIL__ || 'support@nebacaj.com'
const ERROR_TRANSLATIONS: Record<string, string> = {
  'Current password is incorrect': 'Trenutna lozinka nije tačna.',
  'Invalid email or password': 'Pogrešna e-adresa ili lozinka.',
  'Account disabled': 'Nalog je deaktiviran.',
  'Not authenticated': 'Niste prijavljeni.',
  'Invalid or expired token': 'Sesija je istekla, prijavite se ponovo.',
  'Too many requests, please wait before trying again': 'Previše pokušaja, sačekajte pre ponovnog pokušaja.',
  'Invalid or expired recovery code': 'Netačan ili istekao kôd za oporavak.',
}

function translateDetail(detail: string): string {
  return ERROR_TRANSLATIONS[detail] ?? detail
}

function PasswordInput({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <input {...props} type={visible ? 'text' : 'password'} className={`${className ?? ''} pr-12`} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        onMouseDown={(e) => e.preventDefault()}
        aria-label={visible ? 'Sakrij lozinku' : 'Prikaži lozinku'}
        className="absolute top-1/2 right-1 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 active:bg-brand-50 active:text-brand-600"
      >
        {visible ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
          >
            <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
            <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
            <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
            <line x1="2" x2="22" y1="2" y2="22" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
          >
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  )
}

interface SettingsMenuProps {
  open: boolean
  onClose: () => void
  onOpenMyProducts: () => void
  onOpenAnnouncement: () => void
}

function SettingsMenu({ open, onClose, onOpenMyProducts, onOpenAnnouncement }: SettingsMenuProps) {
  const session = useSession()
  const vh = useViewportHeight()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [changing, setChanging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loginFailed, setLoginFailed] = useState(false)
  const [changeFailed, setChangeFailed] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [codeSent, setCodeSent] = useState(false)
  const [recoverEmail, setRecoverEmail] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [recoveryNewPassword, setRecoveryNewPassword] = useState('')
  const [recoveryRepeat, setRecoveryRepeat] = useState('')

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setLoginFailed(false)
    if (!email.includes('@') || !password) {
      setError('Unesite e-adresu i lozinku.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setLoginFailed(true)
        setError(typeof data.detail === 'string' ? translateDetail(data.detail) : 'Prijava nije uspela.')
        return
      }
      if (data.role !== 'worker') {
        setError('Samo radnički nalozi mogu da se prijave ovde.')
        return
      }
      const next: Session = {
        token: data.access_token as string,
        role: data.role as string,
        email,
        must_change_password: Boolean(data.must_change_password),
      }
      saveSession(next)
      setPassword('')
      if (next.must_change_password) setChanging(true)
    } catch {
      setError('Ne mogu da se povežem sa serverom.')
    } finally {
      setBusy(false)
    }
  }

  async function handleChangePassword(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setChangeFailed(false)
    if (!session) return
    if (newPassword !== repeatPassword) {
      setError('Nove lozinke se ne poklapaju.')
      return
    }
    if (newPassword.length < 8) {
      setError('Nova lozinka je prekratka (minimum 8 karaktera).')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
      })
      const data = await res.json()
      if (!res.ok) {
        setChangeFailed(data.detail === 'Current password is incorrect')
        setError(typeof data.detail === 'string' ? translateDetail(data.detail) : 'Promena lozinke nije uspela.')
        return
      }
      const next = { ...session, must_change_password: false }
      saveSession(next)
      setChanging(false)
      setOldPassword('')
      setNewPassword('')
      setRepeatPassword('')
    } catch {
      setError('Ne mogu da se povežem sa serverom.')
    } finally {
      setBusy(false)
    }
  }

  function startRecovery() {
    setRecoverEmail(email || session?.email || '')
    setCodeSent(false)
    setRecoveryCode('')
    setRecoveryNewPassword('')
    setRecoveryRepeat('')
    setLoginFailed(false)
    setChangeFailed(false)
    setError(null)
    setBusy(false)
    setRecovering(true)
  }

  async function handleRequestCode(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!recoverEmail.includes('@')) {
      setError('Unesite ispravnu e-adresu.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/auth/request-recovery-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: recoverEmail }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(typeof data.detail === 'string' ? translateDetail(data.detail) : 'Slanje kôda nije uspelo.')
        return
      }
      setCodeSent(true)
    } catch {
      setError('Ne mogu da se povežem sa serverom.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRecover(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (!recoverEmail.includes('@') || !recoveryCode) {
      setError('Unesite e-adresu i kôd za oporavak.')
      return
    }
    if (recoveryNewPassword !== recoveryRepeat) {
      setError('Nove lozinke se ne poklapaju.')
      return
    }
    if (recoveryNewPassword.length < 8) {
      setError('Nova lozinka je prekratka (minimum 8 karaktera).')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/auth/recover-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: recoverEmail,
          code: recoveryCode,
          new_password: recoveryNewPassword,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(typeof data.detail === 'string' ? translateDetail(data.detail) : 'Oporavak nije uspeo.')
        return
      }
      if (data.role !== 'worker') {
        setError('Samo radnički nalozi mogu da se prijave ovde.')
        return
      }
      const next: Session = {
        token: data.access_token as string,
        role: data.role as string,
        email: recoverEmail,
        must_change_password: Boolean(data.must_change_password),
      }
      saveSession(next)
      setEmail(recoverEmail)
      setPassword('')
      setRecovering(false)
      setCodeSent(false)
      setError(null)
    } catch {
      setError('Ne mogu da se povežem sa serverom.')
    } finally {
      setBusy(false)
    }
  }

  function logout() {
    clearSession()
    setChanging(false)
    setRecovering(false)
    setCodeSent(false)
    setLoginFailed(false)
    setError(null)
  }

  const inputClass =
    'w-full rounded-lg border border-slate-200 bg-slate-50 py-2 px-3 text-sm font-medium text-slate-700 outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-100'

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 top-0 z-[1500] flex flex-col overflow-hidden bg-white opacity-0 shadow-2xl transition-[transform,opacity] duration-300 ease-out ${
        open ? 'pointer-events-auto translate-x-0 opacity-100' : '-translate-x-full opacity-0'
      }`}
      style={{ height: vh }}
      inert={!open}
      aria-hidden={!open}
      onKeyDown={(e) => {
        if (open && e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-2 py-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="Nazad"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 active:bg-slate-100"
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
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
          </svg>
        </button>
        <span className="min-w-0 flex-1 truncate text-center text-lg leading-tight font-extrabold tracking-tight text-brand-600">
          NeBacaj
        </span>
        <span className="w-10 shrink-0" />
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4"
        onWheel={dismissKeyboard}
        onTouchMove={dismissKeyboard}
      >
        {session && changing ? (
          <form onSubmit={handleChangePassword} className="space-y-3">
            <h2 className="text-sm font-bold text-slate-900">Promena lozinke</h2>
            <p className="text-xs text-slate-500">
              Privremena lozinka se mora promeniti pri prvoj prijavi.
            </p>
            <PasswordInput
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              placeholder="Trenutna lozinka"
              autoComplete="current-password"
              className={inputClass}
            />
            <PasswordInput
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Nova lozinka (min. 8 karaktera)"
              autoComplete="new-password"
              className={inputClass}
            />
            <PasswordInput
              value={repeatPassword}
              onChange={(e) => setRepeatPassword(e.target.value)}
              placeholder="Ponovite novu lozinku"
              autoComplete="new-password"
              className={inputClass}
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
            {changeFailed && (
              <button
                type="button"
                onClick={startRecovery}
                className="w-full text-sm text-brand-600 underline"
              >
                Zaboravili ste lozinku?
              </button>
            )}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-brand-600 py-2 text-sm font-semibold text-white active:bg-brand-700 disabled:opacity-50"
            >
              Promeni lozinku
            </button>
          </form>
        ) : session ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <p className="text-xs text-slate-400">Prijavljeni ste kao</p>
              <p className="truncate text-sm font-semibold text-slate-900">{session.email}</p>
            </div>
            <button
              type="button"
              onClick={onOpenMyProducts}
              className="w-full rounded-lg bg-brand-600 py-3 text-sm font-semibold text-white active:bg-brand-700"
            >
              Moji proizvodi
            </button>
            <button
              type="button"
              onClick={onOpenAnnouncement}
              className="w-full rounded-lg border border-slate-200 py-3 text-sm font-semibold text-brand-700 active:bg-brand-50"
            >
              Opšte obaveštenje
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null)
                setChanging(true)
              }}
              className="w-full rounded-lg border border-slate-200 py-2 text-sm font-semibold text-slate-600 active:bg-slate-50"
            >
              Promeni lozinku
            </button>
            <button
              type="button"
              onClick={logout}
              className="w-full rounded-lg border border-slate-200 py-2 text-sm font-semibold text-slate-600 active:bg-slate-50"
            >
              Odjavi se
            </button>
          </div>
        ) : recovering ? (
          <div className="space-y-3">
            <h2 className="text-sm font-bold text-slate-900">Oporavak lozinke</h2>
            {!codeSent ? (
              <form onSubmit={handleRequestCode} className="space-y-3">
                <p className="text-xs text-slate-500">
                  Unesite e-adresu da biste dobili kôd za oporavak.
                </p>
                <input
                  type="email"
                  value={recoverEmail}
                  onChange={(e) => setRecoverEmail(e.target.value)}
                  placeholder="E-adresa"
                  autoComplete="email"
                  className={inputClass}
                />
                {error && <p className="text-sm text-red-500">{error}</p>}
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-lg bg-brand-600 py-2 text-sm font-semibold text-white active:bg-brand-700 disabled:opacity-50"
                >
                  Pošalji kôd
                </button>
              </form>
            ) : (
              <form onSubmit={handleRecover} className="space-y-3">
                <p className="text-xs text-slate-500">
                  Kôd je poslat (ako e-adresa postoji). Unesite kôd i novu lozinku.
                </p>
                <input
                  type="text"
                  value={recoveryCode}
                  onChange={(e) => setRecoveryCode(e.target.value)}
                  placeholder="Kôd za oporavak"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className={inputClass}
                />
                <PasswordInput
                  value={recoveryNewPassword}
                  onChange={(e) => setRecoveryNewPassword(e.target.value)}
                  placeholder="Nova lozinka (min. 8 karaktera)"
                  autoComplete="new-password"
                  className={inputClass}
                />
                <PasswordInput
                  value={recoveryRepeat}
                  onChange={(e) => setRecoveryRepeat(e.target.value)}
                  placeholder="Ponovite novu lozinku"
                  autoComplete="new-password"
                  className={inputClass}
                />
                {error && <p className="text-sm text-red-500">{error}</p>}
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-lg bg-brand-600 py-2 text-sm font-semibold text-white active:bg-brand-700 disabled:opacity-50"
                >
                  Poništi lozinku
                </button>
              </form>
            )}
            <button
              type="button"
              onClick={() => {
                setRecovering(false)
                setCodeSent(false)
                setError(null)
              }}
              className="w-full rounded-lg border border-slate-200 py-2 text-sm font-semibold text-slate-600 active:bg-slate-50"
            >
              Nazad na prijavu
            </button>
          </div>
        ) : (
          <form onSubmit={handleLogin} className="space-y-3">
            <h2 className="text-sm font-bold text-slate-900">Prijavite se</h2>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="E-adresa"
              autoComplete="email"
              className={inputClass}
            />
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Lozinka"
              autoComplete="current-password"
              className={inputClass}
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-brand-600 py-2 text-sm font-semibold text-white active:bg-brand-700 disabled:opacity-50"
            >
              Prijavi se
            </button>
            {loginFailed && (
              <button
                type="button"
                onClick={startRecovery}
                className="w-full text-sm text-brand-600 underline"
              >
                Zaboravili ste lozinku?
              </button>
            )}
            <p className="text-xs text-slate-400">Prijava je namenjena radničkim nalozima.</p>
          </form>
        )}

        <div className="mt-6 border-t border-slate-100 pt-4">
          <h2 className="text-sm font-bold text-slate-900">Pomoć i kontakt</h2>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="mt-2 inline-flex items-center gap-2 text-sm text-brand-600"
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
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m22 7-10 5L2 7" />
            </svg>
            {SUPPORT_EMAIL}
          </a>
        </div>
      </div>
    </div>
  )
}

export default SettingsMenu