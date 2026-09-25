import { useState } from 'react'
import { dismissKeyboard } from './tapHandlers'
import type { Session } from './auth'
import { loadSession, saveSession, clearSession } from './auth'

const SUPPORT_EMAIL = 'support@nebacaj.com'
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

interface SettingsMenuProps {
  onClose: () => void
  onOpenMyProducts: () => void
}

function SettingsMenu({ onClose, onOpenMyProducts }: SettingsMenuProps) {
  const [session, setSession] = useState<Session | null>(() => loadSession())
  const [vh] = useState(() => window.innerHeight)
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
      setSession(next)
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
      setSession(next)
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
      setSession(next)
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
    setSession(null)
    setChanging(false)
    setRecovering(false)
    setCodeSent(false)
    setLoginFailed(false)
    setError(null)
  }

  const inputClass =
    'w-full rounded-lg border border-slate-200 bg-slate-50 py-2 px-3 text-sm font-medium text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100'

  return (
    <div className="fixed inset-x-0 top-0 z-[1500] flex flex-col bg-white" style={{ height: vh }}>
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
        <span className="min-w-0 flex-1 truncate text-center text-lg leading-tight font-extrabold tracking-tight text-blue-600">
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
            <input
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              placeholder="Trenutna lozinka"
              autoComplete="current-password"
              className={inputClass}
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Nova lozinka (min. 8 karaktera)"
              autoComplete="new-password"
              className={inputClass}
            />
            <input
              type="password"
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
                className="w-full text-sm text-blue-600 underline"
              >
                Zaboravili ste lozinku?
              </button>
            )}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white active:bg-blue-700 disabled:opacity-50"
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
              className="w-full rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white active:bg-blue-700"
            >
              Moji proizvodi
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
                  className="w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white active:bg-blue-700 disabled:opacity-50"
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
                <input
                  type="password"
                  value={recoveryNewPassword}
                  onChange={(e) => setRecoveryNewPassword(e.target.value)}
                  placeholder="Nova lozinka (min. 8 karaktera)"
                  autoComplete="new-password"
                  className={inputClass}
                />
                <input
                  type="password"
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
                  className="w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white active:bg-blue-700 disabled:opacity-50"
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
            <input
              type="password"
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
              className="w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white active:bg-blue-700 disabled:opacity-50"
            >
              Prijavi se
            </button>
            {loginFailed && (
              <button
                type="button"
                onClick={startRecovery}
                className="w-full text-sm text-blue-600 underline"
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
            className="mt-2 inline-flex items-center gap-2 text-sm text-blue-600"
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