import type { ExtensionToWebviewMessage, MainTab, ViewMode, WebviewToExtensionMessage } from "../shared/protocol.js";
import { renderApp } from "./render.js";
import {
  applyExtensionMessage,
  clampNumber,
  closeCellViewer,
  createInitialState,
  isLocalSourceKind,
  openCellViewer,
  setCellViewerPretty,
  setCellViewerPrettyError,
  setCellViewerRaw,
  setClosingColumn,
  setExpandedColumn,
  setOpeningColumn,
  setMode,
  setQuerySql,
  setTab,
  updateFormField,
  updateUiState,
  type AppState,
  type CellViewerTable
} from "./state.js";

const MAX_PRETTY_JSON_CHARS = 1_000_000;

interface VsCodeApi<State> {
  postMessage(message: WebviewToExtensionMessage): void;
  getState(): State | undefined;
  setState(newState: State): void;
}

export function bootDabble(): void {
  const root = document.getElementById("app");
  if (!root) {
    throw new Error("Dabble root element was not found.");
  }

  const vscode = acquireVsCodeApi<{ sidebarWidth?: number; explorerHeight?: number }>();
  new DabbleApp(root, vscode);
}

class DabbleApp {
  private state: AppState;
  private columnAnimationTimer: number | null = null;
  private columnAnimationTarget: string | null = null;
  private readonly platformShortcut: "mac" | "default";

  constructor(
    private readonly root: HTMLElement,
    private readonly vscode: VsCodeApi<{ sidebarWidth?: number; explorerHeight?: number }>
  ) {
    this.state = createInitialState(vscode.getState() ?? {});
    this.platformShortcut = detectShortcutPlatform();

    window.addEventListener("message", (event: MessageEvent<ExtensionToWebviewMessage>) => {
      this.state = applyExtensionMessage(this.state, event.data);
      this.render();
    });

    this.root.addEventListener("click", (event) => this.handleClick(event));
    this.root.addEventListener("input", (event) => this.handleInput(event));
    this.root.addEventListener("change", (event) => this.handleInput(event));
    this.root.addEventListener("keydown", (event) => this.handleKeyDown(event));
    this.root.addEventListener("pointerdown", (event) => this.handlePointerDown(event));
    window.addEventListener("keydown", (event) => this.handleGlobalKeyDown(event));

    this.render();
    this.postMessage({ type: "ready" });
  }

  private handleClick(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    const backdrop = target.closest<HTMLElement>("[data-cell-viewer-backdrop]");
    if (backdrop && target === backdrop) {
      this.state = closeCellViewer(this.state);
      this.render();
      return;
    }

    const screenButton = target.closest<HTMLElement>("[data-screen]");
    if (screenButton) {
      const mode = screenButton.dataset.screen;
      if (isViewMode(mode)) {
        this.state = setMode(this.state, mode);
        this.render();
        this.postMessage({ type: "switchMode", mode });
      }
      return;
    }

    const tabButton = target.closest<HTMLElement>("[data-tab]");
    if (tabButton) {
      const tab = tabButton.dataset.tab;
      if (isMainTab(tab)) {
        this.state = setTab(this.state, tab);
        this.render();
      }
      return;
    }

    const columnButton = target.closest<HTMLElement>("[data-column-name]");
    if (columnButton?.dataset.columnName) {
      const columnName = columnButton.dataset.columnName;
      if (this.state.expandedColumnName === columnName) {
        this.animateColumnClose(columnName);
        return;
      }

      this.postMessage({
        type: "selectColumn",
        columnName
      });
      return;
    }

    const tableButton = target.closest<HTMLElement>("[data-table-name]");
    if (tableButton?.dataset.tableName) {
      this.postMessage({
        type: "selectTable",
        tableName: tableButton.dataset.tableName
      });
      return;
    }

    const cellButton = target.closest<HTMLElement>("[data-cell-table][data-cell-row][data-cell-col]");
    if (cellButton) {
      const cellTable = cellButton.dataset.cellTable;
      const rowIndex = Number(cellButton.dataset.cellRow);
      const columnIndex = Number(cellButton.dataset.cellCol);
      if ((cellTable === "preview" || cellTable === "query") && Number.isInteger(rowIndex) && Number.isInteger(columnIndex)) {
        this.openCellViewerFromTable(cellTable, rowIndex, columnIndex);
      }
      return;
    }

    const actionButton = target.closest<HTMLElement>("[data-action]");
    if (!actionButton) {
      return;
    }

    const action = actionButton.dataset.action;
    switch (action) {
      case "preview":
        this.state = setTab(this.state, "preview");
        this.render();
        return;
      case "run-query":
        this.postMessage({
          type: "runQuery",
          sql: this.state.querySql
        });
        this.focusQueryEditor();
        return;
      case "load-more-query-rows":
        this.postMessage({ type: "loadMoreQueryRows" });
        return;
      case "load-all-query-rows":
        this.postMessage({ type: "loadAllQueryRows" });
        return;
      case "browse-local":
        this.postMessage({
          type: "browseLocal",
          kind: this.state.form.localType
        });
        return;
      case "open-local":
        this.postMessage({
          type: "openSource",
          source: {
            localType: this.state.form.localType,
            path: this.state.form.localPath
          }
        });
        return;
      case "open-s3":
        this.postMessage({
          type: "openSource",
          source: {
            path: this.state.form.s3Path,
            s3Profile: this.state.form.s3Profile
          }
        });
        return;
      case "close-cell-viewer":
        this.state = closeCellViewer(this.state);
        this.render();
        return;
      case "cell-viewer-raw":
        this.state = setCellViewerRaw(this.state);
        this.render();
        return;
      case "cell-viewer-pretty":
        this.showPrettyJsonIfPossible();
        return;
      default:
        return;
    }
  }

