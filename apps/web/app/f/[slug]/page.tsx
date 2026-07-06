import { notFound } from 'next/navigation'
import { getFormBySlug } from '@retentionos/engine'
import { PublicForm } from './PublicForm'
import type { FormFieldDef } from '@/app/_ui/FormFields'

// PUBLIC form page — served WITHOUT auth at /f/[slug] (AppShell renders /f/* bare).
// Server component: resolve the slug through the engine, flatten the descriptor to a
// serializable shape, and hand it to the interactive client form. Submissions go to
// POST /api/forms/[slug]/submit.
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Params) {
  const { slug } = await params
  const form = await getFormBySlug(slug).catch(() => null)
  return { title: form ? (form.view.config.title ?? form.view.name) : 'Form' }
}

export default async function PublicFormPage({ params }: Params) {
  const { slug } = await params
  const form = await getFormBySlug(slug)
  if (!form) notFound()

  const fields: FormFieldDef[] = form.fields.map((ff) => ({
    id: ff.field.id,
    label: ff.label,
    type: ff.field.type,
    required: ff.required,
    ...(ff.helpText ? { helpText: ff.helpText } : {}),
    ...(ff.field.options.choices ? { choices: ff.field.options.choices } : {}),
    ...(ff.field.options.currencySymbol ? { currencySymbol: ff.field.options.currencySymbol } : {}),
  }))

  return (
    <PublicForm
      slug={slug}
      title={form.view.config.title ?? form.view.name}
      description={form.view.config.description}
      submitLabel={form.view.config.submitLabel ?? 'Submit'}
      fields={fields}
    />
  )
}
