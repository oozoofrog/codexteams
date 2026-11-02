import type { ProjectState, TeamModeRequest, Task, ReviewScope } from './types.ts';
export function reviewScope(request: TeamModeRequest, writer: Task, checkIds: string[]): ReviewScope;
export function reviewScopeDigest(scope: ReviewScope): string;
export function validateState(state: ProjectState, root: string): void;
export function validateUsage(usage: unknown): void;
export function validateAttempt(attempt: unknown, seen: Set<string>): void;
export function validateCheck(check: unknown, attempts: unknown[], seen: Set<string>): void;
export function validateObservation(observation: unknown, attempts: unknown[]): void;
