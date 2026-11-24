/* Tiny decorative snow. Moscow current-hour forecast; never reads visitor location. */
(()=>{
 'use strict';
 if(!['venikoff.net','www.venikoff.net','127.0.0.1','localhost'].includes(location.hostname))return;
 const reduce=matchMedia('(prefers-reduced-motion: reduce)'),preview=new URLSearchParams(location.search).get('snow')==='preview';
 let enabled=false,frame=0,last=0,elapsed=0,screen=null,flakes=[],models=[],nextScan=0,loading=false;
 const oval=(c,x,y,rx,ry,fill)=>{c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fillStyle=fill;c.fill();};
 const rect=(c,x,y,w,h,color,r=0)=>{c.beginPath();c.roundRect(x,y,w,h,r);c.fillStyle=color;c.fill();};
 function santa(m,x,t){const c=m.ctx;c.save();c.translate(x,m.h-1);c.scale(13/14,13/14);
  c.strokeStyle='#4d3d49';c.lineWidth=1.35;c.lineCap='round';c.beginPath();c.moveTo(-3,-4);c.lineTo(-3.3+Math.sin(t*17)*.5,-.8);c.moveTo(.2,-4);c.lineTo(.5-Math.sin(t*17)*.5,-.8);c.stroke();
  rect(c,-5,-1.8,3,1.6,'#27252b',.5);rect(c,-.8,-1.8,3,1.6,'#27252b',.5);
  rect(c,-5,-8,7.2,5.6,'#ce3c56',2);rect(c,-5,-3.5,7.2,1.2,'#f4ecdf',.5);rect(c,-5,-5.7,7,1,'#49333b');oval(c,-1.5,-5.2,.5,.6,'#f1ce78');
  oval(c,-1.5,-10,3,3,'#f5c8a4');oval(c,-1,-8.4,2.7,2.2,'#fff7ec');oval(c,.2,-10,.35,.45,'#372b30');oval(c,1,-9.3,.7,.6,'#edb09b');
  c.beginPath();c.moveTo(-4.5,-11.5);c.quadraticCurveTo(-5,-17,1,-14);c.lineTo(3,-12.1);c.lineTo(.1,-12);c.closePath();c.fillStyle='#d94459';c.fill();rect(c,-4.7,-12.3,6.2,1.5,'#fff8ed',.8);oval(c,3,-12.2,.95,.95,'#fff8ed');
  c.strokeStyle='#ce3c56';c.lineWidth=2;c.beginPath();c.moveTo(1,-6.8);c.lineTo(4.4,-6.4);c.stroke();oval(c,4.6,-6.4,1,.8,'#fff2df');
  c.strokeStyle='#4e535d';c.lineWidth=.9;c.beginPath();c.moveTo(4.5,-6.6);c.lineTo(7,-2);c.stroke();
  rect(c,6,-4.1,7.4,3.7,'#d3425b',1);rect(c,10.2,-4.8,4,4.5,'#934059',1);oval(c,7.5,-.8,1.3,1.3,'#30323a');oval(c,12,-.8,1.3,1.3,'#30323a');oval(c,7.5,-.8,.45,.45,'#c7c9cb');oval(c,12,-.8,.45,.45,'#c7c9cb');
  c.strokeStyle='#737d88';c.lineWidth=1.8;c.beginPath();c.moveTo(10,-4);c.lineTo(10,-8);c.lineTo(12.8,-9.3);c.stroke();
  for(let i=0;i<13;i++){const p=((t*1.65+i*.381966)%1),dx=12.4+p*13,dy=-9-10*Math.sin(p*Math.PI)+p*4;oval(c,dx,dy,.45+(i%3)*.2,.45+(i%3)*.2,'rgba(255,255,255,'+(1-p)+')');}
  c.restore();
 }
 function allowed(){return !reduce.matches&&!navigator.connection?.saveData;}
 function makeCanvas(parent,full){const el=document.createElement('canvas');el.setAttribute('aria-hidden','true');el.className='winter-decoration';el.style.cssText=full?'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:12;':'position:absolute;bottom:0;left:0;width:100%;height:36px;pointer-events:none;z-index:3;';parent.append(el);return {canvas:el,ctx:el.getContext('2d'),w:0,h:0};}
 function size(m){const r=m.canvas.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);if(m.w!==r.width||m.h!==r.height){m.w=r.width;m.h=r.height;m.canvas.width=Math.round(m.w*d);m.canvas.height=Math.round(m.h*d);m.ctx.setTransform(d,0,0,d,0,0);}}
 function scan(){models=models.filter(m=>{if(!m.canvas.isConnected)return false;const r=m.el.getBoundingClientRect();m.visible=r.bottom>0&&r.top<innerHeight;if(!m.visible){m.canvas.remove();return false;}return true;});
  for(const el of document.querySelectorAll('.card-img')){if(models.length>=18)break;if(el.querySelector('.winter-decoration'))continue;const r=el.getBoundingClientRect();if(r.width<80||r.height<80||r.bottom<0||r.top>innerHeight)continue;const m=makeCanvas(el,false);Object.assign(m,{el,index:models.length,visible:true,offset:Math.random()*5});size(m);models.push(m);}
  models.forEach(size);
 }
 function bank(m,t){const c=m.ctx,growth=Math.min(1,t/7),progress=Math.max(0,Math.min(1,(t-9)/8)),x=-24+progress*(m.w+49);c.clearRect(0,0,m.w,m.h);if(t>=17)return;
  c.save();c.beginPath();c.rect(t<9?0:Math.max(0,x+14),0,m.w,m.h);c.clip();c.beginPath();c.moveTo(0,m.h+1);for(let p=0;p<=m.w+3;p+=3){const h=4+Math.sin(p*.07+m.index)+.6*Math.sin(p*.19)+2.2*Math.exp(-Math.pow((p-m.w*.2)/(m.w*.12),2));c.lineTo(p,m.h-h*growth);}c.lineTo(m.w+3,m.h+1);c.closePath();c.fillStyle='#fff';c.shadowColor='rgba(141,179,201,.6)';c.shadowBlur=2;c.fill();c.restore();if(t>=9)santa(m,x,t);
 }
 function tick(now){frame=0;if(!enabled||document.hidden||!allowed())return;if(now-last<33){frame=requestAnimationFrame(tick);return;}const dt=Math.min(.08,(now-last)/1000||.033);last=now;elapsed+=dt;
  size(screen);const c=screen.ctx,w=screen.w,h=screen.h;c.clearRect(0,0,w,h);
  while(flakes.length<Math.min(65,Math.ceil(w/17)))flakes.push({x:Math.random()*w,y:Math.random()*h,r:.85+Math.random()*1.1,v:13+Math.random()*17,phase:Math.random()*6.28});
  c.fillStyle='rgba(255,255,255,.72)';c.shadowColor='rgba(141,167,189,.45)';c.shadowBlur=1;
  for(const p of flakes){p.y+=p.v*dt;p.x+=Math.sin(elapsed*.6+p.phase)*dt*3;if(p.y>h+3){p.y=-3;p.x=Math.random()*w;}c.beginPath();c.arc(p.x,p.y,p.r,0,Math.PI*2);c.fill();}c.shadowBlur=0;
  if(now>nextScan){scan();nextScan=now+750;}for(const m of models)if(m.visible)bank(m,(elapsed+m.offset)%47);
  frame=requestAnimationFrame(tick);
 }
 function clear(){cancelAnimationFrame(frame);frame=0;screen?.canvas.remove();screen=null;models.forEach(m=>m.canvas.remove());models=[];flakes=[];}
 function run(on){enabled=on&&allowed();if(!enabled){clear();return;}if(!screen)screen=makeCanvas(document.body,true);if(!document.hidden&&!frame){last=performance.now();frame=requestAnimationFrame(tick);}}
 function credit(){let el=document.getElementById('winterWeatherCredit');if(el)return;const foot=document.querySelector('.foot .wrap');if(!foot)return;el=document.createElement('small');el.id='winterWeatherCredit';el.style.cssText='font-size:11px;opacity:.65;line-height:1.5';el.innerHTML=(preview?'Предпросмотр зимнего оформления. ':'')+'Погода: <a href="https://www.met.no/en" target="_blank" rel="noopener">MET Norway</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>. Снег определяется по прогнозу текущего часа для Москвы.';foot.append(el);}
 async function refresh(){if(loading||document.hidden)return;loading=true;try{if(preview){credit();run(true);return;}const r=await fetch('/weather-moscow.json',{cache:'no-store',signal:AbortSignal.timeout(7000)});if(!r.ok)throw Error('weather');const data=await r.json();const fresh=Number(data.valid_until)>Date.now()/1000;run(fresh&&data.snow===true);if(fresh)credit();}catch(_){run(false);}finally{loading=false;}}
 document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(frame);frame=0;last=0;}else refresh();});
 reduce.addEventListener('change',()=>{clear();refresh();});navigator.connection?.addEventListener?.('change',()=>{clear();refresh();});
 refresh();setInterval(refresh,10*60*1000);
})();
