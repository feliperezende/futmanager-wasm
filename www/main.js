import init, { FutManager } from '../pkg/futmanager.js';

const SAVE_KEY = 'futmanager98_save';
const $ = (s) => document.querySelector(s);
const money = (v) => 'R$ ' + Math.round(v).toLocaleString('pt-BR');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let game = null, st = null, tab = 'clube', selected = [], playing = false;

function flash(r) { $('#msg').textContent = r.msg || r; $('#msg').style.color = r.ok === false ? '#a00' : '#000080'; }
function refresh() { st = JSON.parse(game.state()); render(); }

// ------------------------------------------------ Início
function showStart() { $('#start').classList.remove('hidden'); $('#main').classList.add('hidden'); $('#pickTeam').classList.add('hidden'); }
$('#btnNew').onclick = () => {
  game = new FutManager(Math.floor(Math.random() * 1e9));
  st = JSON.parse(game.state());
  const sel = $('#pickDiv');
  sel.innerHTML = [0, 1, 2, 3].map((d) => `<option value="${d}">Divisão ${d + 1}</option>`).join('');
  sel.value = 3;
  sel.onchange = listTeams; listTeams();
  $('#pickTeam').classList.remove('hidden');
};
function listTeams() {
  const d = +$('#pickDiv').value;
  $('#teamList').innerHTML = '<table><tr><th>Clube</th><th>Orçamento</th><th></th></tr>' + st.teams.filter((t) => t.division === d)
    .map((t) => `<tr><td>${esc(t.name)}</td><td>${money(t.budget)}</td><td><button data-team="${t.id}">Assumir</button></td></tr>`).join('') + '</table>';
  $('#teamList').querySelectorAll('button').forEach((b) => b.onclick = () => { flash(JSON.parse(game.choose_team(+b.dataset.team))); enterGame(); });
}
$('#btnLoad').onclick = () => {
  const s = localStorage.getItem(SAVE_KEY);
  if (!s) return alert('Nenhum jogo salvo encontrado.');
  try { game = FutManager.load(s); flash({ ok: true, msg: 'Jogo carregado.' }); enterGame(); } catch (e) { alert(e); }
};
function enterGame() { $('#start').classList.add('hidden'); $('#main').classList.remove('hidden'); tab = 'clube'; refresh(); }
$('#btnSave').onclick = () => { localStorage.setItem(SAVE_KEY, game.save()); flash({ ok: true, msg: 'Jogo salvo no navegador.' }); };
$('#btnQuit').onclick = () => { if (confirm('Voltar ao menu? Progresso não salvo será perdido.')) showStart(); };
document.querySelectorAll('.menubar [data-tab]').forEach((b) => b.onclick = () => { if (!playing) { tab = b.dataset.tab; render(); } });

// ------------------------------------------------ Render
function render() {
  const m = st.managed;
  $('#status').textContent = `${m.name} | Div ${m.division + 1} | Temporada ${st.season} | Rodada ${Math.min(st.round + 1, st.rounds)}/${st.rounds} | ${money(m.budget)}`;
  document.querySelectorAll('.tab').forEach((s) => s.classList.add('hidden'));
  document.querySelectorAll('.menubar [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#tab-' + tab).classList.remove('hidden');
  ({ clube: renderClub, jogos: renderRound, tabela: renderTable, mercado: renderMarket, base: renderAcademy, financas: renderFinance })[tab]();
}

function moraleIcon(v) { return (v >= 70 ? '😃' : v >= 45 ? '🙂' : v >= 25 ? '😐' : '😠') + ' ' + v; }
function status(p) {
  return (p.injured ? `🚑${p.injured} ` : '') + (p.suspended ? `🟥${p.suspended} ` : '') + (p.yellows ? `🟨${p.yellows}` : '');
}
function playerRow(p, extra) {
  return `<td class="pos-${p.pos}">${p.pos}</td><td>${esc(p.name)} <small>${status(p)}</small></td><td>${p.skill}</td><td>${p.age}</td><td>${money(p.salary)}</td><td>${money(p.value)}</td>${extra}`;
}

