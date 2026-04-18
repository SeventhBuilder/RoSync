import { randomUUID } from "node:crypto";
import type http from "node:http";
import WebSocket, { WebSocketServer } from "ws";
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
    void emitSessionsChanged();

    socket.on("message", async (message) => {
      try {
        const payload = JSON.parse(toMessageText(message)) as Record<string, unknown>;
        const type = typeof payload.type === "string" ? payload.type : "UNKNOWN";

        switch (type) {
          case "HELLO": {
            session.role =
              payload.client === "studio"
                ? "studio"
                : payload.client === "editor" || payload.client === "vscode"
                  ? "editor"
                  : "unknown";
            session.version = typeof payload.version === "string" ? payload.version : null;
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
                message: `Expected path and data for ${type}.`,
              });
              break;
            }

            await context.upsertProjectNode(nodePath, data as never);
            await context.refreshProjectState();
            safeSend(socket, {
              type: "ACK",
              message: `${type} applied.`,
              path: nodePath,
            });
            for (const targetSession of sessions.values()) {
              if (targetSession.id === session.id || targetSession.socket.readyState !== WebSocket.OPEN) {
                continue;
              }
              safeSend(targetSession.socket, payload);
            }
            break;
          }
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

            await context.deleteProjectNode(nodePath);
            await context.refreshProjectState();
            safeSend(socket, {
              type: "ACK",
              message: "INSTANCE_REMOVED applied.",
              path: nodePath,
            });
            for (const targetSession of sessions.values()) {
              if (targetSession.id === session.id || targetSession.socket.readyState !== WebSocket.OPEN) {
                continue;
              }
              safeSend(targetSession.socket, payload);
            }
            break;
          }
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

            await context.moveProjectNode(oldPath, newPath);
            await context.refreshProjectState();
            safeSend(socket, {
              type: "ACK",
              message: "INSTANCE_RENAMED applied.",
              oldPath,
              newPath,
            });
            for (const targetSession of sessions.values()) {
              if (targetSession.id === session.id || targetSession.socket.readyState !== WebSocket.OPEN) {
                continue;
              }
              safeSend(targetSession.socket, payload);
            }
            break;
          }
          case "PULL_REQUEST": {
            const tree = await context.getProjectTree();
            safeSend(socket, {
              type: "PROJECT_TREE",
              tree,
            });
            break;
          }
          default:
            for (const targetSession of sessions.values()) {
              if (targetSession.id === session.id || targetSession.socket.readyState !== WebSocket.OPEN) {
                continue;
              }
              safeSend(targetSession.socket, payload);
            }
            break;
        }
      } catch (error) {
        context.logger.error(`WebSocket message error: ${String((error as Error).message ?? error)}`);
        safeSend(socket, {
          type: "ERROR",
          code: "MALFORMED_MESSAGE",
          message: "Could not parse incoming message.",
        });
      }
    });

    socket.on("close", () => {
      sessions.delete(session.id);
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
