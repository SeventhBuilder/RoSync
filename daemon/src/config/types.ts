export interface ProjectSection {
  name: string;
  version: string;
  gameId: number | null;
}

export interface SyncSection {
  port: number;
  host: string;
  src: string;
  autoSchemaUpdate: boolean;
  debounceMs: number;
}

export interface NetworkSection {
  enabled: boolean;
}

export interface GitSection {
  enabled: boolean;
  autoCommit: boolean;
  autoCommitMessage: string;
  branch: string;
}

export interface PlaceConfig {
  placeId: number;
  src: string;
}

export interface PlacesSection {
  default?: string;
  entries: Record<string, PlaceConfig>;
}

export interface TeamSection {
  enabled: boolean;
  token: string;
  conflictStrategy: "prompt" | "ours" | "theirs";
}

export interface IgnoreSection {
  services: string[];
  classes: string[];
}

export interface RoSyncConfig {
  project: ProjectSection;
  sync: SyncSection;
  network: NetworkSection;
  git: GitSection;
  places: PlacesSection;
  team: TeamSection;
  ignore: IgnoreSection;
}

export interface ResolvedRoSyncConfig extends RoSyncConfig {
  projectRoot: string;
  configPath: string;
  srcDir: string;
  rosyncDir: string;
  schemaPath: string;
  runtimePath: string;
  ignorePath: string;
}

export interface RuntimeConnections {
  studio: number;
  editor: number;
  unknown: number;
}

export interface RuntimeStatusSummary {
  indexedInstances: number;
  scriptFiles: number;
  ignoredEntries: number;
  classCounts: Record<string, number>;
  lastScanAt: string;
}

export interface RuntimeDiagnostics {
  syncedInstances: number;
  driftedInstances: number;
  conflictCount: number;
  pendingOutboundCount: number;
  lastFileEventAt: string | null;
  lastFileEventPath: string | null;
  lastStudioEventAt: string | null;
  lastStudioEventPath: string | null;
  lastEditorEventAt: string | null;
  lastEditorEventPath: string | null;
}

export interface ProjectTreeNode {
  name: string;
  className: string;
  path: string;
  relativePath: string;
  directoryPath: string;
  metadataPath: string;
  sourceFilePath: string | null;
  scriptKind: "server" | "client" | "module" | null;
  properties: Record<string, unknown>;
  attributes: Record<string, unknown>;
  tags: string[];
  source: string | null;
  children: ProjectTreeNode[];
}

export interface ProjectTreeSnapshot {
  generatedAt: string;
  projectRoot: string;
  srcDir: string;
  ignoredEntries: number;
  services: ProjectTreeNode[];
}

export interface SerializableNode {
  name?: string;
  className: string;
  properties?: Record<string, unknown>;
  _propertyOrder?: string[];
  attributes?: Record<string, unknown>;
  tags?: string[];
  source?: string;
  children?: SerializableNode[];
}

export interface RuntimeState {
  running: boolean;
  host: string;
  port: number;
  startedAt: string | null;
  updatedAt: string;
  schemaVersion: string | null;
  schemaFetchedAt: string | null;
  connections: RuntimeConnections;
  summary: RuntimeStatusSummary;
  diagnostics: RuntimeDiagnostics;
}

export const DEFAULT_SERVICES = [
  "Workspace",
  "Players",
  "ReplicatedFirst",
  "ReplicatedStorage",
  "ServerScriptService",
  "ServerStorage",
  "StarterGui",
  "StarterPack",
  "StarterPlayer",
  "Teams",
  "Lighting",
  "SoundService",
];

export const DEFAULT_CONFIG: RoSyncConfig = {
  project: {
    name: "MyRobloxGame",
    version: "1.0.0",
    gameId: null,
  },
  sync: {
    port: 34872,
    host: "127.0.0.1",
    src: "src",
    autoSchemaUpdate: true,
    debounceMs: 150,
  },
  network: {
    enabled: true,
  },
  git: {
    enabled: true,
    autoCommit: false,
    autoCommitMessage: "chore: rosync auto-sync [{timestamp}]",
    branch: "main",
  },
  places: {
    default: "MainPlace",
    entries: {
      MainPlace: {
        placeId: 0,
        src: "src",
      },
    },
  },
  team: {
    enabled: false,
    token: "",
    conflictStrategy: "prompt",
  },
  ignore: {
    services: ["CoreGui", "CorePackages", "RobloxPluginGuiService"],
    classes: ["Sky", "Atmosphere"],
  },
};

export const EMPTY_RUNTIME_SUMMARY: RuntimeStatusSummary = {
  indexedInstances: 0,
  scriptFiles: 0,
  ignoredEntries: 0,
  classCounts: {},
  lastScanAt: new Date(0).toISOString(),
};

export const EMPTY_RUNTIME_DIAGNOSTICS: RuntimeDiagnostics = {
  syncedInstances: 0,
  driftedInstances: 0,
  conflictCount: 0,
  pendingOutboundCount: 0,
  lastFileEventAt: null,
  lastFileEventPath: null,
  lastStudioEventAt: null,
  lastStudioEventPath: null,
  lastEditorEventAt: null,
  lastEditorEventPath: null,
};

export const EMPTY_RUNTIME_STATE: RuntimeState = {
  running: false,
  host: DEFAULT_CONFIG.sync.host,
  port: DEFAULT_CONFIG.sync.port,
  startedAt: null,
  updatedAt: new Date(0).toISOString(),
  schemaVersion: null,
  schemaFetchedAt: null,
  connections: {
    studio: 0,
    editor: 0,
    unknown: 0,
  },
  summary: EMPTY_RUNTIME_SUMMARY,
  diagnostics: EMPTY_RUNTIME_DIAGNOSTICS,
};
