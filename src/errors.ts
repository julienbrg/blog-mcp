import { randomBytes } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type ErrorCategory = "auth" | "unreachable" | "timeout" | "bad_date" | "constraint" | "internal";

export interface ClassifiedError {
  category: ErrorCategory;
  message: string;
  ref?: string;
}

const UNREACHABLE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ETIMEDOUT",
  "57P01",
  "57P03",
]);

// pg and pg-pool raise these without a `code`.
const UNREACHABLE_MESSAGES = /timeout exceeded when trying to connect|connection timeout|Connection terminated/i;

export function classifyError(err: unknown): ClassifiedError {
  const { code, constraint, message } = (err ?? {}) as { code?: unknown; constraint?: unknown; message?: unknown };

  if (code === "28P01" || code === "28000") {
    return { category: "auth", message: "Database authentication failed (server misconfiguration)" };
  }
  if ((typeof code === "string" && UNREACHABLE_CODES.has(code)) ||
      (typeof message === "string" && UNREACHABLE_MESSAGES.test(message))) {
    return { category: "unreachable", message: "Database unreachable, retry later" };
  }
  if (code === "57014") {
    return { category: "timeout", message: "Database query timed out" };
  }
  if (code === "22007" || code === "22008") {
    return { category: "bad_date", message: "Invalid date: expected YYYY-MM-DD" };
  }
  if (typeof code === "string" && code.startsWith("23")) {
    const name = typeof constraint === "string" ? constraint : code;
    return { category: "constraint", message: `Rejected by database constraint: ${name}` };
  }
  const ref = randomBytes(4).toString("hex");
  return { category: "internal", message: `Internal error (ref ${ref})`, ref };
}

export function redact(text: string): string {
  return text.replace(/(\/\/[^:/@\s]+:)[^@\s]+@/g, "$1***@");
}

export function withErrors<A extends unknown[]>(
  tool: string,
  handler: (...args: A) => Promise<CallToolResult>,
): (...args: A) => Promise<CallToolResult> {
  return async (...args) => {
    const start = performance.now();
    const elapsed = () => `${Math.round(performance.now() - start)}ms`;
    try {
      const result = await handler(...args);
      console.log(`tool=${tool} result=ok duration=${elapsed()}`);
      return result;
    } catch (err) {
      const { category, message, ref } = classifyError(err);
      console.error(
        `tool=${tool} result=error:${category} duration=${elapsed()}${ref ? ` ref=${ref}` : ""}`,
        redact(err instanceof Error ? (err.stack ?? err.message) : String(err)),
      );
      return { isError: true, content: [{ type: "text", text: message }] };
    }
  };
}
