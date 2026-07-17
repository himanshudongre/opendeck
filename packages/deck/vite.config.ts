import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: {
    // A deck must run on the spare phone in the drawer, not only this
    // year's: down-level syntax to iOS 13-era WebKit. APIs are guarded in
    // src/lib/compat.ts.
    target: ['es2018', 'safari13'],
    cssTarget: 'chrome107',
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'AgentDeck',
        short_name: 'AgentDeck',
        description: 'A physical-feeling command deck for AI coding agents.',
        display: 'fullscreen',
        orientation: 'any',
        background_color: '#0E0F12',
        theme_color: '#0E0F12',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The offline shell caches the app; live data never should be.
        navigateFallbackDenylist: [/^\/api\//, /^\/ws/],
        globPatterns: ['**/*.{js,css,html,png,woff2}'],
      },
    }),
  ],
});
