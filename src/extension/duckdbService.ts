import fs from "fs";
import path from "path";
import { DuckDBConnection, DuckDBDataChunk, DuckDBInstance, DuckDBResult, JSDuckDBValueConverter, type JS } from "@duckdb/node-api";
import {
  createEmptyExplorer,
  type ColumnSummary,
  type DistributionRow,
  type ExplorerPayload,
  type LoadSourceResult,
  type QueryResult,
  type SourceDescriptor,
  type StatEntry
} from "../shared/protocol";
import { enforceReadonlySql } from "./readonlySql";
import { normalizePreviewLimit, normalizeSource } from "./sourceUtils";

const DEFAULT_TABLE_ALIAS = "selected_relation";
const EXTENSION_DIRECTORY = "/tmp/dabble-duckdb-extensions";
const QUERY_PAGE_ROW_TARGET = 2048;

type QueryRow = Record<string, unknown>;

interface SourceContext {
  selectedTable: string;
  tables: string[];
  title: string;
  description: string;
  tree: string[];
  diagnostics: string[];
}

interface PreviewData {
  headers: string[];
  rows: string[][];
}

export class DuckDBService {
  private instancePromise: Promise<DuckDBInstance> | null = null;

  async loadSource(source: SourceDescriptor, options: { previewLimit?: number } = {}): Promise<LoadSourceResult> {
    const normalized = normalizeSource(source);
    return this.withSourceConnection(normalized, async (connection) => {
      await this.prepareEnvironment(connection, normalized);
      const context = await this.prepareSourceContext(connection, normalized);
      const previewLimit = normalizePreviewLimit(options.previewLimit);
      const schema = await this.describeRelation(connection);
      const summaryRows = await this.summarizeRelation(connection);
      const preview = await this.previewRelation(connection, previewLimit);
      const stats = await this.buildStats(connection, normalized, context, schema, previewLimit);
      const selectedColumn = pickSelectedColumn(schema, normalized.selectedColumn);
      const explorer = await this.buildExplorer(connection, selectedColumn, schema, summaryRows);
      const editorQuery = buildDefaultQuery();
      const queryResult = await executeReadonlyQuery(connection, editorQuery);

      return {
        source: {
          ...normalized,
          selectedTable: context.selectedTable,
          selectedColumn
        },
        payload: {
          path: normalized.path,
          title: context.title,
          text: context.description,
          stats,
          tree: context.tree,
          tables: context.tables,
          columns: buildColumns(summaryRows),
          rowCountLabel: extractStat(stats, "Rows") || extractStat(stats, "Objects") || "",
          summaryHeaders: ["Column", "Type", "Null %", "Summary"],
          summaryRows: buildSummaryTableRows(summaryRows),
          previewText: `The first ${previewLimit} rows from the selected relation.`,
          limit: `LIMIT ${previewLimit}`,
          previewHeaders: preview.headers,
          previewRows: preview.rows,
          sql: editorQuery,
          queryHeaders: queryResult.headers,
          queryRows: queryResult.rows,
          querySummary: queryResult.summary,
          explorer,
          diagnostics: context.diagnostics
        }
      };
    });
  }

  async runQuery(source: SourceDescriptor, sql: string, state: Partial<SourceDescriptor> = {}): Promise<QueryResult> {
    const normalized = normalizeSource({
      ...source,
      selectedTable: state.selectedTable ?? source.selectedTable
    });
    const readonlySql = enforceReadonlySql(sql);

    return this.withSourceConnection(normalized, async (connection) => {
      await this.prepareEnvironment(connection, normalized);
      await this.prepareSourceContext(connection, normalized);
      return executeReadonlyQuery(connection, readonlySql);
    });
  }

  async startQuery(source: SourceDescriptor, sql: string, state: Partial<SourceDescriptor> = {}): Promise<QuerySession> {
    const normalized = normalizeSource({
      ...source,
      selectedTable: state.selectedTable ?? source.selectedTable
    });
    const readonlySql = enforceReadonlySql(sql);

    if (normalized.kind === "duckdb") {
      fs.mkdirSync(EXTENSION_DIRECTORY, { recursive: true });
      const instance = await DuckDBInstance.create(normalized.path, {
        access_mode: "READ_ONLY",
        extension_directory: EXTENSION_DIRECTORY
      });
      const connection = await instance.connect();
      try {
        await this.prepareEnvironment(connection, normalized);
        await this.prepareSourceContext(connection, normalized);
        const result = await connection.stream(readonlySql);
        return new QuerySession(connection, result, async () => {
          connection.closeSync();
          instance.closeSync();
        });
      } catch (error) {
        connection.closeSync();
        instance.closeSync();
        throw error;
      }
    }

    const instance = await this.getInstance();
    const connection = await instance.connect();
    try {
      await this.prepareEnvironment(connection, normalized);
      await this.prepareSourceContext(connection, normalized);
      const result = await connection.stream(readonlySql);
      return new QuerySession(connection, result, async () => {
        connection.closeSync();
      });
    } catch (error) {
      connection.closeSync();
      throw error;
    }
  }

