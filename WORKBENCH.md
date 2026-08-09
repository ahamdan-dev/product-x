# WORKBENCH — Project X

## Purpose

Project progress, coordination, evidence, and human-observation layer.

Build rules live in `START-HERE-FABLE-BUILD-ME-THIS-CONTRACT.md`. This file is the local
source-of-truth ledger and mirrors the live Workbench web document.

---

# LIVE WORKBENCH

**Live URL:** removed from source control; use local Workbench configuration.
**Access mode:** edit (anonymous doc — this key is the full capability)
**Last synced:** 2026-08-09
**Director:** Claude Code (Opus 5)
**State:** building

---

# ⚠️ YOUR DESK — things only you can decide

Everything here is a real fork in the road. Nothing else is blocked on you; I keep building past all
of these using the **DEFAULT** marked, and I will change course whenever you answer. Reply in the
Team Chat section at the bottom, or just tell me directly.

### D-1 · Anatomy mesh source — **ANSWERED, PROCEEDING**
You confirmed you know the owners of Humanome and Clinical Commander and they said good to go, and
that the assets are open-source regardless of not being hosted on GitHub. Logged as your explicit
authorization. **No action needed from you.** Pulling directly.

### D-2 · How far does share-alike reach? — **NEEDS YOU EVENTUALLY, NOT NOW**
Z-Anatomy's mesh data is CC BY-SA. Share-alike travels with *the asset*, not with our source code —
so shipping it means we must credit the source and let others reuse **the mesh**, but our app code,
UI, and engines stay ours. That is almost certainly fine, and it is the industry-normal arrangement.

- **DEFAULT (in progress):** ship the meshes with a quiet in-app attribution line in Settings → About.
- **Alternative:** if you want zero share-alike anywhere, say so and I will retopologize our own
  anatomy from scratch — costs roughly a day of build time and the anatomy will be less precise.

**Press:** nothing yet. Flag it if you want the alternative.

### D-3 · Repo replication scope — **DEFAULT CHOSEN, OVERRIDE ANY TIME**
Your original list said "(VISUALLY, FUNCTIONALLY, OR BOTH — ASK USER)". Your later messages answered
this in practice, so I stopped waiting:

| Source | What I take | What I throw away |
|---|---|---|
| Clinical Commander | station mechanics, scoring model, case shape | 100% of the UI (text-heavy) |
| Humanome | 3D body + system-toggle interaction model | 100% of the UI (command-center) |
| Z-Anatomy | the meshes only | the entire interface — logos, Latin labels, button walls |
| ecgxai | the model + signal processing, directly | its notebooks/CLI |
| OATutor | problem/hint data model + mastery logic, reimplemented in TS | its React UI entirely |
| pyBKT | the BKT math, reimplemented in TS | the Python runtime |
| Theatre.js | the animation engine, used directly | its studio UI |
| HeroUI | patterns and interaction detail as reference | its components (we have our own tokens) |

**Press:** nothing. Tell me if any row is wrong.

### D-4 · Which sim ships first — **DEFAULT: all three, anatomy first**
Anatomy first, because the renal sim renders *on top of* the anatomy pipeline, and the clinical
station reuses the anatomy viewport for its imaging/exam steps. Building one buys the other two.

**Press:** nothing. Say a word if you want the clinical station first instead.

---

# MISSION

**Primary outcome:**
An always-on-top, ambient, lifelike AI learning companion for medical students, inhabiting a
controlled-camera 3D world that renders the student's actual competency — with three real, working
medical simulations embedded directly in the product.

**Deliverable:**
A running Windows desktop application. Not a prototype, not a wireframe, not a deck.

**Quality bar:**
- Zero detectable AI-generated design artifacts (contract §7 + the 9-point checklist in
  `DESIGN-SYSTEM.md`).
- Companion behavior must read as *alive*: correct timing, correct triggers, natural pacing.
  User: "VERY IMPORTANT."
- No glitching, no lag, no shortcuts on visual work. Runs smoothly on a lightweight machine.
- Nothing text-heavy. Simulations are spatial and visual, never walls of prose.
- Every floating surface: minimizable, closable, movable, resizable, controls in a consistent
  position revealed on hover.
