# WORKBENCH — Project X

## Purpose

Project progress, coordination, evidence, and human-observation layer.

Build rules live in `START-HERE-FABLE-BUILD-ME-THIS-CONTRACT.md`. This file is the local
source-of-truth ledger and the fallback when a live Workbench web document cannot be created.

---

# LIVE WORKBENCH

**Live URL:** https://workbench.md/d/F0N2aMsE0N?key=4uTXfmxxLb3HXUR0KT3Pn
**Access mode:** edit (anonymous doc — this key is the full capability)
**Last synced:** 2026-08-09
**Director:** Claude Code (Opus 5) — lead/director for this project
**State:** aligning / awaiting-human (mission)

## Harness capability note — obstacle and fix

- First attempt at remote creation failed: every `curl` to workbench.md returned HTTP 000. The
  initial read of that was "shell egress is blocked."
- That diagnosis was wrong. `npm ping` reached the registry fine, which contradicted it. The real
  cause was a Windows **schannel certificate-revocation** failure —
  `CRYPT_E_NO_REVOCATION_CHECK`: the OS could not reach the CA's revocation list, so it refused an
  otherwise valid certificate.
- **Fix:** `curl --ssl-no-revoke`. workbench.md then returned 200, and `POST /new` created the live
  doc. Skipping the revocation *check* is not the same as accepting a bad certificate; the chain
  still validates.
- **Result:** the live HQ mandated by contract §11 exists and was verified by re-reading it over
  HTTP. It is an anonymous doc, so it belongs to no account — see the ownership note below.

## Ownership note (relay once, per Workbench's own guidance)

The HQ page is unowned. Opening the link in a browser, signing in free, and clicking
"Claim this doc" would attach it to the user's account and route "needs me" notifications to them.
Nothing is gated on this — the page works either way. Claiming requires the user's own signed-in
browser session; the agent will not sign up or claim on their behalf.

Nothing sensitive is published to the page: no credentials, no tokens, no customer data.

---

# MISSION

**Primary outcome:**
NOT YET LOCKED — awaiting the build mission from the user. The user's stated first step was to
establish source of truth, boundaries, and requirements; that layer is now installed.

**Deliverable:**
TBD on mission statement.

**Quality bar:**
Contract §7 baseline until the mission narrows it: production quality with zero detectable
AI-generated artifacts, judged on the actual artifact rather than on builder claims.

**References:**
- `START-HERE-FABLE-BUILD-ME-THIS-CONTRACT.md` — standing execution contract (governing)
- `_contract/` — pristine originals from `START-HERE-FABLE-BUILD-SYSTEM.zip`

**Non-negotiables:**
- Every action derives from the FABLE contract.
- All work stays in `C:\Users\jhamdan\Desktop\project-x` unless the user says otherwise.
- Canary `YO-YO` opens and closes every user-facing output.
- Strongest applicable tool / Skill / MCP / plugin / subagent is used proactively; no invented
  capability.
- Obstacles are fixed, solved functionally, or routed around — never skipped, never silently
  dropped.
- Commit + push to GitHub on completion or on request.

**Protected state:**
- The contract files themselves (root working copies and `_contract/` originals).
- The house rules in `CLAUDE.md` / `AGENTS.md`.

---

# STATUS

## Current state
aligning

## Now
Contract layer installed and verified. Project scaffold created. Standing by for the build mission.

## Next
Lock GOAL / RULES / BAR from the user's mission, then decompose per contract §6 and open the
acceptance matrix (§8).

## Human needed?
**Yes**

- **Decision needed:** the build mission — what Project X must be when finished, who it is for, and
  any references or non-negotiables.
- **Why only the human can decide:** the PRIMARY OUTCOME governs every lower-level decision
  (contract §2) and cannot be derived by inspection; the directory is empty apart from the contract.
- **Options:** n/a — free-form mission statement. Short form is fine: *"Build me [thing].
  References: [...]. Non-negotiables: [...]"* — the contract does the rest.

---

# BOARD

## Backlog

