# Chat-first Team Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development with the assigned existing owner; no duplicate writers.

**Goal:** 일반 입력과 응답 영역에서 리더 판단에 따라 팀 작업을 계속한다.
**Architecture:** 영속 대화 기록을 read-only 리더에 전달하고, 검증된 직렬 실행과 사용자 응답에 연결한다. 기존 controller 소유권·검토·수락을 확장하며 Pi 내부 실행을 유지한다.
**Tech Stack:** TypeScript, Node >=22.19.0, Pi >=1.4.0 <2, 기존 packaged JavaScript validators.
**Spec:** docs/design/2026-11-03-chat-first-team-mode.md

## Global Constraints

- Ordinary Pi chat is the default route after team mode ON; no required menus or manual IDs.
- Preserve one active writer/controller, required independent review, target/revision/owner/process-settlement validation and immutable acceptance history.
- Leader uses related conversation and actual state to choose direct answer or supported serial roles/steps/checks; no keyword or fixed-pipeline substitution.
- Internal generated events cannot supply human acceptance authority.
- Preserve legacy0.7 data, user auth/settings/state, original checkout/PiPID77936, FiveBeat, main and global installations.
- No new app/daemon/external Codex runtime, main push or global installation.

## Review Focus

- A new turn while writer/check/reviewer is active must be retained without duplicate execution.
- Pronoun follow-up and clarification reply must use actual recent results and target revision.
- Acknowledgement-only or stale confirmation must not accept any result.
- Reload/session change must reconcile message identity and recovery without replaying actions.
- Multi-stage execution must bind all writer attempts to final scope/artifact/review; partial stages cannot be falsely accepted.

## Task 1: Integrated conversation, decision and execution

Owner: /root/chat_core. Sole writes: src/**, tests/**, package.json, package-lock.json.
Files: src/core/types.ts, team-mode-protocol.ts, team-mode.ts, controller.ts, store.ts, state-validation.mjs and related declarations; src/index.ts; narrowly scoped chat helpers as needed. Tests: chat-context/control/stages/delivery/compatibility behavioral cases and affected existing tests.

Interfaces: extend buildCoordinatorPrompt(context: CoordinatorContext): string and parseCoordinatorAction(source: string, identity: CoordinatorIdentity): CoordinatorAction; extend supervisor resume/revise/recheck through the same validated paths. New stage and journal records must be shared by types and packaged JS reader. Existing controller.accept(id: string): void remains authoritative and gains strict aggregate binding for staged requests. Pi delivery uses public sendMessage and getBranch only.

- [x] Write focused failing behavioral cases for conversation context, natural post-result amend/resume/recheck, explicit versus ambiguous acceptance and stale identity; record RED.
- [x] Add serial stages, targeted restart and aggregate evidence regressions; confirm missing-behavior failure before source changes.
- [x] Implement strict protocol/state compatibility, state-aware leader decisions and sequential execution while preserving existing fences.
- [x] Persist user/response journal and reconcile Pi-history IDs through the public SDK. Verify input preservation and replay prevention in fixtures.
- [x] Reject validation-scope replacements from internal review amendments and retain existing check evidence.
- [x] Run focused GREEN, then npm run check, npm run smoke:load, npm run pack:check, git diff --check. Preserve full logs and failures. Reuse successful checks until relevant source changes.
- [x] Stop writes; provide exact source hashes, implementation report, required-check results and remaining proof limits to root for independent review.

## Task 2: Actual Pi proof and documentation

Owners: root external proof/docs; support only assigned external preparation. Source remains frozen and owner stopped during proof/review.

- [x] Generate the review package and obtain independent spec and quality review. Fix through the same source owner and refresh affected proof.
- [x] In a tiny isolated Git repo, route ordinary Pi to the frozen development extension using project-local settings.
- [x] Use the requested leader and worker models and verify their returned IDs. Submit ordinary chat through real Pi.
- [x] Confirm direct answer without a writer, a delegated edit, mid-work instruction, post-result correction, and stop and resume. Check public and on-disk response history.
- [x] Verify reload and real TUI response display separately from RPC and fixtures.
- [x] Confirm recheck without a new writer and verify isolated acceptance evidence separately.
- [x] Update README, docs/team-mode.md, verification.md, progress.md and WORK_HANDOFF.md with the user flow, compatibility and verification boundaries.
- [x] Complete cumulative independent review, final source and state preservation checks, and prepare the local branch for review.
