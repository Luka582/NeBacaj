import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-white p-6 text-center">
          <p className="text-lg font-bold text-slate-900">Nešto je pošlo po zlu.</p>
          <p className="text-sm text-slate-500">Osveži stranicu i pokušaj ponovo.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white active:bg-brand-700"
          >
            Osveži stranicu
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default ErrorBoundary