const STEPS = [
  {
    num: '01',
    title: 'Audit',
    body: 'We map your current stack, data gaps, and lifecycle blind spots in the first two weeks — what you have, what’s missing, and what it’s costing you.',
  },
  {
    num: '02',
    title: 'Instrument',
    body: 'We stand up the RetentionOS warehouse and connect it to your store, ESP, and support tools, so every customer event lands in one place you own.',
  },
  {
    num: '03',
    title: 'Launch',
    body: 'We ship the first wave of RFM- and churn-informed lifecycle campaigns within 30 days — real sends, targeted by real signal, not a strategy deck.',
  },
  {
    num: '04',
    title: 'Compound',
    body: 'Every send retrains the models. Every quarter the targeting gets sharper, the segments get smaller and more precise, and the returns compound.',
  },
]

export function Approach() {
  return (
    <section id="approach" className="section">
      <div className="container">
        <div className="section-head reveal">
          <span className="eyebrow eyebrow--muted">Approach</span>
          <h2 className="display display--md">A sequence, not a sprint.</h2>
          <p className="lede">
            Four stages, run in order. Each one only works because of the one before it.
          </p>
        </div>
        <ol className="approach__list">
          {STEPS.map((step) => (
            <li key={step.num} className="approach__step reveal">
              <span className="approach__num tabular">{step.num}</span>
              <div>
                <h3 className="approach__step-title">{step.title}</h3>
                <p className="approach__step-body">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
