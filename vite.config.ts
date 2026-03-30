import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const port = Number(process.env.PORT) || 5173
const hmrHost = process.env.DEV_HMR_HOST?.trim()
const hmrClientPortRaw = process.env.DEV_HMR_CLIENT_PORT?.trim()
const hmrClientPort =
  hmrClientPortRaw != null && hmrClientPortRaw !== ''
    ? Number(hmrClientPortRaw)
    : undefined

const socketIoProxy = {
  '/socket.io': {
    target: process.env.WS_BACKEND_URL || 'http://127.0.0.1:5001',
    ws: true,
    changeOrigin: true,
  },
} as const

export default defineConfig({
  plugins: [react()],
  base: '/DRT_visualization_dashboard/',
  server: {
    host: true,
    port,
    strictPort: true,
    allowedHosts: true,
    hmr:
      hmrHost
        ? {
            host: hmrHost,
            ...(hmrClientPort != null && !Number.isNaN(hmrClientPort)
              ? { clientPort: hmrClientPort }
              : {}),
          }
        : undefined,
    proxy: { ...socketIoProxy },
  },
  preview: {
    host: true,
    port,
    strictPort: true,
    proxy: { ...socketIoProxy },
  },
})
