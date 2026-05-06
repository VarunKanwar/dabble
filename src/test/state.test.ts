import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyPayload } from "../shared/protocol";
import {
  applyExtensionMessage,
  closeCellViewer,
  createInitialState,
  openCellViewer,
  setCellViewerCopyStatus,
  setCellViewerPretty,
  setCellViewerPrettyError,
  setCellViewerRaw,
  setCellViewerTree,
  setExpandedColumn,
  setOpeningColumn
} from "../webview/state";

test("createInitialState leaves the S3 profile blank for automatic credentials", () => {
  const state = createInitialState();

  assert.equal(state.form.s3Profile, "");
});

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

test("sourceData keeps the S3 profile blank when the source uses automatic credentials", () => {
  const initial = createInitialState();
  initial.form.s3Profile = "analytics";

  const next = applyExtensionMessage(initial, {
    type: "sourceData",
    mode: "connect",
    previewLimit: 100,
    source: {
      kind: "s3",
      path: "s3://bucket/path",
      selectedTable: "remote_dataset",
      selectedColumn: null,
      s3Profile: null
    },
    payload: createEmptyPayload()
  });

  assert.equal(next.form.s3Profile, "");
});

test("sourceData sets localType to jsonl for JSONL sources", () => {
  const initial = createInitialState();

  const next = applyExtensionMessage(initial, {
    type: "sourceData",
    mode: "clicked",
    previewLimit: 100,
    source: {
      kind: "jsonl",
      path: "/tmp/events.jsonl",
      selectedTable: "events",
      selectedColumn: null,
      s3Profile: null
    },
    payload: createEmptyPayload()
  });

  assert.equal(next.form.localType, "jsonl");
});

test("columnData patches explorer and columns without replacing query results", () => {
  const seeded = applyExtensionMessage(createInitialState(), {
    type: "sourceData",
    mode: "clicked",
    previewLimit: 100,
    source: {
      kind: "parquet",
      path: "/tmp/example.parquet",
      selectedTable: "example",
      selectedColumn: null,
      s3Profile: null
    },
    payload: {
      ...createEmptyPayload(),
      path: "/tmp/example.parquet",
      title: "example",
      tables: ["example"],
      queryHeaders: ["id"],
      queryRows: [["1"]],
      querySummary: [["Rows", "1"]],
      columns: [
        {
          name: "id",
          type: "INTEGER",
          distinctCount: "Select column to compute exact values.",
          nullPercentage: "",
          nullDisplay: "–",
          distinctDisplay: "…",
          summary: "1 to 5"
        }
      ]
    }
  });

  const next = applyExtensionMessage(seeded, {
    type: "columnData",
    source: {
      kind: "parquet",
      path: "/tmp/example.parquet",
      selectedTable: "example",
      selectedColumn: "id",
      s3Profile: null
    },
    columns: [
      {
        name: "id",
        type: "INTEGER",
        distinctCount: "5",
        nullPercentage: "0%",
        nullDisplay: "–",
        distinctDisplay: "5",
        summary: "1 to 5"
      }
    ],
    explorer: {
      title: "id",
      type: "INTEGER",
      view: "topValues",
      distributionRows: [],
      sql: "SELECT id, count(*) FROM selected_relation GROUP BY 1"
    }
  });

  assert.equal(next.queryResult.headers.join(","), "id");
  assert.equal(next.queryResult.rows.length, 1);
  assert.equal(next.payload.columns[0].distinctDisplay, "5");
  assert.equal(next.payload.explorer.title, "id");
  assert.equal(next.expandedColumnName, "id");
});

test("columnMetricsData patches only column stats and keeps explorer state intact", () => {
  const seeded = applyExtensionMessage(createInitialState(), {
    type: "sourceData",
    mode: "clicked",
    previewLimit: 100,
    source: {
      kind: "parquet",
      path: "/tmp/example.parquet",
      selectedTable: "example",
      selectedColumn: "id",
      s3Profile: null
    },
    payload: {
      ...createEmptyPayload(),
      path: "/tmp/example.parquet",
      title: "example",
      tables: ["example"],
      columns: [
        {
          name: "id",
          type: "INTEGER",
          distinctCount: "Select column to compute exact values.",
          nullPercentage: "",
          nullDisplay: "–",
          distinctDisplay: "…",
          summary: "1 to 5"
        },
        {
          name: "name",
          type: "VARCHAR",
          distinctCount: "Select column to compute exact values.",
          nullPercentage: "",
          nullDisplay: "–",
          distinctDisplay: "…",
          summary: "alice to erin"
        }
      ],
      explorer: {
        title: "id",
        type: "INTEGER",
        view: "topValues",
        distributionRows: [],
        sql: "SELECT id, count(*) FROM selected_relation GROUP BY 1"
      }
    }
  });

  const next = applyExtensionMessage(seeded, {
    type: "columnMetricsData",
    source: seeded.source!,
    columns: [
      {
        name: "id",
        type: "INTEGER",
        distinctCount: "5",
        nullPercentage: "0%",
        nullDisplay: "–",
        distinctDisplay: "5",
        summary: "1 to 5"
      },
      seeded.payload.columns[1]
    ]
  });

  assert.equal(next.payload.columns[0].distinctDisplay, "5");
  assert.equal(next.payload.explorer.title, "id");
  assert.equal(next.queryResult.rows.length, seeded.queryResult.rows.length);
});

test("cell viewer opens and closes with explicit state transitions", () => {
  const initial = createInitialState();
  const opened = openCellViewer(initial, {
    table: "preview",
    columnName: "message",
    rowNumber: 2,
    value: "line 1\nline 2",
    canPrettyJson: true
  });

  assert.equal(opened.cellViewer.isOpen, true);
  assert.equal(opened.cellViewer.columnName, "message");
  assert.equal(opened.cellViewer.rowNumber, 2);
  assert.equal(opened.cellViewer.value, "line 1\nline 2");
  assert.equal(opened.cellViewer.canPrettyJson, true);
  assert.equal(opened.cellViewer.format, "raw");

  const closed = closeCellViewer(opened);
  assert.equal(closed.cellViewer.isOpen, false);
});

test("cell viewer supports pretty/raw toggles and parse errors", () => {
  const opened = openCellViewer(createInitialState(), {
    table: "query",
    columnName: "payload",
    rowNumber: 1,
    value: "{\"a\":1}",
    canPrettyJson: true
  });

  const pretty = setCellViewerPretty(opened, { a: 1 }, "{\n  \"a\": 1\n}");
  assert.equal(pretty.cellViewer.format, "pretty");
  assert.equal(pretty.cellViewer.prettyValue, "{\n  \"a\": 1\n}");

  const tree = setCellViewerTree(pretty, { a: 1 }, "{\n  \"a\": 1\n}");
  assert.equal(tree.cellViewer.format, "tree");

  const raw = setCellViewerRaw(pretty);
  assert.equal(raw.cellViewer.format, "raw");
  assert.equal(raw.cellViewer.prettyError, null);

  const errored = setCellViewerPrettyError(raw, "Could not parse this value as JSON.");
  assert.equal(errored.cellViewer.format, "raw");
  assert.equal(errored.cellViewer.prettyError, "Could not parse this value as JSON.");

  const copied = setCellViewerCopyStatus(errored, "copied");
  assert.equal(copied.cellViewer.copyStatus, "copied");
});
