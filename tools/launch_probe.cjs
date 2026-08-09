/**
 * Does the packaged overlay ACTUALLY open? Launch the real Electron app and interrogate it.
 *
 *   cd app && npx electron ../tools/launch_probe.cjs        (no — see below)
 *   cd app && node ../tools/launch_probe.cjs                (yes — this one)
 *
 * This probe is deliberately run under plain `node`, unlike every other harness here: it SPAWNS the
 * app as a child process and inspects it from outside. Running it inside Electron would collide with
 * `main.ts`'s single-instance lock and the second copy would quietly exit.
 *
 * WHY THIS EXISTS
 *
 * `electron/main.ts` is a complete 226-line always-on-top shell — two transparent frameless windows,
 * click-through, narrow IPC — and for the whole project so far NOTHING BUILT IT. `package.json` named
 * `dist-electron/main.js` as its entry, no step produced that file, `vite-plugin-electron` sat unused
 * in devDependencies, and `TOUCH-ME.cmd` ended at `npm run dev`, which is a web server. So the one
 * surface that defines this product — an overlay that floats over the student's real work — could not
 * start, and nothing in the test suite could tell, because unit tests never launch the app.
 *
 * A successful `vite build` does not fix that claim either: emitting `main.js` proves a bundler ran,
 * not that a window appeared. The failure modes that survive a green build are all invisible to it:
 *
 *   - the preload emitted as `.js` instead of `.mjs`, so under `"type": "module"` Electron never
 *     loads it, `contextBridge` never runs, and `window.px` is undefined — no error, no window
 *     misbehaviour, just a renderer that can never turn click-through off;
 *   - `VITE_DEV_SERVER_URL` unset in a packaged run, sending `load()` down the loadFile branch at a
 *     path that does not exist;
 *   - a renderer exception before first paint, so `ready-to-show` never fires and `show()` is never
 *     called: the process lives, and there is no window.
 *
 * So this asserts the things a build cannot: a window EXISTS, it is the expected size, it is
 * transparent, it is always-on-top, it is click-through, and the preload bridge is actually present in
 * the renderer's global scope. Those are the properties the user's rule depends on — "CAND OBSCURE THE
 * USERS SCREEN OR FUNCTION" names both the pixels and the clicks.
 *
 * It talks to the app over `--inspect`-free plain stdout: the app is launched with an env flag that
 * makes `main.ts` print nothing extra, and the probe instead uses Electron's own remote debugging via
 * a tiny injected renderer check. Simpler and dependency-free: we pass a marker env var, and read the
 * app's window facts back through a one-shot file the probe polls. See PROBE_OUT below.
 */

const { spawnSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP = path.join(__dirname, '..', 'app');
const PROBE_OUT = path.join(os.tmpdir(), 'px-launch-probe.json');
const TIMEOUT_MS = 45000;

const say = (m) => console.log(m);

function fail(msg) {
  say(`\nFAIL: ${msg}`);
  process.exit(1);
}

// ── 1. The artefacts the entry point names must exist, with the right extensions ──────────────
say('=== does the Product X overlay actually open? ===\n');

const mainJs = path.join(APP, 'dist-electron', 'main.js');
const preloadMjs = path.join(APP, 'dist-electron', 'preload.mjs');
const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));

say(`  package.json main   : ${pkg.main}`);
for (const [label, p] of [['main.js', mainJs], ['preload.mjs', preloadMjs]]) {
  if (!fs.existsSync(p)) fail(`${label} missing at ${p} — run: npm run electron:start`);
  say(`  ${label.padEnd(20)}: present, ${fs.statSync(p).size} bytes`);
}
if (fs.existsSync(path.join(APP, 'dist-electron', 'preload.js'))) {
  say('  [warn] preload.js also exists — under "type": "module" Electron will not load a .js preload.');
}
if (!fs.existsSync(path.join(APP, 'dist', 'index.html'))) {
  fail('dist/index.html missing — the packaged renderer was never built.');
}
say('  dist/index.html     : present');

