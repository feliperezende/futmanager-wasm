import { openWindow } from './wm.js';
// Encerramento de temporada, tabela "se terminasse agora" e Histórico.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (v) => { const n = Math.round(v); return (n < 0 ? '−' : '') + 'R$ ' + Math.abs(n).toLocaleString('pt-BR'); };
const DIV = (d) => `Divisão ${d + 1}`;
const tl = (n) => n ? `<span class="tlink" data-tname="${esc(n)}" title="Ver ficha do clube">${esc(n)}</span>` : '—';

import { soundOn, setSound, sfx } from './sound.js';
export { soundOn, setSound };
export const chime = (kind) => sfx(kind);

// ---------------------------------------------------------------- tabela ao vivo
/** Classificação provisória a partir da tabela antes da rodada + placares ao vivo. */
export function provisional(st, live) {
  const div = st.managed.division;
  const rows = st.tables[div].map((r, i) => ({ ...r, before: i + 1 }));
  const by = new Map(rows.map((r) => [r.id, r]));
  for (const m of live) {
    const h = by.get(m.home), a = by.get(m.away);
    if (!h || !a) continue;
    for (const [t, gf, ga] of [[h, m.hg, m.ag], [a, m.ag, m.hg]]) {
      t.p += 1; t.gf += gf; t.ga += ga;
      if (gf > ga) { t.w += 1; t.pts += 3; } else if (gf === ga) { t.d += 1; t.pts += 1; } else t.l += 1;
    }
  }
  rows.sort((x, y) => (y.pts - x.pts) || (y.w - x.w) || ((y.gf - y.ga) - (x.gf - x.ga)) || (y.gf - x.gf) || (x.id - y.id));
  return rows;
}
function zoneOf(st, div, pos) {
  const n = st.teamsPerDiv, k = st.promoted;
  if (pos === 1) return 'z-champ';
  if (div > 0 && pos <= k) return 'z-up';
  if (div < 3 && pos > n - k) return 'z-down';
  return '';
}
/** Jogos decisivos: envolvem times que ainda podem ganhar/perder título, acesso ou permanência nesta rodada. */
export function decisive(st, live) {
  const div = st.managed.division, n = st.teamsPerDiv, k = st.promoted;
  const t = st.tables[div];
  const left = st.rounds - st.round; // inclui a rodada atual
  const reach = 3 * left;
  const lines = [[1, 2]];
  if (div > 0) lines.push([k, k + 1]);
  if (div < 3) lines.push([n - k, n - k + 1]);
  const hot = new Set();
  for (const [a, b] of lines) {
    const above = t[a - 1].pts, below = t[b - 1].pts;
    for (const r of t) {
      const pos = t.indexOf(r) + 1;
      if (pos <= a && r.pts - below <= reach) hot.add(r.id);
      if (pos >= b && above - r.pts <= reach) hot.add(r.id);
    }
  }
  return new Set((live.length ? live : st.next.filter((x) => x.division === div)).filter((m) => hot.has(m.home) || hot.has(m.away)).map((m) => m.home));
}
export function isFinalStretch(st) { return st.managed && st.round >= st.rounds - 2 && st.round < st.rounds; }
export function renderLiveTable(st, live) {
  const el = document.getElementById('liveTable');
  if (!el || !isFinalStretch(st)) return;
  const div = st.managed.division;
  const rows = provisional(st, live);
  const hot = decisive(st, live);
  for (const id of hot) document.getElementById('sc-' + id)?.closest('tr')?.classList.add('decisive');
  const hotTeams = new Set();
  for (const m of (live.length ? live : st.next)) if (hot.has(m.home)) { hotTeams.add(m.home); hotTeams.add(m.away); }
  el.innerHTML = `<fieldset class="livetable"><legend>${st.round === st.rounds - 1 ? '🏁 Última rodada' : '⏳ Penúltima rodada'} — se terminasse agora</legend>
    <table><tr><th>#</th><th></th><th>Clube</th><th>J</th><th>SG</th><th>Pts</th></tr>
    ${rows.map((r, i) => { const pos = i + 1, d = r.before - pos;
      const arrow = d > 0 ? `<span class="up">▲${d}</span>` : d < 0 ? `<span class="down">▼${-d}</span>` : '';
      return `<tr class="${zoneOf(st, div, pos)} ${r.id === st.managed.id ? 'me' : ''}"><td class="n">${pos}</td><td>${arrow}</td><td>${hotTeams.has(r.id) ? '⚡ ' : ''}${esc(r.name)}</td><td class="n">${r.p}</td><td class="n">${r.gf - r.ga}</td><td class="n"><b>${r.pts}</b></td></tr>`; }).join('')}
    </table><div class="legend"><span class="z-champ">■ título</span>${div > 0 ? ' <span class="z-up">■ acesso</span>' : ''}${div < 3 ? ' <span class="z-down">■ rebaixamento</span>' : ''} · ⚡ jogo decisivo</div></fieldset>`;
}

