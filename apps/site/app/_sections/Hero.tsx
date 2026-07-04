import { AmbientField } from './ClientEffects'
import { BOOK_CALL_HREF } from './constants'

export function Hero() {
  return (
    <section className="hero">
      <div className="hero__glow" aria-hidden="true" />
      <AmbientField />
      <div className="container">
        <div className="hero__content reveal">
          <span className="eyebrow">AI-native retention</span>
          <h1 className="display display--xl">Retention that compounds.</h1>
          <p className="lede lede--lg">
            We give DTC brands one owned data warehouse and a lifecycle engine that runs on it —
            every email and SMS targeted by real signal, not guesses. You keep the data. We keep
            the growth compounding.
          </p>
          <div className="hero__ctas">
            <a href={BOOK_CALL_HREF} className="btn btn--primary">
              Book a call
            </a>
            <a href="#how-it-works" className="btn btn--ghost">
              See how it works
            </a>
          </div>
          <div className="hero__meta tabular">
            <span>Owned data</span>
            <span>Lifecycle automation</span>
            <span>Agentic operations</span>
          </div>
        </div>
      </div>
    </section>
  )
}
