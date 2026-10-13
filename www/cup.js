// Copa Nacional: chaveamento, sorteio e disputa por pênaltis animada.
import { openWindow } from './wm.js';
import { teamLink } from './teams.js';
import { sfx } from './sound.js';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (v) => { const n = Math.round(v); return (n < 0 ? '−' : '') + 'R$ ' + Math.abs(n).toLocaleString('pt-BR'); };
const div = (d) => `<small class="cupdiv">D${d + 1}</small>`;

/** Placar de um confronto de Copa: "2 x 2 (4x3 pên.)" */
export function cupScore(t) {
  if (!t.played && t.over === undefined) return '- x -';
  return `${t.hg} x ${t.ag}${t.pens ? ` <small>(${t.pens[0]}x${t.pens[1]} pên.)</small>` : t.et ? ' <small>(prorr.)</small>' : ''}`;
}

export function openCup(st) {
  const c = st.cup, me = st.managed ? st.managed.id : -1;
  const tie = (t) => `<div class="cuptie ${t.home === me || t.away === me ? 'me' : ''}">
      <div class="${t.winner === t.home ? 'w' : t.played ? 'l' : ''}">${div(t.homeDiv)} ${teamLink(t.home, t.homeName)}<b>${t.played ? t.hg : ''}</b></div>
      <div class="${t.winner === t.away ? 'w' : t.played ? 'l' : ''}">${div(t.awayDiv)} ${teamLink(t.away, t.awayName)}<b>${t.played ? t.ag : ''}</b></div>
      ${t.pens ? `<small>pênaltis ${t.pens[0]}x${t.pens[1]}</small>` : t.et ? '<small>prorrogação</small>' : ''}</div>`;
  const cols = c.roundNames.map((n, r) => `<div class="cupcol"><div class="cuphead">${n}<br><small>após a ${c.after[r]}ª rodada · prêmio ${money(c.prizes[r])}</small></div>
      ${(c.ties[r] || []).map(tie).join('') || '<div class="small">A definir</div>'}</div>`).join('');
  const w = openWindow({ key: 'copa', id: 'copa', title: `Copa Nacional ${c.season}`, width: 1040,
    html: `<div class="cuptop">${c.winner ? `<b>🏆 Campeão: ${esc(c.winner)}</b>` : `Próxima fase: <b>${esc(c.roundNames[Math.min(c.round, 5)])}</b>`} · Seu clube: <b>${esc(c.status)}</b>
      <span class="small"> · Jogo único; empate vai para a prorrogação e pênaltis. O clube de divisão inferior joga em casa.</span></div>
      <div class="bracket">${cols}</div>` });
  return w;
}

export function openDraw(st, onAck) {
  const c = st.cup, me = st.managed ? st.managed.id : -1;
  const r = c.ties.length - 1;
  const ties = c.ties[r] || [];
  const mine = ties.find((t) => t.home === me || t.away === me);
  const w = openWindow({ key: 'sorteio', id: 'sorteio', title: `Sorteio da Copa — ${c.roundNames[r]}`, width: 560, x: Math.max(8, window.innerWidth / 2 - 280), y: window.scrollY + 100,
    onClose: onAck,
    html: `<p class="big">🎱 Copa Nacional ${c.season} — ${esc(c.roundNames[r])}</p>
      ${mine ? `<p class="fate fate-stay">Seu confronto: <b>${esc(mine.homeName)}</b> x <b>${esc(mine.awayName)}</b> ${mine.home === me ? '(em casa)' : '(fora)'} — jogo após a ${c.after[r]}ª rodada do campeonato.</p>` : `<p class="small">Seu clube não está nesta fase. ${esc(c.status)}</p>`}
      <div class="list" style="max-height:44vh"><table><tr><th>Mandante</th><th></th><th>Visitante</th></tr>
      ${ties.map((t, i) => `<tr class="${t === mine ? 'me' : ''} draw-row" style="animation-delay:${Math.min(i, 31) * 40}ms"><td>${div(t.homeDiv)} ${teamLink(t.home, t.homeName)}</td><td>x</td><td>${div(t.awayDiv)} ${teamLink(t.away, t.awayName)}</td></tr>`).join('')}</table></div>
      <p class="small">Prêmio para quem se classificar: ${money(c.prizes[r])}.</p><div class="about-ok"><button id="drawOk">OK</button></div>` });
  w.body.querySelector('#drawOk').onclick = () => w.close();
  return w;
}

/** Revela a disputa por pênaltis cobrança a cobrança, com sons; chama onDone ao final. */
export function animateShootout(events, render, speed, onDone, delayMs) {
  const kicks = events.filter((e) => e.kind.startsWith('disputa'));
  let i = 0;
  const delay = delayMs || (speed === 'lento' ? 1300 : 800);
  const next = () => {
    if (i >= kicks.length) { onDone(); return; }
    const e = kicks[i++];
    render(i);
    if (e.kind === 'disputa_inicio') sfx('penalti', speed);
    else if (e.kind === 'disputa_gol') sfx('disputa_gol', speed);
    else if (e.kind === 'disputa_perdido') sfx('disputa_perdido', speed);
    setTimeout(next, e.kind === 'disputa_inicio' ? delay * 1.6 : delay);
  };
  next();
}
