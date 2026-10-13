// Ficha do clube, cartão do jogador, pré-jogo do adversário e jogadores em campo.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (v) => { const n = Math.round(v); return (n < 0 ? '−' : '') + 'R$ ' + Math.abs(n).toLocaleString('pt-BR'); };
import { openWindow, closeWhere } from './wm.js';
const ORDER = { G: 0, D: 1, M: 2, A: 3 };

/** Nome de clube clicável (abre a ficha). */
export const teamLink = (id, name) => id === null || id === undefined ? esc(name) : `<span class="tlink" data-team="${id}" title="Ver ficha do clube">${esc(name)}</span>`;
/** Nome de clube clicável quando só se conhece o nome. */
export const teamNameLink = (name) => `<span class="tlink" data-tname="${esc(name)}" title="Ver ficha do clube">${esc(name)}</span>`;
/** Nome de jogador clicável (abre o cartão). */
export const playerLink = (id, name) => `<span class="plink" data-player="${id}" title="Ver cartão do jogador">${esc(name)}</span>`;

export function formHtml(f) {
  if (!f) return '<span class="small">—</span>';
  return `<span class="form">${[...f].map((c) => `<b class="f-${c}" title="${{ V: 'Vitória', E: 'Empate', D: 'Derrota' }[c]}">${c}</b>`).join('')}</span>`;
}
const flags = (p) => (p.injured ? ` <span title="Lesionado (${p.injured} rodada(s))">🚑${p.injured}</span>` : '') + (p.suspended ? ` <span title="Suspenso (${p.suspended} jogo(s))">🟥${p.suspended}</span>` : '') + (p.yellows ? ` <span title="Amarelos acumulados">🟨${p.yellows}</span>` : '');
const moraleIcon = (v) => (v >= 70 ? '😃' : v >= 45 ? '🙂' : v >= 25 ? '😐' : '😠') + ' ' + v;
const cond = (v) => `<span class="${v < 60 ? 'cond-low' : v < 80 ? 'cond-mid' : ''}">${Math.round(v)}%</span>`;

// ---------------------------------------------------------------- contexto
let ctx = null; // { game, getState, refresh, flash, canAct }
export function initTeams(c) {
  ctx = c;
  document.addEventListener('click', (e) => {
    const p = e.target.closest('.plink[data-player]');
    if (p) { e.preventDefault(); openPlayer(+p.dataset.player); return; }
    const t = e.target.closest('.tlink[data-team],.team-card[data-team],.tlink[data-tname]');
    if (!t) return;
    let id = t.dataset.team !== undefined ? +t.dataset.team : null;
    if (id === null) { const f = ctx.getState().teams.find((x) => x.name === t.dataset.tname); if (!f) return; id = f.id; }
    e.preventDefault(); openTeam(id);
  });
}

export const closeTeam = () => closeWhere((k) => k.startsWith('team-'));
export const closePlayer = () => closeWhere((k) => k.startsWith('player-'));

