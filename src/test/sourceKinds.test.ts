import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LOCAL_SOURCE_KIND,
  DEFAULT_S3_SOURCE_FORMAT,
  LOCAL_SOURCE_KIND_OPTIONS,
  S3_SOURCE_FORMAT_OPTIONS,
  isLocalSourceKind,
  isS3SourceFormat,
  isSourceKind
} from "../shared/sourceKinds";

test("source kind registry exposes local options in canonical order", () => {
  assert.deepEqual(
    LOCAL_SOURCE_KIND_OPTIONS.map((entry) => entry.kind),
    ["parquet", "jsonl", "duckdb", "sqlite", "dataset"]
  );
  assert.equal(DEFAULT_LOCAL_SOURCE_KIND, "parquet");
});

test("source kind guards accept only supported values", () => {
  assert.equal(isSourceKind("s3"), true);
  assert.equal(isSourceKind("parquet"), true);
  assert.equal(isSourceKind("csv"), false);

  assert.equal(isLocalSourceKind("jsonl"), true);
  assert.equal(isLocalSourceKind("s3"), false);
  assert.equal(isLocalSourceKind("csv"), false);
});

test("s3 source format registry exposes canonical options and guard behavior", () => {
  assert.deepEqual(
    S3_SOURCE_FORMAT_OPTIONS.map((entry) => entry.kind),
    ["auto", "parquet", "jsonl"]
  );
  assert.equal(DEFAULT_S3_SOURCE_FORMAT, "auto");
  assert.equal(isS3SourceFormat("auto"), true);
  assert.equal(isS3SourceFormat("jsonl"), true);
  assert.equal(isS3SourceFormat("csv"), false);
});
