import { checkDatabase } from "./db.js";
import { classifyError, redact } from "./errors.js";
import { createApp } from "./server.js";

const PORT = Number(process.env.PORT ?? 3939);
const HOST = process.env.HOST ?? "127.0.0.1";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
if (!process.env.MCP_BEARER_TOKEN) {
  console.error("MCP_BEARER_TOKEN is not set");
  process.exit(1);
}

try {
  await checkDatabase();
} catch (err) {
  const { category } = classifyError(err);
  const reason = redact(err instanceof Error ? err.message : String(err));
  console.error(`Database check failed (${category}): ${reason}`);
  process.exit(1);
}

const app = createApp();

app.listen(PORT, HOST, () => {
  console.log(`blog-mcp listening on http://${HOST}:${PORT}/mcp`);
});
