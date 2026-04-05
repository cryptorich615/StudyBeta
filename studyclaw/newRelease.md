# OpenClaw Release Review for StudyClaw

## 1. Executive Summary
- The latest shipped stable OpenClaw release is `v2026.4.2`, published on **2026-04-02**; it introduces restored core **Task Flow**, Android **Google Assistant App Actions** entry points, a new plugin hook named `before_agent_reply`, and several transport/runtime hardening fixes. [O1][O2]
- The two explicit stable migration items in `2026.4.2` are **`x_search` config moving to the xAI plugin config path** and **Firecrawl `web_fetch` config moving to the Firecrawl plugin config path**; both are intended to be migrated with `openclaw doctor --fix`. [O1][O2]
- `2026.4.2` also changes host-exec behavior in a way StudyClaw should treat as high-risk for a student-facing deployment: **gateway/node host exec defaults to `security=full` with `ask=off`** unless you tighten policy explicitly. [O1][O2]
- StudyClaw already uses OpenClaw as both a **gateway runtime** and a **CLI-managed per-student agent layer**, not just a chat transport; the repo provisions isolated student agents, syncs custom skills, and exposes OpenClaw operational controls through the API. [R1][R2][R3]
- StudyClaw’s checked-in OpenClaw snapshot is **older than the current stable release**: the bundled `openclaw-home/openclaw.json` was last touched at `2026.3.13`, while the latest stable release is `2026.4.2`. That means config drift review is warranted even if the live machine was already updated. [R4][O1]
- The repo already contains meaningful student-specific OpenClaw extensions: a custom **Open Library** plugin, a **study-library** skill, a **grade-tracker** skill, and a **class-scheduler** skill that are copied into student workspaces during provisioning. [R1][R5][R6][R7]
- The highest-value near-term OpenClaw product leverage for StudyClaw is not “more chat”; it is **durable background school workflows**: Task Flow-based study plans, exam-prep orchestration, due-date follow-through, and proactive wrong-answer remediation. [O1][O2][O3]
- The second major leverage area is **safer boundaries**: review exec defaults, DM/channel policies, Control UI exposure, token placement, and future allowlist/approval policy before expanding student-facing automation. [O1][O5][O6][R4]
- The best “adopt now” capabilities are: **Task Flow**, **plugin hooks (`before_agent_reply`)**, **ClawHub-backed skill distribution**, **browser profile improvements**, and **model/auth failover cleanup**. [O1][O2][O3][O4]
- The biggest things that could break or drift in StudyClaw after updating are **plugin-owned config paths**, **security assumptions around host exec**, **skills inheritance semantics in upcoming unreleased work**, and any runtime that still assumes older gateway/channel behavior. [O1][O2][O7]

## 2. My Repo’s Current OpenClaw Usage
- StudyClaw treats OpenClaw as both a **gateway** and an **agent-management runtime**. The API posts to `OPENCLAW_BASE_URL/v1/responses` with `OPENCLAW_GATEWAY_TOKEN`, while also shelling out to the `openclaw` CLI for agent, cron, skill, and pairing-adjacent operational tasks. [R2][R3][R8]
- StudyClaw provisions **one isolated OpenClaw agent per student** and stores student workspaces under the OpenClaw home, then writes `USER.md`, `IDENTITY.md`, `BOOTSTRAP.md`, and core traits files into each workspace. [R1]
- During provisioning, StudyClaw explicitly installs or syncs **`openclaw-agent-browser`**, **`study-library`**, **`grade-tracker`**, and **`class-scheduler`** into student workspaces, and it also expands the student agent allowlist to include the browser tool plus the custom Open Library tools. [R1][R5][R6][R7]
- The repo contains a bundled OpenClaw home snapshot at [`/home/ubuntu/StudyBeta/openclaw-home/openclaw.json`](/home/ubuntu/StudyBeta/openclaw-home/openclaw.json). That snapshot shows Telegram enabled, gateway token auth enabled, plugin entries for `openlibrary-student-tools` and `telegram`, and internal hooks including `session-memory`. [R4]
- StudyClaw’s README states that OpenClaw is assumed to be preinstalled, reachable by the API, and used in **gateway mode** plus **CLI-based local agent management**. It also documents the Open Library student library feature as an OpenClaw plugin + skill integration. [R8]
- StudyClaw already exposes OpenClaw-aware student features in the repo: textbook/research lookup via the Open Library integration, browser-backed research paths, grade tracking, class scheduling, reminders/tasks, and per-student agent workspaces. Evidence is present in the README, the synced skills, and the provisioning code. [R1][R5][R6][R7][R8]
- The repo snapshot still records `meta.lastTouchedVersion: 2026.3.13`, so the checked-in OpenClaw config is behind the latest stable release and should not be assumed to reflect current runtime defaults after update/doctor. [R4][O1]
- The checked-in snapshot currently uses `gateway.bind: "lan"` and a permissive `controlUi.allowedOrigins` list that includes `"*"`. That is functional, but it should be reviewed against current OpenClaw remote-access and browser-security guidance before expanding browser or Control UI exposure. [R4][O5][O6]
- I did **not** find an explicit `lossless-claw` string in the checked-in `studyclaw` app code or bundled `openclaw-home` snapshot during this repo inspection; the repo-visible continuity layer is instead expressed through `chat_threads.openclaw_session_id`, the OpenClaw gateway client, and the internal `session-memory` hook in the bundled config. If Lossless Claw is active, it likely lives in the installed OpenClaw/plugin state outside the StudyClaw source tree rather than in a checked-in StudyClaw config file. [R2][R4][R9]

