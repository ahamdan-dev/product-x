# ARSENAL — verified capability inventory

Contract §5 requires routing to the strongest capability **actually available** and forbids
pretending one exists. This file is the verified inventory, so routing decisions are grounded rather
than guessed. Every line below was confirmed by direct inspection on 2026-08-09.

## Local toolchain (verified)

| Tool | Version |
|---|---|
| Node | v20.20.0 |
| npm / npx | 10.8.2 |
| git | 2.55.0.windows.1 |
| GitHub CLI (`gh`) | 2.96.0 — authenticated as `ahamdan-dev`, scopes `gist, read:org, repo` |
| Python | 3.12.10 |
| ffmpeg | 8.1-full — full build, useful for video/animation evidence capture |

Platform: Windows 11 Enterprise 26200, shell is Git Bash (POSIX sh).

## Plugins installed (user scope, verified)

- `frontend-design@claude-plugins-official` — visual design direction
- `core-3d-animation@claude-design-skillstack` — Three.js/WebGL, R3F, Babylon, GSAP ScrollTrigger, Motion/Framer
- `extended-3d-scroll@claude-design-skillstack` — PixiJS, PlayCanvas, A-Frame/WebXR, Locomotive, Barba
- `animation-components@claude-design-skillstack` — Anime.js, Lottie, react-spring, scroll-reveal
- `authoring-motion@claude-design-skillstack` — Rive, Spline, Blender→web pipeline, Substance 3D
- `meta-skills@claude-design-skillstack` — modern web design, web3d integration patterns

Marketplaces: `claude-plugins-official`, `claude-design-skillstack`.

## Skills callable

Design/motion: the 22 skills from the plugins above, plus `frontend-design`, `dataviz`.
Engineering: `simplify`, `security-review`, `run`, `claude-api`, `init`.
Harness: `update-config`, `keybindings-help`, `fewer-permission-prompts`, `loop`.

## Subagents callable

- `Explore` — read-only broad fan-out search
- `Plan` — architecture/implementation planning
- `general-purpose` / `claude` — multi-step execution
- Domain specialists: Three.js/WebGL, R3F, Babylon, PlayCanvas, PixiJS, A-Frame/WebXR, GSAP,
  Motion/Framer, Anime.js, Lottie, react-spring, Rive, Spline, Blender pipeline, Substance 3D,
  modern-web-design, web3d-integration
- `claude-code-guide` — Claude Code / SDK / API questions

Contract §9 critic role → spawn a fresh-context subagent that receives only goal, rules, bar,
references, and the real artifact — never the builder's rationale.

## MCP servers

Both registered at **user scope** (`~/.claude.json`), so available in every project.

- `heroui-react` — `npx -y @heroui/react-mcp@latest`, package v1.1.0. Installed 2026-08-09 at the
  user's request. Verified working: JSON-RPC handshake returned `serverInfo` and 6 tools;
  `list_components` returned the live HeroUI **v3.0.5** catalog (70 components).
  - Tools: `list_components`, `get_component_docs`, `get_component_source_code`,
    `get_component_source_styles`, `get_docs`, `get_theme_variables`.
  - **Scope limit that matters:** v3 **beta only**. It does not document HeroUI v2, and v2→v3
    migration is unsupported. v3 requires **Tailwind CSS v4** (not v3), React 19+, uses compound
    components (`Card.Header`), needs no Provider, and is built on React Aria Components.
  - **When it beats the alternatives:** if the mission uses HeroUI v3, this is authoritative and
    current — better than model recall, which predates v3 beta. `get_component_source_code` and
    `get_theme_variables` give real source and tokens rather than plausible-looking guesses.
  - **When it does not:** it is a docs server for one React library. It contributes nothing to
    non-React work, 3D/WebGL/motion work, or design direction. A component library also imposes a
    recognizable house style, which cuts against contract §7's zero-detectable-AI-artifacts bar
    unless the theme is genuinely customized. Do not reach for it by default — only when the mission
    is a React UI and HeroUI v3 is the right substrate.
- `tt-servicenow` — Trading Technologies ServiceNow. Unrelated to Project X; will not be used here
  unless the mission calls for it.

## Orchestration

- Parallel subagent fan-out — available; used for independent research, builds, and critique rounds.
- Worktree isolation — available for parallel writes to the same files.
- `Workflow` multi-agent orchestration — available but **requires explicit user opt-in**. Not used
  unless the user asks (e.g. "use a workflow" / "ultracode").

## Network — and the one gotcha that matters

Shell egress **works**. `npm ping` → PONG. `curl https://registry.npmjs.org/` → 200.

**Gotcha:** some hosts fail with `curl: (35) schannel: … CRYPT_E_NO_REVOCATION_CHECK` and report
HTTP 000, which reads exactly like a blocked network. It isn't. Windows schannel cannot reach the
CA's certificate-revocation list and refuses an otherwise-valid certificate.

**Fix — use this on any HTTPS call from the shell:**

```sh
curl --ssl-no-revoke https://host/...
```

This skips the revocation *lookup*; the certificate chain still validates. Confirmed: workbench.md
went 000 → 200 with the flag, and `POST /new` then created the live HQ successfully.

Also note: shell commands run sandboxed by default and the sandbox blocks network. Pass
`dangerouslyDisableSandbox: true` for calls that genuinely need egress.

## Live Workbench (contract §11)

- HQ doc: `https://workbench.md/d/F0N2aMsE0N?key=4uTXfmxxLb3HXUR0KT3Pn` — anonymous, `edit` role.
- Append a chat line: `POST /api/docs/F0N2aMsE0N/chat/message?key=…` `{"text":"…","author":"director","fence":"hq"}`
- Flip status: `POST /api/docs/F0N2aMsE0N/status` `{"state":"building","note":"…"}`
- Replace body: `PUT /api/docs/F0N2aMsE0N/content` — send `If-Match` from the read's `ETag` to avoid
  clobbering concurrent edits.
- Poll for the user's replies: `GET /api/docs/F0N2aMsE0N/events?since=latest&wait=55`

Live components available for evidence: `board` (kanban), `status` (worklog + state badge), `sheet`
(editable table), `chart` (server-rendered SVG), `chat`, `embed`. Images and clips can be inlined in
chat messages — useful for posting visual evidence.

## Other harness limits

- `Workflow` orchestration requires explicit user opt-in — not used unless asked.
- Interactive git flags (`-i`) unavailable.

Update this file whenever a capability is added, removed, or proven not to work.
