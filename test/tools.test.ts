import { test, describe, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { pool } from "../src/db.js";
import { registerTools } from "../src/tools.js";

async function connectedClient() {
  const server = new McpServer({ name: "test-server", version: "0.0.0" });
  registerTools(server);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

function parseJsonContent(result: CallToolResult): unknown {
  const first = result.content[0];
  assert.equal(first?.type, "text");
  return JSON.parse((first as { text: string }).text);
}

function textContent(result: CallToolResult): string {
  return (result.content[0] as { text: string }).text;
}

function failWith(code: string) {
  return async () => {
    throw Object.assign(new Error(`raw ${code} from db.internal`), { code });
  };
}

beforeEach(() => {
  mock.method(console, "log", () => {});
  mock.method(console, "error", () => {});
});

afterEach(() => {
  mock.restoreAll();
});

describe("MCP tools", () => {
  test("tools/list exposes exactly the three posts tools", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      ["posts_latest", "posts_list", "posts_upsert"],
    );
  });

  test("posts_list returns the rows produced by the db layer", async () => {
    mock.method(pool, "query", async () => ({ rows: [{ slug: "a" }] }));
    const client = await connectedClient();
    const result = await client.callTool({ name: "posts_list", arguments: { limit: 5 } });
    assert.deepEqual(parseJsonContent(result as CallToolResult), [{ slug: "a" }]);
  });

  test("posts_list defaults limit to 20 when omitted", async () => {
    const queryMock = mock.method(pool, "query", async () => ({ rows: [] }));
    const client = await connectedClient();
    await client.callTool({ name: "posts_list", arguments: {} });
    const [, params] = queryMock.mock.calls[0]!.arguments;
    assert.deepEqual(params, [null, 20]);
  });

  test("posts_latest reports found:false when nothing matches", async () => {
    mock.method(pool, "query", async () => ({ rows: [] }));
    const client = await connectedClient();
    const result = await client.callTool({ name: "posts_latest", arguments: { prefix: "nope-" } });
    assert.deepEqual(parseJsonContent(result as CallToolResult), { found: false });
  });

  test("posts_latest reports isError for a call missing the required prefix", async () => {
    const client = await connectedClient();
    const result = (await client.callTool({ name: "posts_latest", arguments: {} })) as CallToolResult;
    assert.equal(result.isError, true);
  });

  test("posts_upsert returns the row written by the db layer", async () => {
    const row = { slug: "hello", title: "Hello", unlisted: false };
    mock.method(pool, "query", async () => ({ rows: [row] }));
    const client = await connectedClient();
    const result = await client.callTool({
      name: "posts_upsert",
      arguments: { slug: "hello", title: "Hello", content: "Body" },
    });
    assert.deepEqual(parseJsonContent(result as CallToolResult), row);
  });

  test("posts_upsert reports isError for a call missing required fields", async () => {
    const client = await connectedClient();
    const result = (await client.callTool({ name: "posts_upsert", arguments: { slug: "hello" } })) as CallToolResult;
    assert.equal(result.isError, true);
  });

  test("posts_list reports a translated isError on auth failure", async () => {
    mock.method(pool, "query", failWith("28P01"));
    const client = await connectedClient();
    const result = (await client.callTool({ name: "posts_list", arguments: {} })) as CallToolResult;
    assert.equal(result.isError, true);
    assert.equal(textContent(result), "Database authentication failed (server misconfiguration)");
  });

  test("posts_latest reports a translated isError when the database is unreachable", async () => {
    mock.method(pool, "query", failWith("ECONNREFUSED"));
    const client = await connectedClient();
    const result = (await client.callTool({ name: "posts_latest", arguments: { prefix: "a-" } })) as CallToolResult;
    assert.equal(result.isError, true);
    assert.equal(textContent(result), "Database unreachable, retry later");
  });

  test("posts_upsert reports a translated isError for a bad date", async () => {
    mock.method(pool, "query", failWith("22007"));
    const client = await connectedClient();
    const result = (await client.callTool({
      name: "posts_upsert",
      arguments: { slug: "hello", title: "Hello", content: "Body", date: "tomorrow" },
    })) as CallToolResult;
    assert.equal(result.isError, true);
    assert.equal(textContent(result), "Invalid date: expected YYYY-MM-DD");
    assert.doesNotMatch(JSON.stringify(result), /raw|db\.internal/);
  });
});
