import assert from "node:assert/strict";
import test from "node:test";
import { renderAutoCommitMessage } from "../src/cli/git.js";

test("renderAutoCommitMessage replaces timestamp and changed_paths tokens", () => {
  const message = renderAutoCommitMessage(
    "sync: [{timestamp}] {changed_paths}",
    ["src/Workspace/.instance.json", "src/ServerScriptService/init.server.luau"],
    new Date("2026-04-18T12:34:56.000Z"),
  );

  assert.equal(
    message,
    "sync: [2026-04-18T12:34:56.000Z] src/Workspace/.instance.json, src/ServerScriptService/init.server.luau",
  );
});
