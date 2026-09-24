# Database requirements

What this server needs from the Postgres instance it points at, so a fresh
instance can be provisioned correctly. This documents requirements, it is
not a migration tool — there's no schema-management code in this project.

## Table: `posts`

```sql
create table posts (
  slug         text primary key,
  title        text not null,
  description  text,
  date         text,
  locale       text,
  image        text,
  image_alt    text,
  author       text,
  model        text,
  conversation text,
  content      text not null,
  created_at   timestamptz not null default now(),
  unlisted     boolean not null default false
);
```

This matches the existing `posts` table on `db.w3hc.org` (inspected with
`psql \d posts`). `slug` is the primary key: `posts_upsert` relies on
`on conflict (slug) do update` (see [`src/db.ts`](../src/db.ts)).

`date`, `locale`, `model`, `conversation`, etc. are plain `text`, not
enums/timestamps — this project doesn't validate their format beyond
non-empty strings on the required fields (see the Zod schemas in
[`src/tools.ts`](../src/tools.ts)).

## Role privileges

The server connects as the `website` role and only ever runs `SELECT`,
`INSERT`, and `UPDATE` against `posts` (see `listPosts`, `latestPost`,
`upsertPost` in [`src/db.ts`](../src/db.ts)). No `DELETE`, no DDL, no access
to any other table. Minimum grant for a fresh instance:

```sql
grant select, insert, update on posts to website;
```

Don't grant more than this — the tools deliberately expose no delete or raw
SQL path (see the Security notes in the [README](../README.md)), and the
role shouldn't be able to do more than the tools allow either.

## Connection

`sslmode=verify-full` is required in `DATABASE_URL`. Do **not** add
`sslrootcert=system`: that's a libpq-only value (works with `psql`) that
makes node-postgres try to read a literal file named `system` and fail.
Plain `sslmode=verify-full` gives correct full chain + hostname verification
under Node, using its bundled CA store — this was verified against
`db.w3hc.org` directly (see the README's local development section).

The connection pool is small and fixed (`max: 3` in `src/db.ts`) — this
server is not expected to need more than a handful of concurrent
connections, and the `website` role's existing `pg_hba`/connection-limit
restrictions are reused as-is, not widened for this server.
