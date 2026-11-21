import { test, describe, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { pool } from "../src/db.js";
import { createApp } from "../src/server.js";

async function getHealth() {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

afterEach(() => {
  mock.restoreAll();
});

describe("GET /health", () => {
  test("returns 200 when the database answers", async () => {
    mock.method(pool, "query", async () => ({ rows: [{ "?column?": 1 }] }));
    assert.deepEqual(await getHealth(), { status: 200, body: { db: "ok" } });
  });

  test("returns 503 with the failure category when it doesn't", async () => {
    mock.method(pool, "query", async () => {
      throw Object.assign(new Error("password authentication failed"), { code: "28P01" });
    });
    assert.deepEqual(await getHealth(), { status: 503, body: { db: "error", reason: "auth" } });
  });

  test("needs no bearer token", async () => {
    mock.method(pool, "query", async () => ({ rows: [] }));
    assert.equal((await getHealth()).status, 200);
  });
});

async function postMcp(bytes: number, headers: Record<string, string> = {}) {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const body = JSON.stringify({ pad: "x".repeat(bytes) });
    // node:http rather than fetch, which won't let a test override Host.
    return await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path: "/mcp",
          method: "POST",
          headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), ...headers },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      // The server may answer and close before the whole body is sent.
      req.on("error", (err: NodeJS.ErrnoException) => (err.code === "EPIPE" || err.code === "ECONNRESET" ? undefined : reject(err)));
      req.end(body);
    });
  } finally {
    server.close();
  }
}

describe("POST /mcp body limit", () => {
  const savedToken = process.env.MCP_BEARER_TOKEN;

  beforeEach(() => {
    process.env.MCP_BEARER_TOKEN = "test-token";
    mock.method(console, "log", () => {});
  });

  afterEach(() => {
    if (savedToken === undefined) delete process.env.MCP_BEARER_TOKEN;
    else process.env.MCP_BEARER_TOKEN = savedToken;
  });

  test("parses bodies over Express's 100 KB default", async () => {
    assert.equal(await postMcp(200 * 1024), 401);
  });

  test("rejects bodies over 1 MB with 413", async () => {
    assert.equal(await postMcp(1024 * 1024 + 1), 413);
  });

  test("checks the Host header before reading the body", async () => {
    assert.equal(await postMcp(1024 * 1024 + 1, { host: "evil.example" }), 403);
  });
});
