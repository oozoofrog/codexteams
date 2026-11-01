import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { defaultProfiles, validateProfile } from "./profiles.ts";
import type { Attempt, ProjectState, Role, UsageSummary, VerificationCheck } from "./types.ts";

interface Lock { pid: number; hostname: string; nonce: string; startedAt: string }
const statuses = new Set(["queued", "running", "needs_review", "completed", "failed", "interrupted", "cancelled"]);

function validDate(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function validId(value: unknown): value is string { return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value); }
function validPid(value: unknown): boolean { return value === undefined || (typeof value === "number" && Number.isSafeInteger(value) && value > 0); }

function validateUsage(usage: UsageSummary): void {
  if (!usage || !["known", "partial", "unknown"].includes(usage.completeness) || !Number.isSafeInteger(usage.responses) || usage.responses < 0) throw new Error("손상된 사용량 state입니다.");
  for (const name of ["input", "output", "cacheRead", "cacheWrite", "reasoning", "totalTokens", "costUsd"] as const) {
    const value = usage[name];
    if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw new Error("손상된 사용량 state입니다.");
  }
}

function validateAttempt(attempt: Attempt, seen: Set<string>): void {
  if (!attempt || !validId(attempt.id) || seen.has(attempt.id) || !validId(attempt.sessionId) || !validDate(attempt.startedAt) || !validPid(attempt.workerPid) || typeof attempt.text !== "string" || !Array.isArray(attempt.effectiveModels) || attempt.effectiveModels.some(m => typeof m !== "string") || attempt.logFile !== `logs/${attempt.id}.jsonl`) throw new Error("손상된 실행 시도 state입니다.");
  if (attempt.endedAt !== undefined && (!validDate(attempt.endedAt) || !["success", "failed", "aborted"].includes(attempt.outcome as string))) throw new Error("실행 종료 state가 일치하지 않습니다.");
  if (attempt.outcome !== undefined && !attempt.endedAt) throw new Error("실행 종료 시각이 없는 state입니다.");
  if (attempt.error !== undefined && typeof attempt.error !== "string") throw new Error("손상된 실행 오류 state입니다.");
  if (attempt.recoveryPending !== undefined && typeof attempt.recoveryPending !== "boolean") throw new Error("손상된 복구 state입니다.");
  validateProfile(attempt.profile); validateUsage(attempt.usage); seen.add(attempt.id);
}

function validateCheck(check: VerificationCheck, attempts: Attempt[], seen: Set<string>): void {
  if (!check || !validId(check.id) || seen.has(check.id) || typeof check.command !== "string" || !check.command.trim() || !attempts.some(a => a.id === check.attemptId) || !validDate(check.startedAt) || !validPid(check.workerPid) || typeof check.output !== "string" || !["running", "passed", "failed", "interrupted"].includes(check.status)) throw new Error("손상된 검증 state입니다.");
  if (check.exitCode !== null && !Number.isInteger(check.exitCode)) throw new Error("잘못된 검증 종료 코드입니다.");
  if (check.status === "running" ? check.endedAt !== undefined || check.exitCode !== null : !validDate(check.endedAt)) throw new Error("검증 종료 state가 일치하지 않습니다.");
  if (check.status === "passed" && check.exitCode !== 0) throw new Error("통과 검증의 종료 코드가 0이 아닙니다.");
  if (check.status === "failed" && check.exitCode === 0) throw new Error("실패 검증의 종료 코드가 0입니다.");
  seen.add(check.id);
}

