// Vitest global setup — mirrors packages/engine/test/globalSetup.ts: boot an embedded
// Postgres, apply the Supabase shim + the engine migrations, expose DATABASE_URL.
// Own port (54331) so this suite never collides with the engine suite's instance.
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

const ENGINE_MIGRATIONS = ['0001_foundations.sql', '0009_engine.sql', '0010_engine_links.sql']

let pgServer: EmbeddedPostgres | null = null
let dataDir: string | null = null

export async function setup(): Promise<void> {
  dataDir = await mkdtemp(join(tmpdir(), 'ros-mcp-engine-pg-'))
  const port = 54331
  pgServer = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'ros',
    password: 'ros',
    port,
    persistent: false,
  })
  await pgServer.initialise()
  await pgServer.start()

  // Everything after start() is wrapped so a failed migration (or createDatabase) stops
  // the embedded server before rethrowing — otherwise a crashed setup leaks a process
  // holding the port and every subsequent run fails to bind.
  try {
    await pgServer.createDatabase('retentionos')

    const connectionString = `postgresql://ros:ros@127.0.0.1:${port}/retentionos`
    process.env.DATABASE_URL = connectionString

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
  } catch (error) {
    await pgServer.stop().catch(() => {})
    throw error
  }
}

export async function teardown(): Promise<void> {
  if (pgServer) await pgServer.stop()
  if (dataDir) await rm(dataDir, { recursive: true, force: true })
}
