// Shared Postgres connection pool + tiny query helpers. Used by the web app AND the MCP
// servers, so there is ONE data-access layer. Reads DATABASE_URL (local Postgres in dev,
// the Supabase connection string in prod — same code either way).
import pg from 'pg'

let pool: pg.Pool | null = null

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set. See .env.example / docs/LOCAL_DEV.md.')
    }
    pool = new pg.Pool({ connectionString, max: 10 })
  }
  return pool
}

export async function query<T>(text: string, params?: unknown[]): Promise<T[]> {
  const result = await getPool().query(text, params as unknown[])
  return result.rows as T[]
}

export async function queryOne<T>(text: string, params?: unknown[]): Promise<T | null> {
  const rows = await query<T>(text, params)
  return rows[0] ?? null
}
