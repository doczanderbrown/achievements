import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uncaught error:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center p-8">
          <div className="max-w-md rounded-3xl border border-red-200 bg-red-50 p-8 text-center shadow-soft">
            <div className="text-2xl font-semibold text-red-700">Something went wrong</div>
            <p className="mt-3 text-sm text-red-600">
              An unexpected error occurred. Reload the page to try again.
            </p>
            <pre className="mt-4 overflow-auto rounded-xl bg-red-100 p-3 text-left text-xs text-red-800">
              {this.state.error.message}
            </pre>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 rounded-full border border-red-300 bg-white px-5 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50"
            >
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default ErrorBoundary
