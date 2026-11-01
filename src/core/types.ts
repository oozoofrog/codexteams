export const ROLES = ["planner", "developer", "designer", "reviewer"] as const;
export type Role = (typeof ROLES)[number];
export type TaskRole = Exclude<Role, "planner">;
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export interface ModelProfile {
  provider: string;
  model: string;
  effort: Effort;
}

export interface UsageSummary {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  reasoning: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  responses: number;
  completeness: "known" | "partial" | "unknown";
}

export type WorkerEvent =
  | { type: "process"; pid: number }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; phase: "start" | "end"; isError?: boolean }
  | { type: "usage"; usage: UsageSummary; model?: string }
  | { type: "status"; text: string };

export interface WorkerInvocation {
  command: string;
  args: string[];
}

export interface WorkerRequest {
  cwd: string;
  prompt: string;
  systemPrompt: string;
  profile: ModelProfile;
  tools: readonly string[];
  sessionId: string;
  sessionDir: string;
  signal?: AbortSignal;
  onEvent?: (event: WorkerEvent) => void;
  invocation?: WorkerInvocation;
}

export interface WorkerResult {
  outcome: "success" | "failed" | "aborted";
  text: string;
  error?: string;
  exitCode: number | null;
  usage: UsageSummary;
  effectiveModels: string[];
  sessionId: string;
}

export type WorkerRunner = (request: WorkerRequest) => Promise<WorkerResult>;
export type TaskStatus = "queued" | "running" | "needs_review" | "completed" | "failed" | "interrupted" | "cancelled";

export interface PlannedTask {
  id: string;
  title: string;
  description: string;
  role: TaskRole;
  dependsOn: string[];
  acceptance: string[];
}

export interface Attempt {
  id: string;
  sessionId: string;
  profile: ModelProfile;
  startedAt: string;
  endedAt?: string;
  outcome?: WorkerResult["outcome"];
  effectiveModels: string[];
  text: string;
  error?: string;
  usage: UsageSummary;
  logFile: string;
  workerPid?: number;
  recoveryPending?: boolean;
}

export interface VerificationCheck {
  id: string;
  command: string;
  attemptId: string;
  workerPid?: number;
  recoveryPending?: boolean;
  startedAt: string;
  endedAt?: string;
  exitCode: number | null;
  output: string;
  status: "running" | "passed" | "failed" | "interrupted";
}

export interface WorkspaceObservation {
  at: string;
  attemptId: string;
  phase: "before" | "after";
  status: "available" | "unavailable" | "truncated";
  gitStatus: string;
  diffSummary: string;
  error?: string;
}

export interface HandoffRecord {
  request: import("./handoff.mjs").HandoffRequest;
  digest: string;
  submittedAt: string;
  observations: WorkspaceObservation[];
  errors: string[];
}

export interface Task extends PlannedTask {
  handoff?: HandoffRecord;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  attempts: Attempt[];
  checks: VerificationCheck[];
  acceptedAt?: string;
  acceptanceSource?: "user";
  acceptedAttemptId?: string;
  acceptedCheckIds?: string[];
}

export interface NavigationRoot { id: string; file: string }
export interface NavigationView { kind: "task" | "planning"; targetId: string; sessionId: string; file: string; parentSession: string; workerSessionId?: string }
export interface NavigationState { root: NavigationRoot; views: NavigationView[] }

export interface ProjectState {
  schemaVersion: 1;
  id: string;
  root: string;
  revision: number;
  goal: string;
  createdAt: string;
  updatedAt: string;
  profiles: Record<Role, ModelProfile>;
  tasks: Task[];
  planningAttempts: Attempt[];
  navigation?: NavigationState;
  recoveryRequired?: boolean;
  recoveryReason?: string;
}
