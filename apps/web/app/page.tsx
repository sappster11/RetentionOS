// Phase 0 landing. Auth + a protected dashboard land in task 0.3 once Supabase
// credentials exist. This page is intentionally static so the app builds without env.

const phases: Array<{ n: number; name: string; done: boolean }> = [
  { n: 0, name: 'Foundations', done: false },
  { n: 1, name: 'Client CRM', done: false },
  { n: 2, name: 'Agentic Project Management', done: false },
  { n: 3, name: 'Client Data & Retention Analytics', done: false },
  { n: 4, name: 'Content Engine', done: false },
  { n: 5, name: 'Reporting Dashboards', done: false },
  { n: 6, name: 'Data Backbone / Chat-with-everything', done: false },
  { n: 7, name: 'Website', done: false },
]

export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '4rem 1.5rem' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>RetentionOS</h1>
      <p style={{ opacity: 0.7, marginTop: 0 }}>
        An owned, AI-native operating system for a retention agency.
      </p>

      <section style={{ marginTop: '2.5rem' }}>
        <h2 style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: 1, opacity: 0.6 }}>
          Build roadmap
        </h2>
        <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {phases.map((p) => (
            <li
              key={p.n}
              style={{
                display: 'flex',
                gap: '0.75rem',
                padding: '0.6rem 0',
                borderBottom: '1px solid #1c1e22',
              }}
            >
              <span style={{ opacity: 0.5, width: '3.5rem' }}>Phase {p.n}</span>
              <span>{p.name}</span>
              <span style={{ marginLeft: 'auto', opacity: 0.5 }}>{p.done ? '✓' : '—'}</span>
            </li>
          ))}
        </ol>
      </section>

      <p style={{ marginTop: '2.5rem', opacity: 0.5, fontSize: '0.85rem' }}>
        Next: wire Supabase auth (Phase 0 · task 0.3), then Phase 1 — the client CRM.
      </p>
    </main>
  )
}
