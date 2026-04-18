import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolvedRoSyncConfig } from "../config/types.js";
import type { SchemaCache } from "./types.js";

const PRIMARY_SCHEMA_URL =
  "https://raw.githubusercontent.com/MaximumADHD/Roblox-Client-Tracker/roblox/API-Dump.json";

function bundledSchemaPath(): string {
  return fileURLToPath(new URL("../../assets/bundled-schema.json", import.meta.url));
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content) as T;
}

async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function extractVersion(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const versionCandidates = [record.Version, record.version, record.ClientVersionUpload];
  for (const candidate of versionCandidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate;
    }
  }

  return null;
}

function extractClasses(raw: unknown): SchemaCache["classes"] {
  if (typeof raw !== "object" || raw === null) {
    return {};
  }

  const record = raw as Record<string, unknown>;
  const classes = Array.isArray(record.Classes) ? record.Classes : Array.isArray(record.classes) ? record.classes : [];
  const result: SchemaCache["classes"] = {};

  for (const entry of classes) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }

    const descriptor = entry as Record<string, unknown>;
    const name = typeof descriptor.Name === "string" ? descriptor.Name : typeof descriptor.name === "string" ? descriptor.name : null;
    if (!name) {
      continue;
    }

    const members = Array.isArray(descriptor.Members) ? descriptor.Members : Array.isArray(descriptor.members) ? descriptor.members : [];
    const properties = members
      .filter((member) => typeof member === "object" && member !== null)
      .map((member) => member as Record<string, unknown>)
      .filter((member) => {
        const memberType = typeof member.MemberType === "string" ? member.MemberType : typeof member.memberType === "string" ? member.memberType : "";
        return memberType === "Property";
      })
      .map((member) => {
        const propertyName = typeof member.Name === "string" ? member.Name : typeof member.name === "string" ? member.name : null;
        return propertyName;
      })
      .filter((value): value is string => typeof value === "string");

    result[name] = {
      name,
      properties,
    };
  }

  return result;
}

export async function loadBundledSchema(): Promise<SchemaCache> {
  return readJsonFile<SchemaCache>(bundledSchemaPath());
}

export async function loadSchemaCache(config: ResolvedRoSyncConfig): Promise<SchemaCache> {
  try {
    return await readJsonFile<SchemaCache>(config.schemaPath);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }

  const bundled = await loadBundledSchema();
  await writeJsonFile(config.schemaPath, bundled);
  return bundled;
}

export async function updateSchemaCache(config: ResolvedRoSyncConfig): Promise<SchemaCache> {
  const response = await fetch(PRIMARY_SCHEMA_URL, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      "User-Agent": "RoSync/0.1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Schema fetch failed with HTTP ${response.status}`);
  }

  const raw = (await response.json()) as unknown;
  const schemaCache: SchemaCache = {
    metadata: {
      source: PRIMARY_SCHEMA_URL,
      fetchedAt: new Date().toISOString(),
      version: extractVersion(raw),
    },
    classes: extractClasses(raw),
    raw,
  };

  await writeJsonFile(config.schemaPath, schemaCache);
  return schemaCache;
}

export function schemaIsStale(schema: SchemaCache, maxAgeHours = 24): boolean {
  const fetchedAt = Date.parse(schema.metadata.fetchedAt);
  if (!Number.isFinite(fetchedAt)) {
    return true;
  }

  return Date.now() - fetchedAt > maxAgeHours * 60 * 60 * 1000;
}