### Gaps / assumptions / unknowns
- I could verify the StudyClaw-side integration points and the bundled OpenClaw snapshot, but I cannot prove from the repo alone which plugins or channels are enabled on the **live** machine after recent `openclaw update` and `openclaw doctor --fix` runs; those can legitimately differ from the checked-in `openclaw-home` snapshot. [R4][O3]
- I also cannot verify from the repo alone whether StudyClaw currently depends on any **uncommitted** local OpenClaw config changes outside `openclaw-home`, so the migration checklist below treats the live `~/.openclaw/openclaw.json` as the source of truth to inspect. [R4][O3]

## 3. Latest Stable OpenClaw Release
- **Version:** `v2026.4.2` [O1]
- **Release date:** `2026-04-02 18:30` (GitHub release timestamp) [O1]
- **High-level summary:** `2026.4.2` restores **core Task Flow** as a durable orchestration substrate, adds **Android assistant/App Actions** entry points, introduces the `before_agent_reply` hook for plugin short-circuiting, tightens provider/request transport policy, and ships two explicit plugin-config migrations for `x_search` and Firecrawl-backed `web_fetch`. [O1][O2]
- **Why it matters for StudyClaw:** StudyClaw already has reminders, schedule, grades, wrong-answer review, Open Library, browser research, and custom student skills. `2026.4.2` is the first release in this cycle that clearly improves the infrastructure for **durable school workflows**, **agent-side intervention hooks**, and **mobile assistant entry points** without requiring a ground-up re-architecture. [R1][R5][R6][R7][R8][O1][O2]