// ---------------------------------------------------------------- encerramento
const TROPHY = `<svg class="trophy" viewBox="0 0 120 140" width="120" height="140" aria-label="Taça">
  <defs><linearGradient id="gold" x1="0" x2="1"><stop offset="0" stop-color="#8a6d00"/><stop offset=".45" stop-color="#ffe680"/><stop offset="1" stop-color="#b38f00"/></linearGradient></defs>
  <path d="M30 12h60v22c0 24-14 40-30 40S30 58 30 34z" fill="url(#gold)" stroke="#5a4500" stroke-width="2"/>
  <path d="M30 20H14c0 18 8 28 20 30M90 20h16c0 18-8 28-20 30" fill="none" stroke="url(#gold)" stroke-width="6"/>
  <rect x="54" y="74" width="12" height="22" fill="url(#gold)" stroke="#5a4500"/>
  <rect x="38" y="96" width="44" height="10" fill="url(#gold)" stroke="#5a4500"/>
  <rect x="30" y="106" width="60" height="22" fill="#5a3a1a" stroke="#2a1a00"/>
  <text x="60" y="121" font-size="10" text-anchor="middle" fill="#ffe680" font-family="Tahoma,sans-serif">CAMPEÃO</text>
  <text x="60" y="48" font-size="22" text-anchor="middle">⭐</text></svg>`;

export function confetti(host) {
  const box = document.createElement('div'); box.className = 'confetti';
  const colors = ['#f00', '#ff0', '#0a0', '#00f', '#f0f', '#0ff', '#fa0'];
  for (let i = 0; i < 90; i++) {
    const c = document.createElement('i');
    c.style.left = Math.random() * 100 + '%'; c.style.background = colors[i % colors.length];
    c.style.animationDelay = (Math.random() * 1.5) + 's'; c.style.animationDuration = (2.2 + Math.random() * 2) + 's';
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    box.appendChild(c);
  }
  host.appendChild(box);
  setTimeout(() => box.remove(), 6000);
}

const pj = (p) => p ? `<b>${esc(p.name)}</b> (${esc(p.pos)}, ${p.age} anos) — ${tl(p.team)}` : '—';
function fateMsg(u) {
  const d = u.division;
  return {
    champion: ['festa', `🏆 CAMPEÃO NACIONAL! O ${esc(u.team)} é o maior do país! Noite inesquecível para a torcida.`],
    champion_up: ['festa', `🏆 Campeão da ${DIV(d)} e promovido! Taça na mão e vaga na ${DIV(d - 1)}!`],
    promoted: ['festa', `🎉 ACESSO! O ${esc(u.team)} sobe para a ${DIV(d - 1)}. A cidade está em festa!`],
    relegated: ['triste', `💔 Rebaixado. O ${esc(u.team)} cai para a ${DIV(d + 1)}. Dia de luto, mas a reconstrução começa agora.`],
    stay: ['', `O ${esc(u.team)} segue na ${DIV(d)} na próxima temporada.`],
  }[u.fate];
}