function noSymlink(path: string): void {
  try { if (lstatSync(path).isSymbolicLink()) throw new Error(`심볼릭 링크를 상태 경로로 사용할 수 없습니다: ${path}`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

function alive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

function validateState(state: ProjectState, root: string): void {
  if (!state || state.schemaVersion !== 1 || state.root !== root || !validId(state.id) || !Number.isSafeInteger(state.revision) || state.revision < 0 || typeof state.goal !== "string" || !validDate(state.createdAt) || !validDate(state.updatedAt) || !Array.isArray(state.tasks) || !Array.isArray(state.planningAttempts) || !state.profiles || (state.recoveryRequired !== undefined && typeof state.recoveryRequired !== "boolean")) throw new Error("지원하지 않거나 손상된 프로젝트 state입니다.");
  for (const role of ["planner", "developer", "designer", "reviewer"] as Role[]) validateProfile(state.profiles[role]);
  const ids = new Set<string>();
  const attemptIds = new Set<string>();
  const checkIds = new Set<string>();
  for (const attempt of state.planningAttempts) validateAttempt(attempt, attemptIds);
  for (const task of state.tasks) {
    if (!task || typeof task.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(task.id) || ids.has(task.id) || !statuses.has(task.status) || !["developer", "designer", "reviewer"].includes(task.role) || typeof task.title !== "string" || !task.title.trim() || typeof task.description !== "string" || !task.description.trim() || !validDate(task.createdAt) || !validDate(task.updatedAt) || !Array.isArray(task.acceptance) || !task.acceptance.length || task.acceptance.some(a => typeof a !== "string" || !a.trim()) || !Array.isArray(task.dependsOn) || task.dependsOn.some(d => typeof d !== "string") || new Set(task.dependsOn).size !== task.dependsOn.length || !Array.isArray(task.attempts) || !Array.isArray(task.checks)) throw new Error("손상된 작업 state입니다.");
    for (const attempt of task.attempts) validateAttempt(attempt, attemptIds);
    for (const check of task.checks) validateCheck(check, task.attempts, checkIds);
    const latest = task.attempts.at(-1);
    if (["needs_review", "completed"].includes(task.status) && (!latest || latest.outcome !== "success" || !latest.endedAt)) throw new Error("검토·완료 상태에 성공한 실행 기록이 없습니다.");
    if (task.status === "completed" && (!validDate(task.acceptedAt) || task.acceptanceSource !== "user" || task.acceptedAttemptId !== latest!.id || !Array.isArray(task.acceptedCheckIds) || task.acceptedCheckIds.some(id => !task.checks.some(c => c.id === id && c.attemptId === latest!.id)))) throw new Error("작업 수락 증거 state가 일치하지 않습니다.");
    ids.add(task.id);
  }
  for (const task of state.tasks) if (task.dependsOn.some(id => !ids.has(id))) throw new Error("state 의존 작업이 없습니다.");
  const byId = new Map(state.tasks.map(task => [task.id, task]));
  const complete = new Set<string>(); const active = new Set<string>();
  const visit = (id: string): void => {
    if (active.has(id)) throw new Error("state 작업 의존성에 cycle이 있습니다.");
    if (complete.has(id)) return;
    active.add(id); for (const dependency of byId.get(id)!.dependsOn) visit(dependency);
    active.delete(id); complete.add(id);
  };
  for (const id of ids) visit(id);
}

function loadState(path: string, root: string): ProjectState {
  noSymlink(path);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as ProjectState;
  validateState(parsed, root);
  return parsed;
}

export class ProjectStore {
  readonly root: string;
  readonly directory: string;
  private state: ProjectState;
  private lock: Lock;
  private closed = false;

  private constructor(root: string, directory: string, state: ProjectState, lock: Lock) {
    this.root = root; this.directory = directory; this.state = state; this.lock = lock;
  }

  static read(root: string): ProjectState | null {
    const canonical = realpathSync(root);
    const directory = join(canonical, ".codexteams");
    noSymlink(directory);
    const file = join(directory, "state.json");
    return existsSync(file) ? loadState(file, canonical) : null;
  }

  static open(root: string): ProjectStore {
    const canonical = realpathSync(root);
    const directory = join(canonical, ".codexteams");
    noSymlink(directory);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    for (const name of ["sessions", "logs"]) {
      const path = join(directory, name); noSymlink(path); mkdirSync(path, { mode: 0o700, recursive: true });
    }
    const lockPath = join(directory, "lock.json");
    const lock: Lock = { pid: process.pid, hostname: hostname(), nonce: randomUUID(), startedAt: new Date().toISOString() };
    const writeLock = () => {
      noSymlink(lockPath);
      const fd = openSync(lockPath, "wx", 0o600);
      try { writeFileSync(fd, JSON.stringify(lock)); fsyncSync(fd); } finally { closeSync(fd); }
    };
    try { writeLock(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const guardPath = join(directory, "recovery.lock"); noSymlink(guardPath);
      let guard: number;
      try { guard = openSync(guardPath, "wx", 0o600); }
      catch { throw new Error("프로젝트 잠금 복구가 진행 중이거나 중단되었습니다. 기존 Pi 프로세스를 확인하세요."); }
      try {
        noSymlink(lockPath);
        if (existsSync(lockPath)) {
          const old = JSON.parse(readFileSync(lockPath, "utf8")) as Lock;
          if (old.hostname !== hostname()) throw new Error("다른 호스트의 프로젝트 잠금입니다. 자동으로 제거하지 않습니다.");
          if (alive(old.pid)) throw new Error(`다른 Pi 세션이 이 프로젝트를 사용 중입니다 (PID ${old.pid}).`);
          unlinkSync(lockPath);
        }
        writeLock();
      } finally { closeSync(guard); unlinkSync(guardPath); }
    }
    const timestamp = new Date().toISOString();
    const fresh: ProjectState = { schemaVersion: 1, id: randomUUID(), root: canonical, revision: 0, goal: "", createdAt: timestamp, updatedAt: timestamp, profiles: defaultProfiles(), tasks: [], planningAttempts: [] };
    const store = new ProjectStore(canonical, directory, fresh, lock);
    try {
      const file = join(directory, "state.json");
      noSymlink(file);
      if (existsSync(file)) store.state = loadState(file, canonical);
      else store.persist(fresh);
      const unfinished = store.state.tasks.some(t => t.status === "running" || t.attempts.some(a => !a.endedAt) || t.checks.some(c => c.status === "running")) || store.state.planningAttempts.some(a => !a.endedAt);
      if (unfinished) store.update(state => {
        state.recoveryRequired = true;
        state.recoveryReason = "이전 Pi 실행이 정상적으로 종료되지 않았습니다. 남은 프로세스와 파일 상태를 확인한 후 /teams recover를 실행하세요.";
        for (const task of state.tasks) {
          if (task.status === "running" || task.attempts.some(a => !a.endedAt)) { task.status = "interrupted"; task.updatedAt = timestamp; }
          for (const attempt of task.attempts) if (!attempt.endedAt) { attempt.endedAt = timestamp; attempt.outcome = "aborted"; attempt.recoveryPending = true; attempt.error = "이전 실행이 중단되었습니다."; if (attempt.usage.completeness === "known") attempt.usage.completeness = "partial"; }
          for (const check of task.checks) if (check.status === "running") { check.status = "interrupted"; check.recoveryPending = true; check.endedAt = timestamp; }
        }
        for (const attempt of state.planningAttempts) if (!attempt.endedAt) { attempt.endedAt = timestamp; attempt.outcome = "aborted"; attempt.recoveryPending = true; attempt.error = "계획 생성이 중단되었습니다."; if (attempt.usage.completeness === "known") attempt.usage.completeness = "partial"; }
      });
      return store;
    } catch (error) { store.close(); throw error; }
  }

  snapshot(): ProjectState { return structuredClone(this.state); }

  update(mutator: (state: ProjectState) => void): ProjectState {
    if (this.closed) throw new Error("프로젝트 저장소가 닫혔습니다.");
    this.assertOwner();
    const next = this.snapshot(); mutator(next);
    validateState(next, this.root);
    next.revision = this.state.revision + 1; next.updatedAt = new Date().toISOString();
    this.persist(next); this.state = next;
    return this.snapshot();
  }

  private assertOwner(): void {
    const lockPath = join(this.directory, "lock.json"); noSymlink(lockPath);
    const current = JSON.parse(readFileSync(lockPath, "utf8")) as Lock;
    if (current.nonce !== this.lock.nonce) throw new Error("프로젝트 잠금 소유자가 변경되었습니다. 실행을 중단합니다.");
  }

  private persist(state: ProjectState): void {
    const file = join(this.directory, "state.json"); noSymlink(file);
    const temporary = join(this.directory, `state.${randomUUID()}.tmp`);
    const fd = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(fd, JSON.stringify(state, null, 2) + "\n"); fsyncSync(fd);
    } finally { closeSync(fd); }
    try { noSymlink(file); renameSync(temporary, file); }
    finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }

  close(): void {
    if (this.closed) return;
    try {
      const lockPath = join(this.directory, "lock.json"); noSymlink(lockPath);
      if (existsSync(lockPath)) {
        const current = JSON.parse(readFileSync(lockPath, "utf8")) as Lock;
        if (current.nonce === this.lock.nonce) unlinkSync(lockPath);
      }
    } finally { this.closed = true; }
  }
}
