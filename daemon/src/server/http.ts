import http from "node:http";
import type { AddressInfo } from "node:net";
import type { SchemaCache } from "../schema/types.js";
import type { WatchServerContext } from "./types.js";

const DAEMON_VERSION = "0.1.0";

function sendJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload, null, 2));
}

function formatListenError(error: unknown, host: string, port: number): string {
  const code =
    typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";

  if (code === "EADDRINUSE") {
    return `Port ${port} on ${host} is already in use. Stop the other RoSync daemon, or run \`rosync watch --host 127.0.0.1 --port 34991\`.`;
  }

  if (code === "EACCES") {
    return `RoSync could not bind to ${host}:${port}. Check your local firewall or try a different port.`;
  }

  return error instanceof Error ? error.message : String(error);
}

async function readJsonBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

async function routeRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: WatchServerContext,
): Promise<void> {
  const hostHeader = request.headers.host ?? `${context.config.sync.host}:${context.config.sync.port}`;
  const requestUrl = new URL(request.url ?? "/", `http://${hostHeader}`);
  const schema = await context.getSchemaCache();

  if (request.method === "GET" && requestUrl.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      name: "rosync-daemon",
      version: DAEMON_VERSION,
      project: context.config.project.name,
      host: context.config.sync.host,
      port: context.config.sync.port,
      src: context.config.sync.src,
      connections: context.getConnections(),
      summary: context.getSummary(),
      schema: schema.metadata,
      now: new Date().toISOString(),
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/status") {
    sendJson(response, 200, {
      ok: true,
      summary: context.getSummary(),
      connections: context.getConnections(),
      schema: schema.metadata,
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/schema") {
    const className = requestUrl.searchParams.get("class");
    const classDescriptor = className ? schema.classes[className] ?? null : null;

    sendJson(response, 200, {
      ok: true,
      metadata: schema.metadata,
      classCount: Object.keys(schema.classes).length,
      className,
      classDescriptor,
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/tree") {
    sendJson(response, 200, {
      ok: true,
      tree: await context.getProjectTree(),
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/node") {
    const nodePath = requestUrl.searchParams.get("path");
    if (!nodePath) {
      sendJson(response, 400, {
        ok: false,
        error: "Missing path query parameter.",
      });
      return;
    }

    const node = await context.getProjectNode(nodePath);
    if (!node) {
      sendJson(response, 404, {
        ok: false,
        error: `Instance ${nodePath} was not found.`,
      });
      return;
    }

    sendJson(response, 200, {
      ok: true,
      node,
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/node") {
    const body = await readJsonBody(request);
    const parentPath = typeof body.parentPath === "string" ? body.parentPath : null;
    const name = typeof body.name === "string" ? body.name : null;
    const className = typeof body.className === "string" ? body.className : null;

    if (!parentPath || !name || !className) {
      sendJson(response, 400, {
        ok: false,
        error: "Expected { parentPath, name, className }.",
      });
      return;
    }

    await context.createProjectNode(parentPath, name, className);
    await context.refreshProjectState();
    context.broadcastToClients("studio", {
      type: "INSTANCE_ADDED",
      path: `${parentPath}/${name}`,
    });
    sendJson(response, 200, {
      ok: true,
      node: await context.getProjectNode(`${parentPath}/${name}`),
      tree: await context.getProjectTree(),
    });
    return;
  }

  if (request.method === "PATCH" && requestUrl.pathname === "/api/node") {
    const body = await readJsonBody(request);
    const nodePath = typeof body.path === "string" ? body.path : null;

    if (!nodePath) {
      sendJson(response, 400, {
        ok: false,
        error: "Expected { path } in request body.",
      });
      return;
    }

    if (typeof body.newPath === "string") {
      await context.moveProjectNode(nodePath, body.newPath);
      await context.refreshProjectState();
      context.broadcastToClients("studio", {
        type: "INSTANCE_RENAMED",
        oldPath: nodePath,
        newPath: body.newPath,
      });
      sendJson(response, 200, {
        ok: true,
        node: await context.getProjectNode(body.newPath),
        tree: await context.getProjectTree(),
      });
      return;
    }

    if (typeof body.newName === "string") {
      await context.renameProjectNode(nodePath, body.newName);
      await context.refreshProjectState();
      const parentPath = nodePath.split("/").slice(0, -1).join("/");
      const nextPath = parentPath ? `${parentPath}/${body.newName}` : body.newName;
      context.broadcastToClients("studio", {
        type: "INSTANCE_RENAMED",
        oldPath: nodePath,
        newPath: nextPath,
      });
      sendJson(response, 200, {
        ok: true,
        node: await context.getProjectNode(nextPath),
        tree: await context.getProjectTree(),
      });
      return;
    }

    if (body.data && typeof body.data === "object" && typeof (body.data as Record<string, unknown>).className === "string") {
      await context.upsertProjectNode(nodePath, body.data as never);
      await context.refreshProjectState();
      context.broadcastToClients("studio", {
        type: "INSTANCE_CHANGED",
        path: nodePath,
      });
      sendJson(response, 200, {
        ok: true,
        node: await context.getProjectNode(nodePath),
        tree: await context.getProjectTree(),
      });
      return;
    }

    await context.updateProjectNode(nodePath, {
      properties: body.properties && typeof body.properties === "object" ? (body.properties as Record<string, unknown>) : undefined,
      attributes: body.attributes && typeof body.attributes === "object" ? (body.attributes as Record<string, unknown>) : undefined,
      tags: Array.isArray(body.tags) ? body.tags.filter((entry): entry is string => typeof entry === "string") : undefined,
      source: typeof body.source === "string" ? body.source : undefined,
    });
    await context.refreshProjectState();
    context.broadcastToClients("studio", {
      type: "INSTANCE_CHANGED",
      path: nodePath,
    });
    sendJson(response, 200, {
      ok: true,
      node: await context.getProjectNode(nodePath),
      tree: await context.getProjectTree(),
    });
    return;
  }

  if (request.method === "DELETE" && requestUrl.pathname === "/api/node") {
    const nodePath = requestUrl.searchParams.get("path");
    if (!nodePath) {
      sendJson(response, 400, {
        ok: false,
        error: "Missing path query parameter.",
      });
      return;
    }

    await context.deleteProjectNode(nodePath);
    await context.refreshProjectState();
    context.broadcastToClients("studio", {
      type: "INSTANCE_REMOVED",
      path: nodePath,
    });
    sendJson(response, 200, {
      ok: true,
      tree: await context.getProjectTree(),
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/command/pull") {
    const body = await readJsonBody(request);
    const service = typeof body.service === "string" ? body.service : undefined;
    const delivered = context.broadcastToClients("studio", {
      type: "PULL_REQUEST",
      service,
    });
    sendJson(response, 200, {
      ok: true,
      delivered,
      command: "pull",
      service: service ?? null,
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/command/push") {
    const body = await readJsonBody(request);
    const service = typeof body.service === "string" ? body.service : undefined;
    const delivered = context.broadcastToClients("studio", {
      type: "PUSH_REQUEST",
      service,
    });
    sendJson(response, 200, {
      ok: true,
      delivered,
      command: "push",
      service: service ?? null,
    });
    return;
  }

  sendJson(response, 404, {
    ok: false,
    error: "Route not found.",
    method: request.method,
    path: requestUrl.pathname,
  });
}

export async function startHttpServer(context: WatchServerContext): Promise<http.Server> {
  const server = http.createServer((request, response) => {
    routeRequest(request, response, context).catch((error) => {
      context.logger.error(`HTTP error: ${String((error as Error).message ?? error)}`);
      sendJson(response, 500, {
        ok: false,
        error: String((error as Error).message ?? error),
      });
    });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(context.config.sync.port, context.config.sync.host, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    throw new Error(formatListenError(error, context.config.sync.host, context.config.sync.port));
  }

  const address = server.address() as AddressInfo | null;
  const reportedAddress = address ? `http://${address.address}:${address.port}` : `http://${context.config.sync.host}:${context.config.sync.port}`;
  context.logger.info(`HTTP server listening on ${reportedAddress}`);
  return server;
}

export async function stopHttpServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function schemaMetadata(schema: SchemaCache): SchemaCache["metadata"] {
  return schema.metadata;
}
