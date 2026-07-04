'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import {
  createClient,
  updateClient,
  createContact,
  linkChannel,
  createDocument,
  logActivity,
  getClient,
  type ClientStatus,
  type ClientTier,
  type ChannelKind,
} from '@retentionos/db'
import { getCurrentOrg } from '@/lib/org'

function requireString(formData: FormData, field: string): string {
  const value = formData.get(field)
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required field: ${field}`)
  }
  return value.trim()
}

function optionalString(formData: FormData, field: string): string | undefined {
  const value = formData.get(field)
  if (typeof value !== 'string' || value.trim() === '') return undefined
  return value.trim()
}

export async function createClientAction(formData: FormData): Promise<void> {
  const org = await getCurrentOrg()
  const name = requireString(formData, 'name')
  const status = optionalString(formData, 'status') as ClientStatus | undefined
  const tier = optionalString(formData, 'tier') as ClientTier | undefined

  const client = await createClient(org.id, { name, status, tier })
  await logActivity(org.id, {
    client_id: client.id,
    verb: 'client.created',
    summary: `${client.name} was created`,
    data: { status: client.status, tier: client.tier },
  })

  revalidatePath('/clients')
  redirect(`/clients/${client.id}`)
}

export async function updateClientStatusAction(formData: FormData): Promise<void> {
  const org = await getCurrentOrg()
  const clientId = requireString(formData, 'client_id')
  const nextStatus = requireString(formData, 'status') as ClientStatus

  const before = await getClient(org.id, clientId)
  if (!before) throw new Error('Client not found')

  await updateClient(org.id, clientId, { status: nextStatus })
  await logActivity(org.id, {
    client_id: clientId,
    verb: 'client.status_changed',
    summary: `Status changed from ${before.status} to ${nextStatus}`,
    data: { from: before.status, to: nextStatus },
  })

  revalidatePath(`/clients/${clientId}`)
  revalidatePath('/clients')
}

export async function addContactAction(formData: FormData): Promise<void> {
  const org = await getCurrentOrg()
  const clientId = requireString(formData, 'client_id')
  const fullName = requireString(formData, 'full_name')
  const email = optionalString(formData, 'email')
  const phone = optionalString(formData, 'phone')
  const title = optionalString(formData, 'title')
  const roleType = optionalString(formData, 'role_type')
  const isPrimary = formData.get('is_primary') === 'on'

  const contact = await createContact(org.id, {
    client_id: clientId,
    full_name: fullName,
    email,
    phone,
    title,
    role_type: roleType,
    is_primary: isPrimary,
  })
  await logActivity(org.id, {
    client_id: clientId,
    verb: 'contact.added',
    summary: `Added contact ${contact.full_name}`,
    data: { contact_id: contact.id },
  })

  revalidatePath(`/clients/${clientId}`)
}

export async function linkChannelAction(formData: FormData): Promise<void> {
  const org = await getCurrentOrg()
  const clientId = requireString(formData, 'client_id')
  const kind = requireString(formData, 'kind') as ChannelKind
  const name = requireString(formData, 'name')
  const url = optionalString(formData, 'url')

  const channel = await linkChannel(org.id, { client_id: clientId, kind, name, url })
  await logActivity(org.id, {
    client_id: clientId,
    verb: 'channel.linked',
    summary: `Linked ${channel.kind} channel "${channel.name}"`,
    data: { channel_id: channel.id, kind: channel.kind },
  })

  revalidatePath(`/clients/${clientId}`)
}

export async function addNoteAction(formData: FormData): Promise<void> {
  const org = await getCurrentOrg()
  const clientId = requireString(formData, 'client_id')
  const title = requireString(formData, 'title')
  const content = optionalString(formData, 'content')

  const document = await createDocument(org.id, {
    client_id: clientId,
    title,
    source: 'note',
    content,
  })
  await logActivity(org.id, {
    client_id: clientId,
    verb: 'note.created',
    summary: `Added note "${document.title}"`,
    data: { document_id: document.id },
  })

  revalidatePath(`/clients/${clientId}`)
}
