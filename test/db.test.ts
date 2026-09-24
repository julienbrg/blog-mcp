import { test, describe, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { pool, checkDatabase, listPosts, latestPost, upsertPost } from "../src/db.js";

afterEach(() => {
  mock.restoreAll();
});

describe("pool", () => {
  test("has an 'error' listener so a dropped idle connection doesn't crash the process", () => {
    assert.ok(pool.listenerCount("error") >= 1);
  });

  test("bounds connect and statement time", () => {
    assert.equal(pool.options.connectionTimeoutMillis, 5000);
    assert.equal((pool.options as { statement_timeout?: number }).statement_timeout, 10000);
  });
});

describe("checkDatabase", () => {
  test("queries the posts table", async () => {
    const queryMock = mock.method(pool, "query", async () => ({ rows: [] }));
    await checkDatabase();
    assert.match(queryMock.mock.calls[0]!.arguments[0] as string, /from posts/);
  });

  test("rejects with the database error", async () => {
    const error = Object.assign(new Error("password authentication failed"), { code: "28P01" });
    mock.method(pool, "query", async () => {
      throw error;
    });
    await assert.rejects(checkDatabase(), error);
  });
});

describe("listPosts", () => {
  test("passes null and the limit when no prefix is given", async () => {
    const queryMock = mock.method(pool, "query", async () => ({ rows: [] }));
    await listPosts(undefined, 20);
    assert.equal(queryMock.mock.calls.length, 1);
    const [sql, params] = queryMock.mock.calls[0]!.arguments;
    assert.match(sql as string, /from posts/);
    assert.match(sql as string, /order by created_at desc/);
    assert.deepEqual(params, [null, 20]);
  });

  test("passes the prefix through when given", async () => {
    const queryMock = mock.method(pool, "query", async () => ({ rows: [] }));
    await listPosts("ethereum-daily-", 5);
    const [, params] = queryMock.mock.calls[0]!.arguments;
    assert.deepEqual(params, ["ethereum-daily-", 5]);
  });

  test("returns the rows from the query result", async () => {
    const fakeRows = [{ slug: "a" }, { slug: "b" }];
    mock.method(pool, "query", async () => ({ rows: fakeRows }));
    const result = await listPosts(undefined, 20);
    assert.deepEqual(result, fakeRows);
  });
});

describe("latestPost", () => {
  test("queries with limit 1 and the given prefix", async () => {
    const queryMock = mock.method(pool, "query", async () => ({ rows: [] }));
    await latestPost("ethereum-daily-");
    const [sql, params] = queryMock.mock.calls[0]!.arguments;
    assert.match(sql as string, /limit 1/);
    assert.deepEqual(params, ["ethereum-daily-"]);
  });

  test("returns null when no row matches", async () => {
    mock.method(pool, "query", async () => ({ rows: [] }));
    const result = await latestPost("no-match-");
    assert.equal(result, null);
  });

  test("returns the single matching row", async () => {
    const row = { slug: "ethereum-daily-2026-09-24" };
    mock.method(pool, "query", async () => ({ rows: [row] }));
    const result = await latestPost("ethereum-daily-");
    assert.deepEqual(result, row);
  });
});

describe("upsertPost", () => {
  test("builds params in column order, defaulting optional fields to null and unlisted to false", async () => {
    const queryMock = mock.method(pool, "query", async () => ({ rows: [{ slug: "hello" }] }));
    await upsertPost({ slug: "hello", title: "Hello", content: "Body" });
    const [sql, params] = queryMock.mock.calls[0]!.arguments;
    assert.match(sql as string, /insert into posts/);
    assert.match(sql as string, /on conflict \(slug\) do update/);
    assert.deepEqual(params, ["hello", "Hello", null, null, null, null, null, null, null, null, "Body", false]);
  });

  test("passes through all optional fields and unlisted:true when given", async () => {
    const queryMock = mock.method(pool, "query", async () => ({ rows: [{ slug: "hello" }] }));
    await upsertPost({
      slug: "hello",
      title: "Hello",
      description: "desc",
      date: "2026-09-24",
      locale: "fr_FR",
      image: "/img.png",
      image_alt: "alt",
      author: "Julien",
      model: "Claude",
      conversation: "https://claude.ai/chat/1",
      content: "Body",
      unlisted: true,
    });
    const [, params] = queryMock.mock.calls[0]!.arguments;
    assert.deepEqual(params, [
      "hello",
      "Hello",
      "desc",
      "2026-09-24",
      "fr_FR",
      "/img.png",
      "alt",
      "Julien",
      "Claude",
      "https://claude.ai/chat/1",
      "Body",
      true,
    ]);
  });

  test("returns the returned row", async () => {
    const row = { slug: "hello", title: "Hello" };
    mock.method(pool, "query", async () => ({ rows: [row] }));
    const result = await upsertPost({ slug: "hello", title: "Hello", content: "Body" });
    assert.deepEqual(result, row);
  });
});
