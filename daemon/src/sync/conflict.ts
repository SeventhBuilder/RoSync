export interface ConflictRecord {
  id: string;
  path: string;
  reason: string;
}

export function detectConflicts(): ConflictRecord[] {
  return [];
}
