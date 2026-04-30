# Changelog

## Unreleased

## 0.3.0

- Added JSONL/NDJSON source support in Dabble's preview/query flow using native DuckDB JSON readers.
- Changed JSONL/NDJSON defaults to open in VS Code's text editor, with Dabble available as an opt-in editor.
- Added a large-file JSONL prompt with one-click **Open in Dabble** behavior.
- Added a modal cell viewer for full-value inspection from preview and query tables.
- Preserved verbatim multiline cell rendering and added on-demand **Pretty JSON** formatting (raw by default).
- Added numeric column right-alignment in table rendering for clearer scanability.
- Added JSONL fixtures and expanded tests around source detection, state transitions, and JSON cell-viewer behavior.

## 0.2.1

- Added the Dabble icon to the extension package metadata and repository README.

## 0.2.0

- Improved remote workspace support and platform-specific VSIX packaging behavior.
- Added resumable multi-target VSIX publishing support for release workflows.
- Refined the column explorer layout and summary/stat presentation for more stable table inspection.
- Improved query editor keyboard focus and run shortcut behavior.
- S3 open-source flow now defaults to DuckDB's automatic AWS credential chain, with an optional AWS profile override.

## 0.1.0

Initial release.

- Readonly viewer for `.parquet`, `.sqlite`, `.db`, and `.duckdb` files
- Parquet dataset support (folder-backed)
- S3 Parquet support via `Dabble: Open Source`
- Preview mode: schema, summary stats, sample rows, column exploration
- Query mode: readonly SQL with streamed/paged results
- Right-click context menu for supported file types
