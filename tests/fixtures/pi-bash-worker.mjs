import { createBashToolDefinition, DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { mkdirSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const mode = process.argv[2];
const args = process.argv.slice(3);
process.stdout._handle?.setBlocking(true);
process.stderr._handle?.setBlocking(true);
const emit = (event) => writeSync(1, `${JSON.stringify(event)}\n`);
const finish = (result) => {
  emit({ type: "message_end", message: {
    role: "assistant", api: "fixture", provider: "fixture", model: "test-model", timestamp: 1,
    content: [{ type: "text", text: JSON.stringify(result) }],
    stopReason: result.error ? "error" : "stop", ...(result.error ? { errorMessage: result.error } : {}),
  } });
  emit({ type: "agent_settled", aborted: false });
};
if (mode === "real-loader") {
  const agentDir = join(process.cwd(), "test-pi-agent");
  mkdirSync(agentDir, { mode: 0o700 });
  const extension = args.indexOf("-e");
  const loader = new DefaultResourceLoader({
    cwd: process.cwd(), agentDir,
    settingsManager: SettingsManager.inMemory({}, { projectTrusted: true }),
    additionalExtensionPaths: extension < 0 ? [] : [args[extension + 1]],
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
  });
  await loader.reload();
  const loaded = loader.getExtensions();
  finish({ errors: loaded.errors, extensions: loaded.extensions.map((item) => ({
    path: item.resolvedPath, tools: [...item.tools.keys()],
  })) });
  process.exit(0);
}
let definition = createBashToolDefinition(process.cwd(), {
  spawnHook: (context) => ({ ...context, env: { ...context.env, WORKER_BASH_FIXTURE_VALUE: "preserved environment" } }),
});
const extension = args.indexOf("-e");
if (mode === "invalid-owner") process.env.CODEXTEAMS_WORKER_TOKEN = "not-the-owner-token";
if (extension !== -1) {
  const guard = await import(pathToFileURL(args[extension + 1]).href);
  await guard.default({
    registerTool: (tool) => { definition = tool; },
    getSettings: () => ({ shellCommandPrefix: "export WORKER_BASH_FIXTURE_VALUE='preserved environment'", shellPath: "/bin/bash" }),
  });
}

const controller = new AbortController();
const background = "sleep 30 & printf '%s\\n' \"$!\" > background.pid; /bin/ps -o pgid= -p \"$!\" > background.pgid";
let command;
if (mode === "background") command = `${background.replace("sleep 30 &", "sleep 30 >/dev/null 2>&1 &")}; printf 'foreground complete\\n'`;
else if (mode === "inherited-background") command = `${background}; printf 'foreground complete\\n'`;
else if (mode === "shape") command = "printf '%s|%s' \"$PWD\" \"$WORKER_BASH_FIXTURE_VALUE\"; printf '|stderr preserved' >&2; exit 7";
else command = `${background}; printf 'READY\\n'; wait`;
const parameters = { command, ...(mode === "timeout" ? { timeout: 0.15 } : {}) };
let result;
try {
  result = await definition.execute("fixture-bash", parameters, controller.signal, (update) => {
    if (JSON.stringify(update).includes("READY")) {
      emit({ type: "tool_execution_start", toolCallId: "ready", toolName: "fixture-bash-ready", args: {} });
      if (mode === "abort") controller.abort();
    }
  });
} catch (error) {
  writeFileSync("continued-after-stop", "The model could continue after the stopped tool.");
  result = { error: error instanceof Error ? error.message : String(error) };
}
finish(result);
