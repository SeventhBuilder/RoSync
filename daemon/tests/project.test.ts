import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_IGNORE_FILE } from "../src/config/ignore.js";
import { loadIgnoreRules } from "../src/config/ignore.js";
import { loadConfig, renderDefaultConfig } from "../src/config/toml_parser.js";
import { buildProjectTree, createNode, deleteNode, findNodeByPath, renameNode, summarizeProjectTree, updateNode } from "../src/sync/project.js";

async function createTempProject(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rosync-project-"));
  await fs.writeFile(path.join(tempDir, "rosync.toml"), renderDefaultConfig("TestProject", 123), "utf8");
  await fs.writeFile(path.join(tempDir, ".rosyncignore"), DEFAULT_IGNORE_FILE, "utf8");
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

test("buildProjectTree reads instance directories and summaries", async () => {
  const projectDir = await createTempProject();
  const config = await loadConfig(projectDir);
  const ignoreRules = await loadIgnoreRules(projectDir);

  await createNode(config, "Workspace", "ServerScript", "Script");
  await updateNode(config, "Workspace/ServerScript", {
    source: "print('hello')",
  });

  const tree = await buildProjectTree(config, ignoreRules);
  const node = findNodeByPath(tree, "Workspace/ServerScript");

  assert.ok(node);
  assert.equal(node.className, "Script");
  assert.ok(node.sourceFilePath);
  assert.equal(node.source, "print('hello')");

  const summary = summarizeProjectTree(tree);
  assert.equal(summary.indexedInstances, 2);
  assert.equal(summary.scriptFiles, 1);
  assert.equal(summary.classCounts.Workspace, 1);
  assert.equal(summary.classCounts.Script, 1);
});

test("create, rename, and delete mutate the project tree", async () => {
  const projectDir = await createTempProject();
  const config = await loadConfig(projectDir);
  const ignoreRules = await loadIgnoreRules(projectDir);

  await createNode(config, "Workspace", "Parts", "Folder");
  await renameNode(config, "Workspace/Parts", "Geometry");

  let tree = await buildProjectTree(config, ignoreRules);
  assert.equal(findNodeByPath(tree, "Workspace/Parts"), null);
  assert.ok(findNodeByPath(tree, "Workspace/Geometry"));

  await deleteNode(config, "Workspace/Geometry");

  tree = await buildProjectTree(config, ignoreRules);
  assert.equal(findNodeByPath(tree, "Workspace/Geometry"), null);
});
