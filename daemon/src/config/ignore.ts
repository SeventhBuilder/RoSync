import fs from "node:fs/promises";
import path from "node:path";
import ignore, { type Ignore } from "ignore";

export interface RoSyncIgnoreRules {
  classNames: Set<string>;
  matcher: Ignore;
  rawPatterns: string[];
}

export const DEFAULT_IGNORE_FILE = [
  "# Ignore all Terrain children",
  "Workspace/Terrain/**",
  "",
  "# Ignore specific service",
  "Lighting/",
  "",
  "# Ignore all Sound instances globally",
  "**/*.Sound",
  "",
  "# Ignore specific classes globally",
  "[class:Sky]",
  "[class:Atmosphere]",
  "",
].join("\n");

export async function loadIgnoreRules(projectRoot: string, ignoreFilePath = path.join(projectRoot, ".rosyncignore")): Promise<RoSyncIgnoreRules> {
  const matcher = ignore();
  const classNames = new Set<string>();
  const rawPatterns: string[] = [];

  let fileText = "";
  try {
    fileText = await fs.readFile(ignoreFilePath, "utf8");
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return {
        classNames,
        matcher,
        rawPatterns,
      };
    }
    throw error;
  }

  for (const rawLine of fileText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const classMatch = /^\[class:([^\]]+)\]$/i.exec(line);
    if (classMatch) {
      classNames.add(classMatch[1].trim());
      continue;
    }

    rawPatterns.push(line);
  }

  matcher.add(rawPatterns);

  return {
    classNames,
    matcher,
    rawPatterns,
  };
}

export function normalizeIgnorePath(candidatePath: string): string {
  return candidatePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

export function shouldIgnorePath(rules: RoSyncIgnoreRules, candidatePath: string): boolean {
  return rules.matcher.ignores(normalizeIgnorePath(candidatePath));
}

export function shouldIgnoreClass(rules: RoSyncIgnoreRules, className: string | null | undefined): boolean {
  if (!className) {
    return false;
  }

  return rules.classNames.has(className);
}