function pages(r, st) {
  const u = r.user;
  const myDiv = u ? u.division : 0;
  const celebrate = u && (u.champion || u.promoted);
  const champ = r.divisions[myDiv].champion;
  const P = [];
  P.push({ key: 'campeao', title: '🏆 Campeões da temporada', party: celebrate, sound: celebrate ? 'festa' : '', html: `
    <div class="champ-hero ${u && u.champion ? 'mine' : ''}">${TROPHY}
      <div><div class="small">Temporada ${r.season} — ${DIV(myDiv)}</div><div class="champ-name">${tl(champ.name)}</div>
      <div>${champ.pts} pontos · ${champ.w}V ${champ.d}E ${champ.l}D · ${champ.gf} gols</div>
      ${u && u.champion ? '<div class="party">É CAMPEÃO! A taça é sua!</div>' : `<div class="small">Vice: ${tl(r.divisions[myDiv].runnerUp.name)} (${r.divisions[myDiv].runnerUp.pts} pts)</div>`}</div></div>
    <table><tr><th>Divisão</th><th>Campeão</th><th>Pts</th><th>Vice</th><th>Artilheiro</th></tr>
    ${r.divisions.map((d) => `<tr class="${u && d.champion.id === u.id ? 'me' : ''}"><td>🏆 ${DIV(d.division)}</td><td><b>${tl(d.champion.name)}</b></td><td class="n">${d.champion.pts}</td><td>${tl(d.runnerUp.name)}</td><td>${d.topScorer ? `${esc(d.topScorer.name)} (${d.topScorer.goals})` : '—'}</td></tr>`).join('')}</table>` });
  const [snd, msg] = u ? fateMsg(u) : ['', ''];
  const teamCell = (t) => `<span class="tlink ${u && t.id === u.id ? 'me-inline' : ''}" data-team="${t.id}">${esc(t.name)}</span>`;
  P.push({ key: 'acesso', title: '⬆⬇ Acesso e rebaixamento', party: u && u.promoted, sound: snd, html: `
    ${u ? `<p class="fate fate-${u.fate}">${msg}</p>` : ''}
    <table><tr><th>Divisão</th><th>⬆ Sobem</th><th>⬇ Caem</th></tr>
    ${r.divisions.map((d) => `<tr><td>${DIV(d.division)}</td><td class="up">${d.promoted.length ? d.promoted.map(teamCell).join(', ') : '—'}</td><td class="down">${d.relegated.length ? d.relegated.map(teamCell).join(', ') : '—'}</td></tr>`).join('')}</table>` });
  const a = r.awards;
  const xi = a.teamOfSeason;
  const line = (pos) => `<div class="xi-line">${xi.filter((p) => p.pos === pos).map((p) => `<div class="xi-p" title="${esc(p.team)}">${esc(p.name)}<small>${esc(p.team)}</small></div>`).join('')}</div>`;
  P.push({ key: 'premios', title: '🥇 Prêmios da temporada', html: `
    <table class="awards">
      <tr><td>⚽ Artilheiro</td><td>${pj(a.topScorer)}${a.topScorer ? ` — <b>${a.topScorer.goals} gols</b>` : ''}</td></tr>
      <tr><td>⭐ Craque da temporada</td><td>${pj(a.bestPlayer)}${a.bestPlayer ? ` — força ${a.bestPlayer.skill}, ${a.bestPlayer.goals} gols` : ''}</td></tr>
      <tr><td>🌱 Revelação (até 21 anos)</td><td>${pj(a.revelation)}${a.revelation ? ` — força ${a.revelation.skill}` : ''}</td></tr>
      <tr><td>🎩 Técnico da temporada</td><td>${a.bestManager ? (a.bestManager.you ? `<b>Você!</b> (${esc(a.bestManager.team)})` : `Técnico do <b>${esc(a.bestManager.team)}</b>`) + ` — ${a.bestManager.position}º lugar na ${DIV(a.bestManager.division)}, esperado ${a.bestManager.expected}º` : '—'}</td></tr>
    </table>
    <fieldset><legend>Seleção da temporada — ${DIV(a.teamOfSeasonDivision)} (4-4-2)</legend><div class="pitch">${line('A')}${line('M')}${line('D')}${line('G')}</div></fieldset>` });
  if (u) {
    const f = u.finance;
    const inc = f.tickets + f.tv + f.prizes + f.transfers_in + Math.max(0, f.loan_fees);
    const out = f.salaries + f.upkeep + f.investments + f.transfers_out + f.bank_paid + Math.max(0, -f.loan_fees);
    const diff = u.expected - u.position;
    const cmp = diff > 0 ? `<span class="up">${diff} posição(ões) acima do esperado</span>` : diff < 0 ? `<span class="down">${-diff} posição(ões) abaixo do esperado</span>` : 'exatamente o esperado';
    const gcol = u.grade >= 8 ? '#060' : u.grade >= 5.5 ? '#000080' : u.grade >= 3.5 ? '#a60' : '#a00';
    P.push({ key: 'temporada', title: `📋 Sua temporada — ${esc(u.team)}`, html: `
      <div class="cols"><div><table>
        <tr><td>Posição final</td><td class="n"><b>${u.position}º</b> na ${DIV(u.division)}</td></tr>
        <tr><td>Expectativa da diretoria</td><td class="n">${u.expected}º (${cmp})</td></tr>
        <tr><td>Campanha</td><td class="n">${u.pts} pts · ${u.w}V ${u.d}E ${u.l}D</td></tr>
        <tr><td>Gols</td><td class="n">${u.gf} pró · ${u.ga} contra (saldo ${u.gf - u.ga})</td></tr>
        ${u.deducted ? `<tr><td>Pontos perdidos (dívidas)</td><td class="n down">−${u.deducted}</td></tr>` : ''}
        <tr><td>Artilheiro do clube</td><td class="n">${u.topScorer ? `${esc(u.topScorer.name)} (${u.topScorer.goals})` : '—'}</td></tr>
      </table></div><div><table>
        <tr><th colspan="2">Finanças da temporada</th></tr>
        <tr><td>Receitas (bilheteria, TV, prêmios, vendas)</td><td class="n">${money(inc)}</td></tr>
        <tr><td>Despesas (salários, manutenção, compras)</td><td class="n down">${money(-out)}</td></tr>
        <tr><td>Resultado</td><td class="n"><b class="${inc - out >= 0 ? 'up' : 'down'}">${money(inc - out)}</b></td></tr>
        <tr><td>Caixa atual</td><td class="n">${money(u.budget)}</td></tr>
        ${u.bankDebt ? `<tr><td>Dívida bancária</td><td class="n down">${money(-u.bankDebt)}</td></tr>` : ''}
      </table></div></div>
      <fieldset class="board"><legend>Avaliação da diretoria</legend>
        <div class="grade" style="color:${gcol}">${u.grade.toFixed(1).replace('.', ',')}<small>/10</small></div>
        <div><div class="meter"><div style="width:${u.grade * 10}%;background:${gcol}"></div></div>
        <p>Diretoria <b>${esc(u.mood)}</b>. ${esc(u.boardText)}</p><p>Estabilidade no cargo: <b>${esc(u.security)}</b></p></div></fieldset>` });
  }
  const n = r.next;
  if (n) {
    const li = (v, empty) => v.length ? `<ul>${v.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="small">${empty}</p>`;
    P.push({ key: 'proxima', title: `📅 Temporada ${n.season}`, html: `
      <table>
        <tr><td>Divisão</td><td class="n"><b>${DIV(n.division)}</b>${u && n.division !== u.division ? (n.division < u.division ? ' <span class="up">▲ promovido</span>' : ' <span class="down">▼ rebaixado</span>') : ''}</td></tr>
        <tr><td>Premiação recebida</td><td class="n">${money(n.prize)}</td></tr>
        <tr><td>Orçamento (caixa) para a temporada</td><td class="n"><b>${money(n.budget)}</b></td></tr>
        <tr><td>Folha salarial por rodada</td><td class="n">${money(n.wageBill)}</td></tr>
        <tr><td>Meta da diretoria</td><td class="n">terminar por volta do ${n.expected}º lugar</td></tr>
      </table>
      <div class="cols"><div><b>👴 Aposentadorias</b>${li(n.retirements, 'Nenhum jogador do elenco se aposentou.')}
        <b>📄 Contratos encerrados</b>${li(n.expiredContracts, 'Ninguém deixou o clube por fim de contrato.')}</div>
      <div><b>⚠️ Contratos que vencem ao fim da temporada ${n.season}</b>${li(n.expiringContracts, 'Nenhum contrato vence nesta temporada.')}
        ${n.expiringContracts.length ? '<p class="small">Renove na aba Clube antes que eles saiam de graça.</p>' : ''}</div></div>` });
  }
  return P;
}