// Compra de jogador de outro clube: sempre pela janela de negociação (fechada fora da janela de transferências)
function buyBtn(p, attr) {
  const open = ctx.marketOpen();
  return `<button ${attr}="${p.id}" ${open ? '' : 'disabled'} title="${open ? `Negociar (preço pedido ${money(p.buyPrice)})` : 'Janela de transferências fechada'}">Negociar</button>`;
}
// ---------------------------------------------------------------- ficha do clube
const COLS = [
  ['pos', 'Pos', (p) => ORDER[p.pos]], ['name', 'Nome', (p) => p.name], ['skill', 'Hab.', (p) => p.skill], ['attrs', 'Fin/Pas/Mar/Gol/Res', (p) => p.attrs.finishing + p.attrs.passing],
  ['condition', 'Físico', (p) => p.condition], ['age', 'Idade', (p) => p.age], ['salary', 'Salário/rod.', (p) => p.salary], ['value', 'Valor', (p) => p.value],
  ['goals', 'Gols', (p) => p.goals], ['morale', 'Moral', (p) => p.morale], ['contract', 'Contrato', (p) => p.contractUntil],
];
let sortKey = 'pos', sortDir = 1;
export function teamInfoHtml(t) {
  return `<table class="kv">
    ${t.colors ? `<tr><td>Cores</td><td><span class="clubcolor" style="background:${t.colors[0]}"></span><span class="clubcolor" style="background:${t.colors[1]}"></span> ${esc(t.colors[2])}</td></tr>` : ''}
    <tr><td>Divisão</td><td>${t.division + 1}ª — <b>${t.position}º lugar</b> (${t.stats.pts} pts, ${t.stats.w}V ${t.stats.d}E ${t.stats.l}D, ${t.stats.gf}:${t.stats.ga})</td></tr>
    <tr><td>Forma (últimos 5)</td><td>${formHtml(t.form)}</td></tr>
    <tr><td>Esquema / tática</td><td>${esc(t.formation)} · ${esc(t.tactic)}${t.pressing ? ' · pressão' : ''}</td></tr>
    <tr><td>Força</td><td>Ataque <b>${t.attack.toFixed(1)}</b> · Defesa <b>${t.defense.toFixed(1)}</b> · Moral ${moraleIcon(t.morale)}</td></tr>
    <tr><td>Caixa</td><td>${money(t.budget)} · folha ${money(t.wageBill)}/rod.</td></tr>
    <tr><td>Estádio</td><td>${t.capacity.toLocaleString('pt-BR')} lugares · ingresso ${money(t.ticketPrice)}</td></tr>
    <tr><td>Categorias de base</td><td>nível ${t.academyLevel}/5</td></tr></table>`;
}
export function openTeam(id) {
  const t = JSON.parse(ctx.game().team(id));
  if (!t) return;
  const w = openWindow({ key: 'team-' + id, id: 'team-' + id, title: `Ficha do clube — ${t.name}${t.managed ? ' (seu clube)' : ''}`, width: 980, className: 'wm-team teamview' });
  w.el.dataset.teamId = t.id;
  const m = w.body;
  const draw = () => {
    const col = COLS.find((c) => c[0] === sortKey);
    const squad = [...t.squad].sort((a, b) => { const x = col[2](a), y = col[2](b); return (x < y ? -1 : x > y ? 1 : 0) * sortDir || ORDER[a.pos] - ORDER[b.pos] || b.skill - a.skill; });
    const inXI = new Set(t.lineup.map((p) => p.id));
    const act = !t.managed && ctx.canAct();
    m.innerHTML = `<div class="cols"><div>${teamInfoHtml(t)}</div>
      <div><table><tr><th colspan="3">Artilheiros do clube</th></tr>${t.scorers.length ? t.scorers.map((p) => `<tr><td>${playerLink(p.id, p.name)}</td><td>${p.pos}</td><td class="n">${p.goals}</td></tr>`).join('') : '<tr><td colspan="3" class="small">Nenhum gol ainda.</td></tr>'}</table>
      ${t.unavailable.length ? `<p class="small">Desfalques: ${t.unavailable.map((p) => esc(p.name) + flags(p)).join(', ')}</p>` : ''}</div></div>
      <div class="list"><table class="sortable"><tr>${COLS.map(([k, l]) => `<th data-sort="${k}" title="Ordenar por ${l}">${l}${k === sortKey ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}<th>Preço</th><th></th></tr>
      ${squad.map((p) => `<tr class="${inXI.has(p.id) ? 'xi' : ''}"><td class="pos-${p.pos}">${p.pos}</td><td>${playerLink(p.id, p.name)}${inXI.has(p.id) ? ' <small title="Titular provável">★</small>' : ''}<small>${flags(p)}</small></td><td>${p.skill}</td>
        <td><small>${p.attrs.finishing}/${p.attrs.passing}/${p.attrs.tackling}/${p.attrs.keeping}/${p.attrs.stamina}</small></td><td>${cond(p.condition)}</td><td>${p.age}</td><td>${money(p.salary)}</td><td>${money(p.value)}</td><td>${p.goals}</td><td>${moraleIcon(p.morale)}</td>
        <td>${p.loanFrom ? `<small>emprestado (${esc(p.loanFrom)})</small>` : 'até T' + p.contractUntil}</td><td>${t.managed ? '—' : money(p.buyPrice)}</td>
        <td class="nowrap">${act && !p.loanFrom ? `${buyBtn(p, 'data-tvneg')} <button data-tvloan="${p.id}" title="Empréstimo até o fim da temporada: ${money(p.loanFee)}">Emprestar</button>` : ''}</td></tr>`).join('')}
      </table></div><small>★ titular provável · clique no cabeçalho para ordenar · clique no nome para ver o cartão do jogador</small>`;
    m.querySelectorAll('[data-sort]').forEach((h) => h.onclick = () => { if (sortKey === h.dataset.sort) sortDir = -sortDir; else { sortKey = h.dataset.sort; sortDir = ['skill', 'value', 'goals', 'salary', 'condition', 'morale'].includes(sortKey) ? -1 : 1; } draw(); });
    const doAct = (fn, pid) => { const r = JSON.parse(fn(pid)); ctx.flash(r); ctx.refresh(); if (r.ok) { w.close(); } };
    m.querySelectorAll('[data-tvneg]').forEach((b) => b.onclick = () => ctx.negotiate(t.squad.find((p) => p.id === +b.dataset.tvneg)));
    m.querySelectorAll('[data-tvloan]').forEach((b) => b.onclick = () => doAct((x) => ctx.game().loan_in(x), +b.dataset.tvloan));
  };
  draw();
}

// ---------------------------------------------------------------- cartão do jogador
export function openPlayer(id) {
  const p = JSON.parse(ctx.game().player(id));
  if (!p) return;
  const w = openWindow({ key: 'player-' + id, id: 'player-' + id, title: `Jogador — ${p.name}`, width: 380, className: 'wm-player playercard' });
  const m = w.body;
  const bar = (l, v) => `<tr><td>${l}</td><td class="n">${v}</td><td><div class="meter small-meter"><div style="width:${v}%"></div></div></td></tr>`;
  const act = !p.mine && !p.academy && !p.loanFrom && ctx.canAct();
  m.innerHTML = `<div class="pc-head"><span class="pc-pos pos-${p.pos}">${p.pos}</span><div><b>${esc(p.name)}</b>${flags(p)}<br>${p.age} anos · ${p.team !== null ? teamLink(p.team, p.teamName) : 'Sem clube'}${p.academy ? ' (base)' : ''}</div><div class="pc-skill">${p.skill}</div></div>
    <table>${bar('Finalização', p.attrs.finishing)}${bar('Passe', p.attrs.passing)}${bar('Marcação', p.attrs.tackling)}${bar('Goleiro', p.attrs.keeping)}${bar('Resistência', p.attrs.stamina)}</table>
    <table class="kv"><tr><td>Físico / moral</td><td>${cond(p.condition)} · ${moraleIcon(p.morale)}</td></tr>
      <tr><td>Gols na temporada</td><td>${p.goals}</td></tr>
      <tr><td>Contrato</td><td>${p.loanFrom ? 'emprestado pelo ' + esc(p.loanFrom) : p.contractUntil ? 'até a temporada ' + p.contractUntil : '—'} · ${money(p.salary)}/rod.</td></tr>
      <tr><td>Valor de mercado</td><td>${money(p.value)}${act ? ` · preço ${money(p.buyPrice)}` : ''}</td></tr></table>
    ${act ? `${p.team === null ? `<button id="pcBuy">Contratar (${money(p.buyPrice)})</button>` : buyBtn(p, 'id="pcNeg" data-x')} ${p.team !== null ? `<button id="pcLoan">Empréstimo (${money(p.loanFee)})</button>` : ''}` : ''}`;
  const doAct = (r) => { r = JSON.parse(r); ctx.flash(r); ctx.refresh(); if (r.ok) { w.close(); closeTeam(); } };
  const b = m.querySelector('#pcBuy'); if (b) b.onclick = () => { if (confirm('Contratar este jogador livre?')) doAct(ctx.game().buy(id)); };
  const n = m.querySelector('#pcNeg'); if (n) n.onclick = () => ctx.negotiate(p);
  const l = m.querySelector('#pcLoan'); if (l) l.onclick = () => doAct(ctx.game().loan_in(id));
}

// ---------------------------------------------------------------- aba Times
let tDiv = null;
export function renderTeamsTab(st, el) {
  if (tDiv === null) tDiv = st.managed ? st.managed.division : 0;
  const rows = st.tables[tDiv];
  el.innerHTML = `Divisão: <select id="teamsDiv">${[0, 1, 2, 3].map((d) => `<option value="${d}" ${d === tDiv ? 'selected' : ''}>Divisão ${d + 1}</option>`).join('')}</select>
    <span class="small">Clique em um clube para abrir a ficha.</span>
    <div class="team-grid">${rows.map((r, i) => { const t = st.teams.find((x) => x.id === r.id);
      return `<button class="team-card ${st.managed && r.id === st.managed.id ? 'me' : ''}" data-team="${r.id}"><b>${i + 1}º ${esc(r.name)}</b><br>${r.pts} pts · ${r.w}V ${r.d}E ${r.l}D<br>${formHtml(r.form)}<br><small>Caixa ${money(t.budget)}</small></button>`; }).join('')}</div>`;
  el.querySelector('#teamsDiv').onchange = (e) => { tDiv = +e.target.value; renderTeamsTab(st, el); };
}

// ---------------------------------------------------------------- pré-jogo e em campo
function xiTable(t, title) {
  const lu = [...t.lineup].sort((a, b) => ORDER[a.role] - ORDER[b.role] || b.skill - a.skill);
  return `<fieldset class="xi-box"><legend>${title}</legend>
    <div class="xi-sum">${teamLink(t.id, t.name)} — ${t.position}º · ${esc(t.formation)} · ${esc(t.tactic)}${t.pressing ? ' + pressão' : ''}<br>
    Ataque <b>${t.attack.toFixed(1)}</b> · Defesa <b>${t.defense.toFixed(1)}</b> · Forma ${formHtml(t.form)}</div>
    <table><tr><th>Pos</th><th>Nome</th><th>Hab.</th><th>Físico</th><th>Moral</th></tr>
    ${lu.map((p) => `<tr><td class="pos-${p.role}" title="${p.role !== p.pos ? 'Improvisado (posição de origem: ' + p.pos + ')' : ''}">${p.role}${p.role !== p.pos ? '*' : ''}</td><td>${playerLink(p.id, p.name)}<small>${flags(p)}</small></td><td class="n">${p.skill}</td><td class="n">${cond(p.condition)}</td><td class="n">${moraleIcon(p.morale)}</td></tr>`).join('')}</table>
    ${t.unavailable.length ? `<div class="small">Desfalques: ${t.unavailable.map((p) => playerLink(p.id, p.name) + flags(p)).join(', ')}</div>` : '<div class="small">Sem desfalques.</div>'}</fieldset>`;
}
export function previewHtml(game, myId, oppId) {
  const me = JSON.parse(game.team(myId));
  const opp = oppId === null || oppId === undefined ? null : JSON.parse(game.team(oppId));
  return `<div class="preview cols2">${xiTable(me, 'Seu time')}${opp ? xiTable(opp, '🔎 Próximo adversário — escalação provável') : '<fieldset class="xi-box"><legend>Adversário</legend>Sem jogo nesta rodada.</fieldset>'}</div>`;
}
export function onFieldHtml(mm) {
  if (!mm) return '';
  const side = (s) => {
    const booked = new Set(mm.booked), red = new Set(mm.sentOff), hurt = new Set(mm.hurt);
    const ps = [...mm.on[s]].sort((a, b) => ORDER[a.pos] - ORDER[b.pos]);
    const tid = s === 0 ? mm.home : mm.away;
    const outs = mm.outPlayers.filter((p) => p.team === tid);
    return `<fieldset class="xi-box onfield"><legend>${teamLink(tid, s === 0 ? mm.homeName : mm.awayName)} — ${esc(mm.formations[s])}, ${esc(mm.tactics[s])} · subs ${mm.subs[s]}/3</legend>
      <table><tr><th>Pos</th><th>Em campo</th><th>Hab.</th><th>Energia</th></tr>${ps.map((p) => { const e = mm.energy[p.id] ?? 100;
        return `<tr><td class="pos-${p.pos}">${p.pos}</td><td>${playerLink(p.id, p.name)}${booked.has(p.id) ? ' 🟨' : ''}${hurt.has(p.id) ? ' 🚑' : ''}</td><td class="n">${p.skill}</td><td><div class="meter small-meter"><div class="${e < 60 ? 'low' : e < 80 ? 'mid' : ''}" style="width:${Math.round(e)}%"></div></div> <small>${Math.round(e)}%</small></td></tr>`; }).join('')}</table>
      ${outs.length ? `<div class="small">Saíram: ${outs.map((p) => esc(p.name) + (red.has(p.id) ? ' 🟥' : hurt.has(p.id) ? ' 🚑' : ' 🔁')).join(', ')}</div>` : ''}
      ${mm.on[s].length < 11 ? `<div class="small down">Com ${mm.on[s].length} em campo</div>` : ''}</fieldset>`;
  };
  return `<div class="cols2">${side(0)}${side(1)}</div>`;
}
