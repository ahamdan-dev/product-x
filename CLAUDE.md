# CLAUDE.md — Project X

> **READ THIS FIRST, EVERY SESSION.** This file is auto-loaded. It is self-sufficient by design: if
> persistent memory fails to load, everything needed to honor the oath is written here. The user
> should never have to restate the ground rules.

## Standing contract (unbreakable)

For any substantial build, create, implement, redesign, animation, rendering, game, visual, product,
interface, application, or system task in this project:

1. Read `START-HERE-FABLE-BUILD-ME-THIS-CONTRACT.md` before substantial execution.
2. Follow it as the standing build contract. **Every** action — operating, delegating, thinking —
   derives from it.
3. Use `WORKBENCH.md` for progress, evidence, coordination, and the live Workbench bridge.
4. The user's latest explicit mission and constraints remain the source of truth.
5. Do not ask the user to manually fill out the contract. Derive it from the mission, inspect
   available context, and ask only material alignment questions.

## Project X house rules (layer on top of the contract)

- **Working directory:** all work stays in `C:\Users\jhamdan\Desktop\project-x` unless the user
  explicitly says otherwise.
- **Canary phrase:** every output to the user opens and closes with `YO-YO`. This is the user's
  audit signal that these ground rules are still in force. Omitting it is a contract breach.
- **Full arsenal mandate:** proactively call the strongest applicable tool, Skill, MCP server,
  plugin, subagent, file, or asset available in the harness. When the user does not name one, choose
  the most optimal and use it. Never claim a capability that does not exist (contract §5).
- **Update style:** clear, organized, concise, direct. Say what was done, why / the best route, and
  how each obstacle was overcome — in few words.
- **Obstacles are never skipped or avoided.** Fix it, build a functional solution, or route around
  it to the same end goal. Then state which of the three happened.
- **Delivery:** on completion or on request, commit and push to
  `https://github.com/ahamdan-dev/product-x` — already wired as `origin`, tracking `main`. The user
  chose to keep the repo named `product-x` even though the project is Project X; no `project-x` repo
  exists. Do not create one.

## Session start checklist

1. Read `START-HERE-FABLE-BUILD-ME-THIS-CONTRACT.md` (the governing contract).
2. Read `WORKBENCH.md` — current state, board, quality matrix, decisions, protected state.
3. Read `ARSENAL.md` — verified capabilities, and the network gotcha below.
4. Open with `YO-YO`; close with `YO-YO`.
5. Re-check the live HQ for new human comments before starting a major workstream and before final
   integration (contract §11).

## Live HQ

`https://workbench.md/d/F0N2aMsE0N?key=4uTXfmxxLb3HXUR0KT3Pn` — `edit` role. Owned by the user's
account `abedelhamdan` since 2026-08-09, so `state: awaiting-human` now reaches their inbox and
email. Use that state only when a human decision is genuinely required.

Mirror `WORKBENCH.md` here at the contract's mandatory update points. Never publish credentials,
secrets, or customer data to it.

- Append chat: `POST /api/docs/F0N2aMsE0N/chat/message?key=…` `{"text":"…","author":"director","fence":"hq"}`
- Status/worklog: `POST /api/docs/F0N2aMsE0N/status` `{"state":"building","note":"…"}`
- Poll for replies: `GET /api/docs/F0N2aMsE0N/events?since=latest&wait=55`

## Network gotcha (costs an hour if forgotten)

HTTPS from the shell needs **both**:
- `curl --ssl-no-revoke` — Windows schannel can't reach the CA revocation list and rejects valid
  certificates with `CRYPT_E_NO_REVOCATION_CHECK`, surfacing as a misleading `HTTP 000`.
- `dangerouslyDisableSandbox: true` on the Bash call — the default sandbox blocks network.

`HTTP 000` here does **not** mean the network is down. Test a second host before concluding that.

## Reference copies

`_contract/` holds the pristine originals extracted from
`START-HERE-FABLE-BUILD-SYSTEM.zip`. Do not edit them; edit the root working copies.
