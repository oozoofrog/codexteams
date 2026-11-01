import type { ProjectState } from './types.ts';
export interface HandoffRequest { schemaVersion: 1; requestId: string; projectRoot: string; source: { kind: 'codex'; stopped: true; sessionId?: string; checkpoint: string }; goal: string; task: { title: string; description: string; role: 'developer' | 'designer' | 'reviewer'; acceptance: string[] }; context: { summary: string; completed: string[]; constraints: string[]; files: string[]; evidence: string[] } }
export function validRequestId(id: unknown): boolean;
export function normalizeRequest(value: unknown, root: string): HandoffRequest;
export function requestDigest(request: HandoffRequest): string;
export function readRequest(path: string, root: string): HandoffRequest;
export function handoffResult(state: ProjectState | null, id: string, root: string): Record<string, unknown>;
export function readResult(root: string, id: string): Record<string, unknown>;
