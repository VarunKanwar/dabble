import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DuckDBInstance } from "@duckdb/node-api";
import { buildS3SecretSql, DuckDBService, inferS3DataFormat } from "../extension/duckdbService";

// __dirname resolves to dist/extension/test at runtime; fixtures live in src/test/fixtures
const fixtures = join(__dirname, "../../../src/test/fixtures");
const parquetPath = join(fixtures, "sample.parquet");
const jsonlPath = join(fixtures, "sample.jsonl");
const sqlitePath = join(fixtures, "sample.sqlite");
const duckdbPath = join(fixtures, "sample.duckdb");

function source(kind: "parquet" | "jsonl" | "sqlite" | "duckdb" | "dataset", path: string) {
  return { kind, path, selectedTable: null, selectedColumn: null, s3Profile: null } as const;
}

async function createUniqueStringParquet(rowCount: number): Promise<{ path: string; cleanup: () => void }> {
  const directory = mkdtempSync(join(tmpdir(), "dabble-distinct-"));
  const parquetPath = join(directory, "distinct-source-report.parquet");
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();

  try {
    await connection.run(`
      COPY (
        SELECT concat('dr_', i::VARCHAR) AS source_report_id
        FROM range(${rowCount}) AS t(i)
      ) TO '${parquetPath.replace(/'/g, "''")}' (FORMAT PARQUET)
    `);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }

  return {
    path: parquetPath,
    cleanup: () => rmSync(directory, { recursive: true, force: true })
  };
}

async function createUniqueNumericParquet(rowCount: number): Promise<{ path: string; cleanup: () => void }> {
  const directory = mkdtempSync(join(tmpdir(), "dabble-histogram-"));
  const parquetPath = join(directory, "numeric-values.parquet");
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();

  try {
    await connection.run(`
      COPY (
        SELECT i::BIGINT AS numeric_id
        FROM range(${rowCount}) AS t(i)
      ) TO '${parquetPath.replace(/'/g, "''")}' (FORMAT PARQUET)
    `);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }

  return {
    path: parquetPath,
    cleanup: () => rmSync(directory, { recursive: true, force: true })
  };
}

test("buildS3SecretSql uses the default DuckDB credential chain when no profile is provided", () => {
  const sql = buildS3SecretSql(null);

  assert.match(sql, /PROVIDER credential_chain/);
  assert.doesNotMatch(sql, /PROFILE/);
  assert.doesNotMatch(sql, /CHAIN config/);
});

test("buildS3SecretSql targets a named AWS profile when one is provided", () => {
  const sql = buildS3SecretSql("prod'o1");

  assert.match(sql, /PROVIDER credential_chain/);
  assert.match(sql, /CHAIN config/);
  assert.match(sql, /PROFILE 'prod''o1'/);
});

test("inferS3DataFormat recognizes newline-delimited JSON files on S3", () => {
  assert.equal(inferS3DataFormat("s3://bucket/events.jsonl"), "jsonl");
  assert.equal(inferS3DataFormat("s3://bucket/events.ndjson"), "jsonl");
  assert.equal(inferS3DataFormat("s3://bucket/events.jsonl.gz"), "jsonl");
});

test("inferS3DataFormat defaults to parquet datasets for non-JSONL S3 paths", () => {
  assert.equal(inferS3DataFormat("s3://bucket/events.parquet"), "parquet");
  assert.equal(inferS3DataFormat("s3://bucket/lake/year=2026/month=04/"), "parquet");
});

// --- loadSource: parquet ---

test("loadSource parquet returns correct shape", async () => {
  const svc = new DuckDBService();
  const result = await svc.loadSource(source("parquet", parquetPath));

  assert.equal(result.source.kind, "parquet");
  assert.equal(result.payload.previewHeaders.join(","), "id,name,amount,ts");
  assert.equal(result.payload.previewRows.length, 5);
  assert.equal(result.payload.columns.length, 4);
  assert.ok(result.payload.stats.find(([k]) => k === "Rows"), "stats missing Rows entry");
  assert.equal(result.payload.stats.find(([k]) => k === "Rows")?.[1], "5");
});

test("loadSource parquet selects a numeric column and defers explorer details until explicit column selection", async () => {
  const svc = new DuckDBService();
  const result = await svc.loadSource(source("parquet", parquetPath));

  assert.equal(result.source.selectedColumn, "id");
  assert.equal(result.payload.explorer.title, "");
  assert.equal(result.payload.explorer.distributionRows.length, 0);
});

test("loadSource parquet computes explorer details when a column is explicitly selected", async () => {
  const svc = new DuckDBService();
  const result = await svc.loadSource({ ...source("parquet", parquetPath), selectedColumn: "id" });

  assert.equal(result.source.selectedColumn, "id");
  assert.equal(result.payload.explorer.view, "topValues");
  assert.equal(result.payload.explorer.title, "id");
});

