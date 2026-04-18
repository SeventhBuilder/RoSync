import * as vscode from "vscode";
import WebSocket from "ws";
import { loadDaemonEndpoint, type DaemonEndpoint } from "../config/ConfigLoader.js";

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

export interface DaemonConflict {
  id: string;
  path: string;
  reason: string;
  createdAt: string;
  localHash: string | null;
  remoteHash: string | null;
}

export interface DaemonDiagnostics {
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

export interface DaemonHealth {
  ok: boolean;
  project: string;
  host: string;
  port: number;
  summary: {
    indexedInstances: number;
    scriptFiles: number;
    ignoredEntries: number;
  };
  diagnostics: DaemonDiagnostics;
  conflicts: DaemonConflict[];
  connections: {
    studio: number;
    editor: number;
    unknown: number;
  };
  schema: {
    source: string;
    fetchedAt: string;
    version: string | null;
  };
}

interface TreeResponse {
  ok: boolean;
  tree: ProjectTreeSnapshot;
}

interface NodeResponse {
  ok: boolean;
  node: ProjectTreeNode;
}

interface HealthResponse extends DaemonHealth {}

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";

export type DaemonEvent =
  | { type: "WELCOME"; schemaVersion: string | null }
  | { type: "SYNC_INSTANCE"; path: string; data: Record<string, unknown> }
  | { type: "REMOVE_INSTANCE"; path: string }
  | { type: "RENAME_INSTANCE"; oldPath: string; newPath: string }
  | { type: "CONFLICT"; conflict: DaemonConflict & { local?: unknown; remote?: unknown } }
  | { type: "ERROR"; code: string | null; message: string }
  | { type: "CONNECTION_STATE"; state: ConnectionState; endpoint: DaemonEndpoint | null };

async function requestJson<T>(endpoint: DaemonEndpoint, pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`http://${endpoint.host}:${endpoint.port}${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(2_500),
  });

  const payload = (await response.json()) as T & { error?: string; ok?: boolean };
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed with HTTP ${response.status}`);
  }

  return payload;
}

export class DaemonClient implements vscode.Disposable {
  private readonly onDidReceiveEventEmitter = new vscode.EventEmitter<DaemonEvent>();
  public readonly onDidReceiveEvent = this.onDidReceiveEventEmitter.event;
  private socket: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelayMs = 1_000;
  private disposed = false;
  private currentState: ConnectionState = "disconnected";
  private currentEndpoint: DaemonEndpoint | null = null;

  public async getEndpoint(): Promise<DaemonEndpoint> {
    const endpoint = await loadDaemonEndpoint();
    this.currentEndpoint = endpoint;
    return endpoint;
  }

  public get connectionState(): ConnectionState {
    return this.currentState;
  }

  public async start(): Promise<void> {
    await this.connect("connecting");
  }

