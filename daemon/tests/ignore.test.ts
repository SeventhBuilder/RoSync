import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadIgnoreRules, shouldIgnoreClass, shouldIgnorePath } from "../src/config/ignore.js";

test(".rosyncignore parses path and class rules", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rosync-ignore-"));
  await fs.writeFile(
    path.join(tempDir, ".rosyncignore"),
    [
      "Workspace/Terrain/**",
      "[class:Sky]",
    ].join("\n"),
    "utf8",
  );

  const rules = await loadIgnoreRules(tempDir);

  assert.equal(shouldIgnorePath(rules, "Workspace/Terrain/Chunk/.instance.json"), true);
  assert.equal(shouldIgnorePath(rules, "Workspace/Baseplate/.instance.json"), false);
  assert.equal(shouldIgnoreClass(rules, "Sky"), true);
  assert.equal(shouldIgnoreClass(rules, "Part"), false);
});