## 4. Breaking Changes / Migrations I Need to Know
| Change | Impact on StudyClaw | Action required | Urgency |
|---|---|---|---|
| `x_search` config moved from `tools.web.x_search.*` to `plugins.entries.xai.config.xSearch.*`, with auth standardized under `plugins.entries.xai.config.webSearch.apiKey` / `XAI_API_KEY`. [O1][O2] | Any StudyClaw OpenClaw runtime that still relies on legacy core `x_search` paths may silently drift or fail after update. This matters if you use xAI-backed web search in admin or research workflows. [O1][O2] | Run `openclaw doctor --fix`, then inspect the effective live config for migrated xAI plugin settings. [O1][O3][O4] | **High** |
| Firecrawl `web_fetch` config moved from `tools.web.fetch.firecrawl.*` to `plugins.entries.firecrawl.config.webFetch.*`. [O1][O2] | If StudyClaw uses Firecrawl-backed fetch behavior anywhere in OpenClaw runtime paths, old config paths are no longer the right source of truth. [O1][O2] | Run `openclaw doctor --fix`, then inspect `plugins.entries.firecrawl.config.webFetch.*` and validate fetch behavior. [O1][O3][O4] | **High** |
| Gateway/node host exec now defaults to `security=full` with `ask=off`. [O1][O2] | For a student-facing product, that is a meaningful policy change even if it is not labeled “breaking”; it reduces friction for host exec but also raises the cost of a too-broad tool surface. [O1][O2][O4] | Re-audit exec approvals, tool profiles, and any agent/tool policies before broadening student automation or remote browser control. Use `openclaw security audit`, `openclaw approvals get`, and config review. [O4][O9] | **High** |
| `openclaw update` now explicitly treats update as a “safe-ish” infra workflow: clean worktree, build, Control UI build, doctor, plugin sync, and restart by default. [O3][O4] | StudyClaw operators need to treat OpenClaw upgrades like an infra rollout, not a blind package bump. That matters because StudyClaw depends on gateway uptime plus CLI-managed agents. [R2][R3][R8][O3][O4] | Adopt an explicit post-update verification routine: `openclaw doctor`, `openclaw gateway status`, `openclaw health`, then StudyClaw smoke tests. [O3][O4] | **Medium** |
| The repo snapshot is behind current stable (`2026.3.13` vs `2026.4.2`). [R4][O1] | Even if the live machine is updated, the checked-in snapshot may mislead future operators or CI-like bootstraps. [R4][O1] | Review the live config separately from the bundled snapshot before planning additional StudyClaw work. [R4][O3] | **Medium** |

## 5. Major New Capabilities in the Latest Update

### Orchestration and automation
- **Core Task Flow is back** with durable flow state/revision tracking, managed-vs-mirrored sync modes, child-task spawning, and inspection/recovery primitives through the CLI. This is the single highest-value change for StudyClaw’s school workflow ambitions. [O1][O2][O4]
- OpenClaw also adds a **bound `api.runtime.taskFlow` seam** for plugins and trusted authoring layers, which makes it easier to drive durable workflows from plugins without manually re-plumbing owner identity each time. [O1][O2]

### Agent and plugin control
- `2026.4.2` adds **`before_agent_reply`**, a plugin hook that can short-circuit the LLM with synthetic replies after inline actions. That is a direct fit for deterministic school workflows such as schedule lookup, grade summary replies, or “what class is next?” responses when the answer already exists in StudyClaw data. [O1][O2]
- The release also improves **compaction controls** by making `agents.defaults.compaction.model` resolution consistent and by adding `agents.defaults.compaction.notifyUser` to suppress or enable compaction notices deliberately. [O1]

### Mobile and assistant entry points
- Android gained **assistant-role entry points and Google Assistant App Actions metadata**, which makes OpenClaw easier to invoke from Android assistant surfaces and hand prompts into the chat composer. [O1][O2]

### Runtime hardening
- The release centralizes **provider transport/auth/proxy/TLS handling** across HTTP, websocket, and media paths, and hardens routing for OpenAI-compatible, Anthropic, Copilot, and media provider requests. That matters because StudyClaw already relies on mixed provider/model routing and gateway calls. [R2][R8][O1]
- It also fixes several **gateway/session/approval** issues, including loopback exec role fallback, subagent operator scoping, malformed exec approvals normalization, and browser/CDP edge cases. These reduce operational flakiness in an app like StudyClaw that already provisions many per-user agents and is using browser-related capabilities. [R1][O1]

## 6. Important Unreleased Changes to Watch
This section is **not shipped yet**. These items come from the **Unreleased** section at the top of the official changelog and should be treated as “watchlist” items, not current behavior. [O2]

- **Per-channel `contextVisibility` controls** (`all`, `allowlist`, `allowlist_quote`) would let you restrict how much supplemental quote/thread/fetched-history context enters model prompts on a per-channel basis. For StudyClaw, that could become a useful parent/teacher/admin boundary control if you ever expose messaging channels beyond the web app. [O2]
- **ClawHub search/detail/install directly inside the Control UI Skills panel** is listed as an unreleased change. StudyClaw already maintains custom student skills, so a first-party UI path for discovery/install would reduce operator friction if/when you standardize those skills for broader distribution. [R1][O2]
- **Provider transport overrides at `models.providers.*.request`** are expanding further in unreleased work. That is relevant because StudyClaw already depends on mixed providers and custom model defaults/fallbacks, and transport overrides are exactly the kind of surface that can drift or cause “works locally, fails in prod” behavior. [R4][O2]
- **Per-agent `agents.list[].skills` replacing defaults instead of merging** is currently in Unreleased. StudyClaw already writes explicit per-agent skill arrays in provisioning code, so this future semantic change should be reviewed carefully before relying on `agents.defaults.skills` for shared student skill policy. [R1][O2]
- Additional **browser/plugin seam splitting** and **runtime seam narrowing** in Unreleased are mostly internal, but they are still worth watching because StudyClaw already relies on custom plugins, browser tooling, and automation-heavy hot paths. [R1][O2]

