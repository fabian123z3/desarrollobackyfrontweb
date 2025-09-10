// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(),tailwindcss(),], // ← ESTO FALTABA
  server: {
    
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: [
      'localhost',
      '192.168.72.103',
      'df67cddaeb06.ngrok-free.app',
      '.ngrok.io',
      '.ngrok-free.app'
    ]
  },
  build: {
    outDir: 'dist'
  }
})