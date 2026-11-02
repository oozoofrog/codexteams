import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ProjectStore } from "./store.ts";
import { buildCoordinatorPrompt, buildReviewerPrompt, parseCoordinatorAction, parseReviewVerdict } from "./team-mode-protocol.ts";
import { artifactDigest } from "./team-mode-artifacts.ts";
import { reviewScope, reviewScopeDigest } from "./state-validation.mjs";
import type { TeamController } from "./controller.ts";
import { emptyUsage } from "./usage.ts";
import type { CoordinatorAttempt, ModelProfile, TeamModeState, WorkerResult, WorkerRunner } from "./types.ts";

interface Options { runner: WorkerRunner; validateProfile(profile: ModelProfile): Promise<void>; controller?: TeamController; onChange?: (message?: string) => void }
interface Input { text: string; origin: "interactive" | "rpc"; sessionId: string; streamingIntent?: "steer" | "followUp" }
const READ_TOOLS = ["read", "grep", "find", "ls"] as const;
const initial = (): TeamModeState => ({ version: 1, enabled: false, generation: 0, requests: [], coordinatorAttempts: [], events: [], reviewEvidence: [] });

/** Process-owned coordinator; no screen or Pi context is retained here. */
export class TeamModeSupervisor {
  private active?: { id: string; abort: AbortController; done: Promise<void> };
  private execution?: Promise<void>;
  private executionId?: string;
  private closed = false;
  private schedulingFailure?: unknown;
  private readonly store: ProjectStore;
  private readonly options: Options;
  constructor(store: ProjectStore, options: Options) { this.store = store; this.options = options; }
  get busy(): boolean { return this.active !== undefined || this.execution !== undefined; }
  snapshot(): TeamModeState | undefined { return this.store.snapshot().teamMode; }
  private notify(message?: string): void { try { this.options.onChange?.(message); } catch { /* display must not affect execution */ } }
  wake(): void { if (!this.closed) { this.schedule(); this.scheduleExecution(); } }

  async setMode(enabled: boolean): Promise<void> {
    if (this.closed) throw new Error("팀 모드가 종료 중입니다.");
    this.store.update(state => {
      const mode = state.teamMode ??= initial();
      if (mode.enabled === enabled) return;
      mode.enabled = enabled; mode.generation++;
      if (!enabled) for (const request of mode.requests) if (["received", "classifying", "queued"].includes(request.status)) { request.status = "paused"; request.reason = "팀 모드가 꺼졌습니다. 명시적으로 재개해야 합니다."; }
    });
    if (!enabled) this.active?.abort.abort();
    this.notify();
  }

  ingest(input: Input): string {
    if (this.closed) throw new Error("팀 모드가 종료 중입니다.");
    if (!input.text.trim() || Buffer.byteLength(input.text) > 16384 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(input.sessionId) || !["interactive", "rpc"].includes(input.origin)) throw new Error("잘못된 팀 요청입니다.");
    const id = randomUUID(), now = new Date().toISOString();
    this.store.update(state => {
      const mode = state.teamMode;
      if (!mode?.enabled || state.recoveryRequired) throw new Error("팀 모드가 꺼져 있거나 복구 확인이 필요합니다.");
      mode.requests.push({ id, text: input.text, origin: input.origin, sessionId: input.sessionId, ...(input.streamingIntent ? { streamingIntent: input.streamingIntent } : {}), receivedAt: now, revision: 1, status: "received", taskIds: [] });
      mode.events.push({ id: randomUUID(), requestId: id, kind: "received", at: now });
    });
    this.schedule();
    this.notify();
    return id;
  }

  async stop(id: string): Promise<void> {
    if (this.closed) throw new Error("팀 모드가 종료 중입니다.");
    const state = this.store.snapshot(), request = state.teamMode?.requests.find(r => r.id === id);
    if (!request || !["received", "classifying", "queued", "running", "paused", "blocked"].includes(request.status)) throw new Error("중단할 수 있는 요청이 아닙니다.");
    this.store.update(s => { const r = s.teamMode!.requests.find(x => x.id === id)!; r.status = "stopping"; r.revision++; r.reason = "종료를 기다리고 있습니다."; });
    await this.settleStop(id);
  }

