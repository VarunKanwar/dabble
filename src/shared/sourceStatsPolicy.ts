import type { SourceKind } from "./sourceKinds";

const MB = 1024 * 1024;
export const DEFAULT_AUTO_STATS_MAX_BYTES = 500 * MB;

export interface SourceStatsAutoComputePolicy {
  maxBytes: number | null;
  deferWhenSizeUnknown: boolean;
}

export interface SourceStatsAutoComputeDecision {
  shouldDefer: boolean;
  maxBytes: number | null;
}

export const SOURCE_STATS_AUTO_COMPUTE_POLICY: Readonly<Record<SourceKind, SourceStatsAutoComputePolicy>> = Object.freeze({
  parquet: { maxBytes: null, deferWhenSizeUnknown: false },
  jsonl: { maxBytes: DEFAULT_AUTO_STATS_MAX_BYTES, deferWhenSizeUnknown: false },
  duckdb: { maxBytes: null, deferWhenSizeUnknown: false },
  sqlite: { maxBytes: null, deferWhenSizeUnknown: false },
  dataset: { maxBytes: null, deferWhenSizeUnknown: false },
  s3: { maxBytes: DEFAULT_AUTO_STATS_MAX_BYTES, deferWhenSizeUnknown: true }
});

export function decideSourceStatsAutoCompute(
  kind: SourceKind,
  sourceSizeBytes: number | null
): SourceStatsAutoComputeDecision {
  const policy = SOURCE_STATS_AUTO_COMPUTE_POLICY[kind];
  if (!policy || policy.maxBytes == null) {
    return {
      shouldDefer: false,
      maxBytes: null
    };
  }

  if (sourceSizeBytes == null) {
    return {
      shouldDefer: policy.deferWhenSizeUnknown,
      maxBytes: policy.maxBytes
    };
  }

  return {
    shouldDefer: sourceSizeBytes >= policy.maxBytes,
    maxBytes: policy.maxBytes
  };
}
