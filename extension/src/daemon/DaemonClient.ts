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
  connections: {
    studio: number;
    vscode: number;
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

export class DaemonClient {
  public async getEndpoint(): Promise<DaemonEndpoint> {
    return loadDaemonEndpoint();
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
}
