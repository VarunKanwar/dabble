import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyPayload } from "../shared/protocol";
import { applyExtensionMessage, createInitialState, setExpandedColumn, setOpeningColumn } from "../webview/state";

test("sourceData expands the selected column and local state can collapse it again", () => {
  const next = applyExtensionMessage(createInitialState(), {
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

  assert.equal(next.expandedColumnName, "source_report_id");
  assert.equal(next.openingColumnName, "source_report_id");
  assert.equal(setExpandedColumn(next, null).expandedColumnName, null);
  assert.equal(setOpeningColumn(next, null).openingColumnName, null);
});
