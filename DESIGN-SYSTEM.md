# PRODUCT X — DESIGN SYSTEM v1 (locked tokens)

Derived from: the FABLE BOARD BLUEPRINT (§2 feel, §35 animation layers, §40 hierarchy, §43 mature
gamification), the deep-research report (evidence-not-activity, fog = uncertainty), the user's stated
taste (Apple typography/toggles/containers/curved edges/frosted glass/light+dark, Duolingo warmth
without the candy, airy modern minimalism), and the Drive style references.

**Art direction ruling (user, 2026-08-09):** the World sits **between voxel and semi-stylized 3D
realism**, and *does not have to be heavily 3D*. Camera is **controlled** — never free-flying.
This is now the binding skin direction. It also resolves the cost problem: chunky low-detail
geometry + fixed camera = tiny GPU budget with a premium look.

---

## 1. The visual thesis

> **Evidence illuminates fog.**

Every visual decision serves one metaphor. The learner's world starts as warm haze. Demonstrated
competency does not add points — it adds **light, material, and inhabitants**. Uncertainty is fog,
never failure. Decay dims; it never demolishes (§21.6).

That single rule kills the two failure modes the blueprint forbids: casino gamification (light is
earned, not sprayed) and dashboard sterility (light is atmospheric, not numeric).

## 2. Palette — "Stain & Stock"

**Rejected first pass, and why it matters.** The first palette was warm cream `#F2EFEA` + terracotta
`#A85A42` + a high-contrast serif display. That is the single most common signature of
machine-generated design right now, and it appears regardless of subject. It was thrown out. Nothing
below is a default; every value traces to a physical object in a medical student's actual world.

**Sources.** Light neutrals come from **eye-ease green-gray lab stock** — the pale green paper
clinical forms and lab reports were printed on for decades, specifically to reduce eye strain over
long reading. Dark neutrals come from **radiology reading-room graphite**. The accents come from the
three stains and reagents a student handles every week.

### Neutrals — lab stock / reading room (near-neutral with a faint green cast, never cream, never blue-gray)
| Token | Light | Dark | Use |
|---|---|---|---|
| `--x-bg` | `#EDF1EC` | `#15181A` | app ground |
| `--x-surface` | `#F9FBF8` | `#1E2224` | cards, containers |
| `--x-surface-2` | `#E5EAE4` | `#262B2C` | recessed / inset |
| `--x-line` | `#D3DAD2` | `#313739` | hairlines, 1px borders |
| `--x-ink` | `#1A1F1D` | `#EDF1EC` | primary text |
| `--x-ink-2` | `#525A55` | `#9AA39D` | secondary text |
| `--x-ink-3` | `#7E877F` | `#69726C` | tertiary / metadata |

### Accents — from real reagents
| Token | Light | Dark | Source | Meaning |
|---|---|---|---|---|
| `--x-hema` | `#2E3167` | `#7C81C9` | **hematoxylin** (histology nuclear stain) | **structure / competency.** Primary action. |
| `--x-iodine` | `#B4671C` | `#DE9440` | **povidone-iodine** | **earned illumination.** Mastery, milestones. |
| `--x-eosin` | `#C9647F` | `#E091A6` | **eosin** (histology cytoplasm stain) | **companion presence only.** |
| `--x-fog` | `#A9B0AB` | `#3E4644` | — | **uncertainty.** Not failure. |
| `--x-oxblood` | `#8C2F39` | `#C46A72` | — | **destructive only.** Never a learning state. |

Hard rules:
- **Unstable is not a color.** It is rendered as *loss of chroma and loss of light* — desaturation
  toward `--x-fog`. This is the design idea that follows from "fog means I don't have enough
  evidence," and it removes the warning-red/terracotta reflex entirely. No hue means "you are bad
  at this."
- `--x-eosin` is reserved for the companion. If it appears on a chart, that's a bug.
- `--x-iodine` is rationed — it appears only when something was genuinely *earned*.
- `--x-oxblood` is for destructive confirmation only. Learning states never use it.
- Never pure `#000` or `#FFF`.

## 3. Typography

Avoiding the generated-design cluster here too: no Inter, no Instrument Serif, no Playfair, no
Space Grotesk.

| Role | Face | Why |
|---|---|---|
| Display (restrained) | **Bricolage Grotesque** (variable: weight + width + optical size) | A grotesque with real quirks — it reads like European institutional and transit signage, which is exactly the register of a teaching hospital's wayfinding. It carries a voice without wearing a costume. Used only at ≥23px and only for the few lines that matter. |
| UI + body | **Instrument Sans** (variable 400–700) | Low-contrast humanist-geometric, tight apertures. Reads Apple-adjacent without being SF, and is not the Inter tell. |
| Metrics / evidence | **Geist Mono** | Tabular numerals, so competency figures don't shimmer while they tick. |

Scale (1.20 minor-third, 16px base): `12 / 13 / 14 / 16 / 19 / 23 / 28 / 33 / 40`.
Tracking: Bricolage ≥28px gets `-0.025em`; Instrument body `0`; 12–13px UI `+0.01em`.
Line height: body `1.55`, UI `1.35`, display `1.06`.
Bricolage axes in use: `wdth` 96 at display sizes (very slightly condensed — more signage, less poster).

