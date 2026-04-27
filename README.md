# DuckView

DuckView is a VS Code extension scaffold for readonly Parquet, DuckDB, SQLite, and Parquet-dataset inspection using native DuckDB in the extension host.

## Current MVP

- Opens `.parquet`, `.duckdb`, `.sqlite`, and `.db` files in a custom readonly editor
- Adds `DuckView: Open Source` for local paths and S3 URIs
- Adds `DuckView: Open as Parquet Dataset` for folder-backed datasets
- Uses real DuckDB queries for:
  - schema discovery
  - preview rows
  - summary stats
  - column exploration
  - readonly query execution

## Architecture

- `src/extension/`: VS Code lifecycle, panel coordination, native DuckDB service
- `src/shared/`: typed protocol shared by the extension host and the webview
- `src/webview/`: typed UI state, rendering, and event handling
- `media/app.css`: the DuckDB-inspired shell styling
- `dist/`: generated build output used by VS Code at runtime

## Run

1. Open this folder in VS Code.
2. Run `npm install`.
3. Press `F5`.
4. In the Extension Development Host, open a Parquet or SQLite file or run `DuckView: Open Source`.

The debug launcher runs `npm run build` before starting the Extension Development Host.

## Checks

- `npm run build`
- `npm test`
- `npm run check`

## Notes

- SQLite and S3 rely on DuckDB extensions (`sqlite` and `httpfs`).
- DuckView sets DuckDB's `extension_directory` to `/tmp/duckview-duckdb-extensions` so extension downloads do not depend on `~/.duckdb`.
- The UI is intentionally plain and close to a DuckDB-UI-style inspection workflow rather than a dashboard.
