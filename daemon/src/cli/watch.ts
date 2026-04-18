import path from "node:path";
import chokidar from "chokidar";
import type { Command } from "commander";
import { loadIgnoreRules } from "../config/ignore.js";
import { ensureProjectDirectories, loadConfig } from "../config/toml_parser.js";
import type { ProjectTreeSnapshot, RuntimeState } from "../config/types.js";
import { EMPTY_RUNTIME_STATE } from "../config/types.js";
import { loadSchemaCache, schemaIsStale, updateSchemaCache } from "../schema/loader.js";
import { attachWebSocketServer } from "../server/websocket.js";
import { startHttpServer, stopHttpServer } from "../server/http.js";
import { type ServerLogger } from "../server/types.js";
import { DebouncedTask } from "../sync/debounce.js";
import { summarizeConnections, writeRuntimeState } from "../sync/engine.js";
import {
  buildProjectTree,
  createNode,
  deleteNode,
  findNodeByPath,
  moveNode,
  renameNode,
  summarizeProjectTree,
  updateNode,
  upsertNodeFromPayload,
} from "../sync/project.js";

const logger: ServerLogger = {
  info(message) {
    console.log(`[RoSync] ${message}`);
  },
  warn(message) {
    console.warn(`[RoSync] ${message}`);
  },
  error(message) {
    console.error(`[RoSync] ${message}`);
  },
};

