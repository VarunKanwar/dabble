import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_AUTO_STATS_MAX_BYTES,
  SOURCE_STATS_AUTO_COMPUTE_POLICY,
  decideSourceStatsAutoCompute
} from "../shared/sourceStatsPolicy";

test("source stats policy centralizes defer thresholds by source kind", () => {
  assert.equal(SOURCE_STATS_AUTO_COMPUTE_POLICY.s3.maxBytes, DEFAULT_AUTO_STATS_MAX_BYTES);
  assert.equal(SOURCE_STATS_AUTO_COMPUTE_POLICY.jsonl.maxBytes, DEFAULT_AUTO_STATS_MAX_BYTES);
  assert.equal(SOURCE_STATS_AUTO_COMPUTE_POLICY.parquet.maxBytes, null);
});

test("decideSourceStatsAutoCompute defers when size is above configured threshold", () => {
  const decision = decideSourceStatsAutoCompute("jsonl", DEFAULT_AUTO_STATS_MAX_BYTES + 1);
  assert.equal(decision.shouldDefer, true);
  assert.equal(decision.maxBytes, DEFAULT_AUTO_STATS_MAX_BYTES);
});

test("decideSourceStatsAutoCompute respects unknown-size behavior", () => {
  assert.equal(decideSourceStatsAutoCompute("s3", null).shouldDefer, true);
  assert.equal(decideSourceStatsAutoCompute("jsonl", null).shouldDefer, false);
});
