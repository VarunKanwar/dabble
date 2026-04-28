import type { ExtensionToWebviewMessage, MainTab, ViewMode, WebviewToExtensionMessage } from "../shared/protocol.js";
import { renderApp } from "./render.js";
import {
  applyExtensionMessage,
  clampNumber,
  createInitialState,
  isLocalSourceKind,
  setMode,
  setQuerySql,
  setTab,
  updateFormField,
  updateUiState,
  type AppState
} from "./state.js";

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

  constructor(
    private readonly root: HTMLElement,
    private readonly vscode: VsCodeApi<{ sidebarWidth?: number; explorerHeight?: number }>
  ) {
    this.state = createInitialState(vscode.getState() ?? {});

    window.addEventListener("message", (event: MessageEvent<ExtensionToWebviewMessage>) => {
      this.state = applyExtensionMessage(this.state, event.data);
      this.render();
    });

    this.root.addEventListener("click", (event) => this.handleClick(event));
    this.root.addEventListener("input", (event) => this.handleInput(event));
    this.root.addEventListener("change", (event) => this.handleInput(event));
    this.root.addEventListener("pointerdown", (event) => this.handlePointerDown(event));

    this.render();
    this.postMessage({ type: "ready" });
  }

  private handleClick(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (!target) {
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
      this.postMessage({
        type: "selectColumn",
        columnName: columnButton.dataset.columnName
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
        return;
      case "load-more-query-rows":
        this.postMessage({ type: "loadMoreQueryRows" });
        return;
      case "load-all-query-rows":
        this.postMessage({ type: "loadAllQueryRows" });
        return;
      case "focus-query":
        this.state = setTab(this.state, "query");
        this.render();
        requestAnimationFrame(() => {
          this.root.querySelector<HTMLTextAreaElement>("#query-editor")?.focus();
        });
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
    this.root.innerHTML = renderApp(this.state);
  }

  private applyUiVariables(): void {
    const app = this.root.querySelector<HTMLElement>(".app");
    if (!app) {
      return;
    }
    app.style.setProperty("--sidebar-width", `${this.state.ui.sidebarWidth}px`);
    app.style.setProperty("--explorer-height", `${this.state.ui.explorerHeight}px`);
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
}

function isViewMode(value: unknown): value is ViewMode {
  return value === "clicked" || value === "connect";
}

function isMainTab(value: unknown): value is MainTab {
  return value === "preview" || value === "query";
}
