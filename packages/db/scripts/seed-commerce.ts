// Mock commerce/engagement seed — synthesizes a Shopify-shaped order history per client so the
// retention analytics (client_customer_metrics / client_cohorts, computed by
// scripts/compute-analytics.ts) have something realistic to chew on.
//
// Idempotent per client: if a client already has client_customers rows, it's skipped.
// Deterministic: every "random" choice is derived from a seeded formula (index-based), NOT
// Math.random(), so re-running against a fresh DB reproduces the exact same data.
//
// Run: DATABASE_URL=postgres://... pnpm --filter @retentionos/db seed:commerce

import { getDefaultOrganization, listClients } from '../src/index'
import type { Client } from '../src/index'
import { query, queryOne } from '../src/pool'

const DAY_MS = 24 * 60 * 60 * 1000
const HISTORY_DAYS = 540 // ~18 months

/** Deterministic pseudo-random in [0, 1), seeded by an integer. NOT Math.random() — the point
 *  is that re-running the seed against a fresh DB reproduces byte-for-byte the same data. */
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

function pseudoInt(seed: number, min: number, max: number): number {
  return min + Math.floor(pseudoRandom(seed) * (max - min + 1))
}

interface ProductTemplate {
  title: string
  productType: string
  vendor: string
  basePrice: number
}

const PRODUCT_CATALOGS: Record<string, ProductTemplate[]> = {
  'Northwind Coffee': [
    { title: 'Colombia Supremo 12oz', productType: 'Whole Bean', vendor: 'Northwind Coffee', basePrice: 16 },
    { title: 'Ethiopia Yirgacheffe 12oz', productType: 'Whole Bean', vendor: 'Northwind Coffee', basePrice: 18 },
    { title: 'Cold Brew Concentrate', productType: 'Ready to Drink', vendor: 'Northwind Coffee', basePrice: 14 },
    { title: 'Espresso Blend 5lb', productType: 'Whole Bean', vendor: 'Northwind Coffee', basePrice: 58 },
    { title: 'Decaf House Blend', productType: 'Whole Bean', vendor: 'Northwind Coffee', basePrice: 15 },
    { title: 'Pour-Over Dripper', productType: 'Equipment', vendor: 'Northwind Coffee', basePrice: 32 },
    { title: 'French Press 34oz', productType: 'Equipment', vendor: 'Northwind Coffee', basePrice: 38 },
    { title: 'Coffee Subscription - Monthly', productType: 'Subscription', vendor: 'Northwind Coffee', basePrice: 24 },
    { title: 'Reusable Travel Mug', productType: 'Accessory', vendor: 'Northwind Coffee', basePrice: 22 },
    { title: 'Single-Origin Sampler Pack', productType: 'Whole Bean', vendor: 'Northwind Coffee', basePrice: 45 },
  ],
  'Peak Athletics': [
    { title: 'Performance Tee', productType: 'Apparel', vendor: 'Peak Athletics', basePrice: 28 },
    { title: 'Compression Shorts', productType: 'Apparel', vendor: 'Peak Athletics', basePrice: 34 },
    { title: 'Trail Running Shoes', productType: 'Footwear', vendor: 'Peak Athletics', basePrice: 110 },
    { title: 'Yoga Mat Pro', productType: 'Equipment', vendor: 'Peak Athletics', basePrice: 48 },
    { title: 'Resistance Band Set', productType: 'Equipment', vendor: 'Peak Athletics', basePrice: 26 },
    { title: 'Insulated Water Bottle', productType: 'Accessory', vendor: 'Peak Athletics', basePrice: 30 },
    { title: 'Training Backpack', productType: 'Accessory', vendor: 'Peak Athletics', basePrice: 65 },
    { title: 'Moisture-Wick Socks (3-pack)', productType: 'Apparel', vendor: 'Peak Athletics', basePrice: 18 },
    { title: 'Half-Zip Pullover', productType: 'Apparel', vendor: 'Peak Athletics', basePrice: 56 },
    { title: 'Foam Roller', productType: 'Equipment', vendor: 'Peak Athletics', basePrice: 24 },
    { title: 'Adjustable Dumbbell Set', productType: 'Equipment', vendor: 'Peak Athletics', basePrice: 140 },
    { title: 'Windbreaker Jacket', productType: 'Apparel', vendor: 'Peak Athletics', basePrice: 78 },
  ],
  'Luma Skincare': [
    { title: 'Vitamin C Serum', productType: 'Serum', vendor: 'Luma Skincare', basePrice: 42 },
    { title: 'Hyaluronic Acid Moisturizer', productType: 'Moisturizer', vendor: 'Luma Skincare', basePrice: 36 },
    { title: 'Gentle Foaming Cleanser', productType: 'Cleanser', vendor: 'Luma Skincare', basePrice: 24 },
    { title: 'SPF 50 Daily Sunscreen', productType: 'Sun Care', vendor: 'Luma Skincare', basePrice: 28 },
    { title: 'Retinol Night Cream', productType: 'Moisturizer', vendor: 'Luma Skincare', basePrice: 48 },
    { title: 'Exfoliating Toner', productType: 'Toner', vendor: 'Luma Skincare', basePrice: 26 },
    { title: 'Rose Facial Mist', productType: 'Mist', vendor: 'Luma Skincare', basePrice: 20 },
    { title: 'Eye Repair Gel', productType: 'Treatment', vendor: 'Luma Skincare', basePrice: 34 },
    { title: 'Clay Detox Mask', productType: 'Mask', vendor: 'Luma Skincare', basePrice: 30 },
  ],
}

