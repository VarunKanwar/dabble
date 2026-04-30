import type { AppState, CellViewerTable } from "./state.js";
import { escapeAttr, escapeHtml, formatDisplayNumber, formatPercent, lastSegment, resultMeta, typeGlyph } from "./format.js";

export function renderApp(state: AppState): string {
  const payload = state.payload;

  return `
    <div
      class="app ${state.mode === "connect" ? "mode-connect" : ""} ${state.loading ? "loading" : ""}"
      style="--sidebar-width:${state.ui.sidebarWidth}px; --explorer-height:${state.ui.explorerHeight}px;"
    >
      <div class="topbar">
        <div class="topbar-title">Dabble</div>
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
      ${renderCellViewer(state)}
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
          <div class="table-wrap">
            ${renderTable(
              payload.previewHeaders || [],
              payload.previewRows || [],
              "preview",
              buildPreviewColumnAlignments(state)
            )}
          </div>
        </div>
      </div>

      <div class="pane ${state.tab === "query" ? "active" : ""}">
        <div class="query-workspace">
          <div class="workspace-header">
            <div>
              <div class="surface-title">Query</div>
              <div class="surface-meta"><span>Ad hoc readonly SQL</span></div>
            </div>
          </div>

          <div class="surface query-cell">
            <div class="surface-head">
              <div>
                <div class="surface-title">SQL</div>
                <div class="surface-meta"><span>Readonly SQL</span></div>
              </div>
              <button class="toolbar-button shortcut-button" data-action="run-query" title="Run query">
                <span>Run</span>
                <span class="shortcut-label shortcut-hint-mac" aria-hidden="true">
                  (⌘<span class="shortcut-enter">↵</span>)
                </span>
                <span class="shortcut-label shortcut-hint-default" aria-hidden="true">
                  (Ctrl+<span class="shortcut-enter">↵</span>)
                </span>
              </button>
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
            <div class="table-wrap">
              ${renderTable(
                queryResult.headers || [],
                queryResult.rows || [],
                "query",
                buildQueryColumnAlignments(queryResult.headers || [], queryResult.rows || [])
              )}
            </div>
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
  const selectedName = source?.selectedColumn || null;
  const expandedName = state.expandedColumnName;
  const openingName = state.openingColumnName;
  const closingName = state.closingColumnName;
  const activeDetailName = closingName || openingName || expandedName;
  const showDetail = Boolean(activeDetailName && selectedName === activeDetailName);
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

      <div class="column-list-head">
        <span></span>
        <span>Column</span>
        <span title="Unique values">Unique</span>
        <span title="Null percentage">Null %</span>
      </div>

      <div class="column-list">
        ${columns
          .map((column) =>
            renderColumnItem(
              column,
              expandedName === column.name,
              openingName === column.name,
              closingName === column.name
            )
          )
          .join("")}
      </div>

      ${renderColumnDetailPanel(explorer, showDetail, Boolean(openingName), Boolean(closingName))}
    </section>
  `;
}

function renderColumnItem(
  column: AppState["payload"]["columns"][number],
  expanded: boolean,
  opening: boolean,
  closing: boolean
): string {
  const distinctTitle = column.distinctDisplay === "no data"
    ? "Unique values: no data"
    : `Unique values: ${column.distinctCount}`;
  const nullTitle = column.nullDisplay === "–"
    ? "Null percentage: 0%"
    : `Null percentage: ${column.nullDisplay}`;

  return `
    <div class="column-item ${expanded ? "expanded" : ""} ${opening ? "opening" : ""} ${closing ? "closing" : ""}">
      <button
        class="column-row ${expanded || opening || closing ? "active" : ""}"
        data-column-name="${escapeAttr(column.name)}"
        aria-expanded="${expanded || opening ? "true" : "false"}"
      >
        <div class="column-type">${escapeHtml(typeGlyph(column.type))}</div>
        <div class="column-name">${escapeHtml(column.name)}</div>
        <div class="column-metric ${column.distinctDisplay === "no data" ? "muted-italic" : ""}" title="${escapeAttr(distinctTitle)}">
          ${escapeHtml(column.distinctDisplay)}
        </div>
        <div class="column-metric column-null" title="${escapeAttr(nullTitle)}">${escapeHtml(column.nullDisplay)}</div>
      </button>
    </div>
  `;
}

