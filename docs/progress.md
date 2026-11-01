# Implementation ledger — docs/plans/2026-11-01-pi-extension.md

- 2026-11-01: User authorized detailed design and implementation start for a pure Pi extension.
- Environment: Linux workspace; no tool can access the requested eyedisk/develop Mac path. Build source here and deliver a non-destructive Mac installer.
- Public npm registry confirmed @earendil-works/pi-coding-agent 1.4.0. No live model call made.
- Ruling: Implement v0.1 sequential writers and explicit user acceptance; parallel worktree integration and automatic acceptance are later milestones. This keeps the initial product truthful about verification and avoids shared-file races.
- Pre-flight: planner -> controller passes validated PlannedTask; store owns ProjectState; runner returns WorkerResult; UI never mutates state directly.
- Design review: accepted four findings — orphan-aware unclean recovery gate, exclusive/cancellable checks, revise needs_review via resume, attempt-bound verification and acceptance evidence. No background daemon added.
- Task 1 RED: node --test tests/planning.test.ts tests/store.test.ts failed because both feature modules were not implemented.
- Task 1 GREEN: 9 named planner/profile/store cases passed with --test-isolation=none; real Pi dependency type check passed.
- Task 3 RED: controller/check-runner tests failed for missing modules before implementations.
- Ruling: use Node test isolation=none so actual named cases are visible in this managed runtime. Production workers still run in separate processes.
- Task 3 GREEN: 9 controller/check tests passed; checks use real /bin/sh subprocesses and cancellation.
- Task 4 RED: extension tests failed before src/index.ts and UI formatter existed.
- Task 4 GREEN: real Pi 1.4.0 loader registered teams and codexteams_status with zero errors; 4 host adapter tests and non-overwriting installer test passed.
- Whole-branch review found ordinary Pi bash background descendants outside the worker group, check close-vs-exit hanging, incomplete nested state validation and acceptance while crash recovery is pending.
- Final regression RED: five named root tests reproduced check pipe hanging, recovery acceptance bypass, masked persistence failure, missing live usage subtotal and malformed nested state acceptance.
- Root fix pass GREEN: exit-triggered check cleanup, recovery-gated accept, preserved persistence failure, live partial usage and nested state validation passed 20 focused tests. Separate unfinished-attempt recovery test reproduced outer-status mismatch before correction.
- Review scope rulings: live model entitlement/billing, actual Mac installation/TUI, Windows/escaped process containment and roadmap parallel/automatic acceptance remain unverified or deferred. These are documented product boundaries, not claimed completions. No minor findings deferred by review.
- Task 2 native Bash RED: real Pi tool fixtures reproduced surviving background descendants and continuing after tool abort/timeout. GREEN: private worker guard keeps ordinary shells in the verified worker group and ends the full attempt on abort/explicit timeout. Real Pi guard loader also passes.
- Worker guard ownership remains strict: private owner record and nonce, actual parent PID, and OS PGID matching the worker PID. Tests use real OS execution; failed ps lookup is never accepted as termination evidence.
- Final integrated verification: npm run check exit 0, TypeScript pass, 74 tests passed, 0 failed, 0 skipped. Actual Pi main extension load has zero errors; pack dry-run passes with a writable temporary npm cache. No live model calls.
- Final guard-focused independent review reported no remaining Important/Critical lifecycle or ownership findings. Source implementation is frozen for delivery; exact validation boundaries are in docs/verification.md.
- Design now distinguishes implemented explicit profiles from future evidence-based routing and separates native Max effort from the unimplemented Ultra orchestration strategy.

## 2026-11-01 macOS continuation

