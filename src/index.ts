import { realpathSync } from "node:fs";
import { Type } from "typebox";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { TeamController } from "./core/controller.ts";
import { ProjectStore } from "./core/store.ts";
import { parseProfile, parseRole } from "./core/profiles.ts";
import { runPiWorker } from "./runtime/pi-runner.ts";
import { formatBoard, formatTask, widgetLines } from "./ui/format.ts";
import type { ModelProfile, TaskRole } from "./core/types.ts";

const HELP = `## codexteams

\`/teams launch <목표>\` — 새 프로젝트 계획을 만들고 준비된 작업 실행
\`/teams start <목표>\` — 프로젝트를 읽고 작업 계획 생성
\`/teams run [id]\` — 준비된 작업 실행
\`/teams add <developer|designer|reviewer> <내용>\` — 후속 작업 추가
\`/teams show <id>\` — 결과와 검증 기록
\`/teams resume <id> [수정 지시]\` — 중단·실패·검토 대기 작업 이어가기
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
  const model = ctx.modelRegistry.find(profile.provider, profile.model);
  if (!model) throw new Error(`Pi에서 모델을 찾을 수 없습니다: ${profile.provider}/${profile.model}. /model 또는 /teams profile을 확인하세요.`);
  if (!ctx.modelRegistry.hasConfiguredAuth(model)) throw new Error(`${profile.provider} 인증이 없습니다. Pi /login으로 연결하세요. 다른 과금 경로로 전환하지 않습니다.`);
  const supported = getSupportedThinkingLevels(model);
  if (!supported.includes(profile.effort)) throw new Error(`${profile.model}은 ${profile.effort}를 지원하지 않습니다. 지원 단계: ${supported.join(", ")}`);
}

export default function codexteams(pi: ExtensionAPI): void {
  if (process.env.CODEXTEAMS_WORKER === "1") return;
  let controller: TeamController | undefined;
  let context: ExtensionContext | undefined;
  let generation = 0;

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

  async function getController(ctx: ExtensionContext): Promise<TeamController> {
    if (!ctx.isProjectTrusted()) throw new Error("Pi에서 이 프로젝트를 신뢰한 뒤 팀 작업을 시작하세요.");
    context = ctx;
    const root = realpathSync(ctx.cwd);
    if (controller && controller.store.root !== root) { await controller.shutdown(); controller = undefined; }
    if (!controller) controller = new TeamController(ProjectStore.open(root), { runner: runPiWorker, validateProfile: profile => validateRuntimeProfile(profile, context || ctx), onChange: () => showWidget() });
    return controller;
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

  pi.registerCommand("teams", {
    description: "프로젝트 팀 · 작업 · 모델 배정 · 검증 · 사용량",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      context = ctx;
      const [action, rest] = splitArgument(args);
      try {
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
            display(`${formatBoard(state, controller?.currentActivity)}\n\n기존 프로젝트를 표시했습니다. /teams run, /teams resume <id> 또는 /teams recover로 이어가세요.`);
            return;
          }
        }
        if (!["launch", "start", "add", "run", "resume", "check", "accept", "profile", "cancel", "recover"].includes(action)) throw new Error("알 수 없는 명령입니다. /teams help");
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
            const [id, instruction] = splitArgument(rest); await operation(team.resume(id, instruction), ctx, () => `${id} 실행이 끝났습니다. 결과를 확인하세요.`); break;
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
            if (confirmed) { team.recover(true); notify(ctx, "복구 확인 완료. /teams resume <id>로 이어가세요."); }
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

  pi.on("session_start", async (_event, ctx) => { context = ctx; });
  pi.on("session_shutdown", async () => {
    generation++;
    const current = controller; controller = undefined;
    if (current) await current.shutdown();
    if (context?.hasUI) { context.ui.setWidget("codexteams", undefined); context.ui.setStatus("codexteams", undefined); }
    context = undefined;
  });
}
