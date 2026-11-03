import { isAcceptedRequest } from "../core/state-validation.mjs";
import type { ProjectState, TeamModeRequest } from "../core/types.ts";

export type RequestAction = "result" | "revise" | "recheck" | "resume" | "stop" | "accept" | "details";
const labels: Record<TeamModeRequest["status"], string> = { received: "요청 확인 중", classifying: "요청 확인 중", clarifying: "답변 대기", queued: "대기 중", running: "작업 중", paused: "중단됨", blocked: "확인 필요", answered: "답변", awaiting_user_acceptance: "결과 확인 필요", accepted: "수락 완료", stopping: "중단 요청 중", cancelled: "중단됨", failed: "확인 필요" };
export function requestTitle(request: TeamModeRequest): string { return request.text.replace(/\s+/g, " ").trim().slice(0, 80); }
export function requestStatus(state: ProjectState, request: TeamModeRequest, stopping = false): string { return stopping ? "중단 요청 중" : isLegacyAccepted(state, request) ? "이전 수락 결과" : labels[request.status]; }
export function requestActions(state: ProjectState, request: TeamModeRequest, stopping = false): RequestAction[] {
  const actions: RequestAction[] = ["result"];
  if (!stopping && !state.recoveryRequired && !isLegacyAccepted(state, request)) {
    if (["received", "classifying", "queued", "running", "paused", "blocked"].includes(request.status)) actions.push("stop");
    if (["paused", "blocked", "cancelled", "failed"].includes(request.status)) actions.push("resume");
    if (request.status === "awaiting_user_acceptance") { if (state.teamMode?.enabled) actions.push("revise", "recheck"); actions.push("accept"); }
    else if (state.teamMode?.enabled && request.taskIds.length > 0 && ["queued", "running", "paused", "blocked"].includes(request.status)) actions.push("revise");
  }
  actions.push("details"); return actions;
}
export function requestResultLines(state: ProjectState, request: TeamModeRequest): string[] {
  const writer = state.tasks.find(t => t.id === request.taskIds[0]);
  const evidence = state.teamMode?.reviewEvidence.filter(e => e.requestId === request.id).at(-1);
  const checkLines = request.checks?.length ? request.checks.map(command => { const check = writer?.checks.filter(c => c.command === command && c.attemptId === writer.attempts.at(-1)?.id).at(-1); const status = check?.status === "passed" ? "통과" : check?.status === "failed" ? "실패" : check?.status === "running" ? "실행 중" : check?.status === "interrupted" ? "중단" : "기록 없음"; return `검증 ${status}: ${command}`; }) : ["선언된 검증 없음"];
  const review = evidence?.verdict === "pass" ? "통과" : evidence?.verdict === "changes_required" ? "수정 필요" : evidence?.verdict === "blocked" ? "확인 필요" : "기록 없음";
  const next = isLegacyAccepted(state, request) || request.status === "accepted" ? "수락한 결과입니다. 후속 변경은 새 요청으로 시작하세요." : request.status === "awaiting_user_acceptance" ? "결과를 검토하고 수정, 재검증 또는 수락을 선택하세요." : request.status === "paused" || request.status === "blocked" || request.status === "failed" || request.status === "cancelled" ? "이유를 확인하고 수정 또는 이어하기를 선택하세요." : request.status === "answered" ? "답변을 확인하세요." : "진행을 기다리거나 중단을 요청할 수 있습니다.";
  const changes = (request.amendments ?? []).map(a => `변경 ${a.status === "applied" ? "반영" : "대기"}: ${a.instruction}`);
  return [request.text, ...changes, `상태: ${requestStatus(state, request)}`, ...(!state.teamMode?.enabled && request.status !== "accepted" ? ["수정 또는 재검증하려면 팀 모드를 켜세요."] : []), ...(request.answer ? ["답변", request.answer] : []), ...(request.stages ? request.stages.flatMap(id => { const task = state.tasks.find(t => t.id === id)!; return [task.title, task.attempts.at(-1)?.text || "결과 없음"]; }) : writer ? ["구현 결과", writer.attempts.at(-1)?.text || "결과 없음"] : []), ...(request.reason ? [`이유: ${request.reason}`] : []), ...checkLines, `독립 검토${evidence && evidence.requestRevision !== request.revision ? " (이전 결과)" : ""}: ${review}`, `다음 행동: ${next}`];
}
export function requestDetailLines(state: ProjectState, request: TeamModeRequest): string[] {
  const linked = request.taskIds.map(id => state.tasks.find(t => t.id === id)).filter(Boolean);
  const evidence = state.teamMode?.reviewEvidence.filter(e => e.requestId === request.id) ?? [];
  return JSON.stringify({ request, linkedTasks: linked, reviewEvidence: evidence }, null, 2).split("\n");
}

/** Read-only projection of pre-0.7 user acceptance; never migrates persisted state. */
export function isLegacyAccepted(state: ProjectState, request: TeamModeRequest): boolean {
  if (request.status !== "awaiting_user_acceptance" || request.receipt) return false;
  return isAcceptedRequest(state, request);
}
