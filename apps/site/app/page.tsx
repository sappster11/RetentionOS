import { Approach } from './_sections/Approach'
import { RevealInit } from './_sections/ClientEffects'
import { CtaBand } from './_sections/CtaBand'
import { Footer } from './_sections/Footer'
import { Hero } from './_sections/Hero'
import { HowItWorks } from './_sections/HowItWorks'
import { Results } from './_sections/Results'
import { Stakes } from './_sections/Stakes'
import { TopBar } from './_sections/TopBar'
import { WhoItsFor } from './_sections/WhoItsFor'

// NOTE: "RetentionOS" is a placeholder agency name. The owner can rename the
// brand freely — every occurrence lives in this app under apps/site.

export default function Page() {
  return (
    <>
      <TopBar />
      <main>
        <Hero />
        <Stakes />
        <HowItWorks />
        <Approach />
        <Results />
        <WhoItsFor />
        <CtaBand />
      </main>
      <Footer />
      <RevealInit />
    </>
  )
}
