import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type InstallSourceMode = "linked" | "managed";

export interface InstallMetadata {
  version: 1;
  installedAt: string;
  updatedAt: string;
  platform: NodeJS.Platform;
  sourceDir: string;
  sourceMode: InstallSourceMode;
  metaDir: string;
  cliEntry: string;
  cliLaunchers: string[];
  pluginSource: string;
  pluginInstallPath: string | null;
  installScript: string;
  uninstallScript: string;
  extensionId: string;
}

const INSTALL_METADATA_FILENAME = "install.json";
const INSTALL_PATH_FILENAME = "install-path";
const DEFAULT_EXTENSION_ID = "rosync.rosync-extension";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripUtf8Bom(rawText: string): string {
  return rawText.replace(/^\uFEFF/, "");
}

function localAppDataDir(): string {
  return process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
}

function pluginInstallPathForPlatform(platform: NodeJS.Platform): string | null {
  if (platform === "win32") {
    return path.join(localAppDataDir(), "Roblox", "Plugins", "RoSync.plugin.lua");
  }

  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Roblox", "Plugins", "RoSync.plugin.lua");
  }

  if (platform === "linux") {
    return path.join(os.homedir(), ".local", "share", "Roblox", "Plugins", "RoSync.plugin.lua");
  }

  return null;
}

function cliLaunchersForPlatform(platform: NodeJS.Platform): string[] {
  if (platform === "win32") {
    const shimDir = path.join(localAppDataDir(), "RoSync", "bin");
    return [path.join(shimDir, "rosync.cmd"), path.join(shimDir, "rosync.ps1")];
  }

  return [path.join(os.homedir(), ".local", "bin", "rosync")];
}

function installScriptForPlatform(sourceDir: string, platform: NodeJS.Platform): string {
  if (platform === "win32") {
    return path.join(sourceDir, "install", "windows", "install.ps1");
  }

  if (platform === "darwin") {
    return path.join(sourceDir, "install", "Mac", "install.sh");
  }

  return path.join(sourceDir, "install", "linux", "install.sh");
}

function uninstallScriptForPlatform(sourceDir: string, platform: NodeJS.Platform): string {
  if (platform === "win32") {
    return path.join(sourceDir, "install", "windows", "uninstall.ps1");
  }

  if (platform === "darwin") {
    return path.join(sourceDir, "install", "Mac", "uninstall.sh");
  }

  return path.join(sourceDir, "install", "linux", "uninstall.sh");
}

export function getDefaultMetaDir(platform = process.platform): string {
  if (platform === "win32") {
    return path.join(localAppDataDir(), "RoSync", "meta");
  }

  return path.join(os.homedir(), ".rosync-meta");
}

export function getInstallMetadataPath(metaDir = getDefaultMetaDir()): string {
  return path.join(metaDir, INSTALL_METADATA_FILENAME);
}

export function getInstallPathFilePath(metaDir = getDefaultMetaDir()): string {
  return path.join(metaDir, INSTALL_PATH_FILENAME);
}

