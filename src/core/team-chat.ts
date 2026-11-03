import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { randomUUID } from "node:crypto";
import type { AcceptanceOffer, ChatJournalEntry, ProjectState, TeamModeRequest } from "./types.ts";
import { parseReviewVerdict } from "./team-mode-protocol.ts";
import type { ProjectStore } from "./store.ts";
import { acceptedRequestDigest, isAcceptedRequest } from "./state-validation.mjs";

/** Persist first. The Pi adapter owns delivery and never infers it from a void send API. */
export function recordChat(store: ProjectStore, requestId: string, kind: ChatJournalEntry["kind"], text: string, role: ChatJournalEntry["role"] = "assistant"): string {
 const ids: string[] = [];
 store.update(state => {
  const mode = state.teamMode!, request = mode.requests.find(r => r.id === requestId)!;
  const journal = mode.journal ??= [];
  // Chunk at Unicode code points so large worker results remain complete and valid UTF-8.
  let chunk = "", bytes = 0;
  const append = () => { if (!chunk) return; const id = randomUUID(); ids.push(id); journal.push({ id, requestId, requestRevision: request.revision, sessionId: request.sessionId, role, kind, text: chunk, at: new Date().toISOString(), delivery: "pending" }); chunk = ""; bytes = 0; };
  for (const point of text) { const size = Buffer.byteLength(point); if (bytes + size > 65536) append(); chunk += point; bytes += size; } append();
 });
 return ids[0];
}

export function resultText(state: ProjectState, request: TeamModeRequest): string {
 const tasks = (request.stages ?? request.taskIds.slice(0, 1)).map(id => state.tasks.find(t => t.id === id)!).filter(Boolean);
 const writer = state.tasks.find(t => t.id === request.taskIds[0]);
 const review = state.teamMode?.reviewEvidence.filter(e => e.requestId === request.id && e.requestRevision === request.revision).at(-1);
 const checks = review
  ? review.checkIds.map(id => writer?.checks.find(check => check.id === id))
  : writer?.checks.filter(check => check.attemptId === writer.attempts.at(-1)?.id) ?? [];
 const reviewer = review && state.tasks.find(t => t.id === review.reviewerTaskId);
 let reviewLines: string[] = [];
 if (review) {
  const labels = { pass: "통과", changes_required: "수정 필요", blocked: "확인 필요" };
  reviewLines = [`독립 검토: ${labels[review.verdict]}`];
  try {
   if (review.requestRevision === undefined || !review.scopeDigest) throw new Error("Legacy review has no exact scope identity");
   const raw = reviewer?.attempts.find(a => a.id === review.reviewerAttemptId)?.text ?? "";
   const verdict = parseReviewVerdict(raw, { implementationAttemptId: review.implementationAttemptId, artifactDigest: review.artifactDigest, checkIds: review.checkIds, requestId: review.requestId, requestRevision: review.requestRevision, scopeDigest: review.scopeDigest });
   if (verdict.verdict !== review.verdict) throw new Error("Review verdict mismatch");
   reviewLines.push(...verdict.findings);
  } catch { reviewLines.push("검토 상세를 현재 근거와 대조할 수 없습니다."); }
 }
 return [`${request.text} · revision ${request.revision}`, ...tasks.flatMap(t => [`${t.title} (${t.role})`, t.attempts.at(-1)?.text || "결과 없음"]), ...checks.flatMap(c => c ? [`검증 ${c.status}: ${c.command}`, c.output] : []), ...reviewLines, ...(request.reason ? [request.reason] : []), ...(request.answer && !tasks.length ? [request.answer] : [])].filter(Boolean).join("\n\n");
}

