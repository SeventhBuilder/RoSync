import fs from "node:fs/promises";

export interface InstanceMetadata {
  className: string;
  properties?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  tags?: string[];
  children?: string[];
}

export function isInstanceMetadataFile(filePath: string): boolean {
  return filePath.replace(/\\/g, "/").endsWith("/.instance.json");
}

export async function readInstanceMetadata(filePath: string): Promise<InstanceMetadata | null> {
  try {
    const rawText = await fs.readFile(filePath, "utf8");
    return JSON.parse(rawText) as InstanceMetadata;
  } catch {
    return null;
  }
}
