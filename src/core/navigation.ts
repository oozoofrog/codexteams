import { closeSync, constants, existsSync, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ProjectStore } from "./store.ts";
import type { NavigationRoot, NavigationView } from "./types.ts";

export const VIEW_MARKER = "codexteams.readonly-view.v1";
export function checkedHeader(file: string, cwd: string, id: string, parent?: string): void {
  if (!isAbsolute(file) || resolve(file) !== file || realpathSync(dirname(file)) !== dirname(file)) throw new Error("Unsafe session path.");
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    if (!fstatSync(fd).isFile()) throw new Error("Session is not a regular file.");
    const bytes = Buffer.alloc(16384), n = readSync(fd, bytes, 0, bytes.length, 0), end = bytes.indexOf(10);
    if (end < 0 || end >= n) throw new Error("Invalid session header.");
    const header = JSON.parse(bytes.subarray(0, end).toString("utf8"));
    if (header.type !== "session" || header.cwd !== cwd || header.id !== id || (parent !== undefined && header.parentSession !== parent)) throw new Error("Session header does not match selected project and parent.");
  } finally { closeSync(fd); }
}
function createPrivate(cwd: string, sessionDir: string, message: string, parent?: string, marker?: object): NavigationRoot {
  // SDK creates the file synchronously. Restrict only newly created directories/files;
  // never chmod a pre-existing shared session directory.
  const old = process.umask(0o077);
  try {
    const manager = SessionManager.create(cwd, sessionDir, parent ? { parentSession: parent } : undefined);
    if (marker) manager.appendCustomEntry(VIEW_MARKER, marker);
    manager.appendMessage({ role: "user", content: [{ type: "text", text: message }], timestamp: Date.now() });
    const file = manager.getSessionFile();
    if (!file) throw new Error("Session persistence unavailable.");
    checkedHeader(file, cwd, manager.getSessionId(), parent);
    return { id: manager.getSessionId(), file };
  } finally { process.umask(old); }
}
export function checkedView(view: NavigationView, root: string, projectId: string): void {
  checkedHeader(view.file, root, view.sessionId, view.parentSession);
  const fd = openSync(view.file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  let data: { root?: unknown; projectId?: unknown; kind?: unknown; targetId?: unknown } | undefined;
  try {
    if (!fstatSync(fd).isFile()) throw new Error("Not a regular view file.");
    const bytes = Buffer.alloc(65536), n = readSync(fd, bytes, 0, bytes.length, 0);
    for (const line of bytes.subarray(0, n).toString("utf8").split("\n").slice(1, -1)) {
      const entry = JSON.parse(line);
      if (entry.type === "custom" && entry.customType === VIEW_MARKER) { data = entry.data; break; }
    }
  } finally { closeSync(fd); }
  if (!data || data.root !== root || data.projectId !== projectId || data.kind !== view.kind || data.targetId !== view.targetId) throw new Error("조회 세션 marker가 일치하지 않습니다.");
}
export function ensureView(store: ProjectStore, ctx: ExtensionContext, kind: "task" | "planning", targetId: string, sessionDir = ctx.sessionManager.getSessionDir()): NavigationView {
  store.assertOwner();
  const state = store.snapshot();
  const task = kind === "task" ? state.tasks.find(t => t.id === targetId) : undefined;
  const planning = kind === "planning" ? state.planningAttempts.find(a => a.id === targetId) : undefined;
  if (!task && !planning) throw new Error("Selected task no longer exists.");
  const workerSessionId = task?.attempts.at(-1)?.sessionId ?? planning?.sessionId;
  const currentFile = ctx.sessionManager.getSessionFile();
  if (!currentFile) throw new Error("This is an in-memory session (--no-session); persistent navigation is unavailable.");
  const existing = state.navigation?.views.find(v => v.kind === kind && v.targetId === targetId);
  if (existing) {
    checkedHeader(state.navigation!.root.file, state.root, state.navigation!.root.id);
    checkedView(existing, state.root, state.id);
    return existing;
  }
  let root = state.navigation?.root;
  if (root) checkedHeader(root.file, state.root, root.id);
  else if (existsSync(currentFile) && realpathSync(ctx.cwd) === state.root) {
    checkedHeader(currentFile, state.root, ctx.sessionManager.getSessionId());
    root = { id: ctx.sessionManager.getSessionId(), file: currentFile };
  } else root = createPrivate(state.root, sessionDir, `/teams open ${targetId}`);
  const created = createPrivate(state.root, dirname(root.file), `/teams open ${targetId}`, root.file, { projectId: state.id, root: state.root, kind, targetId });
  const view: NavigationView = { kind, targetId, sessionId: created.id, file: created.file, parentSession: root.file, ...(workerSessionId ? { workerSessionId } : {}) };
  store.update(s => { if (s.id !== state.id) throw new Error("Project changed."); s.navigation ??= { root: root!, views: [] }; if (s.navigation.root.file !== root!.file) throw new Error("Team root changed."); s.navigation.views.push(view); });
  return view;
}