## 7. Current OpenClaw Feature Inventory

### Core platform / gateway
- OpenClaw’s core platform is the **Gateway**: a single control plane for sessions, channels, tools, events, Control UI, Canvas host, and WebChat. It is paired with a large CLI surface covering gateway ops, agents, tasks, cron, browser, nodes, memory, plugins, skills, approvals, secrets, and diagnostics. [O8][O4]
- Remote access is officially supported through **Tailscale Serve/Funnel** or **SSH tunnels**, with token/password auth on the gateway. [O8][O5]

### Agents / sessions / routing / subagents
- OpenClaw supports **multi-agent routing**, isolated per-agent workspaces, per-agent sessions, session pruning/compaction, presence, and subagents. The CLI exposes `agents`, `sessions`, `tasks`, and subagent-relevant tooling like `sessions_spawn`/`agents_list`. [O8][O4][O2]

### Skills / ClawHub / slash commands
- OpenClaw has a formal **skills platform** with bundled, managed, and workspace skills plus install/update/check flows. The CLI exposes `skills list|info|check`, and the docs/README explicitly position skills as an onboarding-era first-class primitive. [O8][O4]
- Chat supports **slash commands** such as `/status`, `/config`, and `/debug`, and the unreleased roadmap specifically calls out deeper **ClawHub** integration in the Skills panel. [O4][O2]

### Tools
- OpenClaw documents first-class tools for **browser**, **canvas**, **nodes**, **cron**, **sessions**, and chat-channel actions; the CLI reference also shows extensive browser controls (`tabs`, `open`, `navigate`, `snapshot`, `click`, `type`, `upload`, `pdf`, etc.). [O8][O4][O6]
- Browser support includes **openclaw-managed Chromium profiles**, **remote CDP profiles**, and a **Chrome extension relay**, with loopback-oriented security guidance and profile isolation. [O6]

### Automation
- OpenClaw supports **cron jobs**, **webhooks**, **Gmail Pub/Sub**, and now **Task Flow** for durable background orchestration with inspection and recovery primitives. [O8][O1][O4]
- The CLI includes `cron` commands, `tasks list|show|notify|cancel`, and `tasks flow list|show|cancel`. [O4]

### Channels and messaging surfaces
- OpenClaw officially documents messaging surfaces across **Telegram, WhatsApp, Slack, Discord, Google Chat, Signal, BlueBubbles/iMessage, IRC, Microsoft Teams, Matrix, Feishu, LINE, Mattermost, Nextcloud Talk, Nostr, Synology Chat, Tlon, Twitch, Zalo, Zalo Personal, WeChat, and WebChat**. [O8]
- It also documents **DM pairing**, allowlists, group routing, mention gating, and channel-specific routing/streaming behavior. [O8]

### Mobile / companion apps / nodes
- OpenClaw ships a **macOS companion app**, **iOS node**, and **Android node**, with remote gateway control, chat sessions, voice features, camera/screen recording, and device commands on Android. [O8]

### Voice / talk / wake / canvas
- The official feature set includes **Voice Wake**, **Talk Mode**, and a **Live Canvas** with **A2UI**. README and docs position these as first-class platform surfaces rather than experiments. [O8]

### Models / providers / failover
- OpenClaw documents **models**, **auth profile rotation**, and **fallbacks**; the CLI supports `models list|status|set`, aliases, fallbacks, auth ordering, and provider onboarding. [O8][O4]
- The latest stable release continues to harden provider routing, auth, proxy, TLS, and transport shaping across shared runtime paths. [O1]

