import * as vscode from "vscode";
import { DaemonClient, type DaemonHealth } from "../daemon/DaemonClient.js";

class StatusItem extends vscode.TreeItem {
  public constructor(label: string, description?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
  }
}

export class StatusProvider implements vscode.TreeDataProvider<StatusItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<StatusItem | undefined>();
  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private health: DaemonHealth | null = null;
  private error: string | null = null;

  public constructor(private readonly daemonClient: DaemonClient) {}

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
    if (!this.health && !this.error) {
      await this.refresh();
    }

    if (this.error) {
      return [new StatusItem("Daemon disconnected", this.error)];
    }

    if (!this.health) {
      return [new StatusItem("Loading daemon status...")];
    }

    return [
      new StatusItem("Project", this.health.project),
      new StatusItem("Daemon", `${this.health.host}:${this.health.port}`),
      new StatusItem("Indexed instances", `${this.health.summary.indexedInstances}`),
      new StatusItem("Script files", `${this.health.summary.scriptFiles}`),
      new StatusItem("Ignored entries", `${this.health.summary.ignoredEntries}`),
      new StatusItem("Studio clients", `${this.health.connections.studio}`),
      new StatusItem("Editor clients", `${this.health.connections.editor}`),
      new StatusItem("Schema version", this.health.schema.version ?? "unknown"),
      new StatusItem("Schema fetched", this.health.schema.fetchedAt),
    ];
  }
}
