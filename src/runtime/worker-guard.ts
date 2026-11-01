import { createBashToolDefinition, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createWorkerBashOperations, verifyWorkerOwnership } from "./worker-bash.ts";

/** Private worker extension, loaded explicitly only when that worker is allowed to use Bash. */
export default async function workerGuard(pi: ExtensionAPI): Promise<void> {
  // A rejected factory is fatal during Pi 1.4 JSON CLI startup; never silently retain native Bash.
  const ownership = await verifyWorkerOwnership();
  pi.registerTool(createBashToolDefinition(process.cwd(), {
    operations: createWorkerBashOperations(ownership, () => pi.getSettings().shellPath),
    spawnHook: (context) => {
      const prefix = pi.getSettings().shellCommandPrefix;
      return prefix ? { ...context, command: `${prefix}\n${context.command}` } : context;
    },
  }));
}
