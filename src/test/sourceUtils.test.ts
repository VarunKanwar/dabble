import assert from "node:assert/strict";
import test from "node:test";
import { inferKindFromPath, normalizeIncomingSource, normalizePreviewLimit } from "../extension/sourceUtils";

test("inferKindFromPath recognizes DuckDB, SQLite, Parquet, and JSONL files", () => {
  assert.equal(inferKindFromPath("/tmp/data.duckdb"), "duckdb");
  assert.equal(inferKindFromPath("/tmp/data.sqlite"), "sqlite");
  assert.equal(inferKindFromPath("/tmp/data.db"), "sqlite");
  assert.equal(inferKindFromPath("/tmp/data.parquet"), "parquet");
  assert.equal(inferKindFromPath("/tmp/data.jsonl"), "jsonl");
  assert.equal(inferKindFromPath("/tmp/data.ndjson"), "jsonl");
});

test("inferKindFromPath falls back to dataset for directories and unknown files", () => {
  assert.equal(inferKindFromPath("/tmp/my-folder"), "dataset");
  assert.equal(inferKindFromPath("/tmp/archive"), "dataset");
});

test("normalizeIncomingSource keeps S3 sources remote", () => {
  assert.deepEqual(normalizeIncomingSource({ path: "s3://bucket/path", s3Profile: "analytics" }), {
    kind: "s3",
    path: "s3://bucket/path",
    selectedTable: null,
    selectedColumn: null,
    s3Profile: "analytics"
  });
});

test("normalizeIncomingSource treats a blank S3 profile as automatic credentials", () => {
  assert.deepEqual(normalizeIncomingSource({ path: "s3://bucket/path", s3Profile: "   " }), {
    kind: "s3",
    path: "s3://bucket/path",
    selectedTable: null,
    selectedColumn: null,
    s3Profile: null
  });
});

test("normalizeIncomingSource infers local kinds and initializes optional state", () => {
  assert.deepEqual(normalizeIncomingSource({ path: "/tmp/local.duckdb" }), {
    kind: "duckdb",
    path: "/tmp/local.duckdb",
    selectedTable: null,
    selectedColumn: null,
    s3Profile: null
  });
});

test("normalizePreviewLimit clamps and defaults", () => {
  assert.equal(normalizePreviewLimit(undefined), 100);
  assert.equal(normalizePreviewLimit("250"), 250);
  assert.equal(normalizePreviewLimit(0), 1);
  assert.equal(normalizePreviewLimit(999999), 5000);
});
