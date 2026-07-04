const METRICS = [
  { value: '+22%', label: 'Repeat purchase rate' },
  { value: '3.1x', label: 'LT:CAC ratio' },
  { value: '-18%', label: '90-day churn' },
]

export function Stakes() {
  return (
    <section className="section">
      <div className="container">
        <div className="section-head reveal">
          <span className="eyebrow eyebrow--muted">The stakes</span>
          <h2 className="display display--md">Retention is where DTC margin actually lives.</h2>
          <p className="lede">
            Paid acquisition keeps getting more expensive and less reliable. The brands still
            compounding aren&rsquo;t out-bidding everyone on ads — they&rsquo;re getting more
            lifetime value out of every customer they already earned. That&rsquo;s a data problem
            before it&rsquo;s a creative problem.
          </p>
        </div>
        <div className="stakes__grid">
          {METRICS.map((metric) => (
            <div key={metric.label} className="metric-tile reveal">
              <div className="metric-tile__value tabular">{metric.value}</div>
              <div className="metric-tile__label">{metric.label}</div>
            </div>
          ))}
        </div>
        <p className="illustrative-note">
          Illustrative — figures shown are representative examples, not guaranteed outcomes.
        </p>
      </div>
    </section>
  )
}