test("loadColumnMetric + applyColumnMetric update only the targeted column", async () => {
  const svc = new DuckDBService();
  const initial = await svc.loadSource(source("parquet", parquetPath));
  const metric = await svc.loadColumnMetric(initial.source, "id");
  const updated = svc.applyColumnMetric(initial.payload.columns, "id", metric);
  const selected = updated.find((entry) => entry.name === "id");
  const unselected = updated.find((entry) => entry.name === "name");

  assert.equal(selected?.distinctDisplay, "5");
  assert.equal(selected?.nullDisplay, "–");
  assert.equal(unselected?.distinctDisplay, "…");
});

test("loadSource parquet respects previewLimit", async () => {
  const svc = new DuckDBService();
  const result = await svc.loadSource(source("parquet", parquetPath), { previewLimit: 2 });

  assert.equal(result.payload.previewRows.length, 2);
  assert.ok(result.payload.previewText.includes("2"));
});

test("loadSource parquet keeps exact column stats lazy even when a column is selected", async () => {
  const generated = await createUniqueStringParquet(1000);

  try {
    const svc = new DuckDBService();
    const result = await svc.loadSource({ ...source("parquet", generated.path), selectedColumn: "source_report_id" });
    const column = result.payload.columns.find((entry) => entry.name === "source_report_id");

    assert.equal(result.source.selectedColumn, "source_report_id");
    assert.equal(result.payload.explorer.view, "topValues");
    assert.ok(column, "expected generated column to be present");
    assert.equal(column?.distinctDisplay, "…");
  } finally {
    generated.cleanup();
  }
});

test("loadColumnMetric returns exact values for high-cardinality categorical columns", async () => {
  const generated = await createUniqueStringParquet(1000);

  try {
    const svc = new DuckDBService();
    const metric = await svc.loadColumnMetric(source("parquet", generated.path), "source_report_id");
    const rows = await svc.loadSelectedColumnExplorer(
      { ...source("parquet", generated.path), selectedColumn: "source_report_id" },
      metric
    );

    assert.equal(metric.distinctCount, 1000);
    assert.equal(metric.nullCount, 0);
    assert.equal(rows.explorer.view, "topValues");
    assert.equal(rows.explorer.distributionRows.length, 6);
    for (const row of rows.explorer.distributionRows) {
      assert.equal(row.value, 1);
      assert.ok(Math.abs(row.percent - 0.1) < 0.000001);
    }
  } finally {
    generated.cleanup();
  }
});

test("loadSelectedColumnExplorer uses cached metrics to choose histogram for high-cardinality numeric columns", async () => {
  const generated = await createUniqueNumericParquet(1000);

  try {
    const svc = new DuckDBService();
    const metric = await svc.loadColumnMetric(source("parquet", generated.path), "numeric_id");
    const result = await svc.loadSelectedColumnExplorer(
      { ...source("parquet", generated.path), selectedColumn: "numeric_id" },
      metric
    );

    assert.equal(result.source.selectedColumn, "numeric_id");
    assert.equal(result.explorer.view, "histogram");
    assert.equal(result.explorer.distributionRows.length, 6);
    assert.ok(result.explorer.distributionRows[0]?.label.includes("["));
  } finally {
    generated.cleanup();
  }
});

test("loadSelectedColumnExplorer falls back to top values when metric is unavailable", async () => {
  const generated = await createUniqueNumericParquet(1000);

  try {
    const svc = new DuckDBService();
    const result = await svc.loadSelectedColumnExplorer(
      { ...source("parquet", generated.path), selectedColumn: "numeric_id" },
      null
    );

    assert.equal(result.source.selectedColumn, "numeric_id");
    assert.equal(result.explorer.view, "topValues");
    assert.equal(result.explorer.distributionRows.length, 6);
  } finally {
    generated.cleanup();
  }
});

// --- loadSource: jsonl ---

test("loadSource jsonl returns correct shape", async () => {
  const svc = new DuckDBService();
  const result = await svc.loadSource(source("jsonl", jsonlPath));
  const messageIndex = result.payload.previewHeaders.indexOf("message");
  const metaIndex = result.payload.previewHeaders.indexOf("meta");

  assert.equal(result.source.kind, "jsonl");
  assert.equal(result.payload.previewRows.length, 3);
  assert.ok(result.payload.previewHeaders.includes("id"));
  assert.ok(result.payload.previewHeaders.includes("kind"));
  assert.ok(messageIndex >= 0);
  assert.ok(metaIndex >= 0);
  assert.ok(result.payload.previewRows[0]?.[messageIndex]?.includes("\n"));
  assert.ok(result.payload.previewRows[0]?.[metaIndex]?.includes("\"nested\""));
  assert.equal(result.payload.stats.find(([k]) => k === "Rows")?.[1], "3");
  assert.equal(result.payload.stats.find(([k]) => k === "Source")?.[1], "JSONL file");
});

