# @retentionos/db

The owned data plane: Postgres (Supabase) migrations + generated types.

## Migrations

Forward-only SQL in `migrations/`, applied in filename order. Each is wrapped in a transaction and
recorded in `public.schema_migrations`, so `migrate` is idempotent.

- `0001_foundations.sql` — `organizations`, `users`, `memberships`, the `updated_at` trigger, the
  `is_org_member()` tenancy helper, and RLS.
- `0002_pgvector_embeddings.sql` — `vector` extension, `embeddings` table + HNSW index, and the
  tenant-scoped `match_embeddings()` RAG search function.

### Apply them

```bash
# DATABASE_URL from your Supabase project (Settings → Database → Connection string)
export DATABASE_URL=postgres://...
pnpm --filter @retentionos/db migrate
```

Or apply via the Supabase CLI / SQL editor by pasting each file in order.

### Rules (see docs/07-working-agreement.md)
- **Never edit a shipped migration** — add a new numbered file.
- **RLS goes in the same migration** that creates a client-data table.

## Generated types

After the schema is live, generate TypeScript types for the app:

```bash
supabase link --project-ref YOUR_REF
pnpm --filter @retentionos/db gen-types   # → src/types.gen.ts
```
