import type { Command } from "commander";
import { loadIgnoreRules } from "../config/ignore.js";
import { loadConfig } from "../config/toml_parser.js";
import { readRuntimeState, scanProjectState } from "../sync/engine.js";

interface HealthResponse {
  ok: boolean;
  connections?: {
    studio: number;
    vscode: number;
    unknown: number;
  };
  summary?: {
    indexedInstances: number;
    scriptFiles: number;
    ignoredEntries: number;
  };
  schema?: {
    version?: string | null;
    fetchedAt?: string | null;
  };
}

async function fetchHealth(host: string, port: number): Promise<HealthResponse | null> {
  try {
    const response = await fetch(`http://${host}:${port}/health`, {
      signal: AbortSignal.timeout(1_500),
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as HealthResponse;
  } catch {
    return null;
  }
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "unknown";
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
}

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show current RoSync project and daemon status.")
    .action(async () => {
      const config = await loadConfig(process.cwd());
      const ignoreRules = await loadIgnoreRules(config.projectRoot, config.ignorePath);
      const localSummary = await scanProjectState(config, ignoreRules);
      const runtime = await readRuntimeState(config);
      const health = await fetchHealth(config.sync.host, config.sync.port);

      const connections = health?.connections ?? runtime.connections;
      const schemaVersion = health?.schema?.version ?? runtime.schemaVersion ?? "unknown";
      const schemaFetchedAt = health?.schema?.fetchedAt ?? runtime.schemaFetchedAt;

      console.log(`Project:            ${config.project.name}`);
      console.log(`Config:             ${config.configPath}`);
      console.log(`Src:                ${config.srcDir}`);
      console.log(`Indexed instances:  ${localSummary.indexedInstances}`);
      console.log(`Script files:       ${localSummary.scriptFiles}`);
      console.log(`Ignored entries:    ${localSummary.ignoredEntries}`);
      console.log(`Daemon:             ${health ? "connected" : "disconnected"}`);
      console.log(`Studio clients:     ${connections.studio}`);
      console.log(`VS Code clients:    ${connections.vscode}`);
      console.log(`Other clients:      ${connections.unknown}`);
      console.log(`Schema version:     ${schemaVersion}`);
      console.log(`Schema fetched at:  ${formatTimestamp(schemaFetchedAt)}`);
      console.log(`Last scan:          ${formatTimestamp(localSummary.lastScanAt)}`);
    });
}