function renderClub() {
  const m = st.managed;
  selected = [...m.lineup];
  const order = { G: 0, D: 1, M: 2, A: 3 };
  const squad = [...m.squad].sort((a, b) => order[a.pos] - order[b.pos] || b.skill - a.skill);
  $('#tab-clube').innerHTML = `
    <fieldset><legend>Escalação</legend>
      Formação: <select id="formation">${st.formations.map((f) => `<option ${f === m.formation ? 'selected' : ''}>${f}</option>`).join('')}</select>
      <button id="btnAuto">Escalação automática</button> <button id="btnSaveLineup">Confirmar escalação</button>
      <span id="lineupInfo"></span> &nbsp; Moral do elenco: ${moraleIcon(m.morale)}
    </fieldset>
    <div class="list"><table><tr><th>Tit.</th><th>Pos</th><th>Nome</th><th>Hab.</th><th>Idade</th><th>Salário/rod.</th><th>Valor</th><th>Gols</th><th>Moral</th><th></th></tr>
    ${squad.map((p) => `<tr><td><input type="checkbox" data-id="${p.id}" ${selected.includes(p.id) ? 'checked' : ''}></td>${playerRow(p, `<td>${p.goals}</td><td>${moraleIcon(p.morale)}</td><td>${p.loanFrom ? `<small>Emprestado pelo ${esc(p.loanFrom)}</small>` : `<button data-sell="${p.id}">Vender (${money(p.sellPrice)})</button> <button data-loanout="${p.id}">Emprestar</button>`}</td>`)}</tr>`).join('')}
    </table></div>`;
  const info = () => {
    const ps = m.squad.filter((p) => selected.includes(p.id));
    const c = (x) => ps.filter((p) => p.pos === x).length;
    $('#lineupInfo').textContent = ` ${selected.length}/11 selecionados — G:${c('G')} D:${c('D')} M:${c('M')} A:${c('A')}`;
  };
  info();
  document.querySelectorAll('#tab-clube input[type=checkbox]').forEach((cb) => cb.onchange = () => {
    const id = +cb.dataset.id;
    if (cb.checked) selected.push(id); else selected = selected.filter((x) => x !== id);
    info();
  });
  $('#btnAuto').onclick = () => { flash(JSON.parse(game.auto_lineup($('#formation').value))); refresh(); };
  $('#btnSaveLineup').onclick = () => { const r = JSON.parse(game.set_lineup($('#formation').value, JSON.stringify(selected))); flash(r); if (r.ok) refresh(); };
  document.querySelectorAll('[data-loanout]').forEach((b) => b.onclick = () => {
    if (confirm('Emprestar este jogador até o fim da temporada?')) { flash(JSON.parse(game.loan_out(+b.dataset.loanout))); refresh(); }
  });
  document.querySelectorAll('[data-sell]').forEach((b) => b.onclick = () => {
    if (!confirm('Vender este jogador?')) return;
    flash(JSON.parse(game.sell(+b.dataset.sell))); refresh();
  });
}

function renderRound() {
  const m = st.managed;
  const mine = st.next.filter((x) => x.division === m.division);
  const myGame = mine.find((x) => x.home === m.id || x.away === m.id);
  $('#tab-jogos').innerHTML = `
    <div>${st.news.map((n) => `<div>📰 ${esc(n)}</div>`).join('')}</div>
    <p class="big">Próximo jogo: ${myGame ? `${esc(myGame.homeName)} x ${esc(myGame.awayName)}` : '—'}</p>
    <button id="btnPlay">▶ Jogar rodada</button> <button id="btnPause" class="hidden">⏸ Pausar</button> <button id="btnSkip" class="hidden">⏩ Pular para o fim</button>
    <div class="clock" id="clock">00'</div>
    <div class="cols"><div><table id="scoreboard"><tr><th>Mandante</th><th></th><th>Visitante</th></tr>
      ${mine.map((x) => `<tr class="${x === myGame ? 'me' : ''}"><td>${esc(x.homeName)}</td><td id="sc-${x.home}">- x -</td><td>${esc(x.awayName)}</td></tr>`).join('')}
    </table><div id="subs"></div></div><div><div class="ticker" id="ticker">Aguardando o apito inicial...</div></div></div>`;
  $('#btnPlay').onclick = () => { game.start_round(); runLive(); };
  if (st.liveActive) runLive();
}

