import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { addPlaceConfiguration, switchPlaceConfiguration } from "../src/cli/place.js";
import { loadConfig, renderDefaultConfig } from "../src/config/toml_parser.js";

async function createTempProject(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rosync-place-"));
  await fs.writeFile(path.join(tempDir, "rosync.toml"), renderDefaultConfig("TestProject", 123), "utf8");
  await fs.writeFile(path.join(tempDir, ".rosyncignore"), "", "utf8");
  await fs.mkdir(path.join(tempDir, "src", "Workspace"), { recursive: true });
  await fs.writeFile(
    path.join(tempDir, "src", "Workspace", ".instance.json"),
    JSON.stringify({
      className: "Workspace",
      properties: {},
      attributes: {},
      tags: [],
      children: [],
    }, null, 2),
    "utf8",
  );
  return tempDir;
}

test("addPlaceConfiguration persists a new place and scaffolds its src tree", async () => {
  const projectDir = await createTempProject();
  const result = await addPlaceConfiguration(projectDir, 456, "Lobby");
  const config = await loadConfig(projectDir);

  assert.equal(result.name, "Lobby");
  assert.equal(config.places.entries.Lobby?.placeId, 456);
  assert.equal(config.places.entries.Lobby?.src, "src-lobby");
  assert.ok(result.created.includes("src-lobby/Workspace/.instance.json"));
  await fs.access(path.join(projectDir, "src-lobby", "Workspace", ".instance.json"));
});

test("switchPlaceConfiguration updates the active place and sync src", async () => {
  const projectDir = await createTempProject();
  await addPlaceConfiguration(projectDir, 456, "Lobby");

  const result = await switchPlaceConfiguration(projectDir, "456");
  const config = await loadConfig(projectDir);

  assert.equal(result.name, "Lobby");
  assert.equal(config.places.default, "Lobby");
  assert.equal(config.sync.src, "src-lobby");
  assert.equal(config.project.gameId, 456);
  assert.equal(config.srcDir, path.join(projectDir, "src-lobby"));
});