  private async settleStop(id: string): Promise<void> {
    const state = this.store.snapshot(), request = state.teamMode?.requests.find(r => r.id === id);
    if (!request || request.status !== "stopping") return;
    const coordinatorActive = state.teamMode?.coordinatorAttempts.some(a => a.requestId === id && !a.endedAt);
    const operation = this.options.controller?.activeOperation;
    const executionActive = !!operation?.taskId && request.taskIds.includes(operation.taskId);
    const coordinatorDone = this.active?.id === id ? this.active.done : undefined;
    const executionDone = this.executionId === id ? this.execution : undefined;
    if (coordinatorActive || coordinatorDone) this.active?.abort.abort();
    if (executionActive) await this.options.controller?.cancel();
    if (coordinatorDone) await coordinatorDone;
    if (executionDone) await executionDone;
    this.store.update(s => { const r = s.teamMode!.requests.find(x => x.id === id); if (r?.status === "stopping") { r.status = "cancelled"; r.reason = "사용자가 중단했습니다."; } });
    this.notify("요청이 중단되었습니다.");
  }

  resume(id: string): void {
    if (this.closed) throw new Error("팀 모드가 종료 중입니다.");
    const snapshot = this.store.snapshot(), request = snapshot.teamMode?.requests.find(r => r.id === id);
    if (!snapshot.teamMode?.enabled || snapshot.recoveryRequired || !request || !["paused", "blocked", "cancelled", "failed", "awaiting_user_acceptance"].includes(request.status)) throw new Error("재개할 수 있는 요청이 아닙니다.");
    if (request.status === "awaiting_user_acceptance" && snapshot.tasks.find(t => t.id === request.taskIds[0])?.acceptanceSource === "user") throw new Error("이전 수락 결과는 재개할 수 없습니다.");
    if (this.active?.id === id || this.executionId === id || (this.options.controller?.activeOperation?.taskId && request.taskIds.includes(this.options.controller.activeOperation.taskId))) throw new Error("기존 작업의 종료를 기다리세요.");
    this.store.update(s => { const r = s.teamMode!.requests.find(x => x.id === id)!; if (r.status === "awaiting_user_acceptance") { r.checkpoint = "revalidate"; delete r.artifactDigest; } r.revision++; r.status = r.taskIds.length === 2 ? "queued" : "received"; delete r.reason; });
    this.wake(); this.notify("요청을 이어갑니다.");
  }

  revise(id: string, instruction: string): void {
    const state = this.store.snapshot(), request = state.teamMode?.requests.find(r => r.id === id);
    if (this.closed || !state.teamMode?.enabled || state.recoveryRequired || !request || !(["awaiting_user_acceptance", "queued", "running", "paused", "blocked"].includes(request.status) && request.taskIds.length === 2) || !instruction.trim() || Buffer.byteLength(instruction) > 16384 || state.tasks.find(t => t.id === request.taskIds[0])?.acceptanceSource === "user") throw new Error("수정할 수 있는 요청이 아닙니다.");
    const amendmentId = randomUUID(), now = new Date().toISOString();
    this.store.update(s => {
      const mode = s.teamMode!, r = mode.requests.find(x => x.id === id)!;
      mode.requests.push({ id: amendmentId, text: instruction, origin: request.origin, sessionId: request.sessionId, receivedAt: now, revision: 1, status: "answered", taskIds: [], answer: "수정 요청을 접수했습니다." });
      (r.amendments ??= []).push({ requestId: amendmentId, instruction, timing: "after_current", status: "pending" });
      r.revision++; if (r.status !== "running") r.status = "queued"; r.checkpoint = "fix"; delete r.artifactDigest; delete r.reason; delete r.recheckOnly;
    });
    this.wake(); this.notify();
  }

