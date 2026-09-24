# Using blog-mcp as a Claude connector

How to add the blog-mcp server at https://blog.mcp.w3hc.org/mcp as a custom connector in Claude on the web, and what to do if your account can't send its bearer token yet.

## What you need

- **Server URL:** `https://blog.mcp.w3hc.org/mcp`. Use the full path. `/` and `/mcp/` return 404.
- **Bearer token:** the `MCP_BEARER_TOKEN` value from `.env` on the server.
- **A [Claude](https://claude.ai/) account that can add [custom connectors](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp).** Free accounts can add one, and Pro, Max, Team and Enterprise accounts can add more. On Team and Enterprise, only an Owner can add them.

The server speaks the [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) over Streamable HTTP. It doesn't use [OAuth](https://oauth.net/2/). It checks a single static header on every request:

```http
Authorization: Bearer <MCP_BEARER_TOKEN>
```

Requests come from [Anthropic's servers](https://platform.claude.com/docs/en/api/ip-addresses) (`160.79.104.0/21`), not from your browser. The server must be reachable from the public internet, which it already is.

## Check that your account can send the token

Claude on the web sends a static token through the **Request headers** section of the *Add custom connector* dialog. According to [Anthropic's connector docs](https://claude.com/docs/connectors/custom/remote-mcp#authenticating-with-request-headers), this section is **in beta and only available to some organizations**.

Open the dialog (steps below) and look for **Request headers**:

- **It's there:** follow [Add the connector](#add-the-connector).
- **It isn't there:** your account can't send the token yet, so this server will reject every request with a 401. Skip to [If you don't have Request headers](#if-you-dont-have-request-headers).

## Add the connector

### Free, Pro and Max plans

1. Go to **Customize → Connectors** and click **Add custom connector**.
2. Fill in the dialog:

   | Field | Value |
   | --- | --- |
   | Name | `blog-mcp` |
   | MCP server URL | `https://blog.mcp.w3hc.org/mcp` |
   | Authentication | **No sign-in** |
   | Request headers → name | `authorization` |
   | Request headers → value | `Bearer <MCP_BEARER_TOKEN>` |
   | Request headers → Required | on |
   | Advanced → Transport | leave as detected (Streamable HTTP) |

3. Click **Add**.

### Team and Enterprise plans

An Owner adds the connector in **Organization settings → Connectors → Add → Custom** (choose **Web** if asked), using the values in the table above. Members then find it under **Customize → Connectors**, marked **Custom**, and click **Connect**.

Everyone in the organization shares the header value, so it gives all members the same access.

### Getting the header value right

Claude sends the value exactly as you type it and adds no prefix. The server also checks the scheme exactly, with a capital `B` ([src/auth.ts](../src/auth.ts)):

| You enter | Result |
| --- | --- |
| `Bearer 3f9c…` | 200, works |
| `3f9c…` | 401, missing scheme |
| `bearer 3f9c…` | 401, lowercase scheme |
| `Bearer  3f9c…` (two spaces) | 401 |

You can't edit the header after you save it. To change it, remove the connector and add it again.

## Use it in a chat

1. In a conversation, open the **+** menu → **Connectors** and switch **blog-mcp** on.
2. Ask something that needs it, for example *"List my 5 most recent posts."*
3. Claude asks for approval the first time it calls each tool.

The three tools:

| Tool | What it does | Writes data? |
| --- | --- | --- |
| `posts_list` | Lists recent posts, optionally filtered by slug prefix | No |
| `posts_latest` | Fetches the most recent post whose slug matches a prefix | No |
| `posts_upsert` | Inserts or updates a post by slug | **Yes** |

`posts_upsert` writes to the production `posts` table. Don't click **Always allow** for it. Keep approving it call by call, or set it to **Blocked** in **Customize → Connectors → blog-mcp** if you only need to read posts.

## If you don't have Request headers

Until the beta reaches your account, Claude on the web can only sign in with OAuth, and this server doesn't support it. [Other users have reported the same gap](https://github.com/anthropics/claude-ai-mcp/issues/715). Your options:

- **Use [Claude Code](https://code.claude.com/docs/en/mcp-quickstart) instead.** It can send the header from the command line:

  ```bash
  claude mcp add --transport http blog-mcp https://blog.mcp.w3hc.org/mcp \
    --header "Authorization: Bearer <MCP_BEARER_TOKEN>"
  ```

- **Wait for the beta,** then follow [Add the connector](#add-the-connector).
- **Add OAuth to the server.** This is the only way to work on every Claude plan today, but it's a substantial change. See [Authentication for connectors](https://claude.com/docs/connectors/building/authentication).

Don't put the token in the URL (for example `?token=…`). URLs end up in logs and browser history, and the [MCP spec forbids tokens in query strings](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#token-requirements). The server doesn't accept a token that way anyway.

## Troubleshooting

Start by checking the endpoint from any terminal, independently of Claude. This calls `posts_list`, so it tests the database too, not just the token:

```bash
curl -s -X POST https://blog.mcp.w3hc.org/mcp \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"posts_list","arguments":{"limit":1}}}'
```

On the VPS itself, `curl -s 127.0.0.1:3939/health` checks only the database connection and returns `{"db":"ok"}` or a 503 with a `reason`.

| Symptom | Likely cause |
| --- | --- |
| "Couldn't reach the MCP server" | Missing or wrong header, so every request gets a 401. Check [Getting the header value right](#getting-the-header-value-right). |
| 401 from curl as well | Wrong token, or the server's `.env` changed. Compare against `.env` on the server, then run `pm2 restart blog-mcp`. |
| 403 | `blog.mcp.w3hc.org` is missing from `ALLOWED_HOSTS` in `.env`. |
| 404 | Wrong path: it must be exactly `/mcp`. |
| 502 | The process is down. Check `pm2 ls` and `pm2 logs blog-mcp`. The server exits at startup if it can't reach the database, and the log says why (`Database check failed (auth): …`). |
| `Database authentication failed (server misconfiguration)` | `DATABASE_URL` in `.env` has the wrong user or password. Fix it, then run `pm2 restart blog-mcp`. |
| `Database unreachable, retry later` | Postgres is down, or the host or port in `DATABASE_URL` is wrong. |
| `Database query timed out` | A query ran for more than 10 seconds. |
| `Invalid date: expected YYYY-MM-DD` | `posts_upsert` got a `date` that Postgres can't parse. |
| `Rejected by database constraint: <name>` | The post breaks a rule in the `posts` table, such as a `NOT NULL` or `CHECK`. |
| `Internal error (ref <id>)` | Anything else. Search `pm2 logs blog-mcp` for `ref=<id>` to find the full error. |

After you [rotate the token](../README.md#operations), remove the connector and add it again with the new value, because headers can't be edited.

## Further reading

- [Third party connectors with remote MCP](https://claude.com/docs/connectors/custom/remote-mcp): the official guide to adding connectors
- [Authentication for connectors](https://claude.com/docs/connectors/building/authentication): every authentication method Claude supports
- [MCP specification](https://modelcontextprotocol.io/specification/2025-11-25)