export function registerWatchCommand(program: Command): void {
  program
    .command("watch")
    .description("Start the RoSync daemon and watch the project for changes.")
    .option("--port <port>", "Override the configured port")
    .option("--host <host>", "Override the configured host")
    .option("--verbose", "Enable verbose logging")
    .action(async (options: { port?: string; host?: string; verbose?: boolean }) => {
      const config = await loadConfig(process.cwd(), {
        sync: {
          host: options.host ?? undefined,
          port: options.port ? Number(options.port) : undefined,
        },
      });

      await ensureProjectDirectories(config);
      const ignoreRules = await loadIgnoreRules(config.projectRoot, config.ignorePath);

      let schemaCache = await loadSchemaCache(config);
      if (config.sync.autoSchemaUpdate && schemaIsStale(schemaCache)) {
        void updateSchemaCache(config)
          .then((nextSchema) => {
            schemaCache = nextSchema;
            logger.info(`Schema cache refreshed in background (${schemaCache.metadata.version ?? "unknown"}).`);
          })
          .catch((error) => {
            logger.warn(`Background schema refresh failed: ${String((error as Error).message ?? error)}`);
          });
      }

      let projectTree: ProjectTreeSnapshot = await buildProjectTree(config, ignoreRules);
      let summary = summarizeProjectTree(projectTree);
      let runtimeState: RuntimeState = {
        ...EMPTY_RUNTIME_STATE,
        running: true,
        host: config.sync.host,
        port: config.sync.port,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        schemaVersion: schemaCache.metadata.version,
        schemaFetchedAt: schemaCache.metadata.fetchedAt,
        summary,
      };

      let websocketRuntime:
        | ReturnType<typeof attachWebSocketServer>
        | null = null;

      const persistRuntimeState = async (): Promise<void> => {
        runtimeState = {
          ...runtimeState,
          updatedAt: new Date().toISOString(),
          schemaVersion: schemaCache.metadata.version,
          schemaFetchedAt: schemaCache.metadata.fetchedAt,
          summary,
          connections: summarizeConnections(websocketRuntime?.getSessionSummaries() ?? []),
        };
        await writeRuntimeState(config, runtimeState);
      };

      const httpServer = await startHttpServer({
        config,
        logger,
        getSummary: () => summary,
        getConnections: () => runtimeState.connections,
        getSchemaCache: () => schemaCache,
        getProjectTree: () => projectTree,
        getProjectNode: (nodePath) => findNodeByPath(projectTree, nodePath),
        refreshProjectState: async () => {
          projectTree = await buildProjectTree(config, ignoreRules);
          summary = summarizeProjectTree(projectTree);
          await persistRuntimeState();
        },
        createProjectNode: (parentPath, name, className) => createNode(config, parentPath, name, className),
        updateProjectNode: (nodePath, patch) => updateNode(config, nodePath, patch),
        upsertProjectNode: (nodePath, payload) => upsertNodeFromPayload(config, nodePath, payload),
        renameProjectNode: (nodePath, newName) => renameNode(config, nodePath, newName),
        moveProjectNode: (oldPath, newPath) => moveNode(config, oldPath, newPath),
        deleteProjectNode: (nodePath) => deleteNode(config, nodePath),
        broadcastToClients: () => 0,
      });

      websocketRuntime = attachWebSocketServer(
        httpServer,
        {
          config,
          logger,
          getSummary: () => summary,
          getConnections: () => runtimeState.connections,
          getSchemaCache: () => schemaCache,
          getProjectTree: () => projectTree,
          getProjectNode: (nodePath) => findNodeByPath(projectTree, nodePath),
          refreshProjectState: async () => {
            projectTree = await buildProjectTree(config, ignoreRules);
            summary = summarizeProjectTree(projectTree);
            await persistRuntimeState();
          },
          createProjectNode: (parentPath, name, className) => createNode(config, parentPath, name, className),
          updateProjectNode: (nodePath, patch) => updateNode(config, nodePath, patch),
          upsertProjectNode: (nodePath, payload) => upsertNodeFromPayload(config, nodePath, payload),
          renameProjectNode: (nodePath, newName) => renameNode(config, nodePath, newName),
          moveProjectNode: (oldPath, newPath) => moveNode(config, oldPath, newPath),
          deleteProjectNode: (nodePath) => deleteNode(config, nodePath),
          broadcastToClients: (role, payload) => websocketRuntime?.broadcastToRole(role, payload) ?? 0,
        },
        persistRuntimeState,
      );

      const refreshSummary = async (): Promise<void> => {
        projectTree = await buildProjectTree(config, ignoreRules);
        summary = summarizeProjectTree(projectTree);
        await persistRuntimeState();
      };

      const debouncedRefresh = new DebouncedTask(config.sync.debounceMs, refreshSummary);
      const watcher = chokidar.watch(config.srcDir, {
        ignoreInitial: true,
        persistent: true,
      });

      watcher.on("all", (eventName, changedPath) => {
        const relativePath = path.relative(config.projectRoot, changedPath).replace(/\\/g, "/");
        if (options.verbose) {
          logger.info(`${eventName} ${relativePath}`);
        }

        websocketRuntime?.broadcast({
          type: "FILE_SYSTEM_CHANGED",
          event: eventName,
          path: relativePath,
        });
        debouncedRefresh.trigger();
      });

      await persistRuntimeState();

      console.log(`RoSync daemon listening on http://${config.sync.host}:${config.sync.port}`);
      console.log(`WebSocket endpoint: ws://${config.sync.host}:${config.sync.port}`);
      console.log(`Watching: ${config.srcDir}`);

      await new Promise<void>((resolve, reject) => {
        let shuttingDown = false;

        const shutdown = async (signal: string): Promise<void> => {
          if (shuttingDown) {
            return;
          }
          shuttingDown = true;

          logger.info(`Received ${signal}, shutting down.`);

          try {
            await debouncedRefresh.flush();
            await watcher.close();
            if (websocketRuntime) {
              await websocketRuntime.close();
            }
            await stopHttpServer(httpServer);
            runtimeState.running = false;
            await persistRuntimeState();
            resolve();
          } catch (error) {
            reject(error);
          }
        };

        process.once("SIGINT", () => {
          void shutdown("SIGINT");
        });
        process.once("SIGTERM", () => {
          void shutdown("SIGTERM");
        });
      });
    });
}
