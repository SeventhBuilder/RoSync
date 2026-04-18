import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createProjectSkeleton } from "../src/cli/init.js";

test("createProjectSkeleton writes the foundation project files", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rosync-init-"));
  const created = await createProjectSkeleton(tempDir, "base", 999);

  assert.ok(created.includes("rosync.toml"));
  assert.ok(created.includes(".rosyncignore"));
  assert.ok(created.includes(".gitignore"));
  assert.ok(created.includes("README.md"));

  const workspaceInstance = await fs.readFile(path.join(tempDir, "src", "Workspace", ".instance.json"), "utf8");
  assert.match(workspaceInstance, /"className": "Workspace"/);
});
