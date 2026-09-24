import { test, describe, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
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