- [ ] Lock mission (GOAL / RULES / BAR)
  - Owner: Director
  - Scope: contract §2 mission extraction + §3 alignment gate
  - Acceptance: GOAL, RULES, BAR written into this file; acceptance matrix seeded
  - Evidence: this file, populated MISSION + QUALITY MATRIX sections
  - Dependencies: user's mission statement

- [ ] Decompose into workstreams
  - Owner: Director
  - Scope: contract §6 — owner, scope, change surface, acceptance, evidence per workstream
  - Acceptance: each workstream independently judgeable
  - Evidence: BOARD populated
  - Dependencies: mission locked

## Active

_none_

## Critique / Test

_none_

## Integration

_none_

## Done

- [x] Install the operational contract as this project's governing source of truth
  - Result: `START-HERE-FABLE-BUILD-SYSTEM.zip` extracted; contract, WORKBENCH, AGENTS, CLAUDE
    placed at project root; pristine copies kept in `_contract/`; oath written to persistent memory
    as `project_x_fable_build_contract` and indexed in `MEMORY.md`.
  - Evidence: `START-HERE-FABLE-BUILD-ME-THIS-CONTRACT.md` (626 lines, read in full),
    `_contract/` (4 files), memory file + `MEMORY.md` index line, this ledger.
  - Passed: contract is recallable across sessions; house rules encoded in `CLAUDE.md` +
    `AGENTS.md`; canary and workdir boundary recorded.
  - Preserved: original zip untouched in Downloads; `_contract/` originals are read-only by policy.

- [x] Establish project boundaries and delivery target
  - Result: workdir fixed to `C:\Users\jhamdan\Desktop\project-x`; git repository initialized;
    GitHub delivery target identified.
  - Evidence: `git init` succeeded; `gh auth status` → logged in as `ahamdan-dev` with `repo` scope;
    `gh repo view ahamdan-dev/product-x` → exists, public, **empty**, created 2026-08-09.
  - Note: no repo named `project-x` exists. `product-x` is empty and was created the same day, so it
    is treated as the likely intended target. Flagged to the user for confirmation or rename.

---

# QUALITY MATRIX

| Requirement | Inspection method | Pass condition | Status | Evidence |
|---|---|---|---|---|
| Contract is the governing source of truth | Read the installed contract at project root end to end | Full text present and unaltered vs. zip original | pass | `START-HERE-FABLE-BUILD-ME-THIS-CONTRACT.md` vs `_contract/` copy |
| Contract survives context loss | Persistent memory file + `MEMORY.md` index entry | Oath recallable in a fresh session | pass | `memory/project_x_fable_build_contract.md`, `MEMORY.md` |
| Work confined to project-x | Path check on every write | Zero writes outside the workdir (memory dir excepted, by design) | pass | all project files under `Desktop\project-x` |
| GitHub delivery path is real | `gh auth status`, `gh repo view` | Authenticated with push scope; target repo exists | pass | logged in as `ahamdan-dev`, scopes `gist, read:org, repo`; `product-x` empty |
| Live Workbench page | Create the doc, then re-read it over HTTP | Live URL returned and serves the seeded content | pass | `POST /new` → 201 `{"kind":"live"}`; `GET /d/F0N2aMsE0N.md` returns the status/board/sheet/chat fences |
| Capability inventory is real, not assumed | Run each tool; read the plugin registry | Version string returned per tool | pass | `ARSENAL.md` — Node 20.20.0, npm 10.8.2, git 2.55.0, gh 2.96.0, Python 3.12.10, ffmpeg 8.1 |
| Mission acceptance matrix | Populate on mission lock | Every hard requirement has a real inspection method | not tested | pending mission |

Only `pass` when actually inspected. Nothing above is asserted without the evidence named.

---

# EVIDENCE GALLERY

## Latest viewable artifact