- The wireframes are **direction only** and do not represent final quality. That is on the Director.

**Non-negotiables:**
- Every action derives from the FABLE contract.
- All work stays in `C:\Users\jhamdan\Desktop\project-x`.
- Canary `YO-YO` opens and closes every user-facing output.
- Obstacles are fixed, solved functionally, or routed around — never skipped, never silently dropped.
- Never claim a tool, test, inspection, or benchmark happened unless it actually did.
- Do not compromise or conflict with another agent's good work — only build on it.

---

# STATUS

## Current state
building

## Now
Foundations are real and tested. Camera rig, companion behavior arbiter, learner model, design
system, and both character GLBs are done and verified. Three medical simulations are in
reverse-engineering; the runnable app shell is being assembled so every later piece is inspectable
on screen rather than described in prose.

## Next
1. App shell boots (Vite + React + Electron always-on-top).
2. World renders — districts, Fog Line, controlled camera live on screen.
3. Companion renders and moves, driven by the tested arbiter.
4. Anatomy pipeline: pull meshes → decimate → GLB → our viewport.
5. Renal sim on the anatomy pipeline; clinical station reusing the same viewport.

## Human needed?
**No — not blocked.** See YOUR DESK above for optional course corrections.

---

# BOARD

## Active

- [ ] **Runnable app shell** — Director
  - Scope: `vite.config.ts`, `tsconfig.json`, `index.html`, `main.tsx`, Electron main + preload
  - Acceptance: `npm run dev` serves; Electron window opens always-on-top and transparent
  - Evidence: dev-server output + a screenshot of the running window

- [ ] **World renderer** — Director
  - Scope: `world/World.tsx`, `District.tsx`, `FogLine` integration, board perimeter
  - Acceptance: 32-space perimeter + center world viewport visible; districts respond to
    `worldState()`; fog line sits at each district's `estimateConfidence`
  - Evidence: screenshot at all 4 yaw presets × 3 framings

- [ ] **Companion renderer** — Director
  - Scope: `companion/CompanionRig.tsx` — GLB + `AnimationMixer`, real cross-fades
  - Acceptance: arbiter drives it; clips cross-fade rather than cut; `reportClipDuration()` wired
  - Evidence: on-screen behavior + the 24 passing arbiter tests

- [ ] **Three medical simulations** — Director + subagents
  - Scope: clinical station engine, 3D anatomy, renal physiology
  - Acceptance: each is functionally correct AND visually ours AND not text-heavy
  - Evidence: per-sim screenshots + physiology correctness tests

## Critique / Test

- [ ] Independent critic pass on the first visible build (contract §9 — fresh context, artifact only)

## Done

- [x] **Contract installed as governing source of truth**
  - Evidence: contract at root (626 lines), `_contract/` originals, oath in persistent memory.

- [x] **Boundaries + delivery target locked**
  - Evidence: `gh auth status` → `ahamdan-dev`; repo `ahamdan-dev/product-x`; `main` tracking.

- [x] **Live Workbench HQ created**
  - Evidence: `POST /new` → `201 {"kind":"live"}`; `GET /d/F0N2aMsE0N.md` returns seeded content.
  - Obstacle overcome: every request returned HTTP 000, which read as blocked egress. `npm ping`
    succeeding disproved that — the real cause was a Windows schannel certificate-revocation
    failure. Fixed with `curl --ssl-no-revoke`; the chain still validates.