  public dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.close();
      this.socket = null;
    }
    this.updateConnectionState("disconnected");
    this.onDidReceiveEventEmitter.dispose();
  }

  public async health(): Promise<DaemonHealth> {
    const endpoint = await this.getEndpoint();
    return requestJson<HealthResponse>(endpoint, "/health");
  }

  public async tree(): Promise<ProjectTreeSnapshot> {
    const endpoint = await this.getEndpoint();
    const response = await requestJson<TreeResponse>(endpoint, "/api/tree");
    return response.tree;
  }

  public async node(nodePath: string): Promise<ProjectTreeNode> {
    const endpoint = await this.getEndpoint();
    const response = await requestJson<NodeResponse>(endpoint, `/api/node?path=${encodeURIComponent(nodePath)}`);
    return response.node;
  }

  public async createNode(parentPath: string, name: string, className: string): Promise<ProjectTreeNode> {
    const endpoint = await this.getEndpoint();
    const response = await requestJson<NodeResponse>(endpoint, "/api/node", {
      method: "POST",
      body: JSON.stringify({
        parentPath,
        name,
        className,
      }),
    });
    return response.node;
  }

  public async renameNode(nodePath: string, newName: string): Promise<ProjectTreeNode> {
    const endpoint = await this.getEndpoint();
    const response = await requestJson<NodeResponse>(endpoint, "/api/node", {
      method: "PATCH",
      body: JSON.stringify({
        path: nodePath,
        newName,
      }),
    });
    return response.node;
  }

  public async deleteNode(nodePath: string): Promise<void> {
    const endpoint = await this.getEndpoint();
    await requestJson<{ ok: boolean }>(endpoint, `/api/node?path=${encodeURIComponent(nodePath)}`, {
      method: "DELETE",
    });
  }

  private async connect(nextState: ConnectionState): Promise<void> {
    if (this.disposed) {
      return;
    }

    const endpoint = await this.getEndpoint();
    this.updateConnectionState(nextState, endpoint);

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.terminate();
      this.socket = null;
    }

    const socket = new WebSocket(`ws://${endpoint.host}:${endpoint.port}`);
    this.socket = socket;

    socket.once("open", () => {
      this.reconnectDelayMs = 1_000;
      this.updateConnectionState("connected", endpoint);
      socket.send(
        JSON.stringify({
          type: "HELLO",
          client: "editor",
          version: "0.1.0",
        }),
      );
    });

    socket.on("message", (message) => {
      this.handleMessage(message.toString());
    });

    socket.once("close", () => {
      if (this.socket === socket) {
        this.socket = null;
      }
      if (!this.disposed) {
        this.scheduleReconnect();
      }
    });

    socket.once("error", (error) => {
      this.onDidReceiveEventEmitter.fire({
        type: "ERROR",
        code: "SOCKET_ERROR",
        message: String(error.message ?? error),
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) {
      return;
    }

    const delayMs = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(30_000, this.reconnectDelayMs * 2);
    this.updateConnectionState("reconnecting", this.currentEndpoint);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect("reconnecting");
    }, delayMs);
  }

  private updateConnectionState(state: ConnectionState, endpoint: DaemonEndpoint | null = this.currentEndpoint): void {
    this.currentState = state;
    this.onDidReceiveEventEmitter.fire({
      type: "CONNECTION_STATE",
      state,
      endpoint,
    });
  }

  private handleMessage(rawText: string): void {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      return;
    }

    switch (payload.type) {
      case "WELCOME":
        this.onDidReceiveEventEmitter.fire({
          type: "WELCOME",
          schemaVersion: typeof payload.schema_version === "string" ? payload.schema_version : null,
        });
        return;
      case "SYNC_INSTANCE":
        if (typeof payload.path === "string" && payload.data && typeof payload.data === "object") {
          this.onDidReceiveEventEmitter.fire({
            type: "SYNC_INSTANCE",
            path: payload.path,
            data: payload.data as Record<string, unknown>,
          });
        }
        return;
      case "REMOVE_INSTANCE":
        if (typeof payload.path === "string") {
          this.onDidReceiveEventEmitter.fire({
            type: "REMOVE_INSTANCE",
            path: payload.path,
          });
        }
        return;
      case "RENAME_INSTANCE":
        if (typeof payload.oldPath === "string" && typeof payload.newPath === "string") {
          this.onDidReceiveEventEmitter.fire({
            type: "RENAME_INSTANCE",
            oldPath: payload.oldPath,
            newPath: payload.newPath,
          });
        }
        return;
      case "CONFLICT":
        if (typeof payload.id === "string" && typeof payload.path === "string") {
          this.onDidReceiveEventEmitter.fire({
            type: "CONFLICT",
            conflict: {
              id: payload.id,
              path: payload.path,
              reason: typeof payload.reason === "string" ? payload.reason : "Conflict detected.",
              createdAt: typeof payload.createdAt === "string" ? payload.createdAt : new Date().toISOString(),
              localHash: typeof payload.localHash === "string" ? payload.localHash : null,
              remoteHash: typeof payload.remoteHash === "string" ? payload.remoteHash : null,
              local: payload.local,
              remote: payload.remote,
            },
          });
        }
        return;
      case "ERROR":
        this.onDidReceiveEventEmitter.fire({
          type: "ERROR",
          code: typeof payload.code === "string" ? payload.code : null,
          message: typeof payload.message === "string" ? payload.message : "Daemon returned an error.",
        });
        return;
      default:
        return;
    }
  }
}
