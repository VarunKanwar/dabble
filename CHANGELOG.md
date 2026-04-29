# Changelog

## Unreleased

- S3 open-source flow now defaults to DuckDB's automatic AWS credential chain.
- Leaving the S3 profile field blank uses credentials from the workspace host, including environment variables, `~/.aws` config, and ECS/EC2 roles.
- The S3 profile field is now optional and only needed when forcing a specific AWS profile.

## 0.1.0

Initial release.

- Readonly viewer for `.parquet`, `.sqlite`, `.db`, and `.duckdb` files
- Parquet dataset support (folder-backed)
- S3 Parquet support via `Dabble: Open Source`
- Preview mode: schema, summary stats, sample rows, column exploration
- Query mode: readonly SQL with streamed/paged results
- Right-click context menu for supported file types
