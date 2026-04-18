import fs from "node:fs/promises";
import path from "node:path";
import type { ResolvedRoSyncConfig, RuntimeConnections, RuntimeState, RuntimeStatusSummary } from "../config/types.js";
import { EMPTY_RUNTIME_STATE } from "../config/types.js";
import type { RoSyncIgnoreRules } from "../config/ignore.js";
import { buildProjectTree, summarizeProjectTree } from "./project.js";

function toRelativePath(rootDir: string, targetPath: string): string {
  return path.relative(rootDir, targetPath).replace(/\\/g, "/");
}

function isScriptFile(fileName: string): boolean {
  return /\.(luau|lua)$/i.test(fileName);
}

export async function scanProjectState(config: ResolvedRoSyncConfig, ignoreRules: RoSyncIgnoreRules): Promise<RuntimeStatusSummary> {
  const tree = await buildProjectTree(config, ignoreRules);
  const summary = summarizeProjectTree(tree);

  try {
    async function countLooseScriptFiles(currentPath: string): Promise<number> {
      const stats = await fs.stat(currentPath);
      const relativePath = toRelativePath(config.projectRoot, currentPath);

      if (relativePath && ignoreRules.matcher.ignores(relativePath.replace(/\\/g, "/"))) {
        return 0;
      }

      if (!stats.isDirectory()) {
        return isScriptFile(currentPath) ? 1 : 0;
      }

      const children = await fs.readdir(currentPath);
      let count = 0;
      for (const child of children) {
        count += await countLooseScriptFiles(path.join(currentPath, child));
      }
      return count;
    }

    summary.scriptFiles = await countLooseScriptFiles(config.srcDir);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }

  return summary;
}

export async function readRuntimeState(config: ResolvedRoSyncConfig): Promise<RuntimeState> {
  try {
    const rawText = await fs.readFile(config.runtimePath, "utf8");
    const parsed = JSON.parse(rawText) as Partial<RuntimeState>;
    const parsedConnections = (parsed.connections ?? {}) as Partial<RuntimeConnections> & { vscode?: number };
    return {
      ...EMPTY_RUNTIME_STATE,
      ...parsed,
      connections: {
        ...EMPTY_RUNTIME_STATE.connections,
        ...parsedConnections,
        editor:
          typeof parsedConnections.editor === "number"
            ? parsedConnections.editor
            : typeof parsedConnections.vscode === "number"
              ? parsedConnections.vscode
              : EMPTY_RUNTIME_STATE.connections.editor,
      },
      summary: {
        ...EMPTY_RUNTIME_STATE.summary,
        ...(parsed.summary ?? {}),
      },
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return EMPTY_RUNTIME_STATE;
    }
    throw error;
  }
}

export async function writeRuntimeState(config: ResolvedRoSyncConfig, runtimeState: RuntimeState): Promise<void> {
  await fs.mkdir(path.dirname(config.runtimePath), { recursive: true });
  await fs.writeFile(config.runtimePath, JSON.stringify(runtimeState, null, 2), "utf8");
}

export function summarizeConnections(sessions: Array<{ role: "studio" | "editor" | "vscode" | "unknown" }>): RuntimeConnections {
  const summary: RuntimeConnections = {
    studio: 0,
    editor: 0,
    unknown: 0,
  };

  for (const session of sessions) {
    if (session.role === "vscode") {
      summary.editor += 1;
      continue;
    }
    summary[session.role] += 1;
  }

  return summary;
}
