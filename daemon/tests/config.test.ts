import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config/toml_parser.js";

test("loadConfig resolves rosync.toml values", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rosync-config-"));
  await fs.writeFile(
    path.join(tempDir, "rosync.toml"),
    [
      "[project]",
      'name = "TestGame"',
      'version = "2.0.0"',
      "game_id = 123",
      "",
      "[sync]",
      'host = "127.0.0.1"',
      "port = 4000",
      'src = "game-src"',
      "auto_schema_update = false",
      "debounce_ms = 250",
      "",
    ].join("\n"),
    "utf8",
  );

  const config = await loadConfig(tempDir);

  assert.equal(config.project.name, "TestGame");
  assert.equal(config.project.version, "2.0.0");
  assert.equal(config.project.gameId, 123);
  assert.equal(config.sync.host, "127.0.0.1");
  assert.equal(config.sync.port, 4000);
  assert.equal(config.sync.src, "game-src");
  assert.equal(config.sync.autoSchemaUpdate, false);
  assert.equal(config.sync.debounceMs, 250);
  assert.equal(config.srcDir, path.join(tempDir, "game-src"));
});

test("loadConfig ignores undefined sync overrides while normalizing localhost", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rosync-config-"));
  await fs.writeFile(
    path.join(tempDir, "rosync.toml"),
    [
      "[project]",
      'name = "TestGame"',
      "",
      "[sync]",
      'host = "localhost"',
      "port = 34872",
      'src = "src"',
      "",
    ].join("\n"),
    "utf8",
  );

  const config = await loadConfig(tempDir, {
    sync: {
      host: undefined,
      port: undefined,
    },
  });

  assert.equal(config.sync.host, "127.0.0.1");
  assert.equal(config.sync.port, 34872);
});

test("loadConfig rejects non-loopback hosts", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rosync-config-"));
  await fs.writeFile(
    path.join(tempDir, "rosync.toml"),
    [
      "[project]",
      'name = "TestGame"',
      "",
      "[sync]",
      'host = "0.0.0.0"',
      "port = 34872",
      'src = "src"',
      "",
    ].join("\n"),
    "utf8",
  );

  await assert.rejects(() => loadConfig(tempDir), /only supports localhost hosts/i);
});
