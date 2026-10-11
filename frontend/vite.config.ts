import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(process.cwd(), '..'), '')
  return {
    plugins: [react()],
    define: {
      // Explicit allowlist: only these two are inlined into the client bundle. .env also
      // holds secrets (JWT_SECRET, ImageKit keys, passwords), which are loaded into the
      // build process but never referenced here, so they cannot reach the browser.
      __CARTO_API_KEY__: JSON.stringify(env.CARTO_API_KEY || ''),
      __CONTACT_EMAIL__: JSON.stringify(env.CONTACT_EMAIL || ''),
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:8000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
        // The Swagger UI served at /api/docs fetches this absolute path, which
        // bypasses the /api prefix, so proxy it separately in development.
        '/openapi.json': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
      },
    },
  }
})
