# Dabble

Inspect Parquet, SQLite, and DuckDB files directly in VS Code. Dabble opens data files in a readonly viewer powered by native DuckDB running in the workspace extension host — no separate server product, no hidden query rewrites, no extra services to manage.

## Supported Formats

| Format | How to open |
|---|---|
| `.parquet` | Open the file — Dabble is the default editor association |
| `.sqlite` / `.db` | Open the file — Dabble is the default editor association |
| `.duckdb` | Open the file — Dabble is the default editor association |
| Parquet dataset (folder) | Right-click a folder → **Dabble: Open as Parquet Dataset** |
| S3 Parquet | Command palette → **Dabble: Open Source** → enter an `s3://` URI |

## Features

**Preview** shows schema, summary statistics, and sample rows for the selected table. Column exploration gives you value distributions (histograms for numeric columns, top values for categorical ones).

**Query** lets you write and run readonly SQL against the opened source. Results stream back in pages — large result sets won't lock up the editor.

Multi-table sources (SQLite, DuckDB databases) show a table list in the sidebar. Click a table to switch context.

## Settings

| Setting | Default | Description |
|---|---|---|
| `dabble.previewLimit` | `100` | Row limit for preview queries (1–5000) |

## Requirements

- VS Code desktop 1.90 or later
- A workspace host that can run Dabble's native DuckDB dependency

## Remote Workspaces

Dabble is a workspace extension. On a local folder, DuckDB runs on your local machine. In remote workspaces such as Remote-SSH, WSL, or Dev Containers, DuckDB runs on the workspace host while the custom editor UI stays in the VS Code desktop client.

When Dabble is installed in a remote workspace, the same default editor associations apply there too. If you do not see Dabble commands in the remote Explorer context menu, the extension is not installed or running on that workspace host yet.

SQLite and S3 support use DuckDB's `sqlite` and `httpfs` extensions, which are downloaded automatically on first use to `/tmp/dabble-duckdb-extensions`.

## Development

See [AGENTS.md](AGENTS.md) for architecture, conventions, and contribution guidance.

```
npm install
make check   # build + test
```

Press F5 in VS Code to launch the Extension Development Host.

To debug Dabble against a remote workspace, open this repository in that remote VS Code window first, install dependencies on the workspace host, and then press F5 there so the extension runs in the remote workspace extension host.

Starting the development extension from a local window and then connecting that window to Remote-SSH is not enough. VS Code's remote development model runs workspace extensions on the SSH host, so an unpublished development build must either be launched from the already-remote window or packaged as a `.vsix` and installed into that remote workspace.

## Packaging And Distribution

Dabble uses a native DuckDB dependency, so distribution should use platform-specific VSIX packages rather than a single catch-all artifact.

Supported VSIX targets:

- `darwin-arm64`
- `darwin-x64`
- `linux-arm64`
- `linux-x64`
- `win32-arm64`
- `win32-x64`

Package the current platform:

```sh
make package
```

Package a specific target:

```sh
make package TARGET=linux-x64
```

Package all supported targets:

```sh
make package-all
```

Generated VSIX files are written to `artifacts/`.

Publish the current platform artifact:

```sh
make publish
```

Publish a specific target artifact:

```sh
make publish TARGET=linux-x64
```

Publish all packaged targets:

```sh
make publish-all
```

Publishing uses the local `./node_modules/.bin/vsce` binary and the already-generated VSIX files in `artifacts/`, so it preserves the target-specific DuckDB packaging logic instead of rebuilding a generic extension package.

Before publishing:

1. Create or confirm your Marketplace publisher, and make sure `package.json`'s `publisher` matches that publisher ID.
2. Create an Azure DevOps PAT with organization access set to `All accessible organizations` and scope `Marketplace (Manage)`.
3. Authenticate either by exporting `VSCE_PAT` or by running `./node_modules/.bin/vsce login <publisher>`.

Example:

```sh
export VSCE_PAT=your_token_here
make publish-all
```

The repository includes a CI workflow that runs checks and exercises `npm run package:all` on pushes, pull requests, and manual dispatches so packaging regressions are caught early. Marketplace publishing and manual browser uploads remain a separate release step.

## License

[MIT](LICENSE)