  private async prepareEnvironment(connection: DuckDBConnection, source: SourceDescriptor): Promise<void> {
    fs.mkdirSync(EXTENSION_DIRECTORY, { recursive: true });
    await connection.run(`SET extension_directory = '${escapeLiteral(EXTENSION_DIRECTORY)}'`);

    if (source.kind === "sqlite") {
      await loadExtension(connection, "sqlite");
    }
    if (source.kind === "duckdb") {
      return;
    }
    if (source.kind === "s3") {
      await loadExtension(connection, "httpfs");
      if (source.s3Profile) {
        const profile = escapeLiteral(source.s3Profile);
        await connection.run(`
          CREATE OR REPLACE SECRET dabble_s3_secret (
            TYPE s3,
            PROVIDER credential_chain,
            CHAIN config,
            PROFILE '${profile}'
          )
        `);
      }
    }
  }

  private async prepareSourceContext(connection: DuckDBConnection, source: SourceDescriptor): Promise<SourceContext> {
    if (source.kind === "sqlite") {
      const dbAlias = createDatabaseAlias();
      await connection.run(`
        ATTACH '${escapeLiteral(source.path)}' AS ${dbAlias}
        (TYPE sqlite, READ_ONLY)
      `);

      const tables = await queryRows<{ table_name?: string }>(
        connection,
        `
          SELECT table_name
          FROM information_schema.tables
          WHERE table_catalog = '${dbAlias}'
            AND table_schema = 'main'
            AND table_type = 'BASE TABLE'
          ORDER BY table_name
        `
      );

      const tableNames = tables.map((row) => String(row.table_name ?? "")).filter(Boolean);
      const selectedTable = pickSelectedTable(tableNames, source.selectedTable);
      if (!selectedTable) {
        throw new Error("No readable tables were found in the SQLite database.");
      }

      await connection.run(`
        CREATE OR REPLACE TEMP VIEW ${DEFAULT_TABLE_ALIAS} AS
        SELECT * FROM ${dbAlias}.${quoteIdentifier(selectedTable)}
      `);

      return {
        selectedTable,
        tables: tableNames,
        title: `${path.basename(source.path, path.extname(source.path))} / ${selectedTable}`,
        description: "SQLite opens as a database with a selected table.",
        tree: [
          path.basename(source.path, path.extname(source.path)),
          "main",
          selectedTable,
          tableNames.length > 1 ? `${tableNames.length - 1} other tables` : "single table"
        ],
        diagnostics: []
      };
    }

    if (source.kind === "duckdb") {
      const currentCatalogRows = await queryRows<{ catalog_name?: string }>(
        connection,
        "SELECT current_catalog() AS catalog_name"
      );
      const dbAlias = String(currentCatalogRows[0]?.catalog_name ?? "");

      const tables = await queryRows<{ table_schema?: string; table_name?: string }>(
        connection,
        `
          SELECT table_schema, table_name
          FROM information_schema.tables
          WHERE table_catalog = '${escapeLiteral(dbAlias)}'
            AND table_schema NOT IN ('information_schema', 'pg_catalog')
            AND table_type = 'BASE TABLE'
          ORDER BY table_schema, table_name
        `
      );

      const tableRefs = tables
        .map((row) => ({
          schema: String(row.table_schema ?? ""),
          name: String(row.table_name ?? "")
        }))
        .filter((row) => row.schema && row.name);

      const selectedRef = pickSelectedDuckDBTable(tableRefs, source.selectedTable);
      if (!selectedRef) {
        throw new Error("No readable tables were found in the DuckDB database.");
      }

      await connection.run(`
        CREATE OR REPLACE TEMP VIEW ${DEFAULT_TABLE_ALIAS} AS
        SELECT * FROM ${quoteIdentifier(selectedRef.schema)}.${quoteIdentifier(selectedRef.name)}
      `);

      const tableNames = tableRefs.map((item) => qualifyTableName(item.schema, item.name));
      return {
        selectedTable: qualifyTableName(selectedRef.schema, selectedRef.name),
        tables: tableNames,
        title: `${path.basename(source.path, path.extname(source.path))} / ${selectedRef.name}`,
        description: "DuckDB opens as a database with a selected table.",
        tree: [
          path.basename(source.path, path.extname(source.path)),
          selectedRef.schema,
          selectedRef.name,
          tableRefs.length > 1 ? `${tableRefs.length - 1} other tables` : "single table"
        ],
        diagnostics: []
      };
    }

    const relationSql = buildRelationSql(source);
    await connection.run(`
      CREATE OR REPLACE TEMP VIEW ${DEFAULT_TABLE_ALIAS} AS
      SELECT * FROM ${relationSql}
    `);

    if (source.kind === "dataset") {
      return {
        selectedTable: "events_dataset",
        tables: ["events_dataset"],
        title: `${path.basename(stripTrailingSlash(source.path))} dataset`,
        description: "A folder-backed Parquet dataset treated as one relation.",
        tree: [path.basename(stripTrailingSlash(source.path)), "main", "events_dataset", "parquet metadata"],
        diagnostics: []
      };
    }

    if (source.kind === "s3") {
      return {
        selectedTable: "remote_dataset",
        tables: ["remote_dataset"],
        title: stripTrailingSlash(source.path),
        description: "The same summary flow, entered via connect source.",
        tree: ["remote", "main", "remote_dataset", source.s3Profile ? `profile ${source.s3Profile}` : "default credentials"],
        diagnostics: []
      };
    }

    return {
      selectedTable: path.basename(source.path, path.extname(source.path)),
      tables: [path.basename(source.path, path.extname(source.path))],
      title: path.basename(source.path, path.extname(source.path)),
      description: "A single Parquet file opened from the editor.",
      tree: [
        path.basename(source.path, path.extname(source.path)),
        "main",
        path.basename(source.path, path.extname(source.path)),
        "parquet metadata"
      ],
      diagnostics: []
    };
  }

