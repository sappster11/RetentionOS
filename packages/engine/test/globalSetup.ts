// Vitest global setup: boot an embedded Postgres, apply the migrations the engine needs
// (Supabase shim + 0001 foundations + 0009 engine core + 0010 engine links), and expose
// its connection string as DATABASE_URL for the test run. Teardown stops the server.
//
// This keeps `pnpm --filter @retentionos/engine test` self-contained: no external Postgres,
// no manual `migrate`. The same migration files the app runs are applied here verbatim.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'
import { getPool } from '@retentionos/db'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const migrationsDir = join(repoRoot, 'packages', 'db', 'migrations')
const shimPath = join(repoRoot, 'packages', 'db', 'local', '000_supabase_shim.sql')

// The subset of migrations the engine service layer touches. (0002 pgvector and 0003–0008
// are unrelated to the meta-schema engine and are skipped to keep boot fast.)
const ENGINE_MIGRATIONS = ['0001_foundations.sql', '0009_engine.sql', '0010_engine_links.sql']

let pgServer: EmbeddedPostgres | null = null
let dataDir: string | null = null

export async function setup(): Promise<void> {
  dataDir = await mkdtemp(join(tmpdir(), 'ros-engine-pg-'))
  const port = 54329
  pgServer = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'ros',
    password: 'ros',
    port,
    persistent: false,
  })
  await pgServer.initialise()
  await pgServer.start()
  await pgServer.createDatabase('retentionos')

  const connectionString = `postgresql://ros:ros@127.0.0.1:${port}/retentionos`
  process.env.DATABASE_URL = connectionString

  // Apply the shim + engine migrations through the shared db pool (already an engine dep,
  // so no direct `pg` dependency is needed here).
  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query(await readFile(shimPath, 'utf8'))
    for (const file of ENGINE_MIGRATIONS) {
      await client.query(await readFile(join(migrationsDir, file), 'utf8'))
    }
  } finally {
    client.release()
    await pool.end()
  }
}

export async function teardown(): Promise<void> {
  if (pgServer) await pgServer.stop()
  if (dataDir) await rm(dataDir, { recursive: true, force: true })
}
