// Phase 6 · task 6.3 — Obsidian/markdown vault ingestion. Recursively reads every
// `context/**/*.md` file at the repo root (a sample Obsidian-style vault of agency-wide
// knowledge: brand voice, SOPs, ...) and upserts each one into `public.documents` with
// `source = 'obsidian'`, `client_id = null` (agency-wide, not tied to one client), and
// `metadata.path` recording the file's path relative to `context/` so re-ingesting a
// changed vault is idempotent instead of duplicating rows.
//
// TODO: embed on ingest once an embeddings key is configured — right now this only
// stores the raw text in documents.content; searchEverything (src/search.ts) does plain
// ILIKE search over it until pgvector embeddings (0002_pgvector_embeddings.sql) are wired
// in here too.
//
// Run: DATABASE_URL=postgres://... pnpm --filter @retentionos/db ingest:context

import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getDefaultOrganization } from '../src/index'
import { query, queryOne } from '../src/pool'

const here = dirname(fileURLToPath(import.meta.url))
const vaultDir = join(here, '..', '..', '..', 'context')

interface VaultFile {
  /** Path relative to `context/`, e.g. "brand-voice/acme-retention.md". Used as the
   *  idempotency key alongside (organization_id, source). */
  path: string
  absolutePath: string
}

async function walk(dir: string): Promise<VaultFile[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: VaultFile[] = []
  for (const entry of entries) {
    const absolutePath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walk(absolutePath)))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push({ path: relative(vaultDir, absolutePath), absolutePath })
    }
  }
  return files
}

/** First `# ` heading in the file, or the filename (without extension) if there is none. */
function titleFor(content: string, path: string): string {
  const heading = content.split('\n').find((line) => line.trimStart().startsWith('# '))
  if (heading) return heading.trimStart().replace(/^#\s+/, '').trim()
  const base = path.split('/').pop() ?? path
  return base.replace(/\.md$/, '')
}

interface DocumentIdRow {
  id: string
}

async function main() {
  const org = await getDefaultOrganization()
  if (!org) {
    console.error('No organization found — run `pnpm --filter @retentionos/db seed` first.')
    process.exit(1)
  }

  const files = await walk(vaultDir)
  if (files.length === 0) {
    console.log(`No markdown files found under ${vaultDir}.`)
    return
  }

  let created = 0
  let updated = 0

  for (const file of files) {
    const content = await readFile(file.absolutePath, 'utf8')
    const title = titleFor(content, file.path)
    const metadata = { path: file.path }

    const existing = await queryOne<DocumentIdRow>(
      `select id from public.documents
       where organization_id = $1 and source = 'obsidian' and metadata->>'path' = $2`,
      [org.id, file.path],
    )

    if (existing) {
      await query(
        `update public.documents
         set title = $3, content = $4, metadata = $5::jsonb
         where id = $1 and organization_id = $2`,
        [existing.id, org.id, title, content, JSON.stringify(metadata)],
      )
      updated++
      console.log(`  updated: ${file.path} ("${title}")`)
    } else {
      await query(
        `insert into public.documents (organization_id, client_id, title, source, content, metadata)
         values ($1, null, $2, 'obsidian', $3, $4::jsonb)`,
        [org.id, title, content, JSON.stringify(metadata)],
      )
      created++
      console.log(`  created: ${file.path} ("${title}")`)
    }
  }

  console.log(`Done. ${created} created, ${updated} updated (${files.length} file(s) in ${vaultDir}).`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