  private async describeRelation(connection: DuckDBConnection): Promise<QueryRow[]> {
    return queryRows(connection, `DESCRIBE SELECT * FROM ${DEFAULT_TABLE_ALIAS}`);
  }

  private async summarizeRelation(connection: DuckDBConnection): Promise<QueryRow[]> {
    return queryRows(connection, `SUMMARIZE SELECT * FROM ${DEFAULT_TABLE_ALIAS}`);
  }

  private async previewRelation(connection: DuckDBConnection, previewLimit: number): Promise<PreviewData> {
    const rows = await queryRows(connection, `SELECT * FROM ${DEFAULT_TABLE_ALIAS} LIMIT ${previewLimit}`);
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    return {
      headers,
      rows: rowObjectsToArrays(headers, rows)
    };
  }

  private async buildStats(
    connection: DuckDBConnection,
    source: SourceDescriptor,
    context: SourceContext,
    schema: QueryRow[],
    previewLimit: number
  ): Promise<StatEntry[]> {
    const columns = schema.length;

    if (source.kind === "sqlite") {
      const countRows = await queryRows<{ row_count?: number }>(
        connection,
        `SELECT count(*)::BIGINT AS row_count FROM ${DEFAULT_TABLE_ALIAS}`
      );
      return [
        ["Tables", String(context.tables.length)],
        ["Rows", formatNumber(countRows[0]?.row_count)],
        ["Preview", String(previewLimit)],
        ["Source", "SQLite file"]
      ];
    }

    if (source.kind === "duckdb") {
      const countRows = await queryRows<{ row_count?: number }>(
        connection,
        `SELECT count(*)::BIGINT AS row_count FROM ${DEFAULT_TABLE_ALIAS}`
      );
      return [
        ["Tables", String(context.tables.length)],
        ["Rows", formatNumber(countRows[0]?.row_count)],
        ["Preview", String(previewLimit)],
        ["Source", "DuckDB file"]
      ];
    }

    const metadataPath = source.kind === "parquet" ? source.path : buildParquetGlob(source.path, source.kind === "s3");
    let metaRows: Array<{ row_count?: number; file_count?: number }> = [];
    try {
      metaRows = await queryRows<{ row_count?: number; file_count?: number }>(
        connection,
        `SELECT sum(num_rows)::BIGINT AS row_count, count(*)::BIGINT AS file_count FROM parquet_file_metadata('${escapeLiteral(metadataPath)}')`
      );
    } catch {
      metaRows = [];
    }

    const rowCount = metaRows[0]?.row_count ?? null;
    const fileCount = metaRows[0]?.file_count ?? (source.kind === "parquet" ? 1 : null);

    if (source.kind === "dataset") {
      return [
        ["Rows", rowCount != null ? formatNumber(rowCount) : "Unknown"],
        ["Files", fileCount != null ? formatNumber(fileCount) : "Unknown"],
        ["Preview", String(previewLimit)],
        ["Source", "Folder dataset"]
      ];
    }

    if (source.kind === "s3") {
      return [
        ["Rows", rowCount != null ? formatNumber(rowCount) : "Unknown"],
        ["Objects", fileCount != null ? formatNumber(fileCount) : "Unknown"],
        ["Preview", String(previewLimit)],
        ["Source", "S3 dataset"]
      ];
    }

    return [
      ["Rows", rowCount != null ? formatNumber(rowCount) : "Unknown"],
      ["Columns", String(columns)],
      ["Preview", String(previewLimit)],
      ["Source", "Local file"]
    ];
  }

