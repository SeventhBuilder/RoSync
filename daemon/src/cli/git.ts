import type { Command } from "commander";
import { notImplemented } from "./not_implemented.js";

export function registerGitCommands(program: Command): void {
  const git = program.command("git").description("RoSync git integration commands.");

  git.command("init").description("Initialize RoSync git integration.").action(() => {
    notImplemented("rosync git init");
  });

  git
    .command("commit")
    .description("Create a RoSync git commit.")
    .option("--message <message>", "Commit message")
    .option("--auto", "Use auto-commit mode")
    .action(() => {
      notImplemented("rosync git commit");
    });

  git.command("diff").description("Show the current RoSync diff.").action(() => {
    notImplemented("rosync git diff");
  });
}