- User request: commit the imported source, inspect internal documents, implement remaining v0.1 gaps and test. Rust feasibility was discussed; user explicitly chose to retain TypeScript.
- Initial source commit: `95a1e6e`; working branch: `implementation/macos-validation`. The ZIP remains ignored and unchanged.
- Scope: existing pure Pi v0.1; no daemon, paid model calls, global authentication/config changes, public release, parallel-worktree roadmap or automatic acceptance.
- Ownership: root owns controller/tests/docs and integration; runtime_core owns runtime fixtures/tests; verify_unpack performs independent read-only core review. Requested executor/reviewer profile is gpt-6.1-sol high; Normal mode mapping is not exposed by the collaboration tool.
- Plan: reproduce and block start/add collisions while preserving additions during ordinary worker execution; canonicalize the macOS cwd regression assertion; verify macOS installer and real Pi host commands in disposable settings; run typecheck, complete tests, loader, package and whitespace checks; independently review changes and commit.
- Baseline: Node v26.12.1, Pi 1.4.0. Dependency installation passed. TypeScript passed; 73 tests passed and 1 failed because `/var` and `/private/var` identify the same macOS directory. Real Pi loader and package dry-run passed. Full logs: `/tmp/codexteams-01a19675-baseline-{check,load,pack}.log`.
- Diagnosis: add() can publish task-1 while start() waits for a task-1 plan, causing duplicate-ID rejection at plan publication and preventing a new start. Reject add only while planning; ordinary worker/check additions remain supported.
- Runtime investigation: twelve real subprocess observations did not reproduce live writer overlap after a check; no speculative runtime change. `/tmp/codexteams-check-descendant-observation.log`.
- Planning regression RED: missing expected rejection reproduced in `planning-red.log`; GREEN: 13 controller tests passed. Ordinary worker/check additions remain available.
- Real-host test added: isolated Pi package registration and commands, durable state and shutdown without inherited provider credentials. Its initial EOF-wait timeout was fixed by closing the test child's stdin; no production runtime change.
- Intermediate installer-copy failure was non-reproducible in the focused recheck and two subsequent integrated suites; cause remains unknown. Assertion diagnostics now retain installer output; original failure log is preserved.
- Final integrated suite: TypeScript passed; 77 tests passed, 0 failed, 0 skipped on macOS. Fresh independent review approved current code; separate controller/runner run passed 52 tests and cancellation/check-add lifecycle probes passed.
- Real Mac installer and registered Pi CLI commands passed using disposable target/settings. User's active Pi settings/auth were not modified; no live model calls. Node 22.19.0 execution and interactive TUI remain unverified.
- Final loader, package dry-run and whitespace checks passed. All raw logs, including failed checks, were preserved in `/Users/oozoofrog/.codex/visualizations/2026/11/01/01a19675-e400-74a1-8b57-74b0a2ea8f2d/codexteams-verification`. Branch remains local; no push or public release.

## 2026-11-01 public repository

- User explicitly requested merging into main, then creating a public GitHub repository. main was fast-forwarded to `32ebc1c`; the post-merge TypeScript check and all 77 tests passed.
- Created `https://github.com/oozoofrog/codexteams` as public, connected origin and pushed main. GitHub's default branch and matching local/remote commit were verified.
- Publication audit inspected both existing commits and all 46 reachable file blobs; no credential or private-key blockers found. Local ZIP, dependencies, runtime state and external evidence logs were not published. Existing npm-private and license settings were retained.

## 2026-11-01 installation from a repository link

- User requested a README that lets another agent install from the link and explicitly authorized pushing it. Added direct GitHub URL installation, prerequisites and pinned Pi bootstrap, personal/project scope, exact noninteractive command checks, reload/login boundaries, update/remove and separate development clone instructions.
- Executed the public URL installation on Pi 1.4.0 with disposable settings and no provider credentials: install/list, two finalized help/status messages, update and remove all passed. No model turns or project state were created. Full evidence: `remote-install-readme.log` and `remote-install-readme-summary.json` in the existing verification folder.
- Independent documentation review confirmed source/CLI semantics and corrected the success criterion to count message_end events, rather than both start/end records. No application code changed; the existing 77-test result remains applicable. Shell syntax and whitespace were checked for the documentation change.

## 2026-11-01 launcher implementation

- User authorized the recommended launcher, team setup and initial work, tests, README installation update and push. Design: docs/design/2026-11-01-launcher.md; plan: docs/plans/2026-11-01-launcher.md; base 7c13df9, branch feature/pi-launcher.
- Ruling: launch a dedicated Pi session with only this explicit extension to avoid registered-copy conflicts while leaving personal settings/auth unchanged. Other auto-discovered extensions (including their custom providers) are unavailable in that session; document this limit. Cost if wrong: users depending on another extension need a future selective-loading design.
- Interfaces: CLI sends one `/teams launch <goal>` command; controller launch owns one abort reservation across planning and queue execution; explicit selected Pi is propagated as CODEXTEAMS_PI to workers. Existing state is shown without automatic retries. Version 0.2.0.
- Ownership: CLI owner gets bin/package/runtime-selection paths; extension owner gets controller/index/startup tests; root owns installer/docs/integration. Reviewers remain read-only. Requested core/reviewer models gpt-6.1-sol high, Normal tier mapping unavailable.

| Pre-flight pair/task | Shared contract checked | Result / ruling |
|---|---|---|
| Tasks 1 / 2 | One initial `/teams launch <goal>` command | CLI never sends separate start/run. Controller owns atomic lifecycle. |
| Tasks 1 / 3 | bin/files/version and installed command | Root waits for package metadata before actual global-prefix packaging validation. |
| Tasks 2 / 3 | Startup completion and real Pi host | Non-UI awaits launch; TUI uses background, preserving cancellation. Local protocol fixture validates without paid traffic. |
| Task 1 | Arg/version/process tests vs runtime behavior | Dedicated inherited-TTY child and explicit selected Pi; no code/eval in goals. |
| Task 2 | Exclusive start/run extraction vs state gates | One launch reservation, existing histories rejected, profiles-only allowed. |
| Task 3 | Installer/docs vs publication | Isolated npm prefix and agent settings only; public npm release not authorized/needed. |