### Security / approvals / allowlists / pairing
- OpenClaw’s documented security model includes **DM pairing**, **channel allowlists**, **approval policies**, **security audit**, **secrets audit/configure/apply**, and strict browser guidance around loopback/private-network exposure. [O8][O4][O6]
- The CLI exposes `approvals get|set|allowlist add|remove`, `security audit`, and `secrets audit|configure|apply|reload`. [O4]

### Diagnostics / doctor / update / status
- OpenClaw officially supports `openclaw doctor`, `openclaw update`, `openclaw gateway status`, `openclaw health`, `openclaw status`, `openclaw logs`, and plugin/skills diagnostic commands. The update flow itself is documented as a build/doctor/restart path, not just a version bump. [O3][O4]

## 8. How StudyClaw Can Use These Features

| Opportunity | OpenClaw capability | Student benefit | Complexity | Priority | Work area | Risks / prerequisites |
|---|---|---|---|---|---|---|
| Durable weekly study-plan engine | Task Flow + cron + task inspection/recovery. [O1][O4] | Lets StudyClaw turn “weekly plan” from a static dashboard section into a recoverable workflow that can survive restarts, reschedule around due dates, and surface stateful progress. [O1][O4] | Medium | **Now** | Backend + workflow + agent | Needs a clear Task Flow ownership model and idempotent sync with existing reminders/schedule data. |
| Deterministic schedule answers | `before_agent_reply` hook plus StudyClaw’s existing schedule data/skill. [O1][R1][R7] | “What class do I have now?” and “What room is Algebra in?” can become instant, grounded answers instead of generic LLM replies. [O1][R7] | Low | **Now** | Agent + backend | Must scope replies strictly to authenticated student data and avoid over-assuming when schedule data is missing. |
| Deterministic grade/target-grade answers | `before_agent_reply` hook plus StudyClaw’s existing grade tracker skill/data. [O1][R1][R6] | Students get exact estimated grades, target-final math, and cleaner wrong-answer follow-up without hallucinated policy assumptions. [O1][R6] | Low | **Now** | Agent + backend | Requires clear “estimated, not official” wording and well-tested weighting logic. |
| Research workflows that end in study assets | Browser tool + profiles + Open Library skill/plugin + Task Flow. [O6][R1][R5][R8] | Student can search textbooks, capture sources, then automatically turn results into notes, flashcards, quizzes, or reading plans. [O6][R5][R8] | Medium | **Soon** | Agent + backend + frontend | Browser exposure and policy boundaries should be reviewed before broad rollout. |
| Voice-first study help | Android assistant entry points, Talk Mode, Voice Wake, mobile nodes. [O1][O8] | Enables “hands free” homework help, class transitions, and quick study-plan check-ins from mobile. [O1][O8] | Medium | **Soon** | Frontend/mobile + agent | Requires mobile UX work and careful privacy boundaries around voice context. |
| Safer student browser and tool policies | Browser security guidance, approvals/allowlists, security audit, secrets audit. [O4][O6][O8] | Makes Browser Access, research automation, and future tool expansion safer for students, parents, and admins. [O4][O6] | Medium | **Now** | Infra + policy | The current repo snapshot’s LAN bind / permissive Control UI origin settings should be reviewed first. [R4] |
| Productized StudyClaw skills marketplace path | Skills platform + ClawHub search/install direction. [O8][O2] | Lets StudyClaw ship reusable school-specific skills cleanly (library lookup, grade tracker, class scheduler, wrong-answer tutor) instead of copying raw markdown into each workspace forever. [R1][R5][R6][R7][O8][O2] | Medium | **Soon** | Plugin + workflow + ops | Unreleased ClawHub-in-UI work is not shipped yet, so near-term flow may still be CLI-driven. [O2] |
| Better long-term study memory | OpenClaw memory indexing/search plus existing StudyClaw durable student memory layer. [O4][R9] | Improves continuity across semesters, not just across one chat session. Students benefit from persistent weak-area recall and stronger context reuse. [O4][R9] | Medium | **Soon** | Backend + memory + agent | The repo snapshot shows `session-memory`, but explicit long-term memory plugin configuration should be reviewed separately. [R4] |
| Parent/teacher/admin-safe boundaries | Channel DM pairing, allowlists, context-visibility watchlist, approvals, security audit. [O8][O2][O4] | Important if StudyClaw ever exposes OpenClaw beyond the web app or adds teacher/admin messaging surfaces. [O8][O2] | Medium | **Later** | Infra + policy | The most relevant per-channel context controls are currently unreleased. [O2] |
| Cost-aware model routing for students | Models auth order, fallbacks, aliases, provider/runtime routing hardening. [O8][O4][O1] | Lets StudyClaw reserve expensive models for high-value tasks and use cheaper/faster ones for routine operations. [O8][O1] | Low-Medium | **Now** | Backend + infra | Needs explicit policy on which StudyClaw flows are “premium” versus “routine.” |

