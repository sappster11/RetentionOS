'use client'

// The per-table AUTOMATIONS panel (docs/11) — a right-side overlay opened from the toolbar.
// Automations are runtime data (trigger → conditions → actions); this panel is just one
// client of /api/v1/automations — the MCP tools, n8n, and the agent are peers (agent-parity
// law), and every shape written here is re-validated by the engine on save.
//
// Modes: LIST (enable toggle + human summaries) · EDITOR (the builder) · RUNS (the per-run
// log, which is also the retry/dead-letter queue made visible).

import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AutomationAction,
  AutomationRun,
  AutomationTrigger,
  EngineAutomation,
  EngineField,
  EngineTable,
  LinkFilterCondition,
} from '@retentionos/engine'
import { api } from './apiClient'
import { isComputedType } from './fieldMeta'
import { CloseIcon, HistoryIcon, TrashIcon, ZapIcon } from './icons'

// Mirrors the engine's LINK_FILTER_OPS (client files must not value-import the engine
// barrel — it pulls in the server-only pg driver).
const LINK_OPS: { op: LinkFilterCondition['op']; label: string; noValue?: boolean; dateOnly?: boolean }[] = [
  { op: 'eq', label: 'is' },
  { op: 'neq', label: 'is not' },
  { op: 'is_empty', label: 'is empty', noValue: true },
  { op: 'is_not_empty', label: 'is not empty', noValue: true },
  { op: 'on_or_before_today', label: 'is on or before today', noValue: true, dateOnly: true },
  { op: 'on_or_after_today', label: 'is on or after today', noValue: true, dateOnly: true },
]

function opsForField(field: EngineField | undefined) {
  const isDate = field?.type === 'date' || field?.type === 'datetime'
  return LINK_OPS.filter((o) => !o.dateOnly || isDate)
}

/** Fields the builder lets conditions/action-values target: concrete scalar-ish types.
 * Arrays (multi_select, attachment, linked_record) are writable through the engine but
 * have no sane single-input editor — the agent/REST can still use them. */
function isBuilderEditableField(f: EngineField): boolean {
  return !isComputedType(f.type) && !['multi_select', 'attachment', 'linked_record'].includes(f.type)
}

const TEXTY_TYPES = new Set(['text', 'long_text', 'url', 'email'])

interface Draft {
  id: string | null
  name: string
  enabled: boolean
  allowChained: boolean
  trigger: AutomationTrigger
  condition: LinkFilterCondition[]
  actions: AutomationAction[]
}

type Mode =
  | { kind: 'list' }
  | { kind: 'edit'; draft: Draft }
  | { kind: 'runs'; automation: EngineAutomation }

