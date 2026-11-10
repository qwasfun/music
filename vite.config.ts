import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  plugins: [react(), VitePWA({
    strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts', registerType: 'prompt',
    injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'], maximumFileSizeToCacheInBytes: 6 * 1024 * 1024 },
    manifest: {
      name: '余音 · 私人音乐空间', short_name: '余音', lang: 'zh-CN',
      description: '收藏喜欢的声音，让音乐随时同行。', start_url: '/', scope: '/',
      display: 'standalone', background_color: '#111315', theme_color: '#111315',
      icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }]
    }
  })],
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true, headers: { Origin: 'http://127.0.0.1:8787' } } } }
});
