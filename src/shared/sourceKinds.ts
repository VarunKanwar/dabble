export const SOURCE_KIND_DEFINITIONS = [
  {
    kind: "parquet",
    label: "Parquet file",
    local: true,
    extensions: [".parquet"]
  },
  {
    kind: "jsonl",
    label: "JSONL file",
    local: true,
    extensions: [".jsonl", ".ndjson"]
  },
  {
    kind: "duckdb",
    label: "DuckDB file",
    local: true,
    extensions: [".duckdb"]
  },
  {
    kind: "sqlite",
    label: "SQLite file",
    local: true,
    extensions: [".sqlite", ".db"]
  },
  {
    kind: "dataset",
    label: "Parquet dataset folder",
    local: true,
    extensions: []
  },
  {
    kind: "s3",
    label: "S3 source",
    local: false,
    extensions: []
  }
] as const;

type SourceKindDefinition = (typeof SOURCE_KIND_DEFINITIONS)[number];
const SOURCE_KIND_SET = new Set<string>(SOURCE_KIND_DEFINITIONS.map((definition) => definition.kind));

export const S3_SOURCE_FORMAT_DEFINITIONS = [
  {
    kind: "auto",
    label: "Auto-detect"
  },
  {
    kind: "parquet",
    label: "Parquet"
  },
  {
    kind: "jsonl",
    label: "JSONL / NDJSON"
  }
] as const;

type S3SourceFormatDefinition = (typeof S3_SOURCE_FORMAT_DEFINITIONS)[number];
const S3_SOURCE_FORMAT_SET = new Set<string>(S3_SOURCE_FORMAT_DEFINITIONS.map((definition) => definition.kind));

export type SourceKind = SourceKindDefinition["kind"];
export type LocalSourceKind = Extract<SourceKindDefinition, { local: true }>["kind"];
export type S3SourceFormat = S3SourceFormatDefinition["kind"];
export const DEFAULT_LOCAL_SOURCE_KIND: LocalSourceKind = "parquet";
export const DEFAULT_S3_SOURCE_FORMAT: S3SourceFormat = "auto";

export const LOCAL_SOURCE_KIND_OPTIONS: ReadonlyArray<{ kind: LocalSourceKind; label: string }> =
  SOURCE_KIND_DEFINITIONS
    .filter((definition): definition is Extract<SourceKindDefinition, { local: true }> => definition.local)
    .map((definition) => ({ kind: definition.kind, label: definition.label }));

export const S3_SOURCE_FORMAT_OPTIONS: ReadonlyArray<{ kind: S3SourceFormat; label: string }> =
  S3_SOURCE_FORMAT_DEFINITIONS.map((definition) => ({ kind: definition.kind, label: definition.label }));

const LOCAL_SOURCE_KIND_SET = new Set<string>(LOCAL_SOURCE_KIND_OPTIONS.map((definition) => definition.kind));

export function isSourceKind(value: unknown): value is SourceKind {
  return typeof value === "string" && SOURCE_KIND_SET.has(value);
}

export function isLocalSourceKind(value: unknown): value is LocalSourceKind {
  return typeof value === "string" && LOCAL_SOURCE_KIND_SET.has(value);
}

export function isS3SourceFormat(value: unknown): value is S3SourceFormat {
  return typeof value === "string" && S3_SOURCE_FORMAT_SET.has(value);
}

export const LOCAL_SOURCE_KIND_BY_EXTENSION: Readonly<Record<string, Exclude<LocalSourceKind, "dataset">>> = Object.freeze(
  SOURCE_KIND_DEFINITIONS.reduce<Record<string, Exclude<LocalSourceKind, "dataset">>>((acc, definition) => {
    if (!definition.local || definition.kind === "dataset") {
      return acc;
    }

    for (const extension of definition.extensions) {
      acc[extension] = definition.kind;
    }
    return acc;
  }, {})
);
