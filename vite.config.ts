import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

const noDesktopReload = () => process.env.MARKUMO_DESKTOP_NO_RELOAD === '1'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  optimizeDeps: { entries:['index.html'], include:['mermaid','katex','dompurify'] },
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
    hmr: noDesktopReload() ? false : undefined,
    watch: noDesktopReload() ? null : {
      ignored: ['**/src-tauri/**', '**/.markumo-dev/**', '**/.lightedit-dev/**'],
    },
  },
})
