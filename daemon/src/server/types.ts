import type {
  ProjectTreeNode,
  ProjectTreeSnapshot,
  ResolvedRoSyncConfig,
  RuntimeConnections,
  RuntimeStatusSummary,
  SerializableNode,
} from "../config/types.js";
import type { SchemaCache } from "../schema/types.js";

export interface ServerLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface WatchServerContext {
  config: ResolvedRoSyncConfig;
  logger: ServerLogger;
  getSummary(): RuntimeStatusSummary;
  getConnections(): RuntimeConnections;
  getSchemaCache(): Promise<SchemaCache> | SchemaCache;
  getProjectTree(): Promise<ProjectTreeSnapshot> | ProjectTreeSnapshot;
  getProjectNode(nodePath: string): Promise<ProjectTreeNode | null> | ProjectTreeNode | null;
  refreshProjectState(): Promise<void>;
  createProjectNode(parentPath: string, name: string, className: string): Promise<void>;
  updateProjectNode(
    nodePath: string,
    patch: Partial<Pick<SerializableNode, "properties" | "attributes" | "tags" | "source">>,
  ): Promise<void>;
  upsertProjectNode(nodePath: string, payload: SerializableNode): Promise<void>;
  renameProjectNode(nodePath: string, newName: string): Promise<void>;
  moveProjectNode(oldPath: string, newPath: string): Promise<void>;
  deleteProjectNode(nodePath: string): Promise<void>;
  broadcastToClients(role: "studio" | "vscode" | "unknown", payload: unknown): number;
}