  private handleInput(event: Event): void {
    const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
    if (!target?.id) {
      return;
    }

    switch (target.id) {
      case "query-editor":
        this.state = setQuerySql(this.state, target.value);
        return;
      case "local-path":
        this.state = updateFormField(this.state, "localPath", target.value);
        return;
      case "s3-path":
        this.state = updateFormField(this.state, "s3Path", target.value);
        return;
      case "s3-profile":
        this.state = updateFormField(this.state, "s3Profile", target.value);
        return;
      case "local-type":
        if (isLocalSourceKind(target.value)) {
          this.state = updateFormField(this.state, "localType", target.value);
        }
        return;
      default:
        return;
    }
  }

  private handleKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLTextAreaElement | null;
    if (!target || target.id !== "query-editor") {
      return;
    }

    const enterPressed = event.key === "Enter";
    const runShortcutPressed = event.metaKey || event.ctrlKey;
    if (!enterPressed || !runShortcutPressed) {
      return;
    }

    event.preventDefault();
    this.postMessage({
      type: "runQuery",
      sql: this.state.querySql
    });
  }

  private handleGlobalKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
      return;
    }
    if (this.state.cellViewer.isOpen) {
      this.state = closeCellViewer(this.state);
      this.render();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (this.state.mode !== "clicked" || this.state.tab !== "query") {
      return;
    }
    const active = document.activeElement as HTMLElement | null;
    if (active?.id === "query-editor") {
      return;
    }
    const focused = this.focusQueryEditor();
    if (focused) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  private handlePointerDown(event: PointerEvent): void {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-resize]");
    if (!target) {
      return;
    }

    event.preventDefault();
    const resizeTarget = target.dataset.resize;
    if (resizeTarget !== "sidebar" && resizeTarget !== "explorer") {
      return;
    }

    const startX = event.clientX;
    const startY = event.clientY;
    const startSidebarWidth = this.state.ui.sidebarWidth;
    const startExplorerHeight = this.state.ui.explorerHeight;

    target.setPointerCapture?.(event.pointerId);
    document.body.classList.add("resizing", `resizing-${resizeTarget}`);

    const onMove = (moveEvent: PointerEvent) => {
      if (resizeTarget === "sidebar") {
        this.state = updateUiState(this.state, {
          sidebarWidth: clampNumber(startSidebarWidth + (moveEvent.clientX - startX), 268, 520, startSidebarWidth)
        });
      }
      if (resizeTarget === "explorer") {
        this.state = updateUiState(this.state, {
          explorerHeight: clampNumber(startExplorerHeight - (moveEvent.clientY - startY), 180, 520, startExplorerHeight)
        });
      }

      this.persistUiState();
      this.applyUiVariables();
    };

    const onUp = () => {
      document.body.classList.remove("resizing", `resizing-${resizeTarget}`);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  private render(): void {
    const focusSnapshot = this.captureQueryEditorFocus();
    this.root.innerHTML = renderApp(this.state);
    this.applyPlatformAttributes();
    this.restoreQueryEditorFocus(focusSnapshot);
    const activeAnimation = this.state.closingColumnName || this.state.openingColumnName;
    if (activeAnimation) {
      if (this.columnAnimationTimer == null || this.columnAnimationTarget !== activeAnimation) {
        this.scheduleColumnAnimationClear(activeAnimation);
      }
      return;
    }

    if (this.columnAnimationTimer != null) {
      window.clearTimeout(this.columnAnimationTimer);
      this.columnAnimationTimer = null;
      this.columnAnimationTarget = null;
    }
  }

  private applyUiVariables(): void {
    const app = this.root.querySelector<HTMLElement>(".app");
    if (!app) {
      return;
    }
    app.style.setProperty("--sidebar-width", `${this.state.ui.sidebarWidth}px`);
    app.style.setProperty("--explorer-height", `${this.state.ui.explorerHeight}px`);
  }

  private applyPlatformAttributes(): void {
    const app = this.root.querySelector<HTMLElement>(".app");
    if (!app) {
      return;
    }
    app.dataset.platform = this.platformShortcut;
  }

  private persistUiState(): void {
    this.vscode.setState({
      sidebarWidth: this.state.ui.sidebarWidth,
      explorerHeight: this.state.ui.explorerHeight
    });
  }

  private postMessage(message: WebviewToExtensionMessage): void {
    this.vscode.postMessage(message);
  }

  private openCellViewerFromTable(table: CellViewerTable, rowIndex: number, columnIndex: number): void {
    const rows = table === "preview" ? this.state.payload.previewRows : this.state.queryResult.rows;
    const headers = table === "preview" ? this.state.payload.previewHeaders : this.state.queryResult.headers;
    const row = rows[rowIndex];
    const value = row?.[columnIndex];
    if (!row || typeof value !== "string") {
      return;
    }
    const columnName = headers[columnIndex] || `Column ${columnIndex + 1}`;
    this.state = openCellViewer(this.state, {
      table,
      columnName,
      rowNumber: rowIndex + 1,
      value,
      canPrettyJson: isLikelyJsonText(value)
    });
    this.render();
  }

  private showPrettyJsonIfPossible(): void {
    if (!this.state.cellViewer.isOpen || !this.state.cellViewer.canPrettyJson) {
      return;
    }
    if (this.state.cellViewer.prettyValue) {
      this.state = setCellViewerPretty(this.state, this.state.cellViewer.prettyValue);
      this.render();
      return;
    }

    const rawValue = this.state.cellViewer.value;
    if (rawValue.length > MAX_PRETTY_JSON_CHARS) {
      this.state = setCellViewerPrettyError(
        this.state,
        "Pretty formatting is disabled for very large values. Use raw view."
      );
      this.render();
      return;
    }

    const prettyValue = tryFormatJson(rawValue);
    if (!prettyValue) {
      this.state = setCellViewerPrettyError(this.state, "Could not parse this value as JSON.");
      this.render();
      return;
    }

    this.state = setCellViewerPretty(this.state, prettyValue);
    this.render();
  }

  private focusQueryEditor(): boolean {
    if (this.state.mode !== "clicked" || this.state.tab !== "query") {
      return false;
    }
    const editor = this.root.querySelector<HTMLTextAreaElement>("#query-editor");
    if (!editor) {
      return false;
    }
    editor.focus({ preventScroll: true });
    return true;
  }

  private captureQueryEditorFocus(): QueryEditorFocusSnapshot | null {
    const editor = this.root.querySelector<HTMLTextAreaElement>("#query-editor");
    if (!editor || document.activeElement !== editor) {
      return null;
    }
    return {
      selectionStart: editor.selectionStart,
      selectionEnd: editor.selectionEnd,
      scrollTop: editor.scrollTop
    };
  }

  private restoreQueryEditorFocus(snapshot: QueryEditorFocusSnapshot | null): void {
    if (!snapshot) {
      return;
    }
    const editor = this.root.querySelector<HTMLTextAreaElement>("#query-editor");
    if (!editor) {
      return;
    }
    editor.focus({ preventScroll: true });
    editor.selectionStart = snapshot.selectionStart;
    editor.selectionEnd = snapshot.selectionEnd;
    editor.scrollTop = snapshot.scrollTop;
  }

  private animateColumnClose(columnName: string): void {
    if (this.columnAnimationTimer != null) {
      window.clearTimeout(this.columnAnimationTimer);
      this.columnAnimationTimer = null;
      this.columnAnimationTarget = null;
    }
    this.state = setClosingColumn(this.state, columnName);
    this.render();
  }

  private scheduleColumnAnimationClear(columnName: string): void {
    if (this.columnAnimationTimer != null) {
      window.clearTimeout(this.columnAnimationTimer);
    }

    this.columnAnimationTarget = columnName;
    this.columnAnimationTimer = window.setTimeout(() => {
      this.columnAnimationTimer = null;
      this.columnAnimationTarget = null;
      if (this.state.closingColumnName === columnName) {
        this.state = setExpandedColumn(this.state, null);
        this.render();
        return;
      }

      if (this.state.openingColumnName === columnName) {
        this.state = setOpeningColumn(this.state, null);
        this.render();
      }
    }, 160);
  }
}

function isViewMode(value: unknown): value is ViewMode {
  return value === "clicked" || value === "connect";
}

function isMainTab(value: unknown): value is MainTab {
  return value === "preview" || value === "query";
}

function detectShortcutPlatform(): "mac" | "default" {
  const userAgentDataPlatform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform;
  const source = `${userAgentDataPlatform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`.toLowerCase();
  return /mac|iphone|ipad|ipod/.test(source) ? "mac" : "default";
}

function isLikelyJsonText(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return false;
  }
  return (trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"));
}

function tryFormatJson(value: string): string | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
}

interface QueryEditorFocusSnapshot {
  selectionStart: number;
  selectionEnd: number;
  scrollTop: number;
}
