-- 0002_pgvector_embeddings.sql
-- Phase 0 · task 0.5 — enable pgvector and create the embeddings table used by RAG.
-- Vectors live in the SAME Postgres as the data (see docs/01-architecture.md) — no
-- separate vector store to keep in sync.

create extension if not exists vector;

-- Chunk-level embeddings for retrieval. Any content type can be embedded; the row
-- points back at its source via (source_type, source_id) so answers can cite origin.
--
-- NOTE ON DIMENSION: 1536 matches OpenAI text-embedding-3-small. If you change the
-- embedding model in packages/ai model routing, change this dimension in a new
-- migration to match — a vector column's dimension is fixed at creation.
create table public.embeddings (
  id            uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_type   text not null,               -- document | note | client | message | ...
  source_id     uuid not null,               -- the row this chunk was derived from
  chunk_index   int not null default 0,
  content       text not null,               -- the chunk's text
  embedding     vector(1536) not null,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index embeddings_org_idx    on public.embeddings (organization_id);
create index embeddings_source_idx on public.embeddings (source_type, source_id);

-- Approximate-nearest-neighbour index for cosine similarity. HNSW gives good
-- recall/latency without the ivfflat "must have data first" caveat.
create index embeddings_vector_idx
  on public.embeddings
  using hnsw (embedding vector_cosine_ops);

alter table public.embeddings enable row level security;

-- Readable only within the caller's organization.
create policy embeddings_select on public.embeddings
  for select using (public.is_org_member(organization_id));

-- Writes are performed by the ingestion job (service role), which bypasses RLS.

-- Convenience RPC: tenant-scoped similarity search. Callable from the app with the
-- user's JWT; the is_org_member check keeps it safe. Returns the closest chunks.
create or replace function public.match_embeddings(
  query_embedding vector(1536),
  match_org       uuid,
  match_count     int default 8,
  filter_source   text default null
)
returns table (
  id          uuid,
  source_type text,
  source_id   uuid,
  content     text,
  similarity  float
)
language sql
stable
as $$
  select
    e.id,
    e.source_type,
    e.source_id,
    e.content,
    1 - (e.embedding <=> query_embedding) as similarity
  from public.embeddings e
  where public.is_org_member(match_org)
    and e.organization_id = match_org
    and (filter_source is null or e.source_type = filter_source)
  order by e.embedding <=> query_embedding
  limit match_count;
$$;