## 9. Recommended Enhancements for StudyClaw

### 1. Use `before_agent_reply` to short-circuit deterministic student data queries
- **Benefit:** cleaner answers for schedule, grade, target-final, and “what’s next” questions, with fewer hallucinations. [O1][R6][R7]
- **OpenClaw dependency:** `before_agent_reply` hook. [O1]
- **Complexity:** Low
- **Priority:** **Now**
- **Notes:** This is the highest-leverage “quality” improvement because StudyClaw already has the data; it mostly needs a faster decision path. [R6][R7]

### 2. Move weekly plan / exam prep / reminder follow-through onto Task Flow
- **Benefit:** durable orchestration, retry/recovery, and visible workflow state for study planning. [O1][O4]
- **OpenClaw dependency:** Task Flow substrate and `openclaw tasks flow`. [O1][O4]
- **Complexity:** Medium
- **Priority:** **Now**
- **Notes:** This is the strongest differentiation opportunity because it turns StudyClaw from a helpful interface into a persistent academic workflow system. [O1]

### 3. Package StudyClaw’s custom skills and plugin surface more intentionally
- **Benefit:** cleaner rollout, better operator ergonomics, easier per-user provisioning, and a future path to share or version your school-specific skills. [O8][O2][R1][R5][R6][R7]
- **OpenClaw dependency:** skills platform, plugin system, emerging ClawHub UX. [O8][O2][O4]
- **Complexity:** Medium
- **Priority:** **Soon**
- **Notes:** Right now StudyClaw copies custom `SKILL.md` files into workspaces; that works, but it is operationally heavier than a stronger packaged skill/plugin lifecycle. [R1]

### 4. Strengthen Browser Access around managed profiles and policy seams
- **Benefit:** better research continuity, per-student browser isolation, and a clean path to later allowlists/blocklists/teacher controls. [O6]
- **OpenClaw dependency:** browser profiles, loopback/private-network guidance, possibly remote CDP or openclaw-managed profile routing. [O6]
- **Complexity:** Medium
- **Priority:** **Soon**
- **Notes:** StudyClaw has already started down this path; the next step is policy and lifecycle, not a new browser UI. [R1][R8]

### 5. Add Android/mobile voice entry points for lightweight study support
- **Benefit:** low-friction homework help, calendar/schedule queries on the go, and easier daily habit formation. [O1][O8]
- **OpenClaw dependency:** Android App Actions, Talk Mode, Voice Wake, nodes. [O1][O8]
- **Complexity:** Medium-High
- **Priority:** **Later**
- **Notes:** Valuable, but should follow core workflow hardening and safer policy boundaries. [O1][O8]

### 6. Formalize security boundaries before exposing more automation
- **Benefit:** lower risk when you add browser restrictions, teacher/admin controls, or more tool access. [O4][O6][O8]
- **OpenClaw dependency:** approvals, allowlists, secrets audit, security audit, DM pairing. [O4][O8]
- **Complexity:** Medium
- **Priority:** **Now**
- **Notes:** The current repo snapshot’s `bind: "lan"` plus wildcard Control UI origin allowance is exactly the sort of config that should be re-checked after every upgrade. [R4][O5][O6]

