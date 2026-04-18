import fs from "node:fs/promises";
import path from "node:path";
import * as TOML from "@iarna/toml";
import {
  DEFAULT_CONFIG,
  DEFAULT_SERVICES,
  type GitSection,
  type IgnoreSection,
  type NetworkSection,
  type ProjectSection,
  type PlacesSection,
  type ResolvedRoSyncConfig,
  type SyncSection,
  type TeamSection,
} from "./types.js";

type UnknownRecord = Record<string, unknown>;
export type ConfigDocument = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isConfigDocument(value: unknown): value is ConfigDocument {
  return isRecord(value);
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
}

function normalizeLoopbackHost(value: string): string {
  return value.trim().toLowerCase() === "localhost" ? "127.0.0.1" : value;
}

export function assertLoopbackHost(value: string): string {
  const normalized = normalizeLoopbackHost(value);
  if (normalized !== "127.0.0.1") {
    throw new Error(
      `RoSync only supports localhost hosts. Received "${value}". Set [sync].host to "127.0.0.1" or "localhost".`,
    );
  }
  return normalized;
}

function mergeDefined<T extends object>(base: T, overrides?: Partial<T>): T {
  const result = {
    ...base,
  } as T;

  for (const [key, value] of Object.entries((overrides ?? {}) as Record<string, unknown>)) {
    if (value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }

  return result;
}

function toProjectName(directoryName: string): string {
  const cleaned = directoryName.replace(/[-_]+/g, " ").trim();
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export async function findProjectRoot(startDir = process.cwd()): Promise<string | null> {
  let currentDir = path.resolve(startDir);

  while (true) {
    const configPath = path.join(currentDir, "rosync.toml");
    try {
      await fs.access(configPath);
      return currentDir;
    } catch {
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        return null;
      }
      currentDir = parentDir;
    }
  }
}

export interface LoadedConfigDocument {
  projectRoot: string;
  configPath: string;
  document: ConfigDocument;
}

export interface ConfigOverrides {
  project?: Partial<ProjectSection>;
  sync?: Partial<SyncSection>;
  network?: Partial<NetworkSection>;
  git?: Partial<GitSection>;
  places?: Partial<ResolvedRoSyncConfig["places"]>;
  team?: Partial<TeamSection>;
  ignore?: Partial<IgnoreSection>;
}

export function renderDefaultConfig(projectName: string, placeId?: number): string {
  const selectedPlaceId = Number.isFinite(placeId) ? String(placeId) : "0";

  return [
    "[project]",
    `name = "${projectName}"`,
    'version = "1.0.0"',
    `game_id = ${selectedPlaceId}`,
    "",
    "network = true",
    "",
    "[sync]",
    "port = 34872",
    'host = "127.0.0.1"',
    'src = "src"',
    "auto_schema_update = true",
    "debounce_ms = 150",
    "",
    "[git]",
    "enabled = true",
    "auto_commit = false",
    'auto_commit_message = "chore: rosync auto-sync [{timestamp}]"',
    'branch = "main"',
    "",
    "[places]",
    'default = "MainPlace"',
    "",
    "[places.MainPlace]",
    `place_id = ${selectedPlaceId}`,
    'src = "src"',
    "",
    "[team]",
    "enabled = false",
    'token = ""',
    'conflict_strategy = "prompt"',
    "",
    "[ignore]",
    'services = ["CoreGui", "CorePackages", "RobloxPluginGuiService"]',
    'classes = ["Sky", "Atmosphere"]',
    "",
  ].join("\n");
}

function resolvePlaces(rawPlaces: unknown): PlacesSection {
  const result: PlacesSection = {
    default: DEFAULT_CONFIG.places.default,
    entries: {
      MainPlace: {
        ...DEFAULT_CONFIG.places.entries.MainPlace,
      },
    },
  };

  if (!isRecord(rawPlaces)) {
    return result;
  }

  const defaultPlace = rawPlaces.default;
  if (typeof defaultPlace === "string" && defaultPlace.trim() !== "") {
    result.default = defaultPlace;
  }

  for (const [name, entry] of Object.entries(rawPlaces)) {
    if (name === "default" || !isRecord(entry)) {
      continue;
    }

    result.entries[name] = {
      placeId: readNumber(entry.place_id, 0),
      src: readString(entry.src, DEFAULT_CONFIG.sync.src),
    };
  }

  return result;
}

export async function loadConfigDocument(startDir = process.cwd()): Promise<LoadedConfigDocument> {
  const projectRoot = (await findProjectRoot(startDir)) ?? path.resolve(startDir);
  const configPath = path.join(projectRoot, "rosync.toml");
  const rawText = await fs.readFile(configPath, "utf8");
  const parsed = TOML.parse(rawText) as unknown;

  if (!isConfigDocument(parsed)) {
    throw new Error(`RoSync config at ${configPath} is not a TOML table.`);
  }

  return {
    projectRoot,
    configPath,
    document: parsed,
  };
}

export function ensureConfigSection(document: ConfigDocument, key: string): ConfigDocument {
  const current = document[key];
  if (isConfigDocument(current)) {
    return current;
  }

  const nextSection: ConfigDocument = {};
  document[key] = nextSection;
  return nextSection;
}

export async function writeConfigDocument(configPath: string, document: ConfigDocument): Promise<void> {
  await fs.writeFile(configPath, TOML.stringify(document as TOML.JsonMap), "utf8");
}

export async function loadConfig(startDir = process.cwd(), overrides?: ConfigOverrides): Promise<ResolvedRoSyncConfig> {
  const { projectRoot, configPath, document: parsed } = await loadConfigDocument(startDir);

  const rawProject = isRecord(parsed.project) ? parsed.project : {};
  const rawSync = isRecord(parsed.sync) ? parsed.sync : {};
  const rawGit = isRecord(parsed.git) ? parsed.git : {};
  const rawTeam = isRecord(parsed.team) ? parsed.team : {};
  const rawIgnore = isRecord(parsed.ignore) ? parsed.ignore : {};

  const resolved: ResolvedRoSyncConfig = {
    projectRoot,
    configPath,
    rosyncDir: path.join(projectRoot, ".rosync"),
    schemaPath: path.join(projectRoot, ".rosync", "schema.json"),
    runtimePath: path.join(projectRoot, ".rosync", "runtime.json"),
    ignorePath: path.join(projectRoot, ".rosyncignore"),
    srcDir: path.join(projectRoot, readString(rawSync.src, DEFAULT_CONFIG.sync.src)),
    project: {
      name: readString(rawProject.name, DEFAULT_CONFIG.project.name),
      version: readString(rawProject.version, DEFAULT_CONFIG.project.version),
      gameId: typeof rawProject.game_id === "number" ? rawProject.game_id : DEFAULT_CONFIG.project.gameId,
    },
    sync: {
      port: readNumber(rawSync.port, DEFAULT_CONFIG.sync.port),
      host: normalizeLoopbackHost(readString(rawSync.host, DEFAULT_CONFIG.sync.host)),
      src: readString(rawSync.src, DEFAULT_CONFIG.sync.src),
      autoSchemaUpdate: readBoolean(rawSync.auto_schema_update, DEFAULT_CONFIG.sync.autoSchemaUpdate),
      debounceMs: readNumber(rawSync.debounce_ms, DEFAULT_CONFIG.sync.debounceMs),
    },
    network: {
      enabled: readBoolean(parsed.network, readBoolean(rawSync.network, DEFAULT_CONFIG.network.enabled)),
    },
    git: {
      enabled: readBoolean(rawGit.enabled, DEFAULT_CONFIG.git.enabled),
      autoCommit: readBoolean(rawGit.auto_commit, DEFAULT_CONFIG.git.autoCommit),
      autoCommitMessage: readString(rawGit.auto_commit_message, DEFAULT_CONFIG.git.autoCommitMessage),
      branch: readString(rawGit.branch, DEFAULT_CONFIG.git.branch),
    },
    places: resolvePlaces(parsed.places),
    team: {
      enabled: readBoolean(rawTeam.enabled, DEFAULT_CONFIG.team.enabled),
      token: readString(rawTeam.token, DEFAULT_CONFIG.team.token),
      conflictStrategy:
        rawTeam.conflict_strategy === "ours" || rawTeam.conflict_strategy === "theirs" || rawTeam.conflict_strategy === "prompt"
          ? rawTeam.conflict_strategy
          : DEFAULT_CONFIG.team.conflictStrategy,
    },
    ignore: {
      services: readStringArray(rawIgnore.services, DEFAULT_CONFIG.ignore.services),
      classes: readStringArray(rawIgnore.classes, DEFAULT_CONFIG.ignore.classes),
    },
  };

  const mergedSync = mergeDefined(resolved.sync, overrides?.sync);

  const merged: ResolvedRoSyncConfig = {
    ...resolved,
    project: mergeDefined(resolved.project, overrides?.project),
    sync: {
      ...mergedSync,
      host: assertLoopbackHost(mergedSync.host),
    },
    network: mergeDefined(resolved.network, overrides?.network),
    git: mergeDefined(resolved.git, overrides?.git),
    places: {
      ...mergeDefined(resolved.places, overrides?.places),
      entries: {
        ...resolved.places.entries,
        ...(overrides?.places?.entries ?? {}),
      },
    },
    team: mergeDefined(resolved.team, overrides?.team),
    ignore: mergeDefined(resolved.ignore, overrides?.ignore),
  };

  return {
    ...merged,
    srcDir: path.join(projectRoot, merged.sync.src),
  };
}

export async function ensureProjectDirectories(config: ResolvedRoSyncConfig): Promise<void> {
  await fs.mkdir(config.rosyncDir, { recursive: true });
  await fs.mkdir(config.srcDir, { recursive: true });
}

export function defaultServiceSkeletons(): string[] {
  return [...DEFAULT_SERVICES];
}

export function defaultProjectNameForDirectory(directoryPath: string): string {
  return toProjectName(path.basename(path.resolve(directoryPath))) || "MyRobloxGame";
}
