// vite.config.js
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: [
      'localhost',
      '192.168.72.103',
      'df67cddaeb06.ngrok-free.app',  // ✅ Agrega tu URL de ngrok
      '.ngrok.io',                    // ✅ Para cualquier subdominio de ngrok
      '.ngrok-free.app'               // ✅ Para el plan gratuito
    ]
  }
})