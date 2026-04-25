import * as vscode from "vscode";
import { type ConnectionState, DaemonClient, type DaemonHealth } from "../daemon/DaemonClient.js";

class StatusItem extends vscode.TreeItem {
  public constructor(label: string, description?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
  }
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "n/a";
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : value;
}

function pathIsWithinService(nodePath: string, serviceName: string): boolean {
  return nodePath === serviceName || nodePath.startsWith(`${serviceName}/`);
}

export class StatusProvider implements vscode.TreeDataProvider<StatusItem>, vscode.Disposable {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<StatusItem | undefined>();
  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private health: DaemonHealth | null = null;
  private error: string | null = null;
  private connectionState: ConnectionState = "disconnected";
  private activeStudioPushService: string | null = null;
  private activity: string | null = null;
  private readonly eventSubscription: vscode.Disposable;

  public constructor(private readonly daemonClient: DaemonClient) {
    this.eventSubscription = this.daemonClient.onDidReceiveEvent((event) => {
      if (event.type === "CONNECTION_STATE") {
        this.connectionState = event.state;
        if (event.state === "connected") {
          void this.refresh();
        } else {
          this.activeStudioPushService = null;
          this.activity = null;
          this.onDidChangeTreeDataEmitter.fire(undefined);
        }
      } else if (event.type === "PUSH_PROGRESS") {
        const progressText = event.done !== null && event.total !== null ? `${event.done}/${event.total}` : "working";
        this.activeStudioPushService = event.pushComplete ? null : event.service;
        this.activity = event.pushComplete ? null : `Pulling from Studio: ${event.service} ${progressText}`;
        if (event.serviceComplete || event.pushComplete) {
          void this.refresh();
        } else {
          this.onDidChangeTreeDataEmitter.fire(undefined);
        }
      } else if (event.type === "PULL_PROGRESS") {
        const progressText = event.done !== null && event.total !== null ? `${event.done}/${event.total}` : "working";
        this.activity = event.pullComplete ? null : `Pushing to Studio: ${event.service} ${progressText}`;
        if (event.serviceComplete || event.pullComplete) {
          void this.refresh();
        } else {
          this.onDidChangeTreeDataEmitter.fire(undefined);
        }
      } else if (event.type === "SYNC_STAGE") {
        const directionLabel = event.direction === "push" ? "Pulling from Studio" : "Pushing to Studio";
        const phaseLabel = event.phase === "planning" ? "Planning" : "Applying";
        const serviceLabel = event.service
          ? `${event.service}${event.serviceIndex !== null && event.serviceCount !== null ? ` (${event.serviceIndex}/${event.serviceCount})` : ""}`
          : "all services";
        const detailText = event.detail ? `: ${event.detail}` : "";
        this.activity = `${phaseLabel} ${directionLabel}: ${serviceLabel}${detailText}`;
        this.onDidChangeTreeDataEmitter.fire(undefined);
      } else if (event.type === "SYNC_INSTANCE" || event.type === "REMOVE_INSTANCE" || event.type === "RENAME_INSTANCE" || event.type === "CONFLICT") {
        if (
          "origin" in event &&
          event.origin === "studio" &&
          this.activeStudioPushService &&
          "path" in event &&
          typeof event.path === "string" &&
          pathIsWithinService(event.path, this.activeStudioPushService)
        ) {
          return;
        }

        void this.refresh();
      } else if (event.type === "ERROR") {
        this.error = event.message;
        this.onDidChangeTreeDataEmitter.fire(undefined);
      }
    });
  }

  public dispose(): void {
    this.eventSubscription.dispose();
    this.onDidChangeTreeDataEmitter.dispose();
  }

  public async refresh(): Promise<void> {
    try {
      this.health = await this.daemonClient.health();
      this.error = null;
    } catch (error) {
      this.health = null;
      this.error = String((error as Error).message ?? error);
    }

    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  public getTreeItem(element: StatusItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(): Promise<StatusItem[]> {
    if (!this.health && !this.error && this.connectionState !== "disconnected") {
      await this.refresh();
    }

    if (this.error) {
      return [
        new StatusItem("Connection", this.connectionState),
        new StatusItem("Daemon", this.error),
      ];
    }

    if (!this.health) {
      return [new StatusItem("Connection", this.connectionState)];
    }

    return [
      new StatusItem("Connection", this.connectionState),
      ...(this.activity ? [new StatusItem("Activity", this.activity)] : []),
      new StatusItem("Project", this.health.project),
      new StatusItem("Daemon", `${this.health.host}:${this.health.port}`),
      new StatusItem("Synced", `${this.health.diagnostics.syncedInstances}`),
      new StatusItem("Drifted", `${this.health.diagnostics.driftedInstances}`),
      new StatusItem("Conflicts", `${this.health.diagnostics.conflictCount}`),
      new StatusItem("Pending outbound", `${this.health.diagnostics.pendingOutboundCount}`),
      new StatusItem("Indexed instances", `${this.health.summary.indexedInstances}`),
      new StatusItem("Script files", `${this.health.summary.scriptFiles}`),
      new StatusItem("Ignored entries", `${this.health.summary.ignoredEntries}`),
      new StatusItem("Studio clients", `${this.health.connections.studio}`),
      new StatusItem("Editor clients", `${this.health.connections.editor}`),
      new StatusItem("Schema version", this.health.schema.version ?? "unknown"),
      new StatusItem("Last file event", `${formatTimestamp(this.health.diagnostics.lastFileEventAt)} (${this.health.diagnostics.lastFileEventPath ?? "n/a"})`),
      new StatusItem(
        "Last Studio event",
        `${formatTimestamp(this.health.diagnostics.lastStudioEventAt)} (${this.health.diagnostics.lastStudioEventPath ?? "n/a"})`,
      ),
    ];
  }
}
