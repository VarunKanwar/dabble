import path from "path";
import * as vscode from "vscode";
import { createEmptyPayload, type ExtensionToWebviewMessage, type SourceDescriptor, type SourcePayload, type ViewMode } from "../shared/protocol";
import { DuckDBService, QuerySession, type ExactColumnMetric } from "./duckdbService";
import { DEFAULT_PREVIEW_LIMIT, inferKindFromPath, normalizeIncomingSource, normalizePreviewLimit } from "./sourceUtils";
import { getWebviewOptions, renderWebviewShell } from "./webviewHtml";
import { parseWebviewMessage } from "./webviewMessage";
import { DEFAULT_S3_SOURCE_FORMAT } from "../shared/sourceKinds";

const VIEW_TYPE = "dabble.viewer";
const JSONL_VIEW_TYPE = "dabble.viewer.jsonl";

let providerInstance: DabbleProvider | null = null;

export function activateDabble(context: vscode.ExtensionContext): vscode.Disposable {
  providerInstance = new DabbleProvider(context);
  return providerInstance.activate();
}

export function deactivateDabble(): void {
  providerInstance = null;
}

interface PanelControllerState {
  mode: ViewMode;
  source: SourceDescriptor;
  previewLimit: number;
}

interface PanelController {
  state: PanelControllerState;
  activeQuery: QuerySession | null;
  lastPayload: SourcePayload | null;
  columnMetricRunId: number;
  columnMetricsByTable: Map<string, Map<string, ExactColumnMetric>>;
}

