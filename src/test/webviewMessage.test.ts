import assert from "node:assert/strict";
import test from "node:test";
import { parseWebviewMessage } from "../extension/webviewMessage";

test("parseWebviewMessage accepts valid messages", () => {
  assert.deepEqual(parseWebviewMessage({ type: "ready" }), { type: "ready" });
  assert.deepEqual(parseWebviewMessage({ type: "runQuery", sql: "select 1" }), {
    type: "runQuery",
    sql: "select 1"
  });
  assert.deepEqual(parseWebviewMessage({ type: "loadMoreQueryRows" }), {
    type: "loadMoreQueryRows"
  });
  assert.deepEqual(parseWebviewMessage({ type: "loadAllQueryRows" }), {
    type: "loadAllQueryRows"
  });
  assert.deepEqual(parseWebviewMessage({ type: "computeSourceStats" }), {
    type: "computeSourceStats"
  });
  assert.deepEqual(parseWebviewMessage({ type: "browseLocal", kind: "dataset" }), {
    type: "browseLocal",
    kind: "dataset"
  });
  assert.deepEqual(parseWebviewMessage({ type: "browseLocal", kind: "jsonl" }), {
    type: "browseLocal",
    kind: "jsonl"
  });
  assert.deepEqual(
    parseWebviewMessage({
      type: "openSource",
      source: { path: "s3://bucket/events.jsonl.out", s3Profile: "analytics", s3Format: "jsonl" }
    }),
    {
      type: "openSource",
      source: { path: "s3://bucket/events.jsonl.out", s3Profile: "analytics", s3Format: "jsonl", localType: undefined }
    }
  );
});

test("parseWebviewMessage rejects malformed messages", () => {
  assert.equal(parseWebviewMessage(null), null);
  assert.equal(parseWebviewMessage({ type: "runQuery", sql: 42 }), null);
  assert.equal(parseWebviewMessage({ type: "browseLocal", kind: "s3" }), null);
  assert.deepEqual(parseWebviewMessage({ type: "openSource", source: { path: "s3://bucket/path", s3Format: "csv" } }), {
    type: "openSource",
    source: { localType: undefined, path: "s3://bucket/path", s3Profile: null, s3Format: undefined }
  });
  assert.equal(parseWebviewMessage({ type: "selectTable" }), null);
});
