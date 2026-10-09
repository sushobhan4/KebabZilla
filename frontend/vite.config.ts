import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

declare const process: { env: Record<string, string | undefined> }

export default defineConfig(({ command }) => {
  const isBuild = command === 'build'
  const repoName = process.env.GITHUB_REPOSITORY
    ? `/${process.env.GITHUB_REPOSITORY.split('/')[1]}/`
    : '/KebabZilla/'
  const base = process.env.BASE_PATH || (isBuild ? repoName : '/')

  return {
    plugins: [react()],
    base,
    server: {
      host: '0.0.0.0',
      allowedHosts: true,
      proxy: {
        '/api': 'http://127.0.0.1:8000',
      },
    },
  }
})

