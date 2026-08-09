import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // Electron loads from the filesystem, so assets must resolve relatively.
  base: './',
  server: { port: 5273, strictPort: true },
  build: {
    target: 'chrome128',          // Electron 33 ships Chromium 130 — no downleveling needed
    outDir: 'dist',
    assetsInlineLimit: 0,         // never inline GLBs
    rollupOptions: {
      output: {
        // Three is large and stable; splitting it keeps app rebuilds cheap and lets the
        // 3D chunk load in parallel with first paint.
        manualChunks: {
          three: ['three'],
          r3f: ['@react-three/fiber', '@react-three/drei'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
