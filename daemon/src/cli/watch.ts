import path from "node:path";
import { performance } from "node:perf_hooks";
import chokidar from "chokidar";
import type { Command } from "commander";
import { loadIgnoreRules } from "../config/ignore.js";
import { ensureProjectDirectories, loadConfig } from "../config/toml_parser.js";
import type { RuntimeState } from "../config/types.js";
import { EMPTY_RUNTIME_STATE } from "../config/types.js";
import { loadSchemaCache, schemaIsStale, updateSchemaCache } from "../schema/loader.js";
import { startHttpServer, stopHttpServer } from "../server/http.js";
import { type ServerLogger } from "../server/types.js";
import { attachWebSocketServer } from "../server/websocket.js";
import { DebouncedTask } from "../sync/debounce.js";
import { summarizeConnections, SyncEngine, writeRuntimeState } from "../sync/engine.js";
import {
  buildProjectTree,
  createNode as createProjectNodeOnDisk,
  deleteNode as deleteProjectNodeOnDisk,
  moveNode as moveProjectNodeOnDisk,
  renameNode as renameProjectNodeOnDisk,
  updateNode as updateProjectNodeOnDisk,
  upsertNodeFromPayload as upsertProjectNodeOnDisk,
  writeInstanceToDisk as writeInstanceToDiskOnDisk,
} from "../sync/project.js";

