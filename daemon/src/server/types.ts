import type {
  ProjectTreeNode,
  ProjectTreeSnapshot,
  ResolvedRoSyncConfig,
  RuntimeDiagnostics,
  RuntimeConnections,
  RuntimeState,
  RuntimeStatusSummary,
  SerializableNode,
} from "../config/types.js";
import type { SchemaCache } from "../schema/types.js";
import type { ConflictRecord, ConflictStrategy } from "../sync/conflict.js";
import type { SyncActivityAction } from "../sync/engine.js";

export interface ServerLogger {
  info(message: string): void;
  debug(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface WatchServerContext {
  config: ResolvedRoSyncConfig;
  logger: ServerLogger;
  getSummary(): RuntimeStatusSummary;
  getDiagnostics(): RuntimeDiagnostics;
  getRuntimeState(): RuntimeState;
  getConnections(): RuntimeConnections;
  getConflicts(): ConflictRecord[];
  resolveConflict(id: string, strategy: ConflictStrategy): Promise<boolean>;
  getSchemaCache(): Promise<SchemaCache> | SchemaCache;
  getProjectTree(): Promise<ProjectTreeSnapshot> | ProjectTreeSnapshot;
  getProjectNode(nodePath: string): Promise<ProjectTreeNode | null> | ProjectTreeNode | null;
  refreshProjectState(origin?: "disk" | "studio" | "editor"): Promise<void>;
  createProjectNode(parentPath: string, name: string, className: string): Promise<void>;
  updateProjectNode(
    nodePath: string,
    patch: Partial<Pick<SerializableNode, "properties" | "attributes" | "tags" | "source">>,
  ): Promise<void>;
  syncProjectNode(nodePath: string, payload: SerializableNode): Promise<void>;
  upsertProjectNode(nodePath: string, payload: SerializableNode): Promise<void>;
  renameProjectNode(nodePath: string, newName: string): Promise<void>;
  moveProjectNode(oldPath: string, newPath: string): Promise<void>;
  deleteProjectNode(nodePath: string): Promise<void>;
  syncFromStudio(nodePath: string, payload: SerializableNode): Promise<void>;
  pushBatchFromStudio(
    instances: Array<{ path: string; data: SerializableNode }>,
    removedPaths?: string[],
    progress?: {
      service?: string | null;
      done?: number | null;
      total?: number | null;
      serviceComplete?: boolean;
      pushComplete?: boolean;
    },
  ): Promise<void>;
  reportPullProgressFromStudio(progress: {
    service?: string | null;
    done?: number | null;
    total?: number | null;
    serviceComplete?: boolean;
    pullComplete?: boolean;
  }): Promise<void>;
  reportSyncPlanFromStudio(plan: {
    direction?: "push" | "pull" | null;
    service?: string | null;
    added?: number | null;
    changed?: number | null;
    removed?: number | null;
    unchanged?: number | null;
    scanned?: number | null;
    serviceIndex?: number | null;
    serviceCount?: number | null;
    planComplete?: boolean;
  }): Promise<void>;
  reportSyncStageFromStudio(stage: {
    direction?: "push" | "pull" | null;
    phase?: "planning" | "applying" | null;
    service?: string | null;
    serviceIndex?: number | null;
    serviceCount?: number | null;
    detail?: string | null;
  }): Promise<void>;
  removeFromStudio(nodePath: string): Promise<void>;
  renameFromStudio(oldPath: string, newPath: string): Promise<void>;
  noteEditorActivity(activity: {
    action: SyncActivityAction;
    client?: string | null;
    path?: string | null;
    oldPath?: string | null;
    newPath?: string | null;
  }): void;
  pushToStudio(service?: string): number;
  requestPull(service?: string): number;
  broadcastToClients(role: "studio" | "editor" | "unknown", payload: unknown): number;
}
