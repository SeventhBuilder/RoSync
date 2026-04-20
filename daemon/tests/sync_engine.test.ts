import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectTreeNode, ProjectTreeSnapshot, SerializableNode } from "../src/config/types.js";
import { diffProjectTrees, formatSyncActivityLine, projectNodeToSerializable, SyncEngine } from "../src/sync/engine.js";

function makeNode(
  pathValue: string,
  className: string,
  properties: Record<string, unknown> = {},
  children: ProjectTreeNode[] = [],
): ProjectTreeNode {
  const segments = pathValue.split("/");
  const name = segments[segments.length - 1];

  return {
    name,
    className,
    path: pathValue,
    relativePath: `src/${pathValue}`,
    directoryPath: `C:/tmp/${pathValue}`,
    metadataPath: `C:/tmp/${pathValue}/.instance.json`,
    sourceFilePath: className === "Script" ? `C:/tmp/${pathValue}/init.server.luau` : null,
    scriptKind: className === "Script" ? "server" : null,
    properties,
    attributes: {},
    tags: [],
    source: className === "Script" ? "print('hi')" : null,
    children,
  };
}

function makeTree(serviceChildren: ProjectTreeNode[]): ProjectTreeSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    projectRoot: "C:/tmp/project",
    srcDir: "C:/tmp/project/src",
    ignoredEntries: 0,
    services: [makeNode("Workspace", "Workspace", {}, serviceChildren)],
  };
}

function findChildNode(tree: ProjectTreeSnapshot, targetPath: string): ProjectTreeNode {
  const queue = [...tree.services];
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) {
      break;
    }
    if (next.path === targetPath) {
      return next;
    }
    queue.push(...next.children);
  }
  throw new Error(`Node ${targetPath} was not found.`);
}

test("diffProjectTrees keeps child property changes granular", () => {
  const previousTree = makeTree([
    makeNode("Workspace/Baseplate", "Part", {
      Anchored: {
        type: "bool",
        value: true,
      },
    }),
  ]);
  const nextTree = makeTree([
    makeNode("Workspace/Baseplate", "Part", {
      Anchored: {
        type: "bool",
        value: false,
      },
    }),
  ]);

  const operations = diffProjectTrees(previousTree, nextTree);
  assert.equal(operations.length, 1);
  assert.equal(operations[0]?.type, "SYNC_INSTANCE");
  assert.equal(operations[0]?.path, "Workspace/Baseplate");
});

test("diffProjectTrees detects subtree renames", () => {
  const previousTree = makeTree([makeNode("Workspace/OldModel", "Model", {}, [makeNode("Workspace/OldModel/Part", "Part")])]);
  const nextTree = makeTree([makeNode("Workspace/NewModel", "Model", {}, [makeNode("Workspace/NewModel/Part", "Part")])]);

  const operations = diffProjectTrees(previousTree, nextTree);
  assert.deepEqual(operations, [
    {
      type: "RENAME_INSTANCE",
      oldPath: "Workspace/OldModel",
      newPath: "Workspace/NewModel",
    },
  ]);
});

test("formatSyncActivityLine renders source labels and action text", () => {
  const line = formatSyncActivityLine(
    "editor",
    {
      action: "rename",
      path: "ReplicatedStorage/Foo",
      nextPath: "ReplicatedStorage/Bar",
    },
    false,
  );

  assert.equal(line, "[VSCode] ~ Rename ReplicatedStorage/Foo -> ReplicatedStorage/Bar");
});