- [x] **Both companion characters converted to engine-ready 3D**
  - Result: the shipping files are `companion-a.glb` (2.4 MB, 12 animations) and `companion-b.glb`
    (1.8 MB, 10), **29 joints** each, embedded texture, 1552 / 1622 tris. Replaces the "alvin"
    chipmunk placeholder — and also supersedes the earlier `companion_male/_female.glb` pair
    (700/591 KB, 11 and 10 clips, 22 joints), which is what the previous entry described and which
    the app no longer loads.
  - Evidence: a real GPU render pass in Electron, every triangle edge measured against its own bind
    length across every clip, plus the same measurement re-run on the source FBX and visual captures
    of the worst frame — `_shots/gpu-companion-a.log`, `gpu-companion-b.log`, `hip-tear.log`,
    `hip-glb-idle1-*.png`. **Corrected:** this line previously read "GLB binary headers parsed
    directly in Node". Parsing the container can confirm clips, joints and a texture *exist*; it
    never poses a vertex or renders a pixel, so it could not justify a claim about the rig
    deforming correctly. The stated method did not support the stated conclusion.
  - Obstacle overcome: `blender_mcp` had no `__main__` and would not run as a module. Rather than
    debug a socket addon, routed to Blender's headless CLI, which was already verified working and
    is strictly better for batch conversion — no GUI, no addon, scriptable.
  - Key decision: skinned GLB, not sprite sheets. Sprite sheets hard-cut between poses; skeletal
    animation cross-fades. Since companion timing must feel natural, this was the only option that
    could deliver it. Also 0.5 MB instead of ~59 MB.

- [x] **Companion behavior system — timing, triggers, pacing**
  - Result: `behavior.ts` + `arbiter.ts`. Five mechanisms produce natural pacing: reaction latency
    (180–520 ms "noticing" beat), interrupt classes, per-behavior cooldowns, focus suppression, and
    settle-before-idle.
  - Evidence: **24/24 tests passing.** Injectable clock and RNG, so timing is asserted exactly
    rather than eyeballed.
  - Notable: `evidence.received` maps to *no* reaction, deliberately — activity is not gamified,
    only evidence is visualized. `celebrate.rare` has a 6-hour cooldown. Barge-in is the one place
    delay is zero; waiting there would feel like talking over you.

- [x] **Learner model with real math**
  - Result: exponential forgetting with a *growing* half-life (×1.9 per successful retrieval),
    source-reliability weighting, evidence-conflict detection, and a findings engine.
  - Two spec gaps filled: no decay function and no mastery weights existed anywhere in 3,949 lines
    of source material. Weights live in one documented tunable constant, never inlined — §46 says
    not to quietly lock them.
  - Notable: UWorld 88% and Anki 54% must not average to 71%; the disagreement *is* the finding.

- [x] **Design system, after catching my own slop**
  - Result: `DESIGN-SYSTEM.md` + `tokens.css`. Palette "Stain & Stock" — eye-ease green-gray lab
    stock, radiology-reading-room graphite, and accents from real reagents (hematoxylin, iodine,
    eosin). Type: Bricolage Grotesque + Instrument Sans + Geist Mono, all real variable fonts, on
    disk, verified.
  - **Obstacle overcome, and it was mine:** my first palette was warm cream `#F2EFEA` + terracotta
    + a high-contrast serif. Invoking the design skill surfaced a calibration note listing the three
    clusters that machine-generated design falls into — and cluster #1 was my palette verbatim. It
    was thrown out and rebuilt from objects in a medical student's actual world. The rejection is
    documented inside the file so it cannot recur.
  - Signature element: **the Fog Line** — a band of drifting grain at the exact height of each
    district's `estimateConfidence`. A tall district with a low fog line reads "you've built a lot
    here and I still don't know if you know it." No progress bar can say that.

- [x] **Controlled camera rig**
  - Result: 28° FOV long lens, pitch clamped 26°–46°, yaw snapped to 4 corner presets, orbit limited
    to a ±22° lean that springs fully back, 3 scripted dolly framings, roll structurally impossible.
  - Evidence: **20/20 tests passing**, including spring-back exactness, short-way rotation,
    interruptibility, and clamp enforcement under abusive input.
  - Obstacles overcome: 5 of the 20 failed first run. Two were bad test math (I measured to `lookAt`
    instead of the orbit focus — they differ by design, since `lookAt` lifts to seat the subject on
    the lower third). One was a real API gap: the rig exposed no orbit radius, so I added
    `orbitDistance`/`focus`/`azimuth`. One test premise was simply wrong and was rewritten to sweep
    for the actual cone boundary. All named here rather than quietly fixed.

---

# QUALITY MATRIX

