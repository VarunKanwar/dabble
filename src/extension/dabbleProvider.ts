import path from "path";
import * as vscode from "vscode";
import { createEmptyPayload, type ExtensionToWebviewMessage, type SourceDescriptor, type ViewMode } from "../shared/protocol";
import { DuckDBService, QuerySession } from "./duckdbService";
import { DEFAULT_PREVIEW_LIMIT, inferKindFromPath, normalizeIncomingSource, normalizePreviewLimit } from "./sourceUtils";
import { getWebviewOptions, renderWebviewShell } from "./webviewHtml";
import { parseWebviewMessage } from "./webviewMessage";

const VIEW_TYPE = "dabble.viewer";

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
}

class DabbleProvider implements vscode.CustomReadonlyEditorProvider<DabbleDocument> {
  private readonly duckdb = new DuckDBService();

  constructor(private readonly context: vscode.ExtensionContext) {}

  activate(): vscode.Disposable {
    const registrations: vscode.Disposable[] = [];

    registrations.push(
      vscode.window.registerCustomEditorProvider(VIEW_TYPE, this, {
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
          void vscode.window.showInformationMessage("Select a Parquet, DuckDB, or SQLite file to open with Dabble.");
          return;
        }
        await vscode.commands.executeCommand("vscode.openWith", target, VIEW_TYPE);
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
      s3Profile: null
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
        s3Profile: null
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
        s3Profile: null
      },
      previewLimit: getPreviewLimit()
    });
  }

  private async mountPanel(panel: vscode.WebviewPanel, state: PanelControllerState): Promise<void> {
    panel.webview.options = getWebviewOptions(this.context);

    const controller: PanelController = { state, activeQuery: null };

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
        await this.refreshPanel(panel, controller);
        return;
      case "selectTable":
        controller.state.source = {
          ...controller.state.source,
          selectedTable: message.tableName
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
    await this.postMessage(panel, {
      type: "sourceData",
      mode: controller.state.mode,
      previewLimit: controller.state.previewLimit,
      source: controller.state.source,
      payload: createEmptyPayload()
    });
    await this.postMessage(panel, { type: "loading", loading: false });
  }

  private async refreshPanel(panel: vscode.WebviewPanel, controller: PanelController): Promise<void> {
    await this.disposeQuerySession(controller);
    await this.postMessage(panel, { type: "loading", loading: true });
    const result = await this.duckdb.loadSource(controller.state.source, {
      previewLimit: controller.state.previewLimit
    });
    controller.state.source = result.source;
    panel.title = `Dabble: ${path.basename(result.source.path || "Source")}`;
    await this.postMessage(panel, {
      type: "sourceData",
      mode: controller.state.mode,
      previewLimit: controller.state.previewLimit,
      source: result.source,
      payload: result.payload
    });
    await this.postMessage(panel, { type: "loading", loading: false });
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
