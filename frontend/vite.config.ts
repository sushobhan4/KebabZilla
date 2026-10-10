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
  }
})

