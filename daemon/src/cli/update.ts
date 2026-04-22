import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { Command } from "commander";
import { resolveInstallMetadata, touchInstallMetadata, type InstallMetadata } from "../install/metadata.js";

interface CapturedCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface BackupEntry {
  targetPath: string;
  backupPath: string;
  isDirectory: boolean;
}

interface CommandResolution {
  executable: string;
  shell: boolean;
}

function executableName(command: string): string {
  if (process.platform !== "win32") {
    return command;
  }

  if (command === "npm") {
    return "npm.cmd";
  }

  if (command === "code") {
    return "code.cmd";
  }

  if (command === "powershell") {
    return "powershell.exe";
  }

  return command;
}

function getWindowsNpmFallbacks(): string[] {
  const fallbacks = new Set<string>();
  const env = process.env;
  const candidateRoots = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LocalAppData, env.APPDATA].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );

  for (const root of candidateRoots) {
    fallbacks.add(path.join(root, "nodejs", "npm.cmd"));
    fallbacks.add(path.join(root, "Programs", "nodejs", "npm.cmd"));
    fallbacks.add(path.join(root, "npm", "npm.cmd"));
  }

  return [...fallbacks];
}

async function resolveCommand(command: string): Promise<CommandResolution> {
  const shell = process.platform === "win32";
  const executable = executableName(command);

  if (process.platform !== "win32" || command !== "npm") {
    return { executable, shell };
  }

  for (const candidate of getWindowsNpmFallbacks()) {
    if (await pathExists(candidate)) {
      return { executable: candidate, shell };
    }
  }

  return { executable, shell };
}

async function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    void (async () => {
      const resolution = await resolveCommand(command);
      const child = spawn(resolution.executable, args, {
        cwd,
        shell: resolution.shell,
        stdio: "inherit",
      });

      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`Command failed (${command} ${args.join(" ")}). Exit code: ${code ?? "unknown"}.`));
      });
    })().catch(reject);
  });
}

