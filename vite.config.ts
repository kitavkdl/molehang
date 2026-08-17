import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    // 번들 대부분이 three.js 한 덩어리다 — 쪼갤 이유가 없어 경고만 올려 둔다
    chunkSizeWarningLimit: 800,
  },
});