export function offerResult(store: ProjectStore, requestId: string): void {
 const state = store.snapshot(), request = state.teamMode!.requests.find(r => r.id === requestId)!;
 const evidence = state.teamMode!.reviewEvidence.filter(e => e.requestId === requestId && e.requestRevision === request.revision && e.verdict === "pass").at(-1);
 if (!evidence) return;
 const journalId = recordChat(store, requestId, "result", `${resultText(state, request)}\n\n이 revision의 결과를 수락할까요? 수정하거나 다시 검증할 수도 있습니다.`);
 const stageAttempts = (request.stages ?? [request.taskIds[0]]).map(id => state.tasks.find(t => t.id === id)!).filter(t => t.role !== "reviewer").map(t => ({ taskId: t.id, attemptId: t.attempts.at(-1)!.id }));
 const offer: AcceptanceOffer = { id: randomUUID(), requestId, requestRevision: request.revision, sessionId: request.sessionId, evidenceId: evidence.id, artifactDigest: evidence.artifactDigest, scopeDigest: evidence.scopeDigest!, stageAttempts, journalId };
 store.update(s => { (s.teamMode!.offers ??= []).push(offer); });
}

export function conversationContext(state: ProjectState, sessionId: string) {
 const mode = state.teamMode!;
 return {
  conversation: (mode.journal ?? []).filter(e => e.sessionId === sessionId).slice(-40).map(e => ({ role: e.role, text: e.text.slice(-8192), requestId: e.requestId, requestRevision: e.requestRevision, delivery: e.delivery })),
  actualState: { projectId: state.id, recoveryRequired: !!state.recoveryRequired, requests: mode.requests.slice(-24).map(r => ({ id: r.id, text: r.text, revision: r.revision, status: isAcceptedRequest(state, r) ? "accepted" : r.status, legacyAccepted: isAcceptedRequest(state, r) && !r.receipt, acceptedHistoryDigest: isAcceptedRequest(state, r) ? acceptedRequestDigest(state, r) : undefined, answer: r.answer, reason: r.reason, stages: r.stages, stageCursor: r.stageCursor, amendments: r.amendments, parentRequestId: r.parentRequestId, provenance: r.provenance, reviewTargetId: r.reviewTargetId, reviewTargetRevision: r.reviewTargetRevision, resolvedByRequestId: r.resolvedByRequestId, receipt: r.receipt, tasks: r.taskIds.map(id => { const t = state.tasks.find(t => t.id === id)!; const a = t.attempts.at(-1); return { id: t.id, role: t.role, title: t.title, description: t.description.slice(0, 4096), acceptance: t.acceptance.map(a => a.slice(0, 1024)), status: t.status, attemptId: a?.id, result: a?.text.slice(-8192), checks: t.checks.filter(c => c.attemptId === a?.id).map(c => ({ id: c.id, command: c.command, status: c.status, output: c.output.slice(-4096) })) }; }), reviewEvidence: mode.reviewEvidence.filter(e => e.requestId === r.id).slice(-2).map(e => ({ id: e.id, requestRevision: e.requestRevision, verdict: e.verdict, implementationTaskId: e.implementationTaskId, implementationAttemptId: e.implementationAttemptId, reviewerTaskId: e.reviewerTaskId, reviewerAttemptId: e.reviewerAttemptId, artifactDigest: e.artifactDigest, scopeDigest: e.scopeDigest, checkIds: e.checkIds, result: state.tasks.find(t => t.id === e.reviewerTaskId)?.attempts.find(a => a.id === e.reviewerAttemptId)?.text.slice(-8192) })) })) },
  offers: (mode.offers ?? []).filter(o => o.sessionId === sessionId && mode.requests.some(r => r.id === o.requestId && r.status === "awaiting_user_acceptance" && r.revision === o.requestRevision)).slice(-8),
 };
}

