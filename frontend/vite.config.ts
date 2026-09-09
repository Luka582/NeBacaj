import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

function configPlugin() {
  return {
    name: 'serve-root-config',
    configureServer(server: any) {
      server.middlewares.use('/config.json', (_req: any, res: any) => {
        const configPath = path.resolve(process.cwd(), '..', 'config.json')
        const data = fs.readFileSync(configPath, 'utf-8')
        res.setHeader('Content-Type', 'application/json')
        res.end(data)
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(process.cwd(), '..'), '')
  return {
    plugins: [react(), configPlugin()],
    define: {
      __CARTO_API_KEY__: JSON.stringify(env.CARTO_API_KEY || ''),
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:8000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
})
