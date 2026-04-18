import type { Command } from "commander";
import { loadIgnoreRules } from "../config/ignore.js";
import { loadConfig } from "../config/toml_parser.js";
import { readRuntimeState, scanProjectState } from "../sync/engine.js";

interface HealthResponse {
  ok: boolean;
  connections?: {
    studio: number;
    editor: number;
    unknown: number;
  };
  summary?: {
    indexedInstances: number;
    scriptFiles: number;
    ignoredEntries: number;
  };
  diagnostics?: {
    syncedInstances: number;
    driftedInstances: number;
    conflictCount: number;
    pendingOutboundCount: number;
    lastFileEventAt?: string | null;
    lastFileEventPath?: string | null;
    lastStudioEventAt?: string | null;
    lastStudioEventPath?: string | null;
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
      const diagnostics = health?.diagnostics ?? runtime.diagnostics;

      console.log(`Project:            ${config.project.name}`);
      console.log(`Config:             ${config.configPath}`);
      console.log(`Src:                ${config.srcDir}`);
      console.log(`Indexed instances:  ${localSummary.indexedInstances}`);
      console.log(`Script files:       ${localSummary.scriptFiles}`);
      console.log(`Ignored entries:    ${localSummary.ignoredEntries}`);
      console.log(`Synced instances:   ${diagnostics.syncedInstances}`);
      console.log(`Drifted instances:  ${diagnostics.driftedInstances}`);
      console.log(`Conflicts:          ${diagnostics.conflictCount}`);
      console.log(`Pending outbound:   ${diagnostics.pendingOutboundCount}`);
      console.log(`Daemon:             ${health ? "connected" : "disconnected"}`);
      console.log(`Studio clients:     ${connections.studio}`);
      console.log(`Editor clients:     ${connections.editor}`);
      console.log(`Other clients:      ${connections.unknown}`);
      console.log(`Schema version:     ${schemaVersion}`);
      console.log(`Schema fetched at:  ${formatTimestamp(schemaFetchedAt)}`);
      console.log(`Last file event:    ${formatTimestamp(diagnostics.lastFileEventAt)} (${diagnostics.lastFileEventPath ?? "n/a"})`);
      console.log(`Last Studio event:  ${formatTimestamp(diagnostics.lastStudioEventAt)} (${diagnostics.lastStudioEventPath ?? "n/a"})`);
      console.log(`Last scan:          ${formatTimestamp(localSummary.lastScanAt)}`);
    });
}