interface BehaviorClass {
  name: string
  lastOrderDaysAgoRange: [number, number]
  ordersCountRange: [number, number]
}

// Deliberately spans the spectrum: recent/frequent/high-spend, lapsed, one-time, mid-range.
const BEHAVIOR_CLASSES: BehaviorClass[] = [
  { name: 'vip-candidate', lastOrderDaysAgoRange: [2, 20], ordersCountRange: [8, 15] },
  { name: 'churned-candidate', lastOrderDaysAgoRange: [210, 520], ordersCountRange: [1, 4] },
  { name: 'one-time-buyer', lastOrderDaysAgoRange: [30, 500], ordersCountRange: [1, 1] },
  { name: 'active-mid-range', lastOrderDaysAgoRange: [25, 90], ordersCountRange: [3, 7] },
  { name: 'at-risk-borderline', lastOrderDaysAgoRange: [100, 190], ordersCountRange: [2, 5] },
]

interface GeneratedItem {
  productIndex: number
  quantity: number
  price: number
}

interface GeneratedOrder {
  orderedAt: Date
  items: GeneratedItem[]
  total: number
}

interface GeneratedCustomer {
  externalId: string
  email: string
  firstName: string
  lastName: string
  orders: GeneratedOrder[]
  firstOrderAt: Date
  lastOrderAt: Date
  ordersCount: number
  totalSpent: number
}

const FIRST_NAMES = [
  'Ava', 'Liam', 'Noah', 'Mia', 'Ethan', 'Sofia', 'Lucas', 'Emma', 'Owen', 'Grace',
  'Mason', 'Chloe', 'Logan', 'Zoey', 'Jack', 'Ella', 'Aiden', 'Nora', 'Elijah', 'Layla',
]
const LAST_NAMES = [
  'Bennett', 'Carter', 'Diaz', 'Ellis', 'Foster', 'Grant', 'Hayes', 'Irwin', 'Jensen', 'Kim',
  'Lopez', 'Moore', 'Nash', 'Ortiz', 'Patel', 'Quinn', 'Reyes', 'Silva', 'Turner', 'Vance',
]

