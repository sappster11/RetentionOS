// Client portal (docs/14) — capability-link trust model, same as public forms:
// an unguessable token stored in a "Portal token" field on the client's record.
// Server-side only. Whitelisted projections; nothing beyond the client's own
// documents and pending approvals ever leaves this module.

import { randomBytes } from 'node:crypto'
import {
  createField,
  describeTable,
  getRecordEnriched,
  getTableBySlug,
  queryRecords,
  updateRecord,
} from '@retentionos/engine'
import type { Actor, EngineField } from '@retentionos/engine'

export const PORTAL_TOKEN_FIELD = 'Portal token'

const fieldByName = (fields: EngineField[], name: string) => fields.find((f) => f.name === name)
const choiceId = (field: EngineField | undefined, name: string) =>
  (field?.options as { choices?: Array<{ id: string; name: string }> })?.choices?.find(
    (c) => c.name.toLowerCase() === name.toLowerCase(),
  )?.id

/** Ensure the Portal token field exists on Clients, then mint + store a fresh token
 * for the record (regenerating revokes any previously shared link). */
export async function enablePortal(
  orgId: string,
  clientRecordId: string,
  actor: Actor,
): Promise<{ token: string }> {
  const clients = await getTableBySlug(orgId, 'clients')
  if (!clients) throw new Error('No clients table — run seed:clienthub first.')
  const { fields } = await describeTable(orgId, clients.id)
  let tokenField = fieldByName(fields, PORTAL_TOKEN_FIELD)
  if (!tokenField) {
    tokenField = await createField(
      orgId,
      clients.id,
      { name: PORTAL_TOKEN_FIELD, type: 'text' },
      actor,
    )
  }
  const token = randomBytes(18).toString('base64url')
  await updateRecord(orgId, clients.id, clientRecordId, { [tokenField.id]: token }, actor)
  return { token }
}

export interface PortalData {
  clientName: string
  clientRecordId: string
  documents: Array<{ type: string | null; year: number | null; url: string | null; notes: string | null }>
  approvals: Array<{
    id: string
    title: string
    channel: string | null
    subject: string | null
    preview: string | null
    body: string | null
  }>
}

