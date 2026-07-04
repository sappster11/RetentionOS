// @retentionos/integrations — Shopify, Klaviyo, and Airtable connectors that populate the
// owned Postgres client_* commerce/engagement mirrors (and CRM core, for Airtable) defined in
// packages/db. Every connector has a fixture-based path (what runs in this environment) and a
// gated live-API path (real fetch code, correct and typechecked, but requires credentials this
// environment doesn't have).

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { shopifyFixtureSchema } from './shopify'
import { klaviyoFixtureSchema } from './klaviyo'
import { airtableFixtureSchema } from './airtable'
import type { ShopifyFixture } from './shopify'
import type { KlaviyoFixture } from './klaviyo'
import type { AirtableFixture } from './airtable'

export * from './types'
export * from './shopify'
export * from './klaviyo'
export * from './airtable'

// ---------------------------------------------------------------------------
// Fixtures loader — reads the bundled sample JSON under src/fixtures/ and validates it against
// each connector's zod schema, so callers (scripts, tests) get a typed, checked fixture without
// duplicating parsing logic.
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')

function loadJson(filename: string): unknown {
  const filePath = path.join(FIXTURES_DIR, filename)
  return JSON.parse(readFileSync(filePath, 'utf-8'))
}

/** Loads and validates the bundled Shopify sample fixture (src/fixtures/shopify.sample.json). */
export function loadShopifyFixture(): ShopifyFixture {
  return shopifyFixtureSchema.parse(loadJson('shopify.sample.json'))
}

/** Loads and validates the bundled Klaviyo sample fixture (src/fixtures/klaviyo.sample.json). */
export function loadKlaviyoFixture(): KlaviyoFixture {
  return klaviyoFixtureSchema.parse(loadJson('klaviyo.sample.json'))
}

/** Loads and validates the bundled Airtable sample fixture (src/fixtures/airtable.sample.json). */
export function loadAirtableFixture(): AirtableFixture {
  return airtableFixtureSchema.parse(loadJson('airtable.sample.json'))
}