function relativeTime(iso: string): string {
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

// --- Human-readable summaries (list rows + editor headers) ---------------------------

function choiceName(field: EngineField | undefined, choiceId: string | undefined): string {
  if (!choiceId) return ''
  return (field?.options.choices ?? []).find((c) => c.id === choiceId)?.name ?? choiceId
}

function triggerSummary(t: AutomationTrigger, fields: EngineField[]): string {
  if (t.type === 'record.created') return 'When a record is created'
  if (t.type === 'record.updated') {
    if (!t.fieldIds?.length) return 'When a record is updated'
    const names = t.fieldIds.map((id) => fields.find((f) => f.id === id)?.name ?? '?')
    return `When ${names.join(', ')} ${names.length === 1 ? 'changes' : 'change'}`
  }
  if (t.type === 'field.transition') {
    const f = fields.find((fl) => fl.id === t.fieldId)
    const to = choiceName(f, t.to)
    const from = t.from ? choiceName(f, t.from) : null
    return `When ${f?.name ?? 'field'} ${from ? `moves ${from} → ${to}` : `becomes ${to}`}`
  }
  return t.cron === 'daily' ? 'Every day' : `Monthly on day ${t.cron.split(':')[1]}`
}

function actionSummary(
  a: AutomationAction,
  fields: EngineField[],
  tableNames: Map<string, string>,
): string {
  if (a.type === 'webhook') {
    try {
      return `send webhook to ${new URL(a.url).host}`
    } catch {
      return 'send webhook'
    }
  }
  if (a.type === 'create_record') return `create record in ${tableNames.get(a.tableId) ?? 'table'}`
  if (a.target === 'trigger') return 'update this record'
  const lf = fields.find((f) => f.id === (a.target as { linkFieldId: string }).linkFieldId)
  return `update linked ${lf?.name ?? 'records'}`
}

// --- The panel ------------------------------------------------------------------------

export function AutomationsPanel({
  table,
  fields,
  automations,
  onAutomationsChange,
  onClose,
}: {
  table: EngineTable
  fields: EngineField[]
  automations: EngineAutomation[]
  onAutomationsChange: (next: EngineAutomation[]) => void
  onClose: () => void
}) {
  const [mode, setMode] = useState<Mode>({ kind: 'list' })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [tables, setTables] = useState<{ id: string; name: string }[]>([])
  // Field cache for OTHER tables (create_record / update-linked targets); the trigger
  // table's fields come in as a prop and seed the cache.
  const [fieldsByTable, setFieldsByTable] = useState<Map<string, EngineField[]>>(
    () => new Map([[table.id, fields]]),
  )

  useEffect(() => {
    api
      .listTables()
      .then((ts) => setTables(ts.map((t) => ({ id: t.id, name: t.name }))))
      .catch(() => {})
  }, [])

  const tableNames = useMemo(() => new Map(tables.map((t) => [t.id, t.name])), [tables])

  const ensureFields = useCallback(
    (tableId: string) => {
      if (fieldsByTable.has(tableId)) return
      api
        .describeTable(tableId)
        .then((d) => setFieldsByTable((m) => new Map(m).set(tableId, d.fields)))
        .catch(() => {})
    },
    [fieldsByTable],
  )

  // --- List actions ---------------------------------------------------------------------

  const toggleEnabled = useCallback(
    async (a: EngineAutomation) => {
      setError(null)
      const next = automations.map((x) => (x.id === a.id ? { ...x, enabled: !a.enabled } : x))
      onAutomationsChange(next)
      try {
        const saved = await api.updateAutomation(a.id, { enabled: !a.enabled })
        onAutomationsChange(next.map((x) => (x.id === saved.id ? saved : x)))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update.')
        onAutomationsChange(automations)
      }
    },
    [automations, onAutomationsChange],
  )

  const openEditor = useCallback((a: EngineAutomation | null) => {
    setError(null)
    setMode({
      kind: 'edit',
      draft: a
        ? {
            id: a.id,
            name: a.name,
            enabled: a.enabled,
            allowChained: a.allow_chained,
            trigger: a.trigger,
            condition: a.condition ?? [],
            actions: a.actions,
          }
        : {
            id: null,
            name: '',
            enabled: true,
            allowChained: false,
            trigger: { type: 'record.created' },
            condition: [],
            actions: [],
          },
    })
  }, [])

  const save = useCallback(
    async (draft: Draft) => {
      setError(null)
      setSaving(true)
      // An empty fieldIds list means "any field" — store it as absent, not [].
      const trigger =
        draft.trigger.type === 'record.updated' && !draft.trigger.fieldIds?.length
          ? { type: 'record.updated' as const }
          : draft.trigger
      try {
        if (draft.id) {
          const saved = await api.updateAutomation(draft.id, {
            name: draft.name,
            enabled: draft.enabled,
            trigger,
            condition: draft.condition,
            actions: draft.actions,
            allowChained: draft.allowChained,
          })
          onAutomationsChange(automations.map((x) => (x.id === saved.id ? saved : x)))
        } else {
          const created = await api.createAutomation({
            tableId: table.id,
            name: draft.name,
            trigger,
            condition: draft.condition,
            actions: draft.actions,
            enabled: draft.enabled,
            allowChained: draft.allowChained,
          })
          onAutomationsChange([...automations, created])
        }
        setMode({ kind: 'list' })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save automation.')
      } finally {
        setSaving(false)
      }
    },
    [automations, onAutomationsChange, table.id],
  )

  const remove = useCallback(
    async (id: string) => {
      if (!window.confirm('Delete this automation? Its run history is deleted with it.')) return
      setError(null)
      try {
        await api.deleteAutomation(id)
        onAutomationsChange(automations.filter((x) => x.id !== id))
        setMode({ kind: 'list' })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete.')
      }
    },
    [automations, onAutomationsChange],
  )

  return (
    <>
      <div style={overlayStyle} onClick={onClose} />
      <div style={panelStyle}>
        <div style={headerStyle}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 14 }}>
            <span style={{ color: 'var(--accent)', display: 'flex' }}>
              <ZapIcon size={16} />
            </span>
            Automations
            <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>· {table.name}</span>
          </span>
          <button onClick={onClose} style={iconBtn} title="Close">
            <CloseIcon size={16} />
          </button>
        </div>

        {error ? (
          <div style={{ padding: '8px 16px', color: 'var(--danger)', fontSize: 12.5, borderBottom: '1px solid var(--border)' }}>
            {error}
          </div>
        ) : null}

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {mode.kind === 'list' ? (
            <AutomationList
              automations={automations}
              fields={fields}
              tableNames={tableNames}
              onToggle={toggleEnabled}
              onEdit={(a) => openEditor(a)}
              onRuns={(a) => setMode({ kind: 'runs', automation: a })}
              onNew={() => openEditor(null)}
            />
          ) : mode.kind === 'edit' ? (
            <AutomationEditor
              draft={mode.draft}
              onDraft={(draft) => setMode({ kind: 'edit', draft })}
              fields={fields}
              tables={tables}
              fieldsByTable={fieldsByTable}
              ensureFields={ensureFields}
              saving={saving}
              onSave={() => void save(mode.draft)}
              onCancel={() => {
                setError(null)
                setMode({ kind: 'list' })
              }}
              onDelete={mode.draft.id ? () => void remove(mode.draft.id!) : undefined}
            />
          ) : (
            <RunLog automation={mode.automation} onBack={() => setMode({ kind: 'list' })} />
          )}
        </div>
      </div>
    </>
  )
}

