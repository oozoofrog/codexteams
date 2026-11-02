import { basename } from "node:path";
import { Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ActiveOperation } from "../core/controller.ts";
import type { ProjectState, Task } from "../core/types.ts";
import { safeDisplay, states, widgetLines } from "./format.ts";
import { requestStatus, requestTitle } from "./request-view.ts";

export interface HomeAction { id: string; label: string; targetId?: string }
export function homeActions(state: ProjectState, operation: ActiveOperation | undefined, id: string): HomeAction[] {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return [];
  const managed = state.teamMode?.requests.find(request => request.taskIds.includes(id));
  if (managed) return [{ id: "result", label: "결과 확인" }, { id: "details", label: "상세" }];
  if (state.recoveryRequired) return [{ id: "recover", label: "복구 내용 확인" }, { id: "details", label: "상세" }];
  if (operation?.taskId === id) return [{ id: "progress", label: "진행 보기" }, { id: "stop", label: "중단 요청" }, { id: "details", label: "상세" }];
  const blocked = task.dependsOn.find(dep => state.tasks.find(t => t.id === dep)?.status !== "completed");
  if (task.status === "queued" && blocked) return [{ id: `dependency:${blocked}`, label: "선행 결과 확인", targetId: blocked }, { id: "content", label: "작업 내용" }];
  if (task.status === "queued") return [{ id: task.handoff ? "start-handoff" : "run", label: "작업 시작" }, { id: "content", label: "작업 내용" }, { id: "details", label: "상세" }];
  if (task.status === "needs_review") return [{ id: "result", label: "결과 확인" }, { id: "revise", label: "수정 요청" }, { id: "accept", label: "결과 수락" }, { id: "details", label: "상세" }];
  if (task.status === "failed" || task.status === "interrupted") return [{ id: "result", label: "실패 이유와 결과 확인" }, { id: "retry", label: "다시 시도" }, { id: "revise", label: "수정 요청" }, { id: "details", label: "상세" }];
  return [{ id: "result", label: "결과 확인" }, { id: "details", label: "상세" }];
}
export function homeResultLines(task: Task): string[] {
  const attempt = task.attempts.at(-1);
  return [task.title, "최근 결과", ...(attempt?.text || "최종 응답 없음").split(/\r?\n/), ...(attempt?.error ? ["", `오류: ${attempt.error}`] : [])].map(safeDisplay);
}

