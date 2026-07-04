import { query, queryOne } from './pool'
import type { Contact } from './types'

const CONTACT_COLUMNS = `
  id, organization_id, client_id, full_name, email, phone, title, role_type,
  is_primary, timezone, metadata, created_at, updated_at
`

export async function listContacts(orgId: string, clientId: string): Promise<Contact[]> {
  return query<Contact>(
    `select ${CONTACT_COLUMNS} from public.contacts
     where organization_id = $1 and client_id = $2
     order by is_primary desc, full_name asc`,
    [orgId, clientId],
  )
}

export interface CreateContactInput {
  client_id: string
  full_name: string
  email?: string
  phone?: string
  title?: string
  role_type?: string
  is_primary?: boolean
}

export async function createContact(
  orgId: string,
  input: CreateContactInput,
): Promise<Contact> {
  const row = await queryOne<Contact>(
    `insert into public.contacts
       (organization_id, client_id, full_name, email, phone, title, role_type, is_primary)
     values ($1, $2, $3, $4, $5, $6, $7, coalesce($8, false))
     returning ${CONTACT_COLUMNS}`,
    [
      orgId,
      input.client_id,
      input.full_name,
      input.email ?? null,
      input.phone ?? null,
      input.title ?? null,
      input.role_type ?? null,
      input.is_primary ?? null,
    ],
  )
  if (!row) throw new Error('Failed to create contact')
  return row
}