// --- LIST -------------------------------------------------------------------------------

function AutomationList({
  automations,
  fields,
  tableNames,
  onToggle,
  onEdit,
  onRuns,
  onNew,
}: {
  automations: EngineAutomation[]
  fields: EngineField[]
  tableNames: Map<string, string>
  onToggle: (a: EngineAutomation) => void
  onEdit: (a: EngineAutomation) => void
  onRuns: (a: EngineAutomation) => void
  onNew: () => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {automations.length === 0 ? (
        <div style={{ padding: '18px 4px', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 }}>
          <p style={{ margin: 0, fontWeight: 600, color: 'var(--text)' }}>No automations on this table yet.</p>
          <p style={{ margin: '6px 0 0' }}>
            An automation watches this table — a record being created, updated, a select field
            changing to a choice, or a schedule — checks your conditions, then runs its actions:
            call a webhook, create a record, or update records.
          </p>
        </div>
      ) : (
        automations.map((a) => (
          <div
            key={a.id}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '10px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: a.enabled ? 'var(--bg)' : 'var(--bg-subtle)',
            }}
          >
            <Switch on={a.enabled} onToggle={() => onToggle(a)} />
            <button
              onClick={() => onEdit(a)}
              style={{
                flex: 1,
                border: 'none',
                background: 'transparent',
                textAlign: 'left',
                cursor: 'pointer',
                padding: 0,
                minWidth: 0,
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13, color: a.enabled ? 'var(--text)' : 'var(--text-muted)' }}>
                {a.name}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-faint)',
                  marginTop: 2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {triggerSummary(a.trigger, fields)} →{' '}
                {a.actions.map((act) => actionSummary(act, fields, tableNames)).join(', ')}
              </div>
            </button>
            <button onClick={() => onRuns(a)} style={iconBtn} title="Run log">
              <HistoryIcon size={15} />
            </button>
          </div>
        ))
      )}
      <button onClick={onNew} style={{ ...primaryBtn, alignSelf: 'flex-start', marginTop: 8 }}>
        + New automation
      </button>
    </div>
  )
}

function Switch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      role="switch"
      aria-checked={on}
      title={on ? 'On — click to turn off' : 'Off — click to turn on'}
      style={{
        width: 32,
        height: 18,
        borderRadius: 9,
        border: 'none',
        flexShrink: 0,
        background: on ? 'var(--accent)' : 'var(--border-strong)',
        position: 'relative',
        cursor: 'pointer',
        transition: 'background 0.15s',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 16 : 2,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.15s',
        }}
      />
    </button>
  )
}

// --- EDITOR -----------------------------------------------------------------------------

