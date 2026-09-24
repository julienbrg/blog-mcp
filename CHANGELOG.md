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
- Startup database check: the server exits with code 1 and a redacted
  one-line reason if `select 1 from posts limit 1` fails.
- Tool errors are caught, logged in full on the server, and returned to the
  client as `isError` results with a safe message (auth, unreachable,
  timeout, bad date, constraint, or `Internal error (ref <id>)`).
- One log line per tool call with its outcome and duration, and
  rate-limited logging of 401s.
- Local `GET /health` endpoint reporting database status.
- `docs/CONNECTOR.md`, a guide to adding the server as a Claude custom
  connector, with troubleshooting for each error message.

### Changed

- The Postgres pool now has an `'error'` listener, so a dropped idle
  connection no longer crashes the process, plus a 5 s connect timeout and a
  10 s statement timeout.

- Public domain updated from `mcp.w3hc.org` to `blog.mcp.w3hc.org`
  throughout the README (nginx block, `ALLOWED_HOSTS`, client examples).