function renderColumnDetailPanel(
  explorer: AppState["payload"]["explorer"],
  showDetail: boolean,
  opening: boolean,
  closing: boolean
): string {
  // Intent: keep the column list spatially stable while showing per-column stats.
  // We reserve a fixed detail pane instead of inserting expandable rows inline.
  if (!showDetail) {
    return `
      <section class="column-detail-panel empty" aria-live="polite">
        <div class="column-detail-placeholder">Select a column to view stats.</div>
      </section>
    `;
  }

  return `
    <section class="column-detail-panel ${opening ? "opening" : ""} ${closing ? "closing" : ""}" aria-live="polite">
      ${renderExpandedColumn(explorer)}
    </section>
  `;
}

function renderExpandedColumn(explorer: AppState["payload"]["explorer"]): string {
  const histogramView = explorer.view === "histogram";
  return `
    <div class="column-detail ${histogramView ? "numeric" : "categorical"}">
      <div class="column-detail-head">
        <span class="column-type selected">${escapeHtml(typeGlyph(explorer.type || ""))}</span>
        <span class="column-detail-type">${escapeHtml(explorer.type || "")}</span>
      </div>
      <div class="column-detail-preview-title">${escapeHtml(histogramView ? "Distribution (binned ranges)" : "Top values")}</div>
      ${histogramView
        ? `<div class="distribution-list">${renderNumericDistribution(explorer.distributionRows || [])}</div>`
        : `<div class="categorical-list">${renderCategoricalDistribution(explorer.distributionRows || [])}</div>`}
    </div>
  `;
}

