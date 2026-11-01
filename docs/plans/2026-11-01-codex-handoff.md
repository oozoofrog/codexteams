# Codex handoff implementation plan

> Execute through the stable codexteams Pi extension in the visible Terminal. Single Terra implementation owner; independent Sol review; root retains design and acceptance verification. Use the existing project ledger docs/progress.md.

**Goal:** Transfer a bounded Codex work packet into one Teams task and return persisted execution/check evidence for Codex review.
**Architecture:** versioned file request/result, explicit CLI flags and Pi commands, atomic idempotent controller dispatch, existing locked state and worker runtime.
**Stack:** TypeScript ESM, Node >=22.19.0, Pi >=1.4.0 <2; no additional dependencies, daemon or native Codex runner.
**Spec:** docs/design/2026-11-01-codex-handoff.md

## Constraints and ownership

- Core implementation requests openai-codex/gpt-6.1-terra high. Planner requests openai-codex/gpt-6-astra high; reviewer requests openai-codex/gpt-6.1-sol high. Do not substitute earlier model versions. Requested Normal is not a verified provider service tier.
- Execute stable extension from /Volumes/eyedisk/develop/oozoofrog/codexteams/src/index.ts (base29405bc). Product writes only in /Users/oozoofrog/.codex/worktrees/codex-teams-handoff/codexteams.
- Terra owns src/**, bin/**, tests/**, package.json/package-lock.json, README.md, docs/codex-handoff.md. Root owns this design/plan, docs/progress.md, docs/verification.md and external evidence. Reviewers read current artifacts only.
- Preserve sequential writing, project trust/ownership/recovery and explicit human acceptance. No automatic execution on duplicate IDs; no rerun of unrelated work. No auth/global settings/source-checkout changes, commits/pushes or publication by workers.
- New CLI behavior must work in installed packages without physically installed Pi peer dependencies. Result lookup needs no Pi.

## Review focus

Crash after reservation must never replay; a changed same-ID packet must reject even if old work succeeded; queued handoff tasks must not leak into ordinary runQueue; operation errors must survive host exit0; input files must not block on FIFO or follow symlinks; TUI execution must preserve cancel.

## Task 1 — implementation and regression

- [x] Inspect owning types/store/controller/CLI/extension contracts before edits.
- [x] Write failing protocol, controller, CLI and Pi-host tests and preserve RED output outside Git.
- [x] Implement strict request parsing/digest and structured result construction in focused handoff module(s).
- [x] Extend optional persisted handoff records and validation, then add one exclusive controller dispatch preserving all duplicate/crash gates.
- [x] Add CLI --handoff/--handoff-result and Pi handoff commands. Preserve literal arguments, stdin/TTY/worker/selected-Pi boundaries. Return one validated result JSON with meaningful exit status.
- [x] Return stored execution/check evidence and bounded workspace observations; support non-Git and missing state without fabrication.
- [x] Expose planner/current worker role, requested model/effort and separately observed effective models in existing status/show/widget; preserve unknown and reported-cost distinctions. Add formatter regressions.
- [x] Add concise README and full Codex workflow example. Bump package+lock root versions to0.3.0 and update intentional version tests consistently.
- [x] Run focused tests/typecheck, then npm run check. Log actual failures and GREEN output. Stop writing before reporting all changed files and limitations.

## Task 2 — independent current-evidence review

- [x] Sol inspects the current implementation, required cases, request trust and at-most-once semantics. It does not implement fixes or accept work.
- [x] Root reconciles material findings; Terra resumes only with exact evidence and relevant corrections. Sol rechecks changed evidence.

## Task 3 — acceptance verification

- [x] Root verifies the final frozen 160-test suite evidence, runs 9 core regressions through the actual controller check, checks loader/packaging, tests the installed package on Node22.19, and verifies a live-provider visible CLI handoff. Reuse the successful full suite because no product source changed afterward.
- [x] Preserve stable-runtime hashes and actual requested/effective model/usage evidence separately from self-reported behavior. No release-readiness or human acceptance claims from fixture results.
- [x] Update docs/progress.md and docs/verification.md, provide reviewable changes and exact remaining limits. Do not publish automatically.
