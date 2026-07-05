import React from 'react'
import { EssayEffects } from '@/components/EssayEffects'

export const metadata = { title: 'Heraclitus was wrong about your customers' }

export default function Page() {
  return (
    <>
      <header>
        <div className="wrap header-in">
          <a className="mark" href="/">roam<sup>®</sup></a>
          <div className="nav-right">
            <nav>
              <a href="/#work">Work</a>
              <a href="/#writing">Writing</a>
              <a href="/#services">Approach</a>
            </nav>
            <a className="btn-apply" href="/apply">Work with us</a>
          </div>
        </div>
      </header>
      
      <article>
        <div className="art-head">
          <span className="kicker eyebrow"><span className="k-dot"></span>Field notes — No. 04</span>
          <h1 className="art-title">Heraclitus was wrong about your <em>customers</em></h1>
          <p className="art-dek">The river changes. The good ones step back in anyway. On habit, memory, and the quiet engineering that makes returning the easy choice.</p>
          <div className="byline">
            <span className="avatar">r</span>
            <div className="byline-meta">
              <div className="byline-name">Jacob Sappington</div>
              <div className="byline-date">Jul 2026 · 6 min read</div>
            </div>
          </div>
        </div>
      
        <figure className="art-hero">
          <div className="art-hero-media"><canvas id="poolArt"></canvas></div>
          <figcaption>The pool at the end of the funnel. Everyone gets out; the question is who gets back in.</figcaption>
        </figure>
      
        <div className="prose">
          <p className="lead">Twenty-five centuries ago, Heraclitus looked at a river and declared that no one ever steps into the same one twice. The water moves on; so do you. Philosophers have nodded along ever since. So, without knowing it, has every growth team that treats a customer as a transaction with a pulse — acquired once, monetized once, replaced when the water moves on.</p>
          <p>Here's the problem: your best customers step into the same river constantly. The same coffee, the third reorder of the same moisturizer, the same denim brand for fifteen years. Nobody does this because the river stayed still. The product changed, the price changed, they changed. They return anyway.</p>
          <p>Heraclitus was right about rivers and wrong about people, because he missed the thing retention marketers get paid to understand: <em>people don't return to things. They return to feelings they can reliably reproduce.</em></p>
      
          <h2>What loyalty actually is</h2>
          <p>Strip the sentiment off the word "loyalty" and what's underneath is mechanical: a remembered satisfaction, a low-friction path back to it, and a nudge that arrives before the memory fades. That's the whole machine. Brands that retain well don't have more lovable products — they have shorter, better-lit paths back to the register.</p>
          <div className="pull">Loyalty is not a feeling. It's a path of least resistance that happens to <span>point at you.</span></div>
          <p>This is why "brand love" campaigns retain nobody. Love is not the operative variable; <em>reproducibility</em> is. A customer who had one great experience owns a memory. A customer who can reproduce that experience on demand — same quality, right timing, zero effort — owns a habit. Memories fade on their own schedule. Habits fade on yours.</p>
      
          <h2>The three levers</h2>
          <p>Every retention system we build pulls the same three levers, in this order. <em>Memory:</em> show up before they've forgotten why they liked you — which is measurable, and earlier than you think. <em>Timing:</em> replenishment on the product's actual usage curve, not a calendar guess; win-backs at the moment churn risk spikes, not after it's certain. <em>Ease:</em> the reorder should be one tap from the email. Every field they re-type is a percentage point of people who wander off mid-river.</p>
          <p>None of this is romantic. All of it compounds. A brand that lifts repeat purchase rate from 21% to 34% hasn't made customers more sentimental — it has made returning <em>cheaper than leaving</em>, cognitively and practically. Run that math over two years and it outperforms any acquisition budget you could approve.</p>
      
          <div className="inset">
            <h3>One essay, most Sundays. The playbook, <em>given away.</em></h3>
            <p>What we're learning inside real retention accounts — written so you can use it, whether or not you hire us.</p>
            <form className="js-news" noValidate>
              <input type="email" placeholder="you@yourbrand.com" autoComplete="email" required />
              <button type="submit">Subscribe →</button>
            </form>
          </div>
      
          <h2>Step into the same river</h2>
          <p>So run the experiment Heraclitus never did. Pick your hundred best customers — real spend, real frequency. Look at the last time each of them bought. For every one past their usual gap, ask the only question that matters: <em>what would make stepping back in the easiest thing they do today?</em> Then send that. Not a discount — a path.</p>
          <p>The river will be different. It always is. Build the path well enough and they'll step in anyway — again, and again, and again.</p>
          <p className="art-sig">— Jacob, somewhere along the river</p>
        </div>
      
        <div className="art-end">
          <div className="feedback" id="feedback">
            <span className="eyebrow">Worth your inbox?</span>
            <button className="fb" type="button">Absolutely</button>
            <button className="fb" type="button">Sure</button>
            <button className="fb" type="button">Not really</button>
          </div>
        </div>
      
        <div className="related">
          <div className="section-head">
            <span className="eyebrow">Keep reading</span>
            <span className="eyebrow">Field notes</span>
          </div>
          <a className="rel-row" href="/essay">
            <span className="rel-thumb"><canvas data-thumb="rings"></canvas></span>
            <span className="rel-title">Your welcome flow is a first date. Stop proposing.</span>
            <span className="rel-date">May 2026</span>
          </a>
          <a className="rel-row" href="/essay">
            <span className="rel-thumb"><canvas data-thumb="coin"></canvas></span>
            <span className="rel-title">What does a customer owe you? Nothing. Start there.</span>
            <span className="rel-date">Apr 2026</span>
          </a>
          <a className="rel-row" href="/essay">
            <span className="rel-thumb"><canvas data-thumb="spiral"></canvas></span>
            <span className="rel-title">The discount death spiral, and how to climb out of it</span>
            <span className="rel-date">Mar 2026</span>
          </a>
        </div>
      </article>
      
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
      <EssayEffects />
    </>
  )
}
