import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/core/store.ts";
import * as chat from "../src/core/team-chat.ts";

test("history reconciliation never retries uncertain delivery or copies responses to another session", t => {
 const root = mkdtempSync(join(tmpdir(), "chat-delivery-")); t.after(() => rmSync(root, { recursive: true, force: true })); const store = ProjectStore.open(root); t.after(() => store.close());
 store.update(s => { s.teamMode = { version: 1, enabled: true, generation: 1, requests: [{ id: "request", text: "Question", origin: "rpc", sessionId: "session", receivedAt: s.createdAt, revision: 1, status: "answered", taskIds: [], answer: "Answer" }], coordinatorAttempts: [], events: [], reviewEvidence: [] }; });
 const id = chat.recordChat(store, "request", "answer", "A durable full answer"); const sent: any[] = []; const history: any[] = [];
 const deliver = (sessionId = "session") => (chat as any).deliverChat(store, { sessionId, history, send: (message: any) => sent.push(message) });
 deliver("other"); assert.equal(sent.length, 0); deliver(); deliver(); assert.equal(sent.length, 1); assert.equal(store.snapshot().teamMode!.journal![0].delivery, "uncertain");
 history.push({ id: "history-1", type: "custom_message", customType: "codexteams.mode", details: sent[0].details, content: sent[0].content }); deliver(); assert.equal(store.snapshot().teamMode!.journal![0].delivery, "delivered");
 history.splice(0); deliver(); assert.equal(sent.length, 1); assert.equal(store.snapshot().teamMode!.journal![0].id, id);
 store.close(); const reopened = ProjectStore.open(root); t.after(() => reopened.close()); (chat as any).deliverChat(reopened, { sessionId: "session", history: [], send: (m: any) => sent.push(m) }); assert.equal(sent.length, 1);
});

test("delivery failure remains uncertain until exact public history identity is observed", t => {
 const root = mkdtempSync(join(tmpdir(), "chat-delivery-")); t.after(() => rmSync(root, { recursive: true, force: true })); const store = ProjectStore.open(root); t.after(() => store.close());
 store.update(s => { s.teamMode = { version: 1, enabled: true, generation: 1, requests: [{ id: "request", text: "Question", origin: "rpc", sessionId: "session", receivedAt: s.createdAt, revision: 1, status: "answered", taskIds: [] }], coordinatorAttempts: [], events: [], reviewEvidence: [] }; });
 chat.recordChat(store, "request", "answer", "Retain me"); let attempts = 0;
 (chat as any).deliverChat(store, { sessionId: "session", history: [], send: () => { attempts++; throw Error("uncertain transport"); } });
 (chat as any).deliverChat(store, { sessionId: "session", history: [], send: () => { attempts++; } }); assert.equal(attempts, 1); assert.equal(store.snapshot().teamMode!.journal![0].delivery, "uncertain");
});

test("pending assistant response waits for its input history branch and does not leak to a sibling", t => {
 const root = mkdtempSync(join(tmpdir(), "chat-branch-")); t.after(() => rmSync(root, { recursive: true, force: true })); const store = ProjectStore.open(root); t.after(() => store.close());
 store.update(s => { s.teamMode = { version: 1, enabled: true, generation: 1, requests: [{ id: "request", text: "Question", origin: "rpc", sessionId: "session", receivedAt: s.createdAt, revision: 1, status: "answered", taskIds: [] }], coordinatorAttempts: [], events: [], reviewEvidence: [] }; });
 chat.recordChat(store, "request", "input", "Question", "user"); chat.recordChat(store, "request", "answer", "Private branch result"); const sent: any[] = [], history: any[] = [];
 const deliver = (branch: any[]) => (chat as any).deliverChat(store, { sessionId: "session", history: branch, send: (m: any) => sent.push(m) });
 deliver(history); assert.equal(sent.length, 1); assert.equal(sent[0].details.role, "user");
 history.push({ id: "input-history", type: "custom_message", ...sent[0] }); deliver(history); assert.equal(sent.length, 2);
 chat.recordChat(store, "request", "progress", "Another result"); deliver([]); assert.equal(sent.length, 2); deliver(history); assert.equal(sent.length, 3);
});
