// Shared Postgres connection pool + tiny query helpers. Used by the web app AND the MCP
// servers, so there is ONE data-access layer. Reads DATABASE_URL (local Postgres in dev,
// the Supabase connection string in prod — same code either way).
import pg from 'pg'

// pg returns DATE / TIMESTAMP / TIMESTAMPTZ columns as JS Date objects by default, which
// contradicts our row types (all declared as `string`) and silently breaks string operations
// on date fields. Parse them as raw strings so the declared types are honest everywhere.
// (numeric/bigint are already returned as strings by pg, which is why those types are `string` too.)
pg.types.setTypeParser(1082, (v) => v) // date
pg.types.setTypeParser(1114, (v) => v) // timestamp (without time zone)
pg.types.setTypeParser(1184, (v) => v) // timestamptz

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
