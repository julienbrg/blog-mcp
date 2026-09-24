import { test, describe, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { classifyError, redact, withErrors } from "../src/errors.js";

function pgError(code: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`raw ${code} message from db.internal:5432`), { code, ...extra });
}

afterEach(() => {
  mock.restoreAll();
});

describe("classifyError", () => {
  const cases: [string, string, string][] = [
    ["28P01", "auth", "Database authentication failed (server misconfiguration)"],
    ["28000", "auth", "Database authentication failed (server misconfiguration)"],
    ["ECONNREFUSED", "unreachable", "Database unreachable, retry later"],
    ["ENOTFOUND", "unreachable", "Database unreachable, retry later"],
    ["ETIMEDOUT", "unreachable", "Database unreachable, retry later"],
    ["57P01", "unreachable", "Database unreachable, retry later"],
    ["22007", "bad_date", "Invalid date: expected YYYY-MM-DD"],
    ["22008", "bad_date", "Invalid date: expected YYYY-MM-DD"],
    ["57014", "timeout", "Database query timed out"],
  ];

  for (const [code, category, message] of cases) {
    test(`maps ${code} to ${category}`, () => {
      assert.deepEqual(classifyError(pgError(code)), { category, message });
    });
  }

  test("names the constraint for 23xxx errors", () => {
    const result = classifyError(pgError("23505", { constraint: "posts_pkey" }));
    assert.deepEqual(result, { category: "constraint", message: "Rejected by database constraint: posts_pkey" });
  });

  test("treats pg-pool connect timeouts as unreachable", () => {
    assert.equal(classifyError(new Error("timeout exceeded when trying to connect")).category, "unreachable");
  });

  test("gives unknown errors a reference id and hides the raw message", () => {
    const result = classifyError(pgError("42P01"));
    assert.equal(result.category, "internal");
    assert.match(result.ref!, /^[0-9a-f]{8}$/);
    assert.equal(result.message, `Internal error (ref ${result.ref})`);
  });

  test("handles non-Error throwables", () => {
    assert.equal(classifyError("boom").category, "internal");
    assert.equal(classifyError(undefined).category, "internal");
  });
});

describe("redact", () => {
  test("hides the password in a connection string", () => {
    assert.equal(
      redact("failed for postgres://website:s3cr3t@db.example:5432/blog"),
      "failed for postgres://website:***@db.example:5432/blog",
    );
  });

  test("leaves text without credentials alone", () => {
    assert.equal(redact("connect ECONNREFUSED 127.0.0.1:5432"), "connect ECONNREFUSED 127.0.0.1:5432");
  });
});

describe("withErrors", () => {
  test("passes a successful result through and logs ok", async () => {
    const log = mock.method(console, "log", () => {});
    const wrapped = withErrors("posts_list", async () => ({ content: [{ type: "text" as const, text: "[]" }] }));
    const result = await wrapped();
    assert.deepEqual(result, { content: [{ type: "text", text: "[]" }] });
    assert.match(log.mock.calls[0]!.arguments[0] as string, /^tool=posts_list result=ok duration=\d+ms$/);
  });

  test("returns a translated isError result without leaking the raw message", async () => {
    const error = mock.method(console, "error", () => {});
    const wrapped = withErrors("posts_list", async () => {
      throw pgError("28P01");
    });
    const result = await wrapped();
    assert.equal(result.isError, true);
    assert.deepEqual(result.content, [{ type: "text", text: "Database authentication failed (server misconfiguration)" }]);
    assert.doesNotMatch(JSON.stringify(result), /raw|db\.internal/);
    assert.match(error.mock.calls[0]!.arguments[0] as string, /^tool=posts_list result=error:auth duration=\d+ms$/);
  });

  test("logs the same reference id it returns for unknown errors", async () => {
    const error = mock.method(console, "error", () => {});
    const wrapped = withErrors("posts_upsert", async () => {
      throw new Error("something odd");
    });
    const result = await wrapped();
    const text = (result.content[0] as { text: string }).text;
    const ref = /ref ([0-9a-f]{8})/.exec(text)![1];
    assert.match(error.mock.calls[0]!.arguments[0] as string, new RegExp(`ref=${ref}$`));
  });
});
