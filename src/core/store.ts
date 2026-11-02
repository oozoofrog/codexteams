import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { defaultProfiles } from "./profiles.ts";
import { validateState as validateSharedState } from "./state-validation.mjs";
import type { ProjectState } from "./types.ts";

interface Lock { pid: number; hostname: string; nonce: string; startedAt: string }
function noSymlink(path: string): void {
  try { if (lstatSync(path).isSymbolicLink()) throw new Error(`심볼릭 링크를 상태 경로로 사용할 수 없습니다: ${path}`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

function alive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

function loadState(path: string, root: string): ProjectState {
  noSymlink(path);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as ProjectState;
  validateSharedState(parsed, root);
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
      const unfinished = store.state.tasks.some(t => t.status === "running" || t.attempts.some(a => !a.endedAt) || t.checks.some(c => c.status === "running")) || store.state.planningAttempts.some(a => !a.endedAt) || Boolean(store.state.teamMode?.coordinatorAttempts.some(a => !a.endedAt));
      if (unfinished) store.update(state => {
        state.recoveryRequired = true;
        state.recoveryReason = "이전 Pi 실행이 정상적으로 종료되지 않았습니다. 남은 프로세스와 파일 상태를 확인한 후 /teams recover를 실행하세요.";
        for (const task of state.tasks) {
          if (task.status === "running" || task.attempts.some(a => !a.endedAt)) { task.status = "interrupted"; task.updatedAt = timestamp; }
          for (const attempt of task.attempts) if (!attempt.endedAt) { attempt.endedAt = timestamp; attempt.outcome = "aborted"; attempt.recoveryPending = true; attempt.error = "이전 실행이 중단되었습니다."; if (attempt.usage.completeness === "known") attempt.usage.completeness = "partial"; }
          for (const check of task.checks) if (check.status === "running") { check.status = "interrupted"; check.recoveryPending = true; check.endedAt = timestamp; }
        }
        for (const attempt of state.planningAttempts) if (!attempt.endedAt) { attempt.endedAt = timestamp; attempt.outcome = "aborted"; attempt.recoveryPending = true; attempt.error = "계획 생성이 중단되었습니다."; if (attempt.usage.completeness === "known") attempt.usage.completeness = "partial"; }
        for (const attempt of state.teamMode?.coordinatorAttempts ?? []) if (!attempt.endedAt) {
          attempt.endedAt = timestamp; attempt.outcome = "aborted"; attempt.recoveryPending = true; attempt.error = "조율 실행이 중단되었습니다.";
          if (attempt.usage.completeness === "known") attempt.usage.completeness = "partial";
          const request = state.teamMode!.requests.find(r => r.id === attempt.requestId);
          if (request && request.status === "classifying") { request.status = "paused"; request.reason = "이전 조율 실행의 복구 확인이 필요합니다."; }
        }
      });
      // A persisted ON flag is not permission to replay requests after a process restart.
      if (store.state.teamMode?.requests.some(r => ["received", "classifying", "queued", "running"].includes(r.status))) store.update(state => {
        for (const request of state.teamMode!.requests) if (["received", "classifying", "queued", "running"].includes(request.status)) { request.status = "paused"; request.reason = "이전 요청은 명시적으로 재개해야 합니다."; }
      });
      return store;
    } catch (error) { store.close(); throw error; }
  }

  snapshot(): ProjectState { return structuredClone(this.state); }

  update(mutator: (state: ProjectState) => void): ProjectState {
    if (this.closed) throw new Error("프로젝트 저장소가 닫혔습니다.");
    this.assertOwner();
    const next = this.snapshot(); mutator(next);
    validateSharedState(next, this.root);
    next.revision = this.state.revision + 1; next.updatedAt = new Date().toISOString();
    this.persist(next); this.state = next;
    return this.snapshot();
  }

  assertOwner(): void {
    if (this.closed) throw new Error("프로젝트 저장소가 닫혔습니다.");
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
    const lockPath = join(this.directory, "lock.json"); noSymlink(lockPath);
    if (existsSync(lockPath)) {
      const current = JSON.parse(readFileSync(lockPath, "utf8")) as Lock;
      if (current.nonce === this.lock.nonce) unlinkSync(lockPath);
    }
    this.closed = true;
  }
}