class DabbleProvider implements vscode.CustomReadonlyEditorProvider<DabbleDocument> {
  private readonly duckdb = new DuckDBService();
  private readonly promptedLargeJsonlUris = new Set<string>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  activate(): vscode.Disposable {
    const registrations: vscode.Disposable[] = [];

    registrations.push(
      vscode.window.registerCustomEditorProvider(VIEW_TYPE, this, {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false
      })
    );
    registrations.push(
      vscode.window.registerCustomEditorProvider(JSONL_VIEW_TYPE, this, {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false
      })
    );

    registrations.push(vscode.commands.registerCommand("dabble.openSource", () => this.openSourcePanel()));
    registrations.push(
      vscode.commands.registerCommand("dabble.openAsParquetDataset", (resource?: vscode.Uri) => this.openDatasetPanel(resource))
    );
    registrations.push(
      vscode.commands.registerCommand("dabble.openWithDabble", async (resource?: vscode.Uri) => {
        const target = resource ?? vscode.window.activeTextEditor?.document.uri;
        if (!target) {
          void vscode.window.showInformationMessage("Select a Parquet, JSONL, DuckDB, or SQLite file to open with Dabble.");
          return;
        }
        await vscode.commands.executeCommand("vscode.openWith", target, viewTypeForResource(target));
      })
    );
    registrations.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        void this.maybeOfferLargeJsonlPrompt(editor?.document.uri);
      })
    );
    registrations.push(
      vscode.workspace.onDidOpenTextDocument((document) => {
        if (vscode.window.activeTextEditor?.document.uri.toString() !== document.uri.toString()) {
          return;
        }
        void this.maybeOfferLargeJsonlPrompt(document.uri);
      })
    );

    return vscode.Disposable.from(...registrations);
  }

  async openCustomDocument(uri: vscode.Uri): Promise<DabbleDocument> {
    return new DabbleDocument(uri);
  }

  async resolveCustomEditor(document: DabbleDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
    const initialSource: SourceDescriptor = {
      kind: inferKindFromPath(document.uri.fsPath),
      path: document.uri.fsPath,
      selectedTable: null,
      selectedColumn: null,
      s3Profile: null,
      s3Format: null
    };

    await this.mountPanel(webviewPanel, {
      mode: "clicked",
      source: initialSource,
      previewLimit: getPreviewLimit()
    });
  }

  async openSourcePanel(): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
      "dabble.openSource",
      "Dabble: Open Source",
      vscode.ViewColumn.Active,
      getWebviewOptions(this.context)
    );

    await this.mountPanel(panel, {
      mode: "connect",
      source: {
        kind: "s3",
        path: "s3://acme-lake/orders/year=2026/month=04/",
        selectedTable: null,
        selectedColumn: null,
        s3Profile: null,
        s3Format: DEFAULT_S3_SOURCE_FORMAT
      },
      previewLimit: getPreviewLimit()
    });
  }

  async openDatasetPanel(resource?: vscode.Uri): Promise<void> {
    const target = resource ?? (await pickFolderUri());
    if (!target) {
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "dabble.dataset",
      `Dabble: ${path.basename(target.fsPath)}`,
      vscode.ViewColumn.Active,
      getWebviewOptions(this.context)
    );

    await this.mountPanel(panel, {
      mode: "clicked",
      source: {
        kind: "dataset",
        path: target.fsPath,
        selectedTable: null,
        selectedColumn: null,
        s3Profile: null,
        s3Format: null
      },
      previewLimit: getPreviewLimit()
    });
  }

  private async mountPanel(panel: vscode.WebviewPanel, state: PanelControllerState): Promise<void> {
    panel.webview.options = getWebviewOptions(this.context);

    const controller: PanelController = {
      state,
      activeQuery: null,
      lastPayload: null,
      columnMetricRunId: 0,
      columnMetricsByTable: new Map()
    };

    const messageDisposable = panel.webview.onDidReceiveMessage(async (rawMessage: unknown) => {
      const message = parseWebviewMessage(rawMessage);
      if (!message) {
        return;
      }

      try {
        await this.handleMessage(panel, controller, message);
      } catch (error) {
        await this.postMessage(panel, {
          type: "error",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    });

    panel.onDidDispose(() => {
      messageDisposable.dispose();
      void this.disposeQuerySession(controller);
    });
    panel.webview.html = renderWebviewShell(this.context, panel.webview);
  }

  private async handleMessage(
    panel: vscode.WebviewPanel,
    controller: PanelController,
    message: ReturnType<typeof parseWebviewMessage> extends infer Parsed
      ? Exclude<Parsed, null>
      : never
  ): Promise<void> {
    switch (message.type) {
      case "ready":
        if (controller.state.mode === "connect") {
          await this.showConnectPanel(panel, controller);
          return;
        }
        await this.refreshPanel(panel, controller);
        return;
      case "runQuery":
        await this.disposeQuerySession(controller);
        await this.postMessage(panel, { type: "loading", loading: true });
        try {
          controller.activeQuery = await this.duckdb.startQuery(controller.state.source, message.sql, controller.state.source);
          await this.postMessage(panel, {
            type: "queryResult",
            query: await controller.activeQuery.readNextPage(),
            append: false
          });
          if (controller.activeQuery?.complete) {
            await this.disposeQuerySession(controller);
          }
        } catch (error) {
          await this.disposeQuerySession(controller);
          throw error;
        }
        await this.postMessage(panel, { type: "loading", loading: false });
        return;
      case "loadMoreQueryRows":
        if (!controller.activeQuery) {
          throw new Error("Run a query before loading more rows.");
        }
        await this.postMessage(panel, { type: "loading", loading: true });
        try {
          await this.postMessage(panel, {
            type: "queryResult",
            query: await controller.activeQuery.readNextPage(),
            append: true
          });
          if (controller.activeQuery?.complete) {
            await this.disposeQuerySession(controller);
          }
        } catch (error) {
          await this.disposeQuerySession(controller);
          throw error;
        }
        await this.postMessage(panel, { type: "loading", loading: false });
        return;
      case "loadAllQueryRows":
        if (!controller.activeQuery) {
          throw new Error("Run a query before loading all rows.");
        }
        await this.postMessage(panel, { type: "loading", loading: true });
        try {
          await this.postMessage(panel, {
            type: "queryResult",
            query: await controller.activeQuery.readAllRemaining(),
            append: true
          });
          await this.disposeQuerySession(controller);
        } catch (error) {
          await this.disposeQuerySession(controller);
          throw error;
        }
        await this.postMessage(panel, { type: "loading", loading: false });
        return;
      case "selectColumn":
        controller.state.source = {
          ...controller.state.source,
          selectedColumn: message.columnName
        };
        await this.refreshColumnSelection(panel, controller);
        return;
      case "selectTable":
        controller.state.source = {
          ...controller.state.source,
          selectedTable: message.tableName,
          selectedColumn: null
        };
        await this.refreshPanel(panel, controller);
        return;
      case "switchMode":
        controller.state.mode = message.mode;
        await this.refreshPanel(panel, controller);
        return;
      case "browseLocal": {
        const uri = await browseForLocalSource(message.kind);
        if (uri) {
          await this.postMessage(panel, {
            type: "localBrowseResult",
            path: uri.fsPath
          });
        }
        return;
      }
      case "openSource":
        controller.state.source = normalizeIncomingSource(message.source);
        controller.state.mode = "clicked";
        await this.refreshPanel(panel, controller);
        return;
      default:
        return;
    }
  }

  private async showConnectPanel(panel: vscode.WebviewPanel, controller: PanelController): Promise<void> {
    await this.disposeQuerySession(controller);
    controller.columnMetricRunId += 1;
    const payload = createEmptyPayload();
    controller.lastPayload = payload;
    await this.postMessage(panel, {
      type: "sourceData",
      mode: controller.state.mode,
      previewLimit: controller.state.previewLimit,
      source: controller.state.source,
      payload
    });
    await this.postMessage(panel, { type: "loading", loading: false });
  }

  private async refreshPanel(panel: vscode.WebviewPanel, controller: PanelController): Promise<void> {
    const runId = controller.columnMetricRunId + 1;
    controller.columnMetricRunId = runId;
    await this.disposeQuerySession(controller);
    await this.postMessage(panel, { type: "loading", loading: true });
    const result = await this.duckdb.loadSource(controller.state.source, {
      previewLimit: controller.state.previewLimit
    });
    controller.state.source = result.source;
    const tableKey = sourceTableKey(result.source);
    const cachedMetrics = controller.columnMetricsByTable.get(tableKey);
    const payload = cachedMetrics?.size
      ? applyCachedColumnMetrics(this.duckdb, result.payload, cachedMetrics)
      : result.payload;
    controller.lastPayload = payload;
    panel.title = `Dabble: ${path.basename(result.source.path || "Source")}`;
    await this.postMessage(panel, {
      type: "sourceData",
      mode: controller.state.mode,
      previewLimit: controller.state.previewLimit,
      source: result.source,
      payload
    });
    await this.postMessage(panel, { type: "loading", loading: false });

    const needsMetricsHydration =
      controller.state.mode === "clicked" &&
      payload.columns.length > 0 &&
      (cachedMetrics?.size ?? 0) < payload.columns.length;

    if (needsMetricsHydration) {
      this.hydrateColumnMetrics(panel, controller, result.source, payload.columns, tableKey, runId);
    }
  }

  private async refreshColumnSelection(panel: vscode.WebviewPanel, controller: PanelController): Promise<void> {
    if (!controller.lastPayload) {
      await this.refreshPanel(panel, controller);
      return;
    }

    const tableKey = sourceTableKey(controller.state.source);
    const metricByColumn = controller.columnMetricsByTable.get(tableKey);
    const selectedMetric = controller.state.source.selectedColumn
      ? metricByColumn?.get(controller.state.source.selectedColumn) ?? null
      : null;
    const result = await this.duckdb.loadSelectedColumnExplorer(controller.state.source, selectedMetric);
    controller.state.source = result.source;
    controller.lastPayload = {
      ...controller.lastPayload,
      explorer: result.explorer
    };
    await this.postMessage(panel, {
      type: "columnData",
      source: result.source,
      columns: controller.lastPayload.columns,
      explorer: result.explorer
    });
  }

  private hydrateColumnMetrics(
    panel: vscode.WebviewPanel,
    controller: PanelController,
    source: SourceDescriptor,
    columns: SourcePayload["columns"],
    tableKey: string,
    runId: number
  ): void {
    const tableMetrics = controller.columnMetricsByTable.get(tableKey) ?? new Map<string, ExactColumnMetric>();
    controller.columnMetricsByTable.set(tableKey, tableMetrics);

    for (const column of columns) {
      if (tableMetrics.has(column.name)) {
        continue;
      }
      void this.loadAndPublishColumnMetric(panel, controller, source, tableKey, runId, column.name);
    }
  }

  private async loadAndPublishColumnMetric(
    panel: vscode.WebviewPanel,
    controller: PanelController,
    source: SourceDescriptor,
    tableKey: string,
    runId: number,
    columnName: string
  ): Promise<void> {
    let metric: ExactColumnMetric;
    try {
      metric = await this.duckdb.loadColumnMetric(source, columnName);
    } catch {
      return;
    }

    if (controller.columnMetricRunId !== runId) {
      return;
    }
    if (sourceTableKey(controller.state.source) !== tableKey) {
      return;
    }
    if (!controller.lastPayload) {
      return;
    }

    const tableMetrics = controller.columnMetricsByTable.get(tableKey) ?? new Map<string, ExactColumnMetric>();
    tableMetrics.set(columnName, metric);
    controller.columnMetricsByTable.set(tableKey, tableMetrics);

    const nextColumns = this.duckdb.applyColumnMetric(controller.lastPayload.columns, columnName, metric);
    controller.lastPayload = {
      ...controller.lastPayload,
      columns: nextColumns
    };

    await this.postMessage(panel, {
      type: "columnMetricsData",
      source: controller.state.source,
      columns: nextColumns
    });
  }

  private async postMessage(panel: vscode.WebviewPanel, message: ExtensionToWebviewMessage): Promise<void> {
    await panel.webview.postMessage(message);
  }

  private async disposeQuerySession(controller: PanelController): Promise<void> {
    if (!controller.activeQuery) {
      return;
    }
    await controller.activeQuery.dispose();
    controller.activeQuery = null;
  }

  private async maybeOfferLargeJsonlPrompt(uri: vscode.Uri | undefined): Promise<void> {
    if (!uri || !isJsonlUri(uri) || uri.scheme !== "file") {
      return;
    }
    const key = uri.toString();
    if (this.promptedLargeJsonlUris.has(key)) {
      return;
    }

    const thresholdMb = getLargeFileThresholdMb();
    if (thresholdMb <= 0) {
      return;
    }

    let stats: vscode.FileStat;
    try {
      stats = await vscode.workspace.fs.stat(uri);
    } catch {
      return;
    }

    const thresholdBytes = thresholdMb * 1024 * 1024;
    if (stats.size < thresholdBytes) {
      return;
    }

    this.promptedLargeJsonlUris.add(key);
    const openAction = "Open in Dabble";
    const selectedAction = await vscode.window.showInformationMessage(
      `Large JSONL file detected (${formatMegabytes(stats.size)} MB). Open it in Dabble?`,
      openAction
    );
    if (selectedAction === openAction) {
      await vscode.commands.executeCommand("vscode.openWith", uri, JSONL_VIEW_TYPE);
    }
  }
}

class DabbleDocument implements vscode.CustomDocument {
  constructor(readonly uri: vscode.Uri) {}

  dispose(): void {}
}

async function browseForLocalSource(kind: SourceDescriptor["kind"]): Promise<vscode.Uri | undefined> {
  const isDataset = kind === "dataset";
  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: !isDataset,
    canSelectFolders: isDataset,
    canSelectMany: false,
    openLabel: "Choose source"
  });
  return selected?.[0];
}

