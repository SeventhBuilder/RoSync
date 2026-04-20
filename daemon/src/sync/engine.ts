import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  ProjectTreeNode,
  ProjectTreeSnapshot,
  ResolvedRoSyncConfig,
  RuntimeConnections,
  RuntimeDiagnostics,
  RuntimeState,
  RuntimeStatusSummary,
  SerializableNode,
} from "../config/types.js";
import { EMPTY_RUNTIME_DIAGNOSTICS, EMPTY_RUNTIME_STATE } from "../config/types.js";
import type { RoSyncIgnoreRules } from "../config/ignore.js";
import { buildProjectTree, findNodeByPath, summarizeProjectTree } from "./project.js";
import {
  createConflictRecord,
  type ConflictOperationSnapshot,
  type ConflictRecord,
  type ConflictStrategy,
} from "./conflict.js";

export type SyncOrigin = "disk" | "studio" | "editor";
export type SyncOperation =
  | {
      type: "SYNC_INSTANCE";
      path: string;
      data: SerializableNode;
      hash: string;
    }
  | {
      type: "REMOVE_INSTANCE";
      path: string;
    }
  | {
      type: "RENAME_INSTANCE";
      oldPath: string;
      newPath: string;
    };
export type SyncActivityAction = "add" | "update" | "remove" | "rename";

interface SyncActivityEntry {
  action: SyncActivityAction;
  path: string;
  nextPath?: string;
}

interface EditorActivityHint {
  action: SyncActivityAction;
  client: string;
  path: string | null;
  oldPath: string | null;
  newPath: string | null;
  expiresAt: number;
}

const EDITOR_ACTIVITY_TTL_MS = 3_000;
const ANSI_RESET = "\u001b[0m";
const ANSI_GREEN = "\u001b[32m";
const ANSI_YELLOW = "\u001b[33m";
const ANSI_RED = "\u001b[31m";

interface FlattenedNodeEntry {
  path: string;
  node: ProjectTreeNode;
  data: SerializableNode;
  localHash: string;
  subtreeHash: string;
}

interface SyncRecord {
  path: string;
  diskHash: string;
  studioHash: string | null;
  lastOrigin: SyncOrigin | null;
  pendingOutbound: SyncOperation["type"] | null;
  pendingHash: string | null;
  conflictId: string | null;
  updatedAt: string;
}

export interface SyncEngineHooks {
  rebuildProjectTree(): Promise<ProjectTreeSnapshot>;
  createProjectNode(parentPath: string, name: string, className: string): Promise<void>;
  updateProjectNode(
    nodePath: string,
    patch: Partial<Pick<SerializableNode, "properties" | "attributes" | "tags" | "source">>,
  ): Promise<void>;
  upsertProjectNode(nodePath: string, payload: SerializableNode): Promise<void>;
  renameProjectNode(nodePath: string, newName: string): Promise<void>;
  moveProjectNode(oldPath: string, newPath: string): Promise<void>;
  deleteProjectNode(nodePath: string): Promise<void>;
  broadcastToClients(role: "studio" | "editor" | "unknown", payload: unknown): number;
  logger: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
  };
}

function toRelativePath(rootDir: string, targetPath: string): string {
  return path.relative(rootDir, targetPath).replace(/\\/g, "/");
}

function isScriptFile(fileName: string): boolean {
  return /\.(luau|lua)$/i.test(fileName);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
}

