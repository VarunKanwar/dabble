import type { AppState } from "./state.js";
import { escapeAttr, escapeHtml, formatDisplayNumber, formatPercent, lastSegment, numericValue, resultMeta, typeGlyph } from "./format.js";

export function renderApp(state: AppState): string {
  const payload = state.payload;
  const queryResult = state.queryResult;

  return `
    <div
      class="app ${state.mode === "connect" ? "mode-connect" : ""} ${state.loading ? "loading" : ""}"
      style="--sidebar-width:${state.ui.sidebarWidth}px; --explorer-height:${state.ui.explorerHeight}px;"
    >
      <div class="topbar">
        <div class="topbar-title">DuckView</div>
        <div class="topbar-path">${escapeHtml(payload.path || "")}</div>
      </div>

      <div class="layout">
        <aside class="sidebar">
          <div class="sidebar-search">
            <div class="search-shell">
              <span class="search-icon">⌕</span>
              <span class="search-placeholder">Search</span>
            </div>
          </div>

          <div class="mode-toggle">
            <button class="${state.mode === "clicked" ? "active" : ""}" data-screen="clicked">Clicked File</button>
            <button class="${state.mode === "connect" ? "active" : ""}" data-screen="connect">Open Source</button>
          </div>

          <div class="sidebar-stack">
            <div class="sidebar-sections">
              <section class="nav-section">
                <div class="section-title">
                  <span>Attached databases</span>
                  <span class="section-plus">+</span>
                </div>
                <div class="tree-root">
                  <div class="tree-row">
                    <span class="tree-caret">▾</span>
                    <span class="tree-node">${escapeHtml(payload.tree[0] || "")}</span>
                  </div>
                  <div class="tree-branch">
                    <div class="tree-row tree-row-schema">
                      <span class="tree-caret">▾</span>
                      <span class="tree-node">${escapeHtml(payload.tree[1] || "")}</span>
                    </div>
                    <div class="tree-table-list">${renderCatalogTables(state)}</div>
                  </div>
                </div>
              </section>
            </div>

            ${state.mode === "clicked" ? '<div class="pane-resizer horizontal" data-resize="explorer" aria-hidden="true"></div>' : ""}
            ${state.mode === "clicked" ? renderObjectExplorer(state) : ""}
          </div>
        </aside>
        <div class="pane-resizer vertical" data-resize="sidebar" aria-hidden="true"></div>

        <main class="main">
          ${state.mode === "clicked" ? renderClickedMode(state) : renderConnectMode(state)}
          ${state.error ? `<div class="status-banner">${escapeHtml(state.error)}</div>` : ""}
        </main>
      </div>
    </div>
  `;
}

