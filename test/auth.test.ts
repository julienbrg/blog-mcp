import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { requireBearerToken } from "../src/auth.js";

function fakeReq(authorization?: string): Request {
  return {
    header: (name: string) => (name.toLowerCase() === "authorization" ? authorization : undefined),
  } as unknown as Request;
}

function fakeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe("requireBearerToken", () => {
  const ORIGINAL_TOKEN = process.env.MCP_BEARER_TOKEN;

  beforeEach(() => {
    process.env.MCP_BEARER_TOKEN = "correct-token";
  });

  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) delete process.env.MCP_BEARER_TOKEN;
    else process.env.MCP_BEARER_TOKEN = ORIGINAL_TOKEN;
  });

  test("rejects a missing Authorization header", () => {
    const req = fakeReq(undefined);
    const res = fakeRes();
    let nextCalled = false;
    requireBearerToken(req, res, () => {
      nextCalled = true;
    });
    assert.equal(res.statusCode, 401);
    assert.equal(nextCalled, false);
  });

  test("rejects a non-Bearer scheme", () => {
    const req = fakeReq("Basic correct-token");
    const res = fakeRes();
    requireBearerToken(req, res, () => assert.fail("next should not be called"));
    assert.equal(res.statusCode, 401);
  });

  test("rejects the wrong token", () => {
    const req = fakeReq("Bearer wrong-token");
    const res = fakeRes();
    requireBearerToken(req, res, () => assert.fail("next should not be called"));
    assert.equal(res.statusCode, 401);
  });

  test("calls next() for the correct token", () => {
    const req = fakeReq("Bearer correct-token");
    const res = fakeRes();
    let nextCalled = false;
    requireBearerToken(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
  });

  test("returns 500 when MCP_BEARER_TOKEN is not configured", () => {
    delete process.env.MCP_BEARER_TOKEN;
    const req = fakeReq("Bearer anything");
    const res = fakeRes();
    requireBearerToken(req, res, () => assert.fail("next should not be called"));
    assert.equal(res.statusCode, 500);
  });
});