function renderNumericDistribution(rows: AppState["payload"]["explorer"]["distributionRows"]): string {
  if (!rows.length) {
    return '<div class="distribution-empty">No distribution data</div>';
  }

  return rows
    .map(
      (row) => `
        <div class="distribution-row">
          <div class="distribution-label-wrap">
            <div class="distribution-bar-wrap">
              <div class="distribution-bar" style="width:${distributionBarWidth(row.percent)}%"></div>
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

function renderCategoricalDistribution(rows: AppState["payload"]["explorer"]["distributionRows"]): string {
  if (!rows.length) {
    return '<div class="distribution-empty">No top values</div>';
  }

  return rows
    .map(
      (row) => `
        <div class="categorical-row">
          <span class="categorical-label" title="${escapeAttr(row.label)}">${escapeHtml(row.label)}</span>
          <span class="categorical-count">${escapeHtml(formatDisplayNumber(row.value))}</span>
          <span class="categorical-percent">${escapeHtml(formatPercent(row.percent))}</span>
        </div>
      `
    )
    .join("");
}

function distributionBarWidth(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(numeric, 3));
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
                ${option("jsonl", "JSONL file", state.form.localType)}
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
              <label>AWS profile (optional)</label>
              <input id="s3-profile" value="${escapeAttr(state.form.s3Profile)}" />
            </div>
            <div class="actions">
              <span class="link">Leave blank to use automatic credentials on the workspace host</span>
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

function renderTable(
  headers: string[],
  rows: string[][],
  table: CellViewerTable,
  alignments: ColumnAlignment[]
): string {
  if (!headers.length) {
    return '<div class="empty-state">No rows returned.</div>';
  }

  return `
    <table>
      <thead>
        <tr>
          ${headers
            .map((header, columnIndex) => `<th class="${alignmentClass(alignments[columnIndex])}">${escapeHtml(header)}</th>`)
            .join("")}
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row, rowIndex) =>
              `<tr>${row
                .map(
                  (cell, columnIndex) =>
                    `<td class="${alignmentClass(alignments[columnIndex])}"><button class="cell-button mono" data-cell-table="${table}" data-cell-row="${rowIndex}" data-cell-col="${columnIndex}" title="View full cell value">${escapeHtml(cell)}</button></td>`
                )
                .join("")}</tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderCellViewer(state: AppState): string {
  if (!state.cellViewer.isOpen) {
    return "";
  }
  const tableLabel = state.cellViewer.table === "preview" ? "Preview" : "Query";
  const displayValue =
    state.cellViewer.format === "pretty" && state.cellViewer.prettyValue
      ? state.cellViewer.prettyValue
      : state.cellViewer.value;
  return `
    <div class="cell-viewer-backdrop" data-cell-viewer-backdrop="true" role="presentation">
      <div class="cell-viewer" role="dialog" aria-modal="true" aria-label="Cell value">
        <div class="cell-viewer-head">
          <div class="cell-viewer-title">Cell Value</div>
          <div class="cell-viewer-actions">
            ${state.cellViewer.canPrettyJson
              ? `<button class="toolbar-button ${state.cellViewer.format === "raw" ? "active" : ""}" data-action="cell-viewer-raw">Raw</button>
                 <button class="toolbar-button ${state.cellViewer.format === "pretty" ? "active" : ""}" data-action="cell-viewer-pretty">Pretty JSON</button>`
              : ""}
            <button class="toolbar-button" data-action="close-cell-viewer">Close</button>
          </div>
        </div>
        <div class="cell-viewer-meta">
          <span>${escapeHtml(tableLabel)}</span>
          <span>${escapeHtml(`Row ${state.cellViewer.rowNumber}`)}</span>
          <span>${escapeHtml(state.cellViewer.columnName)}</span>
          <span>${escapeHtml(state.cellViewer.format === "pretty" ? "Pretty JSON" : "Raw")}</span>
        </div>
        ${state.cellViewer.prettyError ? `<div class="cell-viewer-error">${escapeHtml(state.cellViewer.prettyError)}</div>` : ""}
        <pre class="cell-viewer-value mono">${escapeHtml(displayValue)}</pre>
      </div>
    </div>
  `;
}

function option(value: string, label: string, selected: string): string {
  return `<option value="${escapeAttr(value)}" ${selected === value ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

type ColumnAlignment = "left" | "right";

function buildPreviewColumnAlignments(state: AppState): ColumnAlignment[] {
  const typeByName = new Map(
    (state.payload.columns || []).map((column) => [column.name, column.type])
  );
  return (state.payload.previewHeaders || []).map((header) =>
    isNumericType(typeByName.get(header)) ? "right" : "left"
  );
}

function buildQueryColumnAlignments(headers: string[], rows: string[][]): ColumnAlignment[] {
  return headers.map((_header, columnIndex) =>
    isLikelyNumericColumn(rows, columnIndex) ? "right" : "left"
  );
}

function isNumericType(type: string | undefined): boolean {
  const upper = String(type || "").toUpperCase();
  return /TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|FLOAT|DOUBLE|DECIMAL|REAL|NUMERIC/.test(upper);
}

function isLikelyNumericColumn(rows: string[][], columnIndex: number): boolean {
  let seen = 0;
  for (const row of rows) {
    const value = String(row[columnIndex] ?? "").trim();
    if (!value || value.toLowerCase() === "null") {
      continue;
    }
    seen += 1;
    if (!isNumericString(value)) {
      return false;
    }
  }
  return seen > 0;
}

function isNumericString(value: string): boolean {
  const normalized = value.replace(/,/g, "");
  return /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(normalized);
}

function alignmentClass(alignment: ColumnAlignment | undefined): string {
  return alignment === "right" ? "cell-align-right" : "cell-align-left";
}
