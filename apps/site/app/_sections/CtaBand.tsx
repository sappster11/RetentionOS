import { BOOK_CALL_HREF } from './constants'

export function CtaBand() {
  return (
    <section className="section cta-band">
      <div className="container cta-band__inner reveal">
        <h2 className="display display--lg">Let&rsquo;s make your retention compound.</h2>
        <a href={BOOK_CALL_HREF} className="btn btn--primary">
          Book a call
        </a>
      </div>
    </section>
  )
}
