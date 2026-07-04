// Minimal forward-only migration runner. Applies packages/db/migrations/*.sql in
// filename order inside a transaction each, and records applied files in
// public.schema_migrations so re-runs are idempotent.
//
// Usage: DATABASE_URL=postgres://... node scripts/migrate.mjs
// (DATABASE_URL comes from your Supabase project — see .env.example.)

import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '..', 'migrations')

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is not set. See .env.example.')
  process.exit(1)
}

const client = new pg.Client({ connectionString })
await client.connect()

try {
  await client.query(`
    create table if not exists public.schema_migrations (
      filename    text primary key,
      applied_at  timestamptz not null default now()
    );
  `)

  const applied = new Set(
    (await client.query('select filename from public.schema_migrations')).rows.map(
      (r) => r.filename,
    ),
  )

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort()

  let ran = 0
  for (const file of files) {
    if (applied.has(file)) continue
    const sql = await readFile(join(migrationsDir, file), 'utf8')
    process.stdout.write(`applying ${file} ... `)
    await client.query('begin')
    try {
      await client.query(sql)
      await client.query('insert into public.schema_migrations (filename) values ($1)', [file])
      await client.query('commit')
      console.log('ok')
      ran++
    } catch (err) {
      await client.query('rollback')
      console.log('FAILED')
      throw err
    }
  }

  console.log(ran === 0 ? 'Already up to date.' : `Applied ${ran} migration(s).`)
} finally {
  await client.end()
}