let liveTimer = null, paused = false;
function showLive(live) {
  const myId = st.managed.id;
  const myMatch = live.find((r) => r.home === myId || r.away === myId);
  const minute = live.length ? live[0].minute : 0;
  $('#clock').textContent = String(minute).padStart(2, '0') + "'";
  for (const r of live) { const c = document.getElementById('sc-' + r.home); if (c) c.textContent = `${r.hg} x ${r.ag}`; }
  const lines = [];
  for (const r of live) for (const e of r.events) if (r === myMatch || e.kind === 'gol') lines.push({ e, r });
  lines.sort((a, b) => b.e.minute - a.e.minute);
  $('#ticker').innerHTML = lines.map(({ e, r }) => `<div class="${e.kind}">${String(e.minute).padStart(2, '0')}' ${r === myMatch ? '' : '[' + esc(r.homeName) + ' x ' + esc(r.awayName) + '] '}${esc(e.text)}</div>`).join('');
  if (typeof renderSubs === 'function') renderSubs(myMatch);
  return minute;
}
function runLive() {
  playing = true; paused = false;
  $('#btnPlay').disabled = true; $('#btnSkip').classList.remove('hidden'); $('#btnPause').classList.remove('hidden');
  $('#btnPause').textContent = '⏸ Pausar';
  $('#btnPause').onclick = () => { paused = !paused; $('#btnPause').textContent = paused ? '▶ Continuar' : '⏸ Pausar'; };
  $('#btnSkip').onclick = () => { showLive(JSON.parse(game.step(90))); finishLive(); };
  showLive(JSON.parse(game.live()));
  clearInterval(liveTimer);
  liveTimer = setInterval(() => {
    if (paused) return;
    if (showLive(JSON.parse(game.step(1))) >= 90) finishLive();
  }, 100);
}
function finishLive() {
  clearInterval(liveTimer);
  const results = JSON.parse(game.finish_round());
  playing = false;
  const myMatch = results.find((r) => r.home === st.managed.id || r.away === st.managed.id);
  const att = myMatch ? `Público: ${myMatch.attendance.toLocaleString('pt-BR')}` : '';
  st = JSON.parse(game.state());
  $('#ticker').insertAdjacentHTML('afterbegin', `<div class="gol">FIM DE JOGO! ${att}</div>${st.news.map((n) => `<div>📰 ${esc(n)}</div>`).join('')}`);
  $('#btnSkip').classList.add('hidden'); $('#btnPause').classList.add('hidden');
  if (document.getElementById('subs')) $('#subs').innerHTML = '';
  $('#btnPlay').disabled = false; $('#btnPlay').textContent = '▶ Próxima rodada';
  $('#btnPlay').onclick = () => { render(); };
  setStatus();
}
function setStatus() {
  const m = st.managed;
  $('#status').textContent = `${m.name} | Div ${m.division + 1} | Temporada ${st.season} | Rodada ${Math.min(st.round + 1, st.rounds)}/${st.rounds} | ${money(m.budget)}`;
}

let subsKey = '';
function renderSubs(mm) {
  const box = document.getElementById('subs');
  if (!box) return;
  if (!mm || mm.minute >= 90) { box.innerHTML = ''; subsKey = ''; return; }
  const side = mm.home === st.managed.id ? 0 : 1;
  const on = mm.on[side], bench = mm.bench[side];
  const key = on.map((p) => p.id).join(',') + '|' + bench.map((p) => p.id).join(',') + '|' + mm.subs[side];
  if (key === subsKey) return;
  subsKey = key;
  const opt = (p) => `<option value="${p.id}">${p.pos} ${esc(p.name)} (${p.skill})</option>`;
  box.innerHTML = `<fieldset><legend>Substituições (${mm.subs[side]}/3)</legend>
    Sai: <select id="subOut">${on.map(opt).join('')}</select>
    Entra: <select id="subIn">${bench.map(opt).join('')}</select>
    <button id="btnSub" ${mm.subs[side] >= 3 ? 'disabled' : ''}>Substituir</button></fieldset>`;
  $('#btnSub').onclick = () => {
    const r = JSON.parse(game.substitute(+$('#subOut').value, +$('#subIn').value));
    flash(r); showLive(JSON.parse(game.live()));
  };
}

