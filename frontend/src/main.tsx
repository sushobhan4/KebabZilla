import React, { Component, type ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider, RestaurantProvider } from './state'
import App from './App'
import './styles.css'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Application Error:', error, errorInfo)
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '40px 20px', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
          <h2 style={{ color: '#c93b2b', marginBottom: '12px' }}>Something went wrong</h2>
          <p style={{ color: '#666', maxWidth: '500px', margin: '0 auto 20px' }}>
            {(this.state.error as Error).message || 'An unexpected error occurred while loading the application.'}
          </p>
          <button
            onClick={() => { localStorage.clear(); sessionStorage.clear(); window.location.reload() }}
            style={{ padding: '10px 20px', borderRadius: '8px', background: '#222', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}
          >
            Clear Cache & Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <AuthProvider>
          <RestaurantProvider>
            <App />
          </RestaurantProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)