  private async buildExplorer(
    connection: DuckDBConnection,
    selectedColumn: string | null,
    schema: QueryRow[],
    summaryRows: QueryRow[]
  ): Promise<ExplorerPayload> {
    const columnSchema =
      schema.find((column) => String(column.column_name ?? "") === selectedColumn) ??
      schema[0];
    if (!columnSchema) {
      return createEmptyExplorer();
    }

    const effectiveColumn = String(columnSchema.column_name ?? "");
    const summary =
      summaryRows.find((row) => String(row.column_name ?? "") === effectiveColumn) ??
      {};
    const columnType = String(columnSchema.column_type ?? "");

    if (isNumericType(columnType)) {
      const statsRows = await queryRows<{
        avg_value?: number;
        median_value?: number;
        p95_value?: number;
        null_count?: number;
      }>(
        connection,
        `
          SELECT
            avg(${quoteIdentifier(effectiveColumn)})::DOUBLE AS avg_value,
            approx_quantile(${quoteIdentifier(effectiveColumn)}, 0.5)::DOUBLE AS median_value,
            approx_quantile(${quoteIdentifier(effectiveColumn)}, 0.95)::DOUBLE AS p95_value,
            count(*) FILTER (WHERE ${quoteIdentifier(effectiveColumn)} IS NULL)::BIGINT AS null_count
          FROM ${DEFAULT_TABLE_ALIAS}
        `
      );
      const histogram = await numericHistogram(connection, effectiveColumn);
      const stats = statsRows[0] ?? {};
      return {
        title: effectiveColumn,
        type: columnType,
        kind: "numeric",
        chips: [
          `avg ${formatNumber(stats.avg_value)}`,
          `median ${formatNumber(stats.median_value)}`,
          `p95 ${formatNumber(stats.p95_value)}`,
          `null ${formatNumber(stats.null_count)}`
        ],
        bars: histogram.map((item) => [item.label, item.percent]),
        distributionRows: histogram,
        details: [
          ["Min / Max", `${stringValue(summary.min)} to ${stringValue(summary.max)}`],
          ["Quartiles", `${stringValue(summary.q25)} / ${stringValue(summary.q50)} / ${stringValue(summary.q75)}`],
          ["Approx distinct", stringValue(summary.approx_unique)]
        ],
        sql: `SELECT histogram(${quoteIdentifier(effectiveColumn)}) FROM ${DEFAULT_TABLE_ALIAS};`
      };
    }

    const topValues = await topValuesQuery(connection, effectiveColumn);
    return {
      title: effectiveColumn,
      type: columnType,
      kind: "categorical",
      chips: topValues.slice(0, 4).map((item) => `${item.label} ${formatNumber(item.value)}`),
      bars: topValues.map((item) => [item.label, item.percent]),
      distributionRows: topValues,
      details: [
        ["Null %", formatNullPercentage(summary.null_percentage)],
        ["Approx distinct", stringValue(summary.approx_unique)],
        ["Most common", topValues.length > 0 ? topValues[0].label : "No values"]
      ],
      sql: `SELECT ${quoteIdentifier(effectiveColumn)}, count(*) FROM ${DEFAULT_TABLE_ALIAS} GROUP BY 1 ORDER BY 2 DESC LIMIT 6;`
    };
  }

