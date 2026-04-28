# AGENTS

This file is the working guide for contributors and agents touching DuckView.

## Product Scope

DuckView is a desktop VS Code extension for readonly inspection of:

- `.parquet` files
- Parquet dataset folders
- `.sqlite` and `.db` files
- `.duckdb` files
- S3-backed Parquet sources opened through the connect flow

The product goal is not "invent a new BI app." The goal is:

- make file-open and source-open inspection feel native inside VS Code
- stay visually and behaviorally close to DuckDB UI where that helps
- keep `Preview` and `Query` as separate modes
- avoid notebook persistence, dashboard features, or workflow-management features

## Decisions

These are intentional decisions, not accidents.

- Use native DuckDB via `@duckdb/node-api`, not DuckDB-Wasm.
- Keep the extension desktop-first and optimized for local VS Code on macOS/Linux/Windows.
- Treat the DuckDB engine as embedded inside the extension host, not as a separate server product.
- Keep the UI minimal, tool-like, and DuckDB-UI-inspired rather than decorative.
- Keep `Preview` explicit and bounded by product-owned queries.
- Keep `Query` exact: user SQL should run as written, without hidden `LIMIT`s or silent rewrites.
- Protect the app by paging/streaming results in transport and rendering, not by mutating the user's query.
- Prefer exact summary behavior over private sampling heuristics unless sampling is explicit in the UI.
- Keep expensive exploration lazy where possible, especially per-column distribution work.
- Do not add notebook persistence unless the product direction explicitly changes.
- Do not position the extension as an official DuckDB UI or official DuckDB product.

## Dev Conventions

- Primary source code lives in `src/`.
- Generated output lives in `dist/`.
- Do not hand-edit files in `dist/`; rebuild instead.
- Extension-host code belongs in `src/extension/`.
- Shared message and payload contracts belong in `src/shared/protocol.ts`.
- Webview state/render/event code belongs in `src/webview/`.
- Styling lives in `media/app.css`.
- Keep the extension host and webview boundary explicit and typed.
- Add or change message types in the shared protocol first, then update the parser, provider, and webview.
- Prefer small, testable modules over large files with mixed concerns.
- Prefer TypeScript everywhere except static assets like CSS.
- Keep runtime dependencies minimal. Right now the only required runtime library is DuckDB itself.
- Use `make` as the entrypoint for all common tasks:
  - `make build` — compile extension and webview
  - `make test` — build and run tests
  - `make check` — build + test (the pre-commit gate)
  - `make clean` — remove `dist/`
  - `make package` — run check, then produce a `.vsix`
- Always run `make check` before calling work done.
- Add tests for pure logic when changing:
  - source normalization
  - readonly SQL enforcement
  - protocol parsing
  - state transitions

## Architecture Notes

- The extension entrypoint is `dist/extension/index.js`, generated from `src/index.ts`.
- The webview is a real browser surface, but the query engine is native DuckDB in the extension host.
- For non-`.duckdb` sources, DuckView reuses a shared in-memory DuckDB instance and opens short-lived connections per operation.
- For `.duckdb` files, DuckView opens the database read-only for the operation, then closes it.
- Query mode uses explicit result paging/streaming semantics rather than loading the full result eagerly into JavaScript memory.

## Blessed Patterns

- Add product-owned preview queries explicitly, with visible semantics.
- Use DuckDB SQL directly and keep the SQL readable in the codebase.
- Make costly behavior visible in the UI instead of hiding it behind magic.
- Page or stream large query results.
- Dispose of query sessions and connections aggressively when they are no longer needed.
- Keep readonly guardrails in one obvious place.
- Treat DuckDB UI as the reference point for loaded-table UX density and restraint.
- Prefer "exact unless explicitly approximate" for data profiling behavior.
- Keep CSS restrained and utilitarian.

## Cursed Patterns

- Editing `dist/` by hand.
- Adding hidden query rewrites, hidden `LIMIT`s, or secret sampling in query mode.
- Using `runAndReadAll` for arbitrary user queries that can grow without bound.
- Smuggling new fields across the webview boundary without updating `src/shared/protocol.ts`.
- Building product features that imply saved notebooks, collaboration, dashboards, or ETL workflows.
- Adding flashy styling that drifts away from a minimal data-tool feel.
- Introducing a frontend framework without a strong reason.
- Keeping long-lived per-file background state when short-lived query state will do.
- Making behavior "safer" by surprising expert users.

## When In Doubt

- Match DuckDB expectations.
- Prefer explicitness over cleverness.
- Protect the app's machinery, not the user from their own SQL.
- If a behavior is approximate, bounded, paged, or lazy, make that obvious in code and UI.
