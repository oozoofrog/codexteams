import { EFFORTS, ROLES } from "./types.ts";
import type { Effort, ModelProfile, Role } from "./types.ts";

export function defaultProfiles(): Record<Role, ModelProfile> {
  return {
    planner: { provider: "openai", model: "gpt-6.1-sol", effort: "medium" },
    developer: { provider: "openai", model: "gpt-6.1-sol", effort: "medium" },
    designer: { provider: "openai", model: "gpt-6.1-terra", effort: "medium" },
    reviewer: { provider: "openai", model: "gpt-6.1-sol", effort: "high" },
  };
}

export function validateProfile(value: unknown): ModelProfile {
  if (!value || typeof value !== "object") throw new Error("모델 프로필이 필요합니다.");
  const p = value as Record<string, unknown>;
  for (const key of ["provider", "model"]) {
    if (typeof p[key] !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(p[key] as string)) {
      throw new Error(`잘못된 ${key}: provider/model을 명시하세요.`);
    }
  }
  if (!EFFORTS.includes(p.effort as Effort)) throw new Error(`지원 추론 단계: ${EFFORTS.join(", ")}. ultra는 물리 추론 단계가 아닙니다.`);
  return { provider: p.provider as string, model: p.model as string, effort: p.effort as Effort };
}

export function parseRole(value: string): Role {
  if (!ROLES.includes(value as Role)) throw new Error(`역할: ${ROLES.join(", ")}`);
  return value as Role;
}

export function parseProfile(reference: string, effort: string): ModelProfile {
  const slash = reference.indexOf("/");
  if (slash <= 0) throw new Error("모델은 openai/gpt-6.1-sol 형식으로 입력하세요.");
  return validateProfile({ provider: reference.slice(0, slash), model: reference.slice(slash + 1), effort });
}
