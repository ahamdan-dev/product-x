/**
 * hover_proof.cjs — capture and MEASURE a :hover-only style.
 *
 * WHY A SECOND HARNESS EXISTS
 * `--x-oxblood` is only ever referenced inside `:hover` rules on the two close buttons
 * (ui/surface.css:149 and views/companionView.css:85). A normal `shot.cjs` capture of
 * those routes is therefore byte-identical before and after the token is defined — it
 * would "prove" the fix by showing a picture that cannot contain it. Worse, the controls
 * are `opacity: 0` until their parent surface is hovered, so the buttons are not even
 * visible at rest.
 *
 * So this drives a REAL pointer with `sendInputEvent` (which makes Chromium apply the
 * genuine `:hover` pseudo-class — not a class-swap imitation), reads the resulting
 * COMPUTED styles back out of the live page, and captures the frame. The computed values
 * are the actual proof: an undefined custom property makes the declaration invalid at
 * computed-value time, so `color` falls back to the inherited ink and `background` to
 * `rgba(0,0,0,0)`. Once the token exists those three properties change to real values.
 *
 *   npx electron tools/hover_proof.cjs <name> <route> [width] [height] [waitMs]
 *
 * Run from app/ with X_PORT set, exactly like shot.cjs.
 */

const fs = require('fs');
const path = require('path');

const NAME = process.argv[2] || 'hover';
const ROUTE = process.argv[3] || 'world';
const WIDTH = parseInt(process.argv[4] || '1900', 10);
const HEIGHT = parseInt(process.argv[5] || '1040', 10);
const WAIT = parseInt(process.argv[6] || '4500', 10);
const PORT = process.env['X_PORT'] || '5301';

const OUT = path.join(__dirname, '..', '_shots');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, `${NAME}.log`);
fs.writeFileSync(LOG, '');
const hb = (m) => fs.appendFileSync(LOG, `${m}\n`);
const say = (m) => { hb(m); console.log(m); };

const { app, BrowserWindow } = require('electron');
process.on('uncaughtException', (e) => { hb(`EXC ${e && e.stack}`); app.exit(9); });
process.on('unhandledRejection', (e) => { hb(`REJ ${e && e.stack}`); app.exit(8); });
app.disableHardwareAcceleration = () => {};

// The two close buttons that reference --x-oxblood, and the ancestor that must be
// hovered first to reveal them.
const TARGETS = [
  { sel: '.x-surface__ctl--close', reveal: '.x-surface', css: 'app/src/ui/surface.css:149' },
  { sel: '.x-cctl--close', reveal: '.x-companion__stage', css: 'app/src/views/companionView.css:85' },
];

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: WIDTH, height: HEIGHT, show: true,
    backgroundColor: '#EFEDEA',
    webPreferences: { offscreen: false, backgroundThrottling: false },
  });
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) hb(`PAGE[${level}] ${message}`);
  });
  win.webContents.on('did-fail-load', (_e, c, d) => hb(`FAIL ${c} ${d}`));

  const url = `http://localhost:${PORT}/?theme=light#/${ROUTE}`;
  say(`loading ${url}`);
  await win.loadURL(url);
  await win.webContents.executeJavaScript(`
    new Promise(res => {
      const go = () => requestAnimationFrame(() => requestAnimationFrame(res));
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(go); else go();
    })
  `);
  await new Promise((r) => setTimeout(r, WAIT));
  say('settled');

  // Is the token defined at all? Read it straight off :root in the live page.
  const tokenValue = await win.webContents.executeJavaScript(
    `getComputedStyle(document.documentElement).getPropertyValue('--x-oxblood').trim() || '(EMPTY - UNDEFINED)'`
  );
  say(`\n--x-oxblood resolved from :root  =>  ${tokenValue}`);

  const results = [];
  for (const t of TARGETS) {
    const box = await win.webContents.executeJavaScript(`
      (() => {
        const el = document.querySelector('${t.sel}');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const rev = document.querySelector('${t.reveal}');
        const rr = rev ? rev.getBoundingClientRect() : null;
        return {
          x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
          w: Math.round(r.width), h: Math.round(r.height),
          revX: rr ? Math.round(rr.left + rr.width / 2) : null,
          revY: rr ? Math.round(rr.top + 8) : null,
        };
      })()
    `);
    if (!box) { say(`\n${t.sel}  NOT PRESENT on route ${ROUTE} — skipped`); continue; }

    const read = () => win.webContents.executeJavaScript(`
      (() => {
        const el = document.querySelector('${t.sel}');
        const s = getComputedStyle(el);
        return { background: s.backgroundColor, borderColor: s.borderTopColor, color: s.color, opacity: getComputedStyle(el.parentElement).opacity };
      })()
    `);

    const rest = await read();

    // Reveal the controls (they are opacity:0 until the surface is hovered), then land
    // the pointer on the button itself. Two moves: Chromium needs a move that is not the
    // first synthetic event before it commits the hover chain.
    if (box.revX !== null) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: box.revX, y: box.revY });
      await new Promise((r) => setTimeout(r, 260));
    }
    win.webContents.sendInputEvent({ type: 'mouseMove', x: box.x - 4, y: box.y - 4 });
    await new Promise((r) => setTimeout(r, 120));
    win.webContents.sendInputEvent({ type: 'mouseMove', x: box.x, y: box.y });
    await new Promise((r) => setTimeout(r, 520));   // let the token transition finish

    const hovered = await read();
    const isHovering = await win.webContents.executeJavaScript(
      `document.querySelector('${t.sel}').matches(':hover')`
    );

    say(`\n${t.sel}   (${t.css})`);
    say(`  hit ${box.w}x${box.h} at ${box.x},${box.y}   :hover applied = ${isHovering}`);
    say(`  rest     bg ${rest.background}   border ${rest.borderColor}   color ${rest.color}`);
    say(`  HOVERED  bg ${hovered.background}   border ${hovered.borderColor}   color ${hovered.color}`);
    const changed = ['background', 'borderColor', 'color'].filter((k) => rest[k] !== hovered[k]);
    say(`  changed on hover: ${changed.length ? changed.join(', ') : 'NOTHING — the hover rule is dead'}`);

    // Sample the real pixels under the cursor too, so this does not rely on computed
    // style alone. A crop around the button is what a human can actually check.
    const img = await win.webContents.capturePage({
      x: Math.max(0, box.x - 90), y: Math.max(0, box.y - 40), width: 130, height: 80,
    });
    const cropName = `${NAME}.${t.sel.replace(/[^a-z]/gi, '')}.png`;
    fs.writeFileSync(path.join(OUT, cropName), img.toPNG());
    say(`  crop -> _shots/${cropName}`);

    results.push({ sel: t.sel, isHovering, rest, hovered, changed });

    // Full frame while still hovering — the whole surface in its hover state.
    const full = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, `${NAME}.${t.sel.replace(/[^a-z]/gi, '')}.full.png`), full.toPNG());
  }

  fs.writeFileSync(
    path.join(OUT, `${NAME}.hover.json`),
    JSON.stringify({ route: ROUTE, oxblood: tokenValue, results }, null, 2)
  );
  say(`\ndone -> _shots/${NAME}.hover.json`);
  app.exit(0);
}).catch((e) => { hb(`REJ-MAIN ${e && e.stack}`); app.exit(6); });
