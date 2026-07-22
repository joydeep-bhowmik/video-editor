import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // ffmpeg.wasm creates its own Worker internally and loads its core script/wasm at
    // runtime; Vite's dependency pre-bundling rewrites those internal references and breaks
    // that loading (surfaces as "failed to import ffmpeg-core.js"). Excluding both packages
    // from pre-bundling is the documented fix.
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
})
