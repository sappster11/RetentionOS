-- 0013 — Retention bridge: connect engine Clients (engine_records) to the parked
-- pre-pivot analytics spine (public.clients + client_* tables from 0003/0004).
--
-- The analytics tables key on public.clients(id). Engine clients are engine_records
-- rows. One nullable, unique bridge column links them: an analytics client row is
-- provisioned lazily (first visit to the Retention view / first sync) per engine
-- client record. docs/12 priority 1.

alter table public.clients
  add column if not exists engine_record_id uuid unique references public.engine_records(id) on delete set null;

create index if not exists clients_engine_record_idx on public.clients (engine_record_id);