| Requirement | Inspection method | Pass condition | Status | Evidence |
|---|---|---|---|---|
| Contract governs | Read installed contract vs. original | Unaltered | pass | root file vs `_contract/` |
| Contract survives context loss | Memory file + `MEMORY.md` | Recalled in fresh session | pass | `memory/project_x_fable_build_contract.md` |
| Work confined to project-x | Path check on every write | Zero outside writes | pass | all files under `Desktop\project-x` |
| GitHub delivery real | `gh auth status`, `gh repo view` | Authenticated, repo exists | pass | `ahamdan-dev`, scopes `gist, read:org, repo` |
| Live Workbench | Create then re-read over HTTP | Serves seeded content | pass | `201 {"kind":"live"}`, `GET` returns fences |
| Characters engine-ready | Real GPU render pass in Electron (`app/gpu_check.cjs`): every triangle edge measured posed-against-its-own-bind-length across every clip, judged on growth as a fraction of body height; the same per-edge measurement re-run against the source FBX; plus flat-white and textured captures of the worst frame | Skins correctly on the GPU; no edge grows a visible fraction of body height in any clip; GLB no worse than the FBX it was converted from; silhouette intact in the capture | pass | `_shots/gpu-companion-a.log` 12/12 clips CLEAN, worst edge growth 7.10% of height (gate 25%), all 4656 edges — the `1500` in `STEP` resolves to 1 on a 1552-tri mesh, so there is **no** stride; `gpu-companion-b.log` 10/10 CLEAN, worst 6.81%, all 4866 edges. `_shots/hip-tear.log`: 49 frames of `idle1`, every edge, GLB 0.68% vs source FBX 0.68%, ratio 1.000x. Captures `hip-glb-idle1-pelvis.png`, `-full.png`, `-pelvis-textured.png` — silhouette and texture both whole. **Limit of this evidence:** the GPU pass samples 7 time points per clip; only `idle1` on companion-a is covered at 49 frames. **Counts corrected:** the shipping files are `companion-a/-b.glb` with **12 and 10 clips, 29 joints**; the old "11 and 10 clips, 22 joints" describes the superseded `assets/companion/companion_male/_female.glb`, which the app no longer loads. |
| App's tear gate actually runs | Reproduce `prepareRig` + `worstEdge` verbatim on the shipping GLBs through the app's own code path (`tools/picker_gate.cjs`), then measure every clip, not just the idle the picker probes | A non-zero edge is measured on non-indexed geometry, and no clip exceeds `0.18 × height` | pass | `_shots/picker-gate.log`: threshold **0.3150 m**; worst edge at rest 0.1480 m (a) / 0.1243 m (b); worst posed edge across ALL clips 0.1613 m (a, `hype`) / 0.1951 m (b, `hype`) — 51.2% and 62.0% of threshold; `animatable TRUE` on both. Before the fix this read exactly **0.0000 m** on every edge of every clip: `worstEdge` returned early on `if (!pos \|\| !index)` and both GLBs are non-indexed (`_shots/glb-shape-probe.log`, `INDEX BUFFER: ABSENT`), so `assessRigIntegrity` was handed `maxEdge = 0` and passed unconditionally. An exact zero was a code path that never ran, not a small number. **Known coarseness:** the gate samples every 15th corner, so it understates — the unstrided probe measures companion-a's worst rest edge at 0.1649 m against the gate's 0.1480 m. Still 2x inside the threshold either way. |
| Companions stand upright, correctly scaled | `needsZUpToYUp` unit tests + skinned bind box measured four ways on the shipping files | Y-up converter output is not rotated; height reads as height | pass | `_shots/glb-shape-probe.log`: bind box `0.531 × 1.750 × 0.380` upright, and the old unconditional +90° about X turned that into `0.531 × 0.380 × 1.750`, after which `normaliseUpright` read the 0.38 m depth as height and scaled 4.6x to compensate. Now conditional on `needsZUpToYUp`, which is unit-tested against the standing case, the lying case, and a T-pose whose arm span exceeds its height (`glbSource.test.ts`). |
| Picker renders both companions unobscured | Screenshot the live picker panel at its real window size after the mask fix | Both figures at full colour, whole, animating, no cut | pass | `_shots/picker-mask-fixed.png` (1899×1034) — both companions render at full colour and intact. Before: `_shots/picker-front.png` shows two diagonal cuts meeting near the male's hips with the left thigh apparently detached. Cause was `rectsToClipPath` emitting ONE `polygon()` for two rectangles; CSS `polygon()` is a single ring, so it drew connecting diagonals between the two wells and `evenodd` punched out the crossing wedge. Now `path()` with one closed subpath per rectangle. This read on screen as a torn rig and cost a full forensic pass on the asset — the geometry was never wrong, the mask was. |
| Conversion faithful to the source FBX | Load source FBX and converted GLB side by side in one three.js, play the same clip, compare per-edge growth distributions normalised by each figure's own height (`tools/fbx_vs_glb.cjs`) | GLB max growth within 25% of the FBX's | partial | `_shots/fbx-vs-glb.log`: the two **same-rig** `idle1` pairs are identical to three decimals (a 0.668% vs 0.668%; b 0.976% vs 0.976%) — faithful. The two `hype` pairs read "GLB IS WORSE" (a 7.101% vs 3.908%; b 6.441% vs 3.908%) and the log's overall verdict is therefore **FAILURE**, not success. Mitigating, and measured: `hype` is a CROSS-RIG retarget, so it is being compared against a base rig it was never authored on (`_shots/clip-audit.log`: 20 cross-rig clips, 6 regressed). **Missing:** no same-rig source exists for `hype`, so cross-rig conversion fidelity is unproven either way. Absolute growth stays under the 25% GPU gate and the 0.3150 m app gate regardless. |
| Companion timing feels alive | Deterministic clock/RNG unit tests | Latency, interrupts, cooldowns, focus all hold | pass | 24/24 `arbiter.test.ts` |
| Camera is controlled | Unit tests under abusive input | Cannot escape clamps; lean always springs back | pass | 20/20 `camera.test.ts` |
| Real fonts, not fallbacks | Download + inspect file headers | Genuine variable fonts on disk | pass | 3 TTFs, axes read from files |
| Palette is not generated-default | Design-skill calibration check | Not any of the 3 known clusters | pass | first pass rejected in writing, rebuilt |
| App runs | `vite build`, then load in Electron and capture | Window opens, all three surfaces render | pass | `vite build` EXIT 0 in 4.1s; `_shots/today-v1.png`, `map-v1.png`, `together-v1.png` |
| Whole suite green | `npx vitest run` | All files pass, no skips | pass | 665/665 across 22 files, re-run 2026-08-09 (was recorded as 596/21 — stale, the suite has grown) |
| Code splitting real | Inspect build output chunk list | `three` isolated, not in entry | pass | `three-*.js` 683 kB in its own lazy chunk; `TodaySurface` 27 kB |
| Overlay does not obscure the user's SCREEN | Capture over a synthetic desktop pattern (`X_BEHIND=desktop`) | Pattern readable between surfaces | pass | `_shots/trans-map2.png`, `trans-today.png`, `trans-comp2.png`, `pt-today2.png` |
| Overlay does not obscure the user's FUNCTION | Sample a 48×24 grid, ask the shipped `ownsPoint` who owns each point (`X_PROBE=passthrough`) | Strictly between 0% and 100%: clicks reach the app on surfaces and the desktop elsewhere | pass | Today 57.2%, Together 34.5%, Map 85.8% — maps in `_shots/*.passthrough.txt`. Map is high *by design* (drag-anywhere camera orbit), so that window is not a passthrough surface; Today/Together are. |
| Click-through rule is correct, not just present | Unit tests over hand-built hit stacks | Paint claims, air passes, glass counts, load placeholder does not | pass | 18/18 `passthrough.test.ts`, incl. the `color-mix`/`oklab` alpha forms the real surfaces emit |
| All text has a backing on a transparent window | Read `X_BEHIND` capture + probe map together | No bare type on wallpaper | pass | caught the nav question line as bare `--x-ink-3` type (a token marked NON-TEXT ONLY) on the desktop; now a `max-content` glass chip at `--x-ink-2`. Before/after: `pt-today.png` → `pt-today2.png` |
| Board labels readable, not mirrored | Screenshot at board framing + unit test per side | Every name right-side-up; no side disagrees with itself | pass | `_shots/trans-map2.png`; 4 tests in `board.test.ts` |
| Companion framed on stage | Capture the companion window at its real size | Full silhouette in frame | pass | `_shots/trans-comp2.png` (was a macro shot of the pedestal) |
| Companion renders + cross-fades | Watch it on screen | Blends, never hard-cuts | partial | renders and is framed; blend behavior is tested (24/24 `arbiter.test.ts`) but **not yet observed on screen** |
| Sims functionally correct | Physiology/scoring unit tests | Matches textbook values | **not tested** | DEFERRED by user order |
| Sims not text-heavy | Visual inspection vs. originals | No prose walls; spatial instead | **not tested** | DEFERRED by user order |
| Lightweight performance | Frame timing on target machine | Steady 60fps, no hitches | **not tested** | no frame-timing capture has been run; DPR cap and instancing are design choices, not measurements |

