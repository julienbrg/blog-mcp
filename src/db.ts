import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
});

export interface Post {
  slug: string;
  title: string;
  description: string | null;
  date: string | null;
  locale: string | null;
  image: string | null;
  image_alt: string | null;
  author: string | null;
  model: string | null;
  conversation: string | null;
  content: string;
  created_at: string;
  unlisted: boolean;
}

const POST_COLUMNS = `
  slug, title, description, date, locale, image, image_alt,
  author, model, conversation, content, created_at, unlisted
`;

export async function listPosts(prefix: string | undefined, limit: number): Promise<Post[]> {
  const { rows } = await pool.query<Post>(
    `select ${POST_COLUMNS}
     from posts
     where $1::text is null or slug like $1 || '%'
     order by created_at desc
     limit $2`,
    [prefix ?? null, limit],
  );
  return rows;
}

export async function latestPost(prefix: string): Promise<Post | null> {
  const { rows } = await pool.query<Post>(
    `select ${POST_COLUMNS}
     from posts
     where slug like $1 || '%'
     order by created_at desc
     limit 1`,
    [prefix],
  );
  return rows[0] ?? null;
}

export interface UpsertPostInput {
  slug: string;
  title: string;
  description?: string;
  date?: string;
  locale?: string;
  image?: string;
  image_alt?: string;
  author?: string;
  model?: string;
  conversation?: string;
  content: string;
  unlisted?: boolean;
}

export async function upsertPost(input: UpsertPostInput): Promise<Post> {
  const { rows } = await pool.query<Post>(
    `insert into posts (slug, title, description, date, locale, image, image_alt, author, model, conversation, content, unlisted)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (slug) do update set
       title = excluded.title,
       description = excluded.description,
       date = excluded.date,
       locale = excluded.locale,
       image = excluded.image,
       image_alt = excluded.image_alt,
       author = excluded.author,
       model = excluded.model,
       conversation = excluded.conversation,
       content = excluded.content,
       unlisted = excluded.unlisted
     returning ${POST_COLUMNS}`,
    [
      input.slug,
      input.title,
      input.description ?? null,
      input.date ?? null,
      input.locale ?? null,
      input.image ?? null,
      input.image_alt ?? null,
      input.author ?? null,
      input.model ?? null,
      input.conversation ?? null,
      input.content,
      input.unlisted ?? false,
    ],
  );
  return rows[0]!;
}
