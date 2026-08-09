#!/usr/bin/env node
/* ============================================================================
   token_audit.cjs — design-token integrity check for the `--x-*` layer.

   WHY THIS EXISTS
   An undefined CSS custom property does not throw, does not warn, and does not
   show up in a build. `color: var(--x-typo)` makes the declaration invalid at
   computed-value time, so the property silently falls back to its inherited or
   initial value and the UI just looks subtly wrong forever. That is how
   `--x-oxblood` shipped with 6 use sites and 0 definitions.

   This script is the repeatable version of finding that by hand.

     node tools/token_audit.cjs                # human report
     node tools/token_audit.cjs --json         # machine output
     node tools/token_audit.cjs --strict       # exit 1 if any token is undefined

   SCOPE NOTES (deliberate, do not "fix" these)
   - Definitions are legitimately spread across more than tokens.css. Panel-local
     tokens live in app/src/panels/panels.css on purpose (Team E scoping), so this
     script collects definitions from EVERY css file and only reports a usage as
     undefined when it is defined nowhere at all.
   - Tokens are also consumed from .tsx inline styles, so those are scanned too.
   - A token defined inside a non-:root selector or an @media/@supports block is
     still recorded as "defined", but its scope is reported, because a usage
     outside that scope is a real (and invisible) bug.
   ========================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'app', 'src');

const SCAN_EXT = new Set(['.css', '.tsx', '.ts', '.jsx', '.js', '.html']);
const SKIP_DIR = new Set(['node_modules', 'dist', '.git', '_vendor', '_build']);

const args = process.argv.slice(2);
const AS_JSON = args.includes('--json');
const STRICT = args.includes('--strict');

/* ── file walk ──────────────────────────────────────────────────────────── */
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIR.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (SCAN_EXT.has(path.extname(entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/* ── comment stripping ──────────────────────────────────────────────────────
   The token layer is heavily commented and several comments quote token names
   in prose ("this rule used to end in `var(--x-veil)`"). Counting those as real
   usages would make the audit lie, so block comments are blanked out while
   preserving byte offsets, which keeps line numbers exact. */
function blankComments(text, isCss) {
  let out = text.split('');
  const blank = (from, to) => {
    for (let i = from; i < to && i < out.length; i++) {
      if (out[i] !== '\n') out[i] = ' ';
    }
  };
  // /* ... */ in both CSS and JS/TSX
  const block = /\/\*[\s\S]*?\*\//g;
  let m;
  while ((m = block.exec(text)) !== null) blank(m.index, m.index + m[0].length);
  if (!isCss) {
    // // ... to end of line (JS/TSX only; in CSS `//` is not a comment)
    const line = /(^|[^:"'`\\])\/\/[^\n]*/g;
    while ((m = line.exec(text)) !== null) {
      const start = m.index + (m[1] ? m[1].length : 0);
      blank(start, m.index + m[0].length);
    }
  }
  return out.join('');
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/* ── selector / at-rule context for a definition ─────────────────────────────
   Walks backwards counting braces to recover the selector the declaration sits
   in, so ":root" vs ".x-panel" vs "@supports not (...)" is visible in the report. */
function contextOf(text, index) {
  let depth = 0;
  let i = index;
  const stack = [];
  while (i >= 0) {
    const ch = text[i];
    if (ch === '}') depth++;
    else if (ch === '{') {
      if (depth === 0) {
        const head = text.slice(0, i).split(/[};]/).pop().replace(/\s+/g, ' ').trim();
        if (head) stack.unshift(head);
      } else depth--;
    }
    i--;
  }
  return stack.length ? stack.join(' > ') : '(top level)';
}

/* ── collect ────────────────────────────────────────────────────────────── */
const defs = new Map();  // name -> [{file, line, value, context}]
const uses = new Map();  // name -> [{file, line, snippet, hasFallback}]

// A definition: `--x-foo: value;` at the start of a declaration.
// A usage: `var(--x-foo` — optionally with a comma fallback.
const DEF_RE = /(^|[;{]|\*\/)\s*(--x-[A-Za-z0-9_-]+)\s*:\s*([^;}]*)/g;
const USE_RE = /var\(\s*(--x-[A-Za-z0-9_-]+)\s*(,)?/g;

const files = fs.existsSync(SRC) ? walk(SRC) : [];
if (!files.length) {
  console.error(`token_audit: nothing to scan under ${SRC}`);
  process.exit(2);
}

for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const isCss = path.extname(file) === '.css';
  const raw = fs.readFileSync(file, 'utf8');
  const text = blankComments(raw, isCss);

  let m;
  DEF_RE.lastIndex = 0;
  while ((m = DEF_RE.exec(text)) !== null) {
    // Skip a `--x-foo:` that is actually inside a var() fallback, e.g.
    // var(--a, var(--x-b)) — those are usages, already caught by USE_RE.
    const name = m[2];
    const value = raw.slice(m.index + m[0].indexOf(m[3]), m.index + m[0].length).trim();
    if (!defs.has(name)) defs.set(name, []);
    defs.get(name).push({
      file: rel,
      line: lineOf(text, m.index + m[0].indexOf(name)),
      value: value.replace(/\s+/g, ' ').slice(0, 96),
      context: isCss ? contextOf(text, m.index) : '(js/tsx)',
    });
  }

  USE_RE.lastIndex = 0;
  while ((m = USE_RE.exec(text)) !== null) {
    const name = m[1];
    const line = lineOf(text, m.index);
    if (!uses.has(name)) uses.set(name, []);
    uses.get(name).push({
      file: rel,
      line,
      snippet: raw.split('\n')[line - 1].trim().slice(0, 110),
      hasFallback: Boolean(m[2]),
    });
  }
}

/* ── analyse ────────────────────────────────────────────────────────────── */
const defNames = [...defs.keys()].sort();
const useNames = [...uses.keys()].sort();

const undefinedTokens = useNames.filter((n) => !defs.has(n));
const unusedTokens = defNames.filter((n) => !uses.has(n));
const duplicated = defNames
  .filter((n) => defs.get(n).length > 1)
  .map((n) => ({ name: n, sites: defs.get(n) }));

const totalUses = useNames.reduce((a, n) => a + uses.get(n).length, 0);
const totalDefs = defNames.reduce((a, n) => a + defs.get(n).length, 0);

const summary = {
  filesScanned: files.length,
  cssFiles: files.filter((f) => f.endsWith('.css')).length,
  uniqueDefinitions: defNames.length,
  definitionSites: totalDefs,
  uniqueUsages: useNames.length,
  usageSites: totalUses,
  undefined: undefinedTokens.length,
  unused: unusedTokens.length,
  duplicatedDefinitions: duplicated.length,
};

if (AS_JSON) {
  console.log(JSON.stringify({
    summary,
    undefined: undefinedTokens.map((n) => ({ name: n, uses: uses.get(n) })),
    unused: unusedTokens.map((n) => ({ name: n, defs: defs.get(n) })),
    duplicated,
  }, null, 2));
  process.exit(STRICT && undefinedTokens.length ? 1 : 0);
}

/* ── report ─────────────────────────────────────────────────────────────── */
const H = (s) => `\n${'='.repeat(78)}\n${s}\n${'='.repeat(78)}`;
const pad = (s, n) => String(s).padEnd(n);

console.log(H('TOKEN AUDIT — --x-* custom properties'));
console.log(`  scanned            ${summary.filesScanned} files (${summary.cssFiles} css) under app/src`);
console.log(`  definitions        ${summary.uniqueDefinitions} unique / ${summary.definitionSites} sites`);
console.log(`  usages             ${summary.uniqueUsages} unique / ${summary.usageSites} sites`);
console.log(`  UNDEFINED          ${summary.undefined}  <- used but never defined (silent breakage)`);
console.log(`  unused             ${summary.unused}  <- defined but never referenced`);
console.log(`  multi-defined      ${summary.duplicatedDefinitions}`);

console.log(H(`1. UNDEFINED TOKENS  (${undefinedTokens.length}) — every one of these is a dead declaration`));
if (!undefinedTokens.length) {
  console.log('  none. Every var(--x-*) resolves to a real definition.');
} else {
  for (const name of undefinedTokens) {
    const sites = uses.get(name);
    const fb = sites.filter((s) => s.hasFallback).length;
    console.log(`\n  ${name}   ${sites.length} use site(s)${fb ? `, ${fb} with a var() fallback (those still render)` : ', NO fallbacks — all dead'}`);
    for (const s of sites) console.log(`      ${s.file}:${s.line}\n          ${s.snippet}`);
  }
}

console.log(H(`2. UNUSED DEFINITIONS  (${unusedTokens.length}) — review, do not bulk-delete`));
if (!unusedTokens.length) {
  console.log('  none.');
} else {
  for (const name of unusedTokens) {
    for (const d of defs.get(name)) {
      console.log(`  ${pad(name, 26)} ${pad(`${d.file}:${d.line}`, 34)} ${d.value}`);
    }
  }
  console.log('\n  Some of these are a deliberate public API for surfaces not built yet.');
  console.log('  Judge each one; an unused token is not automatically dead code.');
}

console.log(H(`3. TOKENS DEFINED IN MORE THAN ONE PLACE  (${duplicated.length})`));
if (!duplicated.length) {
  console.log('  none.');
} else {
  for (const d of duplicated) {
    console.log(`\n  ${d.name}`);
    for (const s of d.sites) console.log(`      ${s.file}:${s.line}   in ${s.context}\n          = ${s.value}`);
  }
}

console.log(H('4. DEFINITIONS BY FILE — where the token layer actually lives'));
const byFile = new Map();
for (const [name, sites] of defs) {
  for (const s of sites) {
    if (!byFile.has(s.file)) byFile.set(s.file, []);
    byFile.get(s.file).push(name);
  }
}
for (const [file, names] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${pad(file, 40)} ${String(names.length).padStart(3)} definition(s)`);
  if (names.length <= 12) console.log(`      ${names.sort().join(', ')}`);
}

console.log(H('5. SCOPED DEFINITIONS — defined outside :root'));
let scopedCount = 0;
for (const [name, sites] of [...defs.entries()].sort()) {
  for (const s of sites) {
    if (s.context === '(js/tsx)' || /:root/.test(s.context)) continue;
    scopedCount++;
    const outside = (uses.get(name) || []).filter((u) => u.file !== s.file);
    console.log(`  ${name}\n      defined ${s.file}:${s.line}  in  ${s.context}`);
    if (outside.length) {
      console.log(`      NOTE used from ${outside.length} site(s) in other files — verify they are inside this scope:`);
      for (const u of outside) console.log(`        ${u.file}:${u.line}`);
    }
  }
}
if (!scopedCount) console.log('  none — every definition is at :root.');

console.log(`\n${'='.repeat(78)}`);
console.log(undefinedTokens.length
  ? `RESULT: ${undefinedTokens.length} undefined token(s). These render as invalid and must be fixed.`
  : 'RESULT: clean — no undefined tokens.');
console.log(`${'='.repeat(78)}\n`);

process.exit(STRICT && undefinedTokens.length ? 1 : 0);