type Choice = { id: string; label: string };
type PanelSnapshot = { title: string; status?: string; lines?: string[]; choices: Choice[]; footer?: string; onSelect?: (id: string) => void };
export class HomePanelError extends Error {}
/** Every panel owns its timer. Closing a panel never affects a controller operation. */
export async function homePanel(ctx: ExtensionContext, snapshot: () => PanelSnapshot, registerClose: (close?: () => void) => void): Promise<string | undefined> {
  let cleanup: (() => void) | undefined;
  try { return await ctx.ui.custom<string | undefined>((tui, _theme, keys, done) => {
    let selected = 0, scroll = 0, closed = false, initialized = false;
    let selectedId: string | undefined;
    let renderedChoices: Choice[] = [];
    let renderedSelect: PanelSnapshot["onSelect"];
    const close = (value?: string) => { if (closed) return; closed = true; clearInterval(timer); registerClose(); done(value); };
    const timer = setInterval(() => { if (!closed) tui.requestRender(); }, 500);
    cleanup = () => { if (!closed) { closed = true; clearInterval(timer); registerClose(); } };
    registerClose(() => close());
    return {
      render(width: number) {
        const data = snapshot();
        if (!initialized) { selected = data.choices.length ? 0 : -1; initialized = true; }
        else if (selectedId) selected = data.choices.findIndex(choice => choice.id === selectedId);
        else selected = -1;
        renderedChoices = data.choices; renderedSelect = data.onSelect;
        selectedId = renderedChoices[selected]?.id;
        const available = Math.max(4, Math.min(18, tui.terminal.rows - 10));
        const lines = (data.lines ?? []).flatMap(line => wrapTextWithAnsi(safeDisplay(line), Math.max(1, width)));
        const contentCount = Math.max(0, available - Math.min(data.choices.length, 6));
        scroll = Math.min(scroll, Math.max(0, lines.length - contentCount));
        const choiceCount = Math.max(1, available - Math.min(contentCount, lines.length));
        const start = Math.max(0, Math.min(selected - choiceCount + 1, data.choices.length - choiceCount));
        return [data.title, ...(data.status ? [data.status] : []), ...lines.slice(scroll, scroll + contentCount), ...data.choices.slice(start, start + choiceCount).map((choice, i) => `${start + i === selected ? "→ " : "  "}${choice.label}`), data.footer ?? "↑/↓ 선택 · Enter 확인 · Esc 뒤로 · PgUp/PgDn 내용 이동"].map(line => truncateToWidth(safeDisplay(line), width, undefined, true));
      },
      handleInput(data: string) {
        const choices = renderedChoices;
        if (keys.matches(data, "tui.select.cancel")) { close(); return; }
        if (keys.matches(data, "tui.select.confirm")) {
          const id = choices[selected]?.id;
          if (id && snapshot().choices.some(choice => choice.id === id)) { renderedSelect?.(id); close(id); }
          else tui.requestRender();
          return;
        }
        if (keys.matches(data, "tui.select.up")) { selected = selected < 0 ? choices.length - 1 : Math.max(0, selected - 1); selectedId = choices[selected]?.id; }
        else if (keys.matches(data, "tui.select.down")) { selected = Math.min(choices.length - 1, selected + 1); selectedId = choices[selected]?.id; }
        else if (matchesKey(data, Key.pageUp)) scroll = Math.max(0, scroll - 8);
        else if (matchesKey(data, Key.pageDown)) scroll += 8;
        else return;
        tui.requestRender();
      },
      invalidate() {},
      dispose() { cleanup?.(); },
    };
  }, { overlay: true, overlayOptions: { width: "100%", maxHeight: "80%" } }); }
  catch (error) { throw new HomePanelError(error instanceof Error ? error.message : String(error), { cause: error }); }
  finally { cleanup?.(); }
}
export function homeOverview(root: string, state: ProjectState | null, operation: ActiveOperation | undefined, activity: string, error: string, manual = false): PanelSnapshot {
  const status = state ? widgetLines(state, activity, operation)[0] : "실행 없음 · 결과 확인 0개";
  const elapsed = operation ? Math.max(0, Math.floor((Date.now() - Date.parse(operation.startedAt)) / 1000)) : 0;
  const operationLines = operation ? [`경과 ${elapsed}초 · 시작 ${operation.startedAt} · 마지막 관찰 ${operation.lastActivityAt}`] : [];
  const managed = new Set(state?.teamMode?.requests.flatMap(r => r.taskIds) ?? []);
  const amendments = new Set(state?.teamMode?.requests.flatMap(r => r.amendments?.map(a => a.requestId) ?? []) ?? []);
  const choices: Choice[] = manual ? (state?.tasks.filter(t => !managed.has(t.id)).map(task => ({ id: `task:${task.id}`, label: `${task.title} · ${states[task.status]}` })) ?? []) : [{ id: "new-request", label: "새 요청" }, ...(state?.teamMode?.requests.filter(r => !amendments.has(r.id)).map((r, index) => ({ id: `request:${r.id}`, label: `[${index + 1}] ${r.receivedAt.slice(0, 16).replace("T", " ")} · ${requestStatus(state, r)} · ${requestTitle(r)}` })) ?? []), { id: "manual", label: "수동 작업" }];
  if (operation && (!operation.taskId || !managed.has(operation.taskId))) choices.unshift({ id: "progress", label: "현재 진행 보기 / 중단 요청" });
  if (state?.recoveryRequired) choices.unshift({ id: "recover", label: "복구 내용 확인" });
  else if (!operation && state && (state.planningAttempts.some(a => !a.endedAt) || state.tasks.some(t => t.status === "running" || t.attempts.some(a => !a.endedAt) || t.checks.some(c => c.status === "running")))) choices.unshift({ id: "recovery-check", label: "실행 여부와 복구 내용 확인" });
  if (manual && !state?.tasks.length && !state?.goal) choices.push({ id: "goal", label: "새 목표 입력" });
  else if (manual && !state?.tasks.length && state?.goal && !operation) choices.push({ id: "retry-plan", label: "기존 목표로 계획 다시 만들기" });
  choices.push({ id: "mode", label: state?.teamMode?.enabled ? "팀 모드 끄기" : "팀 모드 켜기" }, ...(manual ? [{ id: "add", label: "새 작업 추가" }, { id: "back-home", label: "요청 목록" }] : []), { id: "help", label: "상세 / 도움말" });
  return { title: `팀 · ${basename(root)}`, status, lines: [...operationLines, ...(error ? [`오류: ${error}`, "인증은 Pi /login, 모델 설정은 /teams profile에서 확인하세요."] : [])], choices };
}
