// Phase 4 content-engine seed — two agency-wide templates (winback email + winback SMS) and,
// per client, one "at-risk high-value" audience (a saved query, not a stored list — see
// src/audiences.ts#resolveAudience).
//
// Idempotent: if the org already has any templates, this exits without duplicating.
//
// Run: DATABASE_URL=postgres://... pnpm --filter @retentionos/db seed:content

import { createAudience, createTemplate, getDefaultOrganization, listClients, listTemplates } from '../src/index'

async function main() {
  const org = await getDefaultOrganization()
  if (!org) {
    console.error('No organization found — run `pnpm --filter @retentionos/db seed` first.')
    process.exit(1)
  }

  const existingTemplates = await listTemplates(org.id)
  if (existingTemplates.length > 0) {
    console.log(`Org "${org.name}" already has ${existingTemplates.length} template(s). Nothing to do.`)
    return
  }

  const clients = await listClients(org.id, { includeArchived: false })
  if (clients.length === 0) {
    console.error('No clients found for org — run `pnpm --filter @retentionos/db seed` first.')
    process.exit(1)
  }

  const emailTemplate = await createTemplate(org.id, {
    channel: 'email',
    name: 'Winback — We miss you',
    subject: 'We miss you, {{first_name}}',
    body:
      "Hi {{first_name}},\n\n" +
      "It's been a while since your last order — come back and take 15% off your next purchase.\n\n" +
      'See you soon,\nThe team',
    variables: { first_name: 'string' },
  })

  const smsTemplate = await createTemplate(org.id, {
    channel: 'sms',
    name: 'Winback — SMS nudge',
    body: "Hi {{first_name}}, it's been a bit! Here's 15% off to come back: {{discount_code}}",
    variables: { first_name: 'string', discount_code: 'string' },
  })

  console.log(`Created 2 agency-wide templates: "${emailTemplate.name}" (email), "${smsTemplate.name}" (sms).`)

  for (const client of clients) {
    const audience = await createAudience(org.id, {
      client_id: client.id,
      name: 'At-risk high-value',
      definition: { segment: 'at_risk', min_monetary: 200 },
    })
    console.log(`  ${client.name}: audience "${audience.name}" (${audience.id}).`)
  }

  console.log('Done.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
