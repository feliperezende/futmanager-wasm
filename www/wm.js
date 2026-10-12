// Gerenciador de janelas estilo Windows 98 (MDI): arrastar, foco/ordem, minimizar para a barra de tarefas, fechar, cascata.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const wins = new Map(); // key -> win
let z = 100, cascade = 0;
export const isMobile = () => window.matchMedia('(max-width:600px)').matches;

function taskbar() {
  let tb = document.getElementById('taskbar');
  if (!tb) {
    tb = document.createElement('div'); tb.id = 'taskbar';
    tb.innerHTML = '<button class="tb-start" title="Janela principal do jogo">⚽ FutManager</button><div class="tb-items"></div><span class="tb-clock"></span>';
    document.body.appendChild(tb);
    tb.querySelector('.tb-start').onclick = () => { document.getElementById('app')?.scrollIntoView({ behavior: 'smooth' }); for (const w of wins.values()) w.el.classList.remove('wm-active'); };
    const clock = () => { tb.querySelector('.tb-clock').textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
    clock(); setInterval(clock, 30000);
  }
  return tb;
}
function drawTaskbar() {
  const items = taskbar().querySelector('.tb-items');
  items.innerHTML = [...wins.values()].map((w) => `<button data-wkey="${esc(w.key)}" class="${w.el.classList.contains('wm-active') && !w.min ? 'on' : ''}" title="${esc(w.title)}">${esc(w.title)}</button>`).join('');
  items.querySelectorAll('[data-wkey]').forEach((b) => b.onclick = () => {
    const w = wins.get(b.dataset.wkey);
    if (!w) return;
    if (!w.min && w.el.classList.contains('wm-active')) w.minimize(); else w.restore();
  });
}
function focus(w) {
  for (const o of wins.values()) o.el.classList.remove('wm-active');
  w.el.classList.add('wm-active');
  w.el.style.zIndex = ++z;
  drawTaskbar();
}

/**
 * Abre (ou traz para frente) uma janela.
 * opts: key (único), title, html, width, className, id, onClose, x, y
 */
export function openWindow(opts) {
  const key = opts.key || ('w' + Math.random());
  let w = wins.get(key);
  if (w) { if (opts.html !== undefined) w.body.innerHTML = opts.html; w.setTitle(opts.title ?? w.title); w.restore(); return w; }
  const el = document.createElement('div');
  el.className = 'window wm ' + (opts.className || '');
  if (opts.id) el.id = opts.id;
  el.innerHTML = `<div class="titlebar wm-title"><span class="wm-caption"></span><span class="tb-btns"><button class="wm-min" title="Minimizar">_</button><button class="wm-close" title="Fechar">X</button></span></div><div class="panel wm-body"></div>`;
  const step = (cascade++ % 8) * 28;
  const width = Math.min(opts.width || 600, window.innerWidth - 24);
  el.style.width = width + 'px';
  el.style.left = (opts.x ?? Math.max(8, Math.min(window.innerWidth - width - 8, 120 + step))) + 'px';
  el.style.top = (opts.y ?? (window.scrollY + 60 + step)) + 'px';
  document.body.appendChild(el);
  w = {
    key, el, title: opts.title || '', body: el.querySelector('.wm-body'), min: false,
    setTitle(t) { this.title = t; el.querySelector('.wm-caption').textContent = t; drawTaskbar(); },
    close() { if (!wins.has(key)) return; wins.delete(key); el.remove(); drawTaskbar(); opts.onClose && opts.onClose(); },
    minimize() { this.min = true; el.classList.add('wm-min-state'); el.classList.remove('wm-active'); drawTaskbar(); },
    restore() { this.min = false; el.classList.remove('wm-min-state'); focus(this); },
  };
  wins.set(key, w);
  w.setTitle(opts.title || '');
  if (opts.html !== undefined) w.body.innerHTML = opts.html;
  el.querySelector('.wm-close').onclick = (e) => { e.stopPropagation(); w.close(); };
  el.querySelector('.wm-min').onclick = (e) => { e.stopPropagation(); w.minimize(); };
  el.addEventListener('pointerdown', () => { if (!el.classList.contains('wm-active')) focus(w); });
  // arrastar pela barra de título
  const bar = el.querySelector('.wm-title');
  bar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || isMobile()) return;
    const sx = e.clientX, sy = e.clientY, ox = el.offsetLeft, oy = el.offsetTop;
    try { bar.setPointerCapture(e.pointerId); } catch (err) { /* sem captura */ }
    const move = (ev) => {
      el.style.left = Math.max(-width + 80, Math.min(window.innerWidth - 80, ox + ev.clientX - sx)) + 'px';
      el.style.top = Math.max(0, oy + ev.clientY - sy) + 'px';
    };
    const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); el.classList.remove('wm-drag'); };
    el.classList.add('wm-drag');
    bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up);
  });
  focus(w);
  return w;
}
export const getWindow = (key) => wins.get(key);
export const closeWindow = (key) => wins.get(key)?.close();
export function closeWhere(pred) { for (const w of [...wins.values()]) if (pred(w.key)) w.close(); }
export const openKeys = () => [...wins.keys()];
export function initWM() { taskbar(); }
