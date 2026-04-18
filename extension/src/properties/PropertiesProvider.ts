import * as vscode from "vscode";
import type { ProjectTreeNode } from "../daemon/DaemonClient.js";

class PropertyItem extends vscode.TreeItem {
  public constructor(label: string, description?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
  }
}

export class PropertiesProvider implements vscode.TreeDataProvider<PropertyItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<PropertyItem | undefined>();
  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private selectedNode: ProjectTreeNode | null = null;

  public setSelectedNode(node: ProjectTreeNode | null): void {
    this.selectedNode = node;
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  public getTreeItem(element: PropertyItem): vscode.TreeItem {
    return element;
  }

  public getChildren(): PropertyItem[] {
    if (!this.selectedNode) {
      return [new PropertyItem("Select an item in RoSync Explorer")];
    }

    const node = this.selectedNode;
    const propertyCount = Object.keys(node.properties ?? {}).length;
    const attributeCount = Object.keys(node.attributes ?? {}).length;
    const tagText = node.tags.length > 0 ? node.tags.join(", ") : "none";

    return [
      new PropertyItem("Class", node.className),
      new PropertyItem("Path", node.path),
      new PropertyItem("Metadata", node.metadataPath),
      new PropertyItem("Source", node.sourceFilePath ?? "none"),
      new PropertyItem("Properties", `${propertyCount}`),
      new PropertyItem("Attributes", `${attributeCount}`),
      new PropertyItem("Tags", tagText),
      new PropertyItem("Children", `${node.children.length}`),
    ];
  }
}
