import type { Command } from "commander";
import { loadConfig } from "../config/toml_parser.js";

interface CommandResponse {
  ok: boolean;
  delivered: number;
  command: string;
  service: string | null;
}

async function sendDaemonCommand(
  commandName: "push" | "pull",
  service: string | undefined,
  hostOverride: string | undefined,
  portOverride: string | undefined,
): Promise<CommandResponse> {
  const config = await loadConfig(process.cwd(), {
    sync: {
      host: hostOverride,
      port: portOverride ? Number(portOverride) : undefined,
    },
  });
  const response = await fetch(`http://${config.sync.host}:${config.sync.port}/api/command/${commandName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      service,
    }),
    signal: AbortSignal.timeout(2_000),
  });

  const payload = (await response.json()) as CommandResponse & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `Command failed with HTTP ${response.status}`);
  }

  return payload;
}

export function registerPushPullCommands(program: Command): void {
  program
    .command("pull")
    .description("Force-pull the current state from Studio into the file system.")
    .option("--from <client>", "Source client", "studio")
    .option("--service <name>", "Optional service scope")
    .option("--host <host>", "Override the configured daemon host")
    .option("--port <port>", "Override the configured daemon port")
    .action(async (options: { service?: string; host?: string; port?: string }) => {
      try {
        const response = await sendDaemonCommand("pull", options.service, options.host, options.port);
        console.log(`Pull request sent to ${response.delivered} Studio client(s).`);
      } catch (error) {
        console.error(`Pull request failed: ${String((error as Error).message ?? error)}`);
        process.exitCode = 1;
      }
    });

  program
    .command("push")
    .description("Force-push the current file system state into Studio.")
    .option("--to <client>", "Target client", "studio")
    .option("--service <name>", "Optional service scope")
    .option("--host <host>", "Override the configured daemon host")
    .option("--port <port>", "Override the configured daemon port")
    .action(async (options: { service?: string; host?: string; port?: string }) => {
      try {
        const response = await sendDaemonCommand("push", options.service, options.host, options.port);
        console.log(`Push request sent to ${response.delivered} Studio client(s).`);
      } catch (error) {
        console.error(`Push request failed: ${String((error as Error).message ?? error)}`);
        process.exitCode = 1;
      }
    });
}
