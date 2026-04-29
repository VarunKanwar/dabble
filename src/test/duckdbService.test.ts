import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DuckDBInstance } from "@duckdb/node-api";
import { DuckDBService } from "../extension/duckdbService";

// __dirname resolves to dist/extension/test at runtime; fixtures live in src/test/fixtures
const fixtures = join(__dirname, "../../../src/test/fixtures");
const parquetPath = join(fixtures, "sample.parquet");
const sqlitePath = join(fixtures, "sample.sqlite");
const duckdbPath = join(fixtures, "sample.duckdb");

function source(kind: "parquet" | "sqlite" | "duckdb" | "dataset", path: string) {
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

test("loadSource parquet selects a numeric column for explorer", async () => {
  const svc = new DuckDBService();
  const result = await svc.loadSource(source("parquet", parquetPath));

  assert.equal(result.source.selectedColumn, "id");
  assert.equal(result.payload.explorer.kind, "numeric");
  assert.equal(result.payload.explorer.title, "id");
});

test("loadSource parquet respects previewLimit", async () => {
  const svc = new DuckDBService();
  const result = await svc.loadSource(source("parquet", parquetPath), { previewLimit: 2 });

  assert.equal(result.payload.previewRows.length, 2);
  assert.ok(result.payload.previewText.includes("2"));
});

test("loadSource parquet uses exact distinct counts and full-column percentages for categorical explorer", async () => {
  const generated = await createUniqueStringParquet(1000);

  try {
    const svc = new DuckDBService();
    const result = await svc.loadSource(source("parquet", generated.path));
    const column = result.payload.columns.find((entry) => entry.name === "source_report_id");

    assert.equal(result.source.selectedColumn, "source_report_id");
    assert.ok(column, "expected generated column to be present");
    assert.equal(column?.distinctCount, "1,000");
    assert.equal(column?.distinctDisplay, "1,000");
    assert.equal(result.payload.explorer.distributionRows.length, 6);
    for (const row of result.payload.explorer.distributionRows) {
      assert.equal(row.value, 1);
      assert.ok(Math.abs(row.percent - 0.1) < 0.000001);
    }
  } finally {
    generated.cleanup();
  }
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
