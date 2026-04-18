import type { Command } from "commander";
import { loadConfig } from "../config/toml_parser.js";
import { ensureGitSuccess, isGitRepository, runGit } from "../git/runtime.js";

function parseChangedPaths(statusOutput: string): string[] {
  return statusOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[A-Z?]{1,2}\s+/, "").split(" -> ").at(-1) ?? line)
    .filter(Boolean);
}

export function renderAutoCommitMessage(template: string, changedPaths: string[], now = new Date()): string {
  const changedSummary = changedPaths.length > 0 ? changedPaths.join(", ") : "working tree";
  return template
    .replaceAll("{timestamp}", now.toISOString())
    .replaceAll("{changed_paths}", changedSummary);
}

async function ensureRepositoryOrThrow(projectRoot: string, branch: string): Promise<void> {
  if (await isGitRepository(projectRoot)) {
    return;
  }

  throw new Error(`This project is not a git repository yet. Run \`rosync git init\` to create a ${branch} branch repo.`);
}

async function workingTreeStatus(projectRoot: string): Promise<{ raw: string; changedPaths: string[] }> {
  const status = await ensureGitSuccess(["status", "--short", "--", "."], projectRoot);
  return {
    raw: status.stdout.trim(),
    changedPaths: parseChangedPaths(status.stdout),
  };
}

export function registerGitCommands(program: Command): void {
  const git = program.command("git").description("RoSync git integration commands.");

  git.command("init").description("Initialize RoSync git integration.").action(async () => {
    const config = await loadConfig(process.cwd());

    if (await isGitRepository(config.projectRoot)) {
      console.log("Git repository already initialized.");
      return;
    }

    try {
      await ensureGitSuccess(["init", "-b", config.git.branch], config.projectRoot, { stdio: "inherit" });
    } catch {
      await ensureGitSuccess(["init"], config.projectRoot, { stdio: "inherit" });
      await ensureGitSuccess(["branch", "-M", config.git.branch], config.projectRoot, { stdio: "inherit" });
    }

    console.log(`Initialized git repository on branch ${config.git.branch}.`);
  });

  git
    .command("commit")
    .description("Create a RoSync git commit.")
    .option("--message <message>", "Commit message")
    .option("--auto", "Use auto-commit mode")
    .action(async (options: { message?: string; auto?: boolean }) => {
      const config = await loadConfig(process.cwd());
      await ensureRepositoryOrThrow(config.projectRoot, config.git.branch);

      const before = await workingTreeStatus(config.projectRoot);
      if (!before.raw) {
        console.log("Working tree is clean. No commit created.");
        return;
      }

      const message =
        options.message?.trim() ||
        (options.auto ? renderAutoCommitMessage(config.git.autoCommitMessage, before.changedPaths) : "") ||
        "chore: rosync snapshot";

      await ensureGitSuccess(["add", "-A", "--", "."], config.projectRoot, { stdio: "inherit" });
      const staged = await ensureGitSuccess(["diff", "--cached", "--name-only", "--", "."], config.projectRoot);
      const stagedPaths = staged.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      if (stagedPaths.length === 0) {
        console.log("No staged RoSync changes were found after git add.");
        return;
      }

      await ensureGitSuccess(["commit", "-m", message], config.projectRoot, { stdio: "inherit" });
      console.log(`Created commit: ${message}`);
      console.log(`Changed paths: ${stagedPaths.join(", ")}`);
    });

  git.command("diff").description("Show the current RoSync diff.").action(async () => {
    const config = await loadConfig(process.cwd());
    await ensureRepositoryOrThrow(config.projectRoot, config.git.branch);

    const status = await ensureGitSuccess(["status", "--short", "--", "."], config.projectRoot);
    const unstaged = await ensureGitSuccess(["--no-pager", "diff", "--stat", "--", "."], config.projectRoot);
    const staged = await ensureGitSuccess(["--no-pager", "diff", "--cached", "--stat", "--", "."], config.projectRoot);

    if (!status.stdout.trim() && !unstaged.stdout.trim() && !staged.stdout.trim()) {
      console.log("Working tree is clean.");
      return;
    }

    if (status.stdout.trim()) {
      console.log("Status:");
      console.log(status.stdout.trimEnd());
    }

    if (unstaged.stdout.trim()) {
      console.log("");
      console.log("Unstaged diff:");
      console.log(unstaged.stdout.trimEnd());
    }

    if (staged.stdout.trim()) {
      console.log("");
      console.log("Staged diff:");
      console.log(staged.stdout.trimEnd());
    }

    if (!unstaged.stdout.trim() && !staged.stdout.trim()) {
      console.log("");
      console.log("Diff summary is empty, but git still reports path state changes.");
    }
  });
}
