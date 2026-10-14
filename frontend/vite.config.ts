import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

declare const process: { env: Record<string, string | undefined> }

export default defineConfig(() => {
  const isGitHubCi = Boolean(process.env.GITHUB_ACTIONS)
  const repoName = process.env.GITHUB_REPOSITORY
    ? `/${process.env.GITHUB_REPOSITORY.split('/')[1]}/`
    : '/KebabZilla/'
  const base = process.env.BASE_PATH || (isGitHubCi ? repoName : '/')

  return {
    plugins: [react()],
    base,
    server: {
      host: '0.0.0.0',
      allowedHosts: true as const,
      proxy: {
        '/api': 'http://127.0.0.1:8000',
      },
    },
    preview: {
      host: '0.0.0.0',
      port: 4173,
      proxy: {
        '/api': 'http://127.0.0.1:8000',
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (
              id.includes('node_modules/react/') ||
              id.includes('node_modules/react-dom/') ||
              id.includes('node_modules/react-router/') ||
              id.includes('node_modules/react-router-dom/')
            ) {
              return 'vendor-react'
            }
            if (
              id.includes('node_modules/@react-oauth') ||
              id.includes('node_modules/@googlemaps')
            ) {
              return 'vendor-services'
            }
            if (id.includes('node_modules/lucide-react')) {
              return 'vendor-icons'
            }
            if (id.includes('src/vendor/liquidglass')) {
              return 'vendor-liquidglass'
            }
          },
        },
      },
    },
  }
})

