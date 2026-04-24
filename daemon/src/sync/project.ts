import fs from "node:fs/promises";
import path from "node:path";
import type { ProjectTreeNode, ProjectTreeSnapshot, ResolvedRoSyncConfig, RuntimeStatusSummary, SerializableNode } from "../config/types.js";
import type { RoSyncIgnoreRules } from "../config/ignore.js";
import { shouldIgnoreClass, shouldIgnorePath } from "../config/ignore.js";
import { DEFAULT_SERVICES } from "../config/types.js";
import { readInstanceMetadata, type InstanceMetadata } from "../serializer/instance.js";

const INSTANCE_FILE = ".instance.json";
const ALLOWED_ROOT_SERVICES = new Set(DEFAULT_SERVICES);
const SCRIPT_FILE_BY_CLASS: Record<string, { fileName: string; kind: "server" | "client" | "module" }> = {
  Script: { fileName: "init.server.luau", kind: "server" },
  LocalScript: { fileName: "init.client.luau", kind: "client" },
  ModuleScript: { fileName: "init.luau", kind: "module" },
};

function normalizeProjectPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function pathTail(nodePath: string): string {
  const normalizedPath = normalizeProjectPath(nodePath);
  const segments = normalizedPath.split("/");
  return segments[segments.length - 1] ?? normalizedPath;
}

function parsePathSegment(segment: string): { name: string; ordinal: number | null } {
  const legacyMatch = /^(.*)\.__rosync_(\d+)$/.exec(segment);
  if (legacyMatch) {
    const ordinal = Number.parseInt(legacyMatch[2] ?? "", 10);
    return {
      name: legacyMatch[1] ?? segment,
      ordinal: Number.isFinite(ordinal) && ordinal >= 1 ? ordinal : null,
    };
  }

  const match = /^(.*)_(\d+)$/.exec(segment);
  if (!match) {
    return {
      name: segment,
      ordinal: null,
    };
  }

  const ordinal = Number.parseInt(match[2] ?? "", 10);
  return {
    name: match[1] ?? segment,
    ordinal: Number.isFinite(ordinal) && ordinal >= 2 ? ordinal : null,
  };
}

function encodePathSegment(name: string, ordinal: number, total: number): string {
  if (total > 1 && ordinal > 1) {
    return `${name}_${ordinal}`;
  }
  return name;
}

function inferNodeName(segment: string, metadata: InstanceMetadata | null): string {
  if (typeof metadata?.name === "string" && metadata.name.trim() !== "") {
    return metadata.name;
  }

  return parsePathSegment(segment).name;
}

function resolveChildPathSegments(children: SerializableNode[]): Array<SerializableNode & { _pathSegment: string; name: string }> {
  const totals = new Map<string, number>();
  const seen = new Map<string, number>();

  for (const child of children) {
    const childName = (child.name ?? "Instance").trim() || "Instance";
    totals.set(childName, (totals.get(childName) ?? 0) + 1);
  }

  return children.map((child) => {
    const childName = (child.name ?? "Instance").trim() || "Instance";
    const currentOrdinal = (seen.get(childName) ?? 0) + 1;
    seen.set(childName, currentOrdinal);

    return {
      ...child,
      name: childName,
      _pathSegment: child._pathSegment ?? encodePathSegment(childName, currentOrdinal, totals.get(childName) ?? 1),
    };
  });
}

