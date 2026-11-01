# Team session navigation implementation plan

> Execute in the user's current ONE visible Pi Terminal. Astra plans; GPT6.1Terra is the single substantive product writer; Sol independently reviews. Root owns design, task ledger and acceptance evidence. The user explicitly forbids opening another interactive Pi for tests. After the user replaced the original windows and re-logged in, the installed stable0.2.1 Teams host continues the SAME stored task/conversation. Final UI adoption uses project-local package selection and `/reload` in this same idle Pi; no additional interactive test host. Earlier pinned0.3.0 execution and isolated runtime proofs remain historical evidence, not the current host.

**Goal:** Team → task session navigation with live status and return-to-team, keeping active execution alive across screen/session replacements.
**Architecture:** process-owned canonical-root controller registry; fresh UI bindings; persisted optional navigation index; SDK-created native root/task-view sessions; read-only canonical worker transcript viewer. No daemon or direct second writer on worker sessions.
**Stack:** TypeScript ESM, Node>=22.19, Pi1.4 supported source contract, existing Pi TUI/SessionManager public APIs. No new dependencies.
**Spec:** docs/design/2026-11-01-team-session-navigation.md

## Ownership and scope

- Frozen historical runtime source: /Users/oozoofrog/.codex/worktrees/codex-teams-handoff/codexteams at b675088 remains clean. Its original Pi was closed by the user. Current stable execution source is /Users/oozoofrog/.pi/agent/git/github.com/oozoofrog/codexteams at0.2.1, loaded in the user's existing plain Pi. Do not modify either source. The current store/task/conversation survived this safe idle-boundary host change; Root validated state compatibility and no active old lock before adopting.
- Product write root: /Users/oozoofrog/.codex/worktrees/teams-session-navigation/codexteams. Terra owns src/**, bin/**, tests/**, package/lock, README, docs/team-sessions.md. Root owns design/plan/progress/verification and external evidence.
- Retain0.3.0 behavior and160-test clean baseline. No global config/auth changes, unsupported service-tier arguments, model substitutions, agents, acceptance, commits, pushes or publishing by workers.
- Original actual profiles were planner openai-codex/gpt-6-astra high, developer/designer openai-codex/gpt-6.1-terra high and reviewer openai-codex/gpt-6.1-sol high. After user re-login to primary OpenAI ChatGPT-subscription OAuth, Root explicitly moved subsequent developer/reviewer calls to openai/gpt-6.1-terra high and openai/gpt-6.1-sol high. Exact human model/effort choices are preserved; retain original provider receipts and the legacy usage-limit failure. No API-key fallback or global authentication/configuration change by Root. Core test subprocesses remove inherited worker-only CODEXTEAMS_* variables; the live worker guard stays active.
- Root owns the reversible execution-only `.pi/settings.json` project override after all writers/reviewers stop: disable the personal git package's extensions in this project and select the local0.4 package, then use native `/reload` in the SAME Pi. Global package settings/install/auth remain untouched. Plain Pi is not the dedicated managed `-e` launcher; preserve its documented active cross-root guard. Do not forge managed-mode evidence. Required headless regression fixtures are distinct from opening another interactive Pi for acceptance.

## Task 1 — one coherent implementation milestone

- [x] Read the spec and owning controller/index/runner/store/validator/formatter paths plus Pi public session/context/UI APIs before code changes.
- [x] Write failing lifecycle regressions first: two genuinely separate extension instances, pending worker/check, shutdown(new/resume/fork) preservation, fresh same-root bindings, quit/reload all-owner cleanup, no stale ctx, locks and cross-root scope. Save RED logs under /tmp/codexteams-sessions-*.
- [x] Add a focused process registry module and a minimal controller observer/binding interface; UI/session lifecycle no longer owns execution lifetime. Retain exact model preflight without stale context and safely detach completion callbacks.
- [x] Add optional navigation metadata to types/shared JS validation with precise references and old-state compatibility. Add session catalog/read-only transcript modules and SDK root/child session creation. No arbitrary worker session writes.
- [x] Implement `/teams sessions`, task selection/open, `/teams home`, read-only view guards and native session replacement/withSession routing. Keep headless/empty/cancel nonmutating. Use bounded live/paged public records and dispose subscriptions.
- [x] Add launcher managed-mode proof/flag only as required for safe cross-project continuation; protect ordinary project-only extension users. Version package+lock to0.4.0 and update intentional version assertions.
- [x] Add missing unsafe-path/partial-line/Unicode/hidden-reasoning/marker/corrupt-metadata/stale-selection/parent existence/clone/read-only regressions. Test actual original file unchanged and no extra runner call.
- [x] Add real Pi local-fixture integration proving module replacement preserves running worker and native root/child/back path. Keep installed package/Node22.19 handoff query working without Pi peers.
- [x] Update README and docs/team-sessions.md. Run focused/typecheck/full required checks once final source is stable; repeat only after relevant new changes or failures. Do not stop after a tests-only or partial stage. Return exact files/checks/limitations and stop writing for Sol review.

## Task 2 — independent review and same-owner fixes

### Actual Pi lifecycle test route

Use real Pi RPC with temp project/agentDir and the local completions fixture pattern in tests/launcher-host.test.ts. Start `pi --mode rpc --approve --offline --no-extensions -e ABS/src/index.ts --session seededParentFile`. Create the parent with public SessionManager plus a truthful synthetic user checkpoint. Correlate JSONL RPC responses by exact request id. Send prompt `/teams run task-1`, hold the fixture HTTP response genuinely pending, then exercise actual `new_session`, `switch_session`, `get_fork_messages` and `fork` commands before releasing the response. Read the actual returned fork-entry field; do not guess it. Assert unchanged attempt/session/worker PID/lock, request count, final needs_review and no stale ctx. A separate gated shell check proves check continuation. End RPC stdin to exercise real runtime quit cleanup. Source: installed dist/modes/rpc/rpc-mode.js and examples/sdk/13-session-runtime.ts.

RPC can rebind twice and emit repeated session_start for the same instance; attachment is idempotent and event count is not module-identity proof. RPC hasUI is true but ui.custom is unsupported; use it for lifecycle proof and leave actual TUI interaction to the real Terminal verification. Do not replace these with manually invoked event callbacks and call that actual Pi integration.

### Verified native-view restoration route (Root advisory, no scope change)

Pinned Pi1.4.0 has no public lifecycle-to-command-context accessor. `session_start` receives ExtensionContext; do not cast it to ExtensionCommandContext or fabricate switching methods. Validate the view/epoch, schedule the TUI restoration after lifecycle rebinding returns, deduplicate it and clean observers before leaving. The user's actual Esc can route the existing exact registered command through public `pi.sendUserMessage("/teams home", { expandPromptTemplates: true })`: installed agent-session.js:1636 dispatches extension commands before input/model handling and returns when handled; sendUserMessage at1910 defaults this flag to false, which would be wrong. Confirm the active same-view epoch and registered command immediately before this command-only bridge; never send free-form fallback text. The real command handler then receives a fresh supported context and performs switching. This is truthful dispatch of the user's navigation action, not fabricated assistant/model history. docs/extensions.md:329 warns against awaiting command-only replacement from lifecycle handlers; agent-session-runtime.js:120 defines rebind/withSession ordering. Native advisor and Root independently read those exact owning sources. Actual inference-count and native resume/startup tests remain required.

- [x] Sol reads current source and genuine current evidence, reviews lifecycle/ownership/metadata/readonly claims and identifies only concrete remaining defects.
- [x] Root verifies findings and gives exact same-task Terra rework when required. Retain previous FAILs and source/model receipts. Sol rechecks changed evidence.

## Task 3 — actual acceptance verification

- [x] Root verifies the final suite, actual SDK/Pi replacement integration, package/Node22 compatibility and controller checks at the unchanged final product revision.
- [x] Actual Terminal0.4.0 demonstration completed in two explicit evidence scopes: earlier held local worker → view/native resume/connected B/home retained exact worker identity and later completed; after the user required one Pi, the SAME PID31653 used local reload and a real pending controller check → task view → home → later4/4 completion with unchanged check PID/lock/original transcript. Current source pending-worker replacement and all-root cleanup also have genuine final RPC/SDK evidence. The current user Pi stays open; earlier fixture quit proof remains separate. No automatic restart/accept.
- [x] Record requested vs returned actual Astra/Terra/Sol names, stable runtime hashes, live observation and limits in docs/progress.md and docs/verification.md. Keep terminal on verified new UI. No external publication.