Only `pass` when actually inspected. Nothing above is asserted without the named evidence.

---

# EVIDENCE GALLERY

## What you can inspect right now

**Tests — run these yourself:**
```
cd C:\Users\jhamdan\Desktop\project-x\app
npx vitest run
```
Expect **665 passing across 22 files** — including 24 companion-timing, 20 camera-contract, 25 board
(4 of them label orientation), 18 click-through, and 63 in `glbSource.test.ts` covering the rig gate,
`needsZUpToYUp`, and `rectsToClipPath`. (Re-run 2026-08-09; the figure was 596/21 and had gone stale.)

**See it as an overlay — the two harnesses that make the claims falsifiable:**
```
cd C:\Users\jhamdan\Desktop\project-x\app
npx vite --port 5301 --strictPort
X_PORT=5301 X_BEHIND=desktop X_PROBE=passthrough ./node_modules/.bin/electron ../tools/shot.cjs look today
```
`X_BEHIND=desktop` paints a synthetic desktop behind the page, so an opaque surface hides it and the
defect is visible in one glance. `X_PROBE=passthrough` writes `_shots/look.passthrough.txt`: an ASCII
map of which pixels the app claims. Both exist because these two properties fail *invisibly* — a
screenshot looks identical whether transparency works or not, and a window that wrongly eats every
click looks identical to one that passes them through.

