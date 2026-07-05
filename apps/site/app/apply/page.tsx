import React from 'react'
import { ApplyEffects } from '@/components/ApplyEffects'

export const metadata = { title: 'Work with us' }

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
          </div>
        </div>
      </header>
      
      <div className="wrap">
        <div className="page-head">
          <span className="eyebrow">Work with us</span>
          <h1 className="page-title">Tell us what's <em>slipping.</em></h1>
          <p className="page-dek"><strong>Roam is a retention studio for commerce brands, and we take on a handful of clients at a time.</strong> This form is how the conversation starts. Ten questions, three minutes — enough for us to arrive at the first call already knowing your business.</p>
        </div>
      
        <div className="apply-grid">
          <form className="form-card" id="applyForm" noValidate>
            <div className="fieldset">
              <div className="legend">About <em>you</em></div>
              <div className="two">
                <div className="form-field">
                  <label className="form-label" htmlFor="f-first">First name <span className="req">*</span></label>
                  <input className="form-input" id="f-first" type="text" autoComplete="given-name" required />
                </div>
                <div className="form-field">
                  <label className="form-label" htmlFor="f-last">Last name <span className="req">*</span></label>
                  <input className="form-input" id="f-last" type="text" autoComplete="family-name" required />
                </div>
                <div className="form-field">
                  <label className="form-label" htmlFor="f-email">Email <span className="req">*</span></label>
                  <input className="form-input" id="f-email" type="email" autoComplete="email" required />
                </div>
                <div className="form-field">
                  <label className="form-label" htmlFor="f-role">Your role <span className="req">*</span></label>
                  <input className="form-input" id="f-role" type="text" placeholder="Founder, CMO, Head of Retention…" />
                </div>
              </div>
            </div>
      
            <div className="fieldset">
              <div className="legend">About the <em>brand</em></div>
              <div className="two">
                <div className="form-field">
                  <label className="form-label" htmlFor="f-brand">Brand name <span className="req">*</span></label>
                  <input className="form-input" id="f-brand" type="text" />
                </div>
                <div className="form-field">
                  <label className="form-label" htmlFor="f-url">Website <span className="req">*</span></label>
                  <input className="form-input" id="f-url" type="url" placeholder="https://" />
                </div>
                <div className="form-field">
                  <label className="form-label" htmlFor="f-rev">Annual revenue <span className="req">*</span></label>
                  <select defaultValue="" className="form-input" id="f-rev">
                    <option value="" disabled>Select…</option>
                    <option>Under $1M</option>
                    <option>$1M – $5M</option>
                    <option>$5M – $20M</option>
                    <option>$20M – $100M</option>
                    <option>$100M+</option>
                  </select>
                </div>
                <div className="form-field">
                  <label className="form-label" htmlFor="f-list">Email + SMS list size</label>
                  <select defaultValue="" className="form-input" id="f-list">
                    <option value="" disabled>Select…</option>
                    <option>Under 25k</option>
                    <option>25k – 100k</option>
                    <option>100k – 500k</option>
                    <option>500k+</option>
                    <option>Honestly, not sure</option>
                  </select>
                </div>
              </div>
              <div className="form-field">
                <label className="form-label" htmlFor="f-hear">How did you hear about roam?</label>
                <input className="form-input" id="f-hear" type="text" placeholder="A friend, an essay, the Sunday email…" />
              </div>
              <div className="form-field">
                <label className="form-label" htmlFor="f-msg">What's slipping? <span className="req">*</span></label>
                <textarea className="form-input" id="f-msg" rows={4} placeholder="Where are customers leaking away? What have you tried? What should be true a year from now?"></textarea>
              </div>
            </div>
      
            <div className="fieldset">
              <div className="legend">What should we <em>run?</em></div>
              <div className="checks">
                <label className="check"><input type="checkbox" value="Lifecycle & Email" /> Lifecycle &amp; Email</label>
                <label className="check"><input type="checkbox" value="SMS & Push" /> SMS &amp; Push</label>
                <label className="check"><input type="checkbox" value="Loyalty & Subscription" /> Loyalty &amp; Subscription</label>
                <label className="check"><input type="checkbox" value="Retention Data & CRO" /> Retention Data &amp; CRO</label>
                <label className="check"><input type="checkbox" value="Not sure — tell us" /> Not sure — you tell us</label>
              </div>
            </div>
      
            <button className="form-send" type="submit">Send application →</button>
            <span className="form-note">Replies within one business day. No decks over 12 slides. No lock-in.</span>
          </form>
        </div>
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
      <ApplyEffects />
    </>
  )
}
