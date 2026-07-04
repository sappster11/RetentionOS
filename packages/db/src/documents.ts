import { query, queryOne } from './pool'
import type { Document } from './types'

const DOCUMENT_COLUMNS = `
  id, organization_id, client_id, title, source, source_ref, storage_path,
  content, metadata, created_at, updated_at
`

export async function listDocuments(orgId: string, clientId: string): Promise<Document[]> {
  return query<Document>(
    `select ${DOCUMENT_COLUMNS} from public.documents
     where organization_id = $1 and client_id = $2
     order by created_at desc`,
    [orgId, clientId],
  )
}

export interface CreateDocumentInput {
  client_id?: string
  title: string
  source?: string
  content?: string
}

export async function createDocument(
  orgId: string,
  input: CreateDocumentInput,
): Promise<Document> {
  const row = await queryOne<Document>(
    `insert into public.documents (organization_id, client_id, title, source, content)
     values ($1, $2, $3, coalesce($4, 'upload'), $5)
     returning ${DOCUMENT_COLUMNS}`,
    [orgId, input.client_id ?? null, input.title, input.source ?? null, input.content ?? null],
  )
  if (!row) throw new Error('Failed to create document')
  return row
}
