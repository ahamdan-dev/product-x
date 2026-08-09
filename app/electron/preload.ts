/**
 * Preload — the only bridge between the renderer and the OS.
 *
 * Every exposed function is a specific verb. No generic `invoke(channel, ...args)` escape hatch:
 * that would hand the renderer the whole IPC surface and make the contextIsolation boundary
 * decorative.
 */

import { contextBridge, ipcRenderer } from 'electron';

export interface ShellInfo {
  platform: string;
  version: string;
  scaleFactor: number;
}

const api = {
  /**
   * Toggle click-through on the companion window. The renderer calls this as the pointer crosses
   * into and out of real content, so transparent pixels never intercept a click on whatever the
   * student is actually studying.
   */
  setInteractive: (interactive: boolean): Promise<void> =>
    ipcRenderer.invoke('companion:setInteractive', interactive),

  /**
   * The same click-through contract for the main window.
   *
   * Making that window transparent was only half the requirement. A transparent window still
   * intercepts every click that lands on it, so an overlay that *looks* see-through while swallowing
   * clicks on its own empty pixels obscures the user's function even though it no longer obscures
   * their view — and "CAND OBSCURE THE USERS SCREEN OR FUNCTION" names both.
   */
  setWorldInteractive: (interactive: boolean): Promise<void> =>
    ipcRenderer.invoke('world:setInteractive', interactive),

  /** Resize the companion window itself — a frameless window has no OS grip to drag. */
  resizeCompanion: (width: number, height: number): Promise<void> =>
    ipcRenderer.invoke('companion:resize', width, height),

  /** Move the companion by a delta, for our own drag handle. */
  moveCompanionBy: (dx: number, dy: number): Promise<void> =>
    ipcRenderer.invoke('companion:moveBy', dx, dy),

  minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  close: (): Promise<void> => ipcRenderer.invoke('window:close'),

  openWorld: (): Promise<void> => ipcRenderer.invoke('world:open'),
  closeWorld: (): Promise<void> => ipcRenderer.invoke('world:close'),

  info: (): Promise<ShellInfo> => ipcRenderer.invoke('shell:info'),
} as const;

contextBridge.exposeInMainWorld('px', api);

export type PxApi = typeof api;
