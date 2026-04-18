import { spawn } from "node:child_process";
import type { Command } from "commander";
import { resolveInstallMetadata } from "../install/metadata.js";

function executableName(command: string): string {
  if (process.platform !== "win32") {
    return command;
  }

  if (command === "powershell") {
    return "powershell.exe";
  }

  return command;
}

function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executableName(command), args, {
      cwd,
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
  });
}

export function registerUninstallCommand(program: Command): void {
  program
    .command("uninstall")
    .description("Remove the installed RoSync tooling from this machine.")
    .option("--keep-projects", "Leave project-local .rosync folders untouched")
    .option("--yes", "Skip confirmation prompts in the platform uninstall script")
    .action(async (options: { keepProjects?: boolean; yes?: boolean }) => {
      const metadata = await resolveInstallMetadata();
      console.log("RoSync Uninstaller");
      console.log("------------------");
      console.log(`Source: ${metadata.sourceDir}`);

      if (process.platform === "win32") {
        const args = ["-ExecutionPolicy", "Bypass", "-File", metadata.uninstallScript];
        if (options.keepProjects) {
          args.push("-KeepProjects");
        }
        if (options.yes) {
          args.push("-Yes");
        }
        await runCommand("powershell", args, metadata.sourceDir);
        return;
      }

      const args = [metadata.uninstallScript];
      if (options.keepProjects) {
        args.push("--keep-projects");
      }
      if (options.yes) {
        args.push("--yes");
      }
      await runCommand("sh", args, metadata.sourceDir);
    });
}
