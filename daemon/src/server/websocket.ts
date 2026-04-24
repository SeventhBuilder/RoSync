import { randomUUID } from "node:crypto";
import type http from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import type { SerializableNode } from "../config/types.js";
import type { SchemaCache } from "../schema/types.js";
import type { WatchServerContext } from "./types.js";

type ClientRole = "studio" | "editor" | "unknown";

interface ClientSession {
  id: string;
  role: ClientRole;
  version: string | null;
  connectedAt: string;
  socket: WebSocket;
}

export interface WebSocketRuntime {
  broadcast(payload: unknown, exceptSessionId?: string): void;
  broadcastToRole(role: ClientRole, payload: unknown): number;
  getSessionSummaries(): Array<{ role: ClientRole }>;
  hasRole(role: ClientRole): boolean;
  close(): Promise<void>;
}

function formatClientRole(role: ClientRole): string {
  if (role === "studio") {
    return "Studio";
  }

  if (role === "editor") {
    return "Editor";
  }

  return "Unknown client";
}

function toMessageText(message: WebSocket.RawData): string {
  if (typeof message === "string") {
    return message;
  }

  if (Buffer.isBuffer(message)) {
    return message.toString("utf8");
  }

  if (Array.isArray(message)) {
    return Buffer.concat(message.map((entry) => Buffer.from(entry))).toString("utf8");
  }

  return Buffer.from(message as ArrayBuffer).toString("utf8");
}

function safeSend(socket: WebSocket, payload: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(payload));
}

