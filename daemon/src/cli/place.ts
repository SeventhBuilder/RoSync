import type { Command } from "commander";
import { notImplemented } from "./not_implemented.js";

export function registerPlaceCommands(program: Command): void {
  const place = program.command("place").description("Manage multi-place RoSync projects.");

  place.command("list").description("List configured places.").action(() => {
    notImplemented("rosync place list");
  });

  place
    .command("switch")
    .description("Switch the active place.")
    .argument("<place-id>", "Place id")
    .action(() => {
      notImplemented("rosync place switch");
    });

  place
    .command("add")
    .description("Add a place configuration.")
    .argument("<place-id>", "Place id")
    .option("--name <name>", "Optional place name")
    .action(() => {
      notImplemented("rosync place add");
    });
}