export function getSourceDirFromRuntime(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

export function buildInstallMetadata(
  sourceDir: string,
  overrides: Partial<Omit<InstallMetadata, "version" | "sourceDir">> = {},
): InstallMetadata {
  const platform = overrides.platform ?? process.platform;
  const metaDir = overrides.metaDir ?? getDefaultMetaDir(platform);
  const installedAt = overrides.installedAt ?? new Date().toISOString();
  const updatedAt = overrides.updatedAt ?? installedAt;

  return {
    version: 1,
    installedAt,
    updatedAt,
    platform,
    sourceDir,
    sourceMode: overrides.sourceMode ?? "linked",
    metaDir,
    cliEntry: overrides.cliEntry ?? path.join(sourceDir, "daemon", "dist", "main.js"),
    cliLaunchers: overrides.cliLaunchers ?? cliLaunchersForPlatform(platform),
    pluginSource: overrides.pluginSource ?? path.join(sourceDir, "plugin", "RoSync.plugin.luau"),
    pluginInstallPath: overrides.pluginInstallPath ?? pluginInstallPathForPlatform(platform),
    installScript: overrides.installScript ?? installScriptForPlatform(sourceDir, platform),
    uninstallScript: overrides.uninstallScript ?? uninstallScriptForPlatform(sourceDir, platform),
    extensionId: overrides.extensionId ?? DEFAULT_EXTENSION_ID,
  };
}

function normalizeMetadata(raw: UnknownRecord, metaDir: string): InstallMetadata | null {
  const sourceDir = typeof raw.sourceDir === "string" && raw.sourceDir.trim() !== "" ? raw.sourceDir : null;
  if (!sourceDir) {
    return null;
  }

  const cliLaunchers = Array.isArray(raw.cliLaunchers)
    ? raw.cliLaunchers.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
    : undefined;

  return buildInstallMetadata(sourceDir, {
    installedAt: typeof raw.installedAt === "string" && raw.installedAt.trim() !== "" ? raw.installedAt : undefined,
    updatedAt: typeof raw.updatedAt === "string" && raw.updatedAt.trim() !== "" ? raw.updatedAt : undefined,
    platform: typeof raw.platform === "string" ? (raw.platform as NodeJS.Platform) : undefined,
    sourceMode: raw.sourceMode === "managed" ? "managed" : "linked",
    metaDir,
    cliEntry: typeof raw.cliEntry === "string" && raw.cliEntry.trim() !== "" ? raw.cliEntry : undefined,
    cliLaunchers,
    pluginSource: typeof raw.pluginSource === "string" && raw.pluginSource.trim() !== "" ? raw.pluginSource : undefined,
    pluginInstallPath: typeof raw.pluginInstallPath === "string" ? raw.pluginInstallPath : null,
    installScript: typeof raw.installScript === "string" && raw.installScript.trim() !== "" ? raw.installScript : undefined,
    uninstallScript:
      typeof raw.uninstallScript === "string" && raw.uninstallScript.trim() !== "" ? raw.uninstallScript : undefined,
    extensionId: typeof raw.extensionId === "string" && raw.extensionId.trim() !== "" ? raw.extensionId : undefined,
  });
}

export async function readInstallMetadata(metaDir = getDefaultMetaDir()): Promise<InstallMetadata | null> {
  try {
    const rawText = await fs.readFile(getInstallMetadataPath(metaDir), "utf8");
    const parsed = JSON.parse(stripUtf8Bom(rawText)) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }
    return normalizeMetadata(parsed, metaDir);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }

  try {
    const sourceDir = (await fs.readFile(getInstallPathFilePath(metaDir), "utf8")).trim();
    if (!sourceDir) {
      return null;
    }
    return buildInstallMetadata(sourceDir, { metaDir });
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function resolveInstallMetadata(metaDir = getDefaultMetaDir()): Promise<InstallMetadata> {
  return (await readInstallMetadata(metaDir)) ?? buildInstallMetadata(getSourceDirFromRuntime(), { metaDir });
}

export async function writeInstallMetadata(metadata: InstallMetadata): Promise<void> {
  await fs.mkdir(metadata.metaDir, { recursive: true });
  await fs.writeFile(getInstallPathFilePath(metadata.metaDir), `${metadata.sourceDir}\n`, "utf8");
  await fs.writeFile(getInstallMetadataPath(metadata.metaDir), JSON.stringify(metadata, null, 2) + "\n", "utf8");
}

export async function touchInstallMetadata(metaDir = getDefaultMetaDir()): Promise<InstallMetadata | null> {
  const metadata = await readInstallMetadata(metaDir);
  if (!metadata) {
    return null;
  }

  const nextMetadata: InstallMetadata = {
    ...metadata,
    updatedAt: new Date().toISOString(),
  };
  await writeInstallMetadata(nextMetadata);
  return nextMetadata;
}

export async function removeInstallMetadata(metaDir = getDefaultMetaDir()): Promise<void> {
  await fs.rm(getInstallMetadataPath(metaDir), { force: true });
  await fs.rm(getInstallPathFilePath(metaDir), { force: true });
  await fs.rmdir(metaDir).catch(() => undefined);
}
