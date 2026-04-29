# Changelog

## Unreleased

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
