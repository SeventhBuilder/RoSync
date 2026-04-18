import * as vscode from "vscode";
import { DaemonClient, type ProjectTreeNode, type ProjectTreeSnapshot } from "../daemon/DaemonClient.js";

export class ExplorerNode extends vscode.TreeItem {
  public constructor(public readonly data: ProjectTreeNode) {
    super(
      data.name,
      data.children.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    this.id = data.path;
    this.description = `[${data.className}]`;
    this.tooltip = `${data.path}\n${data.className}`;
    this.contextValue = "rosyncExplorer.node";
    this.iconPath = new vscode.ThemeIcon(iconIdForNode(data));
    this.resourceUri = vscode.Uri.file(data.sourceFilePath ?? data.metadataPath);
    this.command = {
      command: "rosync.openSource",
      title: "Open Source",
      arguments: [data],
    };
  }
}

function iconIdForNode(node: ProjectTreeNode): string {
  switch (node.className) {
    case "Workspace":
      return "project";
    case "Folder":
    case "Model":
      return "folder";
    case "Script":
    case "LocalScript":
    case "ModuleScript":
      return "file-code";
    case "Part":
      return "symbol-object";
    case "RemoteEvent":
    case "RemoteFunction":
      return "radio-tower";
    default:
      return node.children.length > 0 ? "folder" : "symbol-field";
  }
}

export class ExplorerProvider implements vscode.TreeDataProvider<ExplorerNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<ExplorerNode | undefined>();
  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private treeSnapshot: ProjectTreeSnapshot | null = null;
  private loadError: string | null = null;

  public constructor(private readonly daemonClient: DaemonClient) {}

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
        new ExplorerNode({
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
        }),
      ];
    }

    const nodes = element ? element.data.children : this.treeSnapshot?.services ?? [];
    return nodes.map((node) => new ExplorerNode(node));
  }

  public selectedData(node: ExplorerNode | undefined): ProjectTreeNode | null {
    return node?.data ?? null;
  }
}