function previewMessageText(text: string, maxLength = 200): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}...`;
}

async function handleSchemaQuery(schema: SchemaCache, className: string | null): Promise<unknown> {
  if (!className) {
    return {
      type: "ERROR",
      code: "INVALID_SCHEMA_QUERY",
      message: "Expected className in SCHEMA_QUERY.",
    };
  }

  return {
    type: "SCHEMA_RESPONSE",
    className,
    descriptor: schema.classes[className] ?? null,
  };
}

function isSerializableNodePayload(value: unknown): value is SerializableNode {
  return typeof value === "object" && value !== null && typeof (value as { className?: unknown }).className === "string";
}

export function attachWebSocketServer(
  server: http.Server,
  context: WatchServerContext,
  onSessionsChanged: () => Promise<void> | void,
): WebSocketRuntime {
  const websocketServer = new WebSocketServer({ server });
  const sessions = new Map<string, ClientSession>();

  async function emitSessionsChanged(): Promise<void> {
    await onSessionsChanged();
  }

  websocketServer.on("connection", (socket) => {
    const session: ClientSession = {
      id: randomUUID(),
      role: "unknown",
      version: null,
      connectedAt: new Date().toISOString(),
      socket,
    };

    sessions.set(session.id, session);
    context.logger.info(`WebSocket client connected; waiting for HELLO (${session.id.slice(0, 8)}).`);
    void emitSessionsChanged();

    socket.on("message", async (message) => {
      const text = toMessageText(message);
      if (text.length > 10_000_000) {
        safeSend(socket, {
          type: "ERROR",
          code: "MESSAGE_TOO_LARGE",
          message: `Message size ${text.length} exceeds 10MB limit.`,
        });
        return;
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(text) as Record<string, unknown>;
      } catch {
        context.logger.error(`Failed to parse WebSocket message (${text.length} bytes): ${previewMessageText(text)}`);
        safeSend(socket, {
          type: "ERROR",
          code: "PARSE_ERROR",
          message: "Could not parse incoming message",
        });
        return;
      }

      const messageType = typeof payload.type === "string" ? payload.type : "UNKNOWN";

      try {
        switch (messageType) {
          case "HELLO": {
            session.role =
              payload.client === "studio"
                ? "studio"
                : payload.client === "editor" || payload.client === "vscode"
                  ? "editor"
                  : "unknown";
            session.version = typeof payload.version === "string" ? payload.version : null;
            context.logger.info(
              `${formatClientRole(session.role)} connected via WebSocket${session.version ? ` (v${session.version})` : ""}.`,
            );
            const schema = await context.getSchemaCache();
            safeSend(socket, {
              type: "WELCOME",
              version: "0.1.0",
              schema_version: schema.metadata.version,
            });
            await emitSessionsChanged();
            break;
          }
          case "PING":
            safeSend(socket, { type: "PONG" });
            break;
          case "SCHEMA_QUERY": {
            const schema = await context.getSchemaCache();
            safeSend(socket, await handleSchemaQuery(schema, typeof payload.className === "string" ? payload.className : null));
            break;
          }
          case "SCHEMA_DUMP":
            safeSend(socket, {
              type: "ACK",
              message: "SCHEMA_DUMP received.",
            });
            break;
          case "EDITOR_ACTIVITY": {
            const action =
              payload.action === "add" || payload.action === "update" || payload.action === "remove" || payload.action === "rename"
                ? payload.action
                : null;
            if (!action) {
              safeSend(socket, {
                type: "ERROR",
                code: "INVALID_EDITOR_ACTIVITY",
                message: "Expected action in EDITOR_ACTIVITY.",
              });
              break;
            }

            context.noteEditorActivity({
              action,
              client: typeof payload.client === "string" ? payload.client : "vscode",
              path: typeof payload.path === "string" ? payload.path : null,
              oldPath: typeof payload.oldPath === "string" ? payload.oldPath : null,
              newPath: typeof payload.newPath === "string" ? payload.newPath : null,
            });
            safeSend(socket, {
              type: "ACK",
              message: "EDITOR_ACTIVITY recorded.",
            });
            break;
          }
          case "PUSH_BATCH": {
            const instances = Array.isArray(payload.instances) ? payload.instances : null;
            if (!instances) {
              safeSend(socket, {
                type: "ERROR",
                code: "INVALID_PUSH_BATCH",
                message: "Expected instances for PUSH_BATCH.",
              });
              break;
            }

            const parsedInstances: Array<{ path: string; data: SerializableNode }> = [];
            let invalidBatch = false;
            for (const entry of instances) {
              const instancePath =
                typeof entry === "object" && entry !== null && typeof (entry as Record<string, unknown>).path === "string"
                  ? ((entry as Record<string, unknown>).path as string)
                  : null;
              const data =
                typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>).data : null;
              if (!instancePath || !isSerializableNodePayload(data)) {
                invalidBatch = true;
                break;
              }

              parsedInstances.push({
                path: instancePath,
                data,
              });
            }

            if (invalidBatch) {
              safeSend(socket, {
                type: "ERROR",
                code: "INVALID_PUSH_BATCH",
                message: "Expected PUSH_BATCH entries with { path, data.className }.",
              });
              break;
            }

            await context.pushBatchFromStudio(parsedInstances);
            context.broadcastToClients("editor", {
              type: "BATCH_SYNCED",
              count: parsedInstances.length,
            });
            safeSend(socket, {
              type: "ACK",
              message: "PUSH_BATCH applied.",
              count: parsedInstances.length,
            });
            break;
          }
          case "SYNC_INSTANCE":
          case "INSTANCE_ADDED":
          case "INSTANCE_CHANGED": {
            const nodePath = typeof payload.path === "string" ? payload.path : null;
            const data =
              payload.data && typeof payload.data === "object" && typeof (payload.data as Record<string, unknown>).className === "string"
                ? (payload.data as Record<string, unknown>)
                : null;
            if (!nodePath || !data) {
              safeSend(socket, {
                type: "ERROR",
                code: "INVALID_INSTANCE_PAYLOAD",
                message: `Expected path and data for ${messageType}.`,
              });
              break;
            }

            await context.syncFromStudio(nodePath, data as never);
            safeSend(socket, {
              type: "ACK",
              message: `${messageType} applied.`,
              path: nodePath,
            });
            break;
          }
          case "REMOVE_INSTANCE":
          case "INSTANCE_REMOVED": {
            const nodePath = typeof payload.path === "string" ? payload.path : null;
            if (!nodePath) {
              safeSend(socket, {
                type: "ERROR",
                code: "INVALID_REMOVE_PAYLOAD",
                message: "Expected path for INSTANCE_REMOVED.",
              });
              break;
            }

            await context.removeFromStudio(nodePath);
            safeSend(socket, {
              type: "ACK",
              message: `${messageType} applied.`,
              path: nodePath,
            });
            break;
          }
          case "RENAME_INSTANCE":
          case "INSTANCE_RENAMED": {
            const oldPath = typeof payload.oldPath === "string" ? payload.oldPath : null;
            const newPath = typeof payload.newPath === "string" ? payload.newPath : null;
            if (!oldPath || !newPath) {
              safeSend(socket, {
                type: "ERROR",
                code: "INVALID_RENAME_PAYLOAD",
                message: "Expected oldPath and newPath for INSTANCE_RENAMED.",
              });
              break;
            }

            await context.renameFromStudio(oldPath, newPath);
            safeSend(socket, {
              type: "ACK",
              message: `${messageType} applied.`,
              oldPath,
              newPath,
            });
            break;
          }
          case "PULL_REQUEST": {
            const service = typeof payload.service === "string" ? payload.service : undefined;
            const delivered = context.pushToStudio(service);
            safeSend(socket, {
              type: "ACK",
              message: "PULL_REQUEST acknowledged.",
              delivered,
              service: service ?? null,
            });
            break;
          }
          case "PUSH_REQUEST": {
            const service = typeof payload.service === "string" ? payload.service : undefined;
            const delivered = context.requestPull(service);
            safeSend(socket, {
              type: "ACK",
              message: "PUSH_REQUEST acknowledged.",
              delivered,
              service: service ?? null,
            });
            break;
          }
          case "RESOLVE_CONFLICT": {
            const id = typeof payload.id === "string" ? payload.id : null;
            const strategy =
              payload.strategy === "ours" || payload.strategy === "theirs" || payload.strategy === "manual"
                ? payload.strategy
                : null;
            if (!id || !strategy) {
              safeSend(socket, {
                type: "ERROR",
                code: "INVALID_CONFLICT_RESOLUTION",
                message: "Expected { id, strategy }.",
              });
              break;
            }

            const resolved = await context.resolveConflict(id, strategy);
            if (resolved) {
              safeSend(socket, {
                type: "ACK",
                message: "Conflict resolved.",
                id,
                strategy,
              });
            } else {
              safeSend(socket, {
                type: "ERROR",
                code: "CONFLICT_NOT_FOUND",
                message: `Conflict ${id} was not found.`,
                id,
                strategy,
              });
            }
            break;
          }
          default:
            context.logger.debug(`Unhandled message type: ${messageType}`);
            break;
        }
      } catch (error) {
        context.logger.error(`WebSocket message error for ${messageType}: ${String((error as Error).message ?? error)}`);
        safeSend(socket, {
          type: "ERROR",
          code: "MALFORMED_MESSAGE",
          message: "Could not handle incoming message.",
        });
      }
    });

    socket.on("close", () => {
      sessions.delete(session.id);
      context.logger.info(`${formatClientRole(session.role)} disconnected from WebSocket.`);
      void emitSessionsChanged();
    });

    socket.on("error", (error) => {
      context.logger.error(`WebSocket error: ${String((error as Error).message ?? error)}`);
    });
  });

  return {
    broadcast(payload: unknown, exceptSessionId?: string): void {
      let unused = 0;
      for (const session of sessions.values()) {
        if (session.id === exceptSessionId || session.socket.readyState !== WebSocket.OPEN) {
          continue;
        }
        safeSend(session.socket, payload);
        unused += 1;
      }
    },
    broadcastToRole(role: ClientRole, payload: unknown): number {
      let sentCount = 0;
      for (const session of sessions.values()) {
        if (session.role !== role || session.socket.readyState !== WebSocket.OPEN) {
          continue;
        }
        safeSend(session.socket, payload);
        sentCount += 1;
      }
      return sentCount;
    },
    getSessionSummaries(): Array<{ role: ClientRole }> {
      return [...sessions.values()].map((session) => ({
        role: session.role,
      }));
    },
    hasRole(role: ClientRole): boolean {
      return [...sessions.values()].some((session) => session.role === role);
    },
    async close(): Promise<void> {
      for (const session of sessions.values()) {
        session.socket.close();
      }

      await new Promise<void>((resolve) => {
        websocketServer.close(() => resolve());
      });
    },
  };
}
