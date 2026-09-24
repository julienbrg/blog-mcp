import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { latestPost, listPosts, upsertPost } from "./db.js";

function jsonResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export function registerTools(server: McpServer): void {
  server.registerTool(
    "posts_list",
    {
      title: "List posts",
      description: "List recent posts, optionally filtered by slug prefix. Ordered newest first.",
      inputSchema: {
        prefix: z.string().optional().describe("Only return posts whose slug starts with this prefix"),
        limit: z.number().int().min(1).max(100).default(20).describe("Max number of posts to return"),
      },
    },
    async ({ prefix, limit }) => {
      const rows = await listPosts(prefix, limit);
      return jsonResult(rows);
    },
  );

  server.registerTool(
    "posts_latest",
    {
      title: "Latest post matching a slug prefix",
      description: "Fetch the single most recent post whose slug starts with the given prefix.",
      inputSchema: {
        prefix: z.string().describe("Slug prefix to match, e.g. 'ethereum-daily-'"),
      },
    },
    async ({ prefix }) => {
      const row = await latestPost(prefix);
      return jsonResult(row ?? { found: false });
    },
  );

  server.registerTool(
    "posts_upsert",
    {
      title: "Insert or update a post",
      description: "Insert a new post or update an existing one, keyed by slug.",
      inputSchema: {
        slug: z.string().min(1),
        title: z.string().min(1),
        description: z.string().optional(),
        date: z.string().optional(),
        locale: z.string().optional(),
        image: z.string().optional(),
        image_alt: z.string().optional(),
        author: z.string().optional(),
        model: z.string().optional(),
        conversation: z.string().optional(),
        content: z.string().min(1),
        unlisted: z.boolean().default(false),
      },
    },
    async (input) => {
      const row = await upsertPost(input);
      return jsonResult(row);
    },
  );
}
