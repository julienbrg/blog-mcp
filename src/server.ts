import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { requireBearerToken } from "./auth.js";
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
  const app = createMcpExpressApp({ allowedHosts });

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
