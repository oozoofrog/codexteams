# codexteams Pi Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Ship a locally installable Pi extension that plans, runs, records and resumes project tasks with explicit model profiles.

**Architecture:** One extension package, in-process controller, durable project state, isolated Pi child conversations. Pi owns authentication and TUI. No daemon or Codex runtime.

**Tech Stack:** TypeScript ESM, Node >=22.19.0, Pi 1.4.0, TypeBox 1.3.27, native Node test runner.

**Spec:** `docs/design/2026-11-01-pi-extension.md`

## Global Constraints

- No arbitrary default time, turn, or monetary limit.
- No implicit model/effort inheritance or billing fallback.
- One writing worker per project for 0.1.
- Worker success becomes needs_review, never unverified completed.
- Pi termination cancels workers; resume reconciles actual state.
- Unknown usage is not zero. Reasoning is included in output.
- No live paid model calls in automated verification.
- The original Linux delivery could not reach the Mac destination. Follow-up macOS verification must distinguish isolated test installation from real-user registration and live-account validation.

## Review Focus

1. A child exits zero after reporting an assistant/API error: record failure.
2. Two Pi sessions target the same directory: only one writer owns execution.
3. A session closes or reloads during active work: stop descendants and preserve interrupted state.
4. A planner emits malformed/cyclic/untrusted data: reject without damaging existing tasks.
5. A restarted process sees persisted running attempts: preserve history and require reconciliation before retry.

---

## Task 1: Contracts, profiles, planner validation and durable store

**Files:** `package.json`, `tsconfig.json`, `src/core/types.ts`, `profiles.ts`, `planning.ts`, `store.ts`, corresponding `tests/*.test.ts`.

**Interfaces:** `ProjectState`, `Task`, `Attempt`, `ModelProfile`, `WorkerRequest`, `WorkerResult`; `parsePlan(text): PlannedTask[]`; `ProjectStore.open(root)`, `.snapshot()`, `.update(mutator)`, `.close()`.

- [x] Write planner/store regression tests before implementations.
- [x] Run `npm test` and observe meaningful failures.
- [x] Implement profile defaults, strict plan validation and lock/atomic persistence.
- [x] Test independent locks, stale recovery, corruption, cycles and project root identity.
- [x] Commit verified contracts and state implementation.

## Task 2: Pi JSONL worker adapter

**Files:** `src/runtime/pi-runner.ts`, `tests/pi-runner.test.ts`, `tests/fixtures/pi-worker.mjs`.

**Consumes:** `WorkerRequest`, `WorkerResult`, `WorkerEvent`, `UsageSummary` from types.

**Produces:** `runPiWorker(request): Promise<WorkerResult>`; `resolvePiInvocation()`; injectable invocation for real subprocess fixture tests.

- [x] Write tests for chunks, usage snapshots, zero-exit error and cancellation.
- [x] Observe failures before implementation.
- [x] Implement explicit argv, UTF-8/LF JSONL parser and final result detection.
- [x] Propagate abort to process group, wait for close, clean descendants.
- [x] Verify all fixture subprocess cases and commit.

## Task 3: Controller transitions and execution queue

**Files:** `src/core/controller.ts`, `tests/controller.test.ts`.

**Consumes:** store, profile policy, plan validator and injected runner.

**Produces:** `TeamController` methods for start/add/run/cancel/resume/check/accept/profile/shutdown.

- [x] Write state-transition tests, including dependencies and interrupted recovery.
- [x] Observe failures, implement one-writer sequential queue and attempt recording.
- [x] Verify requested/effective model and partial usage handling.
- [x] Verify direct-user acceptance is separate from worker result.
- [x] Commit.

## Task 4: Pi host adapter, status UI and packaging

**Files:** `src/index.ts`, `src/ui/format.ts`, `README.md`, `scripts/install-macos.sh`, `tests/extension.test.ts`.

**Consumes:** controller and real Pi 1.4.0 ExtensionAPI types.

**Produces:** `/teams` command family and read-only `codexteams_status` tool.

- [x] Register command parsing, profile validation and trust checks.
- [x] Wire status/message rendering and all session_shutdown reasons.
- [x] Add tests for direct command actions and absent model/effort.
- [x] Run TypeScript and actual Pi package load smoke without model calls.
- [x] Verify npm package contents and non-destructive Mac installation script.
- [x] Commit and record exact verification results.

## Task 5: Integrated review and delivery

**Files:** `docs/verification.md`, `docs/progress.md`, deliverable archive.

- [x] Fresh reviewer checks spec boundaries and highest-risk cases.
- [x] Fix material findings with failing regression cases then rerun affected checks.
- [x] Run final suite, type check, package checks; avoid unrelated repeated tests.
- [x] Build the source ZIP from the inspected 35-file manifest, excluding dependencies, secrets and project runtime state.
- [x] Document Mac/live-account limitations and provide a concrete installation handoff.

## Release handoff

Implementation and integrated verification are complete: TypeScript passes, 74 tests pass with no failures or skips, and the actual Pi loader reports zero errors. The source manifest has been inspected. The source ZIP has been constructed and checked; durable transfer follows this source snapshot; delivery is confirmed by the final downloadable file, not by assuming the requested Mac path was created.

## Task 6: macOS continuation

**Goal:** Preserve the delivered v0.1 scope, resolve proven defects and establish current macOS evidence. The user explicitly chose to retain TypeScript after discussing Rust feasibility.

**Files:** `src/core/controller.ts`, `tests/controller.test.ts`, `tests/pi-runner.test.ts`, `tests/installer.test.ts`, `tests/extension-host.test.ts`, README and verification/handoff documents.

- [x] Commit the imported source before edits (`95a1e6e`).
- [x] Run the baseline and preserve failures. Correct the macOS canonical-path assertion without weakening cwd identity.
- [x] Reproduce concurrent planning/add collisions, reject additions during planning, and retain additions during worker/check execution.
- [x] Add a real Pi CLI host test with disposable settings and no inherited provider credentials; verify registration, commands, durable state and shutdown lock release.
- [x] Run the macOS installer in a disposable destination and Pi settings directory.
- [x] Independently review current code and cancellation/check-add lifecycle behavior.
- [x] Run the final complete suite, loader, package and whitespace checks; reconcile documentation and commit the verified changes.