function sortNodes(nodes: ProjectTreeNode[]): ProjectTreeNode[] {
  return [...nodes].sort((left, right) => {
    const leftContainer = left.children.length > 0 ? 0 : 1;
    const rightContainer = right.children.length > 0 ? 0 : 1;
    if (leftContainer !== rightContainer) {
      return leftContainer - rightContainer;
    }

    const classCompare = left.className.localeCompare(right.className);
    if (classCompare !== 0) {
      return classCompare;
    }

    return left.name.localeCompare(right.name);
  });
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function orderRecordKeys(record: Record<string, unknown>, preferredOrder?: string[]): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  const seenKeys = new Set<string>();

  for (const key of preferredOrder ?? []) {
    if (!Object.prototype.hasOwnProperty.call(record, key) || seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    ordered[key] = record[key];
  }

  const remainingKeys = Object.keys(record)
    .filter((key) => !seenKeys.has(key))
    .sort((left, right) => left.localeCompare(right));
  for (const key of remainingKeys) {
    ordered[key] = record[key];
  }

  return ordered;
}

function writeInstanceJson(metadata: InstanceMetadata, propertyOrder?: string[]): string {
  const ordered: Record<string, unknown> = {
    name: metadata.name,
    className: metadata.className,
    properties: orderRecordKeys(metadata.properties ?? {}, propertyOrder),
    attributes: orderRecordKeys(metadata.attributes ?? {}),
    tags: [...(metadata.tags ?? [])],
    children: [...(metadata.children ?? [])],
  };

  return JSON.stringify(ordered, null, 2) + "\n";
}

async function writeInstanceMetadataFile(
  filePath: string,
  metadata: InstanceMetadata,
  propertyOrder?: string[],
): Promise<void> {
  await fs.writeFile(filePath, writeInstanceJson(metadata, propertyOrder), "utf8");
}

function scriptDescriptorForClass(className: string): { fileName: string; kind: "server" | "client" | "module" } | null {
  return SCRIPT_FILE_BY_CLASS[className] ?? null;
}

async function detectSourceFile(directoryPath: string, className: string): Promise<{ sourceFilePath: string | null; scriptKind: ProjectTreeNode["scriptKind"] }> {
  const descriptor = scriptDescriptorForClass(className);
  if (!descriptor) {
    return {
      sourceFilePath: null,
      scriptKind: null,
    };
  }

  const scriptPath = path.join(directoryPath, descriptor.fileName);
  return {
    sourceFilePath: (await exists(scriptPath)) ? scriptPath : null,
    scriptKind: descriptor.kind,
  };
}

async function readSourceFile(sourceFilePath: string | null): Promise<string | null> {
  if (!sourceFilePath) {
    return null;
  }

  try {
    return await fs.readFile(sourceFilePath, "utf8");
  } catch {
    return null;
  }
}

function toRelativePath(config: ResolvedRoSyncConfig, targetPath: string): string {
  return path.relative(config.projectRoot, targetPath).replace(/\\/g, "/");
}

async function readDirectoryNode(
  config: ResolvedRoSyncConfig,
  ignoreRules: RoSyncIgnoreRules,
  directoryPath: string,
  parentPath: string,
  counters: { ignoredEntries: number },
): Promise<ProjectTreeNode | null> {
  const relativeDirectoryPath = toRelativePath(config, directoryPath);
  if (relativeDirectoryPath && shouldIgnorePath(ignoreRules, relativeDirectoryPath)) {
    counters.ignoredEntries += 1;
    return null;
  }

  const metadataPath = path.join(directoryPath, INSTANCE_FILE);
  if (!(await exists(metadataPath))) {
    return null;
  }

  const metadata = await readInstanceMetadata(metadataPath);
  const directorySegment = path.basename(directoryPath);
  const name = inferNodeName(directorySegment, metadata);
  if (!parentPath && !ALLOWED_ROOT_SERVICES.has(name)) {
    counters.ignoredEntries += 1;
    return null;
  }
  const className = metadata?.className ?? name;

  if (shouldIgnoreClass(ignoreRules, className)) {
    counters.ignoredEntries += 1;
    return null;
  }

  const nodePath = parentPath ? `${parentPath}/${directorySegment}` : directorySegment;
  const children: ProjectTreeNode[] = [];

  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const childNode = await readDirectoryNode(
      config,
      ignoreRules,
      path.join(directoryPath, entry.name),
      nodePath,
      counters,
    );
    if (childNode) {
      children.push(childNode);
    }
  }

  const { sourceFilePath, scriptKind } = await detectSourceFile(directoryPath, className);
  const source = await readSourceFile(sourceFilePath);

  return {
    name,
    className,
    path: nodePath,
    relativePath: normalizeProjectPath(relativeDirectoryPath),
    directoryPath,
    metadataPath,
    sourceFilePath,
    scriptKind,
    properties: { ...(metadata?.properties ?? {}) },
    attributes: { ...(metadata?.attributes ?? {}) },
    tags: [...(metadata?.tags ?? [])],
    source,
    children: sortNodes(children),
  };
}

