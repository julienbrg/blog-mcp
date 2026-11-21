import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { hostHeaderValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import express from "express";
import { requireBearerToken } from "./auth.js";
import { pool } from "./db.js";
import { classifyError } from "./errors.js";
import { registerTools } from "./tools.js";

function buildServer(): McpServer {
  const server = new McpServer({ name: "blog-mcp", version: "1.0.0" });
  registerTools(server);
  return server;
}

// Hostnames the reverse proxy is allowed to forward as `Host`. Defaults to
// localhost-only; set ALLOWED_HOSTS (comma-separated) to the public hostname
// your proxy forwards, e.g. "mcp.w3hc.org".
const allowedHosts = (process.env.ALLOWED_HOSTS ?? "localhost,127.0.0.1,[::1]")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

export function createApp() {
  // Built by hand rather than with the SDK's createMcpExpressApp, whose
  // express.json() is stuck at Express's 100 KB default. Same order: the Host
  // check runs first, so a disallowed Host gets 403 before the body is read.
  // 1 MB matches nginx's default client_max_body_size.
  const app = express();
  app.use(hostHeaderValidation(allowedHosts));
  app.use(express.json({ limit: "1mb" }));

  // Stateless: every request gets a fresh server + transport pair, used once
  // and torn down. No session state is kept between calls.
  app.post("/mcp", requireBearerToken, async (req, res) => {
    const server = buildServer();
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // Unauthenticated, but nginx only forwards `= /mcp`, so this is reachable
  // from the box itself only.
  app.get("/health", async (_req, res) => {
    try {
      await pool.query("select 1");
      res.json({ db: "ok" });
    } catch (err) {
      res.status(503).json({ db: "error", reason: classifyError(err).category });
    }
  });

  const methodNotAllowed = (_req: import("express").Request, res: import("express").Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. This server is stateless: use POST." },
      id: null,
    });
  };
  app.get("/mcp", requireBearerToken, methodNotAllowed);
  app.delete("/mcp", requireBearerToken, methodNotAllowed);

  return app;
}