/** Resolve a portal token to its client + the whitelisted portal payload. Null = no match. */
export async function portalData(orgId: string, token: string): Promise<PortalData | null> {
  if (!token || token.length < 12) return null
  const clients = await getTableBySlug(orgId, 'clients')
  if (!clients) return null
  const { fields } = await describeTable(orgId, clients.id)
  const tokenField = fieldByName(fields, PORTAL_TOKEN_FIELD)
  if (!tokenField) return null

  const match = await queryRecords(orgId, clients.id, {
    filters: [{ fieldId: tokenField.id, op: 'eq', value: token }],
    limit: 2,
  })
  if (match.records.length !== 1) return null
  const client = match.records[0]!
  const primary = [...fields].sort((a, b) => a.position - b.position)[0]
  const clientName = String((primary && client.values[primary.id]) || 'Client')

  // Documents: client-docs rows whose Client link contains this record (link values are
  // id arrays at read time; the filter grammar doesn't cover links, so filter in JS).
  const documents: PortalData['documents'] = []
  const docsTable = await getTableBySlug(orgId, 'client-docs')
  if (docsTable) {
    const dd = await describeTable(orgId, docsTable.id)
    const linkF = dd.fields.find(
      (f) => f.type === 'linked_record' && f.options.linkedTableId === clients.id,
    )
    const typeF = fieldByName(dd.fields, 'Doc Type')
    const yearF = fieldByName(dd.fields, 'Year')
    const urlF = fieldByName(dd.fields, 'URL')
    const notesF = fieldByName(dd.fields, 'Notes')
    if (linkF) {
      const page = await queryRecords(orgId, docsTable.id, { limit: 500 })
      for (const r of page.records) {
        const links = (r.values[linkF.id] as string[] | undefined) ?? []
        if (!links.includes(client.id)) continue
        const typeChoice = (typeF?.options as { choices?: Array<{ id: string; name: string }> })
          ?.choices?.find((c) => c.id === r.values[typeF!.id])
        documents.push({
          type: typeChoice?.name ?? null,
          year: (yearF && (r.values[yearF.id] as number)) ?? null,
          url: (urlF && (r.values[urlF.id] as string)) ?? null,
          notes: (notesF && (r.values[notesF.id] as string)) ?? null,
        })
      }
    }
  }

  // Approvals: copy drafts linked to this client with Status = In Review.
  const approvals: PortalData['approvals'] = []
  const drafts = await getTableBySlug(orgId, 'copy-drafts')
  if (drafts) {
    const dd = await describeTable(orgId, drafts.id)
    const linkF = dd.fields.find(
      (f) => f.type === 'linked_record' && f.options.linkedTableId === clients.id,
    )
    const statusF = fieldByName(dd.fields, 'Status')
    const inReview = choiceId(statusF, 'In Review')
    if (linkF && statusF && inReview) {
      const page = await queryRecords(orgId, drafts.id, {
        filters: [{ fieldId: statusF.id, op: 'eq', value: inReview }],
        limit: 200,
      })
      const titleF = fieldByName(dd.fields, 'Title')
      const channelF = fieldByName(dd.fields, 'Channel')
      const subjF = fieldByName(dd.fields, 'Subject line')
      const prevF = fieldByName(dd.fields, 'Preview text')
      const bodyF = fieldByName(dd.fields, 'Body')
      for (const r of page.records) {
        const links = (r.values[linkF.id] as string[] | undefined) ?? []
        if (!links.includes(client.id)) continue
        const channelChoice = (channelF?.options as { choices?: Array<{ id: string; name: string }> })
          ?.choices?.find((c) => c.id === r.values[channelF!.id])
        approvals.push({
          id: r.id,
          title: String((titleF && r.values[titleF.id]) || 'Untitled'),
          channel: channelChoice?.name ?? null,
          subject: (subjF && (r.values[subjF.id] as string)) ?? null,
          preview: (prevF && (r.values[prevF.id] as string)) ?? null,
          body: (bodyF && (r.values[bodyF.id] as string)) ?? null,
        })
      }
    }
  }

  return { clientName, clientRecordId: client.id, documents, approvals }
}

/** Portal actions: approve a draft, or request changes with a comment. The draft must
 * belong to the token's client and still be In Review — verified via portalData. */
export async function portalAction(
  orgId: string,
  token: string,
  draftId: string,
  action: 'approve' | 'request_changes',
  comment?: string,
): Promise<{ ok: true } | null> {
  const data = await portalData(orgId, token)
  if (!data) return null
  if (!data.approvals.some((a) => a.id === draftId)) return null

  const drafts = await getTableBySlug(orgId, 'copy-drafts')
  if (!drafts) return null
  const { fields } = await describeTable(orgId, drafts.id)
  const statusF = fieldByName(fields, 'Status')
  const notesF = fieldByName(fields, 'Notes')
  const actor: Actor = { type: 'api', id: `portal:${data.clientRecordId}` }

  if (action === 'approve') {
    const approved = choiceId(statusF, 'Approved')
    if (!statusF || !approved) return null
    await updateRecord(orgId, drafts.id, draftId, { [statusF.id]: approved }, actor)
    return { ok: true }
  }

  // request_changes: stamp the comment into Notes, status stays In Review.
  if (!notesF) return null
  const rec = await getRecordEnriched(orgId, drafts.id, draftId)
  const existing = (rec?.values[notesF.id] as string) || ''
  const stamp = `[Client, ${new Date().toISOString().slice(0, 10)}] ${String(comment ?? '').slice(0, 2000)}`
  await updateRecord(
    orgId,
    drafts.id,
    draftId,
    { [notesF.id]: existing ? `${existing}\n\n${stamp}` : stamp },
    actor,
  )
  return { ok: true }
}
