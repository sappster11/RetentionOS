// Dev seed — creates one organization, a team user, and a few clients with contacts,
// channels, and activity so the UI has something real to render. Idempotent: if the demo
// org already exists it exits without duplicating.
//
// Run: DATABASE_URL=postgres://... pnpm --filter @retentionos/db seed

import {
  createClient,
  createContact,
  createOrganization,
  linkChannel,
  logActivity,
  queryOne,
} from '../src/index'
import type { Organization } from '../src/index'
import { query } from '../src/pool'

const DEMO_SLUG = 'acme-retention'

async function main() {
  const existing = await queryOne<Organization>(
    'select id, name, slug, created_at from public.organizations where slug = $1',
    [DEMO_SLUG],
  )
  if (existing) {
    console.log(`Demo org already seeded (${existing.id}). Nothing to do.`)
    return
  }

  const org = await createOrganization({ name: 'Acme Retention', slug: DEMO_SLUG })

  // A team member (owner). auth.users is Supabase's table (shimmed locally).
  const user = await queryOne<{ id: string }>(
    `with au as (
       insert into auth.users (email) values ('jacob@acme-retention.com') returning id
     ), pu as (
       insert into public.users (id, email, full_name)
       select id, 'jacob@acme-retention.com', 'Jacob Sappington' from au
       returning id
     )
     insert into public.memberships (organization_id, user_id, role)
     select $1, id, 'owner' from pu
     returning user_id as id`,
    [org.id],
  )
  const ownerId = user?.id ?? null

  const clients = [
    { name: 'Northwind Coffee', status: 'active', tier: 'premium', industry: 'CPG / Beverage' },
    { name: 'Peak Athletics', status: 'onboarding', tier: 'standard', industry: 'Apparel' },
    { name: 'Luma Skincare', status: 'at_risk', tier: 'enterprise', industry: 'Beauty' },
  ] as const

  for (const c of clients) {
    const client = await createClient(org.id, {
      name: c.name,
      status: c.status,
      tier: c.tier,
      industry: c.industry,
      lifecycle_stage: c.status === 'active' ? 'active' : c.status === 'at_risk' ? 'renewal' : 'trial',
      owner_id: ownerId ?? undefined,
    })

    await createContact(org.id, {
      client_id: client.id,
      full_name: `${c.name.split(' ')[0]} Lead`,
      email: `lead@${client.slug}.com`,
      title: 'Head of Retention',
      is_primary: true,
    })

    await linkChannel(org.id, {
      client_id: client.id,
      kind: 'slack',
      name: `#${client.slug}`,
      url: `https://slack.com/app_redirect?channel=${client.slug}`,
    })
    await linkChannel(org.id, {
      client_id: client.id,
      kind: 'gcal',
      name: `${c.name} Calendar`,
      url: 'https://calendar.google.com',
    })

    await logActivity(org.id, {
      client_id: client.id,
      actor_type: 'system',
      verb: 'client.created',
      summary: `${c.name} added to RetentionOS`,
    })
    await logActivity(org.id, {
      client_id: client.id,
      actor_type: 'user',
      actor_id: ownerId,
      verb: 'note.created',
      summary:
        c.status === 'at_risk'
          ? 'Engagement dipped last month — flag for a win-back push.'
          : 'Kickoff complete; retention calendar drafted.',
    })
  }

  console.log(`Seeded org "${org.name}" (${org.id}) with ${clients.length} clients.`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