function renderClickedMode(state: AppState): string {
  const payload = state.payload;
  const queryResult = state.queryResult;

  return `
    <div class="main-tabs">
      <button class="${state.tab === "preview" ? "active" : ""}" data-tab="preview">Preview</button>
      <button class="${state.tab === "query" ? "active" : ""}" data-tab="query">Query</button>
    </div>

    <section class="main-content">
      <div class="pane ${state.tab === "preview" ? "active" : ""}">
        <div class="surface">
          <div class="surface-head">
            <div>
              <div class="surface-title">${escapeHtml(payload.title || "")}</div>
              <div class="surface-meta">
                <span>${escapeHtml(payload.rowCountLabel ? `${payload.rowCountLabel} rows` : "")}</span>
                <span>${escapeHtml(payload.limit || "")}</span>
              </div>
            </div>
          </div>
          <div class="table-wrap">${renderTable(payload.previewHeaders || [], payload.previewRows || [])}</div>
        </div>
      </div>

      <div class="pane ${state.tab === "query" ? "active" : ""}">
        <div class="query-workspace">
          <div class="workspace-header">
            <div>
              <div class="surface-title">Query</div>
              <div class="surface-meta"><span>Ad hoc readonly SQL</span></div>
            </div>
            <button class="toolbar-button" data-action="focus-query">Focus Editor</button>
          </div>

          <div class="surface query-cell">
            <div class="surface-head">
              <div>
                <div class="surface-title">SQL</div>
                <div class="surface-meta"><span>Readonly SQL</span></div>
              </div>
              <button class="toolbar-button" data-action="run-query">Run</button>
            </div>
            <div class="editor-shell">
              <textarea id="query-editor" class="query-editor">${escapeHtml(state.querySql)}</textarea>
            </div>
          </div>

          <div class="surface">
            <div class="surface-head">
              <div>
                <div class="surface-title">Results</div>
                <div class="surface-meta">
                  <span>${escapeHtml(resultMeta(queryResult.loadedRowCount))}</span>
                  <span>${escapeHtml(queryResult.done ? "complete" : "more rows available")}</span>
                </div>
              </div>
              ${renderQueryResultActions(state)}
            </div>
            <div class="table-wrap">${renderTable(queryResult.headers || [], queryResult.rows || [])}</div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderQueryResultActions(state: AppState): string {
  if (state.queryResult.done || !state.queryResult.headers.length) {
    return "";
  }

  return `
    <div class="query-result-actions">
      <button class="toolbar-button" data-action="load-more-query-rows">Load More</button>
      <button class="toolbar-button" data-action="load-all-query-rows">Load All</button>
    </div>
  `;
}

function renderObjectExplorer(state: AppState): string {
  const { payload, source } = state;
  const columns = payload.columns || [];
  const selectedName = source?.selectedColumn;
  const maxDistinct = Math.max(...columns.map((column) => numericValue(column.approxDistinct)), 1);
  const explorer = payload.explorer;

  return `
    <section class="object-explorer">
      <div class="object-head">
        <div class="object-head-title">${escapeHtml(lastSegment(source?.selectedTable || payload.title || ""))}</div>
        <div class="object-head-meta">${escapeHtml(payload.rowCountLabel ? `${payload.rowCountLabel} rows` : "")}</div>
        <div class="object-head-actions">
          <button class="icon-button" data-action="preview">⌕</button>
          <button class="icon-button">⋯</button>
        </div>
      </div>

      <div class="column-list">
        ${columns
          .map((column) => {
            const selected = selectedName === column.name;
            const width = Math.max(10, Math.round((numericValue(column.approxDistinct) / maxDistinct) * 100));
            return `
              <button class="column-row ${selected ? "active" : ""}" data-column-name="${escapeAttr(column.name)}">
                <div class="column-type">${escapeHtml(typeGlyph(column.type))}</div>
                <div class="column-name">${escapeHtml(column.name)}</div>
                <div class="column-distinct">
                  <div class="distinct-track">
                    <div class="distinct-fill" style="width:${width}%"></div>
                    <span class="${column.distinctDisplay === "no data" ? "muted-italic" : ""}">${escapeHtml(column.distinctDisplay)}</span>
                  </div>
                </div>
                <div class="column-null">${escapeHtml(column.nullDisplay)}</div>
              </button>
            `;
          })
          .join("")}
      </div>

      <div class="distribution-panel">
        <div class="distribution-title">
          <span class="column-type selected">${escapeHtml(typeGlyph(explorer.type || ""))}</span>
          <strong>${escapeHtml(explorer.title || "")}</strong>
        </div>
        <div class="distribution-list">
          ${renderDistribution(state)}
        </div>
      </div>
    </section>
  `;
}

function renderDistribution(state: AppState): string {
  const rows = state.payload.explorer.distributionRows || [];
  if (!rows.length) {
    return '<div class="distribution-empty">No distribution data</div>';
  }

  return rows
    .map(
      (row) => `
        <div class="distribution-row">
          <div class="distribution-label-wrap">
            <div class="distribution-bar-wrap">
              <div class="distribution-bar" style="width:${Number(row.percent) || 0}%"></div>
            </div>
            <span class="distribution-label">${escapeHtml(row.label)}</span>
          </div>
          <div class="distribution-value">${escapeHtml(formatDisplayNumber(row.value))}</div>
          <div class="distribution-percent">${escapeHtml(formatPercent(row.percent))}</div>
        </div>
      `
    )
    .join("");
}

function renderConnectMode(state: AppState): string {
  return `
    <section class="connect-content">
      <div class="connect-grid">
        <div class="surface">
          <div class="surface-head">
            <div>
              <div class="surface-title">Open local source</div>
              <div class="surface-meta"><span>File or dataset folder</span></div>
            </div>
          </div>
          <div class="form">
            <div class="field">
              <label>Type</label>
              <select id="local-type">
                ${option("parquet", "Parquet file", state.form.localType)}
                ${option("duckdb", "DuckDB file", state.form.localType)}
                ${option("sqlite", "SQLite file", state.form.localType)}
                ${option("dataset", "Parquet dataset folder", state.form.localType)}
              </select>
            </div>
            <div class="field">
              <label>Path</label>
              <input id="local-path" value="${escapeAttr(state.form.localPath)}" />
            </div>
            <div class="actions">
              <span class="link" data-action="browse-local">Browse…</span>
              <button class="toolbar-button" data-action="open-local">Open Summary</button>
            </div>
          </div>
        </div>

        <div class="surface">
          <div class="surface-head">
            <div>
              <div class="surface-title">Open S3 source</div>
              <div class="surface-meta"><span>Same summary flow after connect</span></div>
            </div>
          </div>
          <div class="form">
            <div class="field">
              <label>S3 URI</label>
              <input id="s3-path" value="${escapeAttr(state.form.s3Path)}" />
            </div>
            <div class="field">
              <label>Credentials Profile</label>
              <input id="s3-profile" value="${escapeAttr(state.form.s3Profile)}" />
            </div>
            <div class="actions">
              <span class="link">DuckDB secret will use this profile</span>
              <button class="toolbar-button" data-action="open-s3">Open Summary</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderCatalogTables(state: AppState): string {
  const tables = state.payload.tables || [];
  if (!tables.length) {
    return "";
  }

  return tables
    .map(
      (tableName) => `
        <button class="tree-row tree-row-table ${state.source?.selectedTable === tableName ? "active" : ""}" data-table-name="${escapeAttr(tableName)}">
          <span class="tree-node">${escapeHtml(tableName)}</span>
        </button>
      `
    )
    .join("");
}

function renderTable(headers: string[], rows: string[][]): string {
  if (!headers.length) {
    return '<div class="empty-state">No rows returned.</div>';
  }

  return `
    <table>
      <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
      <tbody>
        ${rows
          .map((row) => `<tr>${row.map((cell) => `<td class="mono">${escapeHtml(cell)}</td>`).join("")}</tr>`)
          .join("")}
      </tbody>
    </table>
  `;
}

function option(value: string, label: string, selected: string): string {
  return `<option value="${escapeAttr(value)}" ${selected === value ? "selected" : ""}>${escapeHtml(label)}</option>`;
}
