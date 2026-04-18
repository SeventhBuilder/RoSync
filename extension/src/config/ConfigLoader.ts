import fs from "node:fs/promises";
import path from "node:path";
import * as vscode from "vscode";

export interface DaemonEndpoint {
  host: string;
  port: number;
  configPath: string | null;
  workspaceRoot: string | null;
}

const DEFAULT_ENDPOINT: DaemonEndpoint = {
  host: "127.0.0.1",
  port: 34872,
  configPath: null,
  workspaceRoot: null,
};

function normalizeLoopbackHost(host: string): string {
  return host.trim().toLowerCase() === "localhost" ? "127.0.0.1" : host;
}

function parseSyncValue(text: string, key: "host" | "port"): string | null {
  const syncSectionMatch = text.match(/\[sync\]([\s\S]*?)(?:\n\[|$)/);
  const syncSection = syncSectionMatch ? syncSectionMatch[1] : text;

  if (key === "host") {
    const hostMatch = syncSection.match(/host\s*=\s*"([^"]+)"/);
    return hostMatch ? hostMatch[1] : null;
  }

  const portMatch = syncSection.match(/port\s*=\s*(\d+)/);
  return portMatch ? portMatch[1] : null;
}

export async function loadDaemonEndpoint(): Promise<DaemonEndpoint> {
  for (const workspaceFolder of vscode.workspace.workspaceFolders ?? []) {
    const workspaceRoot = workspaceFolder.uri.fsPath;
    const configPath = path.join(workspaceRoot, "rosync.toml");

    try {
      const text = await fs.readFile(configPath, "utf8");
      const host = normalizeLoopbackHost(parseSyncValue(text, "host") ?? DEFAULT_ENDPOINT.host);
      const port = Number(parseSyncValue(text, "port") ?? DEFAULT_ENDPOINT.port);

      return {
        host,
        port,
        configPath,
        workspaceRoot,
      };
    } catch {
      continue;
    }
  }

  return DEFAULT_ENDPOINT;
}