function serviceOrderValue(serviceName: string): number {
  const index = DEFAULT_SERVICES.indexOf(serviceName);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export async function buildProjectTree(config: ResolvedRoSyncConfig, ignoreRules: RoSyncIgnoreRules): Promise<ProjectTreeSnapshot> {
  const counters = {
    ignoredEntries: 0,
  };
  const services: ProjectTreeNode[] = [];

  try {
    const entries = await fs.readdir(config.srcDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const node = await readDirectoryNode(
        config,
        ignoreRules,
        path.join(config.srcDir, entry.name),
        "",
        counters,
      );
      if (node) {
        services.push(node);
      }
    }
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }

  services.sort((left, right) => {
    const orderDifference = serviceOrderValue(left.name) - serviceOrderValue(right.name);
    if (orderDifference !== 0) {
      return orderDifference;
    }
    return left.name.localeCompare(right.name);
  });

  return {
    generatedAt: new Date().toISOString(),
    projectRoot: config.projectRoot,
    srcDir: config.srcDir,
    ignoredEntries: counters.ignoredEntries,
    services,
  };
}

export function summarizeProjectTree(tree: ProjectTreeSnapshot): RuntimeStatusSummary {
  const classCounts: Record<string, number> = {};
  let indexedInstances = 0;
  let scriptFiles = 0;

  function visit(node: ProjectTreeNode): void {
    indexedInstances += 1;
    classCounts[node.className] = (classCounts[node.className] ?? 0) + 1;
    if (node.sourceFilePath) {
      scriptFiles += 1;
    }
    for (const child of node.children) {
      visit(child);
    }
  }

  for (const service of tree.services) {
    visit(service);
  }

  return {
    indexedInstances,
    scriptFiles,
    ignoredEntries: tree.ignoredEntries,
    classCounts,
    lastScanAt: tree.generatedAt,
  };
}

export function findNodeByPath(tree: ProjectTreeSnapshot, nodePath: string): ProjectTreeNode | null {
  const normalizedPath = normalizeProjectPath(nodePath);

  function visit(nodes: ProjectTreeNode[]): ProjectTreeNode | null {
    for (const node of nodes) {
      if (node.path === normalizedPath) {
        return node;
      }
      const childResult = visit(node.children);
      if (childResult) {
        return childResult;
      }
    }
    return null;
  }

  return visit(tree.services);
}

function assertWithinSource(config: ResolvedRoSyncConfig, targetPath: string): void {
  const resolvedPath = path.resolve(targetPath);
  const resolvedSrcDir = path.resolve(config.srcDir);
  if (resolvedPath !== resolvedSrcDir && !resolvedPath.startsWith(`${resolvedSrcDir}${path.sep}`)) {
    throw new Error(`Path ${resolvedPath} is outside ${resolvedSrcDir}`);
  }
}

export function resolveNodePath(config: ResolvedRoSyncConfig, nodePath: string): string {
  const normalizedPath = normalizeProjectPath(nodePath);
  if (!normalizedPath) {
    throw new Error("Instance path is required.");
  }

  const targetPath = path.resolve(config.srcDir, ...normalizedPath.split("/"));
  assertWithinSource(config, targetPath);
  return targetPath;
}

function buildInstanceMetadata(payload: SerializableNode): InstanceMetadata {
  return {
    name: payload.name,
    className: payload.className,
    properties: payload.properties ?? {},
    attributes: payload.attributes ?? {},
    tags: payload.tags ?? [],
    children: (payload.children ?? []).map((child) => child.name ?? "Instance"),
  };
}

async function removeKnownScriptFiles(targetDirectory: string): Promise<void> {
  for (const descriptor of Object.values(SCRIPT_FILE_BY_CLASS)) {
    const candidatePath = path.join(targetDirectory, descriptor.fileName);
    if (await exists(candidatePath)) {
      await fs.rm(candidatePath, { force: true });
    }
  }
}

async function writeNodeDirectory(targetDirectory: string, payload: SerializableNode, fallbackName: string): Promise<void> {
  const targetSegment = path.basename(targetDirectory);
  const resolvedName = payload.name ?? parsePathSegment(targetSegment).name ?? fallbackName;
  const metadata = buildInstanceMetadata({
    ...payload,
    name: resolvedName,
  });
  const descriptor = scriptDescriptorForClass(payload.className);

  await fs.mkdir(targetDirectory, { recursive: true });
  await writeInstanceMetadataFile(path.join(targetDirectory, INSTANCE_FILE), metadata, payload._propertyOrder);

  await removeKnownScriptFiles(targetDirectory);
  if (descriptor) {
    await fs.writeFile(path.join(targetDirectory, descriptor.fileName), `${payload.source ?? ""}`, "utf8");
  }

  const existingChildren = await fs.readdir(targetDirectory, { withFileTypes: true });
  for (const entry of existingChildren) {
    if (!entry.isDirectory()) {
      continue;
    }
    await fs.rm(path.join(targetDirectory, entry.name), { recursive: true, force: true });
  }

  for (const child of resolveChildPathSegments(payload.children ?? [])) {
    await writeNodeDirectory(path.join(targetDirectory, child._pathSegment), child, child.name);
  }
}

export async function writeInstanceToDisk(config: ResolvedRoSyncConfig, nodePath: string, payload: SerializableNode): Promise<void> {
  const targetDirectory = resolveNodePath(config, nodePath);
  const targetSegment = pathTail(nodePath);
  const targetName = parsePathSegment(targetSegment).name;
  const normalizedPayload = { ...payload, name: payload.name ?? targetName };
  const metadataPath = path.join(targetDirectory, INSTANCE_FILE);
  const existingMetadata = await readInstanceMetadata(metadataPath);
  const nextChildren =
    payload.children && payload.children.length > 0
      ? payload.children.map((child) => child.name ?? "Instance")
      : existingMetadata?.children ?? [];
  const metadata: InstanceMetadata = {
    name: normalizedPayload.name,
    className: normalizedPayload.className,
    properties: normalizedPayload.properties ?? {},
    attributes: normalizedPayload.attributes ?? {},
    tags: normalizedPayload.tags ?? [],
    children: nextChildren,
  };
  const descriptor = scriptDescriptorForClass(normalizedPayload.className);

  await fs.mkdir(targetDirectory, { recursive: true });
  await writeInstanceMetadataFile(metadataPath, metadata, normalizedPayload._propertyOrder);

  if (descriptor && normalizedPayload.source !== undefined) {
    await fs.writeFile(path.join(targetDirectory, descriptor.fileName), normalizedPayload.source, "utf8");
  }

  for (const child of resolveChildPathSegments(normalizedPayload.children ?? [])) {
    await writeInstanceToDisk(config, `${nodePath}/${child._pathSegment}`, { ...child, name: child.name });
  }
}

export async function upsertNodeFromPayload(config: ResolvedRoSyncConfig, nodePath: string, payload: SerializableNode): Promise<void> {
  const targetDirectory = resolveNodePath(config, nodePath);
  const targetName = parsePathSegment(path.basename(targetDirectory)).name;
  await fs.rm(targetDirectory, { recursive: true, force: true });
  await writeNodeDirectory(targetDirectory, { ...payload, name: payload.name ?? targetName }, targetName);
}

export async function createNode(
  config: ResolvedRoSyncConfig,
  parentPath: string,
  name: string,
  className: string,
): Promise<void> {
  const normalizedName = name.trim();
  if (!normalizedName) {
    throw new Error("Instance name is required.");
  }

  const parentDirectory = resolveNodePath(config, parentPath);
  const targetDirectory = path.join(parentDirectory, normalizedName);
  assertWithinSource(config, targetDirectory);

  if (await exists(targetDirectory)) {
    throw new Error(`Instance ${normalizedName} already exists under ${parentPath}.`);
  }

  await writeNodeDirectory(
    targetDirectory,
    {
      name: normalizedName,
      className,
      properties: {},
      attributes: {},
      tags: [],
      children: [],
    },
    normalizedName,
  );
}

export async function updateNode(
  config: ResolvedRoSyncConfig,
  nodePath: string,
  patch: Partial<Pick<SerializableNode, "properties" | "attributes" | "tags" | "source">>,
): Promise<void> {
  const targetDirectory = resolveNodePath(config, nodePath);
  const metadataPath = path.join(targetDirectory, INSTANCE_FILE);
  const metadata = (await readInstanceMetadata(metadataPath)) ?? {
    name: parsePathSegment(path.basename(targetDirectory)).name,
    className: path.basename(targetDirectory),
    properties: {},
    attributes: {},
    tags: [],
    children: [],
  };

  const nextMetadata: InstanceMetadata = {
    name: metadata.name ?? parsePathSegment(path.basename(targetDirectory)).name,
    className: metadata.className,
    properties: patch.properties ?? metadata.properties ?? {},
    attributes: patch.attributes ?? metadata.attributes ?? {},
    tags: patch.tags ?? metadata.tags ?? [],
    children: metadata.children ?? [],
  };

  await writeInstanceMetadataFile(metadataPath, nextMetadata);

  const descriptor = scriptDescriptorForClass(nextMetadata.className);
  if (descriptor && patch.source !== undefined) {
    await fs.writeFile(path.join(targetDirectory, descriptor.fileName), patch.source, "utf8");
  }
}

export async function moveNode(config: ResolvedRoSyncConfig, oldPath: string, newPath: string): Promise<void> {
  const currentDirectory = resolveNodePath(config, oldPath);
  const nextDirectory = resolveNodePath(config, newPath);
  assertWithinSource(config, nextDirectory);

  await fs.mkdir(path.dirname(nextDirectory), { recursive: true });
  await fs.rename(currentDirectory, nextDirectory);
}

export async function renameNode(config: ResolvedRoSyncConfig, nodePath: string, newName: string): Promise<void> {
  const normalizedName = newName.trim();
  if (!normalizedName) {
    throw new Error("New instance name is required.");
  }

  const currentDirectory = resolveNodePath(config, nodePath);
  const nextDirectory = path.join(path.dirname(currentDirectory), normalizedName);
  assertWithinSource(config, nextDirectory);
  await fs.rename(currentDirectory, nextDirectory);
}

export async function deleteNode(config: ResolvedRoSyncConfig, nodePath: string): Promise<void> {
  const targetDirectory = resolveNodePath(config, nodePath);
  await fs.rm(targetDirectory, { recursive: true, force: true });
}
