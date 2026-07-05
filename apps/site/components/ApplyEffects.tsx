// @ts-nocheck
'use client'
/* Ported verbatim from the static prototype; runs after mount. */
import { useEffect } from 'react'

export function ApplyEffects() {
  useEffect(() => {
(function(){
  var hdr = document.querySelector('header');
  function onHdr(){ hdr.classList.toggle('scrolled', scrollY > 40); }
  addEventListener('scroll', onHdr, {passive:true}); onHdr();

  var f = document.getElementById('applyForm');
  f.addEventListener('submit', function(ev){
    ev.preventDefault();
    var v = function(id){ return (document.getElementById(id).value || '').trim(); };
    var svcs = [].map.call(document.querySelectorAll('.check input:checked'), function(c){return c.value}).join(', ');
    var subject = 'New application — ' + (v('f-brand') || (v('f-first')+' '+v('f-last')));
    var lines = [
      'Name: ' + v('f-first') + ' ' + v('f-last'),
      'Email: ' + v('f-email'),
      'Role: ' + v('f-role'),
      'Brand: ' + v('f-brand') + ' — ' + v('f-url'),
      'Annual revenue: ' + v('f-rev'),
      'List size: ' + v('f-list'),
      'Heard about us: ' + v('f-hear'),
      'Services: ' + svcs,
      '',
      "What's slipping:",
      v('f-msg')
    ];
    location.href = 'mailto:hello@roam.studio?subject=' + encodeURIComponent(subject)
      + '&body=' + encodeURIComponent(lines.join('\n'));
  });
})();

  }, [])
  return null
}
