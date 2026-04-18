import fs from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import { DEFAULT_SERVICES } from "../config/types.js";
import { DEFAULT_IGNORE_FILE } from "../config/ignore.js";
import { defaultProjectNameForDirectory, renderDefaultConfig } from "../config/toml_parser.js";

const PROJECT_GITIGNORE = [
  "node_modules/",
  "dist/",
  ".DS_Store",
  "Thumbs.db",
  ".rosync/runtime.json",
  ".rosync/runtime.lock",
  "",
].join("\n");

const PROJECT_README = (projectName: string): string => `# ${projectName}

This project was scaffolded by RoSync.

## Quick Start

\`\`\`bash
rosync watch
\`\`\`
`;

const EMPTY_INSTANCE = (className: string) =>
  JSON.stringify(
    {
      className,
      properties: {},
      attributes: {},
      tags: [],
      children: [],
    },
    null,
    2,
  ) + "\n";

async function writeFileIfMissing(baseDir: string, filePath: string, content: string, changes: string[]): Promise<void> {
  try {
    await fs.access(filePath);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      throw error;
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
    changes.push(path.relative(baseDir, filePath).replace(/\\/g, "/"));
  }
}

export async function createProjectSkeleton(targetDir: string, templateName?: string, placeId?: number): Promise<string[]> {
  const projectName = defaultProjectNameForDirectory(targetDir);
  const changes: string[] = [];

  await fs.mkdir(path.join(targetDir, ".rosync"), { recursive: true });
  await fs.mkdir(path.join(targetDir, "src"), { recursive: true });

  await writeFileIfMissing(targetDir, path.join(targetDir, "rosync.toml"), renderDefaultConfig(projectName, placeId), changes);
  await writeFileIfMissing(targetDir, path.join(targetDir, ".rosyncignore"), DEFAULT_IGNORE_FILE, changes);
  await writeFileIfMissing(targetDir, path.join(targetDir, ".gitignore"), PROJECT_GITIGNORE, changes);
  await writeFileIfMissing(targetDir, path.join(targetDir, "README.md"), PROJECT_README(projectName), changes);

  for (const serviceName of DEFAULT_SERVICES) {
    const serviceDir = path.join(targetDir, "src", serviceName);
    await fs.mkdir(serviceDir, { recursive: true });
    await writeFileIfMissing(targetDir, path.join(serviceDir, ".instance.json"), EMPTY_INSTANCE(serviceName), changes);
  }

  if (templateName) {
    await writeFileIfMissing(
      targetDir,
      path.join(targetDir, ".rosync", "template.txt"),
      `template=${templateName}\n`,
      changes,
    );
  }

  return changes;
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Scaffold a new RoSync project in the current directory.")
    .option("--template <name>", "Optional starter template name")
    .option("--place-id <id>", "Optional Roblox place id")
    .action(async (options: { template?: string; placeId?: string }) => {
      const numericPlaceId = options.placeId ? Number(options.placeId) : undefined;
      const created = await createProjectSkeleton(process.cwd(), options.template, numericPlaceId);

      if (created.length === 0) {
        console.log("RoSync project files already exist in this directory.");
        return;
      }

      console.log("Created:");
      for (const entry of created) {
        console.log(`- ${entry}`);
      }
    });
}
