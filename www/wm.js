// Gerenciador de janelas estilo Windows 98 (MDI): arrastar, foco/ordem, minimizar para a barra de tarefas, fechar, cascata.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Botões da barra de título no estilo Windows 98, desenhados em SVG (independem da fonte).
const G = {
  min: '<rect x="1" y="7" width="6" height="2"/>',
  max: '<path d="M0 0h9v9H0z M1 2v6h7V2z" fill-rule="evenodd"/>',
  restore: '<path d="M2 0h7v6H7V5h1V2H3v1H2z M0 3h7v6H0z M1 5v3h5V5z" fill-rule="evenodd"/>',
  close: '<path d="M0 0h2v1h1v1h2V1h1V0h2v1H7v1H6v1H5v1h1v1h1v1h1v1H6V6H5V5H3v1H2v1H0V6h1V5h1V4h1V3H2V2H1V1H0z"/>',
};
const VB = { min: '0 0 8 9', max: '0 0 9 9', restore: '0 0 9 9', close: '0 0 8 7' };
const TIP = { min: 'Minimizar', max: 'Maximizar', restore: 'Restaurar', close: 'Fechar' };
export function tbtn(kind, cls = '', disabled = false) {
  return `<button type="button" class="tbtn tbtn-${kind} ${cls}" data-kind="${kind}" title="${TIP[kind]}" aria-label="${TIP[kind]}" ${disabled ? 'disabled' : ''}><svg viewBox="${VB[kind]}" width="${VB[kind].split(' ')[2]}" height="${VB[kind].split(' ')[3]}" shape-rendering="crispEdges" aria-hidden="true">${G[kind]}</svg></button>`;
}
export function setTbtnKind(btn, kind) { btn.outerHTML = tbtn(kind, [...btn.classList].filter((c) => !c.startsWith('tbtn')).join(' ')); }
const wins = new Map(); // key -> win
let z = 100, cascade = 0;
export const isMobile = () => window.matchMedia('(max-width:600px)').matches;

function taskbar() {
  let tb = document.getElementById('taskbar');
  if (!tb) {
    tb = document.createElement('div'); tb.id = 'taskbar';
    tb.innerHTML = '<button class="tb-start" title="Janela principal do jogo">⚽ FutManager</button><div class="tb-items"></div><span class="tb-clock"></span>';
    document.body.appendChild(tb);
    tb.querySelector('.tb-start').onclick = () => { const m = wins.get('main'); if (!m) return; if (!m.min && m.el.classList.contains('wm-active')) m.minimize(); else m.restore(); };
    const clock = () => { tb.querySelector('.tb-clock').textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
    clock(); setInterval(clock, 30000);
  }
  return tb;
}
function drawTaskbar() {
  const tbm = wins.get('main'); taskbar().querySelector('.tb-start').classList.toggle('on', !!tbm && !tbm.min && tbm.el.classList.contains('wm-active'));
  const items = taskbar().querySelector('.tb-items');
  items.innerHTML = [...wins.values()].filter((w) => w.key !== 'main').map((w) => `<button data-wkey="${esc(w.key)}" class="${w.el.classList.contains('wm-active') && !w.min ? 'on' : ''}" title="${esc(w.title)}">${esc(w.title)}</button>`).join('');
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
  el.innerHTML = `<div class="titlebar wm-title"><span class="wm-caption"></span><span class="tb-btns">${tbtn('min', 'wm-min')}${tbtn('close', 'wm-close')}</span></div><div class="panel wm-body"></div>`;
  const step = (cascade++ % 8) * 28;
  const width = Math.min(opts.width || 600, window.innerWidth - 24);
  el.style.width = width + 'px';
  el.style.left = (opts.x ?? Math.max(8, Math.min(window.innerWidth - width - 8, 120 + step))) + 'px';
  el.style.top = (opts.y ?? (window.scrollY + 60 + step)) + 'px';
  document.body.appendChild(el);
  w = manage(el, { ...opts, key });
  if (opts.html !== undefined) w.body.innerHTML = opts.html;
  return w;
}

/** Coloca um elemento .window sob o gerenciador (arrastar, foco, minimizar, fechar/maximizar). */
function manage(el, opts) {
  const key = opts.key;
  const bar = el.querySelector('.titlebar');
  bar.classList.add('wm-title');
  const w = {
    key, el, title: opts.title || '', body: el.querySelector('.wm-body') || el, min: false, closable: opts.closable !== false,
    setTitle(t) { this.title = t; const c = el.querySelector('.wm-caption'); if (c) c.textContent = t; drawTaskbar(); },
    close() { if (!this.closable || !wins.has(key)) return; wins.delete(key); el.remove(); drawTaskbar(); opts.onClose && opts.onClose(); },
    minimize() { this.min = true; el.classList.add('wm-min-state'); el.classList.remove('wm-active'); drawTaskbar(); opts.onChange && opts.onChange(); },
    restore() { this.min = false; el.classList.remove('wm-min-state'); focus(this); opts.onChange && opts.onChange(); },
  };
  wins.set(key, w);
  if (opts.title !== undefined) w.setTitle(opts.title);
  el.querySelector('.wm-close')?.addEventListener('click', (e) => { e.stopPropagation(); w.close(); });
  el.querySelector('.wm-min')?.addEventListener('click', (e) => { e.stopPropagation(); w.minimize(); });
  el.addEventListener('pointerdown', () => { if (!el.classList.contains('wm-active')) focus(w); });
  bar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || isMobile() || el.classList.contains('wm-maxed')) return;
    const sx = e.clientX, sy = e.clientY, ox = el.offsetLeft, oy = el.offsetTop, width = el.offsetWidth;
    try { bar.setPointerCapture(e.pointerId); } catch (err) { /* sem captura */ }
    const move = (ev) => {
      el.style.left = Math.max(-width + 80, Math.min(window.innerWidth - 80, ox + ev.clientX - sx)) + 'px';
      el.style.top = Math.max(0, oy + ev.clientY - sy) + 'px';
    };
    const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); el.classList.remove('wm-drag'); opts.onChange && opts.onChange(); };
    el.classList.add('wm-drag');
    bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up);
  });
  focus(w);
  return w;
}

