import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ProjectStore } from "./store.ts";
import { buildCoordinatorPrompt, buildReviewerPrompt, parseCoordinatorAction, parseReviewVerdict, PlanProtocolError } from "./team-mode-protocol.ts";
import { artifactDigest } from "./team-mode-artifacts.ts";
import { isAcceptedRequest, reviewScope, reviewScopeDigest } from "./state-validation.mjs";
import type { TeamController } from "./controller.ts";
import { conversationContext, explicitAcceptanceQuote, offerResult, receiptDigest, recordChat, resultText } from "./team-chat.ts";
import { emptyUsage } from "./usage.ts";
import type { AcceptanceOffer, CoordinatorAttempt, ModelProfile, TeamModeRequest, TeamModeState, WorkerResult, WorkerRunner } from "./types.ts";

interface Options { runner: WorkerRunner; validateProfile(profile: ModelProfile): Promise<void>; controller?: TeamController; onChange?: (message?: string) => void; canAccept?: (request: TeamModeRequest, offer: AcceptanceOffer) => boolean }
interface Input { text: string; origin: "interactive" | "rpc"; sessionId: string; streamingIntent?: "steer" | "followUp"; visibleJournalIds?: string[]; branchAnchorId?: string; confirmationContextId?: string; inputPersistence?: "native" | "custom" }
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
      mode.requests.push({ id, text: input.text, origin: input.origin, sessionId: input.sessionId, ...(input.streamingIntent ? { streamingIntent: input.streamingIntent } : {}), receivedAt: now, revision: 1, status: "received", taskIds: [], ...(input.visibleJournalIds ? { visibleJournalIds: input.visibleJournalIds } : {}), ...(input.branchAnchorId ? { branchAnchorId: input.branchAnchorId } : {}), ...(input.confirmationContextId ? { confirmationContextId: input.confirmationContextId } : {}), ...(input.inputPersistence ? { inputPersistence: input.inputPersistence } : {}) });
      mode.latestHumanRequestId = id;
      if (input.inputPersistence === "native") { if (mode.pendingNativeRequestId) throw new Error("기본 대화 기록 연결을 기다리세요."); mode.pendingNativeRequestId = id; }
      mode.events.push({ id: randomUUID(), requestId: id, kind: "received", at: now });
      (mode.journal ??= []).push({ id: randomUUID(), requestId: id, requestRevision: 1, sessionId: input.sessionId, role: "user", kind: "input", text: input.text, at: now, delivery: "pending" });
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
    this.store.update(s => { const r = s.teamMode!.requests.find(x => x.id === id); if (r?.status === "stopping") { r.status = "cancelled"; r.reason = "사용자가 중단했습니다."; if (r.stages?.some(tid => s.tasks.find(t => t.id === tid)?.role !== "reviewer")) r.artifactDigest = artifactDigest(this.store.root); } });
    recordChat(this.store, id, "control", "요청이 중단되었습니다. 실행 종료를 확인했습니다."); this.notify();
  }

  resume(id: string): void {
    if (this.closed) throw new Error("팀 모드가 종료 중입니다.");
    const snapshot = this.store.snapshot(), request = snapshot.teamMode?.requests.find(r => r.id === id);
    if (!snapshot.teamMode?.enabled || snapshot.recoveryRequired || !request || !["paused", "blocked", "cancelled", "failed", "awaiting_user_acceptance"].includes(request.status)) throw new Error("재개할 수 있는 요청이 아닙니다.");
    if (isAcceptedRequest(snapshot, request)) throw new Error("이전 수락 결과는 재개할 수 없습니다.");
    if (this.active?.id === id || this.executionId === id || (this.options.controller?.activeOperation?.taskId && request.taskIds.includes(this.options.controller.activeOperation.taskId))) throw new Error("기존 작업의 종료를 기다리세요.");
    this.store.update(s => { const r = s.teamMode!.requests.find(x => x.id === id)!; if (r.status === "awaiting_user_acceptance") { r.checkpoint = "revalidate"; delete r.artifactDigest; } r.revision++; r.status = r.taskIds.length > 0 ? "queued" : "received"; delete r.reason; });
    recordChat(this.store, id, "control", "요청을 이어갑니다."); this.wake(); this.notify();
  }

  revise(id: string, instruction: string): void {
    const state = this.store.snapshot(), request = state.teamMode?.requests.find(r => r.id === id);
    if (this.closed || !state.teamMode?.enabled || state.recoveryRequired || !request || !(["awaiting_user_acceptance", "queued", "running", "paused", "blocked"].includes(request.status) && request.taskIds.length > 0) || !instruction.trim() || Buffer.byteLength(instruction) > 16384 || isAcceptedRequest(state, request)) throw new Error("수정할 수 있는 요청이 아닙니다.");
    const amendmentId = randomUUID(), now = new Date().toISOString();
    this.store.update(s => {
      const mode = s.teamMode!, r = mode.requests.find(x => x.id === id)!;
      mode.requests.push({ id: amendmentId, text: instruction, origin: request.origin, sessionId: request.sessionId, receivedAt: now, revision: 1, status: "answered", taskIds: [], answer: "수정 요청을 접수했습니다." });
      (r.amendments ??= []).push({ requestId: amendmentId, instruction, timing: "after_current", status: "pending" });
      if (r.stages) { r.restartFromTaskId = r.taskIds[0]; r.stageCursor = Math.min(r.stageCursor ?? 0, r.stages.indexOf(r.taskIds[0])); }
      r.revision++; if (r.status !== "running") r.status = "queued"; r.checkpoint = "fix"; if (!r.stages) delete r.artifactDigest; delete r.reason; delete r.recheckOnly;
    });
    this.wake(); this.notify();
  }

  recheck(id: string): void {
    const state = this.store.snapshot(), request = state.teamMode?.requests.find(r => r.id === id);
    if (this.closed || !state.teamMode?.enabled || state.recoveryRequired || !request || request.status !== "awaiting_user_acceptance" || this.executionId === id || isAcceptedRequest(state, request)) throw new Error("다시 검증할 수 있는 요청이 아닙니다.");
    this.store.update(s => { const r = s.teamMode!.requests.find(x => x.id === id)!; r.revision++; r.status = "queued"; r.checkpoint = "revalidate"; r.recheckOnly = true; delete r.artifactDigest; delete r.reason; });
    this.wake(); this.notify();
  }

  private schedule(): void {
    if (this.closed || this.active || this.schedulingFailure) return;
    const state = this.store.snapshot();
    const request = state.teamMode?.enabled && !state.recoveryRequired && state.teamMode.requests.find(r => r.status === "received" && (!r.inputPersistence || (!state.teamMode!.pendingNativeRequestId && state.teamMode!.journal?.some(e => e.requestId === r.id && e.role === "user" && e.kind === "input" && e.delivery === "delivered"))));
    if (!request) return;
    const abort = new AbortController();
    const done = Promise.resolve().then(() => this.coordinate(request.id, abort.signal)).catch(error => { this.schedulingFailure = error; }).finally(() => { this.active = undefined; if (!this.closed) { this.schedule(); this.scheduleExecution(); } });
    this.active = { id: request.id, abort, done };
  }

  private async coordinate(id: string, signal: AbortSignal, repair?: { attemptId: string; originalProposal: string; diagnostic: string }): Promise<void> {
    const snapshot = this.store.snapshot();
    const mode = snapshot.teamMode!, request = mode.requests.find(r => r.id === id)!;
    const profile = snapshot.profiles.planner;
    const attempt: CoordinatorAttempt = { id: randomUUID(), sessionId: randomUUID(), requestId: id, generation: mode.generation, requestRevision: request.revision, ...(repair ? { repairOfAttemptId: repair.attemptId } : {}), profile, startedAt: new Date().toISOString(), effectiveModels: [], text: "", usage: emptyUsage(), logFile: "" };
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
        result = await this.options.runner({ cwd: this.store.root, prompt: buildCoordinatorPrompt({ goal: snapshot.goal, text: request.text, requestId: id, generation: attempt.generation, revision: request.revision, ...(repair ? { protocolRepair: repair } : {}), ...conversationContext(snapshot, request.sessionId), provenance: request.provenance ?? "human", actualState: { ...conversationContext(snapshot, request.sessionId).actualState, operation: this.options.controller?.activeOperation }, activeRequests: mode.requests.filter(r => r.id !== id && !isAcceptedRequest(snapshot, r) && r.status !== "answered").slice(-16).map(r => ({ id: r.id, status: r.status, text: r.text.slice(0, 2048) })) }), systemPrompt: `You are a read-only team coordinator. Return only a JSON proposal. You may propose kind="accept" when the current human explicitly accepts the exact delivered result offer visible in this session. Never mutate files or directly accept work. The trusted controller validates and applies proposals.`, profile, tools: READ_TOOLS, sessionId: attempt.sessionId, sessionDir: join(this.store.directory, "sessions"), signal, onEvent: event => {
          if (event.type !== "process" && event.type !== "usage") return;
          this.store.update(s => { const a = s.teamMode?.coordinatorAttempts.find(x => x.id === attempt.id); if (!a || a.endedAt) return; if (event.type === "process") a.workerPid = event.pid; else { a.usage = event.usage; if (event.model && !a.effectiveModels.includes(event.model)) a.effectiveModels.push(event.model); } });
        } });
      } catch (error) { result = { outcome: signal.aborted ? "aborted" : "failed", text: "", error: String(error), exitCode: null, usage: emptyUsage(), effectiveModels: [], sessionId: attempt.sessionId }; }
      let repairPlan: { attemptId: string; originalProposal: string; diagnostic: string } | undefined;
      let cancelTarget: string | undefined, stopTarget: string | undefined, resumeTarget: string | undefined, recheckTarget: string | undefined, acceptTarget: { id: string; revision: number; offerId: string } | undefined;
      this.store.update(s => {
        const m = s.teamMode!, a = m.coordinatorAttempts.find(x => x.id === attempt.id)!, r = m.requests.find(x => x.id === id)!;
        a.endedAt = new Date().toISOString(); a.outcome = signal.aborted ? "aborted" : result.outcome; a.text = result.text; a.error = result.error; a.usage = result.usage; a.effectiveModels = result.effectiveModels;
        if (signal.aborted || !m.enabled || m.generation !== attempt.generation || s.id !== snapshot.id || r.status !== "classifying" || r.revision !== attempt.requestRevision) return;
        if (result.outcome !== "success") { r.status = "blocked"; r.reason = result.error || "조율 실행에 실패했습니다."; return; }
        try {
          let proposal;
          try { proposal = parseCoordinatorAction(result.text, { requestId: id, generation: attempt.generation, revision: attempt.requestRevision }); }
          catch (error) {
            if (!(error instanceof PlanProtocolError)) throw error;
            a.protocolError = (error.message || "Invalid plan").slice(0, 1024);
            if (!repair && !r.taskIds.length && !m.events.some(event => event.requestId === id && event.kind === "applied")) {
              repairPlan = { attemptId: a.id, originalProposal: result.text, diagnostic: a.protocolError }; r.status = "received"; return;
            }
            r.status = "blocked"; r.reason = "리더의 계획을 실행 형식으로 확인하지 못했습니다. 새 작업은 시작하지 않았습니다."; return;
          }
          if (repair && proposal.kind !== "propose_plan") { r.status = "blocked"; r.reason = "실행 계획을 다시 확인하지 못했습니다. 새 작업은 시작하지 않았습니다."; return; }
          const clarification = proposal.clarificationRequestId ? m.requests.find(q => q.id === proposal.clarificationRequestId) : undefined;
          if (proposal.clarificationRequestId) {
            const question = m.journal?.filter(e => e.requestId === clarification?.id && e.kind === "clarification").at(-1);
            if (r.provenance === "review" || !clarification || clarification.id === r.id || clarification.sessionId !== r.sessionId || clarification.status !== "clarifying" || clarification.revision !== proposal.clarificationRevision || question?.delivery !== "delivered" || !r.visibleJournalIds?.includes(question.id)) throw new Error("현재 대화에서 확인할 질문이 변경되었습니다.");
          }
          if (r.provenance === "review" && (!["amend", "block", "answer", "clarify", "recheck"].includes(proposal.kind) || ((proposal.kind === "amend" || proposal.kind === "recheck") && (proposal.targetRequestId !== r.reviewTargetId || proposal.targetRevision !== r.reviewTargetRevision)))) throw new Error("내부 검토 판단에는 사람의 실행·수락 권한이 없습니다.");
          if (proposal.kind === "answer" || proposal.kind === "clarify") { r.status = proposal.kind === "clarify" ? "clarifying" : "answered"; r.answer = proposal.text; }
          else if (proposal.kind === "block") { r.status = "blocked"; r.reason = proposal.reason; if (r.provenance === "review") { const target = m.requests.find(x => x.id === r.reviewTargetId); if (target && target.revision === r.reviewTargetRevision && target.status === "paused") target.reason = proposal.reason; } }
          else if (proposal.kind === "propose_plan") {
            if (!this.options.controller) { r.status = "blocked"; r.reason = "작업 실행 소유자가 없습니다."; }
            else {
              if (proposal.parentRequestId) {
                const parent = m.requests.find(x => x.id === proposal.parentRequestId);
                if (!parent || !isAcceptedRequest(s, parent) || parent.revision !== proposal.targetRevision) throw new Error("수락한 후속 대상을 확인할 수 없습니다.");
                r.parentRequestId = parent.id; r.parentReceiptDigest = receiptDigest(s, parent);
              }
              const now = new Date().toISOString();
              const selectedStages = proposal.tasks.map(plan => { const task = { ...plan, id: `mode-${randomUUID()}`, dependsOn: [], status: "queued" as const, createdAt: now, updatedAt: now, attempts: [], checks: [] }; s.tasks.push(task); return task; });
              const writers = selectedStages.filter(t => t.role !== "reviewer"), writer = writers.at(-1);
              const selectedFinalReview = writer && selectedStages.at(-1)?.role === "reviewer" ? selectedStages.at(-1) : undefined;
              const stages = selectedFinalReview ? selectedStages.slice(0, -1) : selectedStages;
              if (proposal.rationale) {
                r.stages = stages.map(t => t.id); r.stageCursor = 0; r.rationale = proposal.rationale;
              }
              if (writer) {
                const reviewerId = selectedFinalReview?.id ?? `mode-${randomUUID()}`;
                if (!selectedFinalReview) s.tasks.push({ id: reviewerId, title: `독립 검토: ${writer.title}`.slice(0, 100), description: "전체 단계와 검증을 독립 검토합니다.", role: "reviewer", dependsOn: [], acceptance: ["전체 구현과 검증 근거를 검토한다."], status: "queued", createdAt: now, updatedAt: now, attempts: [], checks: [] });
                r.taskIds = [writer.id, reviewerId, ...stages.filter(t => t.id !== writer.id).map(t => t.id)];
              } else r.taskIds = stages.map(t => t.id);
              r.checks = proposal.checks; r.checkpoint = "implementation"; r.status = "queued";
            }
          } else if (proposal.kind === "amend") {
            if (r.provenance === "review" && proposal.checks !== undefined) {
              throw new Error("검증 명령을 변경하려면 사용자의 수정 요청이 필요합니다.");
            }
            const target = m.requests.find(x => x.id === proposal.targetRequestId);
            if (!target || isAcceptedRequest(s, target) || target.id === id || !mode.requests.some(x => x.id === target.id && x.revision === target.revision) || !target.taskIds.length || !["queued", "running", "paused", "blocked", "awaiting_user_acceptance"].includes(target.status)) throw new Error("이미 수락한 결과이거나 변경 대상을 확인할 수 없습니다. 수락한 결과의 변경은 새 후속 요청으로 말씀해 주세요.");
            if (proposal.targetRevision !== undefined && target.revision !== proposal.targetRevision) throw new Error("변경 대상 revision이 바뀌었습니다.");
            if (target.stages) {
              if (proposal.targetRevision !== target.revision) throw new Error("현재 단계 revision이 필요합니다.");
              if (!proposal.restartFromTaskId || !proposal.rationale || !target.stages.includes(proposal.restartFromTaskId) || s.tasks.find(t => t.id === proposal.restartFromTaskId)?.role === "reviewer") throw new Error("수정할 단계와 이유가 필요합니다.");
              target.restartFromTaskId = proposal.restartFromTaskId; target.stageCursor = Math.min(target.stageCursor ?? 0, target.stages.indexOf(proposal.restartFromTaskId));
            }
            target.amendments ??= []; target.amendments.push({ requestId: id, instruction: proposal.instruction, timing: proposal.timing, status: "pending", ...(proposal.checks ? { previousChecks: [...(target.checks ?? [])], checks: [...proposal.checks], checksReason: proposal.checksReason! } : {}) });
            if (proposal.checks) target.checks = [...proposal.checks];
            target.revision++; target.checkpoint = "fix"; if (!target.stages) delete target.artifactDigest; if (target.status !== "running") target.status = "queued"; delete target.recheckOnly; delete target.reason;
            if (proposal.timing === "interrupt_then_resume" && target.status === "running") cancelTarget = target.id;
            r.status = "answered"; r.answer = proposal.timing === "after_current" ? "변경을 접수했습니다. 현재 실행이 끝나면 다음 실행에 반영합니다." : "변경을 접수했습니다. 현재 실행의 종료를 확인한 뒤 반영합니다.";
          } else if (proposal.kind === "stop") {
            const target = m.requests.find(x => x.id === proposal.targetRequestId);
            if (!target || target.id === id || !mode.requests.some(x => x.id === target.id && x.revision === target.revision) || !["received", "classifying", "queued", "running", "paused", "blocked"].includes(target.status)) throw new Error("중단 대상을 확인할 수 없습니다.");
            if ((target.stages && proposal.targetRevision !== target.revision) || (proposal.targetRevision !== undefined && target.revision !== proposal.targetRevision)) throw new Error("중단 대상 revision이 바뀌었습니다.");
            target.status = "stopping"; target.revision++; target.reason = "종료를 기다리고 있습니다."; stopTarget = target.id;
            r.status = "answered"; r.answer = "중단 요청을 접수했습니다. 실행 중이면 종료를 확인합니다.";
          } else if (proposal.kind === "resume" || proposal.kind === "recheck" || proposal.kind === "accept") {
            const target = m.requests.find(x => x.id === proposal.targetRequestId);
            if (!target || target.id === id || !mode.requests.some(old => old.id === target.id && old.revision === target.revision) || proposal.targetRevision !== target.revision) throw new Error("대상 revision을 확인할 수 없습니다.");
            if (proposal.kind === "resume") resumeTarget = target.id;
            else if (proposal.kind === "recheck") recheckTarget = target.id;
            else {
              const offer = m.offers?.find(o => o.id === proposal.offerId);
              const journal = offer && m.journal?.find(e => e.id === offer.journalId);
              const evidence = offer && m.reviewEvidence.find(e => e.id === offer.evidenceId);
              const writers = (target.stages ?? [target.taskIds[0]]).map(tid => s.tasks.find(t => t.id === tid)!).filter(t => t.role !== "reviewer").map(t => ({ taskId: t.id, attemptId: t.attempts.at(-1)?.id }));
              if (r.provenance === "review" || m.latestHumanRequestId !== id || !offer || offer.requestId !== target.id || offer.requestRevision !== target.revision || offer.sessionId !== r.sessionId || journal?.delivery !== "delivered" || !r.visibleJournalIds?.includes(offer.journalId) || m.journal?.some(e => e.requestId === target.id && e.requestRevision === target.revision && e.kind === "result" && (e.delivery !== "delivered" || !r.visibleJournalIds?.includes(e.id))) || !evidence || evidence.requestRevision !== target.revision || evidence.id !== m.reviewEvidence.filter(e => e.requestId === target.id).at(-1)?.id || JSON.stringify(writers) !== JSON.stringify(offer.stageAttempts) || !explicitAcceptanceQuote(r.text, proposal.acceptanceQuote)) {
                r.status = "clarifying"; r.answer = "어느 결과를 수락하는지 명확히 말씀해 주세요. 단순 확인은 수락으로 기록하지 않습니다.";
              } else acceptTarget = { id: target.id, revision: target.revision, offerId: offer.id };
            }
            if (r.status === "classifying") { r.status = "answered"; r.answer = proposal.kind === "accept" ? "명시적 수락을 확인합니다." : proposal.kind === "resume" ? "중단한 요청을 이어갑니다." : "현재 결과를 다시 검증합니다."; }
          } else if (proposal.kind === "prioritize") {
            const positions = m.requests.map((item, index) => item.status === "queued" && item.taskIds.length > 0 ? index : -1).filter(index => index >= 0);
            const pending = positions.map(index => m.requests[index]);
            const selected = proposal.orderedRequestIds.map(targetId => pending.find(item => item.id === targetId));
            if (selected.some(item => !item || !mode.requests.some(old => old.id === item.id && old.revision === item.revision))) throw new Error("대기 중인 팀 요청만 우선순위를 바꿀 수 있습니다.");
            const arranged = [...selected, ...pending.filter(item => !proposal.orderedRequestIds.includes(item.id))];
            positions.forEach((position, index) => { m.requests[position] = arranged[index]!; });
            r.status = "answered"; r.answer = "대기 요청의 우선순위를 변경했습니다.";
          }
          if (clarification) { clarification.status = "answered"; clarification.resolvedByRequestId = r.id; }
          m.events.push({ id: randomUUID(), requestId: id, kind: "applied", at: new Date().toISOString() });
        } catch (error) { r.status = "blocked"; r.reason = `리더 판단을 적용하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`.slice(0, 4096); }
      });
      if (repairPlan) {
        recordChat(this.store, id, "progress", "작업을 시작하기 전에 계획의 의존성과 검증 명령을 다시 확인합니다."); this.notify();
        await this.coordinate(id, signal, repairPlan); return;
      }
      try {
        if (resumeTarget) this.resume(resumeTarget);
        if (recheckTarget) this.recheck(recheckTarget);
        if (acceptTarget) {
          const current = this.store.snapshot(), human = current.teamMode!.requests.find(x => x.id === id)!, offer = current.teamMode!.offers!.find(o => o.id === acceptTarget!.offerId)!;
          this.store.assertOwner();
          if (this.closed || signal.aborted || current.id !== snapshot.id || !current.teamMode?.enabled || current.teamMode.generation !== attempt.generation || current.teamMode.latestHumanRequestId !== id || human.provenance === "review" || human.revision !== attempt.requestRevision || !this.options.canAccept?.(human, offer)) throw new Error("현재 대화의 수락 권한이 변경되었습니다. 결과를 다시 확인하고 명시적으로 수락해 주세요.");
          // Re-read after the live adapter fence. No asynchronous gap is allowed before the controller's atomic acceptance.
          const fenced = this.store.snapshot(), target = fenced.teamMode!.requests.find(x => x.id === acceptTarget!.id)!;
          if (fenced.teamMode?.latestHumanRequestId !== id || fenced.teamMode.generation !== attempt.generation || !fenced.teamMode.enabled || target.revision !== acceptTarget.revision) throw new Error("수락 확인 이후 요청이 변경되었습니다.");
          this.store.assertOwner(); this.options.controller!.accept(target.taskIds[0]);
        }
      } catch (error) { this.store.update(s => { const r = s.teamMode!.requests.find(x => x.id === id)!; r.status = "blocked"; r.reason = error instanceof Error ? error.message : String(error); delete r.answer; }); }
      if (stopTarget) await this.settleStop(stopTarget);
      if (cancelTarget) {
        const current = this.store.snapshot(), target = current.teamMode?.requests.find(x => x.id === cancelTarget), operation = this.options.controller?.activeOperation;
        if (current.teamMode?.enabled && current.teamMode.generation === attempt.generation && target && operation?.taskId && target.taskIds.includes(operation.taskId)) await this.options.controller?.cancel();
      }
    } catch (error) {
      this.store.update(s => { const r = s.teamMode?.requests.find(x => x.id === id); if (r && (r.status === "received" || r.status === "classifying")) { r.status = "blocked"; r.reason = String(error).slice(0, 1000); } });
    }
    const finished = this.snapshot()?.requests.find(r => r.id === id);
    if (finished?.answer || finished?.reason) recordChat(this.store, id, finished.status === "clarifying" ? "clarification" : "answer", finished.answer || finished.reason!);
    else if (finished?.status === "queued") recordChat(this.store, id, "progress", `${finished.text} · revision ${finished.revision}\n${finished.rationale || "작업과 독립 검토를 시작합니다."}\n${finished.stages?.map(tid => this.store.snapshot().tasks.find(t => t.id === tid)!.title).join(" → ") || ""}`);
    this.notify();
  }

  private scheduleExecution(): void {
    if (this.closed || this.execution || this.schedulingFailure || !this.options.controller || this.options.controller.busy) return;
    const state = this.store.snapshot(), mode = state.teamMode;
    const request = mode?.enabled && !state.recoveryRequired && mode.requests.find(r => r.status === "queued" && r.taskIds.length > 0);
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
        if (request.stages && !rechecking && (request.stageCursor ?? 0) < request.stages.length) {
          if (request.stages.some(tid => state.tasks.find(t => t.id === tid)?.role !== "reviewer") && (request.stageCursor ?? 0) > 0 && (!request.artifactDigest || artifactDigest(this.store.root) !== request.artifactDigest)) { pause("이전 단계 이후 파일이 변경되었습니다. 수정 범위를 다시 확인하세요."); return; }
          for (let cursor = request.stageCursor ?? 0; cursor < request.stages.length; cursor++) {
            const taskId = request.stages[cursor], task = this.store.snapshot().tasks.find(t => t.id === taskId)!;
            recordChat(this.store, id, "progress", `${request.text} · revision ${revision}\n${task.title} (${task.role}) 시작`); this.notify();
            await controller.runManaged(id, taskId, generation, instruction, revision);
            if (!this.allowed(id, generation, revision)) {
              // A running stage can finish after an after-current amendment. Preserve its real artifact, but do not advance the new revision's restart cursor.
              const latest = this.store.snapshot(), current = latest.teamMode!.requests.find(r => r.id === id)!, completed = latest.tasks.find(t => t.id === taskId)!;
              this.store.update(s => {
                const r = s.teamMode!.requests.find(r => r.id === id)!;
                if (r.stages!.some(tid => s.tasks.find(t => t.id === tid)?.role !== "reviewer")) r.artifactDigest = artifactDigest(this.store.root);
                if (completed.status === "needs_review") {
                  if (current.revision !== revision && current.amendments?.some(a => a.status === "pending")) r.stageCursor = Math.min(cursor + 1, r.stages!.indexOf(r.restartFromTaskId!));
                  else if (current.revision === revision) r.stageCursor = cursor + 1;
                }
              });
              pause("상태가 변경되어 다음 단계를 시작하지 않았습니다."); return;
            }
            const latest = this.store.snapshot().tasks.find(t => t.id === taskId)!;
            if (latest.status !== "needs_review") { pause(`${task.title} 실행이 완료되지 않았습니다.`); return; }
            this.store.update(s => { const r = s.teamMode!.requests.find(r => r.id === id)!; r.stageCursor = cursor + 1; if (r.stages!.some(tid => s.tasks.find(t => t.id === tid)?.role !== "reviewer")) r.artifactDigest = artifactDigest(this.store.root); });
            recordChat(this.store, id, "progress", `${task.title} 결과\n${latest.attempts.at(-1)!.text}`); this.notify();
          }
          this.store.update(s => { const r = s.teamMode!.requests.find(r => r.id === id)!; for (const amendment of r.amendments ?? []) if (pending.some(a => a.requestId === amendment.requestId)) amendment.status = "applied"; delete r.fixInstruction; delete r.restartFromTaskId; r.checkpoint = "checks"; });
          state = this.store.snapshot(); request = state.teamMode!.requests.find(r => r.id === id)!;
        }
        if (request.stages && !request.stages.some(tid => state.tasks.find(t => t.id === tid)?.role !== "reviewer")) {
          this.store.update(s => { const r = s.teamMode!.requests.find(r => r.id === id)!; r.status = "answered"; const answer = request.stages!.map(tid => s.tasks.find(t => t.id === tid)!.attempts.at(-1)!.text).join("\n\n"); if (Buffer.byteLength(answer) <= 16384) r.answer = answer; else delete r.answer; delete r.checkpoint; }); return;
        }
        const resumePhase = request.stages && request.stageCursor === request.stages.length ? (request.checkpoint === "review" || request.checkpoint === "revalidate" ? request.checkpoint : "checks") : !instruction && (request.checkpoint === "checks" || request.checkpoint === "review" || request.checkpoint === "revalidate") ? request.checkpoint : undefined;
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
          recordChat(this.store, id, "progress", `검증 시작: ${command}`); this.notify();
          await controller.check(writerId, command, { requestId: id, generation });
          if (!this.allowed(id, generation, revision)) { pause("상태가 변경되어 다음 검증 단계를 시작하지 않았습니다."); return; }
          const latest = this.store.snapshot().tasks.find(t => t.id === writerId)!.checks.at(-1);
          if (latest) { recordChat(this.store, id, "progress", `검증 ${latest.status}: ${command}\n${latest.output}`); this.notify(); }
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
        const scope = reviewScope(request, writer, checkIds, state.tasks), scopeDigest = reviewScopeDigest(scope);
        const identity = { implementationAttemptId: implementation.id, artifactDigest: digest, checkIds, requestId: id, requestRevision: revision, scopeDigest };
        const prompt = buildReviewerPrompt(identity, scope, implementation.text);
        this.store.update(s => { const r = s.teamMode!.requests.find(r => r.id === id)!; r.checkpoint = "review"; r.artifactDigest = digest; });
        recordChat(this.store, id, "progress", "현재 전체 단계와 검증을 독립 검토합니다."); this.notify();
        await controller.runManagedReview(id, reviewerId, generation, prompt, revision);
        if (!this.allowed(id, generation, revision)) { pause("팀 모드가 꺼져 검토 결과를 적용하지 않았습니다."); return; }
        state = this.store.snapshot(); const reviewer = state.tasks.find(t => t.id === reviewerId)!, attempt = reviewer.attempts.at(-1);
        if (reviewer.status !== "needs_review" || !attempt) { pause("독립 검토가 완료되지 않았습니다."); return; }
        const verdict = parseReviewVerdict(attempt.text, identity);
        if (artifactDigest(this.store.root) !== digest) { pause("검토 중 파일 내용이 변경되었습니다."); return; }
        this.store.update(s => { s.teamMode!.reviewEvidence.push({ id: randomUUID(), requestId: id, implementationTaskId: writerId, implementationAttemptId: implementation.id, reviewerTaskId: reviewerId, reviewerAttemptId: attempt.id, artifactDigest: digest, verdict: verdict.verdict, checkIds, requestRevision: revision, scope, scopeDigest }); });
        recordChat(this.store, id, "review", `독립 검토: ${verdict.verdict}\n${verdict.findings.join("\n")}`); this.notify();
        if (verdict.verdict === "pass") { this.store.update(s => { const r = s.teamMode!.requests.find(x => x.id === id)!; r.status = "awaiting_user_acceptance"; delete r.checkpoint; delete r.recheckOnly; }); return; }
        if (!request.stages && (verdict.verdict === "blocked" || (rechecking && verdict.verdict === "changes_required"))) { pause(verdict.findings.join("\n")); return; }
        if (request.stages) {
          const fingerprint = reviewScopeDigest({ artifactDigest: digest, findings: verdict.findings } as never);
          if (request.reviewFingerprint === fingerprint) { pause("파일 내용과 검토 findings가 동일하여 진전 없는 재시도를 중지했습니다."); return; }
          this.store.update(s => {
            const r = s.teamMode!.requests.find(r => r.id === id)!;
            r.status = "paused"; r.reason = "독립 검토 findings에 따라 리더가 수정 범위를 판단합니다."; r.reviewFingerprint = fingerprint;
            const now = new Date().toISOString();
            s.teamMode!.requests.push({ id: randomUUID(), text: `Internal review for request ${id} revision ${revision}. Decide a targeted amend with restartFromTaskId+rationale, recheck, or block from actual findings: ${verdict.findings.join("\n")}`.slice(0, 16384), origin: request.origin, sessionId: request.sessionId, receivedAt: now, revision: 1, status: "received", taskIds: [], provenance: "review", reviewTargetId: id, reviewTargetRevision: revision, ...(request.branchAnchorId ? { branchAnchorId: request.branchAnchorId } : {}) });
          });
          this.schedule(); return;
        }
        const failure = JSON.stringify({ digest, findings: verdict.findings });
        if (failure === previousFailure) { pause("파일 내용과 검토 결과가 바뀌지 않아 재시도를 중지했습니다."); return; }
        previousFailure = failure; instruction = verdict.findings.join("\n");
        this.store.update(s => { const r = s.teamMode!.requests.find(r => r.id === id)!; r.checkpoint = "fix"; r.fixInstruction = instruction; delete r.artifactDigest; });
      }
      pause("팀 모드 상태가 변경되어 후속 단계를 시작하지 않았습니다.");
    } catch (error) { pause(error instanceof Error ? error.message : String(error)); }
    finally {
      const state = this.store.snapshot(), request = state.teamMode?.requests.find(r => r.id === id);
      if (request?.revision === revision) {
        if (request.status === "awaiting_user_acceptance") offerResult(this.store, id);
        else if (request.status === "answered") recordChat(this.store, id, "result", resultText(state, request));
        else if (request.reason) recordChat(this.store, id, "control", `${request.text} · revision ${revision}\n\n${request.reason}`);
      }
      this.notify();
    }
  }

  async whenIdle(): Promise<void> { while (this.active || this.execution) { if (this.active) await this.active.done; else if (this.execution) await this.execution; } }
  fenceScheduling(): void { this.closed = true; }
  beginShutdown(): void { this.fenceScheduling(); this.active?.abort.abort(); }
  async shutdown(): Promise<void> { this.beginShutdown(); if (this.execution) await this.options.controller?.cancel(); await this.whenIdle(); if (this.schedulingFailure) throw this.schedulingFailure; }
}
