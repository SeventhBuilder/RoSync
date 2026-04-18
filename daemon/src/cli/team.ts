import type { Command } from "commander";
import { notImplemented } from "./not_implemented.js";

export function registerTeamCommands(program: Command): void {
  const team = program.command("team").description("RoSync team collaboration commands.");

  team
    .command("invite")
    .description("Invite a collaborator.")
    .argument("<email>", "Email address")
    .action(() => {
      notImplemented("rosync team invite");
    });

  team.command("status").description("Show team sync status.").action(() => {
    notImplemented("rosync team status");
  });

  team
    .command("resolve")
    .description("Resolve a conflict.")
    .argument("<conflict-id>", "Conflict id")
    .option("--ours", "Prefer local version")
    .option("--theirs", "Prefer remote version")
    .option("--manual", "Resolve manually")
    .action(() => {
      notImplemented("rosync team resolve");
    });
}
