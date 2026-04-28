// Run once to generate test fixtures: node src/test/fixtures/create-fixtures.mjs
import { DuckDBInstance } from "@duckdb/node-api";
import { mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const dir = dirname(fileURLToPath(import.meta.url));
mkdirSync(dir, { recursive: true });

const instance = await DuckDBInstance.create(":memory:");
const conn = await instance.connect();

// --- sample.parquet ---
await conn.run(`
  COPY (
    SELECT
      id,
      name,
      amount,
      ts
    FROM (VALUES
      (1, 'alice', 10.5,  TIMESTAMPTZ '2024-01-01 00:00:00+00'),
      (2, 'bob',   20.0,  TIMESTAMPTZ '2024-01-02 00:00:00+00'),
      (3, 'carol', 30.75, TIMESTAMPTZ '2024-01-03 00:00:00+00'),
      (4, 'dave',  NULL,  TIMESTAMPTZ '2024-01-04 00:00:00+00'),
      (5, 'alice', 50.0,  TIMESTAMPTZ '2024-01-05 00:00:00+00')
    ) t(id, name, amount, ts)
  ) TO '${join(dir, "sample.parquet")}' (FORMAT PARQUET)
`);

// --- sample.duckdb ---
const dbInstance = await DuckDBInstance.create(join(dir, "sample.duckdb"));
const dbConn = await dbInstance.connect();
await dbConn.run(`
  CREATE TABLE events (
    id      INTEGER PRIMARY KEY,
    kind    VARCHAR,
    value   DOUBLE
  )
`);
await dbConn.run(`
  INSERT INTO events VALUES
    (1, 'click',  1.0),
    (2, 'view',   2.5),
    (3, 'click',  3.0),
    (4, 'submit', 4.5)
`);
await dbConn.run(`
  CREATE TABLE metadata (
    key   VARCHAR,
    value VARCHAR
  )
`);
await dbConn.run(`INSERT INTO metadata VALUES ('version', '1'), ('source', 'test')`);
dbConn.closeSync();
dbInstance.closeSync();

// --- sample.sqlite via DuckDB's sqlite extension ---
await conn.run(`SET extension_directory = '/tmp/duckview-duckdb-extensions'`);
try {
  await conn.run(`LOAD sqlite`);
} catch {
  await conn.run(`INSTALL sqlite`);
  await conn.run(`LOAD sqlite`);
}
await conn.run(`
  ATTACH '${join(dir, "sample.sqlite")}' AS sqldb (TYPE sqlite)
`);
await conn.run(`CREATE TABLE sqldb.users (id INTEGER, username VARCHAR, score REAL)`);
await conn.run(`
  INSERT INTO sqldb.users VALUES
    (1, 'alpha', 9.5),
    (2, 'beta',  7.0),
    (3, 'gamma', 8.25)
`);
await conn.run(`CREATE TABLE sqldb.settings (key VARCHAR, val VARCHAR)`);
await conn.run(`INSERT INTO sqldb.settings VALUES ('theme', 'dark'), ('lang', 'en')`);

conn.closeSync();
instance.closeSync();

console.log("Fixtures created in", dir);