**The 3D characters — open in any GLB viewer:**
`app\public\assets\companion\companion_male.glb` · `companion_female.glb`

**The thinking:**
- `DESIGN-SYSTEM.md` — palette, type, camera contract, Fog Line, and the rejected first pass
- `app\src\companion\behavior.ts` — every timing number, with the reasoning next to it
- `app\src\learner\model.ts` — the decay math and the findings engine

## Known gaps
- P1: the three simulations are specified but not built — DEFERRED by explicit user order, along with
  the 3D anatomy model and gesture-lab hand tracking.
- P2: frame timing has never been measured. The DPR cap and instancing are design choices, not
  benchmarks, and the matrix says so.
- P2: companion cross-fade blending is unit-tested but has not been watched on screen.
- P2: cross-rig retargeted clips are not proven faithful. `_shots/fbx-vs-glb.log` reports `hype`
  deforming worse in our GLB than in the FBX it was compared against, and that log's overall verdict
  is a FAILURE, not a pass. The comparison is against a base rig `hype` was never authored on, and no
  same-rig source for it exists, so this is genuinely open rather than dismissed. Same-rig `idle1`
  matches its source to three decimals on both companions, and absolute growth stays inside both the
  25% GPU gate and the 0.3150 m app gate — so it ships, with the gap recorded.

Corrected here rather than quietly: this section previously read "nothing renders on screen yet" and
"Electron always-on-top shell not yet wired." Both are now false — all three surfaces render, and both
windows are transparent always-on-top overlays with click-through. Stale gaps are as misleading as
overclaimed passes.

---

# DECISIONS

