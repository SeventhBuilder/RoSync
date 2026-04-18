import { Command } from "commander";
import { registerAgentCommands } from "./cli/agent.js";
import { registerDoctorCommand } from "./cli/doctor.js";
import { registerGitCommands } from "./cli/git.js";
import { registerInitCommand } from "./cli/init.js";
import { registerMcpCommands } from "./cli/mcp.js";
import { registerPlaceCommands } from "./cli/place.js";
import { registerPushPullCommands } from "./cli/push_pull.js";
import { registerSchemaCommands } from "./cli/schema.js";
import { registerStatusCommand } from "./cli/status.js";
import { registerTeamCommands } from "./cli/team.js";
import { registerUninstallCommand } from "./cli/uninstall.js";
import { registerUpdateCommand } from "./cli/update.js";
import { registerWatchCommand } from "./cli/watch.js";

const program = new Command();

program.name("rosync").description("RoSync daemon and project tooling.").version("0.1.0");
program.showHelpAfterError();

registerInitCommand(program);
registerWatchCommand(program);
registerStatusCommand(program);
registerDoctorCommand(program);
registerSchemaCommands(program);
registerPushPullCommands(program);
registerGitCommands(program);
registerPlaceCommands(program);
registerTeamCommands(program);
registerMcpCommands(program);
registerAgentCommands(program);
registerUpdateCommand(program);
registerUninstallCommand(program);

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[RoSync] ${message}`);
  process.exitCode = 1;
}