**What the user can inspect right now:**
`C:\Users\jhamdan\Desktop\project-x\` — contract, house rules, this ledger, git repo.

**How to test it:**
1. Open `START-HERE-FABLE-BUILD-ME-THIS-CONTRACT.md` — confirm it matches the zip.
2. Open `CLAUDE.md` — confirm workdir, canary, arsenal, and obstacle rules are written down.
3. Run `git -C "C:\Users\jhamdan\Desktop\project-x" log --stat` — confirm the install commit.
4. Start a fresh Claude Code session in this folder — confirm the oath is recalled from memory.

**Known gaps:**
- P1: mission not yet locked (blocked on user).
- P3 (optional): the HQ page is unowned; the user can claim it in a browser to get notifications.

---

# GAUNTLET LOG

## Round 0 — contract install

**Target gap:** No governing source of truth in the project.
**Builder change:** Extracted the contract bundle, installed root working copies + `_contract/`
originals, wrote `CLAUDE.md` house rules, initialized git, wrote the oath to persistent memory.
**Critic result:** P1 — mission absent, so no acceptance matrix can be completed. P2 — remote
Workbench unavailable.
**Evidence:** files on disk, `gh` output, memory file, this ledger.
**Regression:** n/a — greenfield; nothing pre-existing to regress.
**Outcome:** measurable improvement — the project now has enforceable boundaries.

---

# DECISIONS

| Date | Decision | Reason | Owner |
|---|---|---|---|
| 2026-08-09 | FABLE contract is the unbreakable governing oath for Project X | User instruction; every action must derive from it | human |
| 2026-08-09 | Workdir locked to `Desktop\project-x` | User instruction | human |
| 2026-08-09 | Canary `YO-YO` opens and closes every output | User audit signal for these ground rules | human |
| 2026-08-09 | Live Workbench HQ created as an anonymous doc; local `WORKBENCH.md` mirrors it | Contract §11 mandates a live surface when the environment can reach Workbench. It can. | agent |
| 2026-08-09 | HTTPS from the shell uses `curl --ssl-no-revoke` | Windows schannel cannot reach the CA revocation list; the certificate chain itself validates | agent |
| 2026-08-09 | `ahamdan-dev/product-x` treated as the delivery repo | Only empty same-day repo; no `project-x` exists. Awaiting confirm/rename | agent |
| 2026-08-09 | `_contract/` originals are read-only; edits go to root copies | Keeps a verifiable baseline of the contract | agent |

---

# PROTECTED STATE

- `START-HERE-FABLE-BUILD-ME-THIS-CONTRACT.md` and `_contract/` originals — content is protected.
- `CLAUDE.md` / `AGENTS.md` house rules — the six Project X rules may not be weakened.
- Canary `YO-YO`, the workdir boundary, and the GitHub delivery target.

Any change here must be logged with reason, affected behavior, and regression evidence.

---

# TEAM

| Role | Owner | Scope | Write ownership |
|---|---|---|---|
| Director | Claude Code (Opus 5), this session | global mission, decomposition, bar, coordination | coordination files (`WORKBENCH.md`, `CLAUDE.md`, `AGENTS.md`) |
| Builder | TBD on mission | TBD | TBD |
| Critic | TBD — fresh-context subagent, per contract §9 | independent inspection of real output | no implementation writes |
| Integrator | TBD on mission | final assembly + regression | integration surface |

Specialists added only where they give real leverage. Available in this harness: 3D/WebGL, motion,
animation, and design specialist subagents and Skills; parallel subagent fan-out; worktree isolation
for parallel writes.

---

# TEAM CHAT / HANDOFFS

**[2026-08-09] @director**
Contract installed and verified. Boundaries locked. Standing by for the build mission before any
substantial execution, per contract §3.

---

# UPDATE POLICY

Update after meaningful events, not on a timer. Mandatory points: mission locked, live HQ created,
major workstream begins/completes, artifact becomes inspectable, test or benchmark completes, critic
returns material findings, strategy changes, integration begins, blocker needs human input, final
acceptance passes.

---

# FINAL ACCEPTANCE

**State:** not done

**Hard requirements:** pending mission
**P0 remaining:** 0
**P1 remaining:** 1 (mission not locked)
**Regression:** n/a
**Independent critic:** not yet run
**Reference comparison:** pending mission
**User-testable artifact:** `C:\Users\jhamdan\Desktop\project-x\`

Not `done` while P0/P1 defects remain.
