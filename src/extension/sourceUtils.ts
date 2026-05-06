import path from "path";
import type { IncomingSourceSelection, LocalSourceKind, SourceDescriptor } from "../shared/protocol";
import {
  DEFAULT_S3_SOURCE_FORMAT,
  LOCAL_SOURCE_KIND_BY_EXTENSION,
  isS3SourceFormat
} from "../shared/sourceKinds";

export const DEFAULT_PREVIEW_LIMIT = 100;
export const MIN_PREVIEW_LIMIT = 1;
export const MAX_PREVIEW_LIMIT = 5000;

export function inferKindFromPath(filePath: string): LocalSourceKind {
  const ext = path.extname(filePath).toLowerCase();
  const mapped = LOCAL_SOURCE_KIND_BY_EXTENSION[ext];
  if (mapped) {
    return mapped;
  }
  return "dataset";
}

export function normalizeIncomingSource(source: IncomingSourceSelection): SourceDescriptor {
  const candidate = source.path?.trim();
  if (!candidate) {
    throw new Error("Provide a local path or S3 URI.");
  }

  if (candidate.startsWith("s3://")) {
    return {
      kind: "s3",
      path: candidate,
      selectedTable: null,
      selectedColumn: null,
      s3Profile: source.s3Profile?.trim() || null,
      s3Format: isS3SourceFormat(source.s3Format) ? source.s3Format : DEFAULT_S3_SOURCE_FORMAT
    };
  }

  const sourceKind = source.localType ?? inferKindFromPath(candidate);
  return {
    kind: sourceKind,
    path: candidate,
    selectedTable: null,
    selectedColumn: null,
    s3Profile: null,
    s3Format: null
  };
}

export function normalizeSource(source: Pick<SourceDescriptor, "kind" | "path"> & Partial<SourceDescriptor>): SourceDescriptor {
  const normalizedS3Format = source.kind === "s3"
    ? (isS3SourceFormat(source.s3Format) ? source.s3Format : DEFAULT_S3_SOURCE_FORMAT)
    : null;
  return {
    kind: source.kind,
    path: source.path,
    selectedTable: source.selectedTable ?? null,
    selectedColumn: source.selectedColumn ?? null,
    s3Profile: source.s3Profile ?? null,
    s3Format: normalizedS3Format
  };
}

export function normalizePreviewLimit(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_PREVIEW_LIMIT;
  }
  return Math.max(MIN_PREVIEW_LIMIT, Math.min(MAX_PREVIEW_LIMIT, Math.floor(numeric)));
}