  recheck(id: string): void {
    const state = this.store.snapshot(), request = state.teamMode?.requests.find(r => r.id === id);
    if (this.closed || !state.teamMode?.enabled || state.recoveryRequired || !request || request.status !== "awaiting_user_acceptance" || this.executionId === id || state.tasks.find(t => t.id === request.taskIds[0])?.acceptanceSource === "user") throw new Error("다시 검증할 수 있는 요청이 아닙니다.");
    this.store.update(s => { const r = s.teamMode!.requests.find(x => x.id === id)!; r.revision++; r.status = "queued"; r.checkpoint = "revalidate"; r.recheckOnly = true; delete r.artifactDigest; delete r.reason; });
    this.wake(); this.notify();
  }

  private schedule(): void {
    if (this.closed || this.active || this.schedulingFailure) return;
    const state = this.store.snapshot();
    const request = state.teamMode?.enabled && !state.recoveryRequired && state.teamMode.requests.find(r => r.status === "received");
    if (!request) return;
    const abort = new AbortController();
    const done = Promise.resolve().then(() => this.coordinate(request.id, abort.signal)).catch(error => { this.schedulingFailure = error; }).finally(() => { this.active = undefined; if (!this.closed) { this.schedule(); this.scheduleExecution(); } });
    this.active = { id: request.id, abort, done };
  }

