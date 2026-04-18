import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export interface GitCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

const WINDOWS_GIT_CANDIDATES = [
  "C:\\Program Files\\Git\\cmd\\git.exe",
  "C:\\Program Files\\Git\\bin\\git.exe",
];

function executableCandidates(name: string): string[] {
  const pathEntries = (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const suffixes = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  const candidates: string[] = [];

  for (const entry of pathEntries) {
    for (const suffix of suffixes) {
      candidates.push(path.join(entry, `${name}${suffix}`));
    }
  }

  if (process.platform === "win32" && name === "git") {
    candidates.push(...WINDOWS_GIT_CANDIDATES);
  }

  return [...new Set(candidates)];
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveGitExecutable(): Promise<string> {
  const explicitPath = process.env.ROSYNC_GIT_PATH;
  if (explicitPath && (await fileExists(explicitPath))) {
    return explicitPath;
  }

  for (const candidate of executableCandidates("git")) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  throw new Error("Git is required for RoSync git commands, but no git executable was found on PATH.");
}

export async function runGit(
  args: string[],
  cwd: string,
  options?: {
    stdio?: "inherit" | "pipe";
  },
): Promise<GitCommandResult> {
  const git = await resolveGitExecutable();
  const stdio = options?.stdio ?? "pipe";

  return await new Promise<GitCommandResult>((resolve, reject) => {
    const child = spawn(git, args, {
      cwd,
      stdio: stdio === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    if (stdio === "pipe") {
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.once("error", reject);
    child.once("exit", (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

export async function ensureGitSuccess(
  args: string[],
  cwd: string,
  options?: {
    stdio?: "inherit" | "pipe";
  },
): Promise<GitCommandResult> {
  const result = await runGit(args, cwd, options);
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed.`;
    throw new Error(detail);
  }
  return result;
}

export async function isGitRepository(cwd: string): Promise<boolean> {
  const result = await runGit(["rev-parse", "--is-inside-work-tree"], cwd);
  return result.code === 0 && result.stdout.trim() === "true";
}
