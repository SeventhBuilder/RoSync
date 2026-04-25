import * as vscode from "vscode";

const CLASS_ICONS: Record<string, string> = {
  Script: "file-code",
  LocalScript: "file-code",
  ModuleScript: "extensions",
  Part: "symbol-namespace",
  MeshPart: "symbol-namespace",
  UnionOperation: "symbol-namespace",
  Model: "package",
  ScreenGui: "browser",
  Frame: "window",
  TextLabel: "symbol-string",
  TextButton: "circle-large",
  ImageLabel: "file-media",
  RemoteEvent: "radio-tower",
  RemoteFunction: "radio-tower",
  BindableEvent: "bell",
  BindableFunction: "bell",
  Folder: "folder",
  Configuration: "settings-gear",
  Workspace: "globe",
  Lighting: "lightbulb",
  MaterialService: "symbol-color",
  Players: "organization",
  ReplicatedFirst: "rocket",
  ReplicatedStorage: "references",
  ServerScriptService: "server-process",
  ServerStorage: "archive",
  SoundService: "unmute",
  StarterGui: "layout",
  StarterPack: "package",
  StarterPlayer: "account",
  TextChatService: "comment-discussion",
  Teams: "organization",
};

export function getIcon(className: string): vscode.ThemeIcon {
  const iconName = CLASS_ICONS[className] ?? "circle-small";
  return new vscode.ThemeIcon(iconName);
}
