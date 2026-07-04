// Shopify connector — populates client_products / client_customers / client_orders /
// client_order_items (migration 0004_client_data.sql) from either a fixture (what runs today)
// or the live Shopify Admin API (real fetch code, gated behind an access token this
// environment doesn't have). Both paths converge on `applyShopifyFixture` so there is exactly
// one place that decides how a Shopify row becomes a client_* row.
import { z } from 'zod'
import { query, queryOne } from '@retentionos/db'
import type { Connector, SyncSummary } from './types'

// ---------------------------------------------------------------------------
// Fixture / mapped-API shapes (Shopify Admin API 2024-10 REST shapes, trimmed to what we use)
// ---------------------------------------------------------------------------

const numericString = z.union([z.string(), z.number()]).transform((v) => String(v))

const shopifyCustomerSchema = z.object({
  id: z.union([z.string(), z.number()]),
  email: z.string().nullable().optional(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  orders_count: z.number().optional().default(0),
  total_spent: numericString.optional().default('0'),
  created_at: z.string().optional(),
})

const shopifyLineItemSchema = z.object({
  product_id: z.union([z.string(), z.number()]).nullable().optional(),
  title: z.string(),
  variant_title: z.string().nullable().optional(),
  quantity: z.number(),
  price: numericString,
})

const shopifyOrderSchema = z.object({
  id: z.union([z.string(), z.number()]),
  order_number: z.union([z.string(), z.number()]).nullable().optional(),
  total_price: numericString,
  currency: z.string().optional().default('USD'),
  financial_status: z.string().nullable().optional(),
  fulfillment_status: z.string().nullable().optional(),
  created_at: z.string(),
  customer: z.object({ id: z.union([z.string(), z.number()]) }).nullable().optional(),
  line_items: z.array(shopifyLineItemSchema).default([]),
})

const shopifyVariantSchema = z.object({
  price: numericString.optional().default('0'),
})

const shopifyProductSchema = z.object({
  id: z.union([z.string(), z.number()]),
  title: z.string(),
  product_type: z.string().nullable().optional(),
  vendor: z.string().nullable().optional(),
  variants: z.array(shopifyVariantSchema).default([]),
  status: z.string().nullable().optional(),
})

export const shopifyFixtureSchema = z.object({
  customers: z.array(shopifyCustomerSchema).default([]),
  orders: z.array(shopifyOrderSchema).default([]),
  products: z.array(shopifyProductSchema).default([]),
})

export type ShopifyCustomer = z.infer<typeof shopifyCustomerSchema>
export type ShopifyOrder = z.infer<typeof shopifyOrderSchema>
export type ShopifyProduct = z.infer<typeof shopifyProductSchema>
export type ShopifyFixture = z.infer<typeof shopifyFixtureSchema>

export interface ShopifyCredentials {
  shop: string // e.g. "my-store.myshopify.com"
  accessToken: string
}

// ---------------------------------------------------------------------------
// Mapping / upsert (shared by syncFromFixture and syncLive)
// ---------------------------------------------------------------------------

async function upsertProducts(
  orgId: string,
  clientId: string,
  products: ShopifyProduct[],
): Promise<number> {
  let count = 0
  for (const p of products) {
    const price = p.variants[0]?.price ?? null
    await query(
      `insert into public.client_products
         (organization_id, client_id, source, external_id, title, product_type, vendor, price, status, metadata)
       values ($1, $2, 'shopify', $3, $4, $5, $6, $7, $8, $9)
       on conflict (client_id, source, external_id) do update set
         title = excluded.title,
         product_type = excluded.product_type,
         vendor = excluded.vendor,
         price = excluded.price,
         status = excluded.status,
         metadata = excluded.metadata`,
      [
        orgId,
        clientId,
        String(p.id),
        p.title,
        p.product_type ?? null,
        p.vendor ?? null,
        price,
        p.status ?? null,
        JSON.stringify(p),
      ],
    )
    count++
  }
  return count
}

async function upsertCustomers(
  orgId: string,
  clientId: string,
  customers: ShopifyCustomer[],
): Promise<Map<string, string>> {
  const idByExternalId = new Map<string, string>()
  for (const c of customers) {
    const externalId = String(c.id)
    const row = await queryOne<{ id: string }>(
      `insert into public.client_customers
         (organization_id, client_id, source, external_id, email, first_name, last_name,
          orders_count, total_spent, metadata)
       values ($1, $2, 'shopify', $3, $4, $5, $6, $7, $8, $9)
       on conflict (client_id, source, external_id) do update set
         email = excluded.email,
         first_name = excluded.first_name,
         last_name = excluded.last_name,
         orders_count = excluded.orders_count,
         total_spent = excluded.total_spent,
         metadata = excluded.metadata
       returning id`,
      [
        orgId,
        clientId,
        externalId,
        c.email ?? null,
        c.first_name ?? null,
        c.last_name ?? null,
        c.orders_count,
        c.total_spent,
        JSON.stringify(c),
      ],
    )
    if (row) idByExternalId.set(externalId, row.id)
  }
  return idByExternalId
}

interface OrderDateRange {
  first: Date
  last: Date
}

async function upsertOrders(
  orgId: string,
  clientId: string,
  orders: ShopifyOrder[],
  customerIdByExternalId: Map<string, string>,
): Promise<{ orderCount: number; orderDatesByCustomerExternalId: Map<string, OrderDateRange> }> {
  const orderDatesByCustomerExternalId = new Map<string, OrderDateRange>()
  let orderCount = 0

  for (const o of orders) {
    const customerExternalId = o.customer ? String(o.customer.id) : null
    const customerId = customerExternalId
      ? customerIdByExternalId.get(customerExternalId)
      : undefined
    if (!customerId) {
      // Order references a customer outside this fixture/page — can't satisfy the FK, so skip
      // rather than fabricate a customer row. Shouldn't happen with well-formed fixtures.
      console.warn(
        `shopify: order ${String(o.id)} references unknown customer ${customerExternalId ?? '(none)'}, skipping`,
      )
      continue
    }

    const orderRow = await queryOne<{ id: string }>(
      `insert into public.client_orders
         (organization_id, client_id, customer_id, source, external_id, order_number, total,
          currency, financial_status, fulfillment_status, ordered_at, metadata)
       values ($1, $2, $3, 'shopify', $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (client_id, source, external_id) do update set
         customer_id = excluded.customer_id,
         order_number = excluded.order_number,
         total = excluded.total,
         currency = excluded.currency,
         financial_status = excluded.financial_status,
         fulfillment_status = excluded.fulfillment_status,
         ordered_at = excluded.ordered_at,
         metadata = excluded.metadata
       returning id`,
      [
        orgId,
        clientId,
        customerId,
        String(o.id),
        o.order_number != null ? String(o.order_number) : null,
        o.total_price,
        o.currency,
        o.financial_status ?? null,
        o.fulfillment_status ?? null,
        o.created_at,
        JSON.stringify(o),
      ],
    )
    if (!orderRow) continue
    orderCount++

    // Line items have no natural unique key of their own (they're immutable once placed), so
    // idempotency is: clear this order's items, then reinsert from the fixture/API payload.
    await query(`delete from public.client_order_items where order_id = $1`, [orderRow.id])
    for (const li of o.line_items) {
      await query(
        `insert into public.client_order_items
           (organization_id, client_id, order_id, product_external_id, product_title,
            variant_title, quantity, price, metadata)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          orgId,
          clientId,
          orderRow.id,
          li.product_id != null ? String(li.product_id) : null,
          li.title,
          li.variant_title ?? null,
          li.quantity,
          li.price,
          JSON.stringify(li),
        ],
      )
    }

    const orderedAt = new Date(o.created_at)
    const range = orderDatesByCustomerExternalId.get(customerExternalId!)
    if (!range) {
      orderDatesByCustomerExternalId.set(customerExternalId!, { first: orderedAt, last: orderedAt })
    } else {
      if (orderedAt < range.first) range.first = orderedAt
      if (orderedAt > range.last) range.last = orderedAt
    }
  }

  return { orderCount, orderDatesByCustomerExternalId }
}

async function updateCustomerOrderDates(
  customerIdByExternalId: Map<string, string>,
  orderDatesByCustomerExternalId: Map<string, OrderDateRange>,
): Promise<void> {
  for (const [externalId, range] of orderDatesByCustomerExternalId) {
    const customerId = customerIdByExternalId.get(externalId)
    if (!customerId) continue
    await query(
      `update public.client_customers set first_order_at = $1, last_order_at = $2 where id = $3`,
      [range.first.toISOString(), range.last.toISOString(), customerId],
    )
  }
}

async function applyShopifyFixture(
  orgId: string,
  clientId: string,
  fixture: ShopifyFixture,
): Promise<SyncSummary> {
  const productCount = await upsertProducts(orgId, clientId, fixture.products)
  const customerIdByExternalId = await upsertCustomers(orgId, clientId, fixture.customers)
  const { orderCount, orderDatesByCustomerExternalId } = await upsertOrders(
    orgId,
    clientId,
    fixture.orders,
    customerIdByExternalId,
  )
  await updateCustomerOrderDates(customerIdByExternalId, orderDatesByCustomerExternalId)

  return {
    customers: customerIdByExternalId.size,
    orders: orderCount,
    products: productCount,
  }
}

// ---------------------------------------------------------------------------
// Live Shopify Admin API fetch — requires a Shopify Admin API access token (custom/private
// app, scopes read_customers + read_orders + read_products). Not exercised in this
// environment (no credentials) but typechecks and reuses applyShopifyFixture above, so the
// fixture and live paths can never map data differently.
// ---------------------------------------------------------------------------

const SHOPIFY_API_VERSION = '2024-10'

function parseNextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null
  const next = linkHeader
    .split(',')
    .map((part) => part.trim())
    .find((part) => part.endsWith('rel="next"'))
  if (!next) return null
  const match = /^<(.+)>/.exec(next)
  return match?.[1] ?? null
}

async function fetchAllPages<T>(
  shop: string,
  accessToken: string,
  initialUrl: string,
  resourceKey: string,
): Promise<T[]> {
  const results: T[] = []
  let url: string | null = initialUrl
  while (url) {
    const res = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    })
    if (!res.ok) {
      throw new Error(`Shopify API error ${res.status} for ${shop}: ${await res.text()}`)
    }
    const body = (await res.json()) as Record<string, unknown>
    const items = body[resourceKey]
    if (Array.isArray(items)) results.push(...(items as T[]))
    url = parseNextPageUrl(res.headers.get('link'))
  }
  return results
}

async function fetchShopifyFixtureLive(shop: string, accessToken: string): Promise<ShopifyFixture> {
  const base = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}`
  const [customers, orders, products] = await Promise.all([
    fetchAllPages(shop, accessToken, `${base}/customers.json?limit=250`, 'customers'),
    fetchAllPages(shop, accessToken, `${base}/orders.json?status=any&limit=250`, 'orders'),
    fetchAllPages(shop, accessToken, `${base}/products.json?limit=250`, 'products'),
  ])
  return shopifyFixtureSchema.parse({ customers, orders, products })
}

// ---------------------------------------------------------------------------
// Connector
// ---------------------------------------------------------------------------

export const shopifyConnector: Connector<ShopifyFixture, ShopifyCredentials> = {
  provider: 'shopify',

  async syncFromFixture(orgId, clientId, fixture) {
    const parsed = shopifyFixtureSchema.parse(fixture)
    return applyShopifyFixture(orgId, clientId, parsed)
  },

  // requires a Shopify Admin API access token — this path is correct and typechecked but
  // cannot run in this environment (no Shopify credentials available).
  async syncLive(orgId, clientId, credentials) {
    if (!credentials?.shop || !credentials?.accessToken) {
      throw new Error(
        'Shopify syncLive requires { shop, accessToken } — a Shopify Admin API access token ' +
          '(custom/private app) with read_customers, read_orders, read_products scopes.',
      )
    }
    const fixture = await fetchShopifyFixtureLive(credentials.shop, credentials.accessToken)
    return applyShopifyFixture(orgId, clientId, fixture)
  },
}
