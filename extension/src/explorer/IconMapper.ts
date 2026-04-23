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
  ServerScriptService: "server",
  ReplicatedStorage: "sync",
  StarterGui: "layout",
  Players: "organization",
  Lighting: "lightbulb",
  SoundService: "unmute",
  TextChatService: "comment-discussion",
  Teams: "people",
};

export function getIcon(className: string): vscode.ThemeIcon {
  const iconName = CLASS_ICONS[className] ?? "circle-small";
  return new vscode.ThemeIcon(iconName);
}