/** A semantic leader decision is necessary; this guard only excludes acknowledgement-only authority. */
export function explicitAcceptanceQuote(text: string, quote: string): boolean {
 if (quote.trim() !== text.trim()) return false;
 const normalized = text.normalize("NFKC").trim();
 // Remove cited language before checking for an actual statement. The leader decides intent; a quoted example supplies no authority.
 const statement = normalized.replace(/"[^"\n]*"|'[^'\n]*'|“[^”\n]*”|‘[^’\n]*’|「[^」\n]*」|『[^』\n]*』/gu, "");
 if (/[?？]/u.test(statement)) return false;
 if (/\b(?:if|unless|maybe|perhaps|whether)\b|\b(?:would|might|could|may)\s+(?:accept|approve)\b|(?:하면|한다면|라면|되면|있으면|없으면)|아직.*(?:모르|보류)|(?:수락|승인)할지/iu.test(statement)) return false;
 if (/\b(?:do\s+not|don't|cannot|can't|won't|will\s+not|would\s+not)\s+(?:accept|approve)\b|(?:수락|승인)(?:을|은|는|이)?\s*(?:하지\s*(?:마|않|못)|안\s*(?:해|하|할|돼)|못\s*(?:해|하|할)|아니)/iu.test(statement)) return false;
 // Do not prescribe Korean conjugation. These are minimum explicit action/target markers, never an intent router.
 return /\b(?:accept|approve)\b[^.!?\n]*\b(?:result|revision|version|changes)\b|(?:결과|버전|리비전|변경\s*사항|수정안)[^.!?\n]*(?:수락|승인)/iu.test(statement);
}
export function receiptDigest(state: ProjectState, request: TeamModeRequest): string { return acceptedRequestDigest(state, request); }

export interface ChatDeliveryTarget { sessionId: string; history: readonly unknown[]; nativeInputs?: readonly unknown[]; sessionReady?: boolean; send(message: { customType: string; content: string; display: boolean; details: Record<string, unknown> }): void }
export function deliverChat(store: ProjectStore, target: ChatDeliveryTarget): void {
 const snapshot = store.snapshot();
 for (const entry of snapshot.teamMode?.journal ?? []) {
  if (entry.sessionId !== target.sessionId || entry.delivery === "delivered") continue;
  const request = store.snapshot().teamMode!.requests.find(r => r.id === entry.requestId)!;
  if (request.inputPersistence && target.sessionReady === false) continue;
  if (request.inputPersistence === "native" && entry.role === "user" && entry.kind === "input") {
   const anchor = request.branchAnchorId ? target.history.findIndex(value => (value as { id?: unknown })?.id === request.branchAnchorId) : -1;
   const claimed = new Set(store.snapshot().teamMode!.journal!.filter(e => e.role === "user" && e.historyEntryId).map(e => e.historyEntryId));
   const observed = target.history.find((value, index) => {
    if (request.branchAnchorId && (anchor < 0 || index <= anchor)) return false;
    return matchesNativeInput(value, request.nativeText ?? entry.text, target.nativeInputs ?? []) && !claimed.has(value.id);
   }) as { id: string } | undefined;
   if (observed) store.update(s => { const input = s.teamMode!.journal!.find(e => e.id === entry.id)!; input.delivery = "delivered"; input.historyEntryId = observed.id; const human = s.teamMode!.requests.find(r => r.id === entry.requestId)!; if (!isAcceptedRequest(s, human)) human.branchAnchorId = observed.id; });
   continue; // The genuine native input is the visible receipt. Never add a duplicate custom user message.
  }
  const content = entry.role === "user" ? `요청\n${entry.text}` : entry.text;
  const observed = target.history.find(value => {
   const record = value as { id?: unknown; type?: unknown; customType?: unknown; details?: Record<string, unknown>; content?: unknown };
   return record?.type === "custom_message" && record.customType === "codexteams.mode" && typeof record.id === "string" && record.details?.projectId === snapshot.id && record.details?.journalId === entry.id && record.details?.sessionId === entry.sessionId && record.details?.requestRevision === entry.requestRevision && record.content === content;
  }) as { id: string } | undefined;
  if (observed) { store.update(s => { const current = s.teamMode!.journal!.find(e => e.id === entry.id)!; current.delivery = "delivered"; current.historyEntryId = observed.id; if (current.role === "user" && current.kind === "input") { const request = s.teamMode!.requests.find(r => r.id === current.requestId)!; if (!isAcceptedRequest(s, request)) request.branchAnchorId = observed.id; } }); continue; }
  if (entry.delivery !== "pending") continue;
  const current = store.snapshot(), latestRequest = current.teamMode!.requests.find(r => r.id === entry.requestId)!;
  const input = current.teamMode!.journal?.find(e => e.requestId === latestRequest.id && e.role === "user" && e.kind === "input");
  if (entry.role === "assistant" && input && input.delivery !== "delivered") continue;
  if (latestRequest.branchAnchorId && !target.history.some(value => (value as { id?: unknown })?.id === latestRequest.branchAnchorId)) continue;
  store.update(s => { const current = s.teamMode!.journal!.find(e => e.id === entry.id)!; current.delivery = "uncertain"; current.submittedAt = new Date().toISOString(); });
  try { target.send({ customType: "codexteams.mode", content, display: true, details: { projectId: snapshot.id, journalId: entry.id, sessionId: entry.sessionId, requestId: entry.requestId, requestRevision: entry.requestRevision, role: entry.role, kind: entry.kind } }); } catch { /* The API has no failure receipt; preserve uncertainty, never duplicate a possible delivery. */ }
 }
}


/** Read-only confirmation of a recent native human entry; no session writer or migration is invoked. */
export function matchesNativeInput(value: unknown, expectedText: string, diskInputs: readonly unknown[]): value is { id: string } {
 const record = value as { id?: unknown; type?: string; message?: { role?: string; content?: unknown } } | null;
 if (record?.type !== "message" || record.message?.role !== "user" || typeof record.id !== "string" || !record.id) return false;
 const content = record.message.content;
 const text = typeof content === "string" ? content : Array.isArray(content)
  ? content.filter((part): part is { type: "text"; text: string } => part?.type === "text" && typeof part.text === "string").map(part => part.text).join("")
  : "";
 if (text !== expectedText) return false;
 return diskInputs.some(value => {
  const disk = value as { id?: string; message?: unknown };
  return disk.id === record.id && JSON.stringify(disk.message) === JSON.stringify(record.message);
 });
}

export function persistedNativeInputs(file: string): unknown[] {
 let fd: number | undefined;
 try {
  fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  const stat = fstatSync(fd); if (!stat.isFile()) return [];
  const start = Math.max(0, stat.size - 256 * 1024), buffer = Buffer.alloc(stat.size - start), length = readSync(fd, buffer, 0, buffer.length, start);
  let content = buffer.subarray(0, length).toString("utf8"); if (start) content = content.slice(content.indexOf("\n") + 1);
  const lines = content.split("\n"); lines.pop();
  return lines.flatMap(line => { try { const entry = JSON.parse(line); return entry.type === "message" && entry.message?.role === "user" ? [entry] : []; } catch { return []; } });
 } catch { return []; } finally { if (fd !== undefined) closeSync(fd); }
}

export interface RoutingControlProvenance { ownedPrestartCancel: boolean; signalAborted: boolean; requestId: string; sessionId: string; confirmationContextId: string; humanEntryId: string; expectedProvider: string; expectedApi: string; expectedModel: string }
/** Only a proven empty owned bootstrap abort can become a local software status, never a remote model success. */
export function parentRoutingControl(original: AssistantMessage, provenance: RoutingControlProvenance) {
 const usage = original.usage;
 const measuredAbort = original.stopReason === "aborted" || (original.stopReason === "error" && original.errorMessage === "This operation was aborted" && original.provider === "openai" && original.api === "openai-responses");
 if (!provenance.ownedPrestartCancel || !provenance.signalAborted || !measuredAbort || original.content.length || original.provider !== provenance.expectedProvider || original.api !== provenance.expectedApi || original.model !== provenance.expectedModel || !usage || ![usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.totalTokens, ...(usage.reasoning === undefined ? [] : [usage.reasoning]), ...(usage.cacheWrite1h === undefined ? [] : [usage.cacheWrite1h])].every(value => typeof value === "number" && value === 0) || !usage.cost || ![usage.cost.input, usage.cost.output, usage.cost.cacheRead, usage.cost.cacheWrite, usage.cost.total].every(value => typeof value === "number" && value === 0)) return undefined;
 const abort = structuredClone(original);
 const audit = { software_generated_control: true as const, origin: "codexteams-local/control", ...provenance, original: abort, originalJSON: JSON.stringify(original) };
 const message: AssistantMessage & { software_generated_control: true; codexteamsControl: typeof audit & { originalAbort: AssistantMessage } } = { role: "assistant", content: [{ type: "text", text: "요청을 확인하고 있습니다." }], provider: "codexteams-local", api: "codexteams-local/control", model: "control", usage: structuredClone(usage), stopReason: "stop", timestamp: original.timestamp, software_generated_control: true, codexteamsControl: { ...audit, originalAbort: abort } };
 return { message, audit };
}
