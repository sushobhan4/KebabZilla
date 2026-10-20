import React, { Component, type ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { AuthProvider, RestaurantProvider } from './state'
import App from './App'
import './styles.css'

const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID || '246180384663-jf752n3net3tf4caq3laquoneicitstu.apps.googleusercontent.com').trim()

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
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => this.setState({ error: null })}
              style={{ padding: '10px 20px', borderRadius: '8px', background: '#c93b2b', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}
            >
              Try Again
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{ padding: '10px 20px', borderRadius: '8px', background: '#222', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}
            >
              Reload Page
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <AuthProvider>
            <RestaurantProvider>
              <App />
            </RestaurantProvider>
          </AuthProvider>
        </BrowserRouter>
      </GoogleOAuthProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
