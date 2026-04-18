export interface SchemaClassDescriptor {
  name: string;
  properties: string[];
}

export interface SchemaMetadata {
  source: string;
  fetchedAt: string;
  version: string | null;
}

export interface SchemaCache {
  metadata: SchemaMetadata;
  classes: Record<string, SchemaClassDescriptor>;
  raw?: unknown;
}