  private async withConnection<T>(work: (connection: DuckDBConnection) => Promise<T>): Promise<T> {
    const instance = await this.getInstance();
    const connection = await instance.connect();
    try {
      return await work(connection);
    } finally {
      connection.closeSync();
    }
  }

  private async withSourceConnection<T>(
    source: SourceDescriptor,
    work: (connection: DuckDBConnection) => Promise<T>
  ): Promise<T> {
    if (source.kind !== "duckdb") {
      return this.withConnection(work);
    }

    fs.mkdirSync(EXTENSION_DIRECTORY, { recursive: true });
    const instance = await DuckDBInstance.create(source.path, {
      access_mode: "READ_ONLY",
      extension_directory: EXTENSION_DIRECTORY
    });
    const connection = await instance.connect();
    try {
      return await work(connection);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  }

  private async getInstance(): Promise<DuckDBInstance> {
    if (!this.instancePromise) {
      this.instancePromise = DuckDBInstance.create(":memory:");
    }
    return this.instancePromise;
  }
}

export class QuerySession {
  private readonly iterator: AsyncIterableIterator<DuckDBDataChunk>;
  private readonly headers: string[];
  private loadedRowCount = 0;
  private done = false;
  private disposed = false;

  constructor(
    private readonly connection: DuckDBConnection,
    private readonly result: DuckDBResult,
    private readonly cleanup: () => Promise<void>
  ) {
    this.iterator = result[Symbol.asyncIterator]();
    this.headers = result.deduplicatedColumnNames();
  }

  get complete(): boolean {
    return this.done;
  }

  async readNextPage(): Promise<QueryResult> {
    return this.readRows(QUERY_PAGE_ROW_TARGET);
  }

  async readAllRemaining(): Promise<QueryResult> {
    return this.readRows(Number.POSITIVE_INFINITY);
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.connection.interrupt();
    await this.cleanup();
  }

