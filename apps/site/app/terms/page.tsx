import React from 'react'
import { TermsEffects } from '@/components/TermsEffects'

export const metadata = { title: 'Terms of Service & Privacy Policy' }

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
      
      <div className="doc-head">
        <span className="eyebrow">The fine print</span>
        <h1 className="doc-title">Terms of Service <em>&amp;</em> Privacy Policy</h1>
        <p className="doc-updated">Last updated July 2026 — written to be read, not skimmed past.</p>
      </div>
      
      <div className="doc">
        <div className="plain">
          <span className="eyebrow">The plain-English version</span>
          <p>Legal documents are where honesty goes to hide, so here's ours in the open. Below are summaries of what the fine print actually says. The full text follows, and it's binding — but if a summary and the legalese ever seem to disagree, tell us, because that's a bug in our writing, not a trap for you.</p>
          <p><em>The deal:</em> don't misuse the site or republish our essays as your own, and we'll keep the lights on and treat you like an adult.</p>
          <p><em>Your data:</em> we collect what you type into our forms and the basics of how the site is used. We use it to reply to you, send you essays you asked for, and make the site better. We don't sell it. Full stop.</p>
          <p><em>Email:</em> you only get the newsletter if you subscribed. Every send has a working unsubscribe link, and it works the first time — we're a retention studio; if our own emails annoy you, we deserve the churn.</p>
          <p className="doc-sig">— roam, writing its own fine print at a reasonable hour</p>
        </div>
      
        <hr className="rule" />
      
        <h2>Terms of Service</h2>
        <p>Welcome. These terms cover your use of roam.studio — the site, the essays, and the forms (together, "the Services"), provided by Roam Studio ("roam," "we," "us").</p>
        <h3>Using the Services</h3>
        <p>By using the Services you agree to these terms. Use them lawfully and like a decent person: don't interfere with the site's operation, don't scrape or republish our content wholesale, and don't misrepresent yourself in our forms. You may quote and link to our essays with attribution — we write them to be shared.</p>
        <h3>Our content</h3>
        <p>The essays, artwork, and design of this site belong to roam. Reading, sharing, and quoting with attribution is encouraged. Wholesale republication, or passing our work off as yours, is not.</p>
        <h3>No guarantees</h3>
        <p>The Services are provided "as is." Our essays are informed opinion, not a promise about your results — every brand's numbers are its own. Client engagements are governed by their own signed agreements, which supersede these terms where they overlap.</p>
        <h3>Liability</h3>
        <p>To the maximum extent permitted by law, roam isn't liable for indirect, incidental, or consequential damages arising from your use of the Services. Where liability can't be excluded, it's limited to what you paid us to use this website — which is nothing.</p>
        <h3>Changes</h3>
        <p>We may update these terms; the date above always tells you when. Meaningful changes get a note on this page, not a silent edit.</p>
      
        <hr className="rule" />
      
        <h2>Privacy Policy</h2>
        <h3>What we collect</h3>
        <p>Two kinds of things. What you give us: your name, email, and whatever you write into the newsletter or application forms. What the site observes: standard, boring analytics — pages visited, rough region, device type. No creepy cross-site tracking, no data brokers.</p>
        <h3>What we do with it</h3>
        <p>Reply to you, send the newsletter you subscribed to, evaluate whether we can help your brand, and understand which essays people actually read. That's the list. We use a small set of service providers to do this (email delivery, analytics, form handling), each bound to use your data only to provide their service to us.</p>
        <h3>What we never do</h3>
        <p>Sell your data. Rent your data. Add you to the newsletter because you filled out the application form. Email you after you unsubscribe.</p>
        <h3>Your choices</h3>
        <p>Unsubscribe anytime via the link in any email. Want your data deleted entirely? Write to <a href="mailto:hello@roam.studio">hello@roam.studio</a> with "delete me" in the subject and we'll handle it within 30 days, and confirm when it's done.</p>
      
        <p className="counsel">Draft for design review — have real counsel bless this before launch.</p>
      </div>
      
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
      <TermsEffects />
    </>
  )
}
