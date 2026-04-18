import type { Command } from "commander";
import { notImplemented } from "./not_implemented.js";

export function registerAgentCommands(program: Command): void {
  const agent = program.command("agent").description("RoSync AI agent helpers.");

  agent.command("setup").description("Generate AI-agent context files.").action(() => {
    notImplemented("rosync agent setup");
  });
}