function hashText(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

export function projectNodeToSerializable(node: ProjectTreeNode): SerializableNode {
  return {
    name: node.name,
    className: node.className,
    properties: { ...node.properties },
    attributes: { ...node.attributes },
    tags: [...node.tags],
    source: node.source ?? undefined,
    children: node.children.map((child) => projectNodeToSerializable(child)),
  };
}

function nodeLocalPayload(node: ProjectTreeNode): SerializableNode {
  return {
    name: node.name,
    className: node.className,
    properties: { ...node.properties },
    attributes: { ...node.attributes },
    tags: [...node.tags],
    source: node.source ?? undefined,
  };
}

function subtreeIdentityPayload(node: SerializableNode): unknown {
  return {
    className: node.className,
    properties: node.properties ?? {},
    attributes: node.attributes ?? {},
    tags: node.tags ?? [],
    source: node.source ?? null,
    children: (node.children ?? []).map((child) => subtreeIdentityPayload(child)),
  };
}

export function hashSerializableNode(node: SerializableNode): string {
  return hashText(stableStringify(node));
}

function flattenProjectTree(tree: ProjectTreeSnapshot): Map<string, FlattenedNodeEntry> {
  const entries = new Map<string, FlattenedNodeEntry>();

  function visit(node: ProjectTreeNode): string {
    const data = projectNodeToSerializable(node);
    const localHash = hashSerializableNode(nodeLocalPayload(node));
    const subtreeHash = hashText(stableStringify(subtreeIdentityPayload(data)));
    entries.set(node.path, {
      path: node.path,
      node,
      data,
      localHash,
      subtreeHash,
    });
    for (const child of node.children) {
      visit(child);
    }
    return subtreeHash;
  }

  for (const service of tree.services) {
    visit(service);
  }

  return entries;
}

function pathDepth(nodePath: string): number {
  return nodePath.split("/").length;
}

function isSameOrDescendantPath(candidatePath: string, ancestorPath: string): boolean {
  return candidatePath === ancestorPath || candidatePath.startsWith(`${ancestorPath}/`);
}

function filterTopLevelPaths(paths: Iterable<string>): string[] {
  const sorted = [...paths].sort((left, right) => {
    const depthDifference = pathDepth(left) - pathDepth(right);
    return depthDifference !== 0 ? depthDifference : left.localeCompare(right);
  });

  const selected: string[] = [];
  for (const currentPath of sorted) {
    if (selected.some((selectedPath) => isSameOrDescendantPath(currentPath, selectedPath))) {
      continue;
    }
    selected.push(currentPath);
  }

  return selected;
}

function conflictSnapshotForOperation(operation: SyncOperation): ConflictOperationSnapshot {
  if (operation.type === "SYNC_INSTANCE") {
    return {
      kind: "sync",
      path: operation.path,
      data: operation.data,
      hash: operation.hash,
    };
  }

  if (operation.type === "REMOVE_INSTANCE") {
    return {
      kind: "remove",
      path: operation.path,
      hash: null,
    };
  }

  return {
    kind: "rename",
    path: operation.oldPath,
    newPath: operation.newPath,
    hash: null,
  };
}

export function diffProjectTrees(previousTree: ProjectTreeSnapshot, nextTree: ProjectTreeSnapshot): SyncOperation[] {
  const previousEntries = flattenProjectTree(previousTree);
  const nextEntries = flattenProjectTree(nextTree);

  const previousPaths = new Set(previousEntries.keys());
  const nextPaths = new Set(nextEntries.keys());

  const removedTopLevel = filterTopLevelPaths([...previousPaths].filter((entryPath) => !nextPaths.has(entryPath)));
  const addedTopLevel = filterTopLevelPaths([...nextPaths].filter((entryPath) => !previousPaths.has(entryPath)));
  const sharedChanged = filterTopLevelPaths(
    [...nextPaths].filter((entryPath) => previousPaths.has(entryPath) && previousEntries.get(entryPath)?.localHash !== nextEntries.get(entryPath)?.localHash),
  );

  const addedByHash = new Map<string, string[]>();
  for (const addedPath of addedTopLevel) {
    const addedEntry = nextEntries.get(addedPath);
    if (!addedEntry) {
      continue;
    }
    const bucket = addedByHash.get(addedEntry.subtreeHash) ?? [];
    bucket.push(addedPath);
    addedByHash.set(addedEntry.subtreeHash, bucket);
  }

  const matchedAddedPaths = new Set<string>();
  const renameOperations: SyncOperation[] = [];
  for (const removedPath of removedTopLevel) {
    const removedEntry = previousEntries.get(removedPath);
    if (!removedEntry) {
      continue;
    }

    const candidates = addedByHash.get(removedEntry.subtreeHash);
    if (!candidates || candidates.length === 0) {
      continue;
    }

    const nextPath = candidates.shift();
    if (!nextPath) {
      continue;
    }

    matchedAddedPaths.add(nextPath);
    renameOperations.push({
      type: "RENAME_INSTANCE",
      oldPath: removedPath,
      newPath: nextPath,
    });
  }

  const removeOperations = removedTopLevel
    .filter((removedPath) => !renameOperations.some((operation) => operation.type === "RENAME_INSTANCE" && operation.oldPath === removedPath))
    .sort((left, right) => pathDepth(right) - pathDepth(left))
    .map<SyncOperation>((removedPath) => ({
      type: "REMOVE_INSTANCE",
      path: removedPath,
    }));

  const syncOperations: SyncOperation[] = [];
  for (const addedPath of addedTopLevel) {
    if (matchedAddedPaths.has(addedPath)) {
      continue;
    }
    const entry = nextEntries.get(addedPath);
    if (!entry) {
      continue;
    }
    syncOperations.push({
      type: "SYNC_INSTANCE",
      path: addedPath,
      data: entry.data,
      hash: entry.localHash,
    });
  }

  for (const changedPath of sharedChanged) {
    const entry = nextEntries.get(changedPath);
    if (!entry) {
      continue;
    }
    syncOperations.push({
      type: "SYNC_INSTANCE",
      path: changedPath,
      data: entry.data,
      hash: entry.localHash,
    });
  }

  return [...renameOperations, ...removeOperations, ...syncOperations];
}

function recordTargetsForOrigin(origin: SyncOrigin): Array<"studio" | "editor"> {
  switch (origin) {
    case "studio":
      return ["editor"];
    case "editor":
      return ["studio"];
    default:
      return ["studio", "editor"];
  }
}

function normalizeSyncPath(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return normalized.length > 0 ? normalized : null;
}

function syncOriginLabel(origin: SyncOrigin): string {
  switch (origin) {
    case "studio":
      return "Studio";
    case "editor":
      return "VSCode";
    default:
      return "Disk";
  }
}

function actionDisplay(action: SyncActivityAction): { token: string; color: string } {
  switch (action) {
    case "add":
      return { token: "+ Add", color: ANSI_GREEN };
    case "remove":
      return { token: "- Remove", color: ANSI_RED };
    case "rename":
      return { token: "~ Rename", color: ANSI_YELLOW };
    default:
      return { token: "~ Update", color: ANSI_YELLOW };
  }
}

function describeSyncActivity(
  operation: SyncOperation,
  previousEntries: ReadonlyMap<string, FlattenedNodeEntry>,
): SyncActivityEntry {
  if (operation.type === "REMOVE_INSTANCE") {
    return {
      action: "remove",
      path: operation.path,
    };
  }

  if (operation.type === "RENAME_INSTANCE") {
    return {
      action: "rename",
      path: operation.oldPath,
      nextPath: operation.newPath,
    };
  }

  return {
    action: previousEntries.has(operation.path) ? "update" : "add",
    path: operation.path,
  };
}

export function formatSyncActivityLine(origin: SyncOrigin, activity: SyncActivityEntry, useColor = false): string {
  const originText = `[${syncOriginLabel(origin)}]`;
  const display = actionDisplay(activity.action);
  const actionText = useColor ? `${display.color}${display.token}${ANSI_RESET}` : display.token;
  const pathText = activity.nextPath ? `${activity.path} -> ${activity.nextPath}` : activity.path;
  return `${originText} ${actionText} ${pathText}`;
}

function formatSyncOperation(operation: SyncOperation, origin: SyncOrigin): unknown {
  if (operation.type === "SYNC_INSTANCE") {
    return {
      type: operation.type,
      path: operation.path,
      data: operation.data,
      origin,
    };
  }

  if (operation.type === "REMOVE_INSTANCE") {
    return {
      ...operation,
      origin,
    };
  }

  return {
    ...operation,
    origin,
  };
}

export class SyncEngine {
  private currentTree: ProjectTreeSnapshot;
  private summary: RuntimeStatusSummary;
  private flattenedEntries = new Map<string, FlattenedNodeEntry>();
  private records = new Map<string, SyncRecord>();
  private conflicts = new Map<string, ConflictRecord>();
  private diagnostics: RuntimeDiagnostics = {
    ...EMPTY_RUNTIME_DIAGNOSTICS,
  };
  private pendingStudioSyncs = new Map<string, string>();
  private pendingStudioRemovals = new Set<string>();
  private pendingStudioRenames = new Map<string, string>();
  private pendingDiskSyncs = new Map<string, string>();
  private pendingDiskRemovals = new Set<string>();
  private pendingDiskRenames = new Map<string, string>();
  private editorActivityHints: EditorActivityHint[] = [];

  public constructor(initialTree: ProjectTreeSnapshot, private readonly hooks: SyncEngineHooks) {
    this.currentTree = initialTree;
    this.summary = summarizeProjectTree(initialTree);
    this.reindexRecords();
  }

  public getProjectTree(): ProjectTreeSnapshot {
    return this.currentTree;
  }

  public getProjectSummary(): RuntimeStatusSummary {
    return this.summary;
  }

  public getProjectNode(nodePath: string): ProjectTreeNode | null {
    return findNodeByPath(this.currentTree, nodePath);
  }

  public getConflicts(): ConflictRecord[] {
    return [...this.conflicts.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  public getDiagnostics(): RuntimeDiagnostics {
    return {
      ...this.diagnostics,
    };
  }

  public noteFileEvent(changedPath: string): void {
    this.diagnostics.lastFileEventAt = new Date().toISOString();
    this.diagnostics.lastFileEventPath = changedPath;
  }

  public noteStudioEvent(changedPath: string): void {
    this.diagnostics.lastStudioEventAt = new Date().toISOString();
    this.diagnostics.lastStudioEventPath = changedPath;
  }

  public noteEditorEvent(changedPath: string): void {
    this.diagnostics.lastEditorEventAt = new Date().toISOString();
    this.diagnostics.lastEditorEventPath = changedPath;
  }

  public noteEditorActivity(activity: {
    action: SyncActivityAction;
    client?: string | null;
    path?: string | null;
    oldPath?: string | null;
    newPath?: string | null;
  }): void {
    this.pruneEditorActivityHints();

    const hint: EditorActivityHint = {
      action: activity.action,
      client: activity.client ?? "vscode",
      path: normalizeSyncPath(activity.path),
      oldPath: normalizeSyncPath(activity.oldPath),
      newPath: normalizeSyncPath(activity.newPath),
      expiresAt: Date.now() + EDITOR_ACTIVITY_TTL_MS,
    };

    if (!hint.path && !hint.oldPath && !hint.newPath) {
      return;
    }

    this.editorActivityHints.push(hint);
    this.noteEditorEvent(hint.newPath ?? hint.path ?? hint.oldPath ?? "editor-activity");
  }

  public async reconcileDiskTree(origin: SyncOrigin): Promise<SyncOperation[]> {
    const nextTree = await this.hooks.rebuildProjectTree();
    return this.reconcileTree(nextTree, origin);
  }

  public async createNode(parentPath: string, name: string, className: string, origin: SyncOrigin = "editor"): Promise<void> {
    this.noteEditorEvent(`${parentPath}/${name}`);
    await this.hooks.createProjectNode(parentPath, name, className);
    await this.reconcileDiskTree(origin);
  }

  public async updateNode(
    nodePath: string,
    patch: Partial<Pick<SerializableNode, "properties" | "attributes" | "tags" | "source">>,
    origin: SyncOrigin = "editor",
  ): Promise<void> {
    this.noteEditorEvent(nodePath);
    await this.hooks.updateProjectNode(nodePath, patch);
    await this.reconcileDiskTree(origin);
  }

  public async upsertNode(nodePath: string, payload: SerializableNode, origin: SyncOrigin = "editor"): Promise<void> {
    this.noteEditorEvent(nodePath);
    await this.hooks.upsertProjectNode(nodePath, payload);
    await this.reconcileDiskTree(origin);
  }

  public async renameNode(nodePath: string, newName: string, origin: SyncOrigin = "editor"): Promise<void> {
    const nextPath = `${nodePath.split("/").slice(0, -1).join("/")}/${newName}`.replace(/^\/+/, "");
    this.noteEditorEvent(nextPath);
    await this.hooks.renameProjectNode(nodePath, newName);
    await this.reconcileDiskTree(origin);
  }

  public async moveNode(oldPath: string, newPath: string, origin: SyncOrigin = "editor"): Promise<void> {
    this.noteEditorEvent(newPath);
    await this.hooks.moveProjectNode(oldPath, newPath);
    await this.reconcileDiskTree(origin);
  }

  public async deleteNode(nodePath: string, origin: SyncOrigin = "editor"): Promise<void> {
    this.noteEditorEvent(nodePath);
    await this.hooks.deleteProjectNode(nodePath);
    await this.reconcileDiskTree(origin);
  }

  public async handleStudioSync(pathValue: string, data: SerializableNode): Promise<void> {
    this.noteStudioEvent(pathValue);
    const remoteHash = hashText(
      stableStringify({
        name: data.name,
        className: data.className,
        properties: data.properties ?? {},
        attributes: data.attributes ?? {},
        tags: data.tags ?? [],
        source: data.source ?? undefined,
      }),
    );

    if (this.consumePendingStudioSync(pathValue, remoteHash)) {
      return;
    }

    const localEntry = this.flattenedEntries.get(pathValue);
    const localRecord = this.records.get(pathValue);
    if (localRecord?.pendingOutbound === "SYNC_INSTANCE" && localRecord.pendingHash && localRecord.pendingHash !== remoteHash) {
      this.registerConflict(
        pathValue,
        "Studio and disk changed the same instance before sync completed.",
        localEntry
          ? {
              kind: "sync",
              path: pathValue,
              data: localEntry.data,
              hash: localEntry.localHash,
            }
          : null,
        {
          kind: "sync",
          path: pathValue,
          data,
          hash: remoteHash,
        },
      );
      return;
    }

    await this.hooks.upsertProjectNode(pathValue, data);
    await this.reconcileDiskTree("studio");
  }

  public async handleStudioRemove(pathValue: string): Promise<void> {
    this.noteStudioEvent(pathValue);

    if (this.consumePendingStudioRemoval(pathValue)) {
      return;
    }

    const localRecord = this.records.get(pathValue);
    if (localRecord?.pendingOutbound === "SYNC_INSTANCE" || localRecord?.pendingOutbound === "RENAME_INSTANCE") {
      const localEntry = this.flattenedEntries.get(pathValue);
      this.registerConflict(
        pathValue,
        "Studio removed an instance that still has pending local changes.",
        localEntry
          ? {
              kind: "sync",
              path: pathValue,
              data: localEntry.data,
              hash: localEntry.localHash,
            }
          : null,
        {
          kind: "remove",
          path: pathValue,
          hash: null,
        },
      );
      return;
    }

    await this.hooks.deleteProjectNode(pathValue);
    await this.reconcileDiskTree("studio");
  }

  public async handleStudioRename(oldPath: string, newPath: string): Promise<void> {
    this.noteStudioEvent(newPath);

    if (this.consumePendingStudioRename(oldPath, newPath)) {
      return;
    }

    const localRecord = this.records.get(oldPath);
    if (localRecord?.pendingOutbound === "SYNC_INSTANCE") {
      const localEntry = this.flattenedEntries.get(oldPath);
      this.registerConflict(
        oldPath,
        "Studio renamed an instance that still has pending local changes.",
        localEntry
          ? {
              kind: "sync",
              path: oldPath,
              data: localEntry.data,
              hash: localEntry.localHash,
            }
          : null,
        {
          kind: "rename",
          path: oldPath,
          newPath,
          hash: null,
        },
      );
      return;
    }

    await this.hooks.moveProjectNode(oldPath, newPath);
    await this.reconcileDiskTree("studio");
  }

  public pushToStudio(service?: string): number {
    const selectedNodes = service
      ? this.currentTree.services.filter((serviceNode) => serviceNode.name === service)
      : this.currentTree.services;

    let delivered = 0;
    for (const node of selectedNodes) {
      const entry = this.flattenedEntries.get(node.path);
      if (!entry) {
        continue;
      }

      const operation: SyncOperation = {
        type: "SYNC_INSTANCE",
        path: node.path,
        data: entry.data,
        hash: entry.localHash,
      };
      delivered += this.broadcastOperation(operation, "editor", "editor");
    }

    return delivered;
  }

  public requestPull(service?: string): number {
    return this.hooks.broadcastToClients("studio", {
      type: "PULL_REQUEST",
      service: service ?? null,
    });
  }

  public async resolveConflict(id: string, strategy: ConflictStrategy): Promise<boolean> {
    const conflict = this.conflicts.get(id);
    if (!conflict) {
      return false;
    }

    if (strategy === "manual") {
      this.clearConflict(id);
      return true;
    }

    const chosen = strategy === "ours" ? conflict.local : conflict.remote;
    if (!chosen) {
      this.clearConflict(id);
      return true;
    }

    if (chosen.kind === "sync" && chosen.data) {
      if (strategy === "ours") {
        this.broadcastOperation(
          {
            type: "SYNC_INSTANCE",
            path: chosen.path,
            data: chosen.data,
            hash: chosen.hash ?? hashSerializableNode(chosen.data),
          },
          "editor",
          "editor",
        );
      } else {
        await this.hooks.upsertProjectNode(chosen.path, chosen.data);
        await this.reconcileDiskTree("studio");
      }
    } else if (chosen.kind === "remove") {
      if (strategy === "ours") {
        this.broadcastOperation(
          {
            type: "REMOVE_INSTANCE",
            path: chosen.path,
          },
          "editor",
          "editor",
        );
      } else {
        await this.hooks.deleteProjectNode(chosen.path);
        await this.reconcileDiskTree("studio");
      }
    } else if (chosen.kind === "rename" && chosen.newPath) {
      if (strategy === "ours") {
        this.broadcastOperation(
          {
            type: "RENAME_INSTANCE",
            oldPath: chosen.path,
            newPath: chosen.newPath,
          },
          "editor",
          "editor",
        );
      } else {
        await this.hooks.moveProjectNode(chosen.path, chosen.newPath);
        await this.reconcileDiskTree("studio");
      }
    }

    this.clearConflict(id);
    return true;
  }

  private reconcileTree(nextTree: ProjectTreeSnapshot, origin: SyncOrigin): SyncOperation[] {
    const previousTree = this.currentTree;
    const previousEntries = this.flattenedEntries;
    const operations = diffProjectTrees(previousTree, nextTree);

    this.currentTree = nextTree;
    this.summary = summarizeProjectTree(nextTree);
    this.reindexRecords();

    const emittedOperations: SyncOperation[] = [];
    for (const operation of operations) {
      if (origin === "disk" && this.consumePendingDiskEcho(operation)) {
        continue;
      }

      if (origin === "studio" || origin === "editor") {
        this.registerPendingDiskEcho(operation);
      }

      const activityOrigin = this.resolveActivityOrigin(operation, origin);
      this.hooks.logger.info(formatSyncActivityLine(activityOrigin, describeSyncActivity(operation, previousEntries), true));
      const delivered = this.broadcastOperation(operation, origin, activityOrigin);
      if (delivered > 0) {
        emittedOperations.push(operation);
      }
    }

    this.refreshDiagnostics();
    return emittedOperations;
  }

  private broadcastOperation(operation: SyncOperation, routingOrigin: SyncOrigin, activityOrigin: SyncOrigin): number {
    const targets = recordTargetsForOrigin(routingOrigin);
    let delivered = 0;
    let deliveredToStudio = 0;

    for (const target of targets) {
      const deliveredCount = this.hooks.broadcastToClients(target, formatSyncOperation(operation, activityOrigin));
      delivered += deliveredCount;
      if (target === "studio") {
        deliveredToStudio += deliveredCount;
      }
    }

    if (deliveredToStudio > 0) {
      this.registerPendingStudioEcho(operation);
    }

    const targetRecordPath = operation.type === "RENAME_INSTANCE" ? operation.newPath : operation.path;
    const record = this.records.get(targetRecordPath);
    if (record) {
      record.lastOrigin = activityOrigin;
      record.pendingOutbound = deliveredToStudio > 0 ? operation.type : null;
      record.pendingHash = deliveredToStudio > 0 && operation.type === "SYNC_INSTANCE" ? operation.hash : null;
      record.updatedAt = new Date().toISOString();
    }

    return delivered;
  }

  private registerPendingStudioEcho(operation: SyncOperation): void {
    if (operation.type === "SYNC_INSTANCE") {
      this.pendingStudioSyncs.set(operation.path, operation.hash);
      return;
    }

    if (operation.type === "REMOVE_INSTANCE") {
      this.pendingStudioRemovals.add(operation.path);
      return;
    }

    this.pendingStudioRenames.set(operation.oldPath, operation.newPath);
  }

  private consumePendingStudioSync(pathValue: string, hash: string): boolean {
    const pendingHash = this.pendingStudioSyncs.get(pathValue);
    if (!pendingHash || pendingHash !== hash) {
      return false;
    }

    this.pendingStudioSyncs.delete(pathValue);
    const record = this.records.get(pathValue);
    if (record) {
      record.studioHash = hash;
      record.pendingOutbound = null;
      record.pendingHash = null;
      record.conflictId = null;
      record.updatedAt = new Date().toISOString();
    }
    this.refreshDiagnostics();
    return true;
  }

  private consumePendingStudioRemoval(pathValue: string): boolean {
    if (!this.pendingStudioRemovals.has(pathValue)) {
      return false;
    }

    this.pendingStudioRemovals.delete(pathValue);
    this.refreshDiagnostics();
    return true;
  }

  private consumePendingStudioRename(oldPath: string, newPath: string): boolean {
    const pendingNewPath = this.pendingStudioRenames.get(oldPath);
    if (!pendingNewPath || pendingNewPath !== newPath) {
      return false;
    }

    this.pendingStudioRenames.delete(oldPath);
    this.refreshDiagnostics();
    return true;
  }

  private registerPendingDiskEcho(operation: SyncOperation): void {
    if (operation.type === "SYNC_INSTANCE") {
      this.pendingDiskSyncs.set(operation.path, operation.hash);
      return;
    }

    if (operation.type === "REMOVE_INSTANCE") {
      this.pendingDiskRemovals.add(operation.path);
      return;
    }

    this.pendingDiskRenames.set(operation.oldPath, operation.newPath);
  }

  private consumePendingDiskEcho(operation: SyncOperation): boolean {
    if (operation.type === "SYNC_INSTANCE") {
      const pendingHash = this.pendingDiskSyncs.get(operation.path);
      if (pendingHash && pendingHash === operation.hash) {
        this.pendingDiskSyncs.delete(operation.path);
        this.refreshDiagnostics();
        return true;
      }
      return false;
    }

    if (operation.type === "REMOVE_INSTANCE") {
      if (!this.pendingDiskRemovals.has(operation.path)) {
        return false;
      }
      this.pendingDiskRemovals.delete(operation.path);
      this.refreshDiagnostics();
      return true;
    }

    const pendingNewPath = this.pendingDiskRenames.get(operation.oldPath);
    if (!pendingNewPath || pendingNewPath !== operation.newPath) {
      return false;
    }

    this.pendingDiskRenames.delete(operation.oldPath);
    this.refreshDiagnostics();
    return true;
  }

  private resolveActivityOrigin(operation: SyncOperation, origin: SyncOrigin): SyncOrigin {
    if (origin !== "disk") {
      return origin;
    }

    this.pruneEditorActivityHints();
    const hintIndex = this.editorActivityHints.findIndex((hint) => this.matchesEditorActivityHint(hint, operation));
    if (hintIndex === -1) {
      return "disk";
    }

    this.editorActivityHints.splice(hintIndex, 1);
    return "editor";
  }

  private pruneEditorActivityHints(): void {
    const now = Date.now();
    this.editorActivityHints = this.editorActivityHints.filter((hint) => hint.expiresAt > now);
  }

  private matchesEditorActivityHint(hint: EditorActivityHint, operation: SyncOperation): boolean {
    if (hint.action === "rename" && operation.type === "RENAME_INSTANCE") {
      return hint.oldPath === operation.oldPath && hint.newPath === operation.newPath;
    }

    if (hint.action === "remove" && operation.type === "REMOVE_INSTANCE") {
      return hint.path === operation.path;
    }

    if ((hint.action === "add" || hint.action === "update") && operation.type === "SYNC_INSTANCE") {
      return hint.path === operation.path;
    }

    return false;
  }

  private registerConflict(
    pathValue: string,
    reason: string,
    local: ConflictOperationSnapshot | null,
    remote: ConflictOperationSnapshot | null,
  ): void {
    const conflict = createConflictRecord({
      path: pathValue,
      reason,
      local,
      remote,
    });

    this.conflicts.set(conflict.id, conflict);
    const record = this.records.get(pathValue);
    if (record) {
      record.conflictId = conflict.id;
      record.pendingOutbound = null;
      record.pendingHash = null;
      record.updatedAt = new Date().toISOString();
    }

    this.hooks.broadcastToClients("editor", {
      type: "CONFLICT",
      id: conflict.id,
      path: conflict.path,
      reason: conflict.reason,
      createdAt: conflict.createdAt,
      local: conflict.local,
      remote: conflict.remote,
      localHash: conflict.localHash,
      remoteHash: conflict.remoteHash,
    });
    this.refreshDiagnostics();
  }

  private clearConflict(id: string): void {
    const conflict = this.conflicts.get(id);
    if (!conflict) {
      return;
    }

    this.conflicts.delete(id);
    const record = this.records.get(conflict.path);
    if (record && record.conflictId === id) {
      record.conflictId = null;
      record.updatedAt = new Date().toISOString();
    }
    this.refreshDiagnostics();
  }

  private reindexRecords(): void {
    this.flattenedEntries = flattenProjectTree(this.currentTree);
    const nextRecords = new Map<string, SyncRecord>();
    const now = new Date().toISOString();

    for (const [entryPath, entry] of this.flattenedEntries) {
      const existingRecord = this.records.get(entryPath);
      nextRecords.set(entryPath, {
        path: entryPath,
        diskHash: entry.localHash,
        studioHash: existingRecord?.studioHash ?? null,
        lastOrigin: existingRecord?.lastOrigin ?? null,
        pendingOutbound: existingRecord?.pendingOutbound ?? null,
        pendingHash: existingRecord?.pendingHash ?? null,
        conflictId: existingRecord?.conflictId ?? null,
        updatedAt: now,
      });
    }

    this.records = nextRecords;
    this.refreshDiagnostics();
  }

  private refreshDiagnostics(): void {
    let syncedInstances = 0;
    let driftedInstances = 0;

    for (const record of this.records.values()) {
      if (record.conflictId) {
        driftedInstances += 1;
        continue;
      }

      if (record.pendingOutbound || (record.studioHash && record.studioHash !== record.diskHash)) {
        driftedInstances += 1;
        continue;
      }

      syncedInstances += 1;
    }

    this.diagnostics = {
      ...this.diagnostics,
      syncedInstances,
      driftedInstances,
      conflictCount: this.conflicts.size,
      pendingOutboundCount: this.pendingStudioSyncs.size + this.pendingStudioRemovals.size + this.pendingStudioRenames.size,
    };
  }
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
      diagnostics: {
        ...EMPTY_RUNTIME_STATE.diagnostics,
        ...(parsed.diagnostics ?? {}),
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