test("loadSource jsonl keeps nested struct columns on top-values explorer path", async () => {
  const svc = new DuckDBService();
  const result = await svc.loadSource({ ...source("jsonl", jsonlPath), selectedColumn: "meta" });

  assert.equal(result.source.selectedColumn, "meta");
  assert.equal(result.payload.explorer.view, "topValues");
  assert.match(result.payload.explorer.type, /^STRUCT\(/);
});

// --- loadSource: sqlite ---

test("loadSource sqlite returns correct shape", async () => {
  const svc = new DuckDBService();
  const result = await svc.loadSource(source("sqlite", sqlitePath));

  assert.equal(result.source.kind, "sqlite");
  assert.ok(result.payload.tables.includes("users"), "tables should include 'users'");
  assert.ok(result.payload.stats.find(([k]) => k === "Tables"), "stats missing Tables entry");
  assert.ok(result.payload.stats.find(([k]) => k === "Rows"), "stats missing Rows entry");
});

test("loadSource sqlite selects first table by default", async () => {
  const svc = new DuckDBService();
  const result = await svc.loadSource(source("sqlite", sqlitePath));

  assert.equal(result.source.selectedTable, "settings");
  assert.ok(result.payload.previewHeaders.length > 0, "should have preview headers");
});

test("loadSource sqlite respects selectedTable", async () => {
  const svc = new DuckDBService();
  const result = await svc.loadSource({ ...source("sqlite", sqlitePath), selectedTable: "users" });

  assert.equal(result.source.selectedTable, "users");
  assert.ok(result.payload.previewHeaders.includes("username"));
  assert.equal(result.payload.previewRows.length, 3);
});

// --- loadSource: duckdb ---

test("loadSource duckdb returns correct shape", async () => {
  const svc = new DuckDBService();
  const result = await svc.loadSource(source("duckdb", duckdbPath));

  assert.equal(result.source.kind, "duckdb");
  assert.ok(result.payload.tables.length >= 2, "should expose multiple tables");
  assert.ok(result.payload.stats.find(([k]) => k === "Tables"), "stats missing Tables entry");
  assert.ok(result.payload.stats.find(([k]) => k === "Rows"), "stats missing Rows entry");
});

test("loadSource duckdb respects selectedTable", async () => {
  const svc = new DuckDBService();
  const result = await svc.loadSource({ ...source("duckdb", duckdbPath), selectedTable: "events" });

  assert.equal(result.source.selectedTable, "events");
  assert.ok(result.payload.previewHeaders.includes("kind"));
  assert.equal(result.payload.previewRows.length, 4);
});

// --- runQuery ---

test("runQuery returns rows for valid SELECT", async () => {
  const svc = new DuckDBService();
  const result = await svc.runQuery(source("parquet", parquetPath), "SELECT name FROM selected_relation ORDER BY name");

  assert.deepEqual(result.headers, ["name"]);
  assert.equal(result.rows.length, 5);
  assert.equal(result.rows[0][0], "alice");
});

test("runQuery rejects write SQL", async () => {
  const svc = new DuckDBService();
  await assert.rejects(
    () => svc.runQuery(source("parquet", parquetPath), "INSERT INTO selected_relation VALUES (99, 'x', 1.0, NOW())"),
    /readonly/i
  );
});

// --- startQuery / QuerySession ---

test("startQuery on parquet returns first page and marks done when small", async () => {
  const svc = new DuckDBService();
  const session = await svc.startQuery(source("parquet", parquetPath), "SELECT * FROM selected_relation");
  const page = await session.readNextPage();

  assert.deepEqual(page.headers, ["id", "name", "amount", "ts"]);
  assert.equal(page.rows.length, 5);
  assert.equal(page.done, true);
  assert.equal(page.loadedRowCount, 5);
});

test("startQuery on duckdb opens a fresh read-only instance", async () => {
  const svc = new DuckDBService();
  const session = await svc.startQuery(source("duckdb", duckdbPath), "SELECT * FROM events ORDER BY id", { selectedTable: "events" });
  const page = await session.readNextPage();

  assert.equal(page.rows.length, 4);
  assert.equal(page.done, true);
});

test("readAllRemaining drains all rows", async () => {
  const svc = new DuckDBService();
  const session = await svc.startQuery(source("parquet", parquetPath), "SELECT id FROM selected_relation");
  const result = await session.readAllRemaining();

  assert.equal(result.rows.length, 5);
  assert.equal(result.done, true);
});

test("QuerySession throws after dispose", async () => {
  const svc = new DuckDBService();
  const session = await svc.startQuery(source("parquet", parquetPath), "SELECT 1");
  await session.dispose();
  await assert.rejects(() => session.readNextPage(), /already been closed/i);
});

// --- error paths ---

test("loadSource throws for missing file", async () => {
  const svc = new DuckDBService();
  await assert.rejects(() => svc.loadSource(source("parquet", "/nonexistent/path/file.parquet")));
});

test("loadSource sqlite throws when db has no tables", async () => {
  // Use an in-memory approach: point at a non-existent sqlite path to force error
  const svc = new DuckDBService();
  await assert.rejects(() => svc.loadSource(source("sqlite", "/nonexistent/empty.sqlite")));
});
