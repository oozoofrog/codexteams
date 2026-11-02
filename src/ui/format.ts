import { combineUsage } from "../core/usage.ts";
import type { ProjectState, Task, TaskStatus, UsageSummary } from "../core/types.ts";
import type { ActiveOperation } from "../core/controller.ts";

export const safeDisplay = (text: string): string => text.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, " ");

const states: Record<TaskStatus, string> = { queued: "대기", running: "진행", needs_review: "검토 대기", completed: "수락 완료", failed: "실패", interrupted: "중단", cancelled: "취소" };
const cell = (text: string) => text.replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");
const number = (value: number | null) => value === null ? "미확인" : value.toLocaleString("ko-KR");
const routing = (role: string, profile: { provider: string; model: string; effort: string }, models: string[]) => `${role}: 요청 ${profile.provider}/${profile.model} / ${profile.effort} · 실제 응답 ${models.length ? models.join(", ") : "확인 대기"}`;

export function resumeCandidates(state: ProjectState): { id: string; option: string }[] {
  return state.tasks.filter(task => ["failed", "interrupted", "needs_review"].includes(task.status)).map(task => ({
    id: task.id,
    option: `${task.title.replace(/[\r\n]+/g, " ")} · ${states[task.status]} · ${task.role} · ID: ${task.id}`,
  }));
}

export function projectUsage(state: ProjectState): UsageSummary {
  return combineUsage([...state.planningAttempts, ...(state.teamMode?.coordinatorAttempts ?? []), ...state.tasks.flatMap(task => task.attempts)].map(attempt => attempt.usage));
}

export function formatUsage(usage: UsageSummary, attempted: boolean): string {
  if (!attempted) return "모델 호출 기록 없음";
  const qualifier = usage.completeness === "known" ? "알려진 사용량" : usage.completeness === "partial" ? "일부 사용량 미확인" : "사용량 미확인";
  return `${qualifier} · 입력 ${number(usage.input)} · 출력 ${number(usage.output)} · 캐시 읽기 ${number(usage.cacheRead)} · 보고된 합계 ${number(usage.totalTokens)} 토큰` + (usage.costUsd === null ? " · 비용 미확인" : ` · 추정 $${usage.costUsd.toFixed(4)} (청구액 아님)`);
}

export function formatBoard(state: ProjectState, activity = "준비"): string {
  const rows = state.tasks.map(task => {
    const profile = task.attempts.at(-1)?.profile ?? state.profiles[task.role];
    return `| ${task.id} | ${states[task.status]} | ${task.role} | ${cell(task.title)} | ${cell(profile.model)} / ${profile.effort} |`;
  });
  const attempts = state.planningAttempts.length + (state.teamMode?.coordinatorAttempts.length ?? 0) + state.tasks.reduce((sum, task) => sum + task.attempts.length, 0);
  const planning = state.planningAttempts.at(-1);
  const planner = routing("planner", planning?.profile ?? state.profiles.planner, planning?.effectiveModels ?? []);
  const coordinator = state.teamMode?.coordinatorAttempts.at(-1);
  const workers = state.tasks.map(task => routing(task.role, task.attempts.at(-1)?.profile ?? state.profiles[task.role], task.attempts.at(-1)?.effectiveModels ?? []));
  return ["## codexteams", "", `**목표:** ${state.goal || "아직 없음"}`, "", `**상태:** ${activity}`, "", planner, ...(coordinator ? [routing("coordinator", coordinator.profile, coordinator.effectiveModels)] : []), ...workers, ...(state.recoveryRequired ? ["", `**복구 필요:** ${state.recoveryReason || "/teams recover"}`] : []), "", "| 작업 | 상태 | 담당 | 내용 | 최근 실행 / 추론 |", "|---|---|---|---|---|", ...rows, ...(rows.length ? [] : ["| — | — | — | 등록된 작업 없음 | — |"]), "", formatUsage(projectUsage(state), attempts > 0), "", "작업 상세: `/teams show <id>` · 실행: `/teams run` · 이어가기: `/teams resume` · 수정: `/teams resume <id> <지시>`", "검증: `/teams check <id> <명령>` · 수락: `/teams accept <id>` · 중단: `/teams cancel`"].join("\n");
}

