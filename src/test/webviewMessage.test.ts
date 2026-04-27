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
  assert.deepEqual(parseWebviewMessage({ type: "browseLocal", kind: "dataset" }), {
    type: "browseLocal",
    kind: "dataset"
  });
});

test("parseWebviewMessage rejects malformed messages", () => {
  assert.equal(parseWebviewMessage(null), null);
  assert.equal(parseWebviewMessage({ type: "runQuery", sql: 42 }), null);
  assert.equal(parseWebviewMessage({ type: "browseLocal", kind: "s3" }), null);
  assert.equal(parseWebviewMessage({ type: "selectTable" }), null);
});
