const STATS = [
  { value: '4.2x', label: 'Email-attributed revenue' },
  { value: '31%', label: 'Of revenue from repeat customers' },
  { value: '<48h', label: 'To ship a new segment' },
]

export function Results() {
  return (
    <section id="results" className="section">
      <div className="container">
        <div className="section-head reveal">
          <span className="eyebrow eyebrow--muted">Results</span>
          <h2 className="display display--md">What owning your data actually unlocks.</h2>
        </div>

        <blockquote className="quote reveal">
          <p className="quote__text">
            For the first time we could see exactly which customers were about to churn — and
            stop it before it happened.
          </p>
          <footer className="quote__attribution">
            VP Growth, DTC apparel brand{' '}
            <span className="quote__sample-tag">(sample quote — illustrative)</span>
          </footer>
        </blockquote>

        <div className="stats-row">
          {STATS.map((stat) => (
            <div key={stat.label} className="stat reveal">
              <div className="stat__value tabular">{stat.value}</div>
              <div className="stat__label">{stat.label}</div>
            </div>
          ))}
        </div>
        <p className="illustrative-note">
          Illustrative — figures and quote shown are representative examples, not client-verified
          results.
        </p>
      </div>
    </section>
  )
}
