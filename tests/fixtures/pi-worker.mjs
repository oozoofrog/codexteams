import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, writeSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const mode = process.argv[2];
const args = process.argv.slice(3);
const knownUsage = {
  input: 10, output: 8, cacheRead: 3, cacheWrite: 2, reasoning: 4,
  totalTokens: 23,
  cost: { input: 0.003, output: 0.008, cacheRead: 0.0003, cacheWrite: 0.0007, total: 0.012 },
};
const initializedUsage = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const assistant = (overrides = {}) => ({
  role: "assistant", content: [{ type: "text", text: "Finished 🔧\u2028line" }],
  api: "openai-responses", provider: "fixture", model: "test-model", responseId: "response-1",
  timestamp: 1, usage: knownUsage, stopReason: "stop", ...overrides,
});
// Explicit descriptor writes also work in execution hosts that do not relay Node's async stdio writes.
process.stdout._handle?.setBlocking(true);
process.stderr._handle?.setBlocking(true);
const stdout = (value) => {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  let offset = 0;
  while (offset < bytes.length) offset += writeSync(1, bytes, offset, bytes.length - offset);
};
const emit = (record, newline = "\n") => stdout(`${JSON.stringify(record)}${newline}`);
const end = (overrides = {}) => emit({ type: "message_end", message: assistant(overrides) });
const settle = (aborted = false) => emit({ type: "agent_settled", aborted });

if (mode === "child") {
  process.on("SIGTERM", () => {});
  stdout("child-ready\n");
  setInterval(() => {}, 1_000);
} else if (mode === "arguments") {
  const systemValue = args[args.indexOf("--append-system-prompt") + 1];
  let systemPrompt = systemValue;
  try { systemPrompt = readFileSync(systemValue, "utf8"); } catch {}
  end({ content: [{ type: "text", text: JSON.stringify({ cwd: process.cwd(), args, systemPrompt, worker: process.env.CODEXTEAMS_WORKER }) }] });
  settle();
} else if (mode === "success") {
  emit({ type: "session", version: 3, id: "fixture-session", cwd: process.cwd() });
  emit({ type: "message_start", message: assistant({ content: [], stopReason: "pending" }) });
  const progress = Buffer.from(`${JSON.stringify({
    type: "message_update", usage: knownUsage,
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Working 🔧\u2028line" },
  })}\r\n`);
  const splitAt = progress.indexOf(Buffer.from("🔧")) + 1;
  stdout(progress.subarray(0, splitAt));
  await delay(5);
  stdout(progress.subarray(splitAt, progress.length - 1));
  await delay(5);
  stdout(progress.subarray(progress.length - 1));
  emit({ type: "message_update", usage: knownUsage,
    assistantMessageEvent: { type: "thinking_delta", contentIndex: 1, delta: "PRIVATE THINKING" } });
  emit({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "read", args: { path: "file" } });
  emit({ type: "tool_execution_end", toolCallId: "tool-1", toolName: "read", isError: false,
    result: { content: [{ type: "text", text: "tool output" }], usage: knownUsage } });
  emit({ type: "message_end", message: { role: "toolResult", toolCallId: "tool-1", toolName: "read",
    content: [{ type: "text", text: "tool output" }], usage: knownUsage, timestamp: 1, isError: false } });
  end({ content: [{ type: "thinking", thinking: "PRIVATE THINKING" },
    { type: "text", text: "Finished 🔧\u2028line" }] });
  emit({ type: "agent_end", messages: [assistant()], willRetry: false });
  settle();
} else if (mode === "multiple") {
  end({ stopReason: "toolUse", content: [{ type: "text", text: "First response" }] });
  emit({ type: "agent_end", messages: [assistant()], willRetry: true });
  end({ responseId: "response-2", timestamp: 2, model: "second-model",
    usage: { ...knownUsage, reasoning: undefined }, content: [{ type: "text", text: "Final response" }] });
  settle();
} else if (mode === "retry") {
  end({ stopReason: "error", errorMessage: "temporary failure" });
  emit({ type: "agent_end", messages: [assistant()], willRetry: true });
  end({ responseId: "response-2", timestamp: 2 });
  settle();
} else if (mode === "error") {
  end({ stopReason: "error", errorMessage: "Provider rejected this request" });
  settle();
} else if (mode === "zero-error" || mode === "zero-aborted" || mode === "zero-error-retry") {
  const stopReason = mode === "zero-aborted" ? "aborted" : "error";
  end({ stopReason, usage: initializedUsage, errorMessage: "Connection closed before provider usage arrived" });
  if (mode === "zero-error-retry") {
    emit({ type: "agent_end", messages: [], willRetry: true });
    end({ responseId: "response-2", timestamp: 2 });
  }
  settle(mode === "zero-aborted");
} else if (mode === "length") {
  end({ stopReason: "length" });
  settle();
} else if (mode === "aborted") {
  end({ stopReason: "aborted", errorMessage: "Request aborted" });
  settle(true);
} else if (mode === "missing-usage") {
  end({ usage: undefined });
  settle();
} else if (mode === "partial-usage") {
  end({ usage: { input: 10, output: 8 } });
  settle();
} else if (mode === "unfinished-response") {
  end({ stopReason: "toolUse" });
  emit({ type: "message_start", message: assistant({ responseId: "response-2", content: [], stopReason: "pending" }) });
  emit({ type: "message_update", usage: knownUsage,
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Incomplete response" } });
  process.exitCode = 1;
} else if (mode === "derived-total") {
  end({ usage: { ...knownUsage, totalTokens: undefined } });
  settle();
} else if (mode === "missing-assistant") {
  settle();
} else if (mode === "missing-settled") {
  end();
  emit({ type: "agent_end", messages: [assistant()], willRetry: false });
} else if (mode === "missing-latest-assistant") {
  end();
  emit({ type: "message_start", message: assistant({ responseId: "response-2", content: [], stopReason: "pending" }) });
  settle();
} else if (mode === "malformed") {
  end();
  stdout("{broken PRIVATE THINKING}\n");
  settle();
} else if (mode === "truncated") {
  end();
  stdout('{"type":"agent_settled","aborted":false}');
} else if (mode === "invalid-utf8") {
  end();
  stdout(Buffer.from([0xff, 0x0a]));
  settle();
} else if (mode === "nonzero") {
  end();
  settle();
  writeSync(2, "fixture execution failed\n");
  process.exitCode = 7;
} else if (mode === "large") {
  end({ content: [{ type: "text", text: "a".repeat(2 * 1024 * 1024) + "END OF RESPONSE" }] });
  writeSync(2, "s".repeat(256 * 1024));
  settle();
} else if (mode === "oversized-record") {
  stdout("a".repeat(12 * 1024 * 1024));
} else if (mode === "abort-tree" || mode === "normal-tree") {
  const child = spawn(process.execPath, [new URL(import.meta.url).pathname, "child"], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  child.stdout.once("data", () => {
    writeFileSync("child.pid", String(child.pid));
    emit({ type: "tool_execution_start", toolCallId: "tree", toolName: "fixture-ready", args: {} });
    if (mode === "normal-tree") {
      end();
      settle();
      process.exit(0);
    }
  });
  if (mode === "abort-tree") {
    process.on("SIGTERM", () => {});
    setInterval(() => {}, 1_000);
  }
} else {
  throw new Error(`Unexpected fixture mode: ${mode}`);
}