  private async coordinate(id: string, signal: AbortSignal): Promise<void> {
    const snapshot = this.store.snapshot();
    const mode = snapshot.teamMode!, request = mode.requests.find(r => r.id === id)!;
    const profile = snapshot.profiles.planner;
    const attempt: CoordinatorAttempt = { id: randomUUID(), sessionId: randomUUID(), requestId: id, generation: mode.generation, requestRevision: request.revision, profile, startedAt: new Date().toISOString(), effectiveModels: [], text: "", usage: emptyUsage(), logFile: "" };
    attempt.logFile = `logs/${attempt.id}.jsonl`;
    try {
      await this.options.validateProfile(profile); signal.throwIfAborted();
      this.store.update(s => {
        const current = s.teamMode?.requests.find(r => r.id === id);
        if (s.id !== snapshot.id || !s.teamMode?.enabled || s.teamMode.generation !== attempt.generation || !current || current.status !== "received" || current.revision !== attempt.requestRevision) throw new Error("조율 요청이 변경되었습니다.");
        current.status = "classifying"; s.teamMode.coordinatorAttempts.push(attempt);
      });
      this.notify();
      let result: WorkerResult;
      try {
        result = await this.options.runner({ cwd: this.store.root, prompt: buildCoordinatorPrompt({ goal: snapshot.goal, text: request.text, requestId: id, generation: attempt.generation, revision: request.revision, activeRequests: mode.requests.filter(r => r.id !== id && ["queued", "running", "paused", "blocked", "awaiting_user_acceptance"].includes(r.status)).slice(-16).map(r => ({ id: r.id, status: r.status, text: r.text.slice(0, 2048) })) }), systemPrompt: "You are a read-only team coordinator. Return only a JSON proposal, never mutate files or accept work.", profile, tools: READ_TOOLS, sessionId: attempt.sessionId, sessionDir: join(this.store.directory, "sessions"), signal, onEvent: event => {
          if (event.type !== "process" && event.type !== "usage") return;
          this.store.update(s => { const a = s.teamMode?.coordinatorAttempts.find(x => x.id === attempt.id); if (!a || a.endedAt) return; if (event.type === "process") a.workerPid = event.pid; else { a.usage = event.usage; if (event.model && !a.effectiveModels.includes(event.model)) a.effectiveModels.push(event.model); } });
        } });
      } catch (error) { result = { outcome: signal.aborted ? "aborted" : "failed", text: "", error: String(error), exitCode: null, usage: emptyUsage(), effectiveModels: [], sessionId: attempt.sessionId }; }
      let cancelTarget: string | undefined, stopTarget: string | undefined;
      this.store.update(s => {
        const m = s.teamMode!, a = m.coordinatorAttempts.find(x => x.id === attempt.id)!, r = m.requests.find(x => x.id === id)!;
        a.endedAt = new Date().toISOString(); a.outcome = signal.aborted ? "aborted" : result.outcome; a.text = result.text; a.error = result.error; a.usage = result.usage; a.effectiveModels = result.effectiveModels;
        if (signal.aborted || !m.enabled || m.generation !== attempt.generation || s.id !== snapshot.id || r.status !== "classifying" || r.revision !== attempt.requestRevision) return;
        if (result.outcome !== "success") { r.status = "blocked"; r.reason = result.error || "조율 실행에 실패했습니다."; return; }
        try {
          const proposal = parseCoordinatorAction(result.text, { requestId: id, generation: attempt.generation, revision: attempt.requestRevision });
          if (proposal.kind === "answer") { r.status = "answered"; r.answer = proposal.text; }
          else if (proposal.kind === "block") { r.status = "blocked"; r.reason = proposal.reason; }
          else if (proposal.kind === "propose_plan") {
            if (!this.options.controller) { r.status = "blocked"; r.reason = "작업 실행 소유자가 없습니다."; }
            else {
              const writerId = `mode-${randomUUID()}`, reviewerId = `mode-${randomUUID()}`, now = new Date().toISOString();
              const plan = proposal.tasks[0];
              s.tasks.push({ ...plan, id: writerId, dependsOn: [], status: "queued", createdAt: now, updatedAt: now, attempts: [], checks: [] });
              s.tasks.push({ id: reviewerId, title: `독립 검토: ${plan.title}`.slice(0, 100), description: "구현과 검증을 독립 검토합니다.", role: "reviewer", dependsOn: [], acceptance: ["구현과 검증 근거를 검토한다."], status: "queued", createdAt: now, updatedAt: now, attempts: [], checks: [] });
              r.taskIds = [writerId, reviewerId]; r.checks = proposal.checks; r.checkpoint = "implementation"; r.status = "queued";
            }
          } else if (proposal.kind === "amend") {
            const target = m.requests.find(x => x.id === proposal.targetRequestId);
            if (!target || target.id === id || !mode.requests.some(x => x.id === target.id && x.revision === target.revision) || target.taskIds.length !== 2 || !["queued", "running", "paused", "blocked"].includes(target.status)) throw new Error("변경 대상을 확인할 수 없습니다.");
            target.amendments ??= []; target.amendments.push({ requestId: id, instruction: proposal.instruction, timing: proposal.timing, status: "pending" });
            target.revision++; target.checkpoint = "fix"; delete target.artifactDigest;
            if (proposal.timing === "interrupt_then_resume" && target.status === "running") cancelTarget = target.id;
            r.status = "answered"; r.answer = proposal.timing === "after_current" ? "변경을 접수했습니다. 현재 실행이 끝나면 다음 실행에 반영합니다." : "변경을 접수했습니다. 현재 실행의 종료를 확인한 뒤 반영합니다.";
          } else if (proposal.kind === "stop") {
            const target = m.requests.find(x => x.id === proposal.targetRequestId);
            if (!target || target.id === id || !mode.requests.some(x => x.id === target.id && x.revision === target.revision) || !["received", "classifying", "queued", "running", "paused", "blocked"].includes(target.status)) throw new Error("중단 대상을 확인할 수 없습니다.");
            target.status = "stopping"; target.revision++; target.reason = "종료를 기다리고 있습니다."; stopTarget = target.id;
            r.status = "answered"; r.answer = "중단 요청을 접수했습니다. 실행 중이면 종료를 확인합니다.";
          } else if (proposal.kind === "prioritize") {
            const positions = m.requests.map((item, index) => item.status === "queued" && item.taskIds.length === 2 ? index : -1).filter(index => index >= 0);
            const pending = positions.map(index => m.requests[index]);
            const selected = proposal.orderedRequestIds.map(targetId => pending.find(item => item.id === targetId));
            if (selected.some(item => !item || !mode.requests.some(old => old.id === item.id && old.revision === item.revision))) throw new Error("대기 중인 팀 요청만 우선순위를 바꿀 수 있습니다.");
            const arranged = [...selected, ...pending.filter(item => !proposal.orderedRequestIds.includes(item.id))];
            positions.forEach((position, index) => { m.requests[position] = arranged[index]!; });
            r.status = "answered"; r.answer = "대기 요청의 우선순위를 변경했습니다.";
          }
          m.events.push({ id: randomUUID(), requestId: id, kind: "applied", at: new Date().toISOString() });
        } catch { r.status = "blocked"; r.reason = "조율 응답을 검증할 수 없습니다."; }
      });
      if (stopTarget) await this.settleStop(stopTarget);
      if (cancelTarget) {
        const current = this.store.snapshot(), target = current.teamMode?.requests.find(x => x.id === cancelTarget), operation = this.options.controller?.activeOperation;
        if (current.teamMode?.enabled && current.teamMode.generation === attempt.generation && target && operation?.taskId && target.taskIds.includes(operation.taskId)) await this.options.controller?.cancel();
      }
    } catch (error) {
      this.store.update(s => { const r = s.teamMode?.requests.find(x => x.id === id); if (r && (r.status === "received" || r.status === "classifying")) { r.status = "blocked"; r.reason = String(error).slice(0, 1000); } });
    }
    const finished = this.snapshot()?.requests.find(r => r.id === id);
    this.notify(finished?.status === "answered" ? `답변 · ${finished.text.slice(0, 80)}\n${finished.answer}` : finished?.status === "blocked" ? `확인 필요 · ${finished.text.slice(0, 80)}\n${finished.reason}` : undefined);
  }