  private async readRows(targetRowCount: number): Promise<QueryResult> {
    if (this.disposed) {
      throw new Error("This query session has already been closed.");
    }

    const newRows: string[][] = [];

    while (!this.done && newRows.length < targetRowCount) {
      const nextChunk = await this.iterator.next();
      if (nextChunk.done || !nextChunk.value) {
        this.done = true;
        break;
      }

      const chunkRows = convertChunkRows(nextChunk.value);
      newRows.push(...chunkRows);
    }

    this.loadedRowCount += newRows.length;
    if (this.done) {
      await this.dispose();
    }

    return {
      headers: this.headers,
      rows: newRows,
      summary: buildPagedQuerySummary(this.loadedRowCount, this.done),
      loadedRowCount: this.loadedRowCount,
      done: this.done
    };
  }
}

async function loadExtension(connection: DuckDBConnection, extensionName: string): Promise<void> {
  try {
    await connection.run(`LOAD ${quoteIdentifier(extensionName, false)}`);
  } catch {
    await connection.run(`INSTALL ${quoteIdentifier(extensionName, false)}`);
    await connection.run(`LOAD ${quoteIdentifier(extensionName, false)}`);
  }
}

async function queryRows<T extends QueryRow = QueryRow>(
  connection: DuckDBConnection,
  sql: string,
  values?: Record<string, unknown> | unknown[]
): Promise<T[]> {
  const reader = await connection.runAndReadAll(sql, values as never);
  return reader.getRowObjectsJson() as T[];
}

async function inferHeaders(connection: DuckDBConnection, sql: string): Promise<string[]> {
  const described = await queryRows<{ column_name?: string }>(connection, `DESCRIBE ${sql}`);
  return described.map((row) => String(row.column_name ?? ""));
}

async function executeReadonlyQuery(connection: DuckDBConnection, sql: string): Promise<QueryResult> {
  const rows = await queryRows(connection, sql);
  const headers = rows.length > 0 ? Object.keys(rows[0]) : await inferHeaders(connection, sql);
  return {
    sql,
    headers,
    rows: rowObjectsToArrays(headers, rows),
    summary: buildQuerySummary(headers, rows),
    loadedRowCount: rows.length,
    done: true
  };
}

function buildRelationSql(source: SourceDescriptor): string {
  if (source.kind === "parquet") {
    return `read_parquet('${escapeLiteral(source.path)}', hive_partitioning = true)`;
  }

  if (source.kind === "dataset" || source.kind === "s3") {
    return `read_parquet('${escapeLiteral(buildParquetGlob(source.path, source.kind === "s3"))}', hive_partitioning = true, union_by_name = true)`;
  }

  throw new Error(`Unsupported source kind: ${source.kind}`);
}

function buildParquetGlob(basePath: string, remote = false): string {
  const normalized = stripTrailingSlash(basePath);
  if (normalized.endsWith(".parquet")) {
    return normalized;
  }
  if (remote) {
    return `${normalized}/**/*.parquet`;
  }
  return path.join(normalized, "**", "*.parquet");
}

function stripTrailingSlash(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

function rowObjectsToArrays(headers: string[], rows: QueryRow[]): string[][] {
  return rows.map((row) => headers.map((header) => stringValue(row[header])));
}

function convertChunkRows(chunk: DuckDBDataChunk): string[][] {
  const jsRows = chunk.convertRows(JSDuckDBValueConverter);
  return jsRows.map((row) => row.map((value) => stringValue(value)));
}

function buildSummaryTableRows(summaryRows: QueryRow[]): string[][] {
  return summaryRows.map((row) => [
    stringValue(row.column_name),
    stringValue(row.column_type),
    stringValue(row.null_percentage),
    summarySummary(row)
  ]);
}

function buildColumns(summaryRows: QueryRow[]): ColumnSummary[] {
  return summaryRows.map((row) => ({
    name: stringValue(row.column_name),
    type: stringValue(row.column_type),
    approxDistinct: stringValue(row.approx_unique) || "0",
    nullPercentage: formatNullPercentage(row.null_percentage),
    nullDisplay: displayNullValue(row),
    distinctDisplay: displayDistinctValue(row),
    summary: summarySummary(row)
  }));
}

function summarySummary(row: QueryRow): string {
  if (row.avg != null && row.avg !== "") {
    return `avg ${stringValue(row.avg)}, q50 ${stringValue(row.q50)}`;
  }
  if (row.min != null || row.max != null) {
    return `${stringValue(row.min)} to ${stringValue(row.max)}`;
  }
  return `${stringValue(row.approx_unique)} distinct`;
}

function displayDistinctValue(row: QueryRow): string {
  if (formatNullPercentage(row.null_percentage) === "100%") {
    return "no data";
  }
  if (row.approx_unique == null || row.approx_unique === "") {
    return "no data";
  }
  return stringValue(row.approx_unique);
}

function displayNullValue(row: QueryRow): string {
  const formatted = formatNullPercentage(row.null_percentage);
  if (!formatted) {
    return "–";
  }
  return formatted === "0%" ? "–" : formatted;
}

function extractStat(stats: StatEntry[], label: string): string {
  const match = stats.find((item) => item[0] === label);
  return match ? match[1] : "";
}

function formatNullPercentage(value: unknown): string {
  if (value == null || value === "") {
    return "";
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return String(value);
  }
  const rounded = Math.round(numeric * 100) / 100;
  if (rounded === 0) {
    return "0%";
  }
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(rounded)}%`;
}

function pickSelectedColumn(schema: QueryRow[], preferred: string | null): string | null {
  const names = schema.map((column) => String(column.column_name ?? "")).filter(Boolean);
  if (preferred && names.includes(preferred)) {
    return preferred;
  }
  const numeric = schema.find((column) => isNumericType(String(column.column_type ?? "")));
  return String(numeric?.column_name ?? names[0] ?? "") || null;
}

function pickSelectedTable(tables: string[], preferred: string | null): string | null {
  if (preferred && tables.includes(preferred)) {
    return preferred;
  }
  return tables[0] ?? null;
}

function pickSelectedDuckDBTable(
  tableRefs: Array<{ schema: string; name: string }>,
  preferred: string | null
): { schema: string; name: string } | null {
  if (!preferred) {
    return tableRefs[0] ?? null;
  }
  return tableRefs.find((tableRef) => qualifyTableName(tableRef.schema, tableRef.name) === preferred) ?? tableRefs[0] ?? null;
}

function buildDefaultQuery(): string {
  return `SELECT *\nFROM ${DEFAULT_TABLE_ALIAS}\nLIMIT 100;`;
}

function buildQuerySummary(headers: string[], rows: QueryRow[]): StatEntry[] {
  if (rows.length === 0) {
    return [["Result", "No rows returned"]];
  }

  return headers.slice(0, 3).map((header) => {
    const samples = rows.slice(0, 3).map((row) => stringValue(row[header])).join(", ");
    return [header, `Sample values: ${samples}`];
  });
}

function buildPagedQuerySummary(loadedRowCount: number, done: boolean): StatEntry[] {
  return [
    ["Rows loaded", formatNumber(loadedRowCount)],
    ["Status", done ? "Complete" : "More rows available"]
  ];
}

function formatNumber(value: unknown): string {
  if (value == null || value === "") {
    return "Unknown";
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return new Intl.NumberFormat("en-US", {
      maximumFractionDigits: numeric >= 100 ? 0 : 2
    }).format(numeric);
  }
  return String(value);
}

function stringValue(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (value instanceof Uint8Array) {
    return `<${value.length} bytes>`;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number") {
    return formatNumber(value);
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (typeof value === "object") {
    return JSON.stringify(value, (_key, nestedValue: JS | unknown) =>
      typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue
    );
  }
  return String(value);
}

function quoteIdentifier(value: string, wrap = true): string {
  const escaped = String(value).replace(/"/g, "\"\"");
  return wrap ? `"${escaped}"` : escaped;
}

function escapeLiteral(value: string): string {
  return String(value).replace(/'/g, "''");
}

function isNumericType(type: string): boolean {
  return /TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|FLOAT|DOUBLE|DECIMAL|REAL/i.test(type);
}

async function numericHistogram(connection: DuckDBConnection, columnName: string): Promise<DistributionRow[]> {
  const column = quoteIdentifier(columnName);
  const rows = await queryRows<{ bucket?: number; bucket_count?: number }>(
    connection,
    `
      WITH bounds AS (
        SELECT
          min(${column})::DOUBLE AS min_value,
          max(${column})::DOUBLE AS max_value
        FROM ${DEFAULT_TABLE_ALIAS}
        WHERE ${column} IS NOT NULL
      ),
      bucketed AS (
        SELECT
          CASE
            WHEN bounds.max_value = bounds.min_value THEN 0
            ELSE LEAST(
              5,
              GREATEST(
                0,
                CAST(floor(((${column}::DOUBLE - bounds.min_value) / NULLIF(bounds.max_value - bounds.min_value, 0)) * 6) AS INTEGER)
              )
            )
          END AS bucket
        FROM ${DEFAULT_TABLE_ALIAS}, bounds
        WHERE ${column} IS NOT NULL
      )
      SELECT bucket, count(*)::BIGINT AS bucket_count
      FROM bucketed
      GROUP BY 1
      ORDER BY 1
    `
  );

  const total = rows.reduce((sum, row) => sum + (Number(row.bucket_count) || 0), 0) || 1;
  return rows.map((row) => ({
    label: String(row.bucket ?? ""),
    value: Number(row.bucket_count) || 0,
    percent: Math.max(8, Math.round(((Number(row.bucket_count) || 0) / total) * 100))
  }));
}

async function topValuesQuery(connection: DuckDBConnection, columnName: string): Promise<DistributionRow[]> {
  const column = quoteIdentifier(columnName);
  const rows = await queryRows<{ label?: string; value?: number; percent?: number }>(
    connection,
    `
      WITH top_values AS (
        SELECT
          coalesce(${column}::VARCHAR, '(null)') AS label,
          count(*)::BIGINT AS value
        FROM ${DEFAULT_TABLE_ALIAS}
        GROUP BY 1
        ORDER BY 2 DESC, 1
        LIMIT 6
      ),
      totals AS (
        SELECT greatest(sum(value), 1) AS total_value FROM top_values
      )
      SELECT
        label,
        value,
        CAST(round((value::DOUBLE / totals.total_value) * 100) AS INTEGER) AS percent
      FROM top_values, totals
      ORDER BY value DESC, label
    `
  );

  return rows.map((row) => ({
    label: String(row.label ?? ""),
    value: Number(row.value) || 0,
    percent: Math.max(8, Number(row.percent) || 0)
  }));
}

function createDatabaseAlias(): string {
  return `source_db_${Math.random().toString(36).slice(2, 10)}`;
}

function qualifyTableName(schema: string, name: string): string {
  return schema === "main" ? name : `${schema}.${name}`;
}
