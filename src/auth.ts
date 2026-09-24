import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Buffers of different lengths would make timingSafeEqual throw, and the
  // length check itself is not secret, so it's fine to short-circuit here.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function requireBearerToken(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.MCP_BEARER_TOKEN;
  if (!expected) {
    res.status(500).json({ error: "Server misconfigured: MCP_BEARER_TOKEN is not set" });
    return;
  }

  const header = req.header("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token || !safeEqual(token, expected)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}
