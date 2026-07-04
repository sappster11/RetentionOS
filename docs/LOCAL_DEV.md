# Local Development

RetentionOS runs against **plain Postgres locally** — no Supabase project and no API keys needed to
build and verify the infrastructure + UI. Because Supabase is managed Postgres, the exact same
migrations and app code point at a Supabase `DATABASE_URL` later with zero changes.

## Prerequisites
- Node 22+, pnpm 10+
- PostgreSQL 16 with the `pgvector` extension

## One-time database setup

```bash
# 1. Install pgvector (Debian/Ubuntu)
apt-get install -y postgresql-16-pgvector

# 2. Start the cluster
pg_ctlcluster 16 main start        # or: service postgresql start

# 3. Create a dev role + database
su postgres -c "psql -c \"create role ros login password 'ros' superuser;\""
su postgres -c "psql -c \"create database retentionos owner ros;\""
```

Connection string for everything below:

```bash
export DATABASE_URL="postgresql://ros:ros@127.0.0.1:5432/retentionos"
```

## Apply schema + seed

```bash
# Local-only shim: provides Supabase's auth.users / auth.uid() on plain Postgres.
# (Skip this step on a real Supabase database — it already has them.)
PGPASSWORD=ros psql -h 127.0.0.1 -U ros -d retentionos -f packages/db/local/000_supabase_shim.sql

# Apply migrations (idempotent; tracked in public.schema_migrations)
pnpm --filter @retentionos/db migrate

# Seed demo data (1 org, 3 clients with contacts/channels/activity)
pnpm --filter @retentionos/db seed
```

## Run the app

```bash
# apps/web/.env.local should contain DATABASE_URL (gitignored)
pnpm --filter @retentionos/web dev      # http://localhost:3000 → redirects to /clients
```

## Run the CRM MCP server

```bash
pnpm --filter @retentionos/mcp-crm start   # stdio; see packages/mcp-crm/README.md
```

## Moving to Supabase (later)
1. Create the Supabase project; grab its `DATABASE_URL` (Settings → Database).
2. Point `DATABASE_URL` at it and run `pnpm --filter @retentionos/db migrate` (skip the shim).
3. Wire Supabase Auth (Phase 0 · task 0.3) so `auth.uid()` and RLS enforce tenancy for real.

## Notes
- This container is ephemeral — if it restarts, re-run the setup + migrate + seed. Nothing here is
  precious; the migrations and seed are the source of truth.
- Local dev connects as a superuser (`ros`), which **bypasses RLS**. RLS is still defined in the
  migrations and takes effect once you connect as a normal authed user (i.e. on Supabase with Auth).