| Date | Decision | Reason | Owner |
|---|---|---|---|
| 2026-08-09 | FABLE contract is the unbreakable governing oath | User instruction | human |
| 2026-08-09 | Workdir locked to `Desktop\project-x` | User instruction | human |
| 2026-08-09 | Canary `YO-YO` opens and closes every output | User audit signal | human |
| 2026-08-09 | Delivery repo is `ahamdan-dev/product-x` | User decision; no `project-x` repo exists | human |
| 2026-08-09 | `curl --ssl-no-revoke` for all HTTPS from the shell | Windows schannel can't reach the CA revocation list; chain still validates | agent |
| 2026-08-09 | Skinned GLB, not sprite sheets | Sprite sheets cannot cross-fade, and natural timing is a hard requirement | agent |
| 2026-08-09 | Blender headless CLI instead of blender-mcp | The MCP package had no `__main__`; the CLI was already verified and is better for batch work | agent |
| 2026-08-09 | Palette rebuilt after failing a slop check | My own first pass matched a known generated-design cluster exactly | agent |
| 2026-08-09 | Companion timing logic is pure and unit-tested | Timing bugs are invisible in code review and glaring on screen | agent |
| 2026-08-09 | Camera on rails: 4 presets, 3 framings, clamped lean | User: "MOST OPTIMAL CAMERA ANGLES THAT ARE CONTROLLED"; also makes the frustum predictable, so off-screen districts freeze | agent |
| 2026-08-09 | **Direct asset pull from Humanome / Clinical Commander authorized** | User states they know both owners and have their go-ahead, and that the assets are open-source despite not being on GitHub | human |
| 2026-08-09 | Z-Anatomy: take the meshes, discard the entire UI | User: logo everywhere, "fighter-jet command center," button walls, Latin labels, text-heavy. Overwhelming and simply bad UX | human |
| 2026-08-09 | Anatomy pipeline is built first among the three sims | Renal renders on top of it and the clinical station reuses its viewport | agent |

---

# PROTECTED STATE

- `START-HERE-FABLE-BUILD-ME-THIS-CONTRACT.md` and `_contract/` originals.
- `CLAUDE.md` / `AGENTS.md` house rules.
- Canary `YO-YO`, the workdir boundary, the GitHub delivery target.
- `DESIGN-SYSTEM.md` palette and type decisions — do not drift back toward the rejected first pass.
- The 24 companion-timing and 20 camera tests — these encode user mandates. Do not weaken a test to
  make a change pass.

---

# TEAM

| Role | Owner | Scope |
|---|---|---|
| Director | Claude Code (Opus 5) | mission, decomposition, bar, all coordination files |
| Reverse-engineering | subagents (running) | sim mechanics, tutor engine, license research |
| Critic | fresh-context subagent, per §9 | inspects the artifact only — never the builder's rationale |

---

# TEAM CHAT / HANDOFFS

**[2026-08-09] @director**
Foundations done and verified: 44 tests green, both characters converted, design system locked after
I caught and rejected my own generic palette. Now building the parts you can actually see.

**[2026-08-09] @director**
On the asset question — you've confirmed owner permission and that the assets are open-source
regardless of hosting. Logged as your authorization (see Decisions). Pulling directly, and Z-Anatomy's
interface goes straight in the bin: we take geometry, not their fighter-jet cockpit.

**[2026-08-09] @director**
Nothing is blocked on you. Four items on YOUR DESK have defaults already in motion — reply only if
you want a different fork.

**[reply below this line]**

---

# UPDATE POLICY

Update after meaningful events, not on a timer. Mandatory: mission locked, major workstream
begins/completes, artifact becomes inspectable, test or benchmark completes, critic returns material
findings, strategy changes, blocker needs human input, final acceptance passes.

---

# FINAL ACCEPTANCE

**State:** not done

**P0 remaining:** 0
**P1 remaining:** 1 — three simulations not built (DEFERRED by user order)
**Independent critic:** not yet run
**User-testable artifact:** `npx vitest run` in `app\` (596 tests), the running overlay via TOUCH-ME.cmd, and both GLBs
