const CARDS = [
  {
    eyebrow: '01 · Data',
    title: 'Own your data',
    body: 'Every customer, order, and engagement event lands in one warehouse you control — not scattered across a dozen app dashboards. Query it, export it, keep it after we’re gone.',
  },
  {
    eyebrow: '02 · Campaigns',
    title: 'Data-backed campaigns',
    body: 'Every email and SMS is targeted by RFM segment, lifecycle stage, and churn-risk score — not a guess about who "might" be interested. The send list is the strategy.',
  },
  {
    eyebrow: '03 · Operations',
    title: 'Agentic operations',
    body: 'AI drafts the segments, the copy, and the weekly report from your live data. Your team reviews and approves before anything ships — speed without losing the wheel.',
  },
]

export function HowItWorks() {
  return (
    <section id="how-it-works" className="section">
      <div className="container">
        <div className="section-head reveal">
          <span className="eyebrow eyebrow--muted">How it works</span>
          <h2 className="display display--md">The platform, translated into what you get.</h2>
          <p className="lede">
            RetentionOS is the infrastructure. Here&rsquo;s what it actually changes for your
            team.
          </p>
        </div>
        <div className="how__grid">
          {CARDS.map((card) => (
            <div key={card.title} className="card reveal">
              <span className="eyebrow">{card.eyebrow}</span>
              <h3 className="card__title">{card.title}</h3>
              <p className="card__body">{card.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
