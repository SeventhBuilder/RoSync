import * as vscode from "vscode";
import { type ConnectionState, type DaemonConflict, DaemonClient } from "../daemon/DaemonClient.js";

class ConflictItem extends vscode.TreeItem {
  public constructor(public readonly conflict: DaemonConflict | null, label: string, description?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;

    if (conflict) {
      this.id = conflict.id;
      this.contextValue = "rosyncConflict.item";
      this.iconPath = new vscode.ThemeIcon("warning");
      this.tooltip = `${conflict.path}\n${conflict.reason}\nCreated: ${formatTimestamp(conflict.createdAt)}`;
    } else {
      this.contextValue = "rosyncConflict.placeholder";
      this.iconPath = new vscode.ThemeIcon("info");
    }
  }
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "n/a";
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : value;
}

export class ConflictProvider implements vscode.TreeDataProvider<ConflictItem>, vscode.Disposable {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<ConflictItem | undefined>();
  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private connectionState: ConnectionState = "disconnected";
  private conflicts: DaemonConflict[] = [];
  private error: string | null = null;
  private readonly eventSubscription: vscode.Disposable;

  public constructor(private readonly daemonClient: DaemonClient) {
    this.eventSubscription = this.daemonClient.onDidReceiveEvent((event) => {
      if (event.type === "CONNECTION_STATE") {
        this.connectionState = event.state;
        if (event.state === "connected") {
          void this.refresh();
        } else {
          this.conflicts = [];
          this.error = null;
          this.onDidChangeTreeDataEmitter.fire(undefined);
        }
        return;
      }

      if (event.type === "CONFLICT" || event.type === "SYNC_INSTANCE" || event.type === "REMOVE_INSTANCE" || event.type === "RENAME_INSTANCE") {
        void this.refresh();
      }
    });
  }

  public dispose(): void {
    this.eventSubscription.dispose();
    this.onDidChangeTreeDataEmitter.dispose();
  }

  public async refresh(): Promise<void> {
    try {
      this.conflicts = await this.daemonClient.conflicts();
      this.error = null;
    } catch (error) {
      this.conflicts = [];
      this.error = this.connectionState === "disconnected" ? null : String((error as Error).message ?? error);
    }

    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  public getTreeItem(element: ConflictItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(): Promise<ConflictItem[]> {
    if (this.connectionState !== "disconnected" && this.conflicts.length === 0 && !this.error) {
      await this.refresh();
    }

    if (this.error) {
      return [new ConflictItem(null, "RoSync conflict load failed", this.error)];
    }

    if (this.connectionState === "disconnected") {
      return [new ConflictItem(null, "Daemon disconnected", "Reconnect to load conflicts")];
    }

    if (this.conflicts.length === 0) {
      return [new ConflictItem(null, "No conflicts", "Studio and disk are in agreement")];
    }

    return this.conflicts.map((conflict) => new ConflictItem(conflict, conflict.path, formatTimestamp(conflict.createdAt)));
  }
}
