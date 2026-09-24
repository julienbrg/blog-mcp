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
- README section on connecting non-Claude MCP clients (OpenAI, Mistral,
  Qwen), plus an honest note that DeepSeek has no native remote-MCP tool
  yet.
- CI workflow (`.github/workflows/ci.yml`) running `pnpm build` and
  `pnpm test` on push and pull request to `main`.

### Changed

- Public domain updated from `mcp.w3hc.org` to `blog.mcp.w3hc.org`
  throughout the README (nginx block, `ALLOWED_HOSTS`, client examples).
