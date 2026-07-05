import React from 'react'
import { HomeEffects } from '@/components/HomeEffects'

export default function Page() {
  return (
    <>
      <header>
        <div className="wrap header-in">
          <a className="mark" href="#">roam<sup>®</sup></a>
          <div className="nav-right">
            <nav>
              <a href="#work">Work</a>
              <a href="#writing">Writing</a>
              <a href="#services">Approach</a>
            </nav>
            <a className="btn-apply" href="/apply">Work with us</a>
          </div>
        </div>
      </header>
      
      <section className="hero wrap">
        <h1>Anyone can get them in the door. We bring them <em>back.</em></h1>
        <div className="hero-cta">
          <a className="btn-hero" href="/apply">Apply to work with us <span aria-hidden="true">→</span></a>
          <a className="hero-secondary" href="#work">See the work</a>
        </div>
        <div className="hero-foot">
          <p><strong>Roam is a retention studio for commerce brands.</strong> Email, SMS, loyalty and lifecycle — engineered so your best customers buy again. And again.</p>
          <svg className="loop" viewBox="0 0 240 90" aria-hidden="true">
            <path id="loopPath" d="M4 46 C 60 6, 150 2, 210 24 C 244 38, 240 66, 196 72 C 150 78, 96 66, 60 52"/>
            <path className="head" d="M60 52 l14 -5 -4 12 z"/>
          </svg>
        </div>
      </section>
      
      <section className="logos wrap">
        <span className="eyebrow reveal">Brands people come back to</span>
        <div className="logo-grid reveal">
          <div className="logo-cell"><span className="lg-serif">Meridian<i>&amp;Co.</i></span></div>
          <div className="logo-cell"><span className="lg-caps">HALCYON</span></div>
          <div className="logo-cell"><span className="lg-low">verdant</span></div>
          <div className="logo-cell"><span className="lg-wide">ATLAS<span className="lg-small">®</span></span></div>
          <div className="logo-cell"><span className="lg-mono">field_supply</span></div>
          <div className="logo-cell"><span className="lg-serif"><i>Maison</i> Rou</span></div>
          <div className="logo-cell"><span className="lg-caps">KINDRED</span></div>
          <div className="logo-cell"><span className="lg-low">solstice.</span></div>
        </div>
      </section>
      
      <section className="proof wrap">
        <div className="proof-grid">
          <div className="proof-cell reveal">
            <div className="proof-num">+38<span className="unit">%</span><sup className="fn"><a href="#fn1">1</a></sup></div>
            <span className="eyebrow">Average lift in repeat purchase rate across accounts</span>
          </div>
          <div className="proof-cell reveal" style={{transitionDelay:'.08s'} as React.CSSProperties}>
            <div className="proof-num">$41<span className="unit">M</span><sup className="fn"><a href="#fn2">2</a></sup></div>
            <span className="eyebrow">Retained revenue driven for clients in 2025</span>
          </div>
          <div className="proof-cell reveal" style={{transitionDelay:'.16s'} as React.CSSProperties}>
            <div className="proof-num">9.2<span className="unit">×</span><sup className="fn"><a href="#fn3">3</a></sup></div>
            <span className="eyebrow">Blended return on retention spend, portfolio-wide</span>
          </div>
        </div>
      </section>
      
      <section className="figure wrap">
        <div className="section-head">
          <span className="eyebrow">Fig. 1 — Why retention compounds</span>
          <span className="eyebrow">Cumulative revenue per customer</span>
        </div>
        <div className="fig-frame reveal">
          <div className="fig-legend">
            <span><i className="dot" style={{'--c':'#43A873'} as React.CSSProperties}></i>With a retention system</span>
            <span><i className="dot" style={{'--c':'#B37F42'} as React.CSSProperties}></i>Without one</span>
          </div>
          <div id="chart"></div>
          <div className="fig-tip" id="figTip" hidden></div>
        </div>
        <p className="fig-caption">Fig. 1 — Twenty-four months of one customer, twice. The gap is the business.<sup className="fn"><a href="#fn4">4</a></sup></p>
      </section>
      
      <section className="work wrap" id="work">
        <div className="section-head">
          <span className="eyebrow">Selected work</span>
          <span className="eyebrow">2024 — 2026</span>
        </div>
      
        <article className="case reveal">
          <div className="case-media">
            <canvas data-art="denim"></canvas>
            <div className="grain"></div>
            <span className="tag">Campaign film — 0:48</span>
            <div className="play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 3.5v17l14-8.5z"/></svg></div>
          </div>
          <div className="case-cap">
            <div>
              <div className="case-name">Meridian &amp; Co. — heritage denim</div>
              <p className="case-note">Full lifecycle rebuild: 34 flows, win-back architecture, VIP tiering. High-res campaign stills and film live here.</p>
            </div>
            <div className="case-metric"><b>+212%</b><span>email revenue, 6 months</span></div>
          </div>
        </article>
      
        <article className="case reveal">
          <div className="case-media">
            <canvas data-art="skin"></canvas>
            <div className="grain"></div>
            <span className="tag">Product photography</span>
          </div>
          <div className="case-cap">
            <div>
              <div className="case-name">Halcyon — clinical skincare</div>
              <p className="case-note">A replenishment engine timed to actual usage, not guesswork.</p>
            </div>
            <div className="case-metric"><b>21→34%</b><span>repeat purchase rate</span></div>
          </div>
        </article>
      
        <article className="case reveal">
          <div className="case-media">
            <canvas data-art="coffee"></canvas>
            <div className="grain"></div>
            <span className="tag">Brand imagery</span>
          </div>
          <div className="case-cap">
            <div>
              <div className="case-name">Solstice — specialty coffee</div>
              <p className="case-note">Churn-risk scoring plus a save-flow that pays for itself weekly.</p>
            </div>
            <div className="case-metric"><b>−31%</b><span>monthly churn</span></div>
          </div>
        </article>
      </section>
      
      <section className="services wrap" id="services">
        <div className="section-head">
          <span className="eyebrow">What we run</span>
          <span className="eyebrow">Owned channels, end to end</span>
        </div>
        <div className="rows">
          <div className="row reveal">
            <div className="row-name">Lifecycle &amp; Email</div>
            <p className="row-note">Flows and campaigns that read like your brand and sell like your best salesperson.</p>
          </div>
          <div className="row reveal">
            <div className="row-name">SMS &amp; Push</div>
            <p className="row-note">The channel most brands ruin. We treat the inbox like an invitation, not an interruption.</p>
          </div>
          <div className="row reveal">
            <div className="row-name">Loyalty &amp; Subscription</div>
            <p className="row-note">Programs worth joining — designed for the second, fifth, and fifteenth order.</p>
          </div>
          <div className="row reveal">
            <div className="row-name">Retention Data &amp; CRO</div>
            <p className="row-note">We find exactly where customers leak out of your funnel. Then we seal it.</p>
          </div>
        </div>
      </section>
      
      <section className="notes wrap" id="writing">
        <div className="section-head">
          <span className="eyebrow">Field notes</span>
          <span className="eyebrow">Thinking, in public</span>
        </div>
      
        <a className="feature reveal" href="/essay">
          <div className="feature-media">
            <canvas id="poolArt"></canvas>
            <span className="tag">Latest essay</span>
          </div>
          <div className="feature-cap">
            <span className="feature-kicker">Jul 2026 — In Field Notes</span>
            <h3 className="feature-title">Heraclitus was wrong about your customers</h3>
            <p className="feature-dek">The river changes. The good ones step back in anyway. On habit, memory, and the quiet engineering that makes returning the easy choice.</p>
            <span className="feature-read">Read the essay →</span>
          </div>
        </a>
        
      
        <div className="rows">
          <a className="note-row reveal" href="/essay">
            <span className="note-title">Your welcome flow is a first date. Stop proposing.</span>
            <span className="note-date">May 2026</span>
          </a>
          <a className="note-row reveal" href="/essay">
            <span className="note-title">What does a customer owe you? Nothing. Start there.</span>
            <span className="note-date">Apr 2026</span>
          </a>
          <a className="note-row reveal" href="/essay">
            <span className="note-title">The discount death spiral, and how to climb out of it</span>
            <span className="note-date">Mar 2026</span>
          </a>
        </div>
        <a className="all-notes" href="/essay">All field notes →</a>
      </section>
      
      <section className="endnotes wrap">
        <span className="eyebrow">Notes</span>
        <ol>
          <li id="fn1">Median across 14 client accounts, 2024–2025, measured against 12-month holdouts. Yes, really.</li>
          <li id="fn2">Incremental revenue attributed via holdout testing — not last-click, not vibes.</li>
          <li id="fn3">Blended across email, SMS, and loyalty spend. Slow months included.</li>
          <li id="fn4">The shape is real; the dollars are a composite account drawn to scale. Your curve gets drawn in the first 90 days.</li>
        </ol>
      </section>
      
      <section className="cta-block" id="newsletter">
        <div className="cta-aurora" aria-hidden="true"><div className="a1"></div><div className="a2"></div><div className="a3"></div></div>
        <div className="wrap cta-in">
          <div className="cta-grid">
            <div>
              <span className="eyebrow">Field notes, delivered</span>
              <h2>One essay, most Sundays. The playbook, <em>given away.</em></h2>
              <span className="cta-mail">What we're learning inside real retention accounts —<br />written so you can use it, whether or not you hire us.</span>
            </div>
            <form id="newsForm" className="news-form" noValidate>
              <div className="form-field">
                <label className="form-label" htmlFor="nf-email">Email</label>
                <input className="form-input" id="nf-email" name="email" type="email" autoComplete="email" placeholder="you@yourbrand.com" required />
              </div>
              <button className="form-send" type="submit">Subscribe →</button>
              <span className="form-note">Free. Unsubscribe anytime — we won't take it personally.</span>
            </form>
          </div>
        </div>
      </section>
      
      
      <footer className="bigfoot">
        <div className="wrap">
          <div className="bf-top">
            <div className="bf-brand">
              <span className="bf-wm">roam<sup>®</sup></span>
              <p className="bf-tag">Again <em>&amp; again.</em></p>
              <p className="bf-sub">A retention studio for commerce brands. Essays on why customers come back — one most Sundays, free.</p>
            </div>
            <div className="bf-cols">
              <div className="bf-col">
                <span className="bf-h">Studio</span>
                <a href="{{HOME}}#work">Work</a>
                <a href="{{HOME}}#services">Approach</a>
                <a href="{{HOME}}#writing">Writing</a>
                <a href="{{APPLY}}">Work with us</a>
              </div>
              <div className="bf-col">
                <span className="bf-h">Connect</span>
                <a href="mailto:hello@roam.studio">hello@roam.studio</a>
                <a href="#">Twitter / X</a>
                <a href="#">LinkedIn</a>
                <a href="#">Instagram</a>
              </div>
              <div className="bf-col">
                <span className="bf-h">The fine print</span>
                <a href="{{TERMS}}">Terms of Service</a>
                <a href="{{TERMS}}">Privacy Policy</a>
                <a href="{{HOME}}#newsletter">Newsletter</a>
              </div>
            </div>
          </div>
          <div className="bf-bottom">
            <span>© 2026 Roam Studio</span>
            <span>Working worldwide, from wherever we are</span>
          </div>
        </div>
      </footer>
      <HomeEffects />
    </>
  )
}
