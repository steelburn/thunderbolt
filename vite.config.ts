import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'
import { analyzer } from 'vite-bundle-analyzer'
import { bundleMigrations } from './src/db/bundle-migrations'

const host = process.env.TAURI_DEV_HOST

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    {
      name: 'bundle-migrations',
      async buildStart() {
        bundleMigrations({
          migrationsDir: path.resolve(__dirname, 'src/drizzle'),
          outputFile: path.resolve(__dirname, 'src/drizzle/_migrations.ts'),
        })
      },
    },
    tailwindcss(),
    react(),
    analyzer({
      analyzerMode: 'static',
      openAnalyzer: false,
    }),
    {
      name: 'configure-response-headers',
      configureServer: (server) => {
        server.middlewares.use((_req, res, next) => {
          res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
          next()
        })
      },
    },
  ],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },
  optimizeDeps: {
    exclude: ['sqlocal'],
  },
  worker: {
    format: 'es',
  },
})
