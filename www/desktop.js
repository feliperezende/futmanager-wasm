// Ícones da área de trabalho (estilo Windows 98) e janela "Sobre".
import { openWindow, getWindow, isMobile } from './wm.js';

const REPO = 'https://github.com/feliperezende/futmanager-wasm';
export const LOGO = `<svg viewBox="0 0 32 32" width="32" height="32" shape-rendering="crispEdges" aria-hidden="true">
  <rect x="2" y="3" width="28" height="20" fill="#c0c0c0" stroke="#000"/><rect x="4" y="5" width="24" height="16" fill="#1f7a1f"/>
  <rect x="15" y="5" width="1" height="16" fill="#fff"/><rect x="11" y="10" width="9" height="6" fill="none" stroke="#fff"/>
  <rect x="11" y="23" width="10" height="3" fill="#808080"/><rect x="7" y="26" width="18" height="2" fill="#404040"/>
  <circle cx="23" cy="20" r="6" fill="#fff" stroke="#000"/><path d="M23 16l2 2-1 3h-2l-1-3z M17.5 19l2 0.5 0.5 2-1.5 1.5 M28.5 19l-2 0.5-0.5 2 1.5 1.5" fill="#000"/></svg>`;
const ICON_SOBRE = `<svg viewBox="0 0 32 32" width="32" height="32" shape-rendering="crispEdges" aria-hidden="true">
  <rect x="4" y="2" width="22" height="28" fill="#fff" stroke="#000"/><rect x="26" y="4" width="2" height="26" fill="#808080"/><rect x="6" y="30" width="22" height="2" fill="#808080"/>
  <circle cx="15" cy="11" r="5" fill="#000080"/><rect x="14" y="8" width="2" height="2" fill="#fff"/><rect x="14" y="11" width="2" height="4" fill="#fff"/>
  <rect x="8" y="19" width="14" height="1" fill="#808080"/><rect x="8" y="22" width="12" height="1" fill="#808080"/><rect x="8" y="25" width="14" height="1" fill="#808080"/></svg>`;

export function openAbout(version) {
  const w = openWindow({ key: 'sobre', id: 'sobre', title: 'Sobre o FutManager', width: 420, className: 'wm-about',
    x: Math.max(8, (window.innerWidth - 420) / 2), y: window.scrollY + 120,
    html: `<div class="about"><div class="about-logo">${LOGO}</div><div>
      <h2>FutManager 98</h2><div>Versão ${version}</div>
      <p>Remake original de gerenciador de futebol, feito em Rust + WebAssembly, no estilo dos jogos de 1998. Clubes, jogadores e narração são fictícios.</p>
      <p><b>Autores:</b> Felipe Rezende e Grok Bot</p>
      <p>Código-fonte: <a href="${REPO}" target="_blank" rel="noopener">${REPO.replace('https://', '')}</a></p></div></div>
      <hr><div class="about-ok"><button id="aboutOk">OK</button></div>` });
  w.body.querySelector('#aboutOk').onclick = () => w.close();
  w.body.querySelector('#aboutOk').focus();
  return w;
}

/** Cria a coluna de ícones na área de trabalho. */
export function initDesktop(version) {
  const d = document.createElement('div');
  d.id = 'desktop';
  const icons = [
    { id: 'icon-futmanager', label: 'FutManager', svg: LOGO, open: () => getWindow('main')?.restore() },
    { id: 'icon-sobre', label: 'Sobre', svg: ICON_SOBRE, open: () => openAbout(version) },
  ];
  d.innerHTML = icons.map((i) => `<div class="dicon" id="${i.id}" tabindex="0" role="button" aria-label="${i.label}">${i.svg}<span>${i.label}</span></div>`).join('');
  document.body.prepend(d);
  const select = (el) => d.querySelectorAll('.dicon').forEach((x) => x.classList.toggle('sel', x === el));
  icons.forEach((i) => {
    const el = d.querySelector('#' + i.id);
    el.addEventListener('click', (e) => { e.stopPropagation(); select(el); if (isMobile()) i.open(); });
    el.addEventListener('dblclick', (e) => { e.stopPropagation(); i.open(); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') i.open(); });
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.dicon')) select(null); });
}
