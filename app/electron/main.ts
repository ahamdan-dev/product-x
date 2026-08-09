/**
 * Electron main process — the always-on-top companion shell.
 *
 * Two windows, on purpose:
 *
 *   COMPANION — a small, frameless, transparent, always-on-top window that holds the character and
 *   any floating surfaces. It remains interactive so its controls and drag handle cannot become
 *   stranded behind an input-routing state.
 *
 *   WORLD — a normal resizable window for the board and the simulations. Summoned by the companion,
 *   not always present.
 *
 * The user's rule — "ANYTHING THAT CAN POP UP ON A USERS SCREEN SHOULD ALWAYS BE ABLE TO BE EITHER
 * MINIMIZED OR CLOSED OUT... THE COMPANION AND ANY CONTAINERS THAT OPEN ARE ALSO RESIZABLE AND
 * MOVEABLE" — is enforced partly here (frameless windows the renderer can drag/resize) and partly in
 * the renderer's surface chrome.
 */

import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(__dirname, '../dist');
const PRELOAD = path.join(__dirname, 'preload.mjs');

let companion: BrowserWindow | null = null;
let world: BrowserWindow | null = null;

/** Companion window size. Small enough to be ambient, large enough for the character + a card. */
const COMPANION_W = 440;
const COMPANION_H = 620;

function load(win: BrowserWindow, route: string) {
  if (DEV_URL) {
    void win.loadURL(`${DEV_URL}#/${route}`);
  } else {
    void win.loadFile(path.join(RENDERER_DIST, 'index.html'), { hash: `/${route}` });
  }
}

function createCompanion() {
  const { workArea } = screen.getPrimaryDisplay();

  companion = new BrowserWindow({
    width: COMPANION_W,
    height: COMPANION_H,
    // Bottom-right by default: out of the way of the reading area, near the tray.
    x: workArea.x + workArea.width - COMPANION_W - 24,
    y: workArea.y + workArea.height - COMPANION_H - 24,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    minWidth: 300,
    minHeight: 380,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    hasShadow: false,          // we draw our own two-part shadow; the OS one clips transparency
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,   // an ambient companion must keep animating when unfocused
    },
  });

  // 'screen-saver' outranks normal always-on-top, so we stay above other pinned windows —
  // but NOT above OS-level fullscreen video, which would be obnoxious.
  companion.setAlwaysOnTop(true, 'screen-saver');
  companion.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });

  companion.once('ready-to-show', () => companion?.show());
  companion.on('closed', () => { companion = null; });

  // External links open in the real browser, never inside the shell.
  companion.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  load(companion, 'companion');
}

function createWorld() {
  if (world && !world.isDestroyed()) {
    world.show();
    world.focus();
    return;
  }

  const { workArea } = screen.getPrimaryDisplay();
  const w = Math.min(1440, Math.round(workArea.width * 0.82));
  const h = Math.min(900, Math.round(workArea.height * 0.86));

  world = new BrowserWindow({
    width: w,
    height: h,
    x: workArea.x + Math.round((workArea.width - w) / 2),
    y: workArea.y + Math.round((workArea.height - h) / 2),
    minWidth: 940,
    minHeight: 620,
    frame: false,
    /**
     * Transparent, like the companion. This window holds the Map and the surfaces, and the user's
     * rule is that this product "CAND OBSCURE THE USERS SCREEN OR FUNCTION" — an always-on-top thing
     * that paints an opaque rectangle over the desktop is a window that is in the way, which is the
     * one thing an ambient companion must never be.
     *
     * Consequences that are easy to get wrong, so they are handled explicitly:
     *   - `backgroundColor` must be fully transparent, not a color. Any opaque value here is composited
     *     under the page and defeats `transparent` entirely.
     *   - The renderer must not paint a background either (see styles/app.css) and the WebGL context
     *     must be created with `alpha: true` and a clear alpha of 0, or the 3D canvas punches an opaque
     *     hole exactly where the Map lives.
     *   - `hasShadow: false` because the OS shadow is drawn around the window *rectangle*, so on a
     *     transparent window it outlines empty air. Our own surfaces carry their own shadows.
     */
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  // The Map is a working surface, so it stays above the material the student is reading — but one
  // level below the companion, which must always be able to sit on top of its own window.
  world.setAlwaysOnTop(true, 'floating');

  world.once('ready-to-show', () => world?.show());
  world.on('closed', () => { world = null; });
  load(world, 'world');
}

// ── IPC. Deliberately narrow: each channel is one verb on one window. ──────────────────────

ipcMain.handle('companion:setInteractive', (_e, interactive: boolean) => {
  if (!companion || companion.isDestroyed()) return;
  companion.setIgnoreMouseEvents(!interactive, { forward: true });
});

/**
 * The same contract for the main window.
 *
 * `forward: true` matters: without it Chromium stops sending mouse *move* events too, so the renderer
 * can never observe the pointer re-entering a surface and the window would be stuck click-through
 * forever. With it, moves are still delivered while clicks pass through to the app underneath, which is
 * what lets the renderer turn interactivity back on at the moment the pointer touches real content.
 */
ipcMain.handle('world:setInteractive', (_e, interactive: boolean) => {
  if (!world || world.isDestroyed()) return;
  world.setIgnoreMouseEvents(!interactive, { forward: true });
});

ipcMain.handle('companion:resize', (_e, w: number, h: number) => {
  if (!companion || companion.isDestroyed()) return;
  // getPosition() is typed as number[], so destructuring yields number|undefined under strict
  // indexed access. getBounds() is a real object and needs no guard.
  const { x, y } = companion.getBounds();
  companion.setBounds({ x, y, width: Math.round(w), height: Math.round(h) }, false);
});

ipcMain.handle('companion:moveBy', (_e, dx: number, dy: number) => {
  if (!companion || companion.isDestroyed()) return;
  const { x, y } = companion.getBounds();
  companion.setPosition(Math.round(x + dx), Math.round(y + dy), false);
});

ipcMain.handle('window:minimize', (e) => {
  BrowserWindow.fromWebContents(e.sender)?.minimize();
});

ipcMain.handle('window:close', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  // Closing the companion quits the app; closing the world just dismisses it.
  if (win === companion) app.quit();
  else win?.close();
});

ipcMain.handle('world:open', () => createWorld());
ipcMain.handle('world:close', () => { world?.close(); });

ipcMain.handle('shell:info', () => ({
  platform: process.platform,
  version: app.getVersion(),
  scaleFactor: screen.getPrimaryDisplay().scaleFactor,
}));

// ── Lifecycle ─────────────────────────────────────────────────────────────────────────────

// One instance only — two companions on screen would be a bug, not a feature.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    companion?.show();
    companion?.focus();
  });

  void app.whenReady().then(() => {
    createCompanion();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createCompanion();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