function AutomationEditor({
  draft,
  onDraft,
  fields,
  tables,
  fieldsByTable,
  ensureFields,
  saving,
  onSave,
  onCancel,
  onDelete,
}: {
  draft: Draft
  onDraft: (d: Draft) => void
  fields: EngineField[]
  tables: { id: string; name: string }[]
  fieldsByTable: Map<string, EngineField[]>
  ensureFields: (tableId: string) => void
  saving: boolean
  onSave: () => void
  onCancel: () => void
  onDelete?: () => void
}) {
  const selectFields = fields.filter((f) => f.type === 'single_select')
  const linkFields = fields.filter((f) => f.type === 'linked_record')
  const canSave = draft.name.trim().length > 0 && draft.actions.length > 0 && !saving

  function setTrigger(trigger: AutomationTrigger) {
    onDraft({ ...draft, trigger })
  }

  function setTriggerType(type: string) {
    if (type === 'record.created') setTrigger({ type: 'record.created' })
    else if (type === 'record.updated') setTrigger({ type: 'record.updated' })
    else if (type === 'field.transition') {
      const f = selectFields[0]
      const firstChoice = f?.options.choices?.[0]?.id ?? ''
      setTrigger({ type: 'field.transition', fieldId: f?.id ?? '', to: firstChoice })
    } else setTrigger({ type: 'schedule', cron: 'daily' })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <button onClick={onCancel} style={backLink}>
        ← All automations
      </button>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={sectionLabel}>Name</span>
        <input
          value={draft.name}
          onChange={(e) => onDraft({ ...draft, name: e.target.value })}
          placeholder="e.g. Churned clients close open assignments"
          style={{ ...selStyle, width: '100%' }}
          autoFocus={!draft.id}
        />
      </label>

      {/* TRIGGER */}
      <div style={sectionBox}>
        <div style={sectionLabel}>Trigger</div>
        <select value={draft.trigger.type} onChange={(e) => setTriggerType(e.target.value)} style={{ ...selStyle, width: '100%' }}>
          <option value="record.created">When a record is created</option>
          <option value="record.updated">When a record is updated</option>
          <option value="field.transition" disabled={selectFields.length === 0}>
            When a select field changes to…
          </option>
          <option value="schedule">On a schedule</option>
        </select>

        {draft.trigger.type === 'record.updated' ? (
          <WatchedFieldsPicker
            fields={fields}
            fieldIds={draft.trigger.fieldIds}
            onChange={(fieldIds) => setTrigger({ type: 'record.updated', ...(fieldIds ? { fieldIds } : {}) })}
          />
        ) : null}

        {draft.trigger.type === 'field.transition' ? (
          <TransitionPicker trigger={draft.trigger} selectFields={selectFields} onChange={setTrigger} />
        ) : null}

        {draft.trigger.type === 'schedule' ? (
          <SchedulePicker trigger={draft.trigger} onChange={setTrigger} />
        ) : null}
      </div>

      {/* CONDITIONS */}
      <div style={sectionBox}>
        <div style={sectionLabel}>
          Conditions{' '}
          <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
            — {draft.trigger.type === 'schedule' ? 'runs for every record where all match' : 'run only when all match'}
          </span>
        </div>
        <ConditionsEditor
          fields={fields}
          condition={draft.condition}
          onChange={(condition) => onDraft({ ...draft, condition })}
        />
      </div>

      {/* ACTIONS */}
      <div style={sectionBox}>
        <div style={sectionLabel}>Actions — run in order</div>
        <ActionsEditor
          actions={draft.actions}
          onChange={(actions) => onDraft({ ...draft, actions })}
          triggerFields={fields}
          linkFields={linkFields}
          tables={tables}
          fieldsByTable={fieldsByTable}
          ensureFields={ensureFields}
        />
      </div>

      {/* FLAGS */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => onDraft({ ...draft, enabled: e.target.checked })}
          />
          Enabled
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: 'var(--text-muted)' }}>
          <input
            type="checkbox"
            checked={draft.allowChained}
            onChange={(e) => onDraft({ ...draft, allowChained: e.target.checked })}
          />
          Allow other automations to trigger this one (chained, max depth 3)
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingBottom: 8 }}>
        <button onClick={onSave} disabled={!canSave} style={{ ...primaryBtn, opacity: canSave ? 1 : 0.5 }}>
          {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Create automation'}
        </button>
        <button onClick={onCancel} style={ghostBtn}>
          Cancel
        </button>
        <span style={{ flex: 1 }} />
        {onDelete ? (
          <button onClick={onDelete} style={{ ...ghostBtn, color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <TrashIcon size={13} /> Delete
          </button>
        ) : null}
      </div>
    </div>
  )
}

function WatchedFieldsPicker({
  fields,
  fieldIds,
  onChange,
}: {
  fields: EngineField[]
  fieldIds: string[] | undefined
  onChange: (next: string[] | undefined) => void
}) {
  const concrete = fields.filter((f) => !isComputedType(f.type))
  if (!fieldIds) {
    return (
      <button style={miniLink} onClick={() => onChange([])}>
        Limit to specific fields…
      </button>
    )
  }
  const set = new Set(fieldIds)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Only when one of these fields changes:</div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          maxHeight: 160,
          overflowY: 'auto',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: 6,
        }}
      >
        {concrete.map((f) => (
          <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={set.has(f.id)}
              onChange={(e) => {
                const next = new Set(set)
                if (e.target.checked) next.add(f.id)
                else next.delete(f.id)
                onChange(concrete.filter((fl) => next.has(fl.id)).map((fl) => fl.id))
              }}
            />
            {f.name}
          </label>
        ))}
      </div>
      <button style={miniLink} onClick={() => onChange(undefined)}>
        Watch any field instead
      </button>
    </div>
  )
}

function TransitionPicker({
  trigger,
  selectFields,
  onChange,
}: {
  trigger: Extract<AutomationTrigger, { type: 'field.transition' }>
  selectFields: EngineField[]
  onChange: (t: AutomationTrigger) => void
}) {
  const field = selectFields.find((f) => f.id === trigger.fieldId)
  const choices = field?.options.choices ?? []
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <select
          value={trigger.fieldId}
          onChange={(e) => {
            const f = selectFields.find((fl) => fl.id === e.target.value)
            onChange({ type: 'field.transition', fieldId: e.target.value, to: f?.options.choices?.[0]?.id ?? '' })
          }}
          style={{ ...selStyle, flex: 1 }}
        >
          {selectFields.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: 'var(--text-muted)' }}>
        <span>from</span>
        <select
          value={trigger.from ?? ''}
          onChange={(e) =>
            onChange({ ...trigger, from: e.target.value || undefined })
          }
          style={{ ...selStyle, flex: 1 }}
        >
          <option value="">any choice</option>
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <span>to</span>
        <select
          value={trigger.to}
          onChange={(e) => onChange({ ...trigger, to: e.target.value })}
          style={{ ...selStyle, flex: 1 }}
        >
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

