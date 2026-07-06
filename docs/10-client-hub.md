# 10 — Roam Client Hub (specification)

**Status: authoritative spec** for the client-hub half of Phase D
(see [08-course-correction.md](08-course-correction.md); the Sales CRM half is
[09-sales-crm.md](09-sales-crm.md) and is already seeded).

Design inputs: Jacob's discovery answers ("every single piece of information we have
about a brand") plus a full quantitative analysis of the reference Airtable Clients
base — 279 clients (91 active), 12 tables, all records pulled. Headline findings:
three tables are 1:1 pseudo-satellites (Slack Channels ≈ 4 columns; Processes exists
to hold one checkbox; Docs & Resources is per-year URL columns with a duplicate client
link); ~9 of 35 Clients fields are dead or duplicated (the Docs twin-link is
byte-identical in all 114 dual-filled records; "(P)" dates: 2 fills and 0 fills);
"Active PM/Strategist" is a 4-formula workaround for conditional lookups; nobody
closes anything manually (21+ churned clients still had "active" assignments,
engagement End dates 2% filled); the Prompt Docs "Client List" is a materialized
view that exists only because Airtable makes cross-table reads hard for automations.

## Tables

### 1. Clients (the hub)
| Group | Fields |
|---|---|
| Identity | **Client** (text, primary) · Domain (url) · Logo (attachment) · Industry (single_select, reference taxonomy) · Services (multi_select) · Status (single_select: Onboarding / Active / Paused / Churned — history free via revisions) |
| Comms & automation (absorbs the Slack Channels + Processes tables and approval plumbing) | Internal Slack Channel ID (text) · External Slack Channel ID (text) · Approval Channel (single_select: Slack / Email) · Approval Link Mode (single_select: Figma Only / Asana Only / Both) · Asana Tracker GID (text) · Answer Prompts (checkbox — gates the monthly questionnaire) |
| Links | Contacts · Engagements · Client Docs · Assignments · Prompt Doc Cycles · Discount Codes · Tech Stack (link to catalog) |
| Derived | Active PM (**filtered rollup** over Assignments: End empty ∧ Role=PM) · Active Strategist (same, Role=Strategist) · Client Since (rollup MIN over Engagements Start) · Open Engagements (filtered count) |

### 2. Contacts — **extend the existing shared table from doc 09** (do not create a second one)
Add: Client (linked_record → Clients), Slack ID (text), Approver (checkbox — load-bearing
for approval automations), Comms Owner (single_select), Role (text), Status
(single_select: Active / Churned). Geo fields (City/State/Country, ~45% and falling)
are cut. One contacts table serves lead → client conversion natively.

### 3. Team Members
Name (text, primary) · Role (multi_select, reference taxonomy) · Department
(single_select) · Status (single_select: Active / Inactive) · Work Email (email) ·
Slack User ID (text) · Asana GID (text). (Profile photo: cut, 1/146 fill.)

### 4. Assignments (temporal junction, kept from reference — it's well-designed)
Client (link) · Team Member (link) · Role (single_select) · Department (single_select) ·
Start (date) · End (date) · Reason (single_select: Transitioned / Churn / Employee Left /
Other) · Notes cut (0% fill). "Is Active" formula-chain dies — filtered rollups on
Clients replace it. **Integrity rule (n8n/agent behavior, not schema): Status→Churned
end-dates open assignments and engagements.**

### 5. Engagements (née Scopes — the contract/service record)
Client (link) · Service (single_select) · Type (single_select: Full Service / Landing
Pages / Strategy & Execution / …) · Start (date) · End (date — set by the churn flow;
manual fill was 2%) · Monthly Fee (**currency** — absent from the entire reference
base; arrives via Sales-CRM Agreement conversion) · Emails per month (number) · SMS
per month (number) · Direct Mail per month (number) · Notes (long_text). Deliverable
counts were text in the reference; they are numbers here.

### 6. Client Docs (replaces the per-year URL columns and the Docs & Resources table)
Client (link) · Doc Type (single_select: Prompt Doc / Content Calendar / CR Copy Doc /
WIP Copy Doc / Flow Copy Doc / Figma WIP / Figma CR / Internal Folder / External
Folder / Brand Guidelines / Other) · Year (number) · URL (url) · Notes (text).
Rows scale by year for free; the questionnaire automation queries (client, "Prompt
Doc", current year) via the API.

### 7. Prompt Doc Cycles (the Tracker, rebuilt properly — the "Client List" table dies)
Client (link — was free text) · Year (number) · Month (single_select) · Doc URL (url) ·
Slack Thread TS (text) · Sent At (datetime) · Due (date) · Status (single_select:
Pending / Sent / Filled / Overdue / Archived) · Word Count (number) · Reminder Count
(number) · Filled Via (single_select: Slack / Dashboard). Written by n8n through
/api/v1; enrollment = query Clients where Answer Prompts is true.

### 8. Discount Codes
Client (link — was free text) · Code (text) · Discount (text) · Team (single_select:
Email / Paid) · Status (single_select: Active / Message Sent) · Notes (text).

### 9. Tech Stack (catalog, kept minimal)
Software (text, primary) · Category (single_select, reference taxonomy). Linked from
Clients; the reference's Capabilities/Logo/Notes (≤4/47 fill) are cut. If it stays
unlinked in practice after a quarter, delete the table.

## Views (seeded)
Clients: All Clients (grid) · Active (grid, Status=Active) · By Status (kanban,
groupBy Status). Assignments: Active (grid, End is_empty). Engagements: Open (grid,
End is_empty). Prompt Doc Cycles: Current Month (grid — month filter noted as a gap
if the grammar can't express it). Grids for the rest.

## Documented cuts (numbers in the analysis)
Slack Channels table, Processes table, Docs & Resources table, Prompt Docs Client
List table · Fields: Docs & Resources twin link, Client Directory copy, Start/End
Date (P), Hold Co, Approval Threads link (returns with the approvals machinery,
designed for Roam later), Active Paid PM rollup, per-year doc columns, contact geo
fields, assignment/tech-stack dead fields.

## Engine work this spec pulls forward
1. **Filtered lookups/rollups** — options gain an optional `filters` clause over the
   linked table's concrete fields, reusing the view-filter grammar (is_empty /
   is_not_empty / eq / neq at minimum). Replaces the reference's 4-formula chain.
2. Noted, not blocking: rollup MIN/MAX over date fields (ISO strings order
   lexicographically ≡ chronologically — verify and test, no new type needed);
   relative-date view filters (already flagged in doc 09).

## Out of scope
Approvals machinery (needs the monthly-delivery-loop discovery that's still open),
the analytics backbone, native forms, multi-user, importing reference-base records
(test-row pollution documented: "Abubakar Internal Test" etc.).
