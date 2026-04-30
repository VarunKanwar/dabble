import {
  createEmptyPayload,
  type ExtensionToWebviewMessage,
  type LocalSourceKind,
  type MainTab,
  type PersistedUiState,
  type QueryResult,
  type SourceDescriptor,
  type SourcePayload,
  type ViewMode
} from "../shared/protocol.js";

export interface ConnectFormState {
  localType: LocalSourceKind;
  localPath: string;
  s3Path: string;
  s3Profile: string;
}

export interface AppState {
  mode: ViewMode;
  tab: MainTab;
  payload: SourcePayload;
  source: SourceDescriptor | null;
  expandedColumnName: string | null;
  openingColumnName: string | null;
  closingColumnName: string | null;
  querySql: string;
  queryResult: QueryResult;
  loading: boolean;
  error: string;
  form: ConnectFormState;
  ui: Required<PersistedUiState>;
}

const DEFAULT_S3_PATH = "s3://acme-lake/orders/year=2026/month=04/";
const DEFAULT_S3_PROFILE = "";
const DEFAULT_LOCAL_TYPE: LocalSourceKind = "parquet";

export function createInitialState(persisted: PersistedUiState = {}): AppState {
  return {
    mode: "clicked",
    tab: "preview",
    payload: createEmptyPayload(),
    source: null,
    expandedColumnName: null,
    openingColumnName: null,
    closingColumnName: null,
    querySql: "",
    queryResult: emptyQueryResult(),
    loading: true,
    error: "",
    form: {
      localType: DEFAULT_LOCAL_TYPE,
      localPath: "",
      s3Path: DEFAULT_S3_PATH,
      s3Profile: DEFAULT_S3_PROFILE
    },
    ui: {
      sidebarWidth: clampNumber(persisted.sidebarWidth, 268, 520, 300),
      explorerHeight: clampNumber(persisted.explorerHeight, 180, 520, 284)
    }
  };
}

export function applyExtensionMessage(current: AppState, message: ExtensionToWebviewMessage): AppState {
  switch (message.type) {
    case "sourceData": {
      const nextTab = message.mode === "clicked" && current.tab !== "query" ? "preview" : current.tab;
      const isLocal = isLocalSource(message.source);
      const sameSelectedTable =
        current.source?.kind === message.source.kind &&
        current.source?.path === message.source.path &&
        current.source?.selectedTable === message.source.selectedTable;
      // Keep stats collapsed by default on initial/table loads to preserve spatial stability.
      // Only expand when the user selects another column within the same table context.
      const shouldExpandSelectedColumn =
        message.mode === "clicked" &&
        sameSelectedTable &&
        Boolean(message.source.selectedColumn) &&
        message.source.selectedColumn !== current.expandedColumnName;
      const nextExpandedColumn = shouldExpandSelectedColumn ? message.source.selectedColumn : null;
      const nextLocalType = message.source.kind === "dataset"
        ? "dataset"
        : isLocalSourceKind(message.source.kind)
          ? message.source.kind
          : current.form.localType;
      return {
        ...current,
        mode: message.mode,
        tab: nextTab,
        source: message.source,
        expandedColumnName: nextExpandedColumn,
        openingColumnName: nextExpandedColumn,
        closingColumnName: null,
        payload: message.payload,
        querySql: message.payload.sql || "",
        queryResult: {
          headers: message.payload.queryHeaders || [],
          rows: message.payload.queryRows || [],
          summary: message.payload.querySummary || [],
          loadedRowCount: (message.payload.queryRows || []).length,
          done: true
        },
        form: {
          ...current.form,
          localPath: isLocal ? message.source.path || current.form.localPath : current.form.localPath,
          localType: nextLocalType,
          s3Path: message.source.kind === "s3" ? message.source.path || current.form.s3Path : current.form.s3Path,
          s3Profile: message.source.kind === "s3" ? message.source.s3Profile || "" : current.form.s3Profile
        },
        error: ""
      };
    }
    case "queryResult":
      return {
        ...current,
        queryResult: message.append
          ? {
              ...message.query,
              rows: [...current.queryResult.rows, ...message.query.rows]
            }
          : message.query,
        error: ""
      };
    case "error":
      return {
        ...current,
        error: message.message || "Unknown error",
        loading: false
      };
    case "loading":
      return {
        ...current,
        loading: Boolean(message.loading)
      };
    case "localBrowseResult":
      return {
        ...current,
        form: {
          ...current.form,
          localPath: message.path || ""
        }
      };
    default:
      return current;
  }
}

export function setMode(state: AppState, mode: ViewMode): AppState {
  return {
    ...state,
    mode,
    tab: mode === "clicked" ? state.tab : "preview"
  };
}

export function setTab(state: AppState, tab: MainTab): AppState {
  return { ...state, tab };
}

export function setQuerySql(state: AppState, querySql: string): AppState {
  return { ...state, querySql };
}

export function setExpandedColumn(state: AppState, expandedColumnName: string | null): AppState {
  return { ...state, expandedColumnName, openingColumnName: null, closingColumnName: null };
}

export function setClosingColumn(state: AppState, closingColumnName: string | null): AppState {
  return { ...state, openingColumnName: null, closingColumnName };
}

export function setOpeningColumn(state: AppState, openingColumnName: string | null): AppState {
  return { ...state, openingColumnName, closingColumnName: null };
}

export function updateFormField(state: AppState, field: keyof ConnectFormState, value: string): AppState {
  if (field === "localType" && !isLocalSourceKind(value)) {
    return state;
  }

  return {
    ...state,
    form: {
      ...state.form,
      [field]: value
    }
  };
}

export function updateUiState(
  state: AppState,
  partial: Partial<Required<PersistedUiState>>
): AppState {
  return {
    ...state,
    ui: {
      ...state.ui,
      ...partial
    }
  };
}

export function emptyQueryResult(): QueryResult {
  return {
    headers: [],
    rows: [],
    summary: [],
    loadedRowCount: 0,
    done: true
  };
}

export function isLocalSource(source: SourceDescriptor | null): source is SourceDescriptor {
  return Boolean(source && source.kind !== "s3");
}

export function isLocalSourceKind(value: unknown): value is LocalSourceKind {
  return value === "parquet" || value === "jsonl" || value === "dataset" || value === "sqlite" || value === "duckdb";
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}