let tableDiv = null;
function renderTable() {
  if (tableDiv === null) tableDiv = st.managed.division;
  const t = st.tables[tableDiv];
  $('#tab-tabela').innerHTML = `Divisão: <select id="tdiv">${[0, 1, 2, 3].map((d) => `<option value="${d}" ${d === tableDiv ? 'selected' : ''}>Divisão ${d + 1}</option>`).join('')}</select>
    <div class="cols"><div><table><tr><th>#</th><th>Clube</th><th>J</th><th>V</th><th>E</th><th>D</th><th>GP</th><th>GC</th><th>SG</th><th>Pts</th></tr>
    ${t.map((r, i) => `<tr class="${r.id === st.managed.id ? 'me' : ''} ${i < 2 && tableDiv > 0 ? 'up' : ''} ${i >= t.length - 2 && tableDiv < 3 ? 'down' : ''}"><td>${i + 1}</td><td>${esc(r.name)}</td><td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${r.gf}</td><td>${r.ga}</td><td>${r.gf - r.ga}</td><td><b>${r.pts}</b></td></tr>`).join('')}
    </table><small>Verde: zona de acesso • Vermelho: zona de rebaixamento</small></div>
    <div><table><tr><th colspan="3">Artilharia geral</th></tr>${st.scorers.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.teamName)}</td><td>${p.goals}</td></tr>`).join('')}</table></div></div>`;
  $('#tdiv').onchange = (e) => { tableDiv = +e.target.value; renderTable(); };
}

let mkPos = '', mkMax = '';
function renderMarket() {
  const max = mkMax === '' ? st.managed.budget : +mkMax;
  const list = JSON.parse(game.market(mkPos, max));
  $('#tab-mercado').innerHTML = `
    Posição: <select id="mpos">${['', 'G', 'D', 'M', 'A'].map((p) => `<option value="${p}" ${p === mkPos ? 'selected' : ''}>${p || 'Todas'}</option>`).join('')}</select>
    Preço máximo: <input id="mmax" type="number" value="${max}" step="100000"> <button id="mgo">Filtrar</button>
    <span>Orçamento: <b>${money(st.managed.budget)}</b> — Elenco: ${st.managed.squad.length}/28</span>
    <div class="list"><table><tr><th>Pos</th><th>Nome</th><th>Hab.</th><th>Idade</th><th>Salário/rod.</th><th>Valor</th><th>Clube</th><th>Preço</th><th></th></tr>
    ${list.map((p) => `<tr>${playerRow(p, `<td>${esc(p.teamName)}</td><td>${money(p.buyPrice)}</td><td><button data-buy="${p.id}">Comprar</button>${p.team !== null ? ` <button data-loanin="${p.id}">Empréstimo (${money(p.loanFee)})</button>` : ''}</td>`)}</tr>`).join('')}
    </table></div><small>Jogadores sem clube custam 20% do valor (luvas); de outros clubes, 110% do valor. Empréstimo: 10% do valor até o fim da temporada (você paga o salário).</small>`;
  $('#mgo').onclick = () => { mkPos = $('#mpos').value; mkMax = $('#mmax').value; renderMarket(); };
  document.querySelectorAll('[data-loanin]').forEach((b) => b.onclick = () => { flash(JSON.parse(game.loan_in(+b.dataset.loanin))); refresh(); });
  document.querySelectorAll('[data-buy]').forEach((b) => b.onclick = () => { flash(JSON.parse(game.buy(+b.dataset.buy))); refresh(); });
}

function renderAcademy() {
  const m = st.managed;
  $('#tab-base').innerHTML = `<fieldset><legend>Categorias de base — nível ${m.academyLevel}/5</legend>
    Custo de manutenção: ${money(m.academyUpkeep)} por rodada.
    ${m.academyLevel < 5 ? `<button id="btnAcad">Melhorar base (${money(m.academyUpgradeCost)})</button>` : '(nível máximo)'}
    <br><small>Novos jovens surgem a cada fim de temporada; quanto maior o nível, mais e melhores talentos. Jovens deixam a base aos 20 anos.</small></fieldset>
    <table><tr><th>Pos</th><th>Nome</th><th>Hab.</th><th>Idade</th><th></th></tr>
    ${m.academy.map((p) => `<tr><td class="pos-${p.pos}">${p.pos}</td><td>${esc(p.name)}</td><td>${p.skill}</td><td>${p.age}</td>
      <td><button data-promote="${p.id}">Promover ao profissional</button> <button data-release="${p.id}">Dispensar</button></td></tr>`).join('') || '<tr><td colspan="5">Nenhum jogador na base.</td></tr>'}
    </table>`;
  if ($('#btnAcad')) $('#btnAcad').onclick = () => { flash(JSON.parse(game.upgrade_academy())); refresh(); };
  document.querySelectorAll('[data-promote]').forEach((b) => b.onclick = () => { flash(JSON.parse(game.promote_youth(+b.dataset.promote))); refresh(); });
  document.querySelectorAll('[data-release]').forEach((b) => b.onclick = () => { if (confirm('Dispensar este jovem?')) { flash(JSON.parse(game.release_youth(+b.dataset.release))); refresh(); } });
}

function renderFinance() {
  const m = st.managed, f = m.finance;
  const bal = f.tickets + f.transfers_in + f.prizes - f.salaries - f.transfers_out - f.upkeep - f.investments + f.bank_in - f.bank_paid + f.loan_fees;
  $('#tab-financas').innerHTML = `<div class="cols"><div><table>
    <tr><th colspan="2">Temporada ${st.season}</th></tr>
    <tr><td>Bilheteria</td><td>${money(f.tickets)}</td></tr>
    <tr><td>Vendas de jogadores</td><td>${money(f.transfers_in)}</td></tr>
    <tr><td>Premiações</td><td>${money(f.prizes)}</td></tr>
    <tr><td>Salários pagos</td><td>-${money(f.salaries)}</td></tr>
    <tr><td>Compras de jogadores</td><td>-${money(f.transfers_out)}</td></tr>
    <tr><td>Manutenção (base/estádio)</td><td>-${money(f.upkeep)}</td></tr>
    <tr><td>Investimentos</td><td>-${money(f.investments)}</td></tr>
    <tr><td>Empréstimos bancários recebidos</td><td>${money(f.bank_in)}</td></tr>
    <tr><td>Parcelas pagas ao banco</td><td>-${money(f.bank_paid)}</td></tr>
    <tr><td>Taxas de empréstimo de jogadores (saldo)</td><td>${money(f.loan_fees)}</td></tr>
    <tr><td><b>Saldo da temporada</b></td><td><b>${money(bal)}</b></td></tr>
    <tr><td><b>Caixa atual</b></td><td><b>${money(m.budget)}</b></td></tr>
  </table></div><div><fieldset><legend>Estádio</legend>
    Capacidade: ${m.capacity.toLocaleString('pt-BR')} lugares<br>Folha salarial por rodada: ${money(m.wageBill)}<br><br>
    Preço do ingresso: <input id="tprice" type="number" min="1" max="500" value="${m.ticketPrice}"> <button id="tsave">Alterar</button><br>
    Público esperado no próximo jogo em casa: ~${m.expectedAttendance.toLocaleString('pt-BR')}<br>
    Manutenção do estádio: ${money(m.stadiumUpkeep)} por rodada
  </fieldset><fieldset><legend>Banco</legend>
    Dívida: <b>${money(m.bankDebt)}</b> — parcela: ${money(m.bankPayment)}/rodada — limite: ${money(m.bankLimit)}<br>
    Valor: <input id="bankAmt" type="number" step="100000" value="1000000"> <button id="bankTake">Pegar empréstimo (+12% juros)</button> <button id="bankPay">Amortizar</button>
    ${m.loanedOut.length ? `<br>Emprestados a outros clubes: ${m.loanedOut.map((p) => esc(p.name) + ' (' + esc(p.teamName) + ')').join(', ')}` : ''}
  </fieldset><fieldset><legend>Ampliação do estádio</legend>
    ${m.construction ? `🏗️ Obra em andamento: +${m.construction.seats.toLocaleString('pt-BR')} lugares, faltam ${m.construction.rounds_left} rodada(s).`
      : m.stadiumOptions.map((o, i) => `<button data-stad="${i}">+${o.seats.toLocaleString('pt-BR')} lugares — ${money(o.cost)} (${o.rounds} rodadas)</button>`).join('<br>')}
    <br><small>Ampliar só aumenta o público se a procura for maior que a capacidade. Ingressos caros reduzem a procura.</small>
  </fieldset></div></div>`;
  $('#bankTake').onclick = () => { flash(JSON.parse(game.take_bank_loan(+$('#bankAmt').value))); refresh(); };
  $('#bankPay').onclick = () => { flash(JSON.parse(game.repay_bank_loan(+$('#bankAmt').value))); refresh(); };
  document.querySelectorAll('[data-stad]').forEach((b) => b.onclick = () => { if (confirm('Iniciar a obra?')) { flash(JSON.parse(game.upgrade_stadium(+b.dataset.stad))); refresh(); } });
  $('#tsave').onclick = () => { flash(JSON.parse(game.set_ticket_price(+$('#tprice').value))); refresh(); };
}

await init();
showStart();
if (!localStorage.getItem(SAVE_KEY)) $('#btnLoad').disabled = true;

// Autoteste opcional: abra index.html?selftest para validar o motor no navegador.
if (location.search.includes('selftest')) {
  const out = [];
  try {
    $('#btnNew').click();
    document.querySelector('#teamList button').click();
    out.push('time=' + st.managed.name);
    game.start_round();
    const lv = JSON.parse(game.step(45));
    if (lv[0].minute !== 45) throw 'step falhou';
    const mm = lv.find((x) => x.home === st.managed.id || x.away === st.managed.id);
    const sd = mm.home === st.managed.id ? 0 : 1;
    const sr = JSON.parse(game.substitute(mm.on[sd][1].id, mm.bench[sd][0].id));
    if (!sr.ok) throw 'substituição falhou: ' + sr.msg;
    out.push('sub=ok');
    const r = JSON.parse(game.finish_round());
    out.push('jogos=' + r.length);
    const mk = JSON.parse(game.market('', 1e12));
    out.push('mercado=' + mk.length);
    const ac = JSON.parse(game.state()).managed.academy;
    if (!JSON.parse(game.promote_youth(ac[0].id)).ok) throw 'promoção falhou';
    out.push('base=ok');
    const fin = JSON.parse(game.state()).managed;
    if (fin.expectedAttendance <= 0 || fin.stadiumOptions.length !== 3) throw 'estádio';
    out.push('estadio=ok');
    if (!JSON.parse(game.take_bank_loan(100000)).ok) throw 'banco';
    const cand = JSON.parse(game.market('', 1e12)).filter((p) => p.team !== null).sort((a, b) => a.loanFee - b.loanFee)[0];
    const lr = JSON.parse(game.loan_in(cand.id));
    if (!lr.ok) throw 'empréstimo: ' + lr.msg;
    out.push('emprestimos=ok');
    localStorage.setItem(SAVE_KEY, game.save());
    game = FutManager.load(localStorage.getItem(SAVE_KEY));
    out.push('rodada_apos_load=' + JSON.parse(game.state()).round);
    for (let i = 0; i < 29; i++) game.play_round();
    out.push('temporada=' + JSON.parse(game.state()).season);
    out.push('SELFTEST_OK');
  } catch (e) { out.push('SELFTEST_FAIL ' + e); }
  document.body.insertAdjacentHTML('beforeend', `<pre id="selftest">${out.join(' | ')}</pre>`);
}
