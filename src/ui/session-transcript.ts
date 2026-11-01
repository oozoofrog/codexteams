import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";

const LIMIT = 256 * 1024;
export function readPublicTranscript(file: string): { text: string; start: number; end: number; size: number } {
  let fd: number | undefined;
  try {
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error("Not a regular file");
    const start = Math.max(0, stat.size - LIMIT), buffer = Buffer.alloc(stat.size - start);
    const length = readSync(fd, buffer, 0, buffer.length, start);
    let content = buffer.subarray(0, length).toString("utf8");
    if (start) content = content.slice(content.indexOf("\n") + 1);
    const complete = content.endsWith("\n");
    const lines = content.split("\n");
    if (!complete) lines.pop();
    const output: string[] = [];
    if (start) output.push(`Showing bytes ${start}–${start + length} of ${stat.size} (earlier history truncated).`);
    for (const line of lines) {
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type !== "message" || !entry.message) continue;
        const m = entry.message;
        if (!["user", "assistant", "toolResult"].includes(m.role)) continue;
        const parts = typeof m.content === "string" ? [m.content] : Array.isArray(m.content) ? m.content.flatMap((p: any) => p?.type === "text" && typeof p.text === "string" ? [p.text] : p?.type === "toolCall" && typeof p.name === "string" ? [`[tool: ${p.name}]`] : []) : [];
        if (parts.length) output.push(`${m.role}${m.role === "toolResult" && typeof m.toolName === "string" ? ` (${m.toolName})` : ""}: ${parts.join("\n")}`);
      } catch { output.push("[Corrupt record omitted]"); }
    }
    if (!complete) output.push("[Incomplete final record; waiting for completion]");
    return { text: output.join("\n"), start, end: start + length, size: stat.size };
  } catch (error) {
    return { text: `[Transcript unavailable: ${error instanceof Error ? error.message : String(error)}]`, start: 0, end: 0, size: 0 };
  } finally { if (fd !== undefined) closeSync(fd); }
}