  private scheduleExecution(): void {
    if (this.closed || this.execution || this.schedulingFailure || !this.options.controller || this.options.controller.busy) return;
    const state = this.store.snapshot(), mode = state.teamMode;
    const request = mode?.enabled && !state.recoveryRequired && mode.requests.find(r => r.status === "queued" && r.taskIds.length === 2);
    if (!request || !mode) return;
    const generation = mode.generation, revision = request.revision;
    this.executionId = request.id;
    this.execution = Promise.resolve().then(() => this.execute(request.id, generation, revision)).catch(error => { this.schedulingFailure = error; }).finally(() => { this.execution = undefined; this.executionId = undefined; if (!this.closed) this.scheduleExecution(); });
  }

  private allowed(id: string, generation: number, revision: number): boolean {
    const state = this.store.snapshot(), mode = state.teamMode, request = mode?.requests.find(r => r.id === id);
    return !this.closed && !state.recoveryRequired && !!mode?.enabled && mode.generation === generation && request?.revision === revision && request.status === "running";
  }

  private async execute(id: string, generation: number, revision: number): Promise<void> {
    const controller = this.options.controller!;
    const initial = this.store.snapshot(), queued = initial.teamMode?.requests.find(r => r.id === id);
    if (!initial.teamMode?.enabled || initial.teamMode.generation !== generation || !queued || queued.revision !== revision || queued.status !== "queued") return;
    this.store.update(s => {
      const r = s.teamMode?.requests.find(x => x.id === id);
      if (!s.teamMode?.enabled || s.teamMode.generation !== generation || !r || r.revision !== revision || r.status !== "queued") throw new Error("작업 요청이 변경되었습니다.");
      r.status = "running";
    });
    const pause = (reason: string) => this.store.update(s => { const r = s.teamMode?.requests.find(x => x.id === id); if (r && r.status === "running") { if (s.teamMode?.enabled && s.teamMode.generation === generation && r.revision !== revision && r.amendments?.some(a => a.status === "pending")) { r.status = "queued"; r.checkpoint = "fix"; delete r.reason; } else { r.status = "paused"; r.reason = reason.slice(0, 16384); } } });
    try {
      let instruction = "", previousFailure = "";
      const rechecking = this.store.snapshot().teamMode!.requests.find(r => r.id === id)?.recheckOnly === true;
      while (this.allowed(id, generation, revision)) {
        let state = this.store.snapshot(), request = state.teamMode!.requests.find(r => r.id === id)!;
        const [writerId, reviewerId] = request.taskIds;
        const pending = (request.amendments ?? []).filter(a => a.status === "pending");
        const amendmentInstructions = pending.map(a => a.instruction).join("\n");
        instruction = [instruction || request.fixInstruction || "", amendmentInstructions].filter(Boolean).join("\n");
        const resumePhase = !instruction && (request.checkpoint === "checks" || request.checkpoint === "review" || request.checkpoint === "revalidate") ? request.checkpoint : undefined;
        let writer = state.tasks.find(t => t.id === writerId)!;
        if (resumePhase) {
          if (writer.status !== "needs_review" || (resumePhase !== "revalidate" && (!request.artifactDigest || artifactDigest(this.store.root) !== request.artifactDigest))) { pause("기존 구현 결과 또는 파일 내용이 변경되어 재개할 수 없습니다."); return; }
          if (resumePhase === "revalidate") artifactDigest(this.store.root);
        } else {
          this.store.update(s => { s.teamMode!.requests.find(r => r.id === id)!.checkpoint = instruction ? "fix" : "implementation"; });
          await controller.runManaged(id, writerId, generation, instruction, revision);
          if (!this.allowed(id, generation, revision)) { pause("팀 모드가 꺼져 후속 단계를 시작하지 않았습니다."); return; }
          state = this.store.snapshot(); writer = state.tasks.find(t => t.id === writerId)!;
          if (writer.status !== "needs_review") { pause("구현 실행이 완료되지 않았습니다."); return; }
          this.store.update(s => { const r = s.teamMode!.requests.find(r => r.id === id)!; for (const amendment of r.amendments ?? []) if (pending.some(item => item.requestId === amendment.requestId)) amendment.status = "applied"; delete r.fixInstruction; });
          const currentDigest = artifactDigest(this.store.root);
          this.store.update(s => { const r = s.teamMode!.requests.find(r => r.id === id)!; r.checkpoint = "checks"; r.artifactDigest = currentDigest; });
        }
        for (const command of request.checks ?? []) {
          if (!this.allowed(id, generation, revision)) { pause("팀 모드가 꺼져 검증을 시작하지 않았습니다."); return; }
          const latestWriter = this.store.snapshot().tasks.find(t => t.id === writerId)!;
          const prior = latestWriter.checks.filter(c => c.attemptId === latestWriter.attempts.at(-1)?.id && c.command === command && c.source === "team_coordinator").at(-1);
          if (resumePhase !== "revalidate" && prior?.status === "passed") continue;
          if (resumePhase === "review") { pause("검토 대상 검증 근거가 누락되었습니다."); return; }
          await controller.check(writerId, command, { requestId: id, generation });
          const latest = this.store.snapshot().tasks.find(t => t.id === writerId)!.checks.at(-1);
          if (latest?.status !== "passed") { pause("선언된 검증이 통과하지 못했습니다."); return; }
          const currentDigest = artifactDigest(this.store.root);
          this.store.update(s => { s.teamMode!.requests.find(r => r.id === id)!.artifactDigest = currentDigest; });
        }
        if (!this.allowed(id, generation, revision)) { pause("팀 모드가 꺼져 검토를 시작하지 않았습니다."); return; }
        state = this.store.snapshot(); request = state.teamMode!.requests.find(r => r.id === id)!; writer = state.tasks.find(t => t.id === writerId)!;
        const implementation = writer.attempts.at(-1)!;
        const checkIds = (request.checks ?? []).map(command => writer.checks.filter(c => c.attemptId === implementation.id && c.source === "team_coordinator" && c.command === command).at(-1)?.id).filter((id): id is string => Boolean(id));
        if (checkIds.length !== (request.checks ?? []).length) { pause("선언된 검증 근거가 누락되었습니다."); return; }
        const digest = artifactDigest(this.store.root);
        const scope = reviewScope(request, writer, checkIds), scopeDigest = reviewScopeDigest(scope);
        const identity = { implementationAttemptId: implementation.id, artifactDigest: digest, checkIds, requestId: id, requestRevision: revision, scopeDigest };
        const prompt = buildReviewerPrompt(identity, scope, implementation.text);
        this.store.update(s => { const r = s.teamMode!.requests.find(r => r.id === id)!; r.checkpoint = "review"; r.artifactDigest = digest; });
        await controller.runManagedReview(id, reviewerId, generation, prompt, revision);
        if (!this.allowed(id, generation, revision)) { pause("팀 모드가 꺼져 검토 결과를 적용하지 않았습니다."); return; }
        state = this.store.snapshot(); const reviewer = state.tasks.find(t => t.id === reviewerId)!, attempt = reviewer.attempts.at(-1);
        if (reviewer.status !== "needs_review" || !attempt) { pause("독립 검토가 완료되지 않았습니다."); return; }
        const verdict = parseReviewVerdict(attempt.text, identity);
        if (artifactDigest(this.store.root) !== digest) { pause("검토 중 파일 내용이 변경되었습니다."); return; }
        this.store.update(s => { s.teamMode!.reviewEvidence.push({ id: randomUUID(), requestId: id, implementationTaskId: writerId, implementationAttemptId: implementation.id, reviewerTaskId: reviewerId, reviewerAttemptId: attempt.id, artifactDigest: digest, verdict: verdict.verdict, checkIds, requestRevision: revision, scope, scopeDigest }); });
        if (verdict.verdict === "pass") { this.store.update(s => { const r = s.teamMode!.requests.find(x => x.id === id)!; r.status = "awaiting_user_acceptance"; delete r.checkpoint; delete r.recheckOnly; }); return; }
        if (verdict.verdict === "blocked" || (rechecking && verdict.verdict === "changes_required")) { pause(verdict.findings.join("\n")); return; }
        const failure = JSON.stringify({ digest, findings: verdict.findings });
        if (failure === previousFailure) { pause("파일 내용과 검토 결과가 바뀌지 않아 재시도를 중지했습니다."); return; }
        previousFailure = failure; instruction = verdict.findings.join("\n");
        this.store.update(s => { const r = s.teamMode!.requests.find(r => r.id === id)!; r.checkpoint = "fix"; r.fixInstruction = instruction; delete r.artifactDigest; });
      }
      pause("팀 모드 상태가 변경되어 후속 단계를 시작하지 않았습니다.");
    } catch (error) { pause(error instanceof Error ? error.message : String(error)); }
    finally { const request = this.snapshot()?.requests.find(r => r.id === id); this.notify(request ? `요청 · ${request.text.slice(0, 80)}${request.status === "awaiting_user_acceptance" ? " · 결과 확인 필요" : request.reason ? ` · 확인 필요: ${request.reason}` : ""}` : undefined); }
  }

  async whenIdle(): Promise<void> { while (this.active || this.execution) { if (this.active) await this.active.done; else if (this.execution) await this.execution; } }
  fenceScheduling(): void { this.closed = true; }
  beginShutdown(): void { this.fenceScheduling(); this.active?.abort.abort(); }
  async shutdown(): Promise<void> { this.beginShutdown(); if (this.execution) await this.options.controller?.cancel(); await this.whenIdle(); if (this.schedulingFailure) throw this.schedulingFailure; }
}
