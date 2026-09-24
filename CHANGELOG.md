# Changelog

All notable changes to this project are documented in this file.

## Unreleased

### Added

- Test suite (`test/`) covering the bearer-token auth middleware, the
  Postgres query builders, and the three registered MCP tools, run via
  Node's built-in test runner (`pnpm test`).
- `docs/DATABASE_REQUIREMENTS.md` documenting the required `posts` table
  schema, minimum role privileges, and connection requirements for a fresh
  Postgres instance.