## 10. Recommended Migration / Upgrade Checklist
1. **Snapshot live OpenClaw state before assuming the repo snapshot is authoritative.** Review the live `~/.openclaw/openclaw.json`, `~/.openclaw/credentials/`, and `~/.openclaw/workspace/` as the actual operator state. [O3][R4]
2. **Run the official update verification path** after any change: `openclaw update --dry-run` if needed, `openclaw doctor --fix`, `openclaw gateway status`, and `openclaw health`. [O3][O4]
3. **Inspect xAI search config** and migrate any lingering `tools.web.x_search.*` assumptions to `plugins.entries.xai.config.xSearch.*` / `plugins.entries.xai.config.webSearch.apiKey`. [O1][O2]
4. **Inspect Firecrawl fetch config** and migrate any lingering `tools.web.fetch.firecrawl.*` assumptions to `plugins.entries.firecrawl.config.webFetch.*`. [O1][O2]
5. **Re-audit exec policy intentionally.** `2026.4.2` changes host exec defaults; verify that student-facing agents do not inherit a broader host-exec surface than you intend. [O1][O2][O4]
6. **Review gateway exposure.** Compare your live config to current docs for loopback/private-network guidance, especially if you continue to expose Control UI, browser tooling, or mobile nodes remotely. [O5][O6][R4]
7. **Review channel security policy.** If Telegram or other channels remain enabled, verify DM pairing, allowlists, and any group policies. [O8][R4]
8. **Review StudyClaw provisioning assumptions.** Because StudyClaw writes explicit per-agent skills and tool allowlists, test provisioning against the current OpenClaw runtime after update and keep an eye on unreleased skills-inheritance semantics. [R1][O2]
9. **Verify browser and research flows end-to-end** after update, because `2026.4.2` and Unreleased both touch browser/plugin seams and SSRF protections. [O1][O2][O6]
10. **Treat the bundled `openclaw-home` directory as a review artifact, not the source of truth.** If you keep it in-repo, either document its purpose clearly or periodically refresh it so operators are not comparing live runtime to an outdated snapshot. [R4][O1]

## 11. Commands, Config Paths, and Validation Checks

### Useful commands
- `openclaw --version` — confirm the installed runtime version. The CLI reference documents `-V/--version/-v`. [O4]
- `openclaw update --dry-run` — preview update actions without writing config or restarting. [O3]
- `openclaw update` — official safe update flow for source installs or package-manager-backed installs. [O3][O4]
- `openclaw doctor --fix` — official repair/migration pass, including the documented migration path for the stable breaking config moves. [O1][O3][O4]
- `openclaw gateway status` and `openclaw health` — validate gateway/service health after update. [O3][O4]
- `openclaw plugins list`, `openclaw plugins inspect <id>`, `openclaw plugins doctor` — inspect plugin state and errors. [O4]
- `openclaw skills list` and `openclaw skills check` — inspect installed skill state. [O4]
- `openclaw tasks list`, `openclaw tasks flow list`, `openclaw tasks flow show <id>`, `openclaw tasks cancel <id>` — inspect and operate durable background work. [O1][O4]
- `openclaw cron list` / `openclaw cron runs` — inspect cron-backed automation. [O4]
- `openclaw memory status` / `openclaw memory search "<query>"` — inspect memory indexing/search. [O4]
- `openclaw security audit --deep` and `openclaw secrets audit` — review configuration and secret-surface hygiene. [O4]

### Config paths worth checking
- **Live OpenClaw config:** `~/.openclaw/openclaw.json` [O3]
- **Live credentials directory:** `~/.openclaw/credentials/` [O3]
- **Live workspace root:** `~/.openclaw/workspace/` [O3]
- **StudyClaw bundled OpenClaw snapshot:** [`/home/ubuntu/StudyBeta/openclaw-home/openclaw.json`](/home/ubuntu/StudyBeta/openclaw-home/openclaw.json) [R4]
- **StudyClaw per-user provisioning:** [`/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/user-agent.ts`](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/user-agent.ts) [R1]
- **StudyClaw gateway client:** [`/home/ubuntu/StudyBeta/studyclaw/apps/api/src/integrations/openclaw/openclaw.client.ts`](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/integrations/openclaw/openclaw.client.ts) [R2]
- **StudyClaw OpenClaw operator control paths:** [`/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/openclaw-control.ts`](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/openclaw-control.ts) [R3]

