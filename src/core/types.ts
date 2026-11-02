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
  source?: "user" | "team_coordinator";
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

export interface TeamModeRequest {
  id: string; text: string; origin: "interactive" | "rpc"; sessionId: string; receivedAt: string;
  streamingIntent?: "steer" | "followUp";
  revision: number; status: "received" | "classifying" | "queued" | "running" | "paused" | "blocked" | "answered" | "awaiting_user_acceptance" | "cancelled" | "failed";
  taskIds: string[]; answer?: string; reason?: string; checks?: string[]; checkpoint?: "implementation" | "checks" | "review" | "fix" | "revalidate";
  amendments?: Array<{ requestId: string; instruction: string; timing: "after_current" | "interrupt_then_resume"; status: "pending" | "applied" }>;
  artifactDigest?: string; fixInstruction?: string;
}
export interface CoordinatorAttempt extends Attempt { requestId: string; generation: number; requestRevision: number }
export interface TeamModeEvent { id: string; requestId: string; kind: "received" | "applied" | "uncertain"; at: string }
export interface ReviewScope { requestText: string; amendments: Array<{ requestId: string; instruction: string }>; writer: { id: string; title: string; description: string; acceptance: string[] }; checks: Array<{ id: string; command: string; status: VerificationCheck["status"]; exitCode: number | null; output: string; outputTruncated: boolean }> }
export interface TeamModeReviewEvidence { id: string; requestId: string; implementationTaskId: string; implementationAttemptId: string; reviewerTaskId: string; reviewerAttemptId: string; artifactDigest: string; verdict: "pass" | "changes_required" | "blocked"; checkIds: string[]; requestRevision?: number; scope?: ReviewScope; scopeDigest?: string }
export interface TeamModeState { version: 1; enabled: boolean; generation: number; requests: TeamModeRequest[]; coordinatorAttempts: CoordinatorAttempt[]; events: TeamModeEvent[]; reviewEvidence: TeamModeReviewEvidence[] }

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
  teamMode?: TeamModeState;
  recoveryRequired?: boolean;
  recoveryReason?: string;
}
