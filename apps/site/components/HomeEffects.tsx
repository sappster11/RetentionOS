// @ts-nocheck
'use client'
/* Ported verbatim from the static prototype; runs after mount. */
import { useEffect } from 'react'

export function HomeEffects() {
  useEffect(() => {
(function(){
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  var els = document.querySelectorAll('.reveal');
  if(reduce){ els.forEach(function(e){e.classList.add('in')}); }
  else{
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(en){ if(en.isIntersecting){ en.target.classList.add('in'); io.unobserve(en.target);} });
    },{threshold:.12});
    els.forEach(function(e){io.observe(e)});
  }

  var p = document.getElementById('loopPath');
  if(p && !reduce){
    var len = p.getTotalLength();
    p.style.strokeDasharray = len;
    p.style.strokeDashoffset = len;
    p.getBoundingClientRect();
    p.style.transition = 'stroke-dashoffset 2.2s cubic-bezier(.4,.1,.2,1) .4s';
    p.style.strokeDashoffset = '0';
  }

  /* case media placeholder art — richer contrast for the dark ground */
  var palettes = {
    denim:  [['#0C1930',1],['#224370',.95],['#4A7BB0',.8],['#08101E',.9],['#C9A24B',.3]],
    skin:   [['#C9A88B',1],['#8A5A3B',.85],['#E8D5BF',.95],['#5C3A26',.7],['#D9784A',.35]],
    coffee: [['#1A120C',1],['#45291A',.95],['#7E4E2B',.85],['#241610',.9],['#D89B55',.45]]
  };
  function hexToRgb(h){h=h.slice(1);return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]}
  function seeded(n){ var s=n; return function(){ s=(s*9301+49297)%233280; return s/233280; }; }
  document.querySelectorAll('canvas[data-art]').forEach(function(cv, idx){
    var pal = palettes[cv.dataset.art];
    var w = cv.width = 1280, h = cv.height = 768;
    var ctx = cv.getContext('2d');
    var rand = seeded(42 + idx*77);
    ctx.fillStyle = pal[0][0]; ctx.fillRect(0,0,w,h);
    for(var i=1;i<pal.length;i++){
      var c = hexToRgb(pal[i][0]);
      for(var k=0;k<3;k++){
        var x = rand()*w, y = rand()*h, r = (0.25+rand()*0.55)*w;
        var g = ctx.createRadialGradient(x,y,0,x,y,r);
        g.addColorStop(0,'rgba('+c[0]+','+c[1]+','+c[2]+','+(pal[i][1]*(.25+rand()*.3))+')');
        g.addColorStop(1,'rgba('+c[0]+','+c[1]+','+c[2]+',0)');
        ctx.fillStyle = g; ctx.fillRect(0,0,w,h);
      }
    }
    var g2 = ctx.createLinearGradient(0,0,w,h*0.7);
    g2.addColorStop(0,'rgba(255,255,255,0)');
    g2.addColorStop(.52,'rgba(255,255,255,.07)');
    g2.addColorStop(1,'rgba(0,0,0,.22)');
    ctx.fillStyle = g2; ctx.fillRect(0,0,w,h);
  });

  /* Fig. 1 — cumulative revenue per customer, with vs without */
  (function(){
    var host = document.getElementById('chart');
    if(!host) return;
    var GREEN='#43A873', CLAY='#B37F42';
    var W=960, H=430, L=64, R=250, T=26, B=48;
    var pw = W-L-R, ph = H-T-B;
    var MAXY=400, MAXM=24;
    function withSys(m){ return 62 + 9*m + 0.18*m*m; }
    function withoutSys(m){ return 62 + 88*(1-Math.exp(-m/3.2)); }
    function X(m){ return L + pw*m/MAXM; }
    function Y(v){ return T + ph*(1 - v/MAXY); }
    function pathFor(f){
      var d='';
      for(var m=0;m<=MAXM;m+=0.5){ d += (m?' L':'M')+X(m).toFixed(1)+' '+Y(f(m)).toFixed(1); }
      return d;
    }
    var grid='', ylab='';
    [100,200,300,400].forEach(function(v){
      grid += '<line x1="'+L+'" y1="'+Y(v)+'" x2="'+(W-R+40)+'" y2="'+Y(v)+'" stroke="rgba(242,238,225,.07)" stroke-width="1"/>';
      ylab += '<text x="'+(L-12)+'" y="'+(Y(v)+4)+'" text-anchor="end" font-family="Libre Franklin" font-size="11" fill="rgba(242,238,225,.4)">$'+v+'</text>';
    });
    var xlab='';
    [0,6,12,18,24].forEach(function(m){
      xlab += '<text x="'+X(m)+'" y="'+(H-16)+'" text-anchor="middle" font-family="Libre Franklin" font-size="11" fill="rgba(242,238,225,.4)">'+(m===0?'Month 0':m)+'</text>';
    });
    var endW = withSys(MAXM), endO = withoutSys(MAXM);
    var svg = '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Line chart: cumulative revenue per customer over 24 months, with a retention system reaching $'+Math.round(endW)+' versus $'+Math.round(endO)+' without one.">'
      + grid + ylab + xlab
      + '<line x1="'+L+'" y1="'+Y(0)+'" x2="'+(W-R+40)+'" y2="'+Y(0)+'" stroke="rgba(242,238,225,.18)" stroke-width="1"/>'
      + '<path id="lnO" d="'+pathFor(withoutSys)+'" fill="none" stroke="'+CLAY+'" stroke-width="2" stroke-linecap="round"/>'
      + '<path id="lnW" d="'+pathFor(withSys)+'" fill="none" stroke="'+GREEN+'" stroke-width="2.4" stroke-linecap="round"/>'
      + '<circle cx="'+X(MAXM)+'" cy="'+Y(endW)+'" r="4.5" fill="'+GREEN+'"/>'
      + '<circle cx="'+X(MAXM)+'" cy="'+Y(endO)+'" r="4.5" fill="'+CLAY+'"/>'
      + '<text x="'+(X(MAXM)+14)+'" y="'+(Y(endW)+5)+'" font-family="Libre Franklin" font-weight="600" font-size="13" fill="#F2EEE1">$'+Math.round(endW)+' <tspan font-weight="400" fill="rgba(242,238,225,.55)">with</tspan></text>'
      + '<text x="'+(X(MAXM)+14)+'" y="'+(Y(endO)+5)+'" font-family="Libre Franklin" font-weight="600" font-size="13" fill="#F2EEE1">$'+Math.round(endO)+' <tspan font-weight="400" fill="rgba(242,238,225,.55)">without</tspan></text>'
      + '<text x="'+X(8.4)+'" y="'+(Y(withoutSys(8.4))+34)+'" font-family="Newsreader" font-style="italic" font-size="16" fill="rgba(242,238,225,.72)">where most brands stall</text>'
      + '<path d="M'+(X(8.2))+' '+(Y(withoutSys(8.2))+22)+' Q '+(X(7.6))+' '+(Y(withoutSys(7.6))+10)+' '+(X(7.4))+' '+(Y(withoutSys(7.4))+5)+'" fill="none" stroke="rgba(242,238,225,.4)" stroke-width="1"/>'
      + '<text x="'+X(13.5)+'" y="'+(Y(withSys(16))-30)+'" font-family="Newsreader" font-style="italic" font-size="16" fill="rgba(242,238,225,.72)">where compounding starts paying</text>'
      + '<path d="M'+(X(16.6))+' '+(Y(withSys(16))-22)+' Q '+(X(17.2))+' '+(Y(withSys(17))-10)+' '+(X(17.4))+' '+(Y(withSys(17.4))-5)+'" fill="none" stroke="rgba(242,238,225,.4)" stroke-width="1"/>'
      + '<line id="xhair" x1="0" y1="'+T+'" x2="0" y2="'+Y(0)+'" stroke="rgba(242,238,225,.28)" stroke-width="1" visibility="hidden"/>'
      + '<rect id="hitzone" x="'+L+'" y="'+T+'" width="'+pw+'" height="'+ph+'" fill="transparent"/>'
      + '</svg>';
    host.innerHTML = svg;

    /* draw the lines in on reveal */
    if(!reduce){
      ['lnO','lnW'].forEach(function(id,i){
        var ln = document.getElementById(id), len = ln.getTotalLength();
        ln.style.strokeDasharray = len; ln.style.strokeDashoffset = len;
        var io2 = new IntersectionObserver(function(es){
          es.forEach(function(e){
            if(e.isIntersecting){
              ln.getBoundingClientRect();
              ln.style.transition = 'stroke-dashoffset 1.8s cubic-bezier(.4,.1,.2,1) '+(0.15+i*0.25)+'s';
              ln.style.strokeDashoffset = '0';
              io2.unobserve(ln);
            }
          });
        },{threshold:.4});
        io2.observe(ln);
      });
    }

    /* crosshair + tooltip */
    var tip = document.getElementById('figTip');
    var svgEl = host.querySelector('svg');
    var xhair = document.getElementById('xhair');
    svgEl.addEventListener('mousemove', function(ev){
      var r = svgEl.getBoundingClientRect();
      var sx = (ev.clientX - r.left) * (W / r.width);
      if(sx < L || sx > L+pw){ tip.hidden = true; xhair.setAttribute('visibility','hidden'); return; }
      var m = Math.round((sx-L)/pw*MAXM);
      xhair.setAttribute('x1', X(m)); xhair.setAttribute('x2', X(m));
      xhair.setAttribute('visibility','visible');
      tip.innerHTML = '<strong>Month '+m+'</strong><br>'
        + '<span class="dot" style="background:'+GREEN+'"></span>With — $'+Math.round(withSys(m))
        + '<br><span class="dot" style="background:'+CLAY+'"></span>Without — $'+Math.round(withoutSys(m));
      var frame = host.closest('.fig-frame').getBoundingClientRect();
      tip.style.left = (X(m)/W*r.width + r.left - frame.left)+'px';
      tip.style.top = (r.top - frame.top + Y(withSys(m))/H*r.height)+'px';
      tip.hidden = false;
    });
    svgEl.addEventListener('mouseleave', function(){ tip.hidden = true; xhair.setAttribute('visibility','hidden'); });
  })();

  /* Featured-essay art: dithered spot-color print. An aerial pool in the
     shape of the return loop — flat ink planes, black dither plate on top. */
  (function(){
    var cv = document.getElementById('poolArt'); if(!cv) return;
    var W2=640, H2=400;
    var rnd = seeded(1234);
    var shadeC = document.createElement('canvas'); shadeC.width=W2; shadeC.height=H2;
    var planeC = document.createElement('canvas'); planeC.width=W2; planeC.height=H2;
    var s = shadeC.getContext('2d'), p = planeC.getContext('2d');

    var LAWN='#E7DFB6', FOLIAGE='#2E5A3C', POOL='#2470C8', DECK='#F2EEE1';

    // lawn base
    p.fillStyle = LAWN; p.fillRect(0,0,W2,H2);
    s.fillStyle = 'rgb(212,212,212)'; s.fillRect(0,0,W2,H2);

    // lawn mottle on the shade plate
    for(var i=0;i<900;i++){
      var g = 190+rnd()*50;
      s.fillStyle = 'rgb('+g+','+g+','+g+')';
      s.fillRect(rnd()*W2, rnd()*H2, 1+rnd()*2, 1+rnd()*2);
    }

    // foliage ring — clustered blobs near the frame edges, dark + textured
    function foliageBlob(x,y,r){
      p.fillStyle = FOLIAGE;
      p.beginPath(); p.arc(x,y,r,0,Math.PI*2); p.fill();
      for(var k=0;k<r*2.2;k++){
        var a = rnd()*Math.PI*2, d = Math.sqrt(rnd())*r;
        var g = 30+rnd()*95;
        s.fillStyle = 'rgb('+g+','+g+','+g+')';
        var sz = 1+rnd()*2.4;
        s.fillRect(x+Math.cos(a)*d, y+Math.sin(a)*d, sz, sz);
      }
    }
    for(var i2=0;i2<150;i2++){
      var edge = Math.floor(rnd()*4), bx, by;
      if(edge===0){ bx=rnd()*W2; by=rnd()*H2*0.16; }
      else if(edge===1){ bx=rnd()*W2; by=H2-rnd()*H2*0.16; }
      else if(edge===2){ bx=rnd()*W2*0.13; by=rnd()*H2; }
      else { bx=W2-rnd()*W2*0.13; by=rnd()*H2; }
      foliageBlob(bx, by, 8+rnd()*22);
    }

    // the pool: the return-loop, drawn fat. Deck ring first, then water.
    function loopPath(ctx2, scale, ox, oy){
      ctx2.beginPath();
      ctx2.moveTo(ox+4*scale, oy+46*scale);
      ctx2.bezierCurveTo(ox+60*scale, oy+6*scale, ox+150*scale, oy+2*scale, ox+210*scale, oy+24*scale);
      ctx2.bezierCurveTo(ox+244*scale, oy+38*scale, ox+240*scale, oy+66*scale, ox+196*scale, oy+72*scale);
      ctx2.bezierCurveTo(ox+150*scale, oy+78*scale, ox+96*scale, oy+66*scale, ox+60*scale, oy+52*scale);
    }
    var SC=1.85, OX=(W2-240*SC)/2, OY=(H2-78*SC)/2 - 8;
    // deck (paper-white ring around the water)
    p.lineCap='s'.length?'round':'round'; s.lineCap='round';
    p.strokeStyle = DECK; p.lineWidth = 86; p.lineCap='round';
    loopPath(p, SC, OX, OY); p.stroke();
    s.strokeStyle = 'rgb(238,238,238)'; s.lineWidth = 86;
    loopPath(s, SC, OX, OY); s.stroke();
    // water
    p.strokeStyle = POOL; p.lineWidth = 62;
    loopPath(p, SC, OX, OY); p.stroke();
    s.strokeStyle = 'rgb(168,168,168)'; s.lineWidth = 62;
    loopPath(s, SC, OX, OY); s.stroke();
    // arrowhead island (deck-colored) at the loop's mouth
    var ax=OX+60*SC, ay=OY+52*SC;
    p.fillStyle = DECK; s.fillStyle = 'rgb(238,238,238)';
    [p,s].forEach(function(c3){
      c3.beginPath();
      c3.moveTo(ax+26*SC*0.8, ay-10*SC*0.8);
      c3.lineTo(ax-6*SC*0.8, ay+2*SC*0.8);
      c3.lineTo(ax+18*SC*0.8, ay+16*SC*0.8);
      c3.closePath(); c3.fill();
    });
    // water texture — speckle confined to the pool via stroke hit-testing
    var wp = new Path2D();
    wp.moveTo(OX+4*SC, OY+46*SC);
    wp.bezierCurveTo(OX+60*SC, OY+6*SC, OX+150*SC, OY+2*SC, OX+210*SC, OY+24*SC);
    wp.bezierCurveTo(OX+244*SC, OY+38*SC, OX+240*SC, OY+66*SC, OX+196*SC, OY+72*SC);
    wp.bezierCurveTo(OX+150*SC, OY+78*SC, OX+96*SC, OY+66*SC, OX+60*SC, OY+52*SC);
    s.lineWidth = 56;
    for(var sp=0; sp<2600; sp++){
      var qx = rnd()*W2, qy = rnd()*H2;
      if(s.isPointInStroke(wp, qx, qy)){
        var wg = 120+rnd()*70;
        s.fillStyle = 'rgb('+wg+','+wg+','+wg+')';
        s.fillRect(qx, qy, 1+rnd()*1.6, 1+rnd()*1.6);
      }
    }

    // dither: Bayer 4x4 black plate over the ink planes
    var B=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
    var sd = s.getImageData(0,0,W2,H2).data;
    var pd = p.getImageData(0,0,W2,H2);
    var out = pd.data;
    for(var y=0;y<H2;y++){
      for(var x=0;x<W2;x++){
        var idx=(y*W2+x)*4;
        var lum = sd[idx]/255;
        var t = (B[y%4][x%4]+0.5)/16;
        if(lum < t){ out[idx]=13; out[idx+1]=12; out[idx+2]=10; }
      }
    }
    var tmp=document.createElement('canvas'); tmp.width=W2; tmp.height=H2;
    tmp.getContext('2d').putImageData(pd,0,0);
    cv.width=W2*2; cv.height=H2*2;
    var fc=cv.getContext('2d');
    fc.imageSmoothingEnabled=false;
    fc.drawImage(tmp,0,0,cv.width,cv.height);
  })();

  /* sticky header surface */
  var hdr = document.querySelector('header');
  function onHdr(){ hdr.classList.toggle('scrolled', scrollY > 40); }
  addEventListener('scroll', onHdr, {passive:true}); onHdr();

  /* newsletter — success state inline (wire to a real list later) */
  var nf = document.getElementById('newsForm');
  if(nf){
    nf.addEventListener('submit', function(ev){
      ev.preventDefault();
      var em = document.getElementById('nf-email');
      if(!em.value || em.value.indexOf('@') < 0){ em.focus(); return; }
      nf.innerHTML = '<p style="font-family:\'Newsreader\',Georgia,serif;font-size:clamp(1.3rem,2.2vw,1.8rem);line-height:1.3">You\'re in. See you Sunday.</p>'
        + '<span class="form-note" style="margin-top:14px">First essay lands in your inbox this week.</span>';
    });
  }
})();

  }, [])
  return null
}