const MAIN_KEY = 'futmanager98_main_win';
/** Janela principal: arrastável, minimizável, maximizar/restaurar; posição salva no localStorage. */
export function manageMain(el, title) {
  el.classList.add('wm', 'wm-main');
  const save = () => {
    if (isMobile()) return;
    localStorage.setItem(MAIN_KEY, JSON.stringify({ x: el.offsetLeft, y: el.offsetTop, max: el.classList.contains('wm-maxed') }));
  };
  const w = manage(el, { key: 'main', title, closable: false, onChange: save });
  const maxBtn = () => el.querySelector('.wm-max');
  const setMax = (on) => {
    el.classList.toggle('wm-maxed', on);
    const b = maxBtn(); if (b) { setTbtnKind(b, on ? 'restore' : 'max'); maxBtn().addEventListener('click', toggle); }
    save();
  };
  const toggle = (e) => { e && e.stopPropagation(); setMax(!el.classList.contains('wm-maxed')); };
  maxBtn()?.addEventListener('click', toggle);
  el.querySelector('.titlebar').addEventListener('dblclick', (e) => { if (!e.target.closest('button') && !isMobile()) toggle(); });
  let p = null; try { p = JSON.parse(localStorage.getItem(MAIN_KEY)); } catch (e) { p = null; }
  const width = Math.min(1100, window.innerWidth - 120);
  if (!isMobile()) el.style.width = width + 'px';
  el.style.left = (p && Number.isFinite(p.x) ? Math.max(-width + 80, Math.min(window.innerWidth - 80, p.x)) : Math.max(96, (window.innerWidth - width) / 2 + 40)) + 'px';
  el.style.top = (p && Number.isFinite(p.y) ? Math.max(0, p.y) : 8) + 'px';
  if (p && p.max) setMax(true);
  w.maximize = () => setMax(true); w.unmaximize = () => setMax(false); w.toggleMax = toggle;
  return w;
}
export const resetMainPosition = () => localStorage.removeItem(MAIN_KEY);
export const getWindow = (key) => wins.get(key);
export const closeWindow = (key) => wins.get(key)?.close();
export function closeWhere(pred) { for (const w of [...wins.values()]) if (pred(w.key)) w.close(); }
export const openKeys = () => [...wins.keys()];
export function initWM() { taskbar(); }
