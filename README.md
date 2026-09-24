# blog-mcp

MCP server exposing three tools against the `posts` table on `db.w3hc.org`:

| Tool | Description |
|---|---|
| `posts_list` | List recent posts, optionally filtered by slug prefix |
| `posts_latest` | Fetch the most recent post whose slug matches a prefix |
| `posts_upsert` | Insert or update a post by slug |

No raw SQL, no delete: the surface area is intentionally limited to what's
safe to expose over the internet.

## Architecture

```
Claude  --HTTPS-->  reverse proxy (TLS)  --HTTP, localhost-->  this server  -->  Postgres
```

The server binds to `127.0.0.1` only. It is never directly reachable from the
internet — whatever already terminates TLS on the VPS (nginx, Caddy, ...) is
the sole public entry point. Auth is a single bearer token, checked with a
constant-time comparison. Transport is MCP's stateless Streamable HTTP: every
request builds a fresh in-memory server, handles the call, and tears it down.

## Local development

```bash
pnpm install
cp .env.example .env
```

Fill in `.env`:
- `DATABASE_URL` — already-issued credentials, just append `?sslmode=verify-full`.
  Do **not** add `sslrootcert=system`: that's a libpq-only value (works with
  `psql`) and makes node-postgres try to read a literal file named `system`.
  Plain `sslmode=verify-full` gives correct full chain + hostname verification
  under Node, using its bundled CA store.
- `MCP_BEARER_TOKEN` — generate with `openssl rand -hex 32`.

`pnpm start`/`pnpm dev` load `.env` via Node's built-in `--env-file` flag
(Node 20.6+), so no `dotenv` dependency is needed — but `.env` must exist in
the working directory or the process exits immediately with a missing
variable error.

Run it:

```bash
pnpm build && pnpm start
# or, with reload on change:
pnpm dev
```

### Running the tests

```bash
pnpm test
```

Runs the full suite via Node's built-in test runner (`node:test`, through
`tsx --test`). No database connection or network access is required — `pg`'s
`pool.query` is mocked in `test/db.test.ts` and `test/tools.test.ts`.

### Testing with curl

```bash
TOKEN=... # from .env

# Handshake
curl -s -X POST http://127.0.0.1:3939/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl-test","version":"1.0"}}}'

# List tools
curl -s -X POST http://127.0.0.1:3939/mcp \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# Call a tool
curl -s -X POST http://127.0.0.1:3939/mcp \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"posts_list","arguments":{"limit":3}}}'
```

### Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

Point it at `http://127.0.0.1:3939/mcp`, transport "Streamable HTTP", and set
the `Authorization` header to `Bearer <your token>` in its auth settings.

## Deployment (Infomaniak Ubuntu VPS)

1. **Ship the code.** On the VPS:
   ```bash
   sudo mkdir -p /opt/blog-mcp
   sudo useradd --system --home /opt/blog-mcp --shell /usr/sbin/nologin blog-mcp
   ```
   Copy the repo there (git clone, rsync, or CI), then:
   ```bash
   cd /opt/blog-mcp
   pnpm install --prod=false   # devDependencies needed for the build step
   pnpm build
   pnpm prune --prod           # drop devDependencies after building
   ```

2. **Write the real `.env`** at `/opt/blog-mcp/.env` (copy `.env.example`,
   fill in the real `DATABASE_URL` and a freshly generated `MCP_BEARER_TOKEN`).
   Lock it down:
   ```bash
   sudo chown blog-mcp:blog-mcp /opt/blog-mcp/.env
   sudo chmod 600 /opt/blog-mcp/.env
   sudo chown -R blog-mcp:blog-mcp /opt/blog-mcp
   ```

3. **Install the systemd unit:**
   ```bash
   sudo cp deploy/blog-mcp.service /etc/systemd/system/blog-mcp.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now blog-mcp
   sudo systemctl status blog-mcp
   ```

4. **Reverse proxy.** Example nginx server block terminating TLS and
   forwarding to the local port (adjust the domain/cert paths to whatever
   already manages TLS on this VPS, e.g. certbot):
   ```nginx
   server {
       listen 443 ssl http2;
       server_name mcp.w3hc.org;

       ssl_certificate     /etc/letsencrypt/live/mcp.w3hc.org/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/mcp.w3hc.org/privkey.pem;

       location /mcp {
           proxy_pass http://127.0.0.1:3939/mcp;
           proxy_set_header Host $host;
           proxy_http_version 1.1;
           proxy_set_header Connection "";
           proxy_read_timeout 300s;
       }
   }
   ```
   Because `proxy_set_header Host $host;` forwards the public hostname, set
   `ALLOWED_HOSTS=mcp.w3hc.org` (plus `localhost,127.0.0.1,[::1]` for local
   testing) in `.env` — otherwise the SDK's DNS-rebinding protection will
   403 every proxied request. Restart the service after changing `.env`:
   ```bash
   sudo systemctl restart blog-mcp
   ```

5. **Register the connector in Claude:** add a custom connector with URL
   `https://mcp.w3hc.org/mcp` and the bearer token from `.env`.

## Operations

- Logs: `journalctl -u blog-mcp -f`
- Restart: `sudo systemctl restart blog-mcp`
- Token rotation: generate a new one (`openssl rand -hex 32`), update
  `.env`, restart, update the connector config in Claude. No fixed cadence
  is enforced; rotate every few months or after any suspected exposure.
- Resource footprint: idle ~40-80 MB resident memory, negligible CPU. Load
  is a handful of requests per day, millisecond-scale CPU cost each — far
  lighter than the nightly `pg_dumpall`/restic backup jobs already running
  on this box.

## Security notes

- Never add a raw-SQL or delete tool. If a new use case needs one, write a
  new narrow, purpose-built tool instead of widening an existing one.
- The `website` Postgres role is reused as-is — no elevated grants, same
  `pg_hba`/connection-limit restrictions as everything else using it.
- The process never binds to a public interface; only the reverse proxy is
  internet-facing.

## License

GPL-3.0

## Contact

**Julien Béranger** ([GitHub](https://github.com/julienbrg))

- Element: [@julienbrg:matrix.org](https://matrix.to/#/@julienbrg:matrix.org)
- Farcaster: [julien-](https://warpcast.com/julien-)
- Telegram: [@julienbrg](https://t.me/julienbrg)