### Validation checks I would run after any OpenClaw upgrade
- Confirm the gateway is reachable and authenticated with the StudyClaw API’s `OPENCLAW_BASE_URL` / `OPENCLAW_GATEWAY_TOKEN` settings. [R2][R8]
- Provision a test student agent and confirm the expected custom skills are copied or available in the workspace. [R1]
- Send a test study chat request through StudyClaw and verify the gateway response path still returns the expected text/session behavior. [R2][R8]
- Verify one browser-backed research flow, one Open Library lookup flow, one grade/schedule deterministic query, and one background reminder/cron-like flow. Those are the parts of StudyClaw most likely to benefit from or regress under current OpenClaw changes. [R1][R3][R5][R6][R7][O1][O6]

## 12. Suggested Roadmap

### Now
- **Upgrade hygiene first:** normalize live config, run doctor, review migrated plugin config paths, and re-audit exec/security posture. [O1][O3][O4]
- **Adopt `before_agent_reply`** for deterministic replies over StudyClaw’s existing schedule and grade data. [O1][R6][R7]
- **Adopt Task Flow** for one concrete workflow: weekly study plans or exam-prep countdown orchestration. [O1][O4]

### Soon
- **Package StudyClaw skills/plugins more cleanly** so custom capabilities are easier to install, update, and reason about at scale. [O8][O2][R1]
- **Improve browser-backed school workflows** using managed browser profiles, clearer policy seams, and stronger session lifecycle around research and eReader-style flows. [O6][R1]
- **Tighten memory strategy** by aligning StudyClaw’s durable student memory with OpenClaw memory indexing/search where that adds value instead of duplicating concerns. [O4][R9]

### Later
- **Mobile/voice expansion:** Android assistant entry points, Voice Wake, Talk Mode, and mobile study check-ins. [O1][O8]
- **Teacher/admin-safe boundaries:** channel-specific visibility controls if/when the unreleased `contextVisibility` work ships. [O2]
- **Full skills distribution / ClawHub story:** publish or internally standardize StudyClaw’s school-specific skills once the surrounding operator UX is more mature. [O2][O8]

## 13. Sources

### Official OpenClaw sources
- [O1]: https://github.com/openclaw/openclaw/releases/tag/v2026.4.2
- [O2]: https://raw.githubusercontent.com/openclaw/openclaw/main/CHANGELOG.md
- [O3]: https://docs.openclaw.ai/install/updating
- [O4]: https://docs.openclaw.ai/cli
- [O5]: https://docs.openclaw.ai/gateway/remote
- [O6]: https://docs.openclaw.ai/tools/browser
- [O7]: https://raw.githubusercontent.com/openclaw/openclaw/main/CHANGELOG.md#unreleased
- [O8]: https://raw.githubusercontent.com/openclaw/openclaw/main/README.md
- [O9]: https://docs.openclaw.ai/gateway/security

### Repo-specific evidence used for the StudyClaw mapping
- [R1]: [/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/user-agent.ts](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/user-agent.ts)
- [R2]: [/home/ubuntu/StudyBeta/studyclaw/apps/api/src/integrations/openclaw/openclaw.client.ts](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/integrations/openclaw/openclaw.client.ts)
- [R3]: [/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/openclaw-control.ts](/home/ubuntu/StudyBeta/studyclaw/apps/api/src/lib/openclaw-control.ts)
- [R4]: [/home/ubuntu/StudyBeta/openclaw-home/openclaw.json](/home/ubuntu/StudyBeta/openclaw-home/openclaw.json)
- [R5]: [/home/ubuntu/StudyBeta/openclaw-home/skills/study-library/SKILL.md](/home/ubuntu/StudyBeta/openclaw-home/skills/study-library/SKILL.md)
- [R6]: [/home/ubuntu/StudyBeta/openclaw-home/skills/grade-tracker/SKILL.md](/home/ubuntu/StudyBeta/openclaw-home/skills/grade-tracker/SKILL.md)
- [R7]: [/home/ubuntu/StudyBeta/openclaw-home/skills/class-scheduler/SKILL.md](/home/ubuntu/StudyBeta/openclaw-home/skills/class-scheduler/SKILL.md)
- [R8]: [/home/ubuntu/StudyBeta/studyclaw/README.md](/home/ubuntu/StudyBeta/studyclaw/README.md)
- [R9]: [/home/ubuntu/StudyBeta/studyclaw/schema.sql](/home/ubuntu/StudyBeta/studyclaw/schema.sql)
