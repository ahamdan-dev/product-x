# WORKBENCH

## Purpose

This is the project's progress, coordination, evidence, and human-observation layer.

It is **not** the primary build prompt.  
The build rules live in `START-HERE-FABLE-BUILD-ME-THIS-CONTRACT.md`.

Use this file as:
1. the local source-of-truth schema for project progress, and
2. the fallback ledger when a live Workbench.md web document cannot be created or edited.

When a live Workbench document is available, mirror this structure there and treat the live document as the human-facing HQ.

---

# LIVE WORKBENCH

**Live URL:** [ADD WHEN CREATED]  
**Access mode:** [edit / suggest / comment / view]  
**Last synced:** [timestamp]  
**Director:** [agent/session]  
**State:** [aligning / planning / building / critiquing / integrating / awaiting-human / done / blocked]

## Bootstrap rules

If the user provides a `https://workbench.md/join/...` link:
- fetch it first,
- follow its instructions,
- join or create the requested HQ,
- place the resulting live URL above.

If no live URL exists and the environment can access Workbench:
- read `https://workbench.md/agents.md`,
- create a live project doc with a status component, task board, and team chat,
- place the resulting live URL above.

If the environment cannot use Workbench:
- continue with this local file,
- do not pretend a remote page exists.

Do not publish private credentials, secrets, private edit tokens, or sensitive internal data to a public Workbench page.

---

# MISSION

**Primary outcome:**  
[locked mission]

**Deliverable:**  
[artifact/result]

**Quality bar:**  
[one concise statement]

**References:**  
[links/files/examples]

**Non-negotiables:**  
- [rule]

**Protected state:**  
- [existing work that must not regress]

---

# STATUS

## Current state
[state]

## Now
[what is actively being worked on]

## Next
[next highest-value step]

## Human needed?
**No / Yes**

If yes:
- Decision needed:
- Why only the human can decide:
- Options:
- Recommended option:

Do not mark `awaiting-human` for questions the agent can safely resolve itself.

---

# BOARD

## Backlog

- [ ] [task]
  - Owner:
  - Scope:
  - Acceptance:
  - Evidence:
  - Dependencies:

## Active

- [>] [task]
  - Owner:
  - Started:
  - Current gap:
  - Latest evidence:
  - Protected dependencies:

## Critique / Test

- [ ] [task or artifact]
  - Critic:
  - Bar:
  - P0:
  - P1:
  - P2:
  - Evidence:

## Integration

- [ ] [integration task]
  - Owner:
  - Dependencies:
  - Regression surface:
  - Evidence:

## Done

- [x] [task]
  - Result:
  - Evidence:
  - Passed:
  - Preserved:

---

# QUALITY MATRIX

| Requirement | Inspection method | Pass condition | Status | Evidence |
|---|---|---|---|---|
| [requirement] | [method] | [pass] | [not tested / fail / pass] | [link/file] |

Only mark `pass` when it was actually inspected or tested.

---

# EVIDENCE GALLERY

Use the most useful media for the task.

## Latest viewable artifact

**What the user can inspect right now:**  
[preview/build/file]

**How to test it:**  
[short instructions]

**Known gaps:**  
[current P0/P1/P2]

## Visual evidence

Add as available:
- screenshots
- before/after images
- blind A/B comparisons
- rendered frames
- responsive viewport captures
- heatmaps
- overlays

## Motion / interaction evidence

Add as available:
- screen recordings
- videos
- GIFs
- interaction recordings
- input-response traces
- physics demonstrations
- state-transition recordings

## Functional evidence

Add as available:
- build output
- automated tests
- manual test results
- benchmark output
- FPS/frame-time measurements
- memory/CPU/GPU measurements
- accessibility results
- browser/device matrix
- logs that directly prove behavior

Do not use logs as a substitute for inspecting a visual or interactive artifact when the artifact itself can be inspected.

---

# GAUNTLET LOG

Record only meaningful iterations.

## Round [N]

**Target gap:**  
[largest concrete gap]

**Builder change:**  
[what changed]

**Critic result:**  
[P0/P1/P2 findings]

**Evidence:**  
[file/link/test]

**Regression:**  
[pass/fail + affected areas]

**Outcome:**  
[measurable improvement / strategy failed / different approach required]

If two consecutive rounds show no measurable improvement, change strategy.

Do not keep repeating the same repair.

---

# DECISIONS

Record decisions that should survive context loss.

| Date | Decision | Reason | Owner |
|---|---|---|---|
| [date] | [decision] | [reason] | [human/agent] |

Human decisions override lower-level agent preferences.

---

# PROTECTED STATE

These items may not be changed without a demonstrated reason under the build contract:

- [approved behavior]
- [approved visual]
- [API/interface]
- [asset]
- [performance property]
- [user decision]

Any change to protected state must be logged with:
- reason,
- affected behavior,
- regression evidence.

---

# TEAM

Use only the roles the task actually needs.

| Role | Owner | Scope | Write ownership |
|---|---|---|---|
| Director | [agent] | global mission, decomposition, bar, coordination | coordination files |
| Builder | [agent] | [workstream] | [paths/components] |
| Critic | [agent] | independent inspection | no implementation writes unless explicitly reassigned |
| Integrator | [agent] | final assembly and regression | integration surface |

Add specialists only when they provide real leverage.

---

# TEAM CHAT / HANDOFFS

Keep coordination concise.

Format:

**[timestamp] @role**  
[message]

Use for:
- task claims
- dependency notices
- conflicts
- critic handoffs
- integration readiness
- human decisions

Do not dump long hidden reasoning into the team chat.

---

# UPDATE POLICY

Update this Workbench after meaningful events rather than on a fixed timer.

Mandatory update points:
- mission locked
- live HQ created
- major workstream begins
- major workstream completes
- meaningful visual/functional artifact becomes inspectable
- test or benchmark completes
- critic returns material findings
- a strategy changes
- integration begins
- blocker needs human input
- final acceptance passes

Each update should answer, in seconds:

1. What state is the project in?
2. What changed?
3. What can I view or test now?
4. What passed or failed?
5. What remains?
6. Does the agent need me?

Before a new major workstream and before final integration, re-check the live Workbench for human comments when the platform supports it.

---

# FINAL ACCEPTANCE

**State:** [done / not done]

**Hard requirements:** [pass/fail]  
**P0 remaining:** [0 / count]  
**P1 remaining:** [0 / count]  
**Regression:** [pass/fail]  
**Independent critic:** [pass/fail/not available]  
**Reference comparison:** [result/not applicable/not possible]  
**User-testable artifact:** [link/path]  

## Final evidence
- [evidence]

## Remaining optional items
- [optional only]

Do not mark the project `done` with unresolved P0/P1 defects.
