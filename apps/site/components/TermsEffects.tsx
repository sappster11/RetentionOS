// @ts-nocheck
'use client'
/* Ported verbatim from the static prototype; runs after mount. */
import { useEffect } from 'react'

export function TermsEffects() {
  useEffect(() => {
(function(){
  var hdr = document.querySelector('header');
  function onHdr(){ hdr.classList.toggle('scrolled', scrollY > 40); }
  addEventListener('scroll', onHdr, {passive:true}); onHdr();
})();

  }, [])
  return null
}