const logger: ServerLogger = {
  info(message) {
    console.log(`[RoSync] ${message}`);
  },
  debug(message) {
    console.debug(`[RoSync] ${message}`);
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
      logger.info("Starting RoSync watch daemon...");
      const config = await loadConfig(process.cwd(), {
        sync: {
          host: options.host ?? undefined,
          port: options.port ? Number(options.port) : undefined,
        },
      });

      await ensureProjectDirectories(config);
      const ignoreRules = await loadIgnoreRules(config.projectRoot, config.ignorePath);
      let schemaCache = await loadSchemaCache(config);

      if (config.network.enabled && config.sync.autoSchemaUpdate && schemaIsStale(schemaCache)) {
        void updateSchemaCache(config)
          .then(async (nextSchema) => {
            schemaCache = nextSchema;
          })
          .catch(() => {});
      }

      let websocketRuntime: ReturnType<typeof attachWebSocketServer> | null = null;
      let studioPushAllActive = false;
      const rebuildProjectTree = async () => buildProjectTree(config, ignoreRules);
      logger.info(`Indexing project tree from ${config.srcDir}...`);
      const startupScanStartedAt = performance.now();
      const initialTree = await rebuildProjectTree();
      const startupScanDurationMs = Math.round(performance.now() - startupScanStartedAt);
      const engine = new SyncEngine(initialTree, {
        rebuildProjectTree,
        createProjectNode: (parentPath, name, className) => createProjectNodeOnDisk(config, parentPath, name, className),
        updateProjectNode: (nodePath, patch) => updateProjectNodeOnDisk(config, nodePath, patch),
        syncProjectNode: (nodePath, payload) => writeInstanceToDiskOnDisk(config, nodePath, payload),
        upsertProjectNode: (nodePath, payload) => upsertProjectNodeOnDisk(config, nodePath, payload),
        renameProjectNode: (nodePath, newName) => renameProjectNodeOnDisk(config, nodePath, newName),
        moveProjectNode: (oldPath, newPath) => moveProjectNodeOnDisk(config, oldPath, newPath),
        deleteProjectNode: (nodePath) => deleteProjectNodeOnDisk(config, nodePath),
        broadcastToClients: (role, payload) => websocketRuntime?.broadcastToRole(role, payload) ?? 0,
        logger,
      });
      const initialSummary = engine.getProjectSummary();
      logger.info(
        `Indexed ${initialSummary.indexedInstances} instances and ${initialSummary.scriptFiles} script files in ${startupScanDurationMs}ms.`,
      );

      let runtimeState: RuntimeState = {
        ...EMPTY_RUNTIME_STATE,
        running: true,
        host: config.sync.host,
        port: config.sync.port,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        schemaVersion: schemaCache.metadata.version,
        schemaFetchedAt: schemaCache.metadata.fetchedAt,
        summary: engine.getProjectSummary(),
        diagnostics: engine.getDiagnostics(),
      };

      const persistRuntimeState = async (): Promise<void> => {
        runtimeState = {
          ...runtimeState,
          updatedAt: new Date().toISOString(),
          schemaVersion: schemaCache.metadata.version,
          schemaFetchedAt: schemaCache.metadata.fetchedAt,
          connections: summarizeConnections(websocketRuntime?.getSessionSummaries() ?? []),
          summary: engine.getProjectSummary(),
          diagnostics: engine.getDiagnostics(),
        };
        await writeRuntimeState(config, runtimeState);
      };

      const reportPullProgressFromStudio = async (progress: {
        service?: string | null;
        done?: number | null;
        total?: number | null;
        serviceComplete?: boolean;
        pullComplete?: boolean;
      }): Promise<void> => {
        if (!progress.service) {
          return;
        }

        const done = progress.done ?? null;
        const total = progress.total ?? null;

        websocketRuntime?.broadcastToRole("editor", {
          type: "PULL_PROGRESS",
          service: progress.service,
          done,
          total,
          serviceComplete: progress.serviceComplete === true,
          pullComplete: progress.pullComplete === true,
        });

        if (progress.serviceComplete && total) {
          logger.info(`Pushing to Studio completed for ${progress.service} (${total}/${total}).`);
        } else if (done === 0 && total !== null) {
          logger.info(`Pushing to Studio started for ${progress.service} (${total} instances).`);
        } else if (done !== null && total !== null) {
          logger.info(`Pushing to Studio progress for ${progress.service} (${done}/${total}).`);
        }
      };

      const reportSyncPlanFromStudio = async (plan: {
        direction?: "push" | "pull" | null;
        service?: string | null;
        added?: number | null;
        changed?: number | null;
        removed?: number | null;
        unchanged?: number | null;
        scanned?: number | null;
        serviceIndex?: number | null;
        serviceCount?: number | null;
        planComplete?: boolean;
      }): Promise<void> => {
        if (!plan.service || !plan.direction) {
          return;
        }

        const added = plan.added ?? 0;
        const changed = plan.changed ?? 0;
        const removed = plan.removed ?? 0;
        const unchanged = plan.unchanged ?? 0;

        websocketRuntime?.broadcastToRole("editor", {
          type: "SYNC_PLAN",
          direction: plan.direction,
          service: plan.service,
          added,
          changed,
          removed,
          unchanged,
          scanned: plan.scanned ?? 0,
          serviceIndex: plan.serviceIndex ?? null,
          serviceCount: plan.serviceCount ?? null,
          planComplete: plan.planComplete === true,
        });

        const actionLabel = plan.direction === "push" ? "Pull from Studio plan" : "Push to Studio plan";
        logger.info(
          `${actionLabel} for ${plan.service}: ${added} added, ${changed} changed, ${removed} removed, ${unchanged} unchanged.`,
        );
      };

      const reportSyncStageFromStudio = async (stage: {
        direction?: "push" | "pull" | null;
        phase?: "planning" | "applying" | null;
        service?: string | null;
        serviceIndex?: number | null;
        serviceCount?: number | null;
        detail?: string | null;
      }): Promise<void> => {
        if (!stage.direction || !stage.phase) {
          return;
        }

        websocketRuntime?.broadcastToRole("editor", {
          type: "SYNC_STAGE",
          direction: stage.direction,
          phase: stage.phase,
          service: stage.service ?? null,
          serviceIndex: stage.serviceIndex ?? null,
          serviceCount: stage.serviceCount ?? null,
          detail: stage.detail ?? null,
        });

        const directionLabel = stage.direction === "push" ? "Pull from Studio" : "Push to Studio";
        const phaseLabel = stage.phase === "planning" ? "planning" : "applying";
        const serviceLabel = stage.service
          ? `${stage.service}${stage.serviceIndex && stage.serviceCount ? ` (${stage.serviceIndex}/${stage.serviceCount})` : ""}`
          : "all services";
        const detailText = stage.detail ? ` - ${stage.detail}` : "";
        logger.info(`${directionLabel} ${phaseLabel}: ${serviceLabel}${detailText}`);
      };

      const httpServer = await startHttpServer({
        config,
        logger,
        getSummary: () => engine.getProjectSummary(),
        getDiagnostics: () => engine.getDiagnostics(),
        getRuntimeState: () => runtimeState,
        getConnections: () => runtimeState.connections,
        getConflicts: () => engine.getConflicts(),
        resolveConflict: async (id, strategy) => {
          const resolved = await engine.resolveConflict(id, strategy);
          await persistRuntimeState();
          return resolved;
        },
        getSchemaCache: () => schemaCache,
        getProjectTree: () => engine.getProjectTree(),
        getProjectNode: (nodePath) => engine.getProjectNode(nodePath),
        refreshProjectState: async (origin = "disk") => {
          await engine.reconcileDiskTree(origin);
          await persistRuntimeState();
        },
        createProjectNode: async (parentPath, name, className) => {
          await engine.createNode(parentPath, name, className, "editor");
          await persistRuntimeState();
        },
        updateProjectNode: async (nodePath, patch) => {
          await engine.updateNode(nodePath, patch, "editor");
          await persistRuntimeState();
        },
        syncProjectNode: async (nodePath, payload) => {
          await writeInstanceToDiskOnDisk(config, nodePath, payload);
          await engine.reconcileDiskTree("studio");
          await persistRuntimeState();
        },
        upsertProjectNode: async (nodePath, payload) => {
          await engine.upsertNode(nodePath, payload, "editor");
          await persistRuntimeState();
        },
        renameProjectNode: async (nodePath, newName) => {
          await engine.renameNode(nodePath, newName, "editor");
          await persistRuntimeState();
        },
        moveProjectNode: async (oldPath, newPath) => {
          await engine.moveNode(oldPath, newPath, "editor");
          await persistRuntimeState();
        },
        deleteProjectNode: async (nodePath) => {
          await engine.deleteNode(nodePath, "editor");
          await persistRuntimeState();
        },
        syncFromStudio: async (nodePath, payload) => {
          await engine.handleStudioSync(nodePath, payload);
          await persistRuntimeState();
        },
        pushBatchFromStudio: async (instances, removedPaths, progress) => {
          if (progress?.service) {
            studioPushAllActive = true;
          }

          try {
            await engine.handleStudioPushBatch(instances, removedPaths, progress);
            await persistRuntimeState();
          } catch (error) {
            studioPushAllActive = false;
            throw error;
          } finally {
            if (progress?.pushComplete) {
              studioPushAllActive = false;
            }
          }
        },
        reportPullProgressFromStudio,
        reportSyncPlanFromStudio,
        reportSyncStageFromStudio,
        removeFromStudio: async (nodePath) => {
          await engine.handleStudioRemove(nodePath);
          await persistRuntimeState();
        },
        renameFromStudio: async (oldPath, newPath) => {
          await engine.handleStudioRename(oldPath, newPath);
          await persistRuntimeState();
        },
        noteEditorActivity: (activity) => {
          engine.noteEditorActivity(activity);
        },
        pushToStudio: (service) => engine.pushToStudio(service),
        requestPull: (service) => engine.requestPull(service),
        broadcastToClients: (role, payload) => websocketRuntime?.broadcastToRole(role, payload) ?? 0,
      });

      websocketRuntime = attachWebSocketServer(
        httpServer,
        {
          config,
          logger,
          getSummary: () => engine.getProjectSummary(),
          getDiagnostics: () => engine.getDiagnostics(),
          getRuntimeState: () => runtimeState,
          getConnections: () => runtimeState.connections,
          getConflicts: () => engine.getConflicts(),
          resolveConflict: async (id, strategy) => {
            const resolved = await engine.resolveConflict(id, strategy);
            await persistRuntimeState();
            return resolved;
          },
          getSchemaCache: () => schemaCache,
          getProjectTree: () => engine.getProjectTree(),
          getProjectNode: (nodePath) => engine.getProjectNode(nodePath),
          refreshProjectState: async (origin = "disk") => {
            await engine.reconcileDiskTree(origin);
            await persistRuntimeState();
          },
          createProjectNode: async (parentPath, name, className) => {
            await engine.createNode(parentPath, name, className, "editor");
            await persistRuntimeState();
          },
          updateProjectNode: async (nodePath, patch) => {
            await engine.updateNode(nodePath, patch, "editor");
            await persistRuntimeState();
          },
          syncProjectNode: async (nodePath, payload) => {
            await writeInstanceToDiskOnDisk(config, nodePath, payload);
            await engine.reconcileDiskTree("studio");
            await persistRuntimeState();
          },
          upsertProjectNode: async (nodePath, payload) => {
            await engine.upsertNode(nodePath, payload, "editor");
            await persistRuntimeState();
          },
          renameProjectNode: async (nodePath, newName) => {
            await engine.renameNode(nodePath, newName, "editor");
            await persistRuntimeState();
          },
          moveProjectNode: async (oldPath, newPath) => {
            await engine.moveNode(oldPath, newPath, "editor");
            await persistRuntimeState();
          },
          deleteProjectNode: async (nodePath) => {
            await engine.deleteNode(nodePath, "editor");
            await persistRuntimeState();
          },
          syncFromStudio: async (nodePath, payload) => {
            await engine.handleStudioSync(nodePath, payload);
            await persistRuntimeState();
          },
          pushBatchFromStudio: async (instances, removedPaths, progress) => {
            if (progress?.service) {
              studioPushAllActive = true;
            }

            try {
              await engine.handleStudioPushBatch(instances, removedPaths, progress);
              await persistRuntimeState();
            } catch (error) {
              studioPushAllActive = false;
              throw error;
            } finally {
              if (progress?.pushComplete) {
                studioPushAllActive = false;
              }
            }
          },
          reportPullProgressFromStudio,
          reportSyncPlanFromStudio,
          reportSyncStageFromStudio,
          removeFromStudio: async (nodePath) => {
            await engine.handleStudioRemove(nodePath);
            await persistRuntimeState();
          },
          renameFromStudio: async (oldPath, newPath) => {
            await engine.handleStudioRename(oldPath, newPath);
            await persistRuntimeState();
          },
          noteEditorActivity: (activity) => {
            engine.noteEditorActivity(activity);
          },
          pushToStudio: (service) => engine.pushToStudio(service),
          requestPull: (service) => engine.requestPull(service),
          broadcastToClients: (role, payload) => websocketRuntime?.broadcastToRole(role, payload) ?? 0,
        },
        persistRuntimeState,
      );

      const refreshFromWatcher = async (): Promise<void> => {
        await engine.reconcileDiskTree("disk");
        await persistRuntimeState();
      };

      const debouncedRefresh = new DebouncedTask(config.sync.debounceMs, refreshFromWatcher);
      const watcher = chokidar.watch(config.srcDir, {
        ignoreInitial: true,
        persistent: true,
      });

      watcher.on("all", (eventName, changedPath) => {
        const relativePath = path.relative(config.projectRoot, changedPath).replace(/\\/g, "/");
        engine.noteFileEvent(relativePath);
        if (options.verbose) {
          logger.info(`${eventName} ${relativePath}`);
        }

        if (studioPushAllActive) {
          return;
        }

        debouncedRefresh.trigger();
      });

      await persistRuntimeState();

      console.log(`RoSync daemon listening on http://${config.sync.host}:${config.sync.port}`);
      console.log(`WebSocket endpoint: ws://${config.sync.host}:${config.sync.port}`);
      console.log(`Watching: ${config.srcDir}`);
      console.log("Waiting for Roblox Studio plugin to connect...");
      console.log("Waiting for VS Code extension to connect...");

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
