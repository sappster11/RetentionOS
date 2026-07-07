// Lead → Client conversion (docs/09 "Sequenced delivery" item 2, docs/10 Client Hub).
// One engine function, convertLead, that turns a Closed (Won) lead into a Client Hub
// client: creates the Client record, re-links the lead's Contacts to the new client
// (they KEEP their Lead link — that's why Contacts is a shared table), materializes
// Engagements from the linked Agreement's per-service economics, and logs a "Converted
// to client" Activity on the lead. Every write goes through the existing engine service
// functions (createRecord/updateRecord) with the caller's actor, so revisions attribute
// correctly — there is no second write path and no raw SQL here.
//
// Atomicity: the engine's record writes each own their transaction (they acquire their
// own pool client), so a single cross-record transaction is not available without
// re-plumbing the service layer. Instead convertLead is validate-then-write: ALL reads,
// lookups, and mapping decisions happen before the first write, so every caller-fixable
// problem (wrong stage, missing seed, missing fields) aborts with zero writes. If a
// write then fails mid-sequence (infrastructure errors only, at that point), the
// already-applied writes are compensated in reverse order (created records deleted,
// contact links restored) on a best-effort basis before the error is rethrown.
//
// Idempotency: if a Clients record already exists whose primary "Client" name equals
// the lead's Company (case-insensitive), no duplicate is created — contacts are still
// (idempotently) linked to the existing client, but engagements and the conversion
// activity are NOT re-created, and the result says so in `skipped`.

import {
  createRecord,
  deleteRecords,
  getRecordEnriched,
  getTableBySlug,
  listFields,
  queryRecords,
  updateRecord,
} from './engine'
import { EngineError } from './types'
import type { Actor, EngineField, EngineTable, FieldType } from './types'

export interface ConvertLeadResult {
  /** The client the lead now belongs to — newly created, or the pre-existing match. */
  clientRecordId: string
  /** False when an existing same-named client was reused (see `skipped` for why). */
  clientCreated: boolean
  /** Where the client record lives (for callers that want to link to it). */
  clientTableId: string
  clientTableSlug: string
  created: {
    /** 1 when a new client record was created, 0 when an existing one was reused. */
    client: number
    /** Contacts newly linked to the client (already-linked contacts don't count). */
    contactsRelinked: number
    engagements: number
    /** 1 when the "Converted to client" activity was logged. */
    activities: number
  }
  /** Human-readable reasons for everything the conversion chose not to do. */
  skipped: string[]
}

const STAGE_CLOSED_WON = 'Closed (Won)'

/** Find a field by exact name (and type, when given). */
function fieldByName(
  fields: EngineField[],
  name: string,
  type?: FieldType,
): EngineField | undefined {
  return fields.find((f) => f.name === name && (type === undefined || f.type === type))
}

/** Same, but the field is part of the seed contract — missing means bad setup. */
function requireField(
  fields: EngineField[],
  tableName: string,
  name: string,
  type: FieldType,
): EngineField {
  const f = fieldByName(fields, name, type)
  if (!f) {
    throw new EngineError(
      `The ${tableName} table has no ${type} field named "${name}" — ` +
        `re-run the seeds (seed:salescrm / seed:clienthub) to restore the expected schema.`,
      'bad_input',
    )
  }
  return f
}

/** Case-insensitive choice lookup by display name on a select field. */
function choiceByName(field: EngineField, name: string) {
  const lowered = name.trim().toLowerCase()
  return (field.options.choices ?? []).find((c) => c.name.trim().toLowerCase() === lowered)
}

function choiceName(field: EngineField, id: unknown): string | undefined {
  return (field.options.choices ?? []).find((c) => c.id === id)?.name
}

/** The stored id array of a linked_record field on an enriched record. */
function linkIds(values: Record<string, unknown>, field: EngineField | undefined): string[] {
  if (!field) return []
  const v = values[field.id]
  return Array.isArray(v) ? (v as string[]) : []
}