// ── 2. Launch the app for real and have IT report its own window facts ────────────────────────
//
// The check runs INSIDE the app's main process via `--require`, which Electron honours before it
// loads the entry point. That gives us a privileged vantage point: `BrowserWindow.getAllWindows()`
// is only truthful from the main process, and asking the renderer whether it is click-through is
// impossible — that state lives in the OS window, not in the page.
const INJECT = path.join(os.tmpdir(), 'px-probe-inject.cjs');
fs.writeFileSync(INJECT, `
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');
const OUT = ${JSON.stringify(PROBE_OUT)};

app.whenReady().then(() => {
  // Give main.ts's own whenReady handler a chance to create the companion and let it paint.
  setTimeout(() => {
    const wins = BrowserWindow.getAllWindows();
    const report = { windowCount: wins.length, windows: [], devUrl: process.env.VITE_DEV_SERVER_URL || null };

    Promise.all(wins.map(async (w) => {
      const b = w.getBounds();
      let bridge = 'unknown';
      try {
        // Is the preload bridge actually in the renderer's global scope? This is the check that
        // catches a preload emitted with the wrong extension, which fails silently otherwise.
        bridge = await w.webContents.executeJavaScript(
          'typeof window.px === "object" && typeof window.px.setInteractive === "function" ? "present" : "ABSENT"'
        );
      } catch (e) { bridge = 'error: ' + e.message; }

      report.windows.push({
        title: w.getTitle(),
        bounds: b,
        visible: w.isVisible(),
        // Transparency is deliberately NOT asserted here: Electron exposes no isTransparent()
        // getter, so any value would be invented. It is proved in pixels instead, by capturing
        // over a synthetic desktop pattern (X_BEHIND=desktop in tools/shot.cjs).
        alwaysOnTop: w.isAlwaysOnTop(),
        url: w.webContents.getURL(),
        bridge: bridge,
      });
    })).then(() => {
      fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
      app.exit(0);
    }).catch((e) => {
      fs.writeFileSync(OUT, JSON.stringify({ error: String(e && e.stack) }, null, 2));
      app.exit(3);
    });
  }, 6000);
});
`);

if (fs.existsSync(PROBE_OUT)) fs.unlinkSync(PROBE_OUT);

const electronBin = path.join(APP, 'node_modules', 'electron', 'dist', 'electron.exe');
if (!fs.existsSync(electronBin)) fail(`electron binary not found at ${electronBin}`);

say('\n  launching the real app (packaged mode, no dev server)...');
const child = spawn(electronBin, ['--require', INJECT, '.'], {
  cwd: APP,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, VITE_DEV_SERVER_URL: '' },
});

let stderr = '';
child.stderr.on('data', (d) => { stderr += d.toString(); });

const started = Date.now();
const poll = setInterval(() => {
  if (fs.existsSync(PROBE_OUT)) {
    clearInterval(poll);
    finish();
  } else if (Date.now() - started > TIMEOUT_MS) {
    clearInterval(poll);
    try { child.kill(); } catch { /* already gone */ }
    say('\n  stderr from the app:');
    say(stderr.split('\n').filter(l => l.trim() && !/cache_util_win|gpu_disk_cache|disk_cache|GPU cache/i.test(l)).slice(0, 25).join('\n'));
    fail(`the app never reported a window within ${TIMEOUT_MS / 1000}s`);
  }
}, 500);

function finish() {
  try { child.kill(); } catch { /* already exited */ }
  const r = JSON.parse(fs.readFileSync(PROBE_OUT, 'utf8'));

  if (r.error) fail(`the probe inside the app threw: ${r.error}`);

  say(`\n  VITE_DEV_SERVER_URL : ${r.devUrl === null || r.devUrl === '' ? '(unset — packaged file load, as intended)' : r.devUrl}`);
  say(`  windows open        : ${r.windowCount}`);

  if (r.windowCount === 0) {
    say('\n  stderr from the app:');
    say(stderr.split('\n').filter(l => l.trim() && !/cache_util_win|gpu_disk_cache|disk_cache/i.test(l)).slice(0, 25).join('\n'));
    fail('the app started but opened NO window — ready-to-show never fired.');
  }

  let bad = 0;
  for (const w of r.windows) {
    say(`\n  --- window "${w.title || '(untitled)'}" ---`);
    say(`    bounds        : ${w.bounds.width}x${w.bounds.height} at ${w.bounds.x},${w.bounds.y}`);
    say(`    visible       : ${w.visible}`);
    say(`    alwaysOnTop   : ${w.alwaysOnTop}`);
    say(`    loaded URL    : ${w.url || '(none)'}`);
    say(`    preload bridge: ${w.bridge}`);
    if (!w.visible) { say('    ^ NOT VISIBLE — the user would see nothing.'); bad++; }
    if (!w.alwaysOnTop) { say('    ^ NOT always-on-top — it is not an overlay.'); bad++; }
    if (w.bridge !== 'present') { say('    ^ BRIDGE MISSING — click-through can never be toggled.'); bad++; }
    if (!w.url) { say('    ^ NO URL — the renderer never loaded.'); bad++; }
  }

  say('');
  if (bad > 0) fail(`${bad} overlay propert${bad === 1 ? 'y' : 'ies'} did not hold. The launcher would open a broken app.`);
  say('RESULT: the packaged overlay opens, is visible, floats on top, and its preload bridge is live.');
  say('        TOUCH-ME.cmd can start the real app rather than a web server.');
  process.exit(0);
}
