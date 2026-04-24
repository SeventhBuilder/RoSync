import path from "node:path";
import * as vscode from "vscode";
import { DaemonClient, type ConnectionState, type ProjectTreeNode } from "./daemon/DaemonClient.js";
import { ExplorerProvider } from "./explorer/ExplorerProvider.js";
import { PropertiesProvider } from "./properties/PropertiesProvider.js";
import { StatusProvider } from "./status/StatusProvider.js";

const CREATEABLE_CLASSES = [
  "Folder",
  "Model",
  "Part",
  "Script",
  "LocalScript",
  "ModuleScript",
  "RemoteEvent",
  "RemoteFunction",
  "StringValue",
  "BoolValue",
  "NumberValue",
];

const ROSYNC_SCRIPT_FILES = new Set(["init.server.luau", "init.client.luau", "init.luau"]);

function normalizeFsPath(targetPath: string): string {
  return targetPath.replace(/\\/g, "/");
}

function inferRoSyncNodePath(uri: vscode.Uri): string | null {
  if (uri.scheme !== "file") {
    return null;
  }

  const normalizedPath = normalizeFsPath(uri.fsPath);
  const marker = "/src/";
  const markerIndex = normalizedPath.lastIndexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  const relativePath = normalizedPath.slice(markerIndex + marker.length);
  if (!relativePath) {
    return null;
  }

  const fileName = path.posix.basename(relativePath);
  let candidatePath = relativePath;
  if (fileName === ".instance.json" || ROSYNC_SCRIPT_FILES.has(fileName) || /\.(luau|lua)$/i.test(fileName)) {
    candidatePath = path.posix.dirname(relativePath);
  }

  const normalizedNodePath = candidatePath.replace(/^\/+|\/+$/g, "");
  return normalizedNodePath && normalizedNodePath !== "." ? normalizedNodePath : null;
}

async function openSource(node: ProjectTreeNode): Promise<void> {
  const targetPath = node.sourceFilePath ?? node.metadataPath;
  await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(targetPath));
}

async function copyPath(node: ProjectTreeNode): Promise<void> {
  await vscode.env.clipboard.writeText(node.path);
  void vscode.window.showInformationMessage(`Copied Roblox path: ${node.path}`);
}

async function createInstance(daemonClient: DaemonClient, provider: ExplorerProvider, selectedNode?: ProjectTreeNode): Promise<void> {
  const parentPath = selectedNode?.path;
  if (!parentPath) {
    void vscode.window.showInformationMessage("Select a parent instance or service in RoSync Explorer.");
    return;
  }

  const pickedClass = await vscode.window.showQuickPick(CREATEABLE_CLASSES, {
    title: "RoSync: Create Instance",
    placeHolder: "Choose a Roblox class",
  });
  if (!pickedClass) {
    return;
  }

  const name = await vscode.window.showInputBox({
    title: "RoSync: Instance Name",
    prompt: "Enter the new instance name",
    value: pickedClass,
    validateInput(value) {
      return value.trim() ? undefined : "Instance name is required.";
    },
  });

  if (!name) {
    return;
  }

  await daemonClient.createNode(parentPath, name.trim(), pickedClass);
  await provider.refresh();
}

async function renameInstance(daemonClient: DaemonClient, provider: ExplorerProvider, selectedNode?: ProjectTreeNode): Promise<void> {
  if (!selectedNode) {
    void vscode.window.showInformationMessage("Select an instance to rename.");
    return;
  }

  const nextName = await vscode.window.showInputBox({
    title: "RoSync: Rename Instance",
    value: selectedNode.name,
    validateInput(value) {
      return value.trim() ? undefined : "Instance name is required.";
    },
  });

  if (!nextName || nextName.trim() === selectedNode.name) {
    return;
  }

  await daemonClient.renameNode(selectedNode.path, nextName.trim());
  await provider.refresh();
}

