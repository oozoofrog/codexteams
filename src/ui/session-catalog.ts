import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ProjectState, Attempt } from "../core/types.ts";

export function sessionStatus(root: string, attempt?: Attempt): string {
  if (!attempt) return "실행 기록 없음";
  try {
    const dir = join(root, ".codexteams", "sessions");
    const files = readdirSync(dir).filter(name => name.endsWith(`_${attempt.sessionId}.jsonl`));
    if (!files.length) return attempt.endedAt ? "파일 누락" : "파일 준비 중";
    if (files.length > 1) return "세션 중복";
    const stat = lstatSync(join(dir, files[0]));
    if (!stat.isFile() || stat.isSymbolicLink()) return "안전하지 않은 세션 파일";
    if (attempt.endedAt) return "기록 있음";
    return Date.now() - stat.mtimeMs > 60_000 ? "기록 응답 지연 (60초 이상 갱신 없음)" : "실행 중";
  } catch { return attempt.endedAt ? "파일 누락" : "파일 준비 중"; }
}

export interface CatalogItem { kind: "task" | "planning"; id: string; workerSessionId?: string; label: string }
export function catalog(state: ProjectState, activity = ""): CatalogItem[] {
  const planning = state.planningAttempts.map(attempt => ({
    kind: "planning" as const, id: attempt.id, workerSessionId: attempt.sessionId,
    label: `계획 ${attempt.id} · ${state.recoveryRequired ? "복구 필요 · " : ""}${attempt.outcome ?? "진행 중"} · ${sessionStatus(state.root, attempt)} · planner · ${attempt.profile.provider}/${attempt.profile.model} / ${attempt.profile.effort} · 실제 ${attempt.effectiveModels.join(", ") || "확인 대기"} · ${attempt.endedAt ?? attempt.startedAt}${activity ? ` · ${activity}` : ""}`,
  }));
  const tasks = state.tasks.map(task => {
    const attempt = task.attempts.at(-1), profile = attempt?.profile ?? state.profiles[task.role];
    return { kind: "task" as const, id: task.id, workerSessionId: attempt?.sessionId,
      label: `${task.id} · ${state.recoveryRequired ? "복구 필요 · " : ""}${task.status} · ${task.role} · ${profile.provider}/${profile.model} / ${profile.effort} · 실제 ${attempt?.effectiveModels.join(", ") || "확인 대기"} · 시도 ${task.attempts.length} · ${sessionStatus(state.root, attempt)} · ${task.updatedAt}${task.status === "running" && activity ? ` · ${activity}` : ""} · ${task.title}` };
  });
  return [...planning, ...tasks];
}
