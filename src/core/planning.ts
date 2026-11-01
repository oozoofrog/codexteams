import type { PlannedTask } from "./types.ts";

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}: 객체가 필요합니다.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string, maxBytes = 16384): string {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value, "utf8") > maxBytes) throw new Error(`${name}: 비어 있거나 너무 긴 문자열입니다.`);
  return value.trim();
}

export function parsePlan(source: string): PlannedTask[] {
  if (Buffer.byteLength(source, "utf8") > 262144) throw new Error("계획 출력이 256 KiB를 초과합니다.");
  let input = source.trim();
  const fence = input.match(/^```(?:json)?\s*\n([\s\S]*)\n```\s*$/i);
  if (fence) input = fence[1];
  let decoded: unknown;
  try { decoded = JSON.parse(input); } catch { throw new Error("계획은 설명 문구 없이 유효한 JSON으로 반환해야 합니다."); }
  const plan = object(decoded, "계획");
  if (Object.keys(plan).some(k => k !== "tasks") || !Array.isArray(plan.tasks) || plan.tasks.length < 1 || plan.tasks.length > 32) throw new Error("계획은 tasks 배열(1~32개)만 포함해야 합니다.");
  const seen = new Set<string>();
  const tasks: PlannedTask[] = plan.tasks.map((value, i) => {
    const p = object(value, `작업 ${i + 1}`);
    const allowed = ["id", "title", "description", "role", "dependsOn", "acceptance"];
    if (Object.keys(p).some(k => !allowed.includes(k)) || allowed.some(k => !(k in p))) throw new Error("작업 필드가 누락되었거나 허용되지 않은 정책 필드가 있습니다.");
    const id = text(p.id, "id", 48);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id) || seen.has(id)) throw new Error(`잘못되거나 중복된 작업 ID: ${id}`);
    seen.add(id);
    if (!["developer", "designer", "reviewer"].includes(p.role as string)) throw new Error("작업 역할은 developer/designer/reviewer 중 하나여야 합니다.");
    if (!Array.isArray(p.dependsOn) || p.dependsOn.length > 32 || p.dependsOn.some(d => typeof d !== "string")) throw new Error("dependsOn은 작업 ID 배열이어야 합니다.");
    const dependsOn = p.dependsOn as string[];
    if (new Set(dependsOn).size !== dependsOn.length) throw new Error("중복된 의존성이 있습니다.");
    if (!Array.isArray(p.acceptance) || p.acceptance.length < 1 || p.acceptance.length > 16) throw new Error("acceptance는 1~16개 검증 기준이어야 합니다.");
    return { id, title: text(p.title, "title", 240), description: text(p.description, "description"), role: p.role as PlannedTask["role"], dependsOn, acceptance: p.acceptance.map(a => text(a, "acceptance", 2048)) };
  });
  const byId = new Map(tasks.map(task => [task.id, task]));
  const visited = new Set<string>();
  const active = new Set<string>();
  function visit(id: string): void {
    if (active.has(id)) throw new Error(`의존성 cycle: ${id}`);
    if (visited.has(id)) return;
    const task = byId.get(id);
    if (!task) throw new Error(`없는 의존 작업: ${id}`);
    active.add(id);
    for (const dependency of task.dependsOn) visit(dependency);
    active.delete(id); visited.add(id);
  }
  for (const task of tasks) visit(task.id);
  return tasks;
}
