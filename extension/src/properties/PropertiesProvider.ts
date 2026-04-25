import * as vscode from "vscode";
import { type DaemonEvent, DaemonClient, type ProjectTreeNode, type SchemaClassDescriptor } from "../daemon/DaemonClient.js";

type FieldEditor = "readonly" | "checkbox" | "number" | "text" | "color" | "json";

interface PropertyField {
  name: string;
  group: string;
  encodedType: string;
  editor: FieldEditor;
  displayValue: string;
  inputValue: string | number | boolean;
  detail: string | null;
}

interface PropertyGroup {
  name: string;
  fields: PropertyField[];
}

interface BannerState {
  kind: "info" | "error";
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function createNonce(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)] ?? "x";
  }
  return value;
}

function pathMatches(selectedPath: string, candidatePath: string): boolean {
  return (
    selectedPath === candidatePath ||
    selectedPath.startsWith(`${candidatePath}/`) ||
    candidatePath.startsWith(`${selectedPath}/`)
  );
}

function pathIsWithinService(nodePath: string, serviceName: string): boolean {
  return nodePath === serviceName || nodePath.startsWith(`${serviceName}/`);
}

function renameSelectedPath(selectedPath: string, oldPath: string, newPath: string): string | null {
  if (selectedPath === oldPath) {
    return newPath;
  }

  if (selectedPath.startsWith(`${oldPath}/`)) {
    return `${newPath}${selectedPath.slice(oldPath.length)}`;
  }

  return null;
}

function propertyTypeOf(encoded: unknown): string {
  if (isRecord(encoded) && typeof encoded.type === "string") {
    return encoded.type;
  }

  if (typeof encoded === "boolean") {
    return "bool";
  }

  if (typeof encoded === "number") {
    return Number.isInteger(encoded) ? "int" : "float";
  }

  if (typeof encoded === "string") {
    return "string";
  }

  if (encoded === null) {
    return "null";
  }

  if (Array.isArray(encoded)) {
    return "array";
  }

  return typeof encoded;
}

function propertyValueOf(encoded: unknown): unknown {
  if (isRecord(encoded) && "value" in encoded) {
    return encoded.value;
  }

  if (isRecord(encoded) && "raw" in encoded) {
    return encoded.raw;
  }

  return encoded;
}

function propertyEditorFor(encoded: unknown): FieldEditor {
  if (encoded === undefined) {
    return "readonly";
  }

  const encodedType = propertyTypeOf(encoded);
  if (encodedType === "bool" || encodedType === "boolean") {
    return "checkbox";
  }

  if (encodedType === "int" || encodedType === "float" || encodedType === "number") {
    return "number";
  }

  if (encodedType === "string" || encodedType === "BinaryString" || encodedType === "Content" || encodedType === "EnumItem") {
    return "text";
  }

  if (encodedType === "Color3") {
    return "color";
  }

  if (
    encodedType === "Vector3" ||
    encodedType === "Vector2" ||
    encodedType === "CFrame" ||
    encodedType === "UDim" ||
    encodedType === "UDim2" ||
    encodedType === "NumberRange" ||
    encodedType === "Rect" ||
    encodedType === "ColorSequence" ||
    encodedType === "NumberSequence" ||
    encodedType === "unknown"
  ) {
    return "json";
  }

  return "readonly";
}

function describeEncodedValue(encoded: unknown): string {
  if (encoded === undefined) {
    return "Not serialized yet";
  }

  const rawValue = propertyValueOf(encoded);
  if (typeof rawValue === "boolean" || typeof rawValue === "number" || typeof rawValue === "string") {
    return String(rawValue);
  }

  try {
    return JSON.stringify(encoded, null, 2);
  } catch {
    return String(encoded);
  }
}

