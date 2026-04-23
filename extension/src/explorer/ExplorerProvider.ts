import * as vscode from "vscode";
import { type DaemonEvent, DaemonClient, type ProjectTreeNode, type ProjectTreeSnapshot } from "../daemon/DaemonClient.js";
import { getIcon } from "./IconMapper.js";

function cloneNode(node: ProjectTreeNode): ProjectTreeNode {
  return {
    ...node,
    properties: { ...node.properties },
    attributes: { ...node.attributes },
    tags: [...node.tags],
    children: node.children.map((child) => cloneNode(child)),
  };
}

function replaceOrInsertNode(nodes: ProjectTreeNode[], nextNode: ProjectTreeNode): ProjectTreeNode[] {
  const nextParentPath = nextNode.path.includes("/") ? nextNode.path.split("/").slice(0, -1).join("/") : null;
  const nextNodes = nodes.map((node) => cloneNode(node));

  if (!nextParentPath) {
    const existingIndex = nextNodes.findIndex((node) => node.path === nextNode.path);
    if (existingIndex === -1) {
      nextNodes.push(cloneNode(nextNode));
    } else {
      nextNodes[existingIndex] = cloneNode(nextNode);
    }
    return nextNodes;
  }

  function visit(children: ProjectTreeNode[]): boolean {
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (child.path === nextParentPath) {
        const childIndex = child.children.findIndex((entry) => entry.path === nextNode.path);
        if (childIndex === -1) {
          child.children.push(cloneNode(nextNode));
        } else {
          child.children[childIndex] = cloneNode(nextNode);
        }
        return true;
      }
      if (visit(child.children)) {
        return true;
      }
    }
    return false;
  }

  visit(nextNodes);
  return nextNodes;
}

function removeNodeByPath(nodes: ProjectTreeNode[], targetPath: string): ProjectTreeNode[] {
  const filtered = nodes
    .filter((node) => node.path !== targetPath)
    .map((node) => ({
      ...cloneNode(node),
      children: removeNodeByPath(node.children, targetPath),
    }));

  return filtered;
}

export class ExplorerNode extends vscode.TreeItem {
  public constructor(
    public readonly data: ProjectTreeNode,
    private readonly isConflict: boolean,
  ) {
    super(
      data.name,
      data.children.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    this.id = data.path;
    this.description = this.isConflict ? `[${data.className}] conflict` : `[${data.className}]`;
    this.tooltip = `${data.path}\n${data.className}`;
    this.contextValue = "rosyncExplorer.node";
    this.iconPath = this.isConflict ? new vscode.ThemeIcon("warning") : getIcon(data.className);
    this.resourceUri = vscode.Uri.file(data.sourceFilePath ?? data.metadataPath);
    this.command = {
      command: "rosync.openSource",
      title: "Open Source",
      arguments: [data],
    };
  }
}

export class ExplorerProvider implements vscode.TreeDataProvider<ExplorerNode>, vscode.Disposable {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<ExplorerNode | undefined>();
  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private treeSnapshot: ProjectTreeSnapshot | null = null;
  private loadError: string | null = null;
  private readonly conflictPaths = new Set<string>();
  private readonly eventSubscription: vscode.Disposable;

  public constructor(private readonly daemonClient: DaemonClient) {
    this.eventSubscription = this.daemonClient.onDidReceiveEvent((event) => {
      void this.handleDaemonEvent(event);
    });
  }

  public dispose(): void {
    this.eventSubscription.dispose();
    this.onDidChangeTreeDataEmitter.dispose();
  }

  public async refresh(): Promise<void> {
    try {
      this.treeSnapshot = await this.daemonClient.tree();
      this.loadError = null;
    } catch (error) {
      this.treeSnapshot = null;
      this.loadError = String((error as Error).message ?? error);
    }

    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  public getTreeItem(element: ExplorerNode): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: ExplorerNode): Promise<ExplorerNode[]> {
    if (!this.treeSnapshot && !this.loadError) {
      await this.refresh();
    }

    if (this.loadError) {
      return [
        new ExplorerNode(
          {
            name: "RoSync daemon unavailable",
            className: "Status",
            path: "status",
            relativePath: "",
            directoryPath: "",
            metadataPath: "",
            sourceFilePath: null,
            scriptKind: null,
            properties: {},
            attributes: {},
            tags: [],
            source: null,
            children: [],
          },
          false,
        ),
      ];
    }

    const nodes = element ? element.data.children : this.treeSnapshot?.services ?? [];
    return nodes.map((node) => new ExplorerNode(node, this.conflictPaths.has(node.path)));
  }

  public selectedData(node: ExplorerNode | undefined): ProjectTreeNode | null {
    return node?.data ?? null;
  }

  private async handleDaemonEvent(event: DaemonEvent): Promise<void> {
    switch (event.type) {
      case "WELCOME":
        await this.refresh();
        return;
      case "SYNC_INSTANCE": {
        if (!this.treeSnapshot) {
          await this.refresh();
          return;
        }
        const nextNode = await this.daemonClient.node(event.path);
        this.treeSnapshot = {
          ...this.treeSnapshot,
          services: replaceOrInsertNode(this.treeSnapshot.services, nextNode),
        };
        this.conflictPaths.delete(event.path);
        this.onDidChangeTreeDataEmitter.fire(undefined);
        return;
      }
      case "REMOVE_INSTANCE":
        if (this.treeSnapshot) {
          this.treeSnapshot = {
            ...this.treeSnapshot,
            services: removeNodeByPath(this.treeSnapshot.services, event.path),
          };
          this.conflictPaths.delete(event.path);
          this.onDidChangeTreeDataEmitter.fire(undefined);
        }
        return;
      case "RENAME_INSTANCE":
        if (!this.treeSnapshot) {
          await this.refresh();
          return;
        }
        this.treeSnapshot = {
          ...this.treeSnapshot,
          services: removeNodeByPath(this.treeSnapshot.services, event.oldPath),
        };
        this.conflictPaths.delete(event.oldPath);
        const renamedNode = await this.daemonClient.node(event.newPath);
        this.treeSnapshot = {
          ...this.treeSnapshot,
          services: replaceOrInsertNode(this.treeSnapshot.services, renamedNode),
        };
        this.onDidChangeTreeDataEmitter.fire(undefined);
        return;
      case "CONFLICT":
        this.conflictPaths.add(event.conflict.path);
        this.onDidChangeTreeDataEmitter.fire(undefined);
        return;
      case "CONNECTION_STATE":
        if (event.state === "disconnected") {
          this.loadError = "Daemon disconnected";
          this.onDidChangeTreeDataEmitter.fire(undefined);
        }
        return;
      case "ERROR":
        this.loadError = event.message;
        this.onDidChangeTreeDataEmitter.fire(undefined);
        return;
      default:
        return;
    }
  }
}
