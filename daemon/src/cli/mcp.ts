import type { Command } from "commander";
import { notImplemented } from "./not_implemented.js";

export function registerMcpCommands(program: Command): void {
  program.command("mcp").description("Run the RoSync MCP server.").action(() => {
    notImplemented("rosync mcp");
  });
}
