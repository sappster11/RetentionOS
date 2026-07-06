# n8n × RetentionOS — reading and writing through /api/v1

How to wire n8n **HTTP Request nodes** to RetentionOS. n8n is a client of the same REST
API the web UI uses (agent-parity law): anything below also works from curl, Make, or a
bash script.

## Base URL

```
http://<host>:3000/api/v1
```

`<host>` is wherever `apps/web` runs (locally: `localhost`). All requests/responses are
JSON; set **Response Format: JSON** and, for writes, **Body Content Type: JSON**.

Two rules that shape every workflow:

- **Records are keyed by FIELD ID, not field name.** `values` maps
  `{ "<fieldId>": <value> }`. Fetch field ids once per workflow (step 2) — they are
  stable across renames.
- **IDs are UUIDs** for tables, fields, views, and records.

## The five endpoint families

### 1. List tables — find your table id

```
GET /api/v1/tables
```

Returns `{ tables: [{ id, name, slug, ... }] }`. Look up by `slug`
(e.g. `clients`, `prompt-doc-cycles`, `contacts`).

### 2. Describe a table — get field ids (and views)

```
GET /api/v1/tables/{tableId}
```

Returns `{ table, fields, views }`. Each field has `id`, `name`, `type`, and `options`
(for selects, `options.choices[]` — **filter/write select values by choice `id`**, e.g.
Status `active`, not the label `Active`).

### 3. Query records — with filters

```
GET /api/v1/tables/{tableId}/records?limit=&offset=&sort=&filter=
```

Query-param grammar (all repeatable):

- `filter=<fieldId>:<op>:<value>` — ops: `eq`, `neq`, `contains`, `gt`, `gte`, `lt`,
  `lte`, `is_empty`, `is_not_empty`. The empty-ops take no `:<value>` part. Multiple
  filters AND together.
- `sort=<fieldId>:asc` or `<fieldId>:desc`
- `limit` / `offset` — non-negative integers.

**The enrollment query from docs/10** — Clients where Answer Prompts is true (checkboxes
compare as `true`/`false`):

```
curl "http://localhost:3000/api/v1/tables/$CLIENTS_TABLE/records?filter=$ANSWER_PROMPTS_FIELD:eq:true"
```

Monthly prompt-doc slice (no relative-date filters yet — pass the literal year/month your
workflow computed; Month is a select, so use the choice id, e.g. `jul`):

```
curl "http://localhost:3000/api/v1/tables/$CYCLES_TABLE/records?filter=$YEAR_FIELD:eq:2026&filter=$MONTH_FIELD:eq:jul"
```

Responses return each record as `{ id, values, display, ... }`: `values` is raw stored
data; `display` adds computed results (rollups, lookups, formulas) and linked-record
labels.

### 4. Create a record

```
curl -X POST "http://localhost:3000/api/v1/tables/$CYCLES_TABLE/records" \
  -H "Content-Type: application/json" \
  -d '{"values": {
        "'$CLIENT_LINK_FIELD'": ["<client-record-uuid>"],
        "'$MONTH_FIELD'": "jul",
        "'$STATUS_FIELD'": "pending"
      }}'
```

Returns `201` with `{ record }` (enriched). Omitted fields stay empty.

### 5. Update (or delete) a record

```
curl -X PATCH "http://localhost:3000/api/v1/tables/$CYCLES_TABLE/records/$RECORD_ID" \
  -H "Content-Type: application/json" \
  -d '{"values": {"'$STATUS_FIELD'": "filled", "'$WORD_COUNT_FIELD'": 412}}'
```

PATCH is partial — only the fields you send change. `DELETE` on the same URL removes the
record. `GET` on it fetches one record.

## Value shapes cheat-sheet

| Field type | Write as |
|---|---|
| linked_record | **array of record UUIDs**, e.g. `["a1b2…"]` — even for a single link |
| single_select | choice **id** string (`"active"`) |
| multi_select | array of choice ids (`["email_sms"]`) |
| checkbox | `true` / `false` |
| date / datetime | ISO string (`"2026-07-01"` / `"2026-07-01T09:00:00Z"`) |
| number / currency / percent | plain number (percent stored 0–1) |
| lookup / rollup / formula / autonumber / created_time | **read-only** — computed at read time, appears in `display`; writing it is a 400 |

Errors come back as `{ error, code }` with a 4xx status — surface `error` in your n8n
failure branch; it says exactly which field/value was rejected.

## Security note (honest)

There is **no authentication on /api/v1 yet** — every request runs against the dev-mode
default organization. Only deploy this API on a local/private network (or behind a
VPN/tunnel you control), and don't expose the port publicly. API keys/auth are future
work; when they land, n8n gains one Header-Auth credential and nothing else changes.
