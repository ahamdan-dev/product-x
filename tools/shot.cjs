/**
 * Screenshot harness. The shared eye for every agent on this project.
 *
 * Visual work without pixels is how the last round shipped grey CAD nubs and a dead font: the code
 * read correctly and rendered wrong, and nobody looked. So this exists to make looking cheap.
 *
 *   node tools/shot.cjs <name> [route] [theme] [width] [height] [waitMs]
 *
 * Design notes that matter:
 *   - Theme is pinned via `?theme=` (see useTheme.ts), NOT localStorage + reload. The reload race is
 *     what made the old dark capture die with ERR_FAILED (-2).
 *   - Heartbeats land on disk at every stage. When Electron dies under a shell wrapper it exits 127
 *     with no stderr, and the heartbeat file is the only way to know how far it got.
 *   - We wait for a real GPU frame, not a fixed timer: `requestAnimationFrame` twice inside the page
 *     plus a settle delay for the camera dolly and font load.
 */

const fs = require('fs');
const path = require('path');

const NAME   = process.argv[2] || 'shot';
const ROUTE  = process.argv[3] || 'world';
const THEME  = process.argv[4] || 'light';
const WIDTH  = parseInt(process.argv[5] || '1600', 10);
const HEIGHT = parseInt(process.argv[6] || '1000', 10);
const WAIT   = parseInt(process.argv[7] || '3500', 10);
const PORT   = process.env['X_PORT'] || '5274';

/**
 * `X_BEHIND=desktop` proves transparency instead of assuming it.
 *
 * This app is an always-on-top overlay: the window is transparent so it cannot obscure the student's
 * real screen. But a screenshot taken against an opaque window background looks *identical* whether
 * transparency works or not — which is exactly how a broken overlay ships. So this mode paints a
 * synthetic "desktop" behind the page: if any surface is wrongly opaque, it hides the pattern and the
 * defect is visible in one glance. Off by default, because for layout work the pattern is just noise.
 */
const BEHIND = process.env['X_BEHIND'] || '';

/**
 * `X_PROBE=passthrough` measures click-through instead of assuming it.
 *
 * Transparency has a visible failure mode, so `X_BEHIND` catches it. Click-through does not: a window
 * that wrongly claims every pixel looks *exactly* like one that passes clicks through correctly, and the
 * only symptom is that the user's clicks stop reaching their own work. Screenshots cannot see it.
 *
 * So this samples a grid over the window, asks the real rule who owns each point, and prints the totals
 * plus an ASCII map. The rule is imported from `/src/shell/passthrough.ts` through the dev server, so
 * this exercises the shipped module rather than a reimplementation of it that could agree with itself
 * while both are wrong.
 *
 * What the numbers mean: 0% owned means passthrough is broken open (nothing is clickable); 100% means it
 * is broken shut (the overlay eats the desktop). A real three-surface overlay lands well inside both.
 */
const PROBE = process.env['X_PROBE'] || '';

const OUT = path.join(__dirname, '..', '_shots');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, `${NAME}.log`);
fs.writeFileSync(LOG, '');
const hb = (m) => fs.appendFileSync(LOG, `${m}\n`);

hb('01 start');
const { app, BrowserWindow } = require('electron');
hb('02 electron required');

process.on('uncaughtException', (e) => { hb(`EXC ${e && e.stack}`); app.exit(9); });
process.on('unhandledRejection', (e) => { hb(`REJ ${e && e.stack}`); app.exit(8); });

// Software fallback would produce a frame that is not the frame a user sees. Better to fail loudly.
app.disableHardwareAcceleration = () => {};