async function deleteInstance(daemonClient: DaemonClient, provider: ExplorerProvider, selectedNode?: ProjectTreeNode): Promise<void> {
  if (!selectedNode) {
    void vscode.window.showInformationMessage("Select an instance to delete.");
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Delete ${selectedNode.path}?`,
    { modal: true },
    "Delete",
  );

  if (confirmation !== "Delete") {
    return;
  }

  await daemonClient.deleteNode(selectedNode.path);
  await provider.refresh();
}

function statusBarTextForState(state: ConnectionState): string {
  switch (state) {
    case "connected":
      return "$(plug) RoSync Connected";
    case "connecting":
      return "$(sync~spin) RoSync Connecting";
    case "reconnecting":
      return "$(sync~spin) RoSync Reconnecting";
    default:
      return "$(debug-disconnect) RoSync Disconnected";
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const log = vscode.window.createOutputChannel("RoSync");
  log.appendLine("RoSync activating...");
  context.subscriptions.push(log);

  try {
    const daemonClient = new DaemonClient();
    const explorerProvider = new ExplorerProvider(daemonClient);

    context.subscriptions.push(
      daemonClient,
      explorerProvider,
      vscode.window.registerTreeDataProvider("rosync.explorer", explorerProvider),
    );
    log.appendLine("Explorer provider registered.");

    const propertiesProvider = new PropertiesProvider(daemonClient);
    const statusProvider = new StatusProvider(daemonClient);
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.text = statusBarTextForState("connecting");
    statusBarItem.tooltip = "RoSync daemon connection status";
    statusBarItem.command = "rosync.refreshExplorer";
    statusBarItem.show();
    const explorerTreeView = vscode.window.createTreeView("rosync.explorer", {
      treeDataProvider: explorerProvider,
    });

    context.subscriptions.push(
      statusProvider,
      propertiesProvider,
      statusBarItem,
      explorerTreeView,
      vscode.window.registerWebviewViewProvider("rosync.properties", propertiesProvider, {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }),
      vscode.window.registerTreeDataProvider("rosync.status", statusProvider),
      vscode.commands.registerCommand("rosync.refreshExplorer", async () => {
        await explorerProvider.refresh();
        await statusProvider.refresh();
      }),
      vscode.commands.registerCommand("rosync.openSource", openSource),
      vscode.commands.registerCommand("rosync.copyPath", copyPath),
      vscode.commands.registerCommand("rosync.createInstance", (node?: ProjectTreeNode) =>
        createInstance(daemonClient, explorerProvider, node),
      ),
      vscode.commands.registerCommand("rosync.renameNode", (node?: ProjectTreeNode) =>
        renameInstance(daemonClient, explorerProvider, node),
      ),
      vscode.commands.registerCommand("rosync.deleteNode", (node?: ProjectTreeNode) =>
        deleteInstance(daemonClient, explorerProvider, node),
      ),
      vscode.workspace.onDidSaveTextDocument((document) => {
        const nodePath = inferRoSyncNodePath(document.uri);
        if (!nodePath) {
          return;
        }

        daemonClient.reportEditorActivity({
          action: "update",
          path: nodePath,
        });
      }),
      vscode.window.createTreeView("rosync.git", {
        treeDataProvider: {
          getTreeItem: (item: vscode.TreeItem) => item,
          getChildren: () => [new vscode.TreeItem("Git integration foundation", vscode.TreeItemCollapsibleState.None)],
        },
      }),
      vscode.window.createTreeView("rosync.agent", {
        treeDataProvider: {
          getTreeItem: (item: vscode.TreeItem) => item,
          getChildren: () => [new vscode.TreeItem("AI agent foundation", vscode.TreeItemCollapsibleState.None)],
        },
      }),
    );

    explorerTreeView.onDidChangeSelection((event) => {
      propertiesProvider.setSelectedNode(explorerProvider.selectedData(event.selection[0]));
    });

    context.subscriptions.push(
      daemonClient.onDidReceiveEvent((event) => {
        if (event.type === "CONNECTION_STATE") {
          statusBarItem.text = statusBarTextForState(event.state);
          statusBarItem.tooltip = event.endpoint
            ? `RoSync daemon: ${event.endpoint.host}:${event.endpoint.port}`
            : "RoSync daemon connection status";
        } else if (event.type === "CONFLICT") {
          void vscode.window.showWarningMessage(`RoSync conflict detected at ${event.conflict.path}`);
        } else if (event.type === "ERROR") {
          statusBarItem.text = "$(warning) RoSync Error";
        }
      }),
    );

    void daemonClient.start().catch((error) => {
      const message = String((error as Error).message ?? error);
      log.appendLine(`RoSync daemon connection failed: ${message}`);
      if (error instanceof Error && error.stack) {
        log.appendLine(error.stack);
      }
      void vscode.window.showWarningMessage(`RoSync daemon connection failed: ${message}`);
    });
    void explorerProvider.refresh();
    void statusProvider.refresh();
    log.appendLine("RoSync activated successfully.");
  } catch (error) {
    const message = String((error as Error).message ?? error);
    log.appendLine(`RoSync activation FAILED: ${message}`);
    if (error instanceof Error && error.stack) {
      log.appendLine(error.stack);
    }
    log.show(true);
    void vscode.window.showErrorMessage("RoSync failed to activate. Check Output > RoSync for details.");
  }
}

export function deactivate(): void {}