async function pickFolderUri(): Promise<vscode.Uri | undefined> {
  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Choose Parquet dataset folder"
  });
  return selected?.[0];
}

function getPreviewLimit(): number {
  return normalizePreviewLimit(vscode.workspace.getConfiguration("dabble").get("previewLimit", DEFAULT_PREVIEW_LIMIT));
}

function getLargeFileThresholdMb(): number {
  const configured = vscode.workspace.getConfiguration("workbench").get("editorLargeFileConfirmation", 50);
  const numeric = Number(configured);
  if (!Number.isFinite(numeric)) {
    return 50;
  }
  return Math.max(0, numeric);
}

function isJsonlUri(uri: vscode.Uri): boolean {
  const ext = path.extname(uri.fsPath).toLowerCase();
  return ext === ".jsonl" || ext === ".ndjson";
}

function viewTypeForResource(resource: vscode.Uri): string {
  return isJsonlUri(resource) ? JSONL_VIEW_TYPE : VIEW_TYPE;
}

function formatMegabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2);
}

function sourceTableKey(source: SourceDescriptor): string {
  return [source.kind, source.path, source.selectedTable ?? "", source.s3Profile ?? "", source.s3Format ?? ""].join("::");
}

function applyCachedColumnMetrics(
  duckdb: DuckDBService,
  payload: SourcePayload,
  metricByColumn: Map<string, ExactColumnMetric>
): SourcePayload {
  let columns = payload.columns;
  for (const [columnName, metric] of metricByColumn) {
    columns = duckdb.applyColumnMetric(columns, columnName, metric);
  }
  return {
    ...payload,
    columns
  };
}