async function runCommandCapture(command: string, args: string[], cwd: string): Promise<CapturedCommandResult> {
  return new Promise((resolve, reject) => {
    void (async () => {
      const resolution = await resolveCommand(command);
      const child = spawn(resolution.executable, args, {
        cwd,
        shell: resolution.shell,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.once("error", reject);
      child.once("exit", (code) => {
        resolve({
          code: code ?? 1,
          stdout,
          stderr,
        });
      });
    })().catch(reject);
  });
}

async function commandExists(command: string, cwd: string): Promise<boolean> {
  try {
    const result = await runCommandCapture(command, ["--version"], cwd);
    return result.code === 0;
  } catch {
    return false;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function backupPath(targetPath: string): Promise<BackupEntry | null> {
  try {
    const stats = await fs.stat(targetPath);
    const backupPathValue = `${targetPath}.bak`;
    await fs.rm(backupPathValue, { recursive: true, force: true });

    if (stats.isDirectory()) {
      await fs.cp(targetPath, backupPathValue, { recursive: true });
    } else {
      await fs.copyFile(targetPath, backupPathValue);
    }

    return {
      targetPath,
      backupPath: backupPathValue,
      isDirectory: stats.isDirectory(),
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function restoreBackups(backups: BackupEntry[]): Promise<void> {
  for (const backup of backups) {
    if (!(await pathExists(backup.backupPath))) {
      continue;
    }

    await fs.rm(backup.targetPath, { recursive: true, force: true });
    if (backup.isDirectory) {
      await fs.cp(backup.backupPath, backup.targetPath, { recursive: true });
    } else {
      await fs.copyFile(backup.backupPath, backup.targetPath);
    }
    await fs.rm(backup.backupPath, { recursive: true, force: true });
  }
}

async function cleanupBackups(backups: BackupEntry[]): Promise<void> {
  await Promise.all(backups.map((backup) => fs.rm(backup.backupPath, { recursive: true, force: true })));
}

async function readWorkspaceVersion(sourceDir: string): Promise<string | null> {
  try {
    const packageJsonPath = path.join(sourceDir, "package.json");
    const rawText = await fs.readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(rawText) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

async function refreshInstalledArtifacts(sourceDir: string, metadata: InstallMetadata): Promise<void> {
  if (process.platform === "win32") {
    await runCommand(
      "powershell",
      ["-ExecutionPolicy", "Bypass", "-File", metadata.installScript, "-SkipNpmInstall", "-SkipBuild"],
      sourceDir,
    );
    return;
  }

  await runCommand("sh", [metadata.installScript, "--skip-npm-install", "--skip-build"], sourceDir);
}

function printCapturedOutput(result: CapturedCommandResult): void {
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  if (stdout) {
    console.log(stdout);
  }
  if (stderr) {
    console.error(stderr);
  }
}

export function registerUpdateCommand(program: Command): void {
  program
    .command("update")
    .description("Pull the latest RoSync source and rebuild the installed tooling in place.")
    .option("--branch <branch>", "Git branch to pull from", "main")
    .option("--force", "Rebuild even if the current checkout is already up to date")
    .action(async (options: { branch: string; force?: boolean }) => {
      const metadata = await resolveInstallMetadata();
      const sourceDir = metadata.sourceDir;
      const currentVersion = await readWorkspaceVersion(sourceDir);

      console.log("RoSync Updater");
      console.log("----------------");
      console.log(`Source:  ${sourceDir}`);
      console.log(`Current: ${currentVersion ?? "unknown"}`);

      if (!(await commandExists("git", sourceDir))) {
        throw new Error("Git is required for `rosync update`, but it was not found on PATH.");
      }
      if (!(await commandExists("node", sourceDir))) {
        throw new Error("Node.js is required for `rosync update`, but it was not found on PATH.");
      }
      if (!(await commandExists("npm", sourceDir))) {
        throw new Error("npm is required for `rosync update`, but it was not found on PATH.");
      }

      const beforeHead = await runCommandCapture("git", ["-C", sourceDir, "rev-parse", "HEAD"], sourceDir);
      if (beforeHead.code !== 0) {
        throw new Error(beforeHead.stderr.trim() || "Unable to read the current Git commit.");
      }

      console.log(`Pulling latest changes from origin/${options.branch}...`);
      const pullResult = await runCommandCapture("git", ["-C", sourceDir, "pull", "origin", options.branch], sourceDir);
      printCapturedOutput(pullResult);
      if (pullResult.code !== 0) {
        throw new Error(pullResult.stderr.trim() || "Git pull failed.");
      }

      const afterHead = await runCommandCapture("git", ["-C", sourceDir, "rev-parse", "HEAD"], sourceDir);
      if (afterHead.code !== 0) {
        throw new Error(afterHead.stderr.trim() || "Unable to read the updated Git commit.");
      }

      const sourceChanged = beforeHead.stdout.trim() !== afterHead.stdout.trim();
      if (!sourceChanged && !options.force) {
        console.log("Already up to date. Pass --force to rebuild anyway.");
        return;
      }

      const backupTargets = [
        path.join(sourceDir, "daemon", "dist"),
        path.join(sourceDir, "plugin", "RoSync.plugin.luau"),
        ...metadata.cliLaunchers,
      ];

      const backups: BackupEntry[] = [];
      for (const targetPath of backupTargets) {
        const backup = await backupPath(targetPath);
        if (backup) {
          backups.push(backup);
        }
      }

      try {
        console.log("Installing workspace dependencies...");
        await runCommand("npm", ["install"], sourceDir);

        console.log("Building daemon and extension...");
        await runCommand("npm", ["run", "build"], sourceDir);

        console.log("Bundling Roblox Studio plugin...");
        await runCommand("node", ["plugin/tools/bundle.mjs"], sourceDir);

        console.log("Refreshing installed shims and plugin...");
        await refreshInstalledArtifacts(sourceDir, metadata);

        const refreshedMetadata = await touchInstallMetadata(metadata.metaDir);
        const nextVersion = await readWorkspaceVersion(sourceDir);
        await cleanupBackups(backups);

        console.log(`Updated: ${nextVersion ?? currentVersion ?? "unknown"}`);
        if (refreshedMetadata) {
          console.log(`Metadata refreshed at: ${refreshedMetadata.updatedAt}`);
        }
      } catch (error) {
        await restoreBackups(backups);
        throw error;
      }
    });
}