/** The first linked_record field on `fields` pointing at `targetTableId` (name-agnostic —
 * seeds rename auto-inverses, so target identity is the stable thing). */
function linkFieldTo(fields: EngineField[], targetTableId: string): EngineField | undefined {
  return fields.find((f) => f.type === 'linked_record' && f.options.linkedTableId === targetTableId)
}

async function requireTable(orgId: string, slug: string, hint: string): Promise<EngineTable> {
  const t = await getTableBySlug(orgId, slug)
  if (!t) throw new EngineError(`No "${slug}" table in this organization — ${hint}`, 'bad_input')
  return t
}

/** A fully-decided engagement create, computed in the read phase. The Client link is
 * filled in the write phase (the client record id doesn't exist yet). */
interface EngagementPlan {
  values: Record<string, unknown>
  clientLinkFieldId: string
}

/** A contact whose Client link needs the new client appended (read-phase snapshot). */
interface ContactPlan {
  contactId: string
  existingClientIds: string[]
}

export async function convertLead(
  orgId: string,
  leadRecordId: string,
  actor: Actor,
): Promise<ConvertLeadResult> {
  const skipped: string[] = []

  // -------------------------------------------------------------------------
  // READ PHASE — resolve every table/field/record and decide every write up
  // front. Nothing below this comment writes; every caller-fixable problem
  // aborts here with zero side effects.
  // -------------------------------------------------------------------------

  // The lead. convertLead only ever reads the record out of the Leads table, so a
  // record id from any other table simply isn't found — that IS the "is it a lead?" check.
  const leadsTable = await requireTable(
    orgId,
    'leads',
    'run the Sales CRM seed (seed:salescrm) first.',
  )
  const leadFields = await listFields(orgId, leadsTable.id)
  const lead = await getRecordEnriched(orgId, leadsTable.id, leadRecordId)
  if (!lead) {
    throw new EngineError(
      `No record ${leadRecordId} in the Leads table — only Leads rows can be converted.`,
      'not_found',
    )
  }

  const stageF = requireField(leadFields, 'Leads', 'Stage', 'single_select')
  const companyF = requireField(leadFields, 'Leads', 'Company', 'text')

  const currentStage = choiceName(stageF, lead.values[stageF.id])
  if (currentStage !== STAGE_CLOSED_WON) {
    throw new EngineError(
      `Only leads with Stage "${STAGE_CLOSED_WON}" can be converted — this lead's stage is ` +
        `${currentStage ? `"${currentStage}"` : 'not set'}. Close the deal first.`,
      'bad_input',
    )
  }

  const companyRaw = lead.values[companyF.id]
  const company = typeof companyRaw === 'string' ? companyRaw.trim() : ''
  if (!company) {
    throw new EngineError(
      'This lead has no Company name — set Company before converting (it becomes the Client name).',
      'bad_input',
    )
  }

  // The Client Hub side.
  const clientsTable = await requireTable(
    orgId,
    'clients',
    'run the Client Hub seed (seed:clienthub) before converting leads.',
  )
  const clientFields = await listFields(orgId, clientsTable.id)
  const clientNameF = requireField(clientFields, 'Clients', 'Client', 'text')
  const clientStatusF = requireField(clientFields, 'Clients', 'Status', 'single_select')
  const onboarding = choiceByName(clientStatusF, 'Onboarding')
  if (!onboarding) {
    throw new EngineError(
      'The Clients Status field has no "Onboarding" choice — restore it before converting.',
      'bad_input',
    )
  }

  // Idempotency: an existing client with the same name (case-insensitive) is reused.
  // `contains` over-matches (ilike), so the exact-name check happens here in JS.
  const clientPage = await queryRecords(orgId, clientsTable.id, {
    filters: [{ fieldId: clientNameF.id, op: 'contains', value: company }],
    limit: 500,
  })
  const loweredCompany = company.toLowerCase()
  const existingClient = clientPage.records.find(
    (r) => String(r.values[clientNameF.id] ?? '').trim().toLowerCase() === loweredCompany,
  )

  // Client values: name, domain, status, services (mapped BY CHOICE NAME).
  const clientValues: Record<string, unknown> = {
    [clientNameF.id]: company,
    [clientStatusF.id]: onboarding.id,
  }
  const leadDomainF = fieldByName(leadFields, 'Domain', 'url')
  const clientDomainF = fieldByName(clientFields, 'Domain', 'url')
  const domain = leadDomainF ? lead.values[leadDomainF.id] : null
  if (domain != null && domain !== '') {
    if (clientDomainF) clientValues[clientDomainF.id] = domain
    else skipped.push('Clients has no "Domain" field — the lead\'s domain was not carried over.')
  }

  const interestedF = fieldByName(leadFields, 'Interested Services', 'multi_select')
  const clientServicesF = fieldByName(clientFields, 'Services', 'multi_select')
  const interestedIds = interestedF ? linkArrayOfChoiceIds(lead.values[interestedF.id]) : []
  if (interestedIds.length > 0) {
    if (interestedF && clientServicesF) {
      const mappedIds: string[] = []
      for (const id of interestedIds) {
        const name = choiceName(interestedF, id)
        const target = name ? choiceByName(clientServicesF, name) : undefined
        if (target) mappedIds.push(target.id)
        else {
          skipped.push(
            `Interested service "${name ?? id}" has no matching choice on Clients "Services" — skipped.`,
          )
        }
      }
      if (mappedIds.length > 0) clientValues[clientServicesF.id] = mappedIds
    } else {
      skipped.push(
        'Interested Services could not be carried over (missing the Leads "Interested Services" ' +
          'or Clients "Services" multi-select).',
      )
    }
  }

  // Contacts: re-link every lead contact to the client (they keep their Lead link —
  // the Client link is a separate field on the shared Contacts table).
  const contactsTable = await getTableBySlug(orgId, 'contacts')
  const contactsLinkF = contactsTable ? linkFieldTo(leadFields, contactsTable.id) : undefined
  const contactIds = linkIds(lead.values, contactsLinkF)
  const contactPlans: ContactPlan[] = []
  let clientLinkOnContacts: EngineField | undefined
  if (contactIds.length > 0 && contactsTable) {
    const contactFields = await listFields(orgId, contactsTable.id)
    clientLinkOnContacts =
      contactFields.find(
        (f) =>
          f.type === 'linked_record' &&
          f.options.linkedTableId === clientsTable.id &&
          f.name === 'Client',
      ) ?? linkFieldTo(contactFields, clientsTable.id)
    if (!clientLinkOnContacts) {
      skipped.push(
        'Contacts has no Client link field (Client Hub extension missing) — contacts were not re-linked.',
      )
    } else {
      for (const contactId of contactIds) {
        const contact = await getRecordEnriched(orgId, contactsTable.id, contactId)
        if (!contact) continue
        contactPlans.push({
          contactId,
          existingClientIds: linkIds(contact.values, clientLinkOnContacts),
        })
      }
    }
  }

  // Engagements from the linked Agreement's per-service economics.
  const agreementsTable = await getTableBySlug(orgId, 'agreements')
  const engagementsTable = await getTableBySlug(orgId, 'engagements')
  const agreementLinkF = agreementsTable ? linkFieldTo(leadFields, agreementsTable.id) : undefined
  const agreementIds = linkIds(lead.values, agreementLinkF)
  const engagementPlans: EngagementPlan[] = []
  if (agreementIds.length === 0) {
    skipped.push('No agreement linked to this lead — no engagements created.')
  } else if (!engagementsTable) {
    skipped.push('No "engagements" table (Client Hub seed missing) — no engagements created.')
  } else {
    const engagementFields = await listFields(orgId, engagementsTable.id)
    const engClientLinkF = linkFieldTo(engagementFields, clientsTable.id)
    const engServiceF = fieldByName(engagementFields, 'Service', 'single_select')
    const engStartF = fieldByName(engagementFields, 'Start', 'date')
    const engFeeF = fieldByName(engagementFields, 'Monthly Fee', 'currency')
    const engNotesF = fieldByName(engagementFields, 'Notes', 'long_text')
    if (!engClientLinkF || !engServiceF) {
      skipped.push(
        'Engagements is missing its Client link or "Service" field — no engagements created.',
      )
    } else {
      const agreementFields = await listFields(orgId, agreementsTable!.id)
      const agrServicesF = fieldByName(agreementFields, 'Services', 'multi_select')
      const agrStartF = fieldByName(agreementFields, 'Start Date', 'date')
      const agrMinTermF = fieldByName(agreementFields, 'Minimum Term', 'number')
      const agrPaidFeeF = fieldByName(agreementFields, 'Paid Fee Base', 'currency')
      const agrEmailFeeF = fieldByName(agreementFields, 'Email Fee', 'currency')
      const agrTieredNotesF = fieldByName(agreementFields, 'Tiered Pricing Notes', 'long_text')

      for (const agreementId of agreementIds) {
        const agreement = await getRecordEnriched(orgId, agreementsTable!.id, agreementId)
        if (!agreement) continue
        const serviceIds = agrServicesF ? linkArrayOfChoiceIds(agreement.values[agrServicesF.id]) : []
        if (serviceIds.length === 0) {
          skipped.push('The linked agreement lists no Services — no engagements created from it.')
          continue
        }
        // Notes: minimum term + tiered-pricing notes travel to the engagement.
        const notesParts: string[] = []
        const minTerm = agrMinTermF ? agreement.values[agrMinTermF.id] : null
        if (typeof minTerm === 'number') notesParts.push(`Minimum term: ${minTerm} months.`)
        const tiered = agrTieredNotesF ? agreement.values[agrTieredNotesF.id] : null
        if (typeof tiered === 'string' && tiered.trim()) notesParts.push(tiered.trim())
        notesParts.push(`Created by lead conversion from "${company}".`)

        for (const serviceId of serviceIds) {
          const serviceName = agrServicesF ? choiceName(agrServicesF, serviceId) : undefined
          const target = serviceName ? choiceByName(engServiceF, serviceName) : undefined
          if (!target) {
            skipped.push(
              `Agreement service "${serviceName ?? serviceId}" has no matching Engagements ` +
                '"Service" choice — engagement skipped.',
            )
            continue
          }
          // Fee source per matched service: Email/SMS ← Email Fee, Paid Social ← Paid Fee Base.
          const lowered = (serviceName ?? '').toLowerCase()
          let fee: unknown = null
          if (lowered === 'email/sms' && agrEmailFeeF) fee = agreement.values[agrEmailFeeF.id]
          else if (lowered === 'paid social' && agrPaidFeeF) fee = agreement.values[agrPaidFeeF.id]

          const values: Record<string, unknown> = { [engServiceF.id]: target.id }
          if (engStartF && agrStartF && agreement.values[agrStartF.id] != null) {
            values[engStartF.id] = agreement.values[agrStartF.id]
          }
          if (engFeeF && fee != null) values[engFeeF.id] = fee
          if (engNotesF && notesParts.length > 0) values[engNotesF.id] = notesParts.join('\n')
          engagementPlans.push({ values, clientLinkFieldId: engClientLinkF.id })
        }
      }
    }
  }

  // The conversion Activity on the lead.
  const activitiesTable = await getTableBySlug(orgId, 'activities')
  let activityValues: Record<string, unknown> | null = null
  if (!activitiesTable) {
    skipped.push('No "activities" table — the conversion was not logged as an activity.')
  } else {
    const activityFields = await listFields(orgId, activitiesTable.id)
    const actTypeF = fieldByName(activityFields, 'Type', 'single_select')
    const actSummaryF = fieldByName(activityFields, 'Summary', 'text')
    const actDateF = fieldByName(activityFields, 'Date', 'date')
    const actLeadLinkF = linkFieldTo(activityFields, leadsTable.id)
    const noteChoice = actTypeF ? choiceByName(actTypeF, 'Note') : undefined
    if (!actSummaryF || !actLeadLinkF) {
      skipped.push(
        'Activities is missing its "Summary" field or Lead link — the conversion was not logged.',
      )
    } else {
      activityValues = {
        [actSummaryF.id]: 'Converted to client',
        [actLeadLinkF.id]: [leadRecordId],
      }
      if (actTypeF && noteChoice) activityValues[actTypeF.id] = noteChoice.id
      if (actDateF) activityValues[actDateF.id] = new Date().toISOString().slice(0, 10)
    }
  }

  // -------------------------------------------------------------------------
  // WRITE PHASE — every write goes through createRecord/updateRecord with the
  // caller's actor. On a mid-sequence failure the applied writes are undone in
  // reverse (best effort) before rethrowing.
  // -------------------------------------------------------------------------
  const created = { client: 0, contactsRelinked: 0, engagements: 0, activities: 0 }
  const undo: Array<() => Promise<unknown>> = []

  try {
    let clientRecordId: string
    if (existingClient) {
      clientRecordId = existingClient.id
      skipped.push(
        `A client named "${String(existingClient.values[clientNameF.id])}" already exists — ` +
          'reusing it instead of creating a duplicate.',
      )
    } else {
      const clientRecord = await createRecord(orgId, clientsTable.id, clientValues, actor)
      clientRecordId = clientRecord.id
      created.client = 1
      undo.push(() => deleteRecords(orgId, clientsTable.id, [clientRecord.id], actor))
    }

    // Contacts → Client link (idempotent: already-linked contacts are left alone).
    if (contactsTable && clientLinkOnContacts) {
      for (const plan of contactPlans) {
        if (plan.existingClientIds.includes(clientRecordId)) continue
        await updateRecord(
          orgId,
          contactsTable.id,
          plan.contactId,
          { [clientLinkOnContacts.id]: [...plan.existingClientIds, clientRecordId] },
          actor,
        )
        created.contactsRelinked += 1
        undo.push(() =>
          updateRecord(
            orgId,
            contactsTable.id,
            plan.contactId,
            { [clientLinkOnContacts!.id]: plan.existingClientIds },
            actor,
          ),
        )
      }
    }

    // Engagements + activity only on a FRESH conversion — re-converting into an
    // existing client must not duplicate contract records or timeline entries.
    if (!existingClient) {
      for (const plan of engagementPlans) {
        const values = { ...plan.values, [plan.clientLinkFieldId]: [clientRecordId] }
        const rec = await createRecord(orgId, engagementsTable!.id, values, actor)
        created.engagements += 1
        undo.push(() => deleteRecords(orgId, engagementsTable!.id, [rec.id], actor))
      }
      if (activityValues && activitiesTable) {
        const rec = await createRecord(orgId, activitiesTable.id, activityValues, actor)
        created.activities = 1
        undo.push(() => deleteRecords(orgId, activitiesTable.id, [rec.id], actor))
      }
    } else {
      if (engagementPlans.length > 0) {
        skipped.push('Client already existed — engagements were not created again.')
      }
      if (activityValues) {
        skipped.push('Client already existed — the conversion activity was not logged again.')
      }
    }

    return {
      clientRecordId,
      clientCreated: !existingClient,
      clientTableId: clientsTable.id,
      clientTableSlug: clientsTable.slug,
      created,
      skipped,
    }
  } catch (err) {
    // Best-effort compensation, newest write first; the original error wins.
    for (const step of undo.reverse()) {
      try {
        await step()
      } catch {
        // Swallow: compensation is best-effort; the original failure is what matters.
      }
    }
    throw err
  }
}

/** Multi-select values are stored as choice-id arrays; anything else is treated as empty. */
function linkArrayOfChoiceIds(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}
