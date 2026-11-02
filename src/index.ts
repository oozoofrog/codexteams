import { closeSync, constants, fstatSync, openSync, readSync, realpathSync, readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Key, matchesKey, sliceByColumn, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { TeamController } from "./core/controller.ts";
import { TeamModeSupervisor } from "./core/team-mode.ts";
import { ProjectStore } from "./core/store.ts";
import { cleanupOwners, processRegistry, type ProcessOwner } from "./core/process-registry.ts";
import { checkedHeader, checkedView, ensureView, VIEW_MARKER } from "./core/navigation.ts";
import { catalog, sessionStatus, type CatalogItem } from "./ui/session-catalog.ts";
import { readPublicTranscript } from "./ui/session-transcript.ts";
import { handoffResult, readRequest, requestDigest } from "./core/handoff.mjs";
import { parseProfile, parseRole } from "./core/profiles.ts";
import { runPiWorker } from "./runtime/pi-runner.ts";
import { formatAttemptHistory, formatBoard, formatTask, resumeCandidates, widgetLines, safeDisplay } from "./ui/format.ts";
import { HomePanelError, homeActions, homeOverview, homePanel, homeResultLines } from "./ui/home.ts";
import { requestActions, requestDetailLines, requestResultLines, requestStatus, requestTitle, type RequestAction } from "./ui/request-view.ts";
import type { ModelProfile, TaskRole } from "./core/types.ts";

const HELP = `## codexteams

\`/teams mode on|off|status\` — 팀 모드 설정과 요청 상태
\`/teams request resume|stop <id>\` — 팀 요청 재개 또는 중단
\`/teams handoff <JSON 경로>\` — 인계 작업 실행
\`/teams handoff-result <id>\` — 인계 결과 조회
\`/teams launch <목표>\` — 새 프로젝트 계획을 만들고 준비된 작업 실행
\`/teams start <목표>\` — 프로젝트를 읽고 작업 계획 생성
\`/teams run [id]\` — 준비된 작업 실행
\`/teams add <developer|designer|reviewer> <내용>\` — 후속 작업 추가
\`/teams show <id>\` — 결과와 검증 기록
\`/teams sessions\` — 연결된 팀·작업 세션
\`/teams open <id>\` — 작업 조회 · \`/teams home\` — 팀으로 복귀
\`/teams resume\` — 중단·실패·검토 대기 작업을 목록에서 선택
\`/teams resume <id> [수정 지시]\` — 지정한 작업 이어가기
\`/teams check <id> <명령>\` — 직접 지정한 검증 실행
\`/teams accept <id>\` — 결과를 검토하고 수락
\`/teams profile <role> <provider/model> <low|medium|high|xhigh|max>\` — 이후 실행 설정
\`/teams cancel\` — 현재 실행 중단
\`/teams recover\` — 비정상 종료 후 프로세스·파일 확인
\`/teams status\` — 전체 작업과 알려진 사용량`;

export function splitArgument(input: string): [string, string] {
  const match = input.trim().match(/^(\S+)(?:\s+([\s\S]*))?$/);
  return match ? [match[1], match[2] || ""] : ["", ""];
}

export async function validateRuntimeProfile(profile: ModelProfile, ctx: ExtensionContext): Promise<void> {
  return validateProfileWithRegistry(profile, ctx.modelRegistry);
}

async function validateProfileWithRegistry(profile: ModelProfile, registry: ExtensionContext["modelRegistry"]): Promise<void> {
  const model = registry.find(profile.provider, profile.model);
  if (!model) throw new Error(`Pi에서 모델을 찾을 수 없습니다: ${profile.provider}/${profile.model}. /model 또는 /teams profile을 확인하세요.`);
  if (!registry.hasConfiguredAuth(model)) throw new Error(`${profile.provider} 인증이 없습니다. Pi /login으로 연결하세요. 다른 과금 경로로 전환하지 않습니다.`);
  const supported = getSupportedThinkingLevels(model);
  if (!supported.includes(profile.effort)) throw new Error(`${profile.model}은 ${profile.effort}를 지원하지 않습니다. 지원 단계: ${supported.join(", ")}`);
}

export default function codexteams(pi: ExtensionAPI): void {
  if (process.env.CODEXTEAMS_WORKER === "1") return;
  const registry = processRegistry();
  const token = {};
  let owner: ProcessOwner | undefined;
  let controller: TeamController | undefined;
  let context: ExtensionContext | undefined;
  let generation = 0;
  let viewTimer: ReturnType<typeof setTimeout> | undefined;
  let closeView: (() => void) | undefined;
  let closeHome: (() => void) | undefined;
  let activeViewFile: string | undefined;
  let activeViewContext: ExtensionContext | undefined;

  const display = (content: string) => pi.sendMessage({ customType: "codexteams", content, display: true }, { triggerTurn: false });
  const notify = (ctx: ExtensionContext, text: string, level: "info" | "warning" | "error" = "info") => {
    try { if (ctx.hasUI) ctx.ui.notify(text, level); else display(text); } catch { /* UI may be gone after shutdown */ }
  };
  const showWidget = () => {
    if (!context?.hasUI || !controller) return;
    const state = controller.snapshot();
    const lines = widgetLines(state, controller.currentActivity, controller.activeOperation);
    context.ui.setStatus("codexteams", lines[0]);
    context.ui.setWidget("codexteams", lines);
  };

  function attach(ctx: ExtensionContext): void {
    if (owner?.binding?.token === token) owner.binding = undefined;
    context = ctx;
    if (!ctx.isProjectTrusted()) { owner = undefined; controller = undefined; return; }
    const root = realpathSync(ctx.cwd);
    owner = registry.owners.get(root);
    controller = owner?.controller;
    if (owner) {
      owner.registry = ctx.modelRegistry;
      if (ctx.sessionManager?.getSessionDir) owner.sessionDir = ctx.sessionManager.getSessionDir();
      owner.binding = { token, changed: showWidget, message: (content, type = "codexteams") => pi.sendMessage({ customType: type, content, display: true }, { triggerTurn: false }), notify: (content, level) => notify(ctx, content, level) };
      try { showWidget(); } catch { /* UI attachment cannot affect the owner. */ }
    }
  }

  async function getController(ctx: ExtensionContext): Promise<TeamController> {
    if (!ctx.isProjectTrusted()) throw new Error("Pi에서 이 프로젝트를 신뢰한 뒤 팀 작업을 시작하세요.");
    const root = realpathSync(ctx.cwd);
    let found = registry.owners.get(root);
    if (!found) {
      const created = {} as ProcessOwner;
      created.registry = ctx.modelRegistry;
      created.controller = new TeamController(ProjectStore.open(root), { runner: runPiWorker, validateProfile: profile => validateProfileWithRegistry(profile, created.registry), onChange: () => { try { created.binding?.changed(); } finally { created.supervisor?.wake(); } } });
      registry.owners.set(root, created); found = created;
    }
    found.supervisor ??= new TeamModeSupervisor(found.controller.store, { controller: found.controller, runner: runPiWorker, validateProfile: profile => validateProfileWithRegistry(profile, found!.registry), onChange: message => { const binding = found!.binding; binding?.changed(); if (message) binding?.message(message, "codexteams.mode"); } });
    attach(ctx);
    return found.controller;
  }

  async function acquireForAction(ctx: ExtensionContext): Promise<{ owner: ProcessOwner; verify(): void }> {
    const root = realpathSync(ctx.cwd), epoch = generation, sessionId = ctx.sessionManager.getSessionId(), originalOwner = registry.owners.get(root);
    const before = originalOwner?.controller.snapshot() ?? ProjectStore.read(root);
    if (!ctx.isProjectTrusted() || viewMarker(ctx) || isOriginalWorker(ctx) || before?.recoveryRequired) throw new Error("프로젝트 신뢰 또는 복구 상태를 확인하세요.");
    const pending = getController(ctx), initializedOwner = registry.owners.get(root), team = await pending, selected = registry.owners.get(root);
    const verify = () => {
      const now = team.snapshot();
      if (epoch !== generation || !context || realpathSync(context.cwd) !== root || realpathSync(ctx.cwd) !== root || ctx.sessionManager.getSessionId() !== sessionId || context.sessionManager.getSessionId() !== sessionId || !ctx.isProjectTrusted() || viewMarker(ctx) || isOriginalWorker(ctx) || !selected?.supervisor || selected !== initializedOwner || registry.owners.get(root) !== selected || selected.controller !== team || (originalOwner && selected !== originalOwner) || (before && (now.id !== before.id || Boolean(now.recoveryRequired) !== Boolean(before.recoveryRequired) || (now.teamMode?.enabled ?? false) !== (before.teamMode?.enabled ?? false) || (now.teamMode?.generation ?? 0) !== (before.teamMode?.generation ?? 0))) || now.recoveryRequired) throw new Error("프로젝트 또는 세션이 변경되었습니다. 다시 시도하세요.");
      team.store.assertOwner();
    };
    verify(); return { owner: selected!, verify };
  }

  async function operation<T>(work: Promise<T>, ctx: ExtensionContext, completed: (value: T) => string): Promise<void> {
    const startedIn = generation;
    if (!ctx.hasUI) {
      const value = await work;
      if (startedIn === generation) { notify(ctx, completed(value)); showWidget(); }
      return;
    }
    void work.then(value => {
      if (startedIn !== generation) return;
      notify(ctx, completed(value)); showWidget();
    }).catch(error => {
      if (startedIn !== generation) return;
      notify(ctx, error instanceof Error ? error.message : String(error), "error"); showWidget();
    });
    showWidget();
  }

  function isOriginalWorker(ctx: ExtensionContext): boolean {
    const file = ctx.sessionManager?.getSessionFile?.();
    if (!file) return false;
    try { return resolve(file).startsWith(join(realpathSync(ctx.cwd), ".codexteams", "sessions") + sep); }
    catch { return true; }
  }

  function viewMarker(ctx: ExtensionContext): { root: string; projectId: string; kind: "task" | "planning"; targetId: string } | undefined {
    return ctx.sessionManager?.getBranch().filter(e => e.type === "custom" && e.customType === VIEW_MARKER).map(e => (e as { data?: unknown }).data).at(-1) as ReturnType<typeof viewMarker>;
  }

  async function showView(ctx: ExtensionContext, source: { root: string; snapshot: () => ReturnType<TeamController["snapshot"]> }, item: CatalogItem): Promise<void> {
    if (ctx.mode !== "tui") { notify(ctx, "조회 화면은 Pi TUI에서 사용할 수 있습니다. /teams sessions", "warning"); return; }
    const root = source.root;
    let cleanup: (() => void) | undefined;
    try { await ctx.ui.custom<void>((tui, _theme, keys, done) => {
      let offset = 0, historyPage = 0, closed = false;
      const timer = setInterval(() => tui.requestRender(), 1000);
      const close = () => { if (!closed) { cleanup?.(); done(); } };
      cleanup = () => { if (!closed) { closed = true; clearInterval(timer); if (closeView === close) closeView = undefined; } };
      closeView = close;
      return {
        render(width: number) {
          const state = source.snapshot();
          const task = item.kind === "task" ? state.tasks.find(t => t.id === item.id) : undefined;
          const attempts = task?.attempts ?? state.planningAttempts.filter(a => a.id === item.id);
          const workerId = attempts.at(-1)?.sessionId;
          let transcript = "[Worker session not created yet]";
          if (workerId) {
            try {
              const dir = join(root, ".codexteams", "sessions");
              const matches = readdirSync(dir).filter(name => name.endsWith(`_${workerId}.jsonl`));
              if (matches.length === 1) { const file = join(dir, matches[0]); checkedHeader(file, root, workerId); transcript = readPublicTranscript(file).text; }
              else transcript = matches.length ? "[Ambiguous worker sessions]" : `[${sessionStatus(root, attempts.at(-1))}]`;
            } catch (error) { transcript = `[Worker session unavailable: ${String(error)}]`; }
          }
          historyPage = Math.min(historyPage, Math.max(0, Math.ceil(attempts.length / 20) - 1));
          const details = task ? formatTask(task, { start: historyPage * 20, limit: 20 }) : [...formatAttemptHistory(attempts, "planner", historyPage * 20, 20), ...attempts.slice(historyPage * 20, historyPage * 20 + 20).map(a => a.text.slice(-8000))].join("\n");
          const lines = `${transcript}\n\n${details}`.split("\n");
          const attempt = attempts.at(-1), profile = attempt?.profile ?? (task ? state.profiles[task.role] : state.profiles.planner);
          const status = task?.status ?? attempt?.outcome ?? "진행 중";
          const page = Math.max(1, Math.floor(tui.terminal.rows * 0.6) - 5), max = Math.max(0, lines.length - page); offset = Math.min(offset, max);
          return [`${item.kind === "task" ? "작업" : "계획"} ${item.id} · ${state.recoveryRequired ? "복구 필요 · " : ""}${status} · ${sessionStatus(root, attempt)} · ${task?.role ?? "planner"} · ${profile.provider}/${profile.model} / ${profile.effort}`, `팀 ${state.id}`, `경로: ${root}`, `실제 ${attempt?.effectiveModels.join(", ") || "확인 대기"} · 원본 worker 읽기 전용 · 복귀: /teams home · Esc`, ...lines.slice(offset, offset + page), `줄 ${offset + 1}–${Math.min(offset + page, lines.length)} / ${lines.length} · ↑/↓ 이동 · PgUp/PgDn 이력 ${historyPage + 1}/${Math.max(1, Math.ceil(attempts.length / 20))}`].map(line => truncateToWidth(safeDisplay(line), width));
        },
        handleInput(data: string) {
          if (keys.matches(data, "tui.select.cancel")) { done(); return; }
          if (keys.matches(data, "tui.select.up")) offset = Math.max(0, offset - 1);
          if (keys.matches(data, "tui.select.down")) offset++;
          if (keys.matches(data, "tui.select.pageUp")) { historyPage = Math.max(0, historyPage - 1); offset = 0; }
          if (keys.matches(data, "tui.select.pageDown")) { historyPage++; offset = 0; }
          tui.requestRender();
        },
        invalidate() {},
        dispose() { cleanup?.(); },
      };
    }, { overlay: true, overlayOptions: { width: "90%", maxHeight: "60%" } }); }
    finally { cleanup?.(); }
  }

  async function openItem(ctx: ExtensionCommandContext, selected: ProcessOwner, item: CatalogItem): Promise<void> {
    if (ctx.mode !== "tui") { notify(ctx, "조회 세션은 Pi TUI에서 여세요.", "warning"); return; }
    const epoch = generation, root = selected.controller.store.root, projectId = selected.controller.snapshot().id;
    selected.controller.store.assertOwner();
    if (registry.owners.get(root) !== selected || !catalog(selected.controller.snapshot()).some(x => x.kind === item.kind && x.id === item.id && x.workerSessionId === item.workerSessionId)) throw new Error("선택한 작업 또는 worker 세션이 변경되었습니다.");
    const view = ensureView(selected.controller.store, ctx, item.kind, item.id, selected.sessionDir);
    if (epoch !== generation || registry.owners.get(root) !== selected || selected.controller.snapshot().id !== projectId) throw new Error("세션이 변경되었습니다. 다시 선택하세요.");
    const navigation = selected.controller.snapshot().navigation!;
    if (!navigation.views.some(v => v.file === view.file && v.targetId === item.id && v.kind === item.kind) || !catalog(selected.controller.snapshot()).some(x => x.kind === item.kind && x.id === item.id && x.workerSessionId === item.workerSessionId)) throw new Error("조회 세션 연결이 변경되었습니다.");
    checkedHeader(navigation.root.file, root, navigation.root.id);
    checkedView(view, root, projectId);
    await ctx.switchSession(view.file, { withSession: async () => {} });
  }

  const actionLabels: Record<RequestAction, string> = { result: "결과 보기", revise: "수정 요청", recheck: "검증과 검토 다시 실행", resume: "이어하기", stop: "중단 요청", accept: "결과 수락", details: "상세 기록" };
  function requestFence(ctx: ExtensionCommandContext, id: string) {
    const epoch = generation, root = realpathSync(ctx.cwd), selectedOwner = registry.owners.get(root);
    const initial = selectedOwner?.controller.snapshot() ?? ProjectStore.read(root);
    const signature = (state: NonNullable<typeof initial>) => {
      const request = state.teamMode?.requests.find(r => r.id === id);
      if (!request) throw new Error("요청이 없습니다.");
      const operation = selectedOwner?.controller.activeOperation;
      return JSON.stringify({ project: state.id, recovery: state.recoveryRequired, mode: [state.teamMode?.enabled, state.teamMode?.generation], request, tasks: request.taskIds.map(tid => { const t = state.tasks.find(x => x.id === tid); return t && { id: t.id, status: t.status, attempt: t.attempts.at(-1)?.id, outcome: t.attempts.at(-1)?.outcome, checks: t.checks.map(c => [c.id, c.status, c.attemptId]) }; }), evidence: state.teamMode?.reviewEvidence.filter(e => e.requestId === id), operation: operation?.taskId && request.taskIds.includes(operation.taskId) ? operation.id : undefined });
    };
    if (!initial) throw new Error("요청이 없습니다.");
    const captured = signature(initial);
    return (enabledByAction = false) => {
      if (epoch !== generation || !context || realpathSync(context.cwd) !== root || realpathSync(ctx.cwd) !== root || !ctx.isProjectTrusted() || viewMarker(ctx) || isOriginalWorker(ctx) || registry.owners.get(root) !== selectedOwner) throw new Error("프로젝트 또는 세션이 변경되었습니다. 다시 선택하세요.");
      selectedOwner?.controller.store.assertOwner();
      const now = selectedOwner?.controller.snapshot() ?? ProjectStore.read(root);
      if (!now) throw new Error("요청 또는 결과가 변경되었습니다. 다시 선택하세요.");
      const comparable = structuredClone(now);
      if (enabledByAction) {
        if (!comparable.teamMode?.enabled || comparable.teamMode.generation !== (initial.teamMode?.generation ?? 0) + 1) throw new Error("팀 모드가 변경되었습니다.");
        comparable.teamMode.enabled = initial.teamMode?.enabled ?? false; comparable.teamMode.generation = initial.teamMode?.generation ?? 0;
      }
      if (signature(comparable) !== captured) throw new Error("요청 또는 결과가 변경되었습니다. 다시 선택하세요.");
      return now;
    };
  }
  async function dispatchRequest(ctx: ExtensionCommandContext, id: string, action: RequestAction, fence = requestFence(ctx, id)): Promise<void> {
    let state = fence(), request = state.teamMode!.requests.find(r => r.id === id)!;
    if (!requestActions(state, request).includes(action)) throw new Error("요청 행동이 변경되었습니다.");
    if (action === "result" || action === "details") return;
    if (action === "accept" && (!ctx.hasUI || !["tui", "rpc"].includes(ctx.mode))) throw new Error("결과 수락에는 Pi TUI 또는 RPC 확인이 필요합니다.");
    let instruction: string | undefined;
    if (action === "revise") { instruction = await ctx.ui.editor("수정 요청", ""); fence(); if (!instruction?.trim()) return; }
    else if (action === "accept" || action === "stop" || action === "recheck" || (action === "resume" && !state.teamMode?.enabled)) {
      const ok = await ctx.ui.confirm(actionLabels[action], action === "accept" ? `${safeDisplay(requestTitle(request))}\n현재 결과를 명시적으로 수락합니다.` : action === "resume" ? "팀 모드를 켜고 이 요청을 이어갑니다." : `${safeDisplay(requestTitle(request))}\n${actionLabels[action]}을 진행합니다.`);
      fence(); if (!ok) return;
    }
    state = fence(); request = state.teamMode!.requests.find(r => r.id === id)!;
    let selected = registry.owners.get(realpathSync(ctx.cwd));
    if (!selected?.supervisor) {
      const epoch = generation, root = realpathSync(ctx.cwd), expected = JSON.stringify(state);
      await getController(ctx); selected = registry.owners.get(root);
      if (epoch !== generation || !context || realpathSync(context.cwd) !== root || realpathSync(ctx.cwd) !== root || !ctx.isProjectTrusted() || viewMarker(ctx) || isOriginalWorker(ctx) || !selected?.supervisor || JSON.stringify(selected.controller.snapshot()) !== expected) throw new Error("팀 또는 요청이 변경되었습니다. 다시 선택하세요.");
      selected.controller.store.assertOwner();
      fence = requestFence(ctx, id); fence();
    }
    if (action === "resume" && !state.teamMode?.enabled) { await selected.supervisor!.setMode(true); fence(true); }
    if (action === "stop") await selected.supervisor!.stop(id);
    else if (action === "resume") selected.supervisor!.resume(id);
    else if (action === "revise") selected.supervisor!.revise(id, instruction!);
    else if (action === "recheck") selected.supervisor!.recheck(id);
    else if (action === "accept") selected.controller.accept(request.taskIds[0]);
  }

  async function homeLoop(ctx: ExtensionCommandContext): Promise<void> {
    const epoch = generation, root = realpathSync(ctx.cwd);
    let error = "", selectedId: string | undefined, panel: "home" | "actions" | "result" = "home", manual = false;
    let baselineOwner = registry.owners.get(root);
    const current = () => registry.owners.get(root)?.controller.snapshot() ?? ProjectStore.read(root);
    const currentTeam = () => registry.owners.get(root)?.controller;
    const register = (close?: () => void) => { closeHome = close; };
    const guard = (before: ReturnType<typeof current>, id?: string, opId?: string) => {
      if (epoch !== generation || !context || realpathSync(context.cwd) !== root || realpathSync(ctx.cwd) !== root || !ctx.isProjectTrusted()) throw new Error("프로젝트 또는 세션이 변경되었습니다. 다시 선택하세요.");
      if (registry.owners.get(root) !== baselineOwner) throw new Error("팀 소유자가 변경되었습니다. 다시 선택하세요.");
      const now = current(), active = currentTeam();
      if ((before?.id ?? null) !== (now?.id ?? null) || Boolean(before?.recoveryRequired) !== Boolean(now?.recoveryRequired) || before?.teamMode?.generation !== now?.teamMode?.generation || before?.teamMode?.enabled !== now?.teamMode?.enabled) throw new Error("팀 또는 복구 상태가 변경되었습니다. 다시 선택하세요.");
      if (active) { if (registry.owners.get(root)?.controller !== active) throw new Error("팀 소유자가 변경되었습니다."); active.store.assertOwner(); }
      if (id) {
        const old = before?.tasks.find(t => t.id === id), task = now?.tasks.find(t => t.id === id);
        if (!old || !task || old.status !== task.status || old.updatedAt !== task.updatedAt || old.attempts.at(-1)?.id !== task.attempts.at(-1)?.id || JSON.stringify(old.checks.map(c => [c.id, c.status, c.attemptId])) !== JSON.stringify(task.checks.map(c => [c.id, c.status, c.attemptId]))) throw new Error("작업 또는 결과가 변경되었습니다. 다시 선택하세요.");
      }
      if (opId !== undefined && active?.activeOperation?.id !== opId) throw new Error("실행이 변경되었습니다. 다시 선택하세요.");
      return now;
    };
    const mutateTeam = async (before: ReturnType<typeof current>, id?: string, addition = false) => {
      guard(before, id);
      const prior = currentTeam();
      const team = await getController(ctx);
      if (prior && prior !== team) throw new Error("팀 소유자가 변경되었습니다.");
      baselineOwner = registry.owners.get(root);
      guard(before ?? team.snapshot(), id);
      if (team.busy && !addition) throw new Error("실행 또는 검증이 진행 중입니다.");
      if (team.snapshot().recoveryRequired) throw new Error(team.snapshot().recoveryReason || "복구 확인이 필요합니다.");
      return team;
    };
    const startWork = (team: TeamController, work: Promise<unknown>) => {
      error = "";
      void work.catch(e => { if (epoch === generation && registry.owners.get(root)?.controller === team) { error = e instanceof Error ? e.message : String(e); try { showWidget(); } catch {} } });
    };
    const progress = async (before: ReturnType<typeof current>, op: NonNullable<TeamController["activeOperation"]>, stopImmediately = false) => {
      const action = stopImmediately ? "stop" : await homePanel(ctx, () => ({ title: "현재 진행", lines: [widgetLines(current()!, currentTeam()?.currentActivity ?? "", currentTeam()?.activeOperation)[0], `시작 ${op.startedAt}`, `마지막 관찰 ${currentTeam()?.activeOperation?.lastActivityAt ?? op.lastActivityAt}`], choices: [{ id: "back", label: "뒤로" }, { id: "stop", label: "중단 요청" }] }), register);
      guard(before, undefined, op.id);
      if (action === "stop") {
        const managed = before?.teamMode?.requests.find(r => op.taskId && r.taskIds.includes(op.taskId));
        if (managed) { await dispatchRequest(ctx, managed.id, "stop", requestFence(ctx, managed.id)); return; }
        const ok = await ctx.ui.confirm("중단 요청", "현재 실행에 중단을 요청합니다. 종료가 확인될 때까지 기다립니다."); guard(before, undefined, op.id);
        if (ok) void currentTeam()!.cancel().catch(e => { if (epoch === generation) error = String(e); });
      }
    };
    while (epoch === generation) {
      try {
        baselineOwner = registry.owners.get(root);
        const before = current(), team = currentTeam(), operationAtOpen = team?.activeOperation;
        if (panel === "home") {
          const choice = await homePanel(ctx, () => homeOverview(root, current(), currentTeam()?.activeOperation, currentTeam()?.currentActivity ?? "", error, manual), register);
          if (!choice || epoch !== generation) return;
          guard(before);
          if (choice === "manual" || choice === "back-home") { manual = choice === "manual"; continue; }
          if (choice === "new-request") {
            const text = await ctx.ui.editor("새 요청", ""); guard(before);
            if (!text?.trim()) continue;
            if (!before?.teamMode?.enabled) {
              const ok = await ctx.ui.confirm("팀 모드 켜기", "새 요청을 시작하면 일반 입력의 팀 접수도 켜집니다. 계속할까요?"); guard(before); if (!ok) continue;
            }
            if (!ctx.isIdle()) throw new Error("부모 Pi 실행이 끝난 뒤 요청하세요.");
            const originalOwner = baselineOwner, acquired = await acquireForAction(ctx), selectedOwner = acquired.owner, target = selectedOwner.controller;
            acquired.verify();
            if (originalOwner && selectedOwner !== originalOwner) throw new Error("팀 소유자가 변경되었습니다.");
            if (!originalOwner) baselineOwner = selectedOwner;
            guard(before ?? target.snapshot());
            if (!target.snapshot().teamMode?.enabled) {
              const old = target.snapshot();
              await baselineOwner!.supervisor!.setMode(true);
              const now = target.snapshot();
              if (epoch !== generation || !context || !ctx.isProjectTrusted() || registry.owners.get(root) !== baselineOwner || realpathSync(ctx.cwd) !== root || realpathSync(context.cwd) !== root || viewMarker(ctx) || isOriginalWorker(ctx) || now.id !== old.id || now.recoveryRequired || !now.teamMode?.enabled || now.teamMode.generation !== (old.teamMode?.generation ?? 0) + 1) throw new Error("프로젝트 또는 세션이 변경되었습니다.");
              target.store.assertOwner();
            }
            baselineOwner!.supervisor!.ingest({ text, origin: "interactive", sessionId: ctx.sessionManager.getSessionId() });
            continue;
          }
          if (choice.startsWith("request:")) {
            const id = choice.slice(8);
            while (epoch === generation) {
              let selectedFence: ReturnType<typeof requestFence> | undefined;
              const action = await homePanel(ctx, () => {
                const latest = current(), item = latest?.teamMode?.requests.find(r => r.id === id);
                const displayedFence = item && latest ? requestFence(ctx, id) : undefined;
                return item && latest ? { title: requestTitle(item), status: requestStatus(latest, item), ...(!latest.teamMode?.enabled && item.status !== "accepted" ? { lines: ["수정 또는 재검증하려면 팀 모드를 켜세요."] } : {}), choices: requestActions(latest, item).map(id => ({ id, label: actionLabels[id] })), onSelect: () => { selectedFence = displayedFence; } } : { title: "요청 없음", choices: [] };
              }, register);
              if (!action) break;
              if (action === "result" || action === "details") {
                await homePanel(ctx, () => { const latest = current(), item = latest?.teamMode?.requests.find(r => r.id === id); return { title: actionLabels[action], lines: latest && item ? (action === "result" ? requestResultLines(latest, item) : requestDetailLines(latest, item)) : ["요청이 없습니다."], choices: [{ id: "back", label: "뒤로" }] }; }, register);
                continue;
              }
              if (!selectedFence) throw new Error("표시된 요청을 다시 선택하세요.");
              selectedFence(); await dispatchRequest(ctx, id, action as RequestAction, selectedFence); break;
            }
            continue;
          }
          if (choice.startsWith("task:")) { selectedId = choice.slice(5); if (!current()?.tasks.some(t => t.id === selectedId)) throw new Error("작업이 변경되었습니다."); panel = "actions"; continue; }
          if (choice === "mode") {
            if (!before?.teamMode?.enabled && !ctx.isIdle()) throw new Error("부모 Pi 실행이 끝난 뒤 팀 모드를 켜세요.");
            const originalOwner = baselineOwner;
            const acquired = await acquireForAction(ctx), selected = acquired.owner, target = selected.controller, now = target.snapshot();
            acquired.verify();
            if (epoch !== generation || !context || realpathSync(context.cwd) !== root || realpathSync(ctx.cwd) !== root || !ctx.isProjectTrusted() || viewMarker(ctx) || isOriginalWorker(ctx) || !selected?.supervisor || selected.controller !== target || (originalOwner && selected !== originalOwner) || (before && (before.id !== now.id || Boolean(before.recoveryRequired) !== Boolean(now.recoveryRequired) || before.teamMode?.enabled !== now.teamMode?.enabled || before.teamMode?.generation !== now.teamMode?.generation)) || now.recoveryRequired) throw new Error("프로젝트 또는 팀 상태가 변경되었습니다.");
            target.store.assertOwner();
            await selected.supervisor.setMode(!before?.teamMode?.enabled);
            return;
          }
          if (choice === "help") { await homePanel(ctx, () => ({ title: "상세 / 도움말", lines: (current() ? formatBoard(current()!, currentTeam()?.currentActivity) : HELP).split("\n"), choices: [{ id: "back", label: "뒤로" }] }), register); guard(before); continue; }
          if (choice === "goal") {
            const value = await ctx.ui.input("새 목표", "프로젝트 목표를 입력하세요"); guard(before);
            if (!value?.trim()) continue;
            const target = await mutateTeam(before);
            startWork(target, target.start(value)); continue;
          }
          if (choice === "retry-plan") {
            const ok = await ctx.ui.confirm("계획 다시 만들기", "저장된 기존 목표로 계획 생성을 다시 시도합니다."); guard(before);
            if (!ok || !before?.goal) continue;
            const target = await mutateTeam(before); startWork(target, target.start(before.goal)); continue;
          }
          if (choice === "add") {
            const role = await ctx.ui.select("작업 역할", ["developer", "designer", "reviewer"]); guard(before);
            if (!role) continue;
            const value = await ctx.ui.editor("새 작업 내용", ""); guard(before);
            if (!value?.trim()) continue;
            const target = await mutateTeam(before, undefined, true);
            target.add(parseRole(role) as TaskRole, value); error = ""; continue;
          }
          if (choice === "recovery-check") {
            const ok = await ctx.ui.confirm("이전 실행 확인", "이전 실행의 소유권을 확인합니다. 남은 프로세스와 파일을 확인한 후 복구를 별도로 승인해야 합니다."); guard(before);
            if (!ok) continue;
            const target = await getController(ctx); baselineOwner = registry.owners.get(root);
            const reconciled = target.snapshot();
            if (reconciled.id !== before?.id) throw new Error("팀이 변경되었습니다. 다시 선택하세요.");
            guard(reconciled);
            continue;
          }
          if (choice === "recover") {
            const ok = await ctx.ui.confirm("복구 확인", safeDisplay(before?.recoveryReason || "이전 프로세스 종료와 파일의 부분 변경을 확인했나요?")); guard(before);
            if (!ok) continue;
            const target = currentTeam() ?? await getController(ctx); baselineOwner = registry.owners.get(root); guard(before);
            if (target.busy || !target.snapshot().recoveryRequired) throw new Error("복구 상태가 변경되었습니다.");
            target.recover(true); error = ""; continue;
          }
          if (choice === "progress") {
            const op = currentTeam()?.activeOperation; if (!op || op.id !== operationAtOpen?.id) throw new Error("실행이 변경되었습니다. 다시 선택하세요.");
            await progress(before, op);
            continue;
          }
          continue;
        }
        const task = before?.tasks.find(t => t.id === selectedId);
        if (!task) { panel = "home"; continue; }
        const id = task.id;
        let choice: string | undefined;
        if (panel === "actions") {
          choice = await homePanel(ctx, () => ({ title: task.title, status: widgetLines(current()!, currentTeam()?.currentActivity ?? "", currentTeam()?.activeOperation)[0], choices: homeActions(current()!, currentTeam()?.activeOperation, id) }), register);
          if (!choice) { panel = "home"; continue; }
        } else {
          const resultActions = homeActions(before!, team?.activeOperation, id).filter(a => ["revise", "accept", "retry", "details"].includes(a.id));
          choice = await homePanel(ctx, () => ({ title: "결과 확인", lines: homeResultLines(current()?.tasks.find(t => t.id === id) ?? task), choices: [{ id: "back", label: "뒤로" }, ...resultActions] }), register);
          if (!choice || choice === "back") { panel = "actions"; continue; }
        }
          guard(before, id);
          const action = homeActions(current()!, currentTeam()?.activeOperation, id).find(a => a.id === choice);
          if (!action) throw new Error("작업 행동이 변경되었습니다.");
          if (choice === "result") { panel = "result"; continue; }
          if (choice.startsWith("dependency:")) { selectedId = action.targetId; panel = "result"; continue; }
          if (choice === "progress" || choice === "stop") { const op = currentTeam()?.activeOperation; if (!op || op.id !== operationAtOpen?.id || op.taskId !== id) throw new Error("실행이 변경되었습니다. 다시 선택하세요."); await progress(before, op, choice === "stop"); panel = "home"; continue; }
          if (choice === "recover") { panel = "home"; continue; }
          if (choice === "content" || choice === "details") {
            await homePanel(ctx, () => ({ title: choice === "content" ? "작업 내용" : "작업 상세", lines: (choice === "content" ? task.description : formatTask(task)).split("\n"), choices: [{ id: "back", label: "뒤로" }] }), register); guard(before, id); continue;
          }
          if (choice === "run" || choice === "start-handoff" || choice === "retry") {
            const target = await mutateTeam(before, id);
            startWork(target, choice === "run" ? target.run(id) : target.resume(id)); panel = "home"; continue;
          }
          if (choice === "revise") {
            const instruction = await ctx.ui.editor("수정 요청", ""); guard(before, id);
            if (!instruction?.trim()) continue;
            const target = await mutateTeam(before, id); startWork(target, target.resume(id, instruction)); panel = "home"; continue;
          }
          if (choice === "accept") {
            const ok = await ctx.ui.confirm("결과 수락", `${safeDisplay(task.title)}\n최근 실행 ${task.attempts.at(-1)?.id ?? "없음"}을 사용자 검토 결과로 수락합니다. 테스트 통과와 별개입니다.`); guard(before, id);
            if (!ok) continue;
            const target = await mutateTeam(before, id); target.accept(id); panel = "home"; continue;
          }
      } catch (e) { if (epoch !== generation) return; error = e instanceof Error ? e.message : String(e); if (e instanceof HomePanelError) { notify(ctx, error, "error"); return; } panel = "home"; }
    }
  }

  pi.registerCommand("teams", {
    description: "프로젝트 팀 · 작업 · 모델 배정 · 검증 · 사용량",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      context = ctx;
      const [action, rest] = splitArgument(args);
      try {
        const marker = viewMarker(ctx);
        if (isOriginalWorker(ctx)) { if (ctx.hasUI) ctx.ui.notify("원본 worker 세션입니다. native /resume으로 팀 화면에 돌아가세요.", "warning"); return; }
        if (marker && !["", "help", "status", "show", "sessions", "open", "home"].includes(action)) throw new Error("읽기 전용 조회입니다. 팀 화면에서 이 명령을 실행하세요: /teams home");
        if (action === "sessions" || action === "open") {
          const root = realpathSync(ctx.cwd);
          const candidates = new Map(registry.owners);
          const localState = candidates.get(root)?.controller.snapshot() ?? ProjectStore.read(root);
          const entries: { root: string; projectId: string; item?: CatalogItem; label: string }[] = [];
          const addTeam = (teamRoot: string, state: NonNullable<typeof localState>, activity = "") => {
            if (!state.goal && !state.tasks.length && !state.planningAttempts.length) return;
            const items = catalog(state, activity);
            entries.push({ root: teamRoot, projectId: state.id, label: `팀 · ID ${state.id} · ${teamRoot} · ${(state.goal || "목표 없음").replace(/[\r\n]+/g, " ").slice(0, 80)}` });
            items.forEach((item, i) => entries.push({ root: teamRoot, projectId: state.id, item, label: `  ${i === items.length - 1 ? "└" : "├"}─ ${item.label}` }));
          };
          for (const [ownerRoot, active] of candidates) addTeam(ownerRoot, active.controller.snapshot(), active.controller.currentActivity);
          if (localState && !candidates.has(root)) addTeam(root, localState);
          if (!entries.length) { display("연결된 작업이 없습니다. /teams start <목표>"); return; }
          if (ctx.mode !== "tui") { display(`${entries.map(e => e.label).join("\n")}\n\n조회 화면은 Pi TUI에서 /teams sessions 또는 /teams open <task-id>로 여세요.`); return; }
          let entry: typeof entries[number] | undefined;
          if (action === "open") {
            const matching = entries.filter(e => e.item?.id === rest.trim());
            if (matching.length !== 1) throw new Error("작업 ID가 없거나 여러 팀에 있습니다. /teams sessions에서 선택하세요.");
            entry = matching[0];
          } else {
            const epoch = generation;
            const choice = await ctx.ui.custom<number | undefined>((tui, _theme, keys, done) => {
              let selectedIndex = 0, rootOffset = 0;
              const current = (e: typeof entries[number]) => candidates.get(e.root)?.controller.snapshot() ?? ProjectStore.read(e.root);
              const row = (e: typeof entries[number]) => {
                const state = current(e);
                if (!e.item) return `팀 ${e.projectId} · ${(state?.goal || "목표 없음").replace(/[\r\n]+/g, " ")}`;
                const task = e.item.kind === "task" ? state?.tasks.find(t => t.id === e.item!.id) : undefined;
                const attempt = task?.attempts.at(-1) ?? state?.planningAttempts.find(a => a.id === e.item!.id);
                return `  ${e.item.kind === "task" ? "작업" : "계획"} ${e.item.id} · ${task?.status ?? attempt?.outcome ?? "진행 중"} · ${(task?.title || "계획").replace(/[\r\n]+/g, " ")}`;
              };
              return {
                render(width: number) {
                  const selected = entries[selectedIndex], state = current(selected);
                  const item = selected.item && state ? catalog(state, candidates.get(selected.root)?.controller.currentActivity).find(i => i.kind === selected.item!.kind && i.id === selected.item!.id) : undefined;
                  const count = Math.max(1, Math.floor(tui.terminal.rows * 0.6) - 6);
                  const start = Math.max(0, Math.min(selectedIndex - count + 1, entries.length - count));
                  return ["팀 · 작업 세션", ...entries.slice(start, start + count).map((e, i) => `${start + i === selectedIndex ? "→ " : "  "}${row(e)}`), `팀 ${selected.projectId}`, `경로: ${sliceByColumn(selected.root, rootOffset, Math.max(1, width - 8))}`, item?.label ?? row(selected), `↑/↓ 이동 · Enter 선택 · Esc 취소 · ←/→ 경로 이동 (${selectedIndex + 1}/${entries.length})`].map(line => truncateToWidth(safeDisplay(line), width));
                },
                handleInput(data: string) {
                  if (keys.matches(data, "tui.select.cancel")) { done(undefined); return; }
                  if (keys.matches(data, "tui.select.confirm")) { done(selectedIndex); return; }
                  if (keys.matches(data, "tui.select.up")) { selectedIndex = Math.max(0, selectedIndex - 1); rootOffset = 0; }
                  else if (keys.matches(data, "tui.select.down")) { selectedIndex = Math.min(entries.length - 1, selectedIndex + 1); rootOffset = 0; }
                  else if (matchesKey(data, Key.left)) rootOffset = Math.max(0, rootOffset - 20);
                  else if (matchesKey(data, Key.right)) rootOffset = Math.min(entries[selectedIndex].root.length - 1, rootOffset + 20);
                  else return;
                  tui.requestRender();
                },
                invalidate() {},
              };
            }, { overlay: true, overlayOptions: { width: "90%", maxHeight: "60%" } });
            if (choice === undefined) return;
            if (epoch !== generation) throw new Error("세션이 변경되었습니다. 다시 선택하세요.");
            entry = entries[choice];
          }
          if (!entry) throw new Error("선택을 확인할 수 없습니다.");
          let selected = candidates.get(entry.root);
          if (!selected && entry.root === root) {
            const current = ProjectStore.read(root);
            if (!current || current.id !== entry.projectId) throw new Error("팀이 변경되었습니다.");
            const navigation = current.navigation;
            const savedView = entry.item && navigation?.views.find(v => v.kind === entry.item!.kind && v.targetId === entry.item!.id);
            if ((!entry.item && navigation) || savedView) {
              if (!ctx.sessionManager.getSessionFile()) throw new Error("--no-session에서는 영속 조회 세션을 열 수 없습니다.");
              const epoch = generation;
              checkedHeader(navigation!.root.file, root, navigation!.root.id);
              if (savedView) {
                if (!catalog(current).some(item => item.kind === entry.item!.kind && item.id === entry.item!.id && item.workerSessionId === entry.item!.workerSessionId)) throw new Error("선택한 작업이 변경되었습니다.");
                checkedView(savedView, root, current.id);
              }
              if (epoch !== generation) throw new Error("세션이 변경되었습니다.");
              await ctx.switchSession(savedView?.file ?? navigation!.root.file, { withSession: async () => {} }); return;
            }
            const unfinished = [...current.planningAttempts, ...current.tasks.flatMap(task => task.attempts)].some(attempt => !attempt.endedAt) || current.tasks.some(task => task.checks.some(check => check.status === "running"));
            if (unfinished) throw new Error("이전 실행의 복구 확인이 필요합니다. 팀 화면에서 /teams recover를 확인하세요.");
            await getController(ctx); selected = registry.owners.get(root);
          }
          if (!selected || selected.controller.snapshot().id !== entry.projectId) throw new Error("팀이 연결되어 있지 않거나 변경되었습니다.");
          if (!entry.item) {
            const navigation = selected.controller.snapshot().navigation;
            if (!navigation) { notify(ctx, "이 팀에 저장된 root 세션이 없습니다."); return; }
            selected.controller.store.assertOwner(); checkedHeader(navigation.root.file, entry.root, navigation.root.id);
            await ctx.switchSession(navigation.root.file, { withSession: async () => {} }); return;
          }
          await openItem(ctx, selected, entry.item); return;
        }
        if ((!action && !marker && ctx.mode === "tui") || (action === "home" && !marker && ctx.mode === "tui")) { await homeLoop(ctx); return; }
        if (action === "home") {
          if (!marker) { const state = controller?.store.root === realpathSync(ctx.cwd) ? controller.snapshot() : ProjectStore.read(ctx.cwd); display(state ? formatBoard(state, controller?.currentActivity) : HELP); return; }
          if (!ctx.sessionManager?.getSessionFile?.()) throw new Error("--no-session에서는 영속 팀 세션으로 이동하지 않습니다.");
          const selected = registry.owners.get(marker.root);
          if (!selected && realpathSync(ctx.cwd) !== marker.root) throw new Error("팀 연결을 찾을 수 없습니다.");
          const state = selected?.controller.snapshot() ?? ProjectStore.read(marker.root);
          if (!state || state.id !== marker.projectId) throw new Error("팀 연결을 찾을 수 없습니다.");
          const navigation = state.navigation;
          if (!navigation) throw new Error("팀 root가 없습니다.");
          selected?.controller.store.assertOwner(); checkedHeader(navigation.root.file, marker.root, navigation.root.id);
          const pending = registry.pendingHome = { root: marker.root, file: navigation.root.file };
          try { const result = await ctx.switchSession(navigation.root.file, { withSession: async () => {} }); if (result.cancelled && registry.pendingHome === pending) registry.pendingHome = undefined; }
          catch (error) { if (registry.pendingHome === pending) registry.pendingHome = undefined; throw error; }
          return;
        }
        if (action === "mode") {
          const sub = rest.trim() || "status";
          if (!["on", "off", "status"].includes(sub)) throw new Error("사용법: /teams mode on|off|status");
          if (sub === "status") {
            const state = controller?.store.root === realpathSync(ctx.cwd) ? controller.snapshot() : ProjectStore.read(ctx.cwd);
            const mode = state?.teamMode;
            const latest = mode?.coordinatorAttempts.at(-1);
            display([`팀 모드: ${mode?.enabled ? "ON" : "OFF"}`, ...(mode?.requests.slice(-20).map(r => `${requestStatus(state!, r)} · ${requestTitle(r)}${r.reason ? ` · ${r.reason}` : ""}${r.answer ? `\n${r.answer}` : ""}`) ?? []), ...(controller?.busy ? [`작업/검증 진행 중: ${controller.currentActivity}`] : []), ...(latest ? [`조율: ${latest.endedAt ? latest.outcome : "진행 중"} · 요청 ${latest.profile.provider}/${latest.profile.model} ${latest.profile.effort} · 반환 ${latest.effectiveModels.join(", ") || "미확인"} · 사용 토큰 ${latest.usage.totalTokens ?? "미확인"}`] : [])].join("\n"));
            return;
          }
          if (sub === "on" && !ctx.isIdle()) throw new Error("부모 Pi 실행이 끝난 뒤 팀 모드를 켜세요.");
          const acquired = await acquireForAction(ctx); acquired.verify();
          await acquired.owner.supervisor!.setMode(sub === "on");
          notify(ctx, sub === "on" ? "팀 모드 ON · 일반 입력을 팀에 접수합니다." : "팀 모드 OFF · 이미 실행 중인 작업은 계속됩니다.");
          return;
        }
        if (action === "request") {
          const [verb, explicitId] = splitArgument(rest);
          if (verb && !["resume", "stop", "accept", "revise", "recheck"].includes(verb)) throw new Error("사용법: /teams request [resume|stop|accept|revise|recheck] [id]");
          const root = realpathSync(ctx.cwd), selected = registry.owners.get(root), state = selected?.controller.snapshot() ?? ProjectStore.read(root);
          if (!state) { notify(ctx, "요청이 없습니다. 새 요청을 시작하세요."); return; }
          const candidates = state.teamMode?.requests.filter(r => !verb || requestActions(state, r).includes(verb as RequestAction)) ?? [];
          if (!candidates.length) { notify(ctx, "선택할 수 있는 요청이 없습니다."); return; }
          const epoch = generation, sessionId = ctx.sessionManager.getSessionId();
          const navigationState = () => {
            if (epoch !== generation || !context || realpathSync(context.cwd) !== root || realpathSync(ctx.cwd) !== root || ctx.sessionManager.getSessionId() !== sessionId || context.sessionManager.getSessionId() !== sessionId || !ctx.isProjectTrusted() || viewMarker(ctx) || isOriginalWorker(ctx) || registry.owners.get(root) !== selected) throw new Error("프로젝트 또는 세션이 변경되었습니다.");
            selected?.controller.store.assertOwner(); const now = selected?.controller.snapshot() ?? ProjectStore.read(root);
            if (!now || now.id !== state.id) throw new Error("팀이 변경되었습니다."); return now;
          };
          let id = explicitId.trim();
          if (!id) {
            if (!ctx.hasUI) { display("요청을 선택하려면 Pi 화면 또는 명시적 요청 ID가 필요합니다."); return; }
            const options = candidates.map((r, i) => `${requestStatus(state, r)} · ${requestTitle(r)} · ${r.receivedAt} · ${i + 1}`);
            const selection = await ctx.ui.select("요청 선택", options);
            if (selection === undefined) return;
            const index = options.indexOf(selection); if (index < 0) throw new Error("요청 선택이 변경되었습니다.");
            id = candidates[index].id; if (!navigationState().teamMode?.requests.some(r => r.id === id)) throw new Error("요청이 변경되었습니다.");
          }
          let action = verb as RequestAction;
          const current = navigationState(), request = current.teamMode?.requests.find(r => r.id === id);
          if (!request) throw new Error("요청이 없습니다.");
          const fence = requestFence(ctx, id);
          if (!action) {
            if (!ctx.hasUI) { display(requestResultLines(current, request).join("\n")); return; }
            const actions = requestActions(current, request), choice = await ctx.ui.select("요청 행동", actions.map(a => actionLabels[a]));
            if (choice === undefined) return;
            navigationState();
            action = actions.find(a => actionLabels[a] === choice)!; if (!action) throw new Error("요청 행동이 변경되었습니다.");
          }
          if (action === "result" || action === "details") { const now = navigationState(), item = now.teamMode?.requests.find(r => r.id === id); if (!item) throw new Error("요청이 없습니다."); display((action === "result" ? requestResultLines(now, item) : requestDetailLines(now, item)).join("\n")); return; }
          if (action === "accept" && (!ctx.hasUI || !["tui", "rpc"].includes(ctx.mode))) throw new Error("결과 수락에는 Pi TUI 또는 RPC 확인이 필요합니다.");
          if (!ctx.hasUI) {
            if (action === "revise" || action === "recheck") throw new Error("이 행동에는 Pi 화면의 확인 또는 수정 입력이 필요합니다.");
            let active = selected;
            if (!active?.supervisor) {
              const epoch = generation, expected = JSON.stringify(current);
              await getController(ctx); active = registry.owners.get(root);
              if (epoch !== generation || !context || realpathSync(context.cwd) !== root || realpathSync(ctx.cwd) !== root || !ctx.isProjectTrusted() || viewMarker(ctx) || isOriginalWorker(ctx) || !active?.supervisor || JSON.stringify(active.controller.snapshot()) !== expected) throw new Error("팀 또는 요청이 변경되었습니다.");
              active.controller.store.assertOwner();
            } else fence();
            if (action === "stop") { await active.supervisor!.stop(id); return; }
            if (action === "resume") { active.supervisor!.resume(id); return; }
            throw new Error("이 행동에는 Pi 화면의 확인 또는 수정 입력이 필요합니다.");
          }
          await dispatchRequest(ctx, id, action, fence); return;
        }
        if (action === "handoff-result") {
          const state = controller?.store.root === realpathSync(ctx.cwd) ? controller.snapshot() : ProjectStore.read(ctx.cwd);
          pi.sendMessage({ customType: "codexteams.handoff.result", content: JSON.stringify(handoffResult(state, rest.trim(), realpathSync(ctx.cwd))), display: true }, { triggerTurn: false });
          return;
        }
        if (action === "handoff") {
          let requestId: string | null = null;
          const run = async () => {
            try {
              const match = /^("(?:\\.|[^"\\])*")(?:\s+([a-f0-9]{64}))?$/.exec(rest.trim());
              if (!match) throw new Error("Request path must be a JSON string.");
              const path: unknown = JSON.parse(match[1]);
              if (typeof path !== "string") throw new Error("Request path must be a JSON string.");
              const request = readRequest(path, ctx.cwd);
              requestId = request.requestId;
              if (match[2] && match[2] !== requestDigest(request)) throw new Error("Request changed after CLI validation.");
              const team = await getController(ctx);
              return await team.handoff(request);
            } catch (error) {
              return { schemaVersion: 1, kind: "codexteams.handoff.result", requestId, status: "rejected", task: null, error: error instanceof Error ? error.message : String(error), limitations: ["Request did not complete."] };
            }
          };
          const root = realpathSync(ctx.cwd), startedIn = generation;
          const deliver = async () => {
            const result = await run();
            try {
              const binding = registry.owners.get(root)?.binding;
              if (binding) binding.message(JSON.stringify(result), "codexteams.handoff.result");
              else if (startedIn === generation) pi.sendMessage({ customType: "codexteams.handoff.result", content: JSON.stringify(result), display: true }, { triggerTurn: false });
            } catch { /* delivery must not change the saved result */ }
          };
          if (ctx.hasUI) { void deliver().catch(error => { try { registry.owners.get(root)?.binding?.notify(String(error), "error"); } catch {} }); showWidget(); }
          else await deliver();
          return;
        }
        if (!action || action === "status" || (action === "launch" && !rest.trim())) {
          const state = controller?.store.root === realpathSync(ctx.cwd) ? controller.snapshot() : ProjectStore.read(ctx.cwd);
          display(state ? formatBoard(state, controller?.currentActivity) : HELP); return;
        }
        if (action === "help") { display(HELP); return; }
        if (action === "show") {
          const state = controller?.store.root === realpathSync(ctx.cwd) ? controller.snapshot() : ProjectStore.read(ctx.cwd);
          const task = state?.tasks.find(t => t.id === rest.trim());
          if (!task) throw new Error("작업 ID를 확인하세요. /teams status");
          display(formatTask(task)); return;
        }
        if (action === "launch") {
          const state = controller?.store.root === realpathSync(ctx.cwd) ? controller.snapshot() : ProjectStore.read(ctx.cwd);
          if (state && (state.goal || state.tasks.length || state.planningAttempts.length)) {
            display(`${formatBoard(state, controller?.currentActivity)}\n\n기존 프로젝트를 표시했습니다. /teams run, /teams resume 또는 /teams recover로 이어가세요.`);
            return;
          }
        }
        if (!["launch", "start", "add", "run", "resume", "check", "accept", "profile", "cancel", "recover"].includes(action)) throw new Error("알 수 없는 명령입니다. /teams help");
        if (action === "resume" && !rest.trim()) {
          if (!ctx.isProjectTrusted()) throw new Error("Pi에서 이 프로젝트를 신뢰한 뒤 팀 작업을 시작하세요.");
          const saved = controller?.store.root === realpathSync(ctx.cwd) ? controller.snapshot() : ProjectStore.read(ctx.cwd);
          if (!saved?.tasks.length) { notify(ctx, "재개할 작업이 없습니다. /teams status에서 작업을 확인하세요."); return; }
        }
        if (action === "accept") {
          if (!ctx.hasUI || !["tui", "rpc"].includes(ctx.mode)) throw new Error("결과 수락에는 Pi TUI 또는 RPC 확인이 필요합니다.");
          const root = realpathSync(ctx.cwd), epoch = generation, ownerAtOpen = registry.owners.get(root), state = ownerAtOpen?.controller.snapshot() ?? ProjectStore.read(root), id = rest.trim();
          const task = state?.tasks.find(t => t.id === id); if (!state || !task) throw new Error("작업 ID를 확인하세요.");
          const managed = state.teamMode?.requests.find(r => r.taskIds.includes(id));
          if (managed) { if (managed.taskIds[0] !== id) throw new Error("구현 결과를 선택하세요."); await dispatchRequest(ctx, managed.id, "accept"); return; }
          const relevant = (s: typeof state) => { const t = s.tasks.find(x => x.id === id); return JSON.stringify({ project: s.id, recovery: s.recoveryRequired, mode: [s.teamMode?.enabled, s.teamMode?.generation], task: t }); };
          const original = relevant(state);
          const guardAccept = () => { const now = registry.owners.get(root); if (epoch !== generation || !context || realpathSync(context.cwd) !== root || realpathSync(ctx.cwd) !== root || !ctx.isProjectTrusted() || viewMarker(ctx) || isOriginalWorker(ctx) || now !== ownerAtOpen) throw new Error("프로젝트 또는 세션이 변경되었습니다."); now?.controller.store.assertOwner(); const s = now?.controller.snapshot() ?? ProjectStore.read(root); if (!s || relevant(s) !== original) throw new Error("작업 또는 결과가 변경되었습니다."); };
          guardAccept(); const ok = await ctx.ui.confirm("결과 수락", `${safeDisplay(task.title)}\n현재 결과를 명시적으로 수락합니다.`); guardAccept(); if (!ok) return;
          const team = ownerAtOpen?.controller ?? await getController(ctx);
          if (!ownerAtOpen) { if (epoch !== generation || !context || realpathSync(context.cwd) !== root || realpathSync(ctx.cwd) !== root || !ctx.isProjectTrusted() || viewMarker(ctx) || isOriginalWorker(ctx) || relevant(team.snapshot()) !== original) throw new Error("작업 또는 결과가 변경되었습니다."); team.store.assertOwner(); } else guardAccept();
          team.accept(id); notify(ctx, "결과를 수락했습니다."); return;
        }
        const team = await getController(ctx);
        switch (action) {
          case "launch": await operation(team.launch(rest), ctx, summary => `실행 ${summary.executed.length}개 · 검토 대기 ${summary.waitingReview.length}개 · 남은 대기 ${summary.blocked.length}개. /teams status`); break;
          case "start": await operation(team.start(rest), ctx, tasks => `${tasks.length}개 작업을 준비했습니다. /teams status에서 확인한 뒤 /teams run으로 시작하세요.`); break;
          case "add": {
            const [role, content] = splitArgument(rest);
            if (role === "planner") throw new Error("planner는 작업 담당 역할이 아닙니다.");
            const task = team.add(parseRole(role) as TaskRole, content); notify(ctx, `${task.id} 추가`); break;
          }
          case "run": await operation(team.run(rest.trim() || undefined), ctx, summary => `실행 ${summary.executed.length}개 · 검토 대기 ${summary.waitingReview.length}개 · 남은 대기 ${summary.blocked.length}개. /teams status`); break;
          case "resume": {
            let [id, instruction] = splitArgument(rest);
            if (!id) {
              const ensureReady = () => {
                if (!ctx.isProjectTrusted()) throw new Error("Pi에서 이 프로젝트를 신뢰한 뒤 팀 작업을 시작하세요.");
                if (team.busy) throw new Error("이미 작업 또는 검증이 실행 중입니다. /teams cancel로 중단할 수 있습니다.");
                const state = team.snapshot();
                if (state.recoveryRequired) throw new Error(state.recoveryReason || "프로젝트 복구 확인이 필요합니다. /teams recover");
                return state;
              };
              const state = ensureReady();
              const candidates = resumeCandidates(state);
              if (!candidates.length) { notify(ctx, "재개할 작업이 없습니다. /teams status에서 작업을 확인하세요."); break; }
              if (!ctx.hasUI) {
                display(["재개할 작업", ...candidates.map(candidate => `- ${candidate.option}`), "", "작업 ID를 지정하세요: /teams resume <id> [수정 지시]"].join("\n"));
                break;
              }
              const startedIn = generation;
              const root = team.store.root;
              const selection = await ctx.ui.select("이어갈 작업 선택", candidates.map(candidate => candidate.option));
              if (selection === undefined) break;
              if (startedIn !== generation || controller !== team || realpathSync(ctx.cwd) !== root || !context || realpathSync(context.cwd) !== root) throw new Error("프로젝트 또는 세션이 변경되었습니다. /teams resume로 다시 선택하세요.");
              const candidate = candidates.find(candidate => candidate.option === selection);
              if (!candidate) throw new Error("선택한 작업을 확인할 수 없습니다. /teams resume로 다시 선택하세요.");
              const current = ensureReady();
              const previousTask = state.tasks.find(task => task.id === candidate.id)!;
              const selectedTask = current.tasks.find(task => task.id === candidate.id);
              if (!selectedTask || selectedTask.status !== previousTask.status || selectedTask.updatedAt !== previousTask.updatedAt || !resumeCandidates(current).some(task => task.id === candidate.id)) throw new Error("작업 상태가 변경되었습니다. /teams resume로 다시 선택하세요.");
              id = candidate.id;
              instruction = "";
            }
            await operation(team.resume(id, instruction), ctx, () => `${id} 실행이 끝났습니다. 결과를 확인하세요.`); break;
          }
          case "check": {
            const [id, command] = splitArgument(rest); await operation(team.check(id, command), ctx, () => `${id} 검증 기록을 저장했습니다. /teams show ${id}`); break;
          }
          case "profile": {
            const [role, settings] = splitArgument(rest); const [model, effort] = splitArgument(settings);
            team.setProfile(parseRole(role), parseProfile(model, effort.trim())); notify(ctx, "다음 실행부터 새 프로필을 적용합니다."); break;
          }
          case "cancel": await team.cancel(); notify(ctx, "실행 중단을 확인했습니다."); break;
          case "recover": {
            if (!team.snapshot().recoveryRequired) { notify(ctx, "복구할 비정상 종료 기록이 없습니다."); break; }
            if (!ctx.hasUI) throw new Error("복구 확인은 Pi 대화형 화면에서 실행하세요.");
            const confirmed = await ctx.ui.confirm("중단된 작업 복구", "이전 Pi 작업과 검증 프로세스가 종료됐고, 프로젝트 파일의 부분 변경을 확인했나요?");
            if (confirmed) { team.recover(true); notify(ctx, "복구 확인 완료. /teams resume로 이어가세요."); }
            break;
          }
        }
        showWidget();
      } catch (error) { notify(ctx, error instanceof Error ? error.message : String(error), "error"); }
    },
  });

  pi.registerTool({
    name: "codexteams_status",
    label: "codexteams 상태",
    description: "현재 프로젝트의 작업·모델·알려진 사용량을 읽습니다. 실행·검증·수락·설정 변경은 하지 않습니다.",
    parameters: Type.Object({ taskId: Type.Optional(Type.String({ maxLength: 48 })) }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const state = controller?.store.root === realpathSync(ctx.cwd) ? controller.snapshot() : ProjectStore.read(ctx.cwd);
      const task = params.taskId ? state?.tasks.find(t => t.id === params.taskId) : undefined;
      const content = params.taskId && !task ? "작업을 찾을 수 없습니다." : task ? formatTask(task) : state ? formatBoard(state, controller?.currentActivity) : "등록된 팀 프로젝트가 없습니다. /teams start <목표>";
      return { content: [{ type: "text", text: content }], details: { projectId: state?.id ?? null, revision: state?.revision ?? null, readOnly: true } };
    },
  });

  pi.on("input", async (event, ctx) => {
    if (viewMarker(ctx) || isOriginalWorker(ctx)) { if (ctx.hasUI) ctx.ui.notify("읽기 전용 세션입니다. 팀 화면으로 돌아가세요.", "warning"); return { action: "handled" }; }
    if (event.source === "extension") return { action: "continue" };
    try {
      const root = realpathSync(ctx.cwd), current = registry.owners.get(root);
      const state = current?.controller.snapshot() ?? ProjectStore.read(root);
      if (!state?.teamMode?.enabled) return { action: "continue" };
      if (event.images?.length) { notify(ctx, "팀 모드는 이미지 첨부를 지원하지 않습니다. 텍스트만 다시 보내세요.", "warning"); return { action: "handled" }; }
      const acquired = await acquireForAction(ctx); acquired.verify();
      const requestId = acquired.owner.supervisor!.ingest({ text: event.text, origin: event.source, sessionId: ctx.sessionManager.getSessionId(), ...(event.streamingBehavior ? { streamingIntent: event.streamingBehavior } : {}) });
      notify(ctx, `요청 접수 · ${event.text.replace(/\s+/g, " ").slice(0, 80)} · 진행 확인은 /teams`);
    } catch (error) { notify(ctx, `팀 요청을 접수하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`, "error"); }
    return { action: "handled" };
  });
  const parentWriteBlocked = (ctx: ExtensionContext): boolean => {
    try {
      const root = realpathSync(ctx.cwd), current = registry.owners.get(root);
      return Boolean(current?.controller.busy || current?.controller.snapshot().teamMode?.enabled || (!current && ProjectStore.read(root)?.teamMode?.enabled));
    } catch { return true; }
  };
  pi.on("tool_call", async (event, ctx) => {
    if (viewMarker(ctx) || isOriginalWorker(ctx)) return { block: true, reason: "읽기 전용 조회입니다. /teams home" };
    if (parentWriteBlocked(ctx) && !["read", "grep", "find", "ls", "codexteams_status"].includes(event.toolName)) return { block: true, reason: "팀 모드 또는 팀 실행 중에는 부모의 쓰기·명령 실행을 차단합니다." };
    return undefined;
  });
  pi.on("user_bash", async (_event, ctx) => (viewMarker(ctx) || isOriginalWorker(ctx) || parentWriteBlocked(ctx)) ? { result: { output: "팀 모드 또는 팀 실행 중에는 명령을 실행할 수 없습니다.", exitCode: 1, cancelled: false, truncated: false } } : undefined);
  pi.on("session_before_switch", async (event, ctx) => {
    const target = event.targetSessionFile;
    if (!target) return;
    const path = resolve(target);
    try { if (realpathSync(path) !== path) { notify(ctx, "심볼릭 링크 세션은 열 수 없습니다.", "warning"); return { cancel: true }; } }
    catch { notify(ctx, "대상 세션을 확인할 수 없습니다.", "warning"); return { cancel: true }; }
    const roots = new Set([...registry.owners.keys(), realpathSync(ctx.cwd)]);
    if ([...roots].some(root => path.startsWith(join(root, ".codexteams", "sessions") + sep))) {
      notify(ctx, "원본 worker 세션은 열 수 없습니다. /teams sessions를 사용하세요.", "warning"); return { cancel: true };
    }
    let destination: string;
    try {
      const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      try {
        if (!fstatSync(fd).isFile()) throw new Error("not a file");
        const bytes = Buffer.alloc(16384), n = readSync(fd, bytes, 0, bytes.length, 0), end = bytes.indexOf(10);
        if (end < 0 || end >= n) throw new Error("bad header");
        const header = JSON.parse(bytes.subarray(0, end).toString("utf8"));
        if (header.type !== "session" || typeof header.cwd !== "string") throw new Error("bad header");
        destination = realpathSync(header.cwd);
      } finally { closeSync(fd); }
    } catch { notify(ctx, "대상 세션을 안전하게 확인할 수 없습니다.", "warning"); return { cancel: true }; }
    const explicit = realpathSync(fileURLToPath(new URL("./index.ts", import.meta.url)));
    const separator = process.argv.indexOf("--");
    const args = separator < 0 ? process.argv : process.argv.slice(0, separator);
    const extensionPaths = args.flatMap((arg, i) => (arg === "-e" || arg === "--extension") && args[i + 1] ? [args[i + 1]] : []);
    const managed = args.includes("--no-extensions") && extensionPaths.length === 1 && extensionPaths[0] === explicit;
    if (!managed && destination !== realpathSync(ctx.cwd) && [...registry.owners.values()].some(o => o.controller.busy || o.supervisor?.busy)) {
      notify(ctx, "실행 중인 팀은 다른 프로젝트로 이동할 수 없습니다. codexteams launcher를 사용하세요.", "warning"); return { cancel: true };
    }
    if (!managed && destination !== realpathSync(ctx.cwd)) await cleanupOwners(registry);
  });
  pi.on("session_start", async (_event, ctx) => {
    const file = ctx.sessionManager?.getSessionFile?.();
    if (activeViewFile && activeViewFile === file && activeViewContext === ctx) { attach(ctx); return; }
    generation++;
    if (viewTimer) clearTimeout(viewTimer);
    viewTimer = undefined;
    const previousHome = closeHome; closeHome = undefined; previousHome?.();
    const previousView = closeView; closeView = undefined; previousView?.();
    activeViewFile = undefined; activeViewContext = undefined;
    attach(ctx);
    if (ctx.mode !== "tui" || !ctx.isProjectTrusted()) { registry.pendingHome = undefined; return; }
    const marker = viewMarker(ctx);
    const pendingHome = registry.pendingHome;
    if (pendingHome && !marker && file === pendingHome.file && realpathSync(ctx.cwd) === pendingHome.root) {
      registry.pendingHome = undefined;
      const epoch = generation;
      viewTimer = setTimeout(() => { viewTimer = undefined; if (generation === epoch) pi.sendUserMessage("/teams home", { expandPromptTemplates: true }); }, 0);
      return;
    }
    if (pendingHome) registry.pendingHome = undefined;
    if (!marker || !file) return;
    const epoch = generation;
    try {
      if (realpathSync(ctx.cwd) !== marker.root) throw new Error("조회 프로젝트가 일치하지 않습니다.");
      const getState = () => registry.owners.get(marker.root)?.controller.snapshot() ?? ProjectStore.read(marker.root);
      const state = getState();
      if (!state || state.id !== marker.projectId || !state.navigation) throw new Error("조회 팀 연결을 찾을 수 없습니다.");
      const view = state.navigation.views.find(v => v.kind === marker.kind && v.targetId === marker.targetId);
      if (!view) throw new Error("조회 연결을 찾을 수 없습니다.");
      checkedHeader(state.navigation.root.file, marker.root, state.navigation.root.id);
      checkedView(view, marker.root, state.id);
      const header = ctx.sessionManager.getHeader();
      if (!header || (file !== view.file && header.parentSession !== view.file)) throw new Error("조회 세션의 원본 연결이 일치하지 않습니다.");
      checkedHeader(file, marker.root, ctx.sessionManager.getSessionId(), header.parentSession);
      const item = catalog(state).find(v => v.kind === marker.kind && v.id === marker.targetId);
      if (!item) throw new Error("조회 작업을 찾을 수 없습니다.");
      activeViewFile = file; activeViewContext = ctx;
      viewTimer = setTimeout(() => {
        viewTimer = undefined;
        if (epoch !== generation) return;
        const snapshot = () => { const current = getState(); if (!current || current.id !== marker.projectId) throw new Error("조회 팀이 변경되었습니다."); return current; };
        void showView(ctx, { root: marker.root, snapshot }, item).then(() => {
          if (generation === epoch && activeViewFile === file) {
            activeViewFile = undefined; activeViewContext = undefined;
            // Public command dispatch obtains a fresh command context. /teams home is
            // the user's Esc action and is consumed as a command before any model turn.
            pi.sendUserMessage("/teams home", { expandPromptTemplates: true });
          }
        }).catch(error => { if (generation === epoch) { activeViewFile = undefined; activeViewContext = undefined; notify(ctx, String(error), "error"); } });
      }, 0);
    } catch (error) { notify(ctx, error instanceof Error ? error.message : String(error), "warning"); }
  });
  pi.on("session_shutdown", async event => {
    generation++;
    if (viewTimer) clearTimeout(viewTimer);
    viewTimer = undefined; activeViewFile = undefined; activeViewContext = undefined;
    const home = closeHome; closeHome = undefined; home?.();
    const close = closeView; closeView = undefined; close?.();
    if (owner?.binding?.token === token) owner.binding = undefined;
    if (context?.hasUI) { try { context.ui.setWidget("codexteams", undefined); context.ui.setStatus("codexteams", undefined); } catch {} }
    context = undefined; controller = undefined; owner = undefined;
    if (!["new", "resume", "fork"].includes(event.reason)) { registry.pendingHome = undefined; await cleanupOwners(registry); }
  });
}