let open = false;
export const finaleOpen = () => open;
/** Abre o encerramento paginado numa janela própria. onClose é chamado ao concluir/pular/fechar. */
export function openFinale(r, st, onClose) {
  if (!r || open) return;
  open = true;
  const P = pages(r, st);
  let i = 0, done = false;
  const w = openWindow({ key: 'finale', id: 'finale', width: 780, className: 'finale-win', x: Math.max(8, (window.innerWidth - 780) / 2),
    onClose: () => { open = false; if (!done) { done = true; onClose && onClose(); } } });
  const close = () => w.close();
  const show = () => {
    const p = P[i];
    w.el.dataset.page = p.key;
    w.setTitle(`Fim da temporada ${r.season} — ${p.title.replace(/<[^>]+>/g, '')}`);
    w.body.innerHTML = `<div class="finale-body">${p.html}</div>
      <div class="finale-nav"><span class="dots">${P.map((_, k) => `<span class="${k === i ? 'on' : ''}">●</span>`).join(' ')} &nbsp;Página ${i + 1}/${P.length}</span>
        <label title="Efeitos sonoros discretos"><input type="checkbox" id="finSound" ${soundOn() ? 'checked' : ''}> Som</label>
        <button id="finPrev" ${i === 0 ? 'disabled' : ''}>◀ Anterior</button>
        <button id="finNext">${i === P.length - 1 ? 'Concluir ✔' : 'Próximo ▶'}</button>
        <button id="finSkipBtn">Pular</button></div>`;
    w.body.querySelector('#finPrev').onclick = () => { if (i > 0) { i--; chime('virar'); show(); } };
    w.body.querySelector('#finNext').onclick = () => { if (i < P.length - 1) { i++; chime('virar'); show(); } else close(); };
    w.body.querySelector('#finSkipBtn').onclick = close;
    w.body.querySelector('#finSound').onchange = (e) => { setSound(e.target.checked); if (e.target.checked) chime('virar'); };
    if (p.party) confetti(w.el);
    if (p.sound) chime(p.sound);
  };
  show();
}

