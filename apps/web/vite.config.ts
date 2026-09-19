import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
        dedupe: ['react', 'react-dom'],
    },
    server: {
        host: '0.0.0.0',
        port: 3001,
        strictPort: true,
        proxy: {
            '/api': 'http://127.0.0.1:4100',
            '/assets': 'http://127.0.0.1:4100',
            '/thumbnails': 'http://127.0.0.1:4100',
        },
    },
})