export function formatAttemptHistory(attempts: Task["attempts"], role: string, start = 0, limit = attempts.length): string[] {
  return attempts.slice(start, start + limit).map((attempt, index) => `- ${start + index + 1}/${attempts.length} · ID ${attempt.id} · worker ${attempt.sessionId} · ${attempt.outcome ?? "진행 중"}\n  시작 ${attempt.startedAt} · 종료 ${attempt.endedAt ?? "진행 중"}\n  ${routing(role, attempt.profile, attempt.effectiveModels)}${attempt.error ? `\n  오류: ${attempt.error.slice(0, 1024)}` : ""}`);
}

export function formatTask(task: Task, history?: { start: number; limit: number }): string {
  const attempt = task.attempts.at(-1);
  return [`## ${task.id} · ${task.title}`, "", `상태: ${states[task.status]} · 담당: ${task.role}`, "", task.description, "", "### 인수 조건", "", ...task.acceptance.map(a => `- ${a}`), "", "### 최근 실행", "", attempt ? `${routing(task.role, attempt.profile, attempt.effectiveModels)} · ${attempt.outcome || "진행 중"}\n\n${attempt.text.slice(-8000) || "최종 응답 없음"}${attempt.error ? `\n\n오류: ${attempt.error}` : ""}` : "실행 기록 없음", "", `### 실행 이력${history ? ` (${Math.min(history.start + 1, task.attempts.length)}–${Math.min(history.start + history.limit, task.attempts.length)} / ${task.attempts.length})` : ""}`, "", ...formatAttemptHistory(task.attempts, task.role, history?.start, history?.limit), "", "### 검증", "", ...task.checks.map(check => `- ${check.status}: ${check.command} (attempt ${check.attemptId.slice(0,8)}, exit ${check.exitCode ?? "미확인"})\n\n${check.output.slice(-4000)}`), ...(task.checks.length ? [] : ["검증 명령 기록 없음. 사용자 검토 수락과 자동 테스트 통과를 구분합니다."]), ...(task.acceptedAt ? ["", `사용자 수락: ${task.acceptedAt} · attempt ${task.acceptedAttemptId}`] : [])].join("\n");
}

export function widgetLines(state: ProjectState, activity: string, operation?: ActiveOperation): string[] {
  const reviews = state.tasks.filter(task => task.status === "needs_review").length;
  const unconfirmed = state.tasks.some(task => task.status === "running" || task.attempts.some(attempt => !attempt.endedAt) || task.checks.some(check => check.status === "running")) || state.planningAttempts.some(attempt => !attempt.endedAt);
  const phase = operation?.phase === "stopping" ? "중단 요청 중" : operation?.kind === "check" ? "검증 중" : operation?.kind === "planning" ? "계획 생성 중" : operation ? (operation.phase === "preflight" ? "실행 준비 중" : operation.phase === "tool" ? "도구 실행 중" : operation.phase === "response" ? "응답 수신 중" : "응답 대기 중") : state.recoveryRequired ? "복구 확인 필요" : unconfirmed ? "실행 여부 확인 필요" : `실행 없음 · 결과 확인 ${reviews}개`;
  const planner = state.planningAttempts.at(-1);
  const selected = state.tasks.find(task => task.id === operation?.taskId);
  const coordinatorActive = (state.teamMode?.coordinatorAttempts.some(attempt => !attempt.endedAt) || state.teamMode?.requests.some(request => request.status === "received" || request.status === "classifying")) ?? false;
  const visiblePhase = coordinatorActive && !operation && !state.recoveryRequired ? `조율 중 · 결과 확인 ${reviews}개` : `${phase}${coordinatorActive ? " · 조율 중" : ""}`;
  const headline = `codexteams · 팀 모드 ${state.teamMode?.enabled ? "ON" : "OFF"} · ${visiblePhase}${selected ? ` · ${selected.title}` : ""}${operation ? ` · ${activity}` : ""}`;
  if (arguments.length >= 3) return [safeDisplay(headline)];
  return [headline, routing("planner", planner?.profile ?? state.profiles.planner, planner?.effectiveModels ?? []), ...state.tasks.slice(-5).map(task => `${task.id}  ${states[task.status]}  ${task.title.slice(0,48)} · ${routing(task.role, task.attempts.at(-1)?.profile ?? state.profiles[task.role], task.attempts.at(-1)?.effectiveModels ?? [])}`), ...(state.recoveryRequired ? ["복구 확인 필요: /teams recover"] : [])].map(safeDisplay);
}