function generateCustomer(clientSeed: number, customerIndex: number, products: ProductTemplate[]): GeneratedCustomer {
  const seed = clientSeed * 10_000 + customerIndex * 97
  const behaviorClass = BEHAVIOR_CLASSES[customerIndex % BEHAVIOR_CLASSES.length]!

  const ordersCount = pseudoInt(seed + 1, behaviorClass.ordersCountRange[0], behaviorClass.ordersCountRange[1])
  const lastOrderDaysAgo = pseudoInt(seed + 2, behaviorClass.lastOrderDaysAgoRange[0], behaviorClass.lastOrderDaysAgoRange[1])

  const now = Date.now()
  const daysAgoList: number[] = [lastOrderDaysAgo]
  const maxSpan = Math.max(HISTORY_DAYS - lastOrderDaysAgo, 0)
  for (let k = 1; k < ordersCount; k++) {
    const frac = k / Math.max(ordersCount - 1, 1)
    const jitter = (pseudoRandom(seed + 3 + k) - 0.5) * 10
    const daysAgo = Math.min(HISTORY_DAYS, Math.max(lastOrderDaysAgo, Math.round(lastOrderDaysAgo + frac * maxSpan + jitter)))
    daysAgoList.push(daysAgo)
  }

  // daysAgoList is sorted ascending by "days ago" (smallest = most recent), which is descending
  // chronologically — map first, then re-sort by actual date ascending (oldest first) so
  // orders[0] is the customer's first order and orders[last] is their most recent.
  const orders: GeneratedOrder[] = daysAgoList
    .map((daysAgo, orderIndex) => {
      const hourJitter = pseudoInt(seed + 100 + orderIndex, 8, 21)
      const orderedAt = new Date(now - daysAgo * DAY_MS)
      orderedAt.setHours(hourJitter, pseudoInt(seed + 200 + orderIndex, 0, 59), 0, 0)

      const itemCount = pseudoInt(seed + 300 + orderIndex, 1, 3)
      const items: GeneratedItem[] = []
      for (let j = 0; j < itemCount; j++) {
        const productIndex = pseudoInt(seed + 400 + orderIndex * 5 + j, 0, products.length - 1)
        const quantity = pseudoInt(seed + 500 + orderIndex * 5 + j, 1, 3)
        const product = products[productIndex]!
        // small deterministic price wobble around the catalog price (promo/discount variance)
        const wobble = 0.9 + pseudoRandom(seed + 600 + orderIndex * 5 + j) * 0.2
        const price = Math.round(product.basePrice * wobble * 100) / 100
        items.push({ productIndex, quantity, price })
      }
      const total = Math.round(items.reduce((sum, item) => sum + item.quantity * item.price, 0) * 100) / 100
      return { orderedAt, items, total }
    })
    .sort((a, b) => a.orderedAt.getTime() - b.orderedAt.getTime())

  const firstOrderAt = orders[0]!.orderedAt
  const lastOrderAtDate = orders[orders.length - 1]!.orderedAt
  const totalSpent = Math.round(orders.reduce((sum, o) => sum + o.total, 0) * 100) / 100

  const firstName = FIRST_NAMES[customerIndex % FIRST_NAMES.length]!
  const lastName = LAST_NAMES[pseudoInt(seed + 7, 0, LAST_NAMES.length - 1)]!

  return {
    externalId: `CUST-${clientSeed}-${customerIndex}`,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${customerIndex}@example.com`,
    firstName,
    lastName,
    orders,
    firstOrderAt,
    lastOrderAt: lastOrderAtDate,
    ordersCount: orders.length,
    totalSpent,
  }
}

// Deterministic per-client customer counts, within the 25-40 spec range.
const CUSTOMER_COUNTS: Record<string, number> = {
  'Northwind Coffee': 28,
  'Peak Athletics': 34,
  'Luma Skincare': 32,
}

async function seedClient(orgId: string, client: Client, clientSeed: number): Promise<void> {
  const existing = await queryOne<{ id: string }>(
    'select id from public.client_customers where client_id = $1 limit 1',
    [client.id],
  )
  if (existing) {
    console.log(`  ${client.name}: already has commerce data, skipping.`)
    return
  }

  const catalog = PRODUCT_CATALOGS[client.name] ?? PRODUCT_CATALOGS['Northwind Coffee']!
  const customerCount = CUSTOMER_COUNTS[client.name] ?? 30

  // --- products --------------------------------------------------------------------
  const productIds: string[] = []
  for (let p = 0; p < catalog.length; p++) {
    const product = catalog[p]!
    const row = await queryOne<{ id: string }>(
      `insert into public.client_products
         (organization_id, client_id, source, external_id, title, product_type, vendor, price, status)
       values ($1, $2, 'shopify', $3, $4, $5, $6, $7, 'active')
       returning id`,
      [orgId, client.id, `PROD-${clientSeed}-${p}`, product.title, product.productType, product.vendor, product.basePrice],
    )
    productIds.push(row!.id)
  }

  // --- customers, orders, order items -----------------------------------------------
  let totalOrders = 0
  let totalItems = 0
  for (let i = 0; i < customerCount; i++) {
    const generated = generateCustomer(clientSeed, i, catalog)

    const customerRow = await queryOne<{ id: string }>(
      `insert into public.client_customers
         (organization_id, client_id, source, external_id, email, first_name, last_name,
          first_order_at, last_order_at, orders_count, total_spent, email_consent, sms_consent)
       values ($1, $2, 'shopify', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       returning id`,
      [
        orgId,
        client.id,
        generated.externalId,
        generated.email,
        generated.firstName,
        generated.lastName,
        generated.firstOrderAt,
        generated.lastOrderAt,
        generated.ordersCount,
        generated.totalSpent,
        pseudoRandom(clientSeed * 1000 + i) > 0.2,
        pseudoRandom(clientSeed * 2000 + i) > 0.6,
      ],
    )
    const customerId = customerRow!.id

    for (let oi = 0; oi < generated.orders.length; oi++) {
      const order = generated.orders[oi]!
      const orderRow = await queryOne<{ id: string }>(
        `insert into public.client_orders
           (organization_id, client_id, customer_id, source, external_id, order_number, total,
            currency, financial_status, fulfillment_status, ordered_at)
         values ($1, $2, $3, 'shopify', $4, $5, $6, 'USD', 'paid', 'fulfilled', $7)
         returning id`,
        [
          orgId,
          client.id,
          customerId,
          `ORD-${clientSeed}-${i}-${oi}`,
          `#${1000 + clientSeed * 1000 + i * 10 + oi}`,
          order.total,
          order.orderedAt,
        ],
      )
      const orderId = orderRow!.id
      totalOrders++

      for (const item of order.items) {
        const product = catalog[item.productIndex]!
        await query(
          `insert into public.client_order_items
             (organization_id, client_id, order_id, product_external_id, product_title,
              variant_title, quantity, price)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [orgId, client.id, orderId, `PROD-${clientSeed}-${item.productIndex}`, product.title, null, item.quantity, item.price],
        )
        totalItems++
      }
    }
  }

  console.log(
    `  ${client.name}: seeded ${customerCount} customers, ${totalOrders} orders, ${totalItems} order items, ${productIds.length} products.`,
  )
}

async function main() {
  const org = await getDefaultOrganization()
  if (!org) {
    console.error('No organization found — run `pnpm --filter @retentionos/db seed` first.')
    process.exit(1)
  }

  const clients = await listClients(org.id, { includeArchived: false })
  if (clients.length === 0) {
    console.error('No clients found for org — run `pnpm --filter @retentionos/db seed` first.')
    process.exit(1)
  }

  console.log(`Seeding commerce data for org "${org.name}" (${clients.length} clients)...`)
  for (let i = 0; i < clients.length; i++) {
    await seedClient(org.id, clients[i]!, i + 1)
  }
  console.log('Done.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
