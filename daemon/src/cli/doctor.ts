import net from "node:net";
import type { Command } from "commander";
import { loadConfig } from "../config/toml_parser.js";
import { loadSchemaCache } from "../schema/loader.js";

async function canReachDaemon(host: string, port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://${host}:${port}/health`, {
      signal: AbortSignal.timeout(1_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function inspectPort(host: string, port: number): Promise<"daemon" | "available" | "busy"> {
  if (await canReachDaemon(host, port)) {
    return "daemon";
  }

  return await new Promise<"daemon" | "available" | "busy">((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "EADDRINUSE") {
        resolve("busy");
        return;
      }
      reject(error);
    });
    server.listen(port, host, () => {
      server.close(() => resolve("available"));
    });
  });
}

function printCheck(ok: boolean, label: string, detail: string): void {
  console.log(`${ok ? "OK " : "NO "} ${label}: ${detail}`);
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Diagnose RoSync configuration and connectivity issues.")
    .action(async () => {
      const config = await loadConfig(process.cwd());
      let allGood = true;

      printCheck(true, "config", config.configPath);

      const portState = await inspectPort(config.sync.host, config.sync.port);
      printCheck(portState !== "busy", "port", `${config.sync.host}:${config.sync.port} is ${portState}`);
      allGood &&= portState !== "busy";

      try {
        const schema = await loadSchemaCache(config);
        printCheck(true, "schema", `${config.schemaPath} (${schema.metadata.version ?? "unknown"})`);
      } catch (error) {
        printCheck(false, "schema", String((error as Error).message ?? error));
        allGood = false;
      }

      try {
        const stats = await import("node:fs/promises").then((fs) => fs.stat(config.srcDir));
        printCheck(stats.isDirectory(), "src", config.srcDir);
        allGood &&= stats.isDirectory();
      } catch (error) {
        printCheck(false, "src", String((error as Error).message ?? error));
        allGood = false;
      }

      process.exitCode = allGood ? 0 : 1;
    });
}