function SchedulePicker({
  trigger,
  onChange,
}: {
  trigger: Extract<AutomationTrigger, { type: 'schedule' }>
  onChange: (t: AutomationTrigger) => void
}) {
  const monthly = trigger.cron.startsWith('monthly:')
  const day = monthly ? Number(trigger.cron.split(':')[1]) : 1
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <select
          value={monthly ? 'monthly' : 'daily'}
          onChange={(e) =>
            onChange({ type: 'schedule', cron: e.target.value === 'daily' ? 'daily' : `monthly:${day}` })
          }
          style={{ ...selStyle, flex: 1 }}
        >
          <option value="daily">Every day</option>
          <option value="monthly">Monthly</option>
        </select>
        {monthly ? (
          <>
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>on day</span>
            <input
              type="number"
              min={1}
              max={28}
              value={day}
              onChange={(e) => {
                const d = Math.min(28, Math.max(1, Number(e.target.value) || 1))
                onChange({ type: 'schedule', cron: `monthly:${d}` })
              }}
              style={{ ...selStyle, width: 70 }}
            />
          </>
        ) : null}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
        Fires once per matching record (see conditions), delivered by the automations cron.
      </div>
    </div>
  )
}

// --- Conditions ---------------------------------------------------------------------

function ConditionsEditor({
  fields,
  condition,
  onChange,
}: {
  fields: EngineField[]
  condition: LinkFilterCondition[]
  onChange: (next: LinkFilterCondition[]) => void
}) {
  const eligible = fields.filter(isBuilderEditableField)

  function update(i: number, patch: Partial<LinkFilterCondition>) {
    onChange(condition.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {condition.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>No conditions — always runs.</div>
      ) : (
        condition.map((c, i) => {
          const field = eligible.find((f) => f.id === c.fieldId)
          const ops = opsForField(field)
          const opDef = LINK_OPS.find((o) => o.op === c.op)
          return (
            <div key={i} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              <select
                value={c.fieldId}
                onChange={(e) => {
                  const next = eligible.find((f) => f.id === e.target.value)
                  const opStillValid = opsForField(next).some((o) => o.op === c.op)
                  update(i, {
                    fieldId: e.target.value,
                    ...(opStillValid ? {} : { op: 'eq', value: undefined }),
                    // A choice id from the old field can't be valid on the new one.
                    ...(next?.type === 'single_select' || field?.type === 'single_select' ? { value: undefined } : {}),
                  })
                }}
                style={{ ...selStyle, flex: 1, minWidth: 0 }}
              >
                {eligible.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <select
                value={c.op}
                onChange={(e) => {
                  const op = e.target.value as LinkFilterCondition['op']
                  const noValue = LINK_OPS.find((o) => o.op === op)?.noValue
                  update(i, { op, ...(noValue ? { value: undefined } : {}) })
                }}
                style={{ ...selStyle, width: 140 }}
              >
                {ops.map((o) => (
                  <option key={o.op} value={o.op}>
                    {o.label}
                  </option>
                ))}
              </select>
              {opDef?.noValue ? (
                <span style={{ flex: 1 }} />
              ) : (
                <ValueInput field={field} value={c.value} onChange={(value) => update(i, { value })} />
              )}
              <button onClick={() => onChange(condition.filter((_, j) => j !== i))} style={{ ...miniLink, color: 'var(--danger)', padding: '0 4px' }}>
                ×
              </button>
            </div>
          )
        })
      )}
      <button
        style={{ ...miniLink, alignSelf: 'flex-start' }}
        onClick={() => {
          const f0 = eligible[0]
          if (f0) onChange([...condition, { fieldId: f0.id, op: 'eq', value: '' }])
        }}
      >
        + Add condition
      </button>
    </div>
  )
}

// --- Actions --------------------------------------------------------------------------

function ActionsEditor({
  actions,
  onChange,
  triggerFields,
  linkFields,
  tables,
  fieldsByTable,
  ensureFields,
}: {
  actions: AutomationAction[]
  onChange: (next: AutomationAction[]) => void
  triggerFields: EngineField[]
  linkFields: EngineField[]
  tables: { id: string; name: string }[]
  fieldsByTable: Map<string, EngineField[]>
  ensureFields: (tableId: string) => void
}) {
  function update(i: number, next: AutomationAction) {
    onChange(actions.map((a, j) => (j === i ? next : a)))
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= actions.length) return
    const next = [...actions]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    onChange(next)
  }

  function defaultAction(type: string): AutomationAction {
    if (type === 'webhook') return { type: 'webhook', url: '' }
    if (type === 'create_record') {
      const target = tables[0]?.id ?? ''
      if (target) ensureFields(target)
      return { type: 'create_record', tableId: target, values: {} }
    }
    return { type: 'update_record', target: 'trigger', values: {} }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {actions.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>Add at least one action.</div>
      ) : (
        actions.map((a, i) => (
          <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text-faint)', width: 14, textAlign: 'center' }}>{i + 1}</span>
              <select value={a.type} onChange={(e) => update(i, defaultAction(e.target.value))} style={{ ...selStyle, flex: 1 }}>
                <option value="webhook">Send a webhook</option>
                <option value="create_record">Create a record</option>
                <option value="update_record">Update records</option>
              </select>
              <button onClick={() => move(i, -1)} disabled={i === 0} style={{ ...miniLink, opacity: i === 0 ? 0.3 : 1 }} title="Move up">
                ↑
              </button>
              <button onClick={() => move(i, 1)} disabled={i === actions.length - 1} style={{ ...miniLink, opacity: i === actions.length - 1 ? 0.3 : 1 }} title="Move down">
                ↓
              </button>
              <button onClick={() => onChange(actions.filter((_, j) => j !== i))} style={{ ...miniLink, color: 'var(--danger)' }} title="Remove action">
                ×
              </button>
            </div>

            {a.type === 'webhook' ? (
              <WebhookEditor action={a} onChange={(next) => update(i, next)} />
            ) : a.type === 'create_record' ? (
              <CreateRecordEditor
                action={a}
                onChange={(next) => update(i, next)}
                tables={tables}
                fieldsByTable={fieldsByTable}
                ensureFields={ensureFields}
                triggerFields={triggerFields}
              />
            ) : (
              <UpdateRecordEditor
                action={a}
                onChange={(next) => update(i, next)}
                triggerFields={triggerFields}
                linkFields={linkFields}
                fieldsByTable={fieldsByTable}
                ensureFields={ensureFields}
              />
            )}
          </div>
        ))
      )}
      <button style={{ ...miniLink, alignSelf: 'flex-start' }} onClick={() => onChange([...actions, defaultAction('webhook')])}>
        + Add action
      </button>
    </div>
  )
}

