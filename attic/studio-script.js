const FEATURED = [
  { id: 'sweet-avalanche', name: 'Свит Аваланж', mood: 'Нежность в каждом лепестке',   tint: '#E8A3B0', w: 640, h: 533 },
  { id: 'abigail',         name: 'Абигейл',      mood: 'Ярко, как первое свидание',    tint: '#E0418A', w: 640, h: 481 },
  { id: 'miss-piggy',      name: 'Мисс Пигги',   mood: 'Тёплый персиковый привет',     tint: '#F09A7A', w: 640, h: 494 },
  { id: 'eltoro',          name: 'Эльторо',      mood: 'Красные розы. Всё понятно',    tint: '#C8102E', w: 640, h: 464 },
  { id: 'peach-avalanche', name: 'Пич Аваланж',  mood: 'Мягкий свет персика',          tint: '#F2B98A', w: 640, h: 476 },
  { id: '3177', name: 'Совершенство',     mood: 'Когда нужно сказать главное',  tint: '#9B2C3A', w: 720, h: 684 },
  { id: '3153', name: 'Талея',            mood: 'Нежность без лишних слов',     tint: '#B9A77A', w: 720, h: 634 },
  { id: '3146', name: 'Элегантность',     mood: 'Классика, которая не стареет', tint: '#A0414B', w: 684, h: 720 },
  { id: '3156', name: 'Высокие чувства',  mood: '101 роза — и всё понятно',     tint: '#B24A6E', w: 703, h: 720 },
  { id: '3068', name: 'Шарли',            mood: 'Яркий повод улыбнуться',       tint: '#C4577E', w: 624, h: 720 }
];
if (API) {
  const fromApi = P.filter(p => p.featured).map(p => ({ id: p.id, name: p.name, mood: p.featured.mood, tint: p.featured.tint, cut: p.featured.cut, w: 640, h: 500 }));
  if (fromApi.length) FEATURED.splice(0, FEATURED.length, ...fromApi);
}
const N = FEATURED.length;
const studio = $('#studio'), carousel = $('#carousel'), scene = $('#scene');
let pos = 0, drag = 0, spacing = 160;
const wrapD = d => { d = ((d % N) + N) % N; return d > N / 2 ? d - N : d; };
const current = () => ((Math.round(pos) % N) + N) % N;
// первые три букета нужны сразу, остальные подгрузятся, пока листают
carousel.innerHTML = FEATURED.map((f, i) => `<div class="c-item" role="option" data-i="${i}" aria-label="${f.name}"><img src="${f.cut || `/img/cut/${f.id}.png`}" alt="" draggable="false" ${i < 3 ? 'fetchpriority="high"' : 'loading="lazy"'} onload="this.dataset.w=this.naturalWidth;this.dataset.h=this.naturalHeight"></div>`).join('');
$('#dots').innerHTML = FEATURED.map((f, i) => `<button data-i="${i}" aria-label="${f.name}"></button>`).join('');
const items = [...carousel.children];
function layout() {
  spacing = Math.max(150, Math.min(215, (carousel.clientWidth || 360) * 0.4));   // соседи не наезжают на центральный букет
  const p = pos - drag / spacing;
  items.forEach((el, i) => {
    const d = wrapD(i - p), a = Math.abs(d), c = Math.min(a, 1);
    el.style.transform = `translateX(${d * spacing}px) translateY(${c * 14}px) scale(${1 - c * 0.3}) rotate(${Math.max(-2, Math.min(2, d)) * 9}deg)`;
    el.style.opacity = a > 1.8 ? 0 : 1 - c * 0.62;
    el.style.filter = `blur(${c * 1.2}px)`;
    el.style.zIndex = 10 - Math.round(a * 2);
    el.setAttribute('aria-selected', i === current());
  });
}
function meta() {
  const f = FEATURED[current()];
  $('#cName').textContent = f.name; $('#cPrice').textContent = byId[f.id] ? `от ${rub(byId[f.id].price)}` : f.mood;
  $('#studioIdx').textContent = `${current() + 1} / ${N}`;
  $$('#dots button').forEach((b, i) => b.setAttribute('aria-current', i === current()));
  studio.style.setProperty('--glow', f.tint + '22');
}
function goTo(to) { pos = to; drag = 0; layout(); meta(); }
addEventListener('resize', layout);
let sx = 0, lastX = 0, lastT = 0, vel = 0, moved = false, down = false;
carousel.addEventListener('pointerdown', e => { down = true; moved = false; sx = lastX = e.clientX; lastT = performance.now(); vel = 0; carousel.setPointerCapture(e.pointerId); });
carousel.addEventListener('pointermove', e => {
  if (!down) return;
  const dx = e.clientX - sx;
  if (!moved && Math.abs(dx) > 6) { moved = true; carousel.classList.add('dragging'); }
  if (!moved) return;
  const t = performance.now(); vel = (e.clientX - lastX) / Math.max(1, t - lastT); lastX = e.clientX; lastT = t;
  drag = dx; layout();
});
const release = e => {
  if (!down) return; down = false; carousel.classList.remove('dragging');
  if (!moved) { const el = e.target.closest('.c-item'); if (el) goTo(pos + Math.round(wrapD(+el.dataset.i - pos))); return; }
  goTo(pos - Math.max(-2, Math.min(2, Math.round((drag + vel * 220) / spacing))));
};
carousel.addEventListener('pointerup', release);
carousel.addEventListener('pointercancel', release);
carousel.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight') { goTo(pos + 1); e.preventDefault(); }
  if (e.key === 'ArrowLeft') { goTo(pos - 1); e.preventDefault(); }
  if (e.key === 'Enter') assemble();
});
$('#prev').onclick = () => goTo(pos - 1);
$('#next').onclick = () => goTo(pos + 1);
$('#dots').onclick = e => { const b = e.target.closest('button'); if (b) goTo(pos + Math.round(wrapD(+b.dataset.i - pos))); };
let timers = [];
const later = (ms, fn) => timers.push(setTimeout(fn, reduce ? Math.min(ms, 120) : ms));
const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
const SPOTS = [[.35, .18], [.62, .25], [.48, .12], [.68, .15]];
function flyPetals(f) {
  const box = $('#petals'); box.innerHTML = ''; if (reduce) return;
  const im = items[current()].querySelector('img'), fw = +im.dataset.w || f.w, fh = +im.dataset.h || f.h;
  const bw = 72 / 0.2, bh = bw * fh / fw;
  for (let i = 0; i < 8; i++) {
    const [cx, cy] = SPOTS[i % 4], el = document.createElement('span'), s = 0.8 + (i % 3) * 0.18;
    el.className = 'petal';
    el.style.backgroundImage = `url(${f.cut || `/img/cut/${f.id}.png`})`;
    el.style.backgroundSize = `${bw}px ${bh}px`;
    el.style.backgroundPosition = `${-(cx * bw - 36)}px ${-(cy * bh - 36)}px`;
    box.appendChild(el);
    el.animate([
      { transform: `translate(${(i % 2 ? 1 : -1) * (180 + i * 22)}px,${-360 - i * 30}px) rotate(${i * 67}deg) scale(${s})`, opacity: 1 },
      { transform: `translate(${(i % 4 - 2) * 28}px,${(i % 3 - 1) * 26 - 40}px) rotate(${(i - 4) * 13}deg) scale(${s * .8})`, opacity: 0 }
    ], { duration: 1500, delay: i * 95, easing: 'cubic-bezier(.45,.05,.35,1)', fill: 'both' });
  }
}
const STEPS = ['Выбираем самые красивые', 'Собираем с любовью', 'Последний штрих'];
function setStep(n) { $('#stepText').textContent = STEPS[n]; $$('.steps-bar span').forEach((s, i) => s.classList.toggle('on', i <= n)); }
function assemble() {
  clearTimers();
  const f = FEATURED[current()];
  scene.classList.remove('revealed');
  $('#sEyebrow').textContent = 'Немного цветочной магии';
  $('#sName').textContent = f.name; $('#sMood').textContent = f.mood;
  $('#sImg').src = f.cut || `/img/cut/${f.id}.png`; $('#sImg').alt = f.name;
  syncStudioFav(); setStep(0);
  studio.dataset.phase = 'assembling';
  later(150, () => flyPetals(f));
  later(700, () => scene.classList.add('revealed'));
  later(1600, () => setStep(1));
  later(2700, () => setStep(2));
  later(3900, () => { studio.dataset.phase = 'ready'; $('#sEyebrow').textContent = 'Ваш маленький большой жест'; });
}
function resetStudio() { clearTimers(); studio.dataset.phase = 'choosing'; scene.classList.remove('revealed'); $('#petals').innerHTML = ''; }
function syncStudioFav() { const on = favs.has(FEATURED[current()].id); $('#sFav').setAttribute('aria-pressed', on); $('#sFav').setAttribute('aria-label', on ? 'Убрать из избранного' : 'В избранное'); }
$('#assemble').onclick = assemble; $('#again').onclick = assemble; $('#other').onclick = resetStudio;
$('#sFav').onclick = () => toggleFav(FEATURED[current()].id);
$('#choose').onclick = () => { const f = FEATURED[current()]; nav(byId[f.id] ? purl(byId[f.id]) : '/catalog/single/'); };
meta();
