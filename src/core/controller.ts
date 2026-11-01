import { randomUUID } from "node:crypto";
import { appendFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { ProjectStore } from "./store.ts";
import { parsePlan } from "./planning.ts";
import { validateProfile } from "./profiles.ts";
import { emptyUsage } from "./usage.ts";
import { runCheck } from "../runtime/check-runner.ts";
import type { Attempt, ModelProfile, ProjectState, Role, Task, TaskRole, WorkerEvent, WorkerResult, WorkerRunner } from "./types.ts";

export interface ControllerOptions {
  runner: WorkerRunner;
  validateProfile: (profile: ModelProfile) => Promise<void>;
  onChange?: (state: ProjectState, activity: string) => void;
}
export interface RunSummary { executed: string[]; blocked: string[]; waitingReview: string[] }

const READ_TOOLS = ["read", "grep", "find", "ls"] as const;
const WRITE_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;
const PLANNER_SYSTEM = `You are the planning worker for codexteams. Read project files using the available read-only tools. The user goal is authoritative. Return ONLY one JSON object with a tasks array of 1..32 items. Each item must have exactly id (ASCII letters/digits/_/-), title, description, role (developer/designer/reviewer), dependsOn (existing task IDs), acceptance (1..16 observable criteria strings). Use a small number of useful tasks; no cycles. Do not include model, budget, approvals, commands or other policy fields. Do not modify files. For large goals, propose a coherent first implementation milestone and state limits in the task descriptions.`;
const WORKER_SYSTEM = `You are a codexteams task worker. Follow the given project goal, assigned task and original acceptance criteria. Work in the provided project. Never edit .codexteams state, credentials, permissions or acceptance criteria. Do not create other agents or change model/billing settings. Preserve unrelated edits. Inspect actual files before changing them; on resume inspect partial work instead of blindly repeating earlier shell commands. Report changed files, checks actually run with outcomes, and remaining limitations. Do not claim tests you did not execute. Finishing your response does not accept the task; the user or trusted controller performs acceptance.`;

export class TeamController {
  readonly store: ProjectStore;
  private options: ControllerOptions;
  private active: { abort: AbortController; done: Promise<unknown>; kind: "planning" | "execution" } | undefined;
  private closed = false;
  private activity = "준비";

  constructor(store: ProjectStore, options: ControllerOptions) { this.store = store; this.options = options; }
  get busy(): boolean { return this.active !== undefined; }
  get currentActivity(): string { return this.activity; }
  snapshot(): ProjectState { return this.store.snapshot(); }

  private notify(activity = this.activity): void {
    this.activity = activity;
    // UI failures must not corrupt execution or turn a saved result into failure.
    try { this.options.onChange?.(this.snapshot(), activity); } catch { /* display only */ }
  }

  private ensureIdle(): void {
    if (this.closed) throw new Error("종료 중인 팀입니다.");
    if (this.active) throw new Error("이미 작업 또는 검증이 실행 중입니다. /teams cancel로 중단할 수 있습니다.");
  }

  private exclusive<T>(work: (signal: AbortSignal) => Promise<T>, kind: "planning" | "execution" = "execution"): Promise<T> {
    this.ensureIdle();
    if (this.snapshot().recoveryRequired) throw new Error(this.snapshot().recoveryReason || "프로젝트 복구 확인이 필요합니다. /teams recover");
    const abort = new AbortController();
    const done = Promise.resolve().then(() => work(abort.signal)).finally(() => { this.active = undefined; this.notify("준비"); });
    this.active = { abort, done, kind };
    return done;
  }

  private findTask(id: string, state = this.snapshot()): Task {
    const task = state.tasks.find(t => t.id === id);
    if (!task) throw new Error(`작업을 찾을 수 없습니다: ${id}`);
    return task;
  }

  private newAttempt(profile: ModelProfile, previousSessionId?: string): Attempt {
    const id = randomUUID();
    return { id, sessionId: previousSessionId ?? randomUUID(), profile: structuredClone(profile), startedAt: new Date().toISOString(), effectiveModels: [], text: "", usage: emptyUsage(), logFile: `logs/${id}.jsonl` };
  }

  private applyAttempt(attemptId: string, mutator: (attempt: Attempt) => void): void {
    this.store.update(state => {
      const found = [...state.planningAttempts, ...state.tasks.flatMap(t => t.attempts)].find(a => a.id === attemptId);
      if (!found) throw new Error("실행 기록을 찾을 수 없습니다.");
      mutator(found);
    });
  }

  private recordEvent(attempt: Attempt, event: WorkerEvent): void {
    const path = join(this.store.directory, attempt.logFile);
    let bytes = 0;
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error("실행 로그가 심볼릭 링크입니다.");
      bytes = stat.size;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    // Bounded operational log, not a task token/time limit. No reasoning events.
    if (bytes < 16 * 1024 * 1024) appendFileSync(path, JSON.stringify({ at: new Date().toISOString(), ...event, ...(event.type === "text" ? { text: event.text.slice(0,4096) } : {}) }) + "\n", { mode: 0o600 });
    if (event.type === "process") this.applyAttempt(attempt.id, a => { a.workerPid = event.pid; });
    if (event.type === "tool") this.notify(`${event.phase === "start" ? "실행" : "완료"}: ${event.name}`);
    if (event.type === "status") this.notify(event.text);
    if (event.type === "usage") {
      this.applyAttempt(attempt.id, a => {
        a.usage = { ...event.usage, completeness: event.usage.completeness === "unknown" ? "unknown" : "partial" };
        if (event.model && !a.effectiveModels.includes(event.model)) a.effectiveModels.push(event.model);
      });
      this.notify("응답 사용량 수신");
    }
  }

  private async executeAttempt(attempt: Attempt, prompt: string, systemPrompt: string, tools: readonly string[], signal: AbortSignal): Promise<WorkerResult> {
    let result: WorkerResult;
    try {
      signal.throwIfAborted();
      result = await this.options.runner({ cwd: this.store.root, prompt, systemPrompt, profile: attempt.profile, tools, sessionId: attempt.sessionId, sessionDir: join(this.store.directory, "sessions"), signal, onEvent: event => this.recordEvent(attempt, event) });
    } catch (error) {
      result = { outcome: signal.aborted ? "aborted" : "failed", text: "", error: error instanceof Error ? error.message : String(error), exitCode: null, usage: emptyUsage(), effectiveModels: [], sessionId: attempt.sessionId };
    }
    if (signal.aborted && result.outcome === "success") result = { ...result, outcome: "aborted" };
    this.applyAttempt(attempt.id, a => {
      a.endedAt = new Date().toISOString(); a.outcome = result.outcome;
      a.text = result.text; a.error = result.error; a.usage = result.usage; a.effectiveModels = result.effectiveModels;
    });
    return result;
  }

  async start(goal: string): Promise<Task[]> {
    return this.exclusive(async signal => {
      const before = this.snapshot();
      if (before.tasks.length) throw new Error("이미 작업이 있습니다. 후속 작업은 /teams add로 추가하세요.");
      const requested = goal.trim() || before.goal;
      if (!requested || Buffer.byteLength(requested) > 16384) throw new Error("목표는 1~16384바이트로 입력하세요.");
      if (before.goal && requested !== before.goal) throw new Error("기존 목표를 덮어쓰지 않습니다. 같은 목표로 재시도하거나 다른 프로젝트를 여세요.");
      const profile = before.profiles.planner;
      await this.options.validateProfile(profile); signal.throwIfAborted();
      const attempt = this.newAttempt(profile);
      this.store.update(state => { state.goal = requested; state.planningAttempts.push(attempt); });
      this.notify("계획 생성 중");
      const result = await this.executeAttempt(attempt, `사용자 목표:\n${requested}\n\n프로젝트를 조사해 실행할 첫 단계의 계획을 JSON으로 작성하세요.`, PLANNER_SYSTEM, READ_TOOLS, signal);
      if (result.outcome !== "success") throw new Error(result.error || (result.outcome === "aborted" ? "계획 생성이 중단되었습니다." : "계획 생성 실패"));
      let tasks: Task[];
      try {
        const time = new Date().toISOString();
        tasks = parsePlan(result.text).map(task => ({ ...task, status: "queued", createdAt: time, updatedAt: time, attempts: [], checks: [] }));
      } catch (error) {
        this.applyAttempt(attempt.id, a => { a.outcome = "failed"; a.error = error instanceof Error ? error.message : String(error); });
        throw error;
      }
      this.store.update(state => { state.tasks.push(...tasks); });
      this.notify(`${tasks.length}개 작업 준비`);
      return tasks;
    }, "planning");
  }

  add(role: TaskRole, description: string): Task {
    if (this.closed) throw new Error("종료 중인 팀입니다.");
    if (this.active?.kind === "planning") throw new Error("계획 생성 중에는 작업을 추가할 수 없습니다. 계획이 끝난 뒤 /teams add를 사용하세요.");
    if (!["developer", "designer", "reviewer"].includes(role)) throw new Error("작업 역할은 developer/designer/reviewer입니다.");
    const value = description.trim();
    if (!value || Buffer.byteLength(value) > 16384) throw new Error("작업 내용을 1~16384바이트로 입력하세요.");
    const state = this.snapshot();
    let index = state.tasks.length + 1;
    while (state.tasks.some(task => task.id === `task-${index}`)) index++;
    const now = new Date().toISOString();
    const task: Task = { id: `task-${index}`, title: value.split("\n")[0].slice(0, 70), description: value, role, dependsOn: [], acceptance: ["요청한 변경을 구현하고 실제 검증 결과와 남은 제약을 보고한다."], status: "queued", createdAt: now, updatedAt: now, attempts: [], checks: [] };
    this.store.update(next => { if (!next.goal) next.goal = value; next.tasks.push(task); });
    this.notify(`작업 추가: ${task.id}`); return task;
  }

  private async runTask(id: string, signal: AbortSignal, revision = ""): Promise<void> {
    const snapshot = this.snapshot();
    const task = this.findTask(id, snapshot);
    if (task.dependsOn.some(dep => this.findTask(dep, snapshot).status !== "completed")) throw new Error(`${id}: 선행 작업 수락이 필요합니다.`);
    const profile = snapshot.profiles[task.role];
    await this.options.validateProfile(profile); signal.throwIfAborted();
    const attempt = this.newAttempt(profile, task.attempts.at(-1)?.sessionId);
    this.store.update(state => { const t = this.findTask(id, state); t.status = "running"; t.updatedAt = attempt.startedAt; t.attempts.push(attempt); delete t.acceptedAt; delete t.acceptanceSource; delete t.acceptedAttemptId; delete t.acceptedCheckIds; });
    this.notify(`${id}: ${task.role} 실행`);
    const dependencies = task.dependsOn.map(dep => {
      const other = this.findTask(dep, snapshot);
      return { id: dep, title: other.title, result: other.attempts.at(-1)?.text.slice(-8000) };
    });
    const prompt = `프로젝트 목표:\n${snapshot.goal}\n\n현재 작업:\n${JSON.stringify({ id: task.id, title: task.title, description: task.description, acceptance: task.acceptance, dependencies }, null, 2)}\n\n${task.attempts.length ? "재개 작업입니다. 현재 파일 상태와 이전 부분 변경을 먼저 확인하세요.\n" : ""}${revision ? `추가 수정 지시:\n${revision}\n` : ""}`;
    const result = await this.executeAttempt(attempt, prompt, WORKER_SYSTEM, task.role === "reviewer" ? READ_TOOLS : WRITE_TOOLS, signal);
    this.store.update(state => { const t = this.findTask(id, state); t.status = result.outcome === "success" ? "needs_review" : result.outcome === "aborted" ? "interrupted" : "failed"; t.updatedAt = new Date().toISOString(); });
    this.notify(`${id}: ${this.findTask(id).status}`);
  }

  async run(id?: string): Promise<RunSummary> {
    return this.exclusive(async signal => {
      const executed: string[] = [];
      if (id && this.findTask(id).status !== "queued") throw new Error("대기 작업만 run할 수 있습니다. 수정·재시도는 /teams resume를 사용하세요.");
      while (!signal.aborted) {
        const state = this.snapshot();
        const next = id ? this.findTask(id, state) : state.tasks.find(t => t.status === "queued" && t.dependsOn.every(dep => this.findTask(dep, state).status === "completed"));
        if (!next || next.status !== "queued") break;
        await this.runTask(next.id, signal); executed.push(next.id);
        if (id || ["failed", "interrupted"].includes(this.findTask(next.id).status)) break;
      }
      const state = this.snapshot();
      return { executed, blocked: state.tasks.filter(t => t.status === "queued").map(t => t.id), waitingReview: state.tasks.filter(t => t.status === "needs_review").map(t => t.id) };
    });
  }

  async resume(id: string, instruction = ""): Promise<void> {
    return this.exclusive(async signal => {
      if (!["failed", "interrupted", "needs_review"].includes(this.findTask(id).status)) throw new Error("실패·중단·검토 대기 작업만 재개할 수 있습니다.");
      if (Buffer.byteLength(instruction) > 16384) throw new Error("수정 지시가 너무 깁니다.");
      await this.runTask(id, signal, instruction);
    });
  }

  async check(id: string, command: string): Promise<void> {
    return this.exclusive(async signal => {
      const task = this.findTask(id);
      const attempt = task.attempts.at(-1);
      if (task.status !== "needs_review" || !attempt) throw new Error("검토 대기 상태의 실행 결과만 검증할 수 있습니다.");
      if (!command.trim() || Buffer.byteLength(command) > 16384) throw new Error("검증 명령을 입력하세요.");
      const checkId = randomUUID();
      this.store.update(state => { this.findTask(id, state).checks.push({ id: checkId, attemptId: attempt.id, command, startedAt: new Date().toISOString(), exitCode: null, output: "", status: "running" }); });
      this.notify(`${id}: 검증 명령 실행`);
      const result = await runCheck({ cwd: this.store.root, command, signal, onProcess: pid => this.store.update(state => { const check = this.findTask(id, state).checks.find(c => c.id === checkId)!; check.workerPid = pid; }) });
      this.store.update(state => { const check = this.findTask(id, state).checks.find(c => c.id === checkId)!; check.endedAt = new Date().toISOString(); check.exitCode = result.exitCode; check.output = result.output; check.status = result.interrupted ? "interrupted" : result.exitCode === 0 ? "passed" : "failed"; });
    });
  }

  accept(id: string): void {
    this.ensureIdle();
    if (this.snapshot().recoveryRequired) throw new Error("프로젝트 복구 확인 전에는 작업을 수락할 수 없습니다. /teams recover");
    const task = this.findTask(id);
    if (task.status !== "needs_review" || !task.attempts.at(-1)) throw new Error("검토 대기 작업만 수락할 수 있습니다.");
    this.store.update(state => {
      const t = this.findTask(id, state); const attempt = t.attempts.at(-1)!;
      t.status = "completed"; t.updatedAt = t.acceptedAt = new Date().toISOString(); t.acceptanceSource = "user"; t.acceptedAttemptId = attempt.id; t.acceptedCheckIds = t.checks.filter(c => c.attemptId === attempt.id).map(c => c.id);
    });
    this.notify(`${id}: 사용자 수락`);
  }

  setProfile(role: Role, profile: ModelProfile): void {
    if (this.closed) throw new Error("종료 중인 팀입니다.");
    if (!["planner", "developer", "designer", "reviewer"].includes(role)) throw new Error("알 수 없는 역할입니다.");
    const checked = validateProfile(profile);
    this.store.update(state => { state.profiles[role] = checked; });
    this.notify(`${role} 프로필 변경 (다음 실행부터 적용)`);
  }

  recover(confirmed: boolean): void {
    this.ensureIdle();
    if (!this.snapshot().recoveryRequired) return;
    if (!confirmed) throw new Error("남은 프로세스와 변경 파일을 직접 확인해야 합니다.");
    const snapshot = this.snapshot();
    const entries = [...snapshot.planningAttempts, ...snapshot.tasks.flatMap(t => [...t.attempts, ...t.checks])];
    for (const entry of entries.filter(a => a.recoveryPending && a.workerPid)) {
      const pid = entry.workerPid!;
      for (const candidate of process.platform === "win32" ? [pid] : [pid, -pid]) {
        try { process.kill(candidate, 0); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") continue; throw new Error(`이전 프로세스 확인에 실패했습니다 (PID ${pid}).`); }
        throw new Error(`이전 작업 프로세스가 아직 존재합니다 (PID ${pid}). 종료를 확인한 후 복구하세요.`);
      }
    }
    this.store.update(state => { state.recoveryRequired = false; delete state.recoveryReason; for (const a of [...state.planningAttempts, ...state.tasks.flatMap(t => [...t.attempts, ...t.checks])]) a.recoveryPending = false; });
    this.notify("복구 확인 완료 — /teams resume <id>");
  }

  async cancel(): Promise<void> {
    const current = this.active;
    if (!current) return;
    this.notify("중단 요청 — 프로세스 종료 확인 중"); current.abort.abort();
    try { await current.done; } catch { /* caller receives original error */ }
  }

  async shutdown(): Promise<void> {
    if (this.closed) return;
    this.closed = true; await this.cancel(); this.store.close();
  }
}
