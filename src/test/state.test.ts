import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyPayload } from "../shared/protocol";
import { applyExtensionMessage, createInitialState, setExpandedColumn, setOpeningColumn } from "../webview/state";

test("sourceData defaults to collapsed and expands on same-table column selection", () => {
  const initial = applyExtensionMessage(createInitialState(), {
    type: "sourceData",
    mode: "clicked",
    previewLimit: 100,
    source: {
      kind: "parquet",
      path: "/tmp/example.parquet",
      selectedTable: "example",
      selectedColumn: "source_report_id",
      s3Profile: null
    },
    payload: {
      ...createEmptyPayload(),
      sql: "SELECT * FROM selected_relation LIMIT 100;",
      path: "/tmp/example.parquet",
      title: "example",
      tables: ["example"],
      queryHeaders: ["source_report_id"],
      queryRows: [["dr_1"]],
      querySummary: [["Rows", "1"]]
    }
  });

  assert.equal(initial.expandedColumnName, null);
  assert.equal(initial.openingColumnName, null);

  const expanded = applyExtensionMessage(initial, {
    type: "sourceData",
    mode: "clicked",
    previewLimit: 100,
    source: {
      kind: "parquet",
      path: "/tmp/example.parquet",
      selectedTable: "example",
      selectedColumn: "kind",
      s3Profile: null
    },
    payload: {
      ...initial.payload,
      sql: "SELECT * FROM selected_relation LIMIT 100;",
      path: "/tmp/example.parquet",
      title: "example",
      tables: ["example"],
      queryHeaders: ["kind"],
      queryRows: [["event"]],
      querySummary: [["Rows", "1"]]
    }
  });

  assert.equal(expanded.expandedColumnName, "kind");
  assert.equal(expanded.openingColumnName, "kind");
  assert.equal(setExpandedColumn(expanded, null).expandedColumnName, null);
  assert.equal(setOpeningColumn(expanded, null).openingColumnName, null);
});
