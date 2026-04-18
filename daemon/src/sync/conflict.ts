import { randomUUID } from "node:crypto";
import type { SerializableNode } from "../config/types.js";

export type ConflictStrategy = "ours" | "theirs" | "manual";
export type ConflictOperationKind = "sync" | "remove" | "rename";

export interface ConflictOperationSnapshot {
  kind: ConflictOperationKind;
  path: string;
  newPath?: string;
  data?: SerializableNode;
  hash: string | null;
}

export interface ConflictRecord {
  id: string;
  path: string;
  reason: string;
  createdAt: string;
  local: ConflictOperationSnapshot | null;
  remote: ConflictOperationSnapshot | null;
  localHash: string | null;
  remoteHash: string | null;
}

export function createConflictRecord(input: {
  path: string;
  reason: string;
  local?: ConflictOperationSnapshot | null;
  remote?: ConflictOperationSnapshot | null;
}): ConflictRecord {
  return {
    id: randomUUID(),
    path: input.path,
    reason: input.reason,
    createdAt: new Date().toISOString(),
    local: input.local ?? null,
    remote: input.remote ?? null,
    localHash: input.local?.hash ?? null,
    remoteHash: input.remote?.hash ?? null,
  };
}