app.whenReady().then(async () => {
  hb('03 app ready');

  const win = new BrowserWindow({
    width: WIDTH, height: HEIGHT, show: false,
    // Matching the app background prevents a white flash from being captured as the first frame.
    backgroundColor: THEME === 'dark' ? '#141519' : '#EFEDEA',
    webPreferences: { offscreen: false, backgroundThrottling: false },
  });

  win.webContents.on('console-message', (_e, level, message) => {
    // Page-side errors are the single most useful signal when a render comes back blank.
    if (level >= 2) hb(`PAGE[${level}] ${message}`);
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => hb(`FAIL ${code} ${desc}`));

  const url = `http://localhost:${PORT}/?theme=${THEME}#/${ROUTE}`;
  hb(`04 loading ${url}`);
  await win.loadURL(url);
  hb('05 loaded');

  // Two real frames, then settle. `document.fonts.ready` matters here: a capture taken before the
  // variable fonts resolve is exactly the "wrong typography" screenshot that started this.
  await win.webContents.executeJavaScript(`
    new Promise(res => {
      const go = () => requestAnimationFrame(() => requestAnimationFrame(res));
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(go); else go();
    })
  `);
  hb('06 first frames + fonts');

  if (BEHIND === 'desktop') {
    /**
     * Injected behind everything at z-index -1 on <html>, not on <body>: the app's own root sits on
     * body, so anything attached there would be painted over. Two layers — a coarse magenta/teal grid
     * plus text — because a plain flat color can be mistaken for a design choice, whereas losing
     * readable words is unambiguous evidence that a surface is opaque.
     */
    await win.webContents.executeJavaScript(`
      (() => {
        const d = document.createElement('div');
        d.id = 'x-fake-desktop';
        d.style.cssText = [
          'position:fixed', 'inset:0', 'z-index:-1', 'pointer-events:none',
          'background-color:#0E7C86',
          'background-image:repeating-linear-gradient(45deg,#B5179E 0 28px,transparent 28px 56px)',
          'font:700 34px/1.4 monospace', 'color:#FFFFFF', 'letter-spacing:.08em',
          'display:flex', 'align-items:center', 'justify-content:center', 'text-align:center',
        ].join(';');
        d.textContent = 'DESKTOP BEHIND — if you cannot read this, the overlay is opaque';
        document.documentElement.appendChild(d);
        document.documentElement.style.background = 'transparent';
        document.body.style.background = 'transparent';
      })()
    `);
    hb('06b fake desktop injected');
  }

  await new Promise(r => setTimeout(r, WAIT));
  hb('07 settled');

  if (PROBE === 'passthrough') {
    /**
     * Sample a grid and ask the real rule who owns each point.
     *
     * The module is pulled in with a dynamic `import()` of the dev-server URL so this measures the
     * shipped `ownsPoint`. A local copy of the logic here would be free to agree with itself while both
     * copies were wrong, which is the failure this whole mode exists to rule out.
     */
    const probe = await win.webContents.executeJavaScript(`
      (async () => {
        const m = await import('/src/shell/passthrough.ts');
        const COLS = 48, ROWS = 24;
        const w = window.innerWidth, h = window.innerHeight;
        let owned = 0;
        const rows = [];
        for (let r = 0; r < ROWS; r++) {
          let line = '';
          for (let c = 0; c < COLS; c++) {
            // Sample cell centres: a point on a boundary is ambiguous and tells us nothing.
            const x = Math.round((c + 0.5) * w / COLS);
            const y = Math.round((r + 0.5) * h / ROWS);
            const hit = m.ownsPoint(document, x, y);
            if (hit) owned++;
            line += hit ? '#' : '.';
          }
          rows.push(line);
        }
        return { owned, total: COLS * ROWS, map: rows.join('\\n'), w, h };
      })()
    `);
    const pct = (probe.owned / probe.total * 100).toFixed(1);
    const report =
      `PROBE passthrough ${NAME} (${probe.w}x${probe.h})\n` +
      `owned ${probe.owned}/${probe.total} = ${pct}%   ('#' = app claims the click, '.' = desktop gets it)\n` +
      `${probe.map}\n`;
    fs.writeFileSync(path.join(OUT, `${NAME}.passthrough.txt`), report);
    hb(`07b probe owned ${probe.owned}/${probe.total} = ${pct}%`);
  }

  const img = await win.webContents.capturePage();
  const size = img.getSize();
  if (size.width === 0 || size.height === 0) { hb('ERR empty capture'); app.exit(7); return; }

  const file = path.join(OUT, `${NAME}.png`);
  fs.writeFileSync(file, img.toPNG());
  hb(`08 wrote ${file} ${size.width}x${size.height} ${fs.statSync(file).size}B`);
  app.exit(0);
}).catch(e => { hb(`REJ-MAIN ${e && e.stack}`); app.exit(6); });