function WebhookEditor({
  action,
  onChange,
}: {
  action: Extract<AutomationAction, { type: 'webhook' }>
  onChange: (a: AutomationAction) => void
}) {
  const [withSecret, setWithSecret] = useState(!!action.secretHeader)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <input
        value={action.url}
        onChange={(e) => onChange({ ...action, url: e.target.value })}
        placeholder="https://… (e.g. an n8n webhook URL)"
        style={{ ...selStyle, width: '100%' }}
      />
      {withSecret ? (
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={action.secretHeader?.name ?? ''}
            onChange={(e) =>
              onChange({ ...action, secretHeader: { name: e.target.value, value: action.secretHeader?.value ?? '' } })
            }
            placeholder="Header name (e.g. x-ros-secret)"
            style={{ ...selStyle, flex: 1 }}
          />
          <input
            value={action.secretHeader?.value ?? ''}
            onChange={(e) =>
              onChange({ ...action, secretHeader: { name: action.secretHeader?.name ?? '', value: e.target.value } })
            }
            placeholder="Header value"
            style={{ ...selStyle, flex: 1 }}
          />
          <button
            style={{ ...miniLink, color: 'var(--danger)' }}
            onClick={() => {
              setWithSecret(false)
              const { secretHeader: _drop, ...rest } = action
              onChange(rest)
            }}
          >
            ×
          </button>
        </div>
      ) : (
        <button style={{ ...miniLink, alignSelf: 'flex-start' }} onClick={() => setWithSecret(true)}>
          + Add secret header
        </button>
      )}
      <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>
        POSTs the event + the record’s values. Receivers must tolerate duplicates (at-least-once delivery).
      </div>
    </div>
  )
}

function CreateRecordEditor({
  action,
  onChange,
  tables,
  fieldsByTable,
  ensureFields,
  triggerFields,
}: {
  action: Extract<AutomationAction, { type: 'create_record' }>
  onChange: (a: AutomationAction) => void
  tables: { id: string; name: string }[]
  fieldsByTable: Map<string, EngineField[]>
  ensureFields: (tableId: string) => void
  triggerFields: EngineField[]
}) {
  useEffect(() => {
    if (action.tableId) ensureFields(action.tableId)
  }, [action.tableId, ensureFields])
  const targetFields = fieldsByTable.get(action.tableId) ?? []
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: 'var(--text-muted)' }}>
        <span>in</span>
        <select
          value={action.tableId}
          onChange={(e) => onChange({ type: 'create_record', tableId: e.target.value, values: {} })}
          style={{ ...selStyle, flex: 1 }}
        >
          {tables.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <ValuesEditor
        targetFields={targetFields}
        values={action.values}
        onChange={(values) => onChange({ ...action, values })}
        triggerFields={triggerFields}
      />
    </div>
  )
}

