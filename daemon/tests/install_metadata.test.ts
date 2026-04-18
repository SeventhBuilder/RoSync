import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildInstallMetadata,
  getInstallMetadataPath,
  getInstallPathFilePath,
  readInstallMetadata,
  removeInstallMetadata,
  writeInstallMetadata,
} from "../src/install/metadata.js";

test("writeInstallMetadata persists install metadata and install-path", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rosync-install-meta-"));
  const metaDir = path.join(tempDir, "meta");
  const sourceDir = path.join(tempDir, "source");

  const metadata = buildInstallMetadata(sourceDir, {
    platform: "linux",
    metaDir,
    cliLaunchers: [path.join(tempDir, "bin", "rosync")],
  });

  await writeInstallMetadata(metadata);
  const loaded = await readInstallMetadata(metaDir);

  assert.ok(loaded);
  assert.equal(loaded?.sourceDir, sourceDir);
  assert.equal(loaded?.metaDir, metaDir);
  assert.deepEqual(loaded?.cliLaunchers, [path.join(tempDir, "bin", "rosync")]);
  assert.equal(await fs.readFile(getInstallPathFilePath(metaDir), "utf8"), `${sourceDir}\n`);

  await removeInstallMetadata(metaDir);
  await assert.rejects(() => fs.readFile(getInstallMetadataPath(metaDir), "utf8"));
});

test("readInstallMetadata falls back to install-path when install.json is missing", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rosync-install-meta-"));
  const metaDir = path.join(tempDir, "meta");
  const sourceDir = path.join(tempDir, "source");

  await fs.mkdir(metaDir, { recursive: true });
  await fs.writeFile(getInstallPathFilePath(metaDir), `${sourceDir}\n`, "utf8");

  const loaded = await readInstallMetadata(metaDir);
  assert.ok(loaded);
  assert.equal(loaded?.sourceDir, sourceDir);
  assert.equal(loaded?.metaDir, metaDir);
  assert.equal(loaded?.sourceMode, "linked");
});