## 4. Geometry & elevation

Radii — Apple-like continuous feel via generous, consistent curvature:
`--x-r-sm 10px` · `--x-r-md 14px` · `--x-r-lg 20px` · `--x-r-xl 28px` · `--x-r-pill 999px`.

Elevation is **two-part always**: a tight contact shadow plus a wide ambient shadow. One-shadow
elevation is the tell of generated UI.

```
--x-e1: 0 1px 2px rgba(34,31,29,.05),  0 2px 8px  rgba(34,31,29,.04);
--x-e2: 0 2px 4px rgba(34,31,29,.06),  0 10px 26px rgba(34,31,29,.07);
--x-e3: 0 4px 8px rgba(34,31,29,.07),  0 24px 60px rgba(34,31,29,.10);
```

Frosted glass — used only on floating layers over live content, never on static panels:
`background: color-mix(in oklab, var(--x-surface) 72%, transparent); backdrop-filter: blur(24px) saturate(140%);`
plus a 1px inner top highlight (`inset 0 1px 0 rgba(255,255,255,.55)`) — that highlight is what makes
glass read as physical rather than as a blur filter.

## 5. Motion

Six layers, per blueprint §35: Ambient · Attention · Navigation · Progress · Milestones · Connections.
Philosophy: **alive, not busy.**

| Token | Value | Use |
|---|---|---|
| `--x-t-fast` | `140ms` | hover, toggle |
| `--x-t-base` | `240ms` | card lift, panel open |
| `--x-t-slow` | `420ms` | container expand, route illuminate |
| `--x-t-world` | `1800ms` | world development reveal (§23: "only a few seconds") |
| `--x-ease` | `cubic-bezier(.32,.72,0,1)` | the house curve — fast out, long settle |
| `--x-ease-soft` | `cubic-bezier(.4,0,.2,1)` | fades |

Rules: nothing animates position and opacity on different curves. `prefers-reduced-motion`
collapses everything to opacity-only at `--x-t-fast`. Attention layer is a 2-cycle soft pulse, then
it stops — no infinite pulsing.

## 6. Controlled camera contract

The World camera is **on rails**. This is both an art decision and the performance strategy.

- Projection: perspective, **28° FOV** (long lens — keeps the voxel world reading as a model on a
  table rather than a game viewport).
- Base pitch **34°**, yaw snapped to one of **4 quarter-turn presets** aligned to the four corners.
- Orbit is *damped and clamped*: yaw ±22° from the active preset, pitch 26°–46°. Release springs back.
- Zoom is 3 discrete framings only — `board` (whole perimeter), `district` (one subject region),
  `close` (one structure). Each is a scripted dolly, not a scroll multiplier.
- No roll, ever. No free-fly. No WASD (§31).
- Every camera move is an eased transition on `--x-ease`, 620ms, and is interruptible.

Consequence: the frustum is predictable, so off-screen districts are frozen and un-ticked.

## 7. Always-on-top surface rules (user mandate)

Every surface that can appear on screen obeys all four:
1. **Minimizable and closable** — always both.
2. Controls live in a **consistent position** (top-right of the surface, inset 10px).
3. Controls are **hidden at rest, revealed on hover** of the surface (150ms fade), and always revealed
   on keyboard focus.
4. Surface is **movable and resizable**, with position/size persisted per surface.

## 8. The signature element — the Fog Line

One memorable thing, everything else disciplined around it.

Every district on the board carries a **fog line**: a thin horizontal band of animated grain that
sits at the exact height of that district's `estimateConfidence`. Below the line, the world is
rendered in full material. Above it, geometry fades into drifting fog.

Why this and not a progress bar: it makes the product's actual thesis visible in one glance. A tall
district with a low fog line means *"you've built a lot here and I still don't know if you know
it."* A short district with a high fog line means *"small, but proven."* No progress bar can say
that. It also encodes the report's hardest intellectual point — the difference between "you are
weak" and "I don't know whether you're strong" — as a physical property of the world rather than a
tooltip.

Motion: the fog is a single-pass domain-warped noise on a plane, 0.04 units/sec drift. It moves
slowly enough to read as atmosphere and never draws the eye during focus. When evidence arrives, the
line **descends** — the fog burns off from the top down over `--x-t-world`, and that descent is the
only progression animation in the product. Everything else is state, not celebration.

Cost: one shader on one plane per visible district, resolution-independent, no particles.

## 9. Zero-AI-artifact checklist (contract §7)

- [ ] No default Inter/system-ui fallback shipping as the visible face
- [ ] No single-shadow elevation
- [ ] No pure black/white
- [ ] No emoji as UI iconography
- [ ] No `border-radius: 8px` everywhere — radii vary by surface scale
- [ ] Optical alignment fixed by eye on icons + text (not just box centering)
- [ ] Every state (hover/active/focus/disabled/loading/empty/error) drawn, not defaulted
- [ ] Numerals tabular wherever they change
- [ ] Copy written in the companion's voice — no "Oops!", no "Awesome!", no exclamation inflation
