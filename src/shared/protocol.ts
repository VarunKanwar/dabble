export type SourceKind = "parquet" | "dataset" | "sqlite" | "duckdb" | "s3";
export type LocalSourceKind = Exclude<SourceKind, "s3">;
export type ViewMode = "clicked" | "connect";
export type MainTab = "preview" | "query";

export interface SourceDescriptor {
  kind: SourceKind;
  path: string;
  selectedTable: string | null;
  selectedColumn: string | null;
  s3Profile: string | null;
}

export interface IncomingSourceSelection {
  localType?: LocalSourceKind;
  path?: string;
  s3Profile?: string | null;
}

export type StatEntry = [label: string, value: string];

export interface ColumnSummary {
  name: string;
  type: string;
  approxDistinct: string;
  nullPercentage: string;
  nullDisplay: string;
  distinctDisplay: string;
  summary: string;
}

export interface DistributionRow {
  label: string;
  value: number;
  percent: number;
}

export interface ExplorerPayload {
  title: string;
  type: string;
  kind: "numeric" | "categorical";
  chips: string[];
  bars: Array<[label: string, percent: number]>;
  distributionRows: DistributionRow[];
  details: StatEntry[];
  sql: string;
}

export interface QueryResult {
  sql?: string;
  headers: string[];
  rows: string[][];
  summary: StatEntry[];
  loadedRowCount: number;
  done: boolean;
}

export interface SourcePayload {
  path: string;
  title: string;
  text: string;
  stats: StatEntry[];
  tree: string[];
  tables: string[];
  columns: ColumnSummary[];
  rowCountLabel: string;
  summaryHeaders: string[];
  summaryRows: string[][];
  previewText: string;
  limit: string;
  previewHeaders: string[];
  previewRows: string[][];
  sql: string;
  queryHeaders: string[];
  queryRows: string[][];
  querySummary: StatEntry[];
  explorer: ExplorerPayload;
  diagnostics: string[];
}

export interface LoadSourceResult {
  source: SourceDescriptor;
  payload: SourcePayload;
}

export interface PersistedUiState {
  sidebarWidth?: number;
  explorerHeight?: number;
}

export type WebviewToExtensionMessage =
  | { type: "ready" }
  | { type: "runQuery"; sql: string }
  | { type: "loadMoreQueryRows" }
  | { type: "loadAllQueryRows" }
  | { type: "selectColumn"; columnName: string }
  | { type: "selectTable"; tableName: string }
  | { type: "switchMode"; mode: ViewMode }
  | { type: "browseLocal"; kind: LocalSourceKind }
  | { type: "openSource"; source: IncomingSourceSelection };

export type ExtensionToWebviewMessage =
  | {
      type: "sourceData";
      mode: ViewMode;
      previewLimit: number;
      source: SourceDescriptor;
      payload: SourcePayload;
    }
  | { type: "queryResult"; query: QueryResult; append: boolean }
  | { type: "error"; message: string }
  | { type: "loading"; loading: boolean }
  | { type: "localBrowseResult"; path: string };

export function createEmptyExplorer(): ExplorerPayload {
  return {
    title: "",
    type: "",
    kind: "categorical",
    chips: [],
    bars: [],
    distributionRows: [],
    details: [],
    sql: ""
  };
}

export function createEmptyPayload(): SourcePayload {
  return {
    path: "",
    title: "Loading DuckView",
    text: "",
    stats: [],
    tree: ["", "", "", ""],
    tables: [],
    columns: [],
    rowCountLabel: "",
    summaryHeaders: [],
    summaryRows: [],
    previewText: "",
    limit: "",
    previewHeaders: [],
    previewRows: [],
    sql: "",
    queryHeaders: [],
    queryRows: [],
    querySummary: [],
    explorer: createEmptyExplorer(),
    diagnostics: []
  };
}
