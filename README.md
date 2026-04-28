# DuckView

Inspect Parquet, SQLite, and DuckDB files directly in VS Code. DuckView opens data files in a readonly viewer powered by native DuckDB — no external tools, no servers, no configuration.

## Supported Formats

| Format | How to open |
|---|---|
| `.parquet` | Open the file — DuckView activates automatically |
| `.sqlite` / `.db` | Open the file — DuckView activates automatically |
| `.duckdb` | Open the file — DuckView activates automatically |
| Parquet dataset (folder) | Right-click a folder → **DuckView: Open as Parquet Dataset** |
| S3 Parquet | Command palette → **DuckView: Open Source** → enter an `s3://` URI |

## Features

**Preview** shows schema, summary statistics, and sample rows for the selected table. Column exploration gives you value distributions (histograms for numeric columns, top values for categorical ones).

**Query** lets you write and run readonly SQL against the opened source. Results stream back in pages — large result sets won't lock up the editor.

Multi-table sources (SQLite, DuckDB databases) show a table list in the sidebar. Click a table to switch context.

## Settings

| Setting | Default | Description |
|---|---|---|
| `duckview.previewLimit` | `100` | Row limit for preview queries (1–5000) |

## Requirements

- VS Code 1.90 or later
- macOS, Linux, or Windows (desktop only)

SQLite and S3 support use DuckDB's `sqlite` and `httpfs` extensions, which are downloaded automatically on first use to `/tmp/duckview-duckdb-extensions`.

## Development

See [AGENTS.md](AGENTS.md) for architecture, conventions, and contribution guidance.

```
npm install
make check   # build + test
```

Press F5 in VS Code to launch the Extension Development Host.

## License

[MIT](LICENSE)