function colorHexFromEncoded(encoded: unknown): string {
  const rawValue = propertyValueOf(encoded);
  if (!Array.isArray(rawValue) || rawValue.length < 3) {
    return "#808080";
  }

  const [r, g, b] = rawValue;
  const values = [r, g, b].map((channel) => {
    const numeric = typeof channel === "number" ? channel : 0;
    return Math.max(0, Math.min(255, Math.round(numeric * 255)));
  });
  return `#${values.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function colorLabelFromEncoded(encoded: unknown): string {
  const rawValue = propertyValueOf(encoded);
  if (!Array.isArray(rawValue) || rawValue.length < 3) {
    return "Color3";
  }

  const [r, g, b] = rawValue;
  const values = [r, g, b].map((channel) => (typeof channel === "number" ? channel.toFixed(3) : "0.000"));
  return `Color3(${values.join(", ")})`;
}

function colorFromHex(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#808080";
  return [
    parseInt(normalized.slice(1, 3), 16) / 255,
    parseInt(normalized.slice(3, 5), 16) / 255,
    parseInt(normalized.slice(5, 7), 16) / 255,
  ];
}

function summaryText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function propertyGroupName(propertyName: string): string {
  const transformNames = new Set(["Position", "CFrame", "Orientation", "Rotation", "Size", "PivotOffset", "WorldPivot"]);
  const appearanceNames = new Set([
    "Color",
    "BrickColor",
    "Material",
    "MaterialVariant",
    "Transparency",
    "Reflectance",
    "CastShadow",
    "TextureID",
    "Face",
    "Shape",
  ]);
  const behaviorNames = new Set([
    "Anchored",
    "CanCollide",
    "CanTouch",
    "CanQuery",
    "Locked",
    "Enabled",
    "Visible",
    "Active",
    "Archivable",
    "Disabled",
    "Massless",
  ]);

  if (transformNames.has(propertyName)) {
    return "Transform";
  }

  if (propertyName.includes("Surface")) {
    return "Surface";
  }

  if (appearanceNames.has(propertyName) || propertyName.includes("Color") || propertyName.includes("Material")) {
    return "Appearance";
  }

  if (behaviorNames.has(propertyName)) {
    return "Behavior";
  }

  if (propertyName.includes("Script") || propertyName.includes("Source")) {
    return "Script";
  }

  return "Data";
}

function compareFields(left: PropertyField, right: PropertyField): number {
  const groupCompare = left.group.localeCompare(right.group);
  if (groupCompare !== 0) {
    return groupCompare;
  }

  return left.name.localeCompare(right.name);
}

function fieldForProperty(name: string, encoded: unknown): PropertyField {
  if (encoded === undefined) {
    return {
      name,
      group: propertyGroupName(name),
      encodedType: "unknown",
      editor: "readonly",
      displayValue: "Not serialized yet",
      inputValue: "",
      detail: "Available in the schema, but this property is not currently stored on disk.",
    };
  }

  const encodedType = propertyTypeOf(encoded);
  const editor = propertyEditorFor(encoded);
  const rawValue = propertyValueOf(encoded);

  if (editor === "checkbox") {
    return {
      name,
      group: propertyGroupName(name),
      encodedType,
      editor,
      displayValue: String(Boolean(rawValue)),
      inputValue: Boolean(rawValue),
      detail: null,
    };
  }

  if (editor === "number") {
    const numericValue = typeof rawValue === "number" ? rawValue : Number(rawValue ?? 0);
    return {
      name,
      group: propertyGroupName(name),
      encodedType,
      editor,
      displayValue: String(numericValue),
      inputValue: Number.isFinite(numericValue) ? numericValue : 0,
      detail: null,
    };
  }

  if (editor === "text") {
    return {
      name,
      group: propertyGroupName(name),
      encodedType,
      editor,
      displayValue: String(rawValue ?? ""),
      inputValue: String(rawValue ?? ""),
      detail: null,
    };
  }

  if (editor === "color") {
    return {
      name,
      group: propertyGroupName(name),
      encodedType,
      editor,
      displayValue: colorLabelFromEncoded(encoded),
      inputValue: colorHexFromEncoded(encoded),
      detail: null,
    };
  }

  if (editor === "json") {
    return {
      name,
      group: propertyGroupName(name),
      encodedType,
      editor,
      displayValue: describeEncodedValue(encoded),
      inputValue: JSON.stringify(encoded, null, 2),
      detail: "Advanced encoded value. Edit carefully; malformed JSON will be rejected.",
    };
  }

  return {
    name,
    group: propertyGroupName(name),
    encodedType,
    editor,
    displayValue: describeEncodedValue(encoded),
    inputValue: describeEncodedValue(encoded),
    detail: null,
  };
}

function buildPropertyGroups(node: ProjectTreeNode, schema: SchemaClassDescriptor | null): PropertyGroup[] {
  const propertyNames = new Set<string>([...(schema?.properties ?? []), ...Object.keys(node.properties ?? {})]);
  const fields = [...propertyNames].map((name) => fieldForProperty(name, node.properties[name])).sort(compareFields);
  const groups = new Map<string, PropertyField[]>();

  for (const field of fields) {
    const existing = groups.get(field.group);
    if (existing) {
      existing.push(field);
    } else {
      groups.set(field.group, [field]);
    }
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, groupFields]) => ({
      name,
      fields: groupFields.sort((left, right) => left.name.localeCompare(right.name)),
    }));
}

function encodeEditedProperty(currentEncoded: unknown, editor: FieldEditor, rawValue: unknown): unknown {
  const currentRecord = isRecord(currentEncoded) ? currentEncoded : {};
  const currentType = typeof currentRecord.type === "string" ? currentRecord.type : propertyTypeOf(currentEncoded);

  if (editor === "checkbox") {
    return {
      type: currentType === "boolean" ? "bool" : currentType || "bool",
      value: Boolean(rawValue),
    };
  }

  if (editor === "number") {
    const numericValue = Number(rawValue);
    if (!Number.isFinite(numericValue)) {
      throw new Error("Expected a valid number.");
    }

    const nextType =
      currentType === "int" ? "int" : currentType === "float" || currentType === "number" ? "float" : Number.isInteger(numericValue) ? "int" : "float";
    return {
      type: nextType,
      value: nextType === "int" ? Math.trunc(numericValue) : numericValue,
    };
  }

  if (editor === "text") {
    const nextType = currentType && currentType !== "undefined" ? currentType : "string";
    return {
      type: nextType,
      value: String(rawValue ?? ""),
    };
  }

  if (editor === "color") {
    if (typeof rawValue !== "string") {
      throw new Error("Expected a hex color value.");
    }

    return {
      type: "Color3",
      value: colorFromHex(rawValue),
    };
  }

  if (editor === "json") {
    if (typeof rawValue !== "string" || rawValue.trim() === "") {
      throw new Error("Expected encoded JSON.");
    }

    return JSON.parse(rawValue) as unknown;
  }

  throw new Error("This property is read-only in the current panel.");
}

function renderField(field: PropertyField): string {
  const sharedMeta = `
    <div class="field-header">
      <div class="field-name">${escapeHtml(field.name)}</div>
      <div class="field-badge">${escapeHtml(field.encodedType)}</div>
    </div>
  `;
  const detailHtml = field.detail ? `<div class="field-detail">${escapeHtml(field.detail)}</div>` : "";

  if (field.editor === "checkbox") {
    return `
      <div class="field">
        ${sharedMeta}
        <label class="checkbox-row">
          <input type="checkbox" data-editor="checkbox" data-name="${escapeHtml(field.name)}" ${field.inputValue ? "checked" : ""} />
          <span>${escapeHtml(field.displayValue)}</span>
        </label>
        ${detailHtml}
      </div>
    `;
  }

  if (field.editor === "number") {
    return `
      <div class="field">
        ${sharedMeta}
        <input class="input" type="number" step="any" value="${escapeHtml(String(field.inputValue))}" data-editor="number" data-name="${escapeHtml(field.name)}" />
        ${detailHtml}
      </div>
    `;
  }

  if (field.editor === "text") {
    return `
      <div class="field">
        ${sharedMeta}
        <input class="input" type="text" value="${escapeHtml(String(field.inputValue))}" data-editor="text" data-name="${escapeHtml(field.name)}" />
        ${detailHtml}
      </div>
    `;
  }

  if (field.editor === "color") {
    return `
      <div class="field">
        ${sharedMeta}
        <div class="color-row">
          <input class="color-input" type="color" value="${escapeHtml(String(field.inputValue))}" data-editor="color" data-name="${escapeHtml(field.name)}" />
          <span class="color-label">${escapeHtml(field.displayValue)}</span>
        </div>
        ${detailHtml}
      </div>
    `;
  }

  if (field.editor === "json") {
    return `
      <div class="field">
        ${sharedMeta}
        <textarea class="textarea" rows="4" data-editor="json" data-name="${escapeHtml(field.name)}">${escapeHtml(String(field.inputValue))}</textarea>
        ${detailHtml}
      </div>
    `;
  }

  return `
    <div class="field">
      ${sharedMeta}
      <pre class="readonly">${escapeHtml(field.displayValue)}</pre>
      ${detailHtml}
    </div>
  `;
}

export class PropertiesProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | null = null;
  private selectedNode: ProjectTreeNode | null = null;
  private schema: SchemaClassDescriptor | null = null;
  private banner: BannerState | null = null;
  private loading = false;
  private activeStudioPushService: string | null = null;
  private readonly eventSubscription: vscode.Disposable;

  public constructor(private readonly daemonClient: DaemonClient) {
    this.eventSubscription = this.daemonClient.onDidReceiveEvent((event) => {
      void this.handleDaemonEvent(event);
    });
  }

  public dispose(): void {
    this.eventSubscription.dispose();
  }

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
    };

    view.webview.onDidReceiveMessage((message: unknown) => {
      void this.handleMessage(message);
    });

    view.onDidDispose(() => {
      if (this.view === view) {
        this.view = null;
      }
    });

    this.render();
  }

  public setSelectedNode(node: ProjectTreeNode | null): void {
    if (!node) {
      this.selectedNode = null;
      this.schema = null;
      this.loading = false;
      this.banner = null;
      this.render();
      return;
    }

    this.selectedNode = node;
    this.loading = true;
    this.banner = {
      kind: "info",
      message: `Loading ${node.path}…`,
    };
    this.render();
    void this.refreshSelection(node.path);
  }

  private async handleDaemonEvent(event: DaemonEvent): Promise<void> {
    if (!this.selectedNode) {
      return;
    }

    switch (event.type) {
      case "SYNC_INSTANCE":
        if (
          event.origin === "studio" &&
          this.activeStudioPushService &&
          pathIsWithinService(this.selectedNode.path, this.activeStudioPushService)
        ) {
          return;
        }

        if (pathMatches(this.selectedNode.path, event.path)) {
          await this.refreshSelection(this.selectedNode.path, false);
        }
        return;
      case "PUSH_PROGRESS":
        this.activeStudioPushService = event.pushComplete ? null : event.service;
        if (pathIsWithinService(this.selectedNode.path, event.service) && event.serviceComplete) {
          await this.refreshSelection(this.selectedNode.path, false);
          if (event.pushComplete) {
            this.activeStudioPushService = null;
          }
        }
        return;
      case "RENAME_INSTANCE": {
        const nextPath = renameSelectedPath(this.selectedNode.path, event.oldPath, event.newPath);
        if (nextPath) {
          this.selectedNode = {
            ...this.selectedNode,
            path: nextPath,
          };
          await this.refreshSelection(nextPath, false);
        }
        return;
      }
      case "REMOVE_INSTANCE":
        if (pathMatches(this.selectedNode.path, event.path)) {
          this.selectedNode = null;
          this.schema = null;
          this.loading = false;
          this.banner = {
            kind: "info",
            message: `Selected instance was removed: ${event.path}`,
          };
          this.render();
        }
        return;
      case "WELCOME":
        await this.refreshSelection(this.selectedNode.path, false);
        return;
      case "CONNECTION_STATE":
        if (event.state === "disconnected") {
          this.activeStudioPushService = null;
        }
        return;
      case "ERROR":
        this.banner = {
          kind: "error",
          message: event.message,
        };
        this.render();
        return;
      default:
        return;
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!this.selectedNode || !isRecord(message) || typeof message.type !== "string") {
      return;
    }

    if (message.type === "updateProperty" && typeof message.name === "string" && typeof message.editor === "string") {
      await this.applyPropertyUpdate(message.name, message.editor as FieldEditor, message.value);
      return;
    }

    if (message.type === "updateAttributes" && typeof message.value === "string") {
      await this.applyAttributesUpdate(message.value);
      return;
    }

    if (message.type === "updateTags" && typeof message.value === "string") {
      await this.applyTagsUpdate(message.value);
    }
  }

  private async refreshSelection(nodePath: string, showLoading = true): Promise<void> {
    if (showLoading) {
      this.loading = true;
      this.render();
    }

    try {
      const node = await this.daemonClient.node(nodePath);
      const schema = await this.daemonClient.schema(node.className);
      if (!this.selectedNode || this.selectedNode.path !== nodePath) {
        return;
      }

      this.selectedNode = node;
      this.schema = schema;
      this.loading = false;
      this.banner = null;
      this.render();
    } catch (error) {
      if (!this.selectedNode || this.selectedNode.path !== nodePath) {
        return;
      }

      this.loading = false;
      this.banner = {
        kind: "error",
        message: String((error as Error).message ?? error),
      };
      this.render();
    }
  }

  private async applyPropertyUpdate(name: string, editor: FieldEditor, rawValue: unknown): Promise<void> {
    if (!this.selectedNode) {
      return;
    }

    try {
      const nextProperties = {
        ...this.selectedNode.properties,
        [name]: encodeEditedProperty(this.selectedNode.properties[name], editor, rawValue),
      };
      const nextNode = await this.daemonClient.patchNode(this.selectedNode.path, {
        properties: nextProperties,
      });
      this.selectedNode = nextNode;
      this.schema = await this.daemonClient.schema(nextNode.className);
      this.banner = {
        kind: "info",
        message: `Saved ${name} on ${nextNode.path}`,
      };
    } catch (error) {
      this.banner = {
        kind: "error",
        message: `Failed to save ${name}: ${String((error as Error).message ?? error)}`,
      };
    }

    this.render();
  }

  private async applyAttributesUpdate(rawAttributes: string): Promise<void> {
    if (!this.selectedNode) {
      return;
    }

    try {
      const parsed = JSON.parse(rawAttributes) as unknown;
      if (!isRecord(parsed)) {
        throw new Error("Attributes must be a JSON object.");
      }

      const nextNode = await this.daemonClient.patchNode(this.selectedNode.path, {
        attributes: parsed,
      });
      this.selectedNode = nextNode;
      this.banner = {
        kind: "info",
        message: `Saved attributes on ${nextNode.path}`,
      };
    } catch (error) {
      this.banner = {
        kind: "error",
        message: `Failed to save attributes: ${String((error as Error).message ?? error)}`,
      };
    }

    this.render();
  }

  private async applyTagsUpdate(rawTags: string): Promise<void> {
    if (!this.selectedNode) {
      return;
    }

    try {
      const tags = rawTags
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);

      const nextNode = await this.daemonClient.patchNode(this.selectedNode.path, {
        tags,
      });
      this.selectedNode = nextNode;
      this.banner = {
        kind: "info",
        message: `Saved tags on ${nextNode.path}`,
      };
    } catch (error) {
      this.banner = {
        kind: "error",
        message: `Failed to save tags: ${String((error as Error).message ?? error)}`,
      };
    }

    this.render();
  }

  private render(): void {
    if (!this.view) {
      return;
    }

    const webview = this.view.webview;
    const nonce = createNonce();

    if (!this.selectedNode) {
      webview.html = this.renderShell(
        webview,
        nonce,
        `
          <div class="empty-state">
            <h2>Select an instance in RoSync Explorer</h2>
            <p>The property panel will show schema-backed properties, attributes, tags, and live editable fields here.</p>
          </div>
        `,
      );
      return;
    }

    const propertyGroups = buildPropertyGroups(this.selectedNode, this.schema);
    const propertiesHtml =
      propertyGroups.length > 0
        ? propertyGroups
            .map(
              (group) => `
                <section class="group">
                  <div class="group-header">
                    <h3>${escapeHtml(group.name)}</h3>
                    <span>${group.fields.length}</span>
                  </div>
                  <div class="group-body">
                    ${group.fields.map((field) => renderField(field)).join("")}
                  </div>
                </section>
              `,
            )
            .join("")
        : `
            <section class="group">
              <div class="group-header">
                <h3>Properties</h3>
                <span>0</span>
              </div>
              <div class="group-body">
                <div class="field-detail">No serialized properties are available for this node yet.</div>
              </div>
            </section>
          `;

    const bannerHtml = this.banner
      ? `<div class="banner ${this.banner.kind}">${escapeHtml(this.banner.message)}</div>`
      : "";

    const body = `
      ${bannerHtml}
      <section class="hero">
        <div class="hero-title">
          <h1>${escapeHtml(this.selectedNode.name)}</h1>
          <span>${escapeHtml(this.selectedNode.className)}</span>
        </div>
        <div class="hero-meta">
          <div>
            <label>Path</label>
            <code>${escapeHtml(this.selectedNode.path)}</code>
          </div>
          <div>
            <label>Source</label>
            <code>${escapeHtml(this.selectedNode.sourceFilePath ?? "none")}</code>
          </div>
          <div>
            <label>Schema</label>
            <code>${escapeHtml(this.schema?.name ?? this.selectedNode.className)}</code>
          </div>
        </div>
        <p class="hero-copy">
          Typed fields update immediately. Complex encoded values stay visible and can still be edited as JSON when RoSync knows how to round-trip them safely.
        </p>
      </section>
      <section class="group">
        <div class="group-header">
          <h3>Attributes</h3>
          <span>${Object.keys(this.selectedNode.attributes ?? {}).length}</span>
        </div>
        <div class="group-body">
          <textarea class="textarea" rows="5" id="attributes-input">${escapeHtml(JSON.stringify(this.selectedNode.attributes ?? {}, null, 2))}</textarea>
          <div class="field-detail">Blur the editor or press Ctrl/Cmd+Enter to save attributes as JSON.</div>
        </div>
      </section>
      <section class="group">
        <div class="group-header">
          <h3>Tags</h3>
          <span>${this.selectedNode.tags.length}</span>
        </div>
        <div class="group-body">
          <input class="input" type="text" id="tags-input" value="${escapeHtml(this.selectedNode.tags.join(", "))}" />
          <div class="field-detail">Comma-separated tags are synced immediately on blur or Enter.</div>
        </div>
      </section>
      ${propertiesHtml}
    `;

    webview.html = this.renderShell(webview, nonce, body);
  }

  private renderShell(webview: vscode.Webview, nonce: string, body: string): string {
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>RoSync Properties</title>
    <style>
      :root {
        color-scheme: dark;
      }

      body {
        margin: 0;
        padding: 16px;
        color: var(--vscode-foreground);
        background: var(--vscode-sideBar-background);
        font-family: var(--vscode-font-family);
      }

      .empty-state,
      .hero,
      .group {
        background: color-mix(in srgb, var(--vscode-sideBar-background) 65%, var(--vscode-editor-background));
        border: 1px solid color-mix(in srgb, var(--vscode-foreground) 14%, transparent);
        border-radius: 12px;
        padding: 14px;
        margin-bottom: 14px;
      }

      .hero-title,
      .group-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .hero-title h1,
      .group-header h3 {
        margin: 0;
        font-size: 15px;
        font-weight: 700;
      }

      .hero-title span,
      .group-header span,
      .field-badge {
        padding: 4px 8px;
        border-radius: 999px;
        font-size: 11px;
        background: color-mix(in srgb, var(--vscode-textLink-foreground) 18%, transparent);
        color: var(--vscode-textLink-foreground);
      }

      .hero-meta {
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
        margin-top: 14px;
      }

      .hero-meta label {
        display: block;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        margin-bottom: 4px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .hero-copy,
      .field-detail,
      .empty-state p {
        color: var(--vscode-descriptionForeground);
        line-height: 1.5;
      }

      .banner {
        padding: 10px 12px;
        border-radius: 10px;
        margin-bottom: 14px;
        border: 1px solid transparent;
      }

      .banner.info {
        background: color-mix(in srgb, var(--vscode-textLink-foreground) 18%, transparent);
        border-color: color-mix(in srgb, var(--vscode-textLink-foreground) 28%, transparent);
      }

      .banner.error {
        background: color-mix(in srgb, var(--vscode-errorForeground) 18%, transparent);
        border-color: color-mix(in srgb, var(--vscode-errorForeground) 32%, transparent);
      }

      .group-body {
        display: grid;
        gap: 12px;
        margin-top: 12px;
      }

      .field {
        background: color-mix(in srgb, var(--vscode-editor-background) 88%, transparent);
        border-radius: 10px;
        border: 1px solid color-mix(in srgb, var(--vscode-foreground) 10%, transparent);
        padding: 10px;
      }

      .field-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 8px;
      }

      .field-name {
        font-weight: 600;
      }

      .input,
      .textarea,
      .readonly,
      code {
        box-sizing: border-box;
        width: 100%;
        border-radius: 8px;
        border: 1px solid color-mix(in srgb, var(--vscode-input-border) 70%, transparent);
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        padding: 8px 10px;
        font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
        font-size: 12px;
      }

      .textarea {
        min-height: 96px;
        resize: vertical;
      }

      .readonly {
        white-space: pre-wrap;
        margin: 0;
      }

      .checkbox-row,
      .color-row {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .color-input {
        width: 44px;
        height: 32px;
        border: none;
        background: transparent;
        padding: 0;
      }

      .color-label {
        color: var(--vscode-descriptionForeground);
      }

      .empty-state h2 {
        margin-top: 0;
        font-size: 16px;
      }
    </style>
  </head>
  <body>
    ${body}
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();

      function wireInputs(selector, handler) {
        for (const element of document.querySelectorAll(selector)) {
          handler(element);
        }
      }

      wireInputs("[data-editor]", (element) => {
        const editor = element.dataset.editor;
        const name = element.dataset.name;
        const commit = () => {
          const value = editor === "checkbox" ? Boolean(element.checked) : element.value;
          vscode.postMessage({
            type: "updateProperty",
            name,
            editor,
            value,
          });
        };

        if (editor === "checkbox" || editor === "color") {
          element.addEventListener("change", commit);
          return;
        }

        element.addEventListener("blur", commit);
        element.addEventListener("keydown", (event) => {
          if ((editor === "json" && (event.metaKey || event.ctrlKey) && event.key === "Enter") || (editor !== "json" && event.key === "Enter")) {
            event.preventDefault();
            commit();
            element.blur();
          }
        });
      });

      const attributesInput = document.getElementById("attributes-input");
      if (attributesInput) {
        const commitAttributes = () =>
          vscode.postMessage({
            type: "updateAttributes",
            value: attributesInput.value,
          });

        attributesInput.addEventListener("blur", commitAttributes);
        attributesInput.addEventListener("keydown", (event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            commitAttributes();
            attributesInput.blur();
          }
        });
      }

      const tagsInput = document.getElementById("tags-input");
      if (tagsInput) {
        const commitTags = () =>
          vscode.postMessage({
            type: "updateTags",
            value: tagsInput.value,
          });

        tagsInput.addEventListener("blur", commitTags);
        tagsInput.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitTags();
            tagsInput.blur();
          }
        });
      }
    </script>
  </body>
</html>`;
  }
}
