import { closeSync, constants, fstatSync, openSync, readSync, realpathSync, readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Key, matchesKey, sliceByColumn, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { TeamController } from "./core/controller.ts";
import { ProjectStore } from "./core/store.ts";
import { cleanupOwners, processRegistry, type ProcessOwner } from "./core/process-registry.ts";
import { checkedHeader, checkedView, ensureView, VIEW_MARKER } from "./core/navigation.ts";
import { catalog, sessionStatus, type CatalogItem } from "./ui/session-catalog.ts";
import { readPublicTranscript } from "./ui/session-transcript.ts";
import { handoffResult, readRequest, requestDigest } from "./core/handoff.mjs";
import { parseProfile, parseRole } from "./core/profiles.ts";
import { runPiWorker } from "./runtime/pi-runner.ts";
import { formatAttemptHistory, formatBoard, formatTask, resumeCandidates, widgetLines } from "./ui/format.ts";
import type { ModelProfile, TaskRole } from "./core/types.ts";

const HELP = `## codexteams

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
  let activeViewFile: string | undefined;
  let activeViewContext: ExtensionContext | undefined;

  const display = (content: string) => pi.sendMessage({ customType: "codexteams", content, display: true }, { triggerTurn: false });
  const notify = (ctx: ExtensionContext, text: string, level: "info" | "warning" | "error" = "info") => {
    try { if (ctx.hasUI) ctx.ui.notify(text, level); else display(text); } catch { /* UI may be gone after shutdown */ }
  };
  const showWidget = () => {
    if (!context?.hasUI || !controller) return;
    const state = controller.snapshot();
    context.ui.setStatus("codexteams", `teams ${state.tasks.filter(t => t.status === "completed").length}/${state.tasks.length}${controller.busy ? " · 실행 중" : ""}`);
    context.ui.setWidget("codexteams", widgetLines(state, controller.currentActivity));
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
      created.controller = new TeamController(ProjectStore.open(root), { runner: runPiWorker, validateProfile: profile => validateProfileWithRegistry(profile, created.registry), onChange: () => created.binding?.changed() });
      registry.owners.set(root, created); found = created;
    }
    attach(ctx);
    return found.controller;
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
    await ctx.ui.custom<void>((tui, _theme, keys, done) => {
      let offset = 0, historyPage = 0;
      const timer = setInterval(() => tui.requestRender(), 1000);
      const close = () => done();
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
          return [`${item.kind === "task" ? "작업" : "계획"} ${item.id} · ${state.recoveryRequired ? "복구 필요 · " : ""}${status} · ${sessionStatus(root, attempt)} · ${task?.role ?? "planner"} · ${profile.provider}/${profile.model} / ${profile.effort}`, `팀 ${state.id}`, `경로: ${root}`, `실제 ${attempt?.effectiveModels.join(", ") || "확인 대기"} · 원본 worker 읽기 전용 · 복귀: /teams home · Esc`, ...lines.slice(offset, offset + page), `줄 ${offset + 1}–${Math.min(offset + page, lines.length)} / ${lines.length} · ↑/↓ 이동 · PgUp/PgDn 이력 ${historyPage + 1}/${Math.max(1, Math.ceil(attempts.length / 20))}`].map(line => truncateToWidth(line, width));
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
        dispose() { clearInterval(timer); if (closeView === close) closeView = undefined; },
      };
    }, { overlay: true, overlayOptions: { width: "90%", maxHeight: "60%" } });
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
                  return ["팀 · 작업 세션", ...entries.slice(start, start + count).map((e, i) => `${start + i === selectedIndex ? "→ " : "  "}${row(e)}`), `팀 ${selected.projectId}`, `경로: ${sliceByColumn(selected.root, rootOffset, Math.max(1, width - 8))}`, item?.label ?? row(selected), `↑/↓ 이동 · Enter 선택 · Esc 취소 · ←/→ 경로 이동 (${selectedIndex + 1}/${entries.length})`].map(line => truncateToWidth(line, width));
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
        if (action === "home") {
          if (!ctx.sessionManager?.getSessionFile?.()) throw new Error("--no-session에서는 영속 팀 세션으로 이동하지 않습니다.");
          if (!marker) { display("현재 팀 화면입니다."); return; }
          const selected = registry.owners.get(marker.root);
          if (!selected && realpathSync(ctx.cwd) !== marker.root) throw new Error("팀 연결을 찾을 수 없습니다.");
          const state = selected?.controller.snapshot() ?? ProjectStore.read(marker.root);
          if (!state || state.id !== marker.projectId) throw new Error("팀 연결을 찾을 수 없습니다.");
          const navigation = state.navigation;
          if (!navigation) throw new Error("팀 root가 없습니다.");
          selected?.controller.store.assertOwner(); checkedHeader(navigation.root.file, marker.root, navigation.root.id);
          await ctx.switchSession(navigation.root.file, { withSession: async fresh => { await fresh.sendMessage({ customType: "codexteams", content: "팀 화면으로 돌아왔습니다.", display: true }, { triggerTurn: false }); } }); return;
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
          case "accept": team.accept(rest.trim()); notify(ctx, `${rest.trim()} 수락 완료`); break;
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

  pi.on("input", async (_event, ctx) => {
    if (viewMarker(ctx) || isOriginalWorker(ctx)) { if (ctx.hasUI) ctx.ui.notify("읽기 전용 세션입니다. 팀 화면으로 돌아가세요.", "warning"); return { action: "handled" }; }
    return { action: "continue" };
  });
  pi.on("tool_call", async (_event, ctx) => (viewMarker(ctx) || isOriginalWorker(ctx)) ? { block: true, reason: "읽기 전용 조회입니다. /teams home" } : undefined);
  pi.on("user_bash", async (_event, ctx) => (viewMarker(ctx) || isOriginalWorker(ctx)) ? { result: { output: "읽기 전용 조회입니다. /teams home", exitCode: 1, cancelled: false, truncated: false } } : undefined);
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
    if (!managed && destination !== realpathSync(ctx.cwd) && [...registry.owners.values()].some(o => o.controller.busy)) {
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
    const previousView = closeView; closeView = undefined; previousView?.();
    activeViewFile = undefined; activeViewContext = undefined;
    attach(ctx);
    if (ctx.mode !== "tui" || !ctx.isProjectTrusted()) return;
    const marker = viewMarker(ctx);
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
    const close = closeView; closeView = undefined; close?.();
    if (owner?.binding?.token === token) owner.binding = undefined;
    if (context?.hasUI) { try { context.ui.setWidget("codexteams", undefined); context.ui.setStatus("codexteams", undefined); } catch {} }
    context = undefined; controller = undefined; owner = undefined;
    if (!["new", "resume", "fork"].includes(event.reason)) await cleanupOwners(registry);
  });
}