test("SyncEngine suppresses matching studio echoes", async () => {
  const initialTree = makeTree([
    makeNode("Workspace/Baseplate", "Part", {
      Anchored: {
        type: "bool",
        value: true,
      },
    }),
  ]);
  let rebuiltTree = makeTree([
    makeNode("Workspace/Baseplate", "Part", {
      Anchored: {
        type: "bool",
        value: false,
      },
    }),
  ]);

  const studioBroadcasts: unknown[] = [];
  let upsertCallCount = 0;
  const engine = new SyncEngine(initialTree, {
    rebuildProjectTree: async () => rebuiltTree,
    createProjectNode: async () => undefined,
    updateProjectNode: async () => undefined,
    upsertProjectNode: async () => {
      upsertCallCount += 1;
    },
    renameProjectNode: async () => undefined,
    moveProjectNode: async () => undefined,
    deleteProjectNode: async () => undefined,
    broadcastToClients: (role, payload) => {
      if (role === "studio") {
        studioBroadcasts.push(payload);
      }
      return 1;
    },
    logger: {
      info() {},
      warn() {},
      error() {},
    },
  });

  await engine.reconcileDiskTree("disk");
  assert.equal(studioBroadcasts.length, 1);

  const nextPayload = projectNodeToSerializable(findChildNode(rebuiltTree, "Workspace/Baseplate"));
  await engine.handleStudioSync("Workspace/Baseplate", nextPayload);

  assert.equal(engine.getConflicts().length, 0);
  assert.equal(upsertCallCount, 0);
});

test("SyncEngine records a conflict when Studio diverges from pending local state", async () => {
  const initialTree = makeTree([
    makeNode("Workspace/Baseplate", "Part", {
      Anchored: {
        type: "bool",
        value: true,
      },
    }),
  ]);
  let rebuiltTree = makeTree([
    makeNode("Workspace/Baseplate", "Part", {
      Anchored: {
        type: "bool",
        value: false,
      },
    }),
  ]);

  const editorBroadcasts: unknown[] = [];
  const engine = new SyncEngine(initialTree, {
    rebuildProjectTree: async () => rebuiltTree,
    createProjectNode: async () => undefined,
    updateProjectNode: async () => undefined,
    upsertProjectNode: async (_nodePath: string, _payload: SerializableNode) => undefined,
    renameProjectNode: async () => undefined,
    moveProjectNode: async () => undefined,
    deleteProjectNode: async () => undefined,
    broadcastToClients: (role, payload) => {
      if (role === "editor") {
        editorBroadcasts.push(payload);
      }
      return 1;
    },
    logger: {
      info() {},
      warn() {},
      error() {},
    },
  });

  await engine.reconcileDiskTree("disk");

  const conflictingStudioPayload = projectNodeToSerializable(findChildNode(initialTree, "Workspace/Baseplate"));
  await engine.handleStudioSync("Workspace/Baseplate", conflictingStudioPayload);

  assert.equal(engine.getConflicts().length, 1);
  assert.equal(engine.getDiagnostics().conflictCount, 1);
  assert.ok(
    editorBroadcasts.some(
      (payload) => typeof payload === "object" && payload !== null && "type" in payload && (payload as { type: string }).type === "CONFLICT",
    ),
  );
});

test("SyncEngine applies editor activity hints to disk-origin updates", async () => {
  const initialTree = makeTree([
    makeNode("Workspace/Baseplate", "Part", {
      Anchored: {
        type: "bool",
        value: true,
      },
    }),
  ]);
  const rebuiltTree = makeTree([
    makeNode("Workspace/Baseplate", "Part", {
      Anchored: {
        type: "bool",
        value: false,
      },
    }),
  ]);

  const logLines: string[] = [];
  const engine = new SyncEngine(initialTree, {
    rebuildProjectTree: async () => rebuiltTree,
    createProjectNode: async () => undefined,
    updateProjectNode: async () => undefined,
    upsertProjectNode: async (_nodePath: string, _payload: SerializableNode) => undefined,
    renameProjectNode: async () => undefined,
    moveProjectNode: async () => undefined,
    deleteProjectNode: async () => undefined,
    broadcastToClients: () => 1,
    logger: {
      info(message) {
        logLines.push(message.replace(/\u001b\[[0-9;]*m/g, ""));
      },
      warn() {},
      error() {},
    },
  });

  engine.noteEditorActivity({
    action: "update",
    client: "vscode",
    path: "Workspace/Baseplate",
  });

  await engine.reconcileDiskTree("disk");

  assert.ok(logLines.includes("[VSCode] ~ Update Workspace/Baseplate"));
});