function UpdateRecordEditor({
  action,
  onChange,
  triggerFields,
  linkFields,
  fieldsByTable,
  ensureFields,
}: {
  action: Extract<AutomationAction, { type: 'update_record' }>
  onChange: (a: AutomationAction) => void
  triggerFields: EngineField[]
  linkFields: EngineField[]
  fieldsByTable: Map<string, EngineField[]>
  ensureFields: (tableId: string) => void
}) {
  const linkFieldId = action.target === 'trigger' ? null : action.target.linkFieldId
  const linkField = linkFieldId ? linkFields.find((f) => f.id === linkFieldId) : null
  const linkedTableId = (linkField?.options as { linkedTableId?: string } | undefined)?.linkedTableId ?? null

  useEffect(() => {
    if (linkedTableId) ensureFields(linkedTableId)
  }, [linkedTableId, ensureFields])

  const targetFields = linkedTableId ? (fieldsByTable.get(linkedTableId) ?? []) : triggerFields
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: 'var(--text-muted)' }}>
        <span>update</span>
        <select
          value={linkFieldId ?? 'trigger'}
          onChange={(e) =>
            onChange({
              type: 'update_record',
              target: e.target.value === 'trigger' ? 'trigger' : { linkFieldId: e.target.value },
              values: {},
            })
          }
          style={{ ...selStyle, flex: 1 }}
        >
          <option value="trigger">the triggering record</option>
          {linkFields.map((f) => (
            <option key={f.id} value={f.id}>
              every linked “{f.name}” record
            </option>
          ))}
        </select>
      </div>
      <ValuesEditor
        targetFields={targetFields}
        values={action.values}
        onChange={(values) => onChange({ ...action, values })}
        triggerFields={triggerFields}
      />
    </div>
  )
}

/** The field→value rows shared by create_record and update_record. Text-like values
 * accept {fld:…} tokens (substituted from the trigger record at run time). */
function ValuesEditor({
  targetFields,
  values,
  onChange,
  triggerFields,
}: {
  targetFields: EngineField[]
  values: Record<string, unknown>
  onChange: (values: Record<string, unknown>) => void
  triggerFields: EngineField[]
}) {
  const eligible = targetFields.filter(isBuilderEditableField)
  const entries = Object.entries(values)
  const used = new Set(Object.keys(values))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {entries.map(([fieldId, value]) => {
        const field = eligible.find((f) => f.id === fieldId)
        const texty = !field || TEXTY_TYPES.has(field.type)
        return (
          <div key={fieldId} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            <select
              value={fieldId}
              onChange={(e) => {
                const next: Record<string, unknown> = {}
                for (const [k, v] of entries) {
                  // '' not undefined: undefined keys are dropped by JSON.stringify on save,
                  // which would silently delete the row.
                  if (k === fieldId) next[e.target.value] = ''
                  else next[k] = v
                }
                onChange(next)
              }}
              style={{ ...selStyle, width: 150 }}
            >
              {eligible
                .filter((f) => f.id === fieldId || !used.has(f.id))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
            <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>=</span>
            <ValueInput field={field} value={value} onChange={(v) => onChange({ ...values, [fieldId]: v })} />
            {texty ? (
              <TokenSelect
                fields={triggerFields}
                onInsert={(token) => onChange({ ...values, [fieldId]: `${typeof value === 'string' ? value : ''}${token}` })}
              />
            ) : null}
            <button
              onClick={() => {
                const next = { ...values }
                delete next[fieldId]
                onChange(next)
              }}
              style={{ ...miniLink, color: 'var(--danger)', padding: '0 4px' }}
            >
              ×
            </button>
          </div>
        )
      })}
      <button
        style={{ ...miniLink, alignSelf: 'flex-start' }}
        onClick={() => {
          const f0 = eligible.find((f) => !used.has(f.id))
          if (f0) onChange({ ...values, [f0.id]: '' })
        }}
        disabled={eligible.every((f) => used.has(f.id))}
      >
        + Set a field
      </button>
    </div>
  )
}

/** Typed value editor: choice select for single_select, checked/unchecked for checkbox,
 * date inputs for date/datetime, number input for numerics, else free text. */
function ValueInput({
  field,
  value,
  onChange,
}: {
  field: EngineField | undefined
  value: unknown
  onChange: (v: unknown) => void
}) {
  if (field?.type === 'single_select') {
    const choices = field.options.choices ?? []
    return (
      <select value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} style={{ ...selStyle, flex: 1, minWidth: 0 }}>
        <option value="">— pick a choice —</option>
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    )
  }
  if (field?.type === 'checkbox') {
    return (
      <select
        value={value === true ? 'true' : value === false ? 'false' : ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'true')}
        style={{ ...selStyle, flex: 1, minWidth: 0 }}
      >
        <option value="">—</option>
        <option value="true">checked</option>
        <option value="false">unchecked</option>
      </select>
    )
  }
  if (field?.type === 'date' || field?.type === 'datetime') {
    return (
      <input
        type={field.type === 'date' ? 'date' : 'datetime-local'}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        style={{ ...selStyle, flex: 1, minWidth: 0 }}
      />
    )
  }
  if (field?.type === 'number' || field?.type === 'currency' || field?.type === 'percent') {
    return (
      <input
        type="number"
        value={typeof value === 'number' ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        style={{ ...selStyle, flex: 1, minWidth: 0 }}
      />
    )
  }
  return (
    <input
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder="value — insert trigger fields with ⚡"
      style={{ ...selStyle, flex: 1, minWidth: 0 }}
    />
  )
}

