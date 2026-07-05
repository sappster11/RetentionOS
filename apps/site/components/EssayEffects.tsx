// @ts-nocheck
'use client'
/* Ported verbatim from the static prototype; runs after mount. */
import { useEffect } from 'react'

export function EssayEffects() {
  useEffect(() => {
(function(){
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  var hdr = document.querySelector('header');
  function onHdr(){ hdr.classList.toggle('scrolled', scrollY > 40); }
  addEventListener('scroll', onHdr, {passive:true}); onHdr();

  var els = document.querySelectorAll('.reveal');
  if(reduce){ els.forEach(function(e){e.classList.add('in')}); }
  else{
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(en){ if(en.isIntersecting){ en.target.classList.add('in'); io.unobserve(en.target);} });
    },{threshold:.12});
    els.forEach(function(e){io.observe(e)});
  }

  function seeded(n){ var s=n; return function(){ s=(s*9301+49297)%233280; return s/233280; }; }
  var B=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];

  /* dither compositor: flat ink planes + black Bayer plate */
  function ditherScene(cv, w, h, drawPlanes, drawShade){
    var pc=document.createElement('canvas'); pc.width=w; pc.height=h;
    var sc2=document.createElement('canvas'); sc2.width=w; sc2.height=h;
    var p=pc.getContext('2d'), s=sc2.getContext('2d');
    drawPlanes(p); drawShade(s);
    var sd = s.getImageData(0,0,w,h).data;
    var pd = p.getImageData(0,0,w,h);
    var out = pd.data;
    for(var y=0;y<h;y++) for(var x=0;x<w;x++){
      var i=(y*w+x)*4;
      if(sd[i]/255 < (B[y%4][x%4]+0.5)/16){ out[i]=13; out[i+1]=12; out[i+2]=10; }
    }
    var tmp=document.createElement('canvas'); tmp.width=w; tmp.height=h;
    tmp.getContext('2d').putImageData(pd,0,0);
    cv.width=w*2; cv.height=h*2;
    var fc=cv.getContext('2d'); fc.imageSmoothingEnabled=false;
    fc.drawImage(tmp,0,0,cv.width,cv.height);
  }

  /* hero art: the loop pool */
  var cv = document.getElementById('poolArt');
  if(cv){
    var W2=640,H2=360, rnd=seeded(1234);
    var SC=1.85, OX=(W2-240*SC)/2, OY=(H2-78*SC)/2 - 4;
    function loopPath(c){
      c.beginPath();
      c.moveTo(OX+4*SC, OY+46*SC);
      c.bezierCurveTo(OX+60*SC, OY+6*SC, OX+150*SC, OY+2*SC, OX+210*SC, OY+24*SC);
      c.bezierCurveTo(OX+244*SC, OY+38*SC, OX+240*SC, OY+66*SC, OX+196*SC, OY+72*SC);
      c.bezierCurveTo(OX+150*SC, OY+78*SC, OX+96*SC, OY+66*SC, OX+60*SC, OY+52*SC);
    }
    ditherScene(cv, W2, H2, function(p){
      p.fillStyle='#E7DFB6'; p.fillRect(0,0,W2,H2);
      for(var i=0;i<150;i++){
        var e=Math.floor(rnd()*4),bx,by;
        if(e===0){bx=rnd()*W2;by=rnd()*H2*0.15}else if(e===1){bx=rnd()*W2;by=H2-rnd()*H2*0.15}
        else if(e===2){bx=rnd()*W2*0.12;by=rnd()*H2}else{bx=W2-rnd()*W2*0.12;by=rnd()*H2}
        p.fillStyle='#2E5A3C'; p.beginPath(); p.arc(bx,by,8+rnd()*22,0,Math.PI*2); p.fill();
      }
      p.lineCap='round';
      p.strokeStyle='#F2EEE1'; p.lineWidth=86; loopPath(p); p.stroke();
      p.strokeStyle='#2470C8'; p.lineWidth=62; loopPath(p); p.stroke();
      var ax=OX+60*SC, ay=OY+52*SC;
      p.fillStyle='#F2EEE1';
      p.beginPath(); p.moveTo(ax+26*SC*0.8,ay-10*SC*0.8); p.lineTo(ax-6*SC*0.8,ay+2*SC*0.8); p.lineTo(ax+18*SC*0.8,ay+16*SC*0.8); p.closePath(); p.fill();
    }, function(s){
      var r2=seeded(1234);
      s.fillStyle='rgb(212,212,212)'; s.fillRect(0,0,W2,H2);
      for(var i=0;i<900;i++){var g=190+r2()*50; s.fillStyle='rgb('+g+','+g+','+g+')'; s.fillRect(r2()*W2,r2()*H2,1+r2()*2,1+r2()*2);}
      for(var j=0;j<150;j++){
        var e=Math.floor(r2()*4),bx,by;
        if(e===0){bx=r2()*W2;by=r2()*H2*0.15}else if(e===1){bx=r2()*W2;by=H2-r2()*H2*0.15}
        else if(e===2){bx=r2()*W2*0.12;by=r2()*H2}else{bx=W2-r2()*W2*0.12;by=r2()*H2}
        var rr=8+r2()*22;
        for(var k=0;k<rr*2.2;k++){
          var a=r2()*Math.PI*2,d=Math.sqrt(r2())*rr,g2=30+r2()*95;
          s.fillStyle='rgb('+g2+','+g2+','+g2+')'; s.fillRect(bx+Math.cos(a)*d,by+Math.sin(a)*d,1+r2()*2.4,1+r2()*2.4);
        }
      }
      s.lineCap='round';
      s.strokeStyle='rgb(238,238,238)'; s.lineWidth=86; loopPath(s); s.stroke();
      s.strokeStyle='rgb(168,168,168)'; s.lineWidth=62; loopPath(s); s.stroke();
      var ax=OX+60*SC, ay=OY+52*SC;
      s.fillStyle='rgb(238,238,238)';
      s.beginPath(); s.moveTo(ax+26*SC*0.8,ay-10*SC*0.8); s.lineTo(ax-6*SC*0.8,ay+2*SC*0.8); s.lineTo(ax+18*SC*0.8,ay+16*SC*0.8); s.closePath(); s.fill();
    });
  }

  /* related thumbs: small dithered spot-color studies */
  document.querySelectorAll('canvas[data-thumb]').forEach(function(tc, i){
    var kind = tc.dataset.thumb, w=192, h=128, r=seeded(50+i*31);
    ditherScene(tc, w, h, function(p){
      if(kind==='rings'){
        p.fillStyle='#2470C8'; p.fillRect(0,0,w,h);
        p.strokeStyle='#F2EEE1'; p.lineWidth=7;
        for(var q=10;q<70;q+=18){ p.beginPath(); p.arc(w*0.5,h*0.52,q,0,Math.PI*2); p.stroke(); }
      } else if(kind==='coin'){
        p.fillStyle='#E7DFB6'; p.fillRect(0,0,w,h);
        p.fillStyle='#C9A24B'; p.beginPath(); p.arc(w*0.5,h*0.5,42,0,Math.PI*2); p.fill();
        p.fillStyle='#E7DFB6'; p.beginPath(); p.arc(w*0.5,h*0.5,26,0,Math.PI*2); p.fill();
      } else {
        p.fillStyle='#2E5A3C'; p.fillRect(0,0,w,h);
        p.strokeStyle='#F2EEE1'; p.lineWidth=6; p.beginPath();
        for(var t=0;t<Math.PI*6;t+=0.1){
          var rad=4+t*4.4, x=w*0.5+Math.cos(t)*rad, y=h*0.52+Math.sin(t)*rad*0.72;
          t===0 ? p.moveTo(x,y) : p.lineTo(x,y);
        }
        p.stroke();
      }
    }, function(s){
      s.fillStyle='rgb(205,205,205)'; s.fillRect(0,0,w,h);
      for(var q2=0;q2<600;q2++){ var g=150+r()*90; s.fillStyle='rgb('+g+','+g+','+g+')'; s.fillRect(r()*w,r()*h,1+r()*2,1+r()*2); }
    });
  });

  /* feedback pills */
  document.querySelectorAll('.fb').forEach(function(b){
    b.addEventListener('click', function(){
      var box = document.getElementById('feedback');
      box.innerHTML = '<span class="eyebrow">Worth your inbox?</span><span class="fb-done">Noted — thank you for reading.</span>';
    });
  });

  /* inset newsletter */
  document.querySelectorAll('.js-news').forEach(function(f){
    f.addEventListener('submit', function(ev){
      ev.preventDefault();
      var em = f.querySelector('input');
      if(!em.value || em.value.indexOf('@')<0){ em.focus(); return; }
      f.innerHTML = '<p style="font-family:\'Newsreader\',Georgia,serif;font-style:italic;font-size:1.15rem;color:var(--sage)">You\'re in. See you Sunday.</p>';
    });
  });
})();

  }, [])
  return null
}
