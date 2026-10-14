import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const modulePath = id.replace(/\\/g, '/')
          if (/node_modules\/(@codemirror\/(state|view|commands|search|autocomplete|language)\/|@lezer\/(common|lr|highlight)\/|style-mod\/|crelt\/)/.test(modulePath)) return 'editor-core'
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    hmr: process.env.LIGHTEDIT_DESKTOP_NO_RELOAD === '1' ? false : undefined,
    watch: process.env.LIGHTEDIT_DESKTOP_NO_RELOAD === '1' ? null : {
      ignored: ['**/src-tauri/**', '**/.lightedit-dev/**', '**/test-results/**'],
    },
  },
})