function TokenSelect({ fields, onInsert }: { fields: EngineField[]; onInsert: (token: string) => void }) {
  const concrete = fields.filter((f) => !isComputedType(f.type))
  return (
    <select
      value=""
      onChange={(e) => {
        if (e.target.value) onInsert(`{fld:${e.target.value}}`)
      }}
      title="Insert a value from the trigger record"
      style={{ ...selStyle, width: 46, color: 'var(--accent)' }}
    >
      <option value="">⚡</option>
      {concrete.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </select>
  )
}

// --- RUN LOG ----------------------------------------------------------------------------

const RUN_COLORS: Record<AutomationRun['status'], { bg: string; fg: string }> = {
  queued: { bg: 'var(--bg-subtle)', fg: 'var(--text-muted)' },
  running: { bg: 'var(--accent-soft)', fg: 'var(--accent)' },
  succeeded: { bg: '#e6f4ea', fg: '#137333' },
  failed: { bg: '#fef7e0', fg: '#b05a00' },
  dead: { bg: '#fce8e6', fg: '#c5221f' },
}

function RunLog({ automation, onBack }: { automation: EngineAutomation; onBack: () => void }) {
  const [runs, setRuns] = useState<AutomationRun[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoadError(null)
    api
      .listAutomationRuns(automation.id)
      .then(setRuns)
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load runs.'))
  }, [automation.id])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <button onClick={onBack} style={backLink}>
        ← All automations
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{automation.name}</span>
        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>— run log</span>
        <span style={{ flex: 1 }} />
        <button onClick={load} style={miniLink}>
          Refresh
        </button>
      </div>

      {loadError ? <div style={{ color: 'var(--danger)', fontSize: 12.5 }}>{loadError}</div> : null}

      {runs === null ? (
        <div style={{ color: 'var(--text-faint)', fontSize: 12.5 }}>Loading…</div>
      ) : runs.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 12.5, padding: '10px 0' }}>
          No runs yet. Runs appear here when the trigger fires; failures retry with backoff
          (up to 5 attempts) before being marked dead.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {runs.map((r) => {
            const c = RUN_COLORS[r.status]
            return (
              <div key={r.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 12.5 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      padding: '1px 8px',
                      borderRadius: 10,
                      fontSize: 11,
                      fontWeight: 600,
                      background: c.bg,
                      color: c.fg,
                    }}
                  >
                    {r.status}
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>{r.trigger_event.type}</span>
                  <span style={{ flex: 1 }} />
                  {r.attempts > 1 ? (
                    <span style={{ color: 'var(--text-faint)', fontSize: 11.5 }}>attempt {r.attempts}</span>
                  ) : null}
                  <span style={{ color: 'var(--text-faint)', fontSize: 11.5 }}>{relativeTime(r.created_at)}</span>
                </div>
                {r.last_error ? (
                  <div
                    style={{
                      marginTop: 5,
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: 11.5,
                      color: 'var(--danger)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {r.last_error.length > 300 ? `${r.last_error.slice(0, 300)}…` : r.last_error}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// --- Styles -------------------------------------------------------------------------------

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.18)',
  zIndex: 90,
}

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  width: 'min(620px, 94vw)',
  background: 'var(--bg)',
  borderLeft: '1px solid var(--border-strong)',
  boxShadow: '-8px 0 30px rgba(0,0,0,0.12)',
  zIndex: 100,
  display: 'flex',
  flexDirection: 'column',
}

const headerStyle: React.CSSProperties = {
  height: 52,
  flexShrink: 0,
  borderBottom: '1px solid var(--border)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 16px',
}

const iconBtn: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  display: 'flex',
  padding: 4,
}

const sectionBox: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-faint)',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  fontWeight: 600,
}

const selStyle: React.CSSProperties = {
  padding: '5px 7px',
  border: '1px solid var(--border-strong)',
  borderRadius: 6,
  background: 'var(--bg)',
  color: 'var(--text)',
  outline: 'none',
  fontSize: 12.5,
}

const miniLink: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--accent)',
  fontSize: 12.5,
  padding: 0,
  cursor: 'pointer',
}

const backLink: React.CSSProperties = {
  ...miniLink,
  alignSelf: 'flex-start',
  color: 'var(--text-muted)',
}

const primaryBtn: React.CSSProperties = {
  padding: '6px 14px',
  border: '1px solid var(--accent)',
  borderRadius: 6,
  background: 'var(--accent)',
  color: '#fff',
  fontWeight: 500,
  fontSize: 13,
  cursor: 'pointer',
}

const ghostBtn: React.CSSProperties = {
  padding: '6px 12px',
  border: '1px solid var(--border-strong)',
  borderRadius: 6,
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 13,
  cursor: 'pointer',
}
