import * as vscode from "vscode";
import { type ConnectionState, DaemonClient } from "../daemon/DaemonClient.js";
import { getIcon } from "../explorer/IconMapper.js";

interface ServicePlanEntry {
  direction: "push" | "pull";
  service: string;
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
  scanned: number | null;
  serviceIndex: number | null;
  serviceCount: number | null;
  planComplete: boolean;
}

class PlanItem extends vscode.TreeItem {
  public constructor(
    label: string,
    description: string | undefined,
    iconPath: vscode.ThemeIcon,
    tooltip: string,
    contextValue: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = iconPath;
    this.tooltip = tooltip;
    this.contextValue = contextValue;
  }
}

function sortPlans(left: ServicePlanEntry, right: ServicePlanEntry): number {
  if (left.serviceIndex !== null && right.serviceIndex !== null && left.serviceIndex !== right.serviceIndex) {
    return left.serviceIndex - right.serviceIndex;
  }

  return left.service.localeCompare(right.service);
}

export class PlanProvider implements vscode.TreeDataProvider<PlanItem>, vscode.Disposable {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<PlanItem | undefined>();
  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private connectionState: ConnectionState = "disconnected";
  private direction: "push" | "pull" | null = null;
  private completed = false;
  private readonly plans = new Map<string, ServicePlanEntry>();
  private readonly eventSubscription: vscode.Disposable;

  public constructor(private readonly daemonClient: DaemonClient) {
    this.eventSubscription = this.daemonClient.onDidReceiveEvent((event) => {
      if (event.type === "CONNECTION_STATE") {
        this.connectionState = event.state;
        this.onDidChangeTreeDataEmitter.fire(undefined);
        return;
      }

      if (event.type !== "SYNC_PLAN") {
        return;
      }

      if (
        this.direction !== event.direction
        || (event.serviceIndex === 1 && event.serviceCount !== null && event.serviceCount > 0)
      ) {
        this.direction = event.direction;
        this.completed = false;
        this.plans.clear();
      }

      this.plans.set(event.service, {
        direction: event.direction,
        service: event.service,
        added: event.added,
        changed: event.changed,
        removed: event.removed,
        unchanged: event.unchanged,
        scanned: event.scanned,
        serviceIndex: event.serviceIndex,
        serviceCount: event.serviceCount,
        planComplete: event.planComplete,
      });
      this.completed = event.planComplete;
      this.onDidChangeTreeDataEmitter.fire(undefined);
    });
  }

  public dispose(): void {
    this.eventSubscription.dispose();
    this.onDidChangeTreeDataEmitter.dispose();
  }

  public clear(): void {
    this.direction = null;
    this.completed = false;
    this.plans.clear();
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  public getTreeItem(element: PlanItem): vscode.TreeItem {
    return element;
  }

  public getChildren(): PlanItem[] {
    if (this.plans.size === 0) {
      const label = this.connectionState === "disconnected" ? "Daemon disconnected" : "No sync plan yet";
      const description = this.connectionState === "disconnected" ? "Reconnect to receive sync plans" : "Run Push All or Pull All to preview service changes";
      return [
        new PlanItem(label, description, new vscode.ThemeIcon("info"), description, "rosyncPlan.placeholder"),
      ];
    }

    const entries = [...this.plans.values()].sort(sortPlans);
    const totals = {
      added: 0,
      changed: 0,
      removed: 0,
      unchanged: 0,
    };

    for (const entry of entries) {
      totals.added += entry.added;
      totals.changed += entry.changed;
      totals.removed += entry.removed;
      totals.unchanged += entry.unchanged;
    }

    const directionLabel = this.direction === "push" ? "Push" : "Pull";
    const summary = new PlanItem(
      `${directionLabel} Plan${this.completed ? " Ready" : ""}`,
      `${totals.added} add, ${totals.changed} change, ${totals.removed} remove`,
      new vscode.ThemeIcon(this.direction === "push" ? "arrow-up" : "arrow-down"),
      `${directionLabel} plan across ${entries.length} services\n${totals.added} added\n${totals.changed} changed\n${totals.removed} removed\n${totals.unchanged} unchanged`,
      "rosyncPlan.summary",
    );

    const items = [summary];
    for (const entry of entries) {
      const hasChanges = entry.added > 0 || entry.changed > 0 || entry.removed > 0;
      const description = hasChanges
        ? `${entry.added} add, ${entry.changed} change, ${entry.removed} remove`
        : `${entry.unchanged} unchanged`;
      const tooltipLines = [
        `${directionLabel} plan for ${entry.service}`,
        `${entry.added} added`,
        `${entry.changed} changed`,
        `${entry.removed} removed`,
        `${entry.unchanged} unchanged`,
      ];

      if (entry.scanned !== null) {
        tooltipLines.push(`${entry.scanned} scanned in Studio`);
      }

      items.push(
        new PlanItem(
          entry.service,
          description,
          getIcon(entry.service),
          tooltipLines.join("\n"),
          "rosyncPlan.item",
        ),
      );
    }

    return items;
  }
}
