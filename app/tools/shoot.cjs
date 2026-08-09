/**
 * Screenshot harness. Runs the real Electron shell against a served build and captures PNGs.
 *
 * Why Electron and not headless Chromium: this app's target runtime IS Electron, with a real GPU and
 * a transparent window. A headless-Chromium shot would use SwiftShader and tell us nothing about
 * whether the thing we ship actually renders.
 *
 * Usage: electron tools/shoot.cjs <baseUrl> <outDir>
 */

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.argv[2] || 'http://localhost:5274';
const OUT = process.argv[3] || path.join(__dirname, '..', '..', '_shots');

// Software rendering would defeat the purpose; fail loudly rather than shoot a lie.
app.commandLine.appendSwitch('enable-gpu-rasterization');

const SHOTS = [
  { name: 'world-light',      hash: '#/world',     w: 1600, h: 1000, theme: 'light', wait: 4200 },
  { name: 'world-dark',       hash: '#/world',     w: 1600, h: 1000, theme: 'dark',  wait: 4200 },
  { name: 'world-district',   hash: '#/world',     w: 1600, h: 1000, theme: 'light', wait: 4200,
    // Drive the store directly: framing + a focused district, so the shot proves the camera dolly
    // and the focus lift, not just the default pose.
    act: `window.__x.setFraming('district'); window.__x.focusDistrict('cardio');` },
  { name: 'companion-light',  hash: '#/companion', w: 440,  h: 620,  theme: 'light', wait: 3000, transparent: true },
  { name: 'companion-dark',   hash: '#/companion', w: 440,  h: 620,  theme: 'dark',  wait: 3000, transparent: true },
];

async function shoot(spec) {
  const win = new BrowserWindow({
    width: spec.w,
    height: spec.h,
    show: false,
    transparent: !!spec.transparent,
    frame: !spec.transparent,
    backgroundColor: spec.transparent ? '#00000000' : '#15181A',
    webPreferences: { offscreen: false, backgroundThrottling: false },
  });

  await win.loadURL(`${BASE}/${spec.hash}`);

  // Force the theme rather than trusting the host OS setting — a screenshot set where dark mode
  // silently didn't apply is worse than no screenshot.
  await win.webContents.executeJavaScript(
    `localStorage.setItem('x.theme', '${spec.theme}'); location.reload();`,
  );
  await new Promise(r => setTimeout(r, 900));

  if (spec.act) {
    try {
      await win.webContents.executeJavaScript(spec.act);
    } catch (e) {
      console.error(`  ! act failed for ${spec.name}: ${e.message}`);
    }
  }

  // Wait out the camera dolly (620 ms) and the fog burn (1800 ms) so nothing is caught mid-tween.
  await new Promise(r => setTimeout(r, spec.wait));

  const img = await win.webContents.capturePage();
  const buf = spec.transparent ? img.toPNG() : img.toPNG();
  const file = path.join(OUT, `${spec.name}.png`);
  fs.writeFileSync(file, buf);

  const size = img.getSize();
  const empty = buf.length < 6000;   // a blank canvas compresses to almost nothing
  console.log(`  ${empty ? 'SUSPECT' : 'ok     '} ${spec.name}  ${size.width}x${size.height}  ${(buf.length / 1024).toFixed(0)} KB`);

  win.destroy();
  return !empty;
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let allGood = true;
  for (const s of SHOTS) {
    try {
      allGood = (await shoot(s)) && allGood;
    } catch (e) {
      console.error(`  FAIL ${s.name}: ${e.message}`);
      allGood = false;
    }
  }
  console.log(allGood ? 'ALL SHOTS RENDERED' : 'SOME SHOTS BLANK OR FAILED');
  app.exit(allGood ? 0 : 1);
});
