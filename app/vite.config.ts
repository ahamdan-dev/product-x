import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import { fileURLToPath, URL } from 'node:url';

/*
 * ── Why the Electron plugin is MODE-GATED, and why it has to exist at all ──────────────────────
 *
 * `electron/main.ts` is a complete always-on-top overlay shell: two transparent frameless windows,
 * click-through management, single-instance lock, narrow IPC. It was written, it typechecks, and
 * NOTHING BUILT IT. `package.json` pointed `main` at `dist-electron/main.js`, which no step produced,
 * `vite-plugin-electron` sat in devDependencies unused, and `TOUCH-ME.cmd` ended at `npm run dev` —
 * a plain Vite web server. So double-clicking the launcher opened a dev server and never the desktop
 * overlay. The product's defining surface could not start.
 *
 * MODE-GATED because `vite` (plain) is the harness path. Every screenshot tool, gate probe and rig
 * harness in `tools/` drives a normal dev server and loads it in its own BrowserWindow; if this
 * plugin were unconditional, `npm run dev` would also spawn the real Electron app, so every harness
 * run would open two extra windows and fight over the single-instance lock. `npm run dev` stays a
 * web server; `npm run electron:dev` is the app.
 *
 * PRELOAD MUST BE `.mjs`. `main.ts` resolves `path.join(__dirname, 'preload.mjs')`, and that is not
 * arbitrary: this package is `"type": "module"`, and Electron only loads an ESM preload when the file
 * carries the `.mjs` extension. Emitting `preload.js` would leave `contextBridge` unexposed and the
 * renderer would find `window.px` undefined — the whole click-through contract dead, with no error at
 * build time. Hence the explicit `entryFileNames` below.
 */
const electronShell = [
  {
    // The main process. Started by the plugin once Vite is serving, with VITE_DEV_SERVER_URL set —
    // which is exactly the variable `main.ts` reads to decide dev URL vs. packaged file load.
    entry: 'electron/main.ts',
    vite: {
      build: {
        outDir: 'dist-electron',
        // Never wipe the sibling renderer build, and never wipe main when preload builds after it.
        emptyOutDir: false,
        rollupOptions: {
          external: ['electron'],
          output: { entryFileNames: 'main.js' },
        },
      },
    },
  },
  {
    entry: 'electron/preload.ts',
    vite: {
      build: {
        outDir: 'dist-electron',
        emptyOutDir: false,
        rollupOptions: {
          external: ['electron'],
          // See above: `.mjs` or the bridge silently never loads.
          output: { entryFileNames: 'preload.mjs' },
        },
      },
    },
  },
];

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'electron' ? electron(electronShell) : [])],
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
}));
