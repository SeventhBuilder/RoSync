import type { Command } from "commander";
import { ensureProjectDirectories, loadConfig } from "../config/toml_parser.js";
import { updateSchemaCache } from "../schema/loader.js";

export function registerSchemaCommands(program: Command): void {
  const schema = program.command("schema").description("Manage RoSync schema cache.");

  schema
    .command("update")
    .description("Fetch the latest Roblox API dump and refresh the schema cache.")
    .action(async () => {
      const config = await loadConfig(process.cwd());
      await ensureProjectDirectories(config);
      const cache = await updateSchemaCache(config);
      console.log(`Schema updated: ${config.schemaPath}`);
      console.log(`Version: ${cache.metadata.version ?? "unknown"}`);
      console.log(`Classes: ${Object.keys(cache.classes).length}`);
      console.log(`Fetched at: ${cache.metadata.fetchedAt}`);
    });
}