// ---------------------------------------------------------------- Histórico
export function renderHistory(st, el, reopen) {
  const h = st.history || [];
  const fateIcon = { champion: '🏆', champion_up: '🏆⬆', promoted: '⬆', relegated: '⬇', stay: '' };
  const titles = h.filter((x) => x.fate === 'champion' || x.fate === 'champion_up').length;
  const counts = new Map();
  for (const s of h) for (const c of s.champions) counts.set(c, (counts.get(c) || 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  el.innerHTML = h.length === 0 ? `<fieldset><legend>Histórico</legend><p>Nenhuma temporada encerrada ainda. Termine a temporada ${st.season} para inaugurar a galeria de campeões!</p></fieldset>` : `
    <fieldset><legend>🏛 Galeria de campeões</legend><table><tr><th>Temp.</th>${[0, 1, 2, 3].map((d) => `<th>🏆 ${DIV(d)}</th>`).join('')}<th>Artilheiro</th></tr>
      ${h.slice().reverse().map((s) => `<tr><td class="n">${s.season}</td>${s.champions.map((c) => `<td class="${c === s.team ? 'me' : ''}">${tl(c)}</td>`).join('')}<td>${esc(s.topScorer || '—')}</td></tr>`).join('')}</table></fieldset>
    <div class="cols"><div><fieldset><legend>📋 Suas temporadas (${titles} título(s))</legend><table><tr><th>Temp.</th><th>Clube</th><th>Div.</th><th>Pos.</th><th>Esperado</th><th>Pts</th><th>Nota</th><th></th></tr>
      ${h.slice().reverse().filter((s) => s.team).map((s) => `<tr><td class="n">${s.season}</td><td>${tl(s.team)}</td><td class="n">${s.division + 1}</td><td class="n">${s.position}º</td><td class="n">${s.expected}º</td><td class="n">${s.pts}</td><td class="n">${Number(s.grade).toFixed(1).replace('.', ',')}</td><td>${fateIcon[s.fate] || ''}</td></tr>`).join('')}</table></fieldset></div>
    <div><fieldset><legend>⭐ Maiores campeões</legend><table><tr><th>Clube</th><th>Títulos</th></tr>${top.map(([c, n]) => `<tr><td>${tl(c)}</td><td class="n">${n}</td></tr>`).join('')}</table></fieldset>
    ${st.report ? '<button id="btnReopen">🏆 Rever encerramento da última temporada</button>' : ''}</div></div>`;
  const b = el.querySelector('#btnReopen'); if (b) b.onclick = reopen;
}