- Ruling: parallel execution is limited to the two disjoint path owners with the shared startup command fixed in this plan; full-suite/integration checks are root-owned after both stop writing. This avoids duplicate writers while using the active parallel-delegation instruction.
- Task 1 GREEN: launcher/runtime 60 tests and typecheck passed after review corrections. Actual PTY captures prove inherited descriptors and TUI versus JSON mode selection. Logs `/tmp/codexteams-launcher-followup-*` and `/tmp/codexteams-launcher-tty/capture-followup-*.jsonl`.
- Task 2 GREEN: controller/extension 34 tests passed. One reservation spans plan/run; saved work and recovery remain explicit; non-UI operations await completion and publish messages. Logs `/tmp/codexteams-startup-focused-final.log`.
- Root installer regression first exposed reproducible BSD tar pipe Write error even for a tiny isolated source. A private temporary archive, cleaned on EXIT, removes the producer/extractor pipe; causality beyond the reproduced failure is not proven. Existing and new installer tests pass 2/2. CLI registration absence separately reproduced RED before adding global npm installation.
- Independent review found piped text could precede the slash command and invoke an ordinary Pi model prompt. Rejected nonempty non-TTY stdin before Pi startup; empty EOF remains allowed. Review also found Pi text mode hides custom messages; redirected streams now explicitly select JSONL. Both fixes have RED/GREEN and real-host coverage.
- Packed installation into an isolated npm global prefix with no physical Pi peer passed the real Pi/local HTTP protocol fixture: read-only status, visible preflight error without a request, plan, guarded Bash proof file, review boundary, lock release, and saved-state no-retry. No paid model or real account credentials were used. Log `/tmp/codexteams-launcher-installed-host-green.log`.
- Current independent review: all three task spec/quality verdicts PASS, no remaining material findings. Final integrated checks and publication still root-owned.
- Final integrated checks: TypeScript and all 117 tests passed, 0 failed/skipped. Actual loader and package dry-run passed. Real Mac installer with isolated prefix/settings registered CLI 0.2.0 and extension; read-only CLI status passed without model calls or state creation.
- Real Pi TTY status/help was observed and Ctrl-D exited 0 without creating project state. Raw TTY capture and all RED/interim/GREEN evidence preserved at `/Users/oozoofrog/.codex/visualizations/2026/11/01/01a19675-e400-74a1-8b57-74b0a2ea8f2d/codexteams-verification/launcher-0.2.0`. This is not full interactive goal/cancel or human usability acceptance.
- README now distinguishes CLI installation from extension-only installation and documents startup/review gates, selected Pi, dedicated extension loading, stdin rejection and JSONL output. Implementation/tests complete; user-authorized main integration/push follows, then the public Git installation recipe is checked with another isolated prefix.
- Published feature commit `718aad4` to main by fast-forward. The exact public Git installation command then passed in another disposable npm prefix: CLI 0.2.0 matched source, no physical Pi peer, actual Pi read-only status visible, zero model turns and no project state. Evidence `public-git-install.log` and summary JSON. Implementation, documentation, independent review and requested publication are complete; only the explicitly recorded live-account/platform acceptance limits remain.

## 2026-11-01 resume task picker

- User requests selecting a resumable task from a list instead of remembering an ID. Base 96f96f1, branch feature/resume-picker. Keep explicit `/teams resume <id> [instruction]`; `/teams resume` opens Pi's native selection dialog.
- Scope: failed/interrupted/needs_review candidates only, visible title/status/role with ID as secondary unique metadata; arrows/Enter/Escape; selecting resumes with the existing task instructions. No additional mandatory input dialog. No selection means no resume/model attempt. No candidate or absent project state shows an accurate empty state. Headless mode lists candidates and explicit-ID syntax without guessing.
- Existing idle/recovery/trust/ownership gates remain. Revalidate selected task and session/project generation after the dialog so a stale selection cannot launch in another session. Existing explicit-ID revision instructions remain unchanged.
- Plan: implementation owner writes UI/adapter regression tests first, implements picker and discoverability labels, then focused tests. Root owns documentation/version/integration evidence. Independent reviewer inspects current diff. Reuse the unchanged 117-test baseline; run the final full suite and real Pi TTY picker/cancel validation without paid calls, then integrate/push this follow-up on main.
- Picker RED: 21 cases, 17 expected failures; focused GREEN32/32 and typecheck passed. Initial full run137/138 failed only because launcher version assertion still expected0.2.0; corrected to0.2.1. Final npm run check passed TypeScript and138/138, no skips.
- Independent review found no material picker/dispatch defect. Fresh-controller ownership acquisition and existing pre-dispatch store nonce assertion were retained without exposing new core APIs.
- Actual Pi TTY selected the second candidate with Down+Enter and reached its distinct synthetic missing-model preflight; Esc cancelled a subsequent dialog, Ctrl-D exited0, state bytes stayed unchanged and lock released. No paid/model request in this probe. Logs retained at `/Users/oozoofrog/.codex/visualizations/2026/11/01/01a19675-e400-74a1-8b57-74b0a2ea8f2d/codexteams-verification/resume-picker-0.2.1`.
- README and version0.2.1 are updated. Loader, package dry-run and whitespace checks passed. Integrating and pushing this follow-up using the existing project publication authorization.
