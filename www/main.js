import init, { FutManager } from '../pkg/futmanager.js';
import { openFinale, finaleOpen, renderLiveTable, renderHistory, isFinalStretch, chime } from './finale.js';
import { initTeams, teamLink, playerLink, renderTeamsTab, previewHtml, onFieldHtml, openTeam, openPlayer, closeTeam, closePlayer, formHtml } from './teams.js';

const SAVE_KEY = 'futmanager98_save'; // formato antigo (slot único)
const SLOTS = 5;
const slotKey = (n) => `futmanager98_slot_${n}`;
const metaKey = (n) => `futmanager98_meta_${n}`;
const $ = (s) => document.querySelector(s);
const money = (v) => { const n = Math.round(v); return (n < 0 ? '−' : '') + 'R$ ' + Math.abs(n).toLocaleString('pt-BR'); };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let game = null, st = null, tab = 'clube', selected = [], playing = false;

// Barra de status (segmentos estilo Windows 98)
function setBar(text) {
  $('#status').innerHTML = text.split(' | ').map((t) => `<span class="seg">${esc(t)}</span>`).join('');
  const cash = [...$('#status').children].find((c) => c.textContent.startsWith('Caixa'));
  if (cash && cash.textContent.includes('−')) cash.classList.add('neg');
}

// Pós-processamento das tabelas: alinha números à direita e adiciona dicas nos cabeçalhos
const TIPS = { 'Tit.': 'Titular — marque exatamente 11 jogadores', Pos: 'Posição: G goleiro, D defensor, M meio-campista, A atacante',
  'Hab.': 'Habilidade geral (0–99)', 'Físico': 'Condição física atual (cansaço)', Moral: 'Moral: afeta o rendimento em até ±10%',
  Contrato: 'Última temporada do contrato (vermelho = termina nesta temporada)', Gols: 'Gols na temporada', J: 'Jogos', V: 'Vitórias',
  E: 'Empates', D: 'Derrotas', GP: 'Gols pró', GC: 'Gols contra', SG: 'Saldo de gols', Pts: 'Pontos', '#': 'Posição na tabela',
  'Público': 'Pagantes no estádio', Renda: 'Bilheteria do mandante', 'Salário/rod.': 'Salário pago a cada rodada', Valor: 'Valor de mercado estimado',
  'Preço': 'Quanto custa contratar agora', Idade: 'Idade em anos' };
const NUM = /^\s*[−-]?(R\$\s?)?[−-]?\d[\d.,]*\s*(%|M|k)?(\s*\(.*\))?\s*$/;
function polishTables(root) {
  root.querySelectorAll('table').forEach((t) => {
    const rows = [...t.rows];
    if (!rows.length) return;
    const head = rows[0];
    const numericCol = {};
    rows.slice(1).forEach((r) => [...r.cells].forEach((c, i) => {
      const txt = c.textContent.trim();
      if (!txt || txt === '—' || c.querySelector('button,input,select')) return;
      const isNum = NUM.test(txt) || /^até T\d+$/.test(txt);
      numericCol[i] = numericCol[i] || { n: 0, t: 0 };
      numericCol[i].t++; if (isNum) numericCol[i].n++;
      if (NUM.test(txt)) c.classList.add('n');
    }));
    [...head.cells].forEach((h, i) => {
      if (h.tagName === 'TH' && numericCol[i] && numericCol[i].n / numericCol[i].t > 0.6) h.classList.add('n');
      const tip = TIPS[h.textContent.trim()];
      if (tip && !h.title) h.title = tip;
    });
  });
}
let polishQueued = false;
new MutationObserver(() => {
  if (polishQueued) return;
  polishQueued = true;
  requestAnimationFrame(() => { polishQueued = false; polishTables(document.getElementById('app')); });
}).observe(document.getElementById('app'), { childList: true, subtree: true });

function flash(r) { $('#msg').textContent = r.msg || r; $('#msg').style.color = r.ok === false ? '#a00' : '#000080'; }
function refresh() { st = JSON.parse(game.state()); render(); }

// ------------------------------------------------ Início
function showStart() { $('#status').innerHTML = ''; anySave().then((v) => { $('#btnLoad').disabled = !v; }); $('#start').classList.remove('hidden'); $('#main').classList.add('hidden'); $('#pickTeam').classList.add('hidden'); }
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
$('#btnLoad').onclick = () => showSlots('load');

// ------------------------------------------------ Armazenamento: IndexedDB (preferido) com fallback para localStorage
// Saves compactados com gzip. Slots 1..5 + autosave. Em falta de espaço, o autosave é descartado e o usuário é avisado.
class StorageFullError extends Error {}
const isQuota = (e) => e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e instanceof StorageFullError);

function idbStore() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('sem IndexedDB'));
    const req = indexedDB.open('futmanager98', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = (mode, fn) => new Promise((res, rej) => {
        const t = db.transaction('kv', mode);
        const r = fn(t.objectStore('kv'));
        t.oncomplete = () => res(r && r.result);
        t.onerror = t.onabort = () => rej(t.error || new Error('erro no IndexedDB'));
      });
      resolve({
        kind: 'IndexedDB',
        get: (k) => tx('readonly', (s) => s.get(k)).then((v) => v ?? null),
        set: (k, v) => tx('readwrite', (s) => s.put(v, k)),
        del: (k) => tx('readwrite', (s) => s.delete(k)),
      });
    };
  });
}
const lsStore = {
  kind: 'localStorage',
  get: async (k) => localStorage.getItem('futmanager98_' + k),
  set: async (k, v) => localStorage.setItem('futmanager98_' + k, v),
  del: async (k) => localStorage.removeItem('futmanager98_' + k),
};
let store = lsStore;

async function initStorage() {
  try {
    // se o IndexedDB não responder (modo privado/bloqueado), usa localStorage
    store = await Promise.race([idbStore(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))]);
  } catch (e) { store = lsStore; }
  if (store !== lsStore) {
    // migra saves antigos do localStorage para o IndexedDB
    const legacy = localStorage.getItem(SAVE_KEY);
    if (legacy && !(await store.get('slot_1'))) { await store.set('slot_1', legacy); await store.set('meta_1', JSON.stringify({ team: '(save antigo)', season: '?', round: '?' })); }
    localStorage.removeItem(SAVE_KEY);
    for (let n = 1; n <= SLOTS; n++) {
      const d = localStorage.getItem(slotKey(n));
      if (d) {
        if (!(await store.get('slot_' + n))) { await store.set('slot_' + n, d); await store.set('meta_' + n, localStorage.getItem(metaKey(n)) || '{}'); }
        localStorage.removeItem(slotKey(n)); localStorage.removeItem(metaKey(n));
      }
    }
  }
}

/** Grava; se faltar espaço, descarta o autosave e tenta de novo. */
async function putWithPrune(key, data, meta) {
  const write = async () => { await store.set(key, data); await store.set(key.replace('slot_', 'meta_').replace('autosave', 'autosave_meta'), JSON.stringify(meta)); };
  try { await write(); return; } catch (e) { if (!isQuota(e)) throw e; }
  if (key !== 'autosave') { await store.del('autosave'); await store.del('autosave_meta'); }
  try { await write(); } catch (e) {
    if (isQuota(e)) throw new StorageFullError('Sem espaço para salvar no navegador. Apague um slot antigo e tente de novo.');
    throw e;
  }
}

async function pack(str) {
  if (typeof CompressionStream === 'undefined') return str;
  const buf = await new Response(new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return 'gz:' + btoa(bin);
}
async function unpack(data) {
  if (!data.startsWith('gz:')) return data;
  const bin = atob(data.slice(3));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}
const keyOf = (n) => (n === 'auto' ? 'autosave' : 'slot_' + n);
const metaOf = (n) => (n === 'auto' ? 'autosave_meta' : 'meta_' + n);
async function slotMeta(n) { try { return JSON.parse(await store.get(metaOf(n))); } catch (e) { return null; } }
async function anySave() {
  for (const n of ['auto', 1, 2, 3, 4, 5]) if (await store.get(keyOf(n))) return true;
  return false;
}
async function saveSlot(n, quiet) {
  const data = await pack(game.save());
  const meta = { ...JSON.parse(game.summary()), date: new Date().toLocaleString('pt-BR') };
  try { await putWithPrune(keyOf(n), data, meta); } catch (e) {
    flash({ ok: false, msg: e instanceof StorageFullError ? e.message : 'Erro ao salvar: ' + e });
    return false;
  }
  if (!quiet) flash({ ok: true, msg: n === 'auto' ? 'Autosave feito.' : `Jogo salvo no slot ${n}.` });
  return true;
}
async function loadSlot(n) {
  const data = await store.get(keyOf(n));
  if (!data) throw new Error('Slot vazio');
  game = FutManager.load(await unpack(data));
}
const autosaveOn = () => localStorage.getItem('futmanager98_pref_autosave') !== '0';
async function autosave() { if (autosaveOn() && game) await saveSlot('auto', true); }

async function storageInfo() {
  let s = `Armazenamento: ${store.kind}`;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      s += ` — usado ${(e.usage / 1048576).toFixed(1)} MB de ${(e.quota / 1048576).toFixed(0)} MB`;
    }
  } catch (e) { /* ignora */ }
  return s;
}

async function showSlots(mode) {
  $('#slotsTitle').textContent = mode === 'save' ? 'Salvar jogo' : 'Carregar jogo';
  let html = `<p><small>${esc(await storageInfo())}</small> &nbsp; <label><input type="checkbox" id="autoPref" ${autosaveOn() ? 'checked' : ''}> Autosave a cada rodada</label></p>
    <table><tr><th>Slot</th><th>Clube</th><th>Temporada/Rodada</th><th>Caixa</th><th>Salvo em</th><th></th></tr>`;
  for (const n of ['auto', 1, 2, 3, 4, 5]) {
    const m = (await store.get(keyOf(n))) ? ((await slotMeta(n)) || { team: '?' }) : null;
    const canSave = mode === 'save' && n !== 'auto';
    html += `<tr><td>${n === 'auto' ? 'Autosave' : n}</td><td>${m ? esc(m.team) : '<i>(vazio)</i>'}</td><td>${m ? `T${m.season} / R${m.round}` : ''}</td><td>${m && m.budget != null ? money(m.budget) : ''}</td><td>${m ? esc(m.date || '') : ''}</td><td>
      ${canSave ? `<button data-save="${n}">Salvar aqui</button>` : mode === 'load' ? `<button data-load="${n}" ${m ? '' : 'disabled'}>Carregar</button>` : ''}
      ${m ? `<button data-del="${n}">Apagar</button>` : ''}</td></tr>`;
  }
  $('#slotsBody').innerHTML = html + '</table>';
  $('#slots').classList.remove('hidden');
  $('#autoPref').onchange = (e) => localStorage.setItem('futmanager98_pref_autosave', e.target.checked ? '1' : '0');
  const slotId = (v) => (v === 'auto' ? 'auto' : +v);
  document.querySelectorAll('[data-save]').forEach((b) => b.onclick = async () => {
    const n = slotId(b.dataset.save);
    if ((await store.get(keyOf(n))) && !confirm(`Sobrescrever o slot ${n}?`)) return;
    if (await saveSlot(n)) $('#slots').classList.add('hidden');
  });
  document.querySelectorAll('[data-load]').forEach((b) => b.onclick = async () => {
    try { await loadSlot(slotId(b.dataset.load)); $('#slots').classList.add('hidden'); flash({ ok: true, msg: 'Jogo carregado.' }); enterGame(); } catch (e) { alert(e); }
  });
  document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    const n = slotId(b.dataset.del);
    if (!confirm(`Apagar ${n === 'auto' ? 'o autosave' : 'o slot ' + n}?`)) return;
    await store.del(keyOf(n)); await store.del(metaOf(n)); showSlots(mode);
  });
}
$('#slotsClose').onclick = () => $('#slots').classList.add('hidden');

function enterGame() { $('#start').classList.add('hidden'); $('#main').classList.remove('hidden'); tab = 'clube'; refresh(); }
$('#btnSave').onclick = () => showSlots('save');
$('#btnQuit').onclick = () => { if (confirm('Voltar ao menu? Progresso não salvo será perdido.')) showStart(); };
document.querySelectorAll('.menubar [data-tab]').forEach((b) => b.onclick = () => { if (!playing) { tab = b.dataset.tab; render(); } });
initTeams({ game: () => game, getState: () => st, refresh: () => { refresh(); }, flash, canAct: () => !playing });


// ------------------------------------------------ Render
function renderFired() {
  document.querySelectorAll('.tab').forEach((s) => s.classList.add('hidden'));
  $('#tab-clube').classList.remove('hidden');
  setBar(`Desempregado | Temporada ${st.season}`);
  $('#tab-clube').innerHTML = `<fieldset><legend>Você foi demitido!</legend>
    <div>${st.news.map((n) => `<div>📰 ${esc(n)}</div>`).join('')}</div>
    <p>A diretoria perdeu a paciência com as dívidas. Estes clubes fizeram propostas:</p>
    <table><tr><th>Clube</th><th>Divisão</th><th>Caixa</th><th></th></tr>
    ${st.jobOffers.map((t) => `<tr><td>${esc(t.name)}</td><td>${t.division + 1}</td><td>${money(t.budget)}</td><td><button data-job="${t.id}">Aceitar</button></td></tr>`).join('')}
    </table></fieldset>`;
  document.querySelectorAll('[data-job]').forEach((b) => b.onclick = () => { flash(JSON.parse(game.choose_team(+b.dataset.job))); tab = 'clube'; refresh(); });
}

function render() {
  if (!st.managed) return renderFired();
  const m = st.managed;
  setBar(`${m.name} | Divisão ${m.division + 1} | Temporada ${st.season} | Rodada ${Math.min(st.round + 1, st.rounds)}/${st.rounds} | Caixa: ${money(m.budget)}`);
  document.querySelectorAll('.tab').forEach((s) => s.classList.add('hidden'));
  document.querySelectorAll('.menubar [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#tab-' + tab).classList.remove('hidden');
  ({ clube: renderClub, jogos: renderRound, tabela: renderTable, mercado: renderMarket, base: renderAcademy, financas: renderFinance, historico: renderHistoryTab, times: () => renderTeamsTab(st, $('#tab-times')) })[tab]();
  if (st.reportPending && !playing) showFinale();
}
function renderHistoryTab() { renderHistory(st, $('#tab-historico'), () => openFinale(st.report, st, () => {})); }
function showFinale() {
  if (finaleOpen() || !st.report) return;
  openFinale(st.report, st, () => { game.ack_report(); st = JSON.parse(game.state()); autosave(); render(); });
}

function moraleIcon(v) { return (v >= 70 ? '😃' : v >= 45 ? '🙂' : v >= 25 ? '😐' : '😠') + ' ' + v; }
function status(p) {
  return (p.injured ? `🚑${p.injured} ` : '') + (p.suspended ? `🟥${p.suspended} ` : '') + (p.yellows ? `🟨${p.yellows}` : '');
}
function attrs(p) { const a = p.attrs; return `${a.finishing}/${a.passing}/${a.tackling}/${a.keeping}/${a.stamina}`; }
function playerRow(p, extra, mid) {
  if (mid) return `<td class="pos-${p.pos}">${p.pos}</td><td>${playerLink(p.id, p.name)} <small>${status(p)}</small></td><td>${p.skill}</td>${extra}<td>${p.age}</td><td>${money(p.salary)}</td><td>${money(p.value)}</td>`;
  return `<td class="pos-${p.pos}">${p.pos}</td><td>${playerLink(p.id, p.name)} <small>${status(p)}</small></td><td>${p.skill}</td><td>${p.age}</td><td>${money(p.salary)}</td><td>${money(p.value)}</td>${extra}`;
}

function renderClub() {
  const m = st.managed;
  selected = [...m.lineup];
  const order = { G: 0, D: 1, M: 2, A: 3 };
  const squad = [...m.squad].sort((a, b) => order[a.pos] - order[b.pos] || b.skill - a.skill);
  $('#tab-clube').innerHTML = `
    <fieldset><legend>Escalação</legend>
      Formação: <select id="formation">${st.formations.map((f) => `<option ${f === m.formation ? 'selected' : ''}>${f}</option>`).join('')}</select>
      Mentalidade: <select id="mentality">${m.mentalities.map((x) => `<option ${x === m.tactic ? 'selected' : ''}>${x}</option>`).join('')}</select>
      <label><input type="checkbox" id="pressing" ${m.pressing ? 'checked' : ''}> Marcação pressão</label>
      <button id="btnAuto">Escalação automática</button> <button id="btnSaveLineup">Confirmar escalação</button>
      <span id="lineupInfo"></span> &nbsp; <span style="white-space:nowrap" title="Média da moral do elenco">Moral do elenco: ${moraleIcon(m.morale)}</span>
    </fieldset>
    <div class="list"><table><tr><th>Tit.</th><th>Pos</th><th>Nome</th><th>Hab.</th><th title="Finalização/Passe/Marcação/Goleiro/Resistência">Fin/Pas/Mar/Gol/Res</th><th>Físico</th><th>Idade</th><th>Salário/rod.</th><th>Valor</th><th>Gols</th><th>Moral</th><th>Contrato</th><th></th></tr>
    ${squad.map((p) => `<tr><td><input type="checkbox" data-id="${p.id}" ${selected.includes(p.id) ? 'checked' : ''}></td>${playerRow(p, `<td><small>${attrs(p)}</small></td><td>${p.condition}%</td>`, true)}${(`<td>${p.goals}</td><td>${moraleIcon(p.morale)}</td><td style="${p.contractUntil <= st.season ? 'color:#c00;font-weight:bold' : ''}">${p.loanFrom ? '—' : 'até T' + p.contractUntil}</td><td>${p.loanFrom ? `<small>Emprestado pelo ${esc(p.loanFrom)}</small>` : `<button data-sell="${p.id}">Vender (${money(p.sellPrice)})</button> <button data-loanout="${p.id}">Emprestar</button> <button data-renew="${p.id}">Renovar</button>`}</td>`)}</tr>`).join('')}
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
  const tac = () => { flash(JSON.parse(game.set_tactic($('#mentality').value, $('#pressing').checked))); };
  $('#mentality').onchange = tac; $('#pressing').onchange = tac;
  $('#btnAuto').onclick = () => { flash(JSON.parse(game.auto_lineup($('#formation').value))); refresh(); };
  $('#btnSaveLineup').onclick = () => { const r = JSON.parse(game.set_lineup($('#formation').value, JSON.stringify(selected))); flash(r); if (r.ok) refresh(); };
  document.querySelectorAll('[data-renew]').forEach((b) => b.onclick = () => {
    const id = +b.dataset.renew;
    const years = parseInt(prompt('Duração do novo contrato (1 a 5 temporadas):', '3'), 10);
    if (!years) return;
    const demand = +game.wage_demand(id, years);
    const offer = prompt(`O jogador pede cerca de ${money(demand)} por rodada. Qual a sua oferta (R$/rodada)?`, String(demand));
    if (offer === null) return;
    flash(JSON.parse(game.renew(id, years, +offer))); refresh();
  });
  document.querySelectorAll('[data-loanout]').forEach((b) => b.onclick = () => {
    if (confirm('Emprestar este jogador até o fim da temporada?')) { flash(JSON.parse(game.loan_out(+b.dataset.loanout))); refresh(); }
  });
  document.querySelectorAll('[data-sell]').forEach((b) => b.onclick = () => {
    if (!confirm('Vender este jogador?')) return;
    flash(JSON.parse(game.sell(+b.dataset.sell))); refresh();
  });
}

// Velocidade da partida (ms por minuto de jogo)
const SPEEDS = { lento: { label: 'Lento', ms: 400 }, normal: { label: 'Normal', ms: 150 }, rapido: { label: 'Rápido', ms: 25 } };
const getSpeed = () => { const s = localStorage.getItem('futmanager98_pref_speed'); return SPEEDS[s] ? s : 'normal'; };
const setSpeed = (s) => localStorage.setItem('futmanager98_pref_speed', s);

function renderRound() {
  const m = st.managed;
  const mine = st.next.filter((x) => x.division === m.division);
  const myGame = mine.find((x) => x.home === m.id || x.away === m.id);
  $('#tab-jogos').innerHTML = `
    <div>${st.news.map((n) => `<div>📰 ${esc(n)}</div>`).join('')}</div>
    <p class="big" id="nextLabel">Próximo jogo: ${myGame ? `${esc(myGame.homeName)} x ${esc(myGame.awayName)}` : '—'}</p>
    <button id="btnPlay">▶ Jogar rodada</button> <button id="btnHalf" class="hidden">▶ Iniciar 2º tempo</button>
    <button id="btnPause" class="hidden">⏸ Pausar</button> <button id="btnSkip" class="hidden">⏩ Pular para o fim</button>
    &nbsp; Velocidade: <select id="speed">${Object.entries(SPEEDS).map(([k, v]) => `<option value="${k}" ${k === getSpeed() ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
    <div><span class="clock" id="clock">00'</span> <span id="period" class="big"></span></div>
    <div class="cols"><div><table id="scoreboard"><tr><th>Mandante</th><th></th><th>Visitante</th><th>Público</th><th>Renda</th></tr>
      ${mine.map((x) => `<tr class="${x === myGame ? 'me' : ''}"><td>${teamLink(x.home, x.homeName)}</td><td id="sc-${x.home}">- x -</td><td>${teamLink(x.away, x.awayName)}</td><td id="pub-${x.home}">—</td><td id="renda-${x.home}">—</td></tr>`).join('')}
    </table><div id="subs"></div><div id="roundSummary"></div></div><div>${isFinalStretch(st) ? '<div id="liveTable"></div>' : ''}<div class="ticker" id="ticker">Aguardando o apito inicial...</div></div></div>
    <div id="preview">${st.round < st.rounds ? previewHtml(game, m.id, myGame ? (myGame.home === m.id ? myGame.away : myGame.home) : null) : ''}</div><div id="onfield"></div>`;
  renderLiveTable(st, []);
  $('#speed').onchange = (e) => { setSpeed(e.target.value); if (playing) startTimer(); };
  $('#btnPlay').onclick = () => { game.start_round(); halftimeDone = false; lastGoals = 0; runLive(); };
  if (st.liveActive) { halftimeDone = JSON.parse(game.live())[0]?.minute > 45; runLive(); }
}

let liveTimer = null, paused = false, halftime = false, halftimeDone = false, lastGoals = 0;
function showLive(live) {
  const myId = st.managed.id;
  const myMatch = live.find((r) => r.home === myId || r.away === myId);
  const minute = live.length ? live[0].minute : 0;
  $('#clock').textContent = String(minute).padStart(2, '0') + "'";
  $('#period').textContent = minute >= 90 ? 'Fim de jogo' : halftime ? 'INTERVALO' : minute > 45 ? '2º tempo' : minute > 0 ? '1º tempo' : '';
  for (const r of live) {
    const c = document.getElementById('sc-' + r.home); if (c) c.textContent = `${r.hg} x ${r.ag}`;
    const p = document.getElementById('pub-' + r.home); if (p) p.textContent = r.attendance.toLocaleString('pt-BR') + (r.attendance >= r.capacity ? ' (lotado)' : '');
    const g = document.getElementById('renda-' + r.home); if (g) g.textContent = money(r.receipts);
  }
  const lines = [];
  for (const r of live) for (const e of r.events) if (r === myMatch || e.kind === 'gol') lines.push({ e, r });
  lines.sort((a, b) => b.e.minute - a.e.minute);
  $('#ticker').innerHTML = (halftime ? '<div class="gol">⏸ INTERVALO — faça substituições ou mude a tática e clique em "Iniciar 2º tempo".</div>' : '') +
    lines.map(({ e, r }) => `<div class="${e.kind}">${String(e.minute).padStart(2, '0')}' ${r === myMatch ? '' : '[' + esc(r.homeName) + ' x ' + esc(r.awayName) + '] '}${esc(e.text)}</div>`).join('');
  if (typeof renderSubs === 'function') renderSubs(myMatch);
  renderLiveTable(st, live);
  const of = document.getElementById('onfield');
  if (of && myMatch && minute > 0) { const pv = document.getElementById('preview'); if (pv) pv.innerHTML = ''; of.innerHTML = onFieldHtml(myMatch); }
  if (myMatch) { const g = myMatch.hg + myMatch.ag; if (g > lastGoals) chime('gol'); lastGoals = g; }
  return minute;
}
function enterHalftime() {
  halftime = true;
  clearInterval(liveTimer);
  $('#btnHalf').classList.remove('hidden'); $('#btnPause').classList.add('hidden');
  showLive(JSON.parse(game.live()));
}
function startSecondHalf() {
  halftime = false; halftimeDone = true;
  $('#btnHalf').classList.add('hidden'); $('#btnPause').classList.remove('hidden');
  startTimer();
}
function startTimer() {
  clearInterval(liveTimer);
  if (halftime) return;
  liveTimer = setInterval(() => {
    if (paused) return;
    const minute = showLive(JSON.parse(game.step(1)));
    if (minute >= 90) finishLive();
    else if (minute === 45 && !halftimeDone) {
      if (getSpeed() === 'rapido') halftimeDone = true; else enterHalftime();
    }
  }, SPEEDS[getSpeed()].ms);
}
function runLive() {
  playing = true; paused = false; halftime = false;
  $('#btnPlay').disabled = true; $('#btnSkip').classList.remove('hidden'); $('#btnPause').classList.remove('hidden');
  $('#btnPause').textContent = '⏸ Pausar';
  $('#btnPause').onclick = () => { paused = !paused; $('#btnPause').textContent = paused ? '▶ Continuar' : '⏸ Pausar'; };
  $('#btnHalf').onclick = startSecondHalf;
  $('#btnSkip').onclick = () => { halftime = false; showLive(JSON.parse(game.step(90))); finishLive(); };
  const minute = showLive(JSON.parse(game.live()));
  if (minute === 45 && !halftimeDone && getSpeed() !== 'rapido') enterHalftime(); else startTimer();
}
function finishLive() {
  clearInterval(liveTimer);
  halftime = false;
  const results = JSON.parse(game.finish_round());
  playing = false;
  const myMatch = results.find((r) => st.managed && (r.home === st.managed.id || r.away === st.managed.id));
  const att = myMatch ? `Público: ${myMatch.attendance.toLocaleString('pt-BR')} — Renda: ${money(myMatch.receipts)}` : '';
  st = JSON.parse(game.state());
  $('#ticker').insertAdjacentHTML('afterbegin', `<div class="gol">FIM DE JOGO! ${att}</div>${st.news.map((n) => `<div>📰 ${esc(n)}</div>`).join('')}`);
  $('#btnSkip').classList.add('hidden'); $('#btnPause').classList.add('hidden'); $('#btnHalf').classList.add('hidden');
  $('#period').textContent = 'Fim de jogo';
  if (myMatch) $('#nextLabel').textContent = `Resultado: ${myMatch.homeName} ${myMatch.hg} x ${myMatch.ag} ${myMatch.awayName}`;
  if (document.getElementById('subs')) $('#subs').innerHTML = '';
  if (st.managed) renderRoundSummary(st.managed.lastRound, myMatch);
  $('#btnPlay').disabled = false; $('#btnPlay').textContent = '▶ Próxima rodada';
  $('#btnPlay').onclick = () => { render(); };
  setStatus();
  autosave();
  if (st.reportPending) setTimeout(showFinale, 600);
}

function renderRoundSummary(f, myMatch) {
  const isHome = myMatch && myMatch.home === st.managed.id;
  const income = f.tickets + f.tv + f.transfers_in + f.prizes + f.bank_in + Math.max(0, f.loan_fees);
  const costs = f.salaries + f.upkeep + f.investments + f.transfers_out + f.bank_paid + Math.max(0, -f.loan_fees);
  const row = (l, v, neg) => v ? `<tr><td>${l}</td><td class="n" style="${neg ? 'color:#a00' : ''}">${money(neg ? -v : v)}</td></tr>` : '';
  $('#roundSummary').innerHTML = `<fieldset><legend>Finanças da rodada — ${esc(st.managed.name)}</legend><table>
    ${row(isHome ? `Bilheteria (${myMatch.attendance.toLocaleString('pt-BR')} pagantes)` : 'Bilheteria', f.tickets) || `<tr><td>Bilheteria</td><td style="text-align:right">${isHome ? money(0) : 'jogo fora de casa'}</td></tr>`}
    ${row('Cotas de TV/patrocínio', f.tv)}${row('Prêmios', f.prizes)}${row('Vendas de jogadores', f.transfers_in)}${row('Empréstimo bancário recebido', f.bank_in)}
    ${row('Salários', f.salaries, true)}${row('Manutenção/juros', f.upkeep, true)}${row('Investimentos', f.investments, true)}${row('Compras de jogadores', f.transfers_out, true)}${row('Parcelas do banco', f.bank_paid, true)}
    <tr><td><b>Saldo da rodada</b></td><td style="text-align:right"><b style="color:${income - costs >= 0 ? '#060' : '#a00'}">${money(income - costs)}</b></td></tr>
  </table></fieldset>`;
}
function setStatus() {
  const m = st.managed;
  if (!m) { $('#btnPlay').onclick = () => render(); $('#btnPlay').textContent = '▶ Continuar'; return; }
  setBar(`${m.name} | Divisão ${m.division + 1} | Temporada ${st.season} | Rodada ${Math.min(st.round + 1, st.rounds)}/${st.rounds} | Caixa: ${money(m.budget)}`);
}

let subsKey = '';
function renderSubs(mm) {
  const box = document.getElementById('subs');
  if (!box) return;
  if (!mm || mm.minute >= 90) { box.innerHTML = ''; subsKey = ''; return; }
  const side = mm.home === st.managed.id ? 0 : 1;
  const on = mm.on[side], bench = mm.bench[side];
  const key = on.map((p) => p.id).join(',') + '|' + bench.map((p) => p.id).join(',') + '|' + mm.subs[side] + '|' + Math.floor(mm.minute / 10);
  if (key === subsKey) return;
  subsKey = key;
  const prevOut = document.getElementById('subOut')?.value, prevIn = document.getElementById('subIn')?.value;
  const opt = (p) => `<option value="${p.id}">${p.pos} ${esc(p.name)} (${p.skill}${mm.energy && mm.energy[p.id] !== undefined ? ', ' + Math.round(mm.energy[p.id]) + '% energia' : ''})</option>`;
  box.innerHTML = `<fieldset><legend>Substituições (${mm.subs[side]}/3)</legend>
    Sai: <select id="subOut">${on.map(opt).join('')}</select>
    Entra: <select id="subIn">${bench.map(opt).join('')}</select>
    <button id="btnSub" ${mm.subs[side] >= 3 ? 'disabled' : ''}>Substituir</button><br>
    Mentalidade: <select id="liveMent">${st.managed.mentalities.map((x) => `<option ${x === st.managed.tactic ? 'selected' : ''}>${x}</option>`).join('')}</select>
    <label><input type="checkbox" id="livePress" ${st.managed.pressing ? 'checked' : ''}> Pressão</label></fieldset>`;
  const lt = () => { flash(JSON.parse(game.set_tactic($('#liveMent').value, $('#livePress').checked))); st = JSON.parse(game.state()); };
  $('#liveMent').onchange = lt; $('#livePress').onchange = lt;
  if (prevOut && on.some((p) => String(p.id) === prevOut)) $('#subOut').value = prevOut;
  if (prevIn && bench.some((p) => String(p.id) === prevIn)) $('#subIn').value = prevIn;
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
    ${t.map((r, i) => `<tr class="${r.id === st.managed.id ? 'me' : ''} ${i < 2 && tableDiv > 0 ? 'up' : ''} ${i >= t.length - 2 && tableDiv < 3 ? 'down' : ''}"><td>${i + 1}</td><td>${teamLink(r.id, r.name)} ${formHtml(r.form)}</td><td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${r.gf}</td><td>${r.ga}</td><td>${r.gf - r.ga}</td><td><b>${r.pts}</b>${r.ded ? ` <span style="color:#c00" title="Punição por dívidas">(-${r.ded})</span>` : ''}</td></tr>`).join('')}
    </table><small>Verde: zona de acesso • Vermelho: zona de rebaixamento • (-N): pontos perdidos por dívidas (3 a cada 8 rodadas no vermelho; a cada 4 se a dívida for muito alta)</small></div>
    <div><table><tr><th colspan="3">Artilharia geral</th></tr>${st.scorers.map((p) => `<tr><td>${playerLink(p.id, p.name)}</td><td>${teamLink(p.team, p.teamName)}</td><td>${p.goals}</td></tr>`).join('')}</table></div></div>`;
  $('#tdiv').onchange = (e) => { tableDiv = +e.target.value; renderTable(); };
}

let mkPos = '', mkMax = '';
function renderMarket() {
  const max = mkMax === '' ? st.managed.budget : +mkMax;
  const list = JSON.parse(game.market(mkPos, max));
  $('#tab-mercado').innerHTML = `
    Posição: <select id="mpos">${['', 'G', 'D', 'M', 'A'].map((p) => `<option value="${p}" ${p === mkPos ? 'selected' : ''}>${p || 'Todas'}</option>`).join('')}</select>
    Preço máximo (R$): <input id="mmax" title="Mostra apenas jogadores até este preço" type="number" value="${max}" step="100000"> <button id="mgo">Filtrar</button>
    <span>Orçamento: <b>${money(st.managed.budget)}</b> — Elenco: ${st.managed.squad.length}/28</span>
    <div class="list"><table><tr><th>Pos</th><th>Nome</th><th>Hab.</th><th>Idade</th><th>Salário/rod.</th><th>Valor</th><th>Clube</th><th>Preço</th><th></th></tr>
    ${list.map((p) => `<tr>${playerRow(p, `<td>${teamLink(p.team, p.teamName)}</td>
<td>${money(p.buyPrice)}</td><td><button data-buy="${p.id}">Comprar</button>${p.team !== null ? ` <button data-loanin="${p.id}">Empréstimo (${money(p.loanFee)})</button>` : ''}</td>`)}</tr>`).join('')}
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
  const bal = f.tickets + f.transfers_in + f.prizes - f.salaries - f.transfers_out - f.upkeep - f.investments + f.tv + f.bank_in - f.bank_paid + f.loan_fees;
  $('#tab-financas').innerHTML = `${m.debtRounds ? `<p style="color:#c00;font-weight:bold">⚠️ Caixa negativo há ${m.debtRounds} rodada(s): juros de 1,5% por rodada, vendas forçadas a partir de 6 rodadas e demissão após 12. Clubes endividados também perdem pontos na tabela.</p>` : ''}<div class="cols"><div><table>
    <tr><th colspan="2">Temporada ${st.season}</th></tr>
    <tr><td>Bilheteria</td><td>${money(f.tickets)}</td></tr>
    <tr><td>Cotas de TV/patrocínio</td><td>${money(f.tv)}</td></tr>
    <tr><td>Vendas de jogadores</td><td>${money(f.transfers_in)}</td></tr>
    <tr><td>Premiações</td><td>${money(f.prizes)}</td></tr>
    <tr><td>Salários pagos</td><td>${money(-f.salaries)}</td></tr>
    <tr><td>Compras de jogadores</td><td>${money(-f.transfers_out)}</td></tr>
    <tr><td>Manutenção (base/estádio)</td><td>${money(-f.upkeep)}</td></tr>
    <tr><td>Investimentos</td><td>${money(-f.investments)}</td></tr>
    <tr><td>Empréstimos bancários recebidos</td><td>${money(f.bank_in)}</td></tr>
    <tr><td>Parcelas pagas ao banco</td><td>${money(-f.bank_paid)}</td></tr>
    <tr><td>Taxas de empréstimo de jogadores (saldo)</td><td>${money(f.loan_fees)}</td></tr>
    <tr><td><b>Saldo da temporada</b></td><td><b>${money(bal)}</b></td></tr>
    <tr><td><b>Caixa atual</b></td><td><b>${money(m.budget)}</b></td></tr>
  </table></div><div><fieldset><legend>Estádio</legend>
    Capacidade: ${m.capacity.toLocaleString('pt-BR')} lugares<br>Folha salarial por rodada: ${money(m.wageBill)}<br><br>
    Preço do ingresso: <input id="tprice" type="number" min="${m.ticketRange[0]}" max="${m.ticketRange[1]}" value="${m.ticketPrice}"> <button id="tsave">Alterar</button>
    <br><small>(faixa: ${money(m.ticketRange[0])} a ${money(m.ticketRange[1])}; o preço é mantido entre temporadas)</small><br>
    Público esperado no próximo jogo em casa: ~${m.expectedAttendance.toLocaleString('pt-BR')}<br>
    Manutenção do estádio: ${money(m.stadiumUpkeep)} por rodada
  </fieldset><fieldset><legend>Banco</legend>
    Dívida: <b>${money(m.bankDebt)}</b> — parcela: ${money(m.bankPayment)}/rodada — limite: ${money(m.bankLimit)}<br>
    Valor: <input id="bankAmt" type="number" step="100000" value="1000000"> <button id="bankTake">Pegar empréstimo (+12% juros)</button> <button id="bankPay">Amortizar</button>
    ${m.loanedOut.length ? `<br>Emprestados a outros clubes: ${m.loanedOut.map((p) => esc(p.name) + ' (' + esc(p.teamName) + ')').join(', ')}` : ''}
  </fieldset><fieldset><legend>Ampliação do estádio</legend>
    ${m.construction ? `🏗️ Obra em andamento: +${m.construction.seats.toLocaleString('pt-BR')} lugares, faltam ${m.construction.rounds_left} rodada(s).`
      : m.stadiumOptions.map((o, i) => `<button data-stad="${i}">+${o.seats.toLocaleString('pt-BR')} lugares — ${money(o.cost)} (${o.rounds} rodadas)</button>`).join('')}
    <br><small>Ampliar só aumenta o público se a procura for maior que a capacidade. Ingressos caros reduzem a procura.</small>
  </fieldset></div></div>`;
  $('#bankTake').onclick = () => { flash(JSON.parse(game.take_bank_loan(+$('#bankAmt').value))); refresh(); };
  $('#bankPay').onclick = () => { flash(JSON.parse(game.repay_bank_loan(+$('#bankAmt').value))); refresh(); };
  document.querySelectorAll('[data-stad]').forEach((b) => b.onclick = () => { if (confirm('Iniciar a obra?')) { flash(JSON.parse(game.upgrade_stadium(+b.dataset.stad))); refresh(); } });
  $('#tsave').onclick = () => { flash(JSON.parse(game.set_ticket_price(+$('#tprice').value))); refresh(); };
}

await init();
await initStorage();
showStart();

// Autoteste opcional: abra index.html?selftest para validar o motor no navegador.
if (location.search.includes('selftest')) (async () => {
  const out = [];
  try {
    $('#btnNew').click();
    document.querySelector('#teamList button').click();
    out.push('time=' + st.managed.name);
    // UI da rodada: pausa no intervalo (Normal) e 2º tempo automático (Rápido)
    const wait = async (cond, ms) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 50)); } return true; };
    setSpeed('normal');
    tab = 'jogos'; render();
    if ($('#speed').value !== 'normal') throw 'velocidade não persistida';
    // pré-jogo: escalação provável do adversário
    const boxes = document.querySelectorAll('#preview .xi-box');
    if (boxes.length !== 2 || !boxes[1].textContent.includes('Próximo adversário')) throw 'pré-jogo do adversário';
    if (boxes[1].querySelectorAll('tr').length !== 12) throw 'XI provável do adversário';
    if (!boxes[1].querySelector('.form') && !boxes[1].textContent.includes('Forma')) throw 'forma do adversário';
    boxes[1].querySelector('.tlink').click();
    if ($('#teamview').classList.contains('hidden')) throw 'ficha do adversário';
    const nSquad = document.querySelectorAll('#teamview .sortable tr').length - 1;
    if (nSquad < 16) throw 'elenco na ficha: ' + nSquad;
    document.querySelector('#teamview [data-sort="skill"]').click();
    const sk = [...document.querySelectorAll('#teamview .sortable tr')].slice(1).map((r) => +r.children[2].textContent);
    if (sk.some((v, i) => i && v > sk[i - 1])) throw 'ordenação por habilidade';
    if (!document.querySelector('#teamview [data-tvbuy]') || !document.querySelector('#teamview [data-tvloan]')) throw 'ações de mercado na ficha';
    document.querySelector('#teamview .plink').click();
    if ($('#playercard').classList.contains('hidden') || !$('#playercard').textContent.includes('Finalização')) throw 'cartão do jogador';
    closePlayer(); closeTeam();
    out.push('adversario=ok');
    tab = 'times'; render();
    if (document.querySelectorAll('#tab-times .team-card').length !== 16) throw 'aba times';
    $('#teamsDiv').value = '0'; $('#teamsDiv').onchange({ target: $('#teamsDiv') });
    document.querySelectorAll('#tab-times .team-card')[3].click();
    if ($('#teamview').classList.contains('hidden') || !$('#teamview').textContent.includes('1ª')) throw 'ficha pela aba times';
    closeTeam();
    tab = 'tabela'; render();
    document.querySelector('#tab-tabela .tlink').click();
    if ($('#teamview').classList.contains('hidden')) throw 'ficha pela classificação';
    closeTeam();
    out.push('times=ok');
    tab = 'jogos'; render();
    $('#btnPlay').click();
    if (!(await wait(() => !$('#btnHalf').classList.contains('hidden'), 15000))) throw 'não parou no intervalo';
    await new Promise((r) => setTimeout(r, 800));
    if ($('#clock').textContent !== "45'") throw 'relógio andou no intervalo: ' + $('#clock').textContent;
    const pubCells = [...document.querySelectorAll('[id^="pub-"]')].map((c) => c.textContent);
    if (pubCells.some((t) => t === '—')) throw 'público não exibido';
    if ([...document.querySelectorAll('[id^="renda-"]')].some((c) => !c.textContent.startsWith('R$'))) throw 'renda não exibida';
    const ofb = document.querySelectorAll('#onfield .onfield');
    if (ofb.length !== 2 || [...ofb].some((b) => b.querySelectorAll('tr').length < 10) || !$('#onfield .small-meter')) throw 'jogadores em campo';
    if ($('#preview').innerHTML !== '') throw 'pré-jogo deveria sumir durante o jogo';
    out.push('em_campo=ok');

    $('#btnHalf').click();
    if (!(await wait(() => !playing, 15000))) throw 'partida não terminou';
    if (!$('#roundSummary').textContent.includes('Saldo da rodada')) throw 'resumo da rodada';
    out.push('intervalo=ok');
    setSpeed('rapido');
    $('#btnPlay').click(); // volta à tela da rodada
    if ($('#speed').value !== 'rapido') throw 'velocidade';
    const t0 = Date.now();
    $('#btnPlay').click();
    if (!(await wait(() => !playing, 8000))) throw 'rápido não terminou (parou no intervalo?)';
    if (Date.now() - t0 > 5000) throw 'rápido lento demais';
    out.push('rapido=ok');
    setSpeed('normal');
    game.start_round();
    const lv = JSON.parse(game.step(45));
    if (lv[0].minute !== 45) throw 'step falhou';
    const mm = lv.find((x) => x.home === st.managed.id || x.away === st.managed.id);
    const sd = mm.home === st.managed.id ? 0 : 1;
    const sr = JSON.parse(game.substitute(mm.on[sd][1].id, mm.bench[sd][0].id));
    if (!sr.ok) throw 'substituição falhou: ' + sr.msg;
    out.push('sub=ok');
    if (!JSON.parse(game.set_tactic('ofensiva', true)).ok) throw 'tática';
    out.push('tatica=ok');
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
    const tr = JSON.parse(game.set_ticket_price(9999));
    if (JSON.parse(game.state()).managed.ticketPrice !== fin.ticketRange[1]) throw 'faixa de ingresso: ' + tr.msg;
    if (!JSON.parse(game.take_bank_loan(100000)).ok) throw 'banco';
    const cand = JSON.parse(game.market('', 1e12)).filter((p) => p.team !== null).sort((a, b) => a.loanFee - b.loanFee)[0];
    const lr = JSON.parse(game.loan_in(cand.id));
    if (!lr.ok) throw 'empréstimo: ' + lr.msg;
    out.push('emprestimos=ok');
    const pl = JSON.parse(game.state()).managed.squad.find((p) => !p.loanFrom);
    const dem = +game.wage_demand(pl.id, 2);
    if (JSON.parse(game.renew(pl.id, 2, Math.floor(dem / 3))).ok) throw 'renovação barata aceita';
    const rn = JSON.parse(game.renew(pl.id, 2, +game.wage_demand(pl.id, 2)));
    if (!rn.ok) throw 'renovação: ' + rn.msg;
    out.push('contratos=ok');
    if (JSON.parse(game.state()).managed.finance.tv === undefined) throw 'tv';
    const teamName = st.managed.name;
    if (store.kind !== 'IndexedDB') throw 'IndexedDB indisponível';
    await saveSlot(2);
    if ((await slotMeta(2)).team !== teamName) throw 'meta do slot';
    if (!(await store.get('slot_2')).startsWith('gz:')) throw 'save não compactado';
    await autosave();
    if ((await slotMeta('auto')).team !== teamName) throw 'autosave';
    game = new FutManager(1);
    await loadSlot(2);
    if (JSON.parse(game.summary()).team !== teamName) throw 'load slot';
    await store.del('slot_2'); await store.del('meta_2');
    out.push('slots=ok');
    // simula armazenamento cheio: o autosave deve ser descartado para caber o slot
    const real = store;
    const mem = new Map([['autosave', 'x'.repeat(600)], ['autosave_meta', '{}']]);
    const size = () => [...mem.values()].reduce((a, v) => a + v.length, 0);
    store = { kind: 'teste', get: async (k) => mem.get(k) ?? null, del: async (k) => { mem.delete(k); },
      set: async (k, v) => { const old = mem.get(k); mem.set(k, v); if (size() > 1000) { if (old === undefined) mem.delete(k); else mem.set(k, old); const e = new Error('cheio'); e.name = 'QuotaExceededError'; throw e; } } };
    await putWithPrune('slot_3', 'y'.repeat(500), { team: 't' });
    if (mem.has('autosave') || !mem.has('slot_3')) throw 'poda do autosave';
    let full = false;
    try { await putWithPrune('slot_4', 'z'.repeat(900), { team: 't' }); } catch (e) { full = e instanceof StorageFullError; }
    if (!full) throw 'aviso de espaço';
    store = real;
    out.push('armazenamento=ok');
    out.push('rodada_apos_load=' + JSON.parse(game.state()).round);
    // reta final: joga até a última rodada e assiste ao vivo (tabela "se terminasse agora")
    while (JSON.parse(game.state()).round < 28) game.play_round();
    refresh(); tab = 'jogos'; render();
    if (!$('#liveTable .livetable') || !$('#liveTable').textContent.includes('Penúltima')) throw 'tabela ao vivo (penúltima)';
    game.play_round(); refresh(); tab = 'jogos'; render();
    if (!$('#liveTable').textContent.includes('Última rodada')) throw 'tabela ao vivo (última)';
    setSpeed('rapido');
    $('#btnPlay').click();
    await wait(() => JSON.parse(game.live())[0]?.minute >= 20, 5000);
    if (document.querySelectorAll('#liveTable tr').length < 17) throw 'linhas da tabela ao vivo';
    out.push('reta_final=ok');
    if (!(await wait(() => !$('#finale').classList.contains('hidden'), 10000))) throw 'encerramento não abriu';
    const seen = [];
    for (let k = 0; k < 10 && !$('#finale').classList.contains('hidden'); k++) {
      seen.push($('#finale .finale-win').dataset.page);
      if (k === 1) { $('#finPrev').click(); if ($('#finale .finale-win').dataset.page !== seen[0]) throw 'anterior'; $('#finNext').click(); }
      $('#finNext').click();
    }
    if (seen.join(',') !== 'campeao,acesso,premios,temporada,proxima') throw 'páginas do encerramento: ' + seen;
    const s2 = JSON.parse(game.state());
    if (s2.reportPending) throw 'encerramento não confirmado';
    if (s2.history.length !== 1 || s2.history[0].champions.length !== 4) throw 'histórico';
    out.push('encerramento=' + seen.length + 'p');
    tab = 'historico'; render();
    if (!$('#tab-historico').textContent.includes('Galeria de campeões')) throw 'aba histórico';
    $('#btnReopen').click();
    if ($('#finale').classList.contains('hidden')) throw 'rever encerramento';
    $('#finSkipBtn').click();
    if (!$('#finale').classList.contains('hidden')) throw 'pular';
    out.push('historico=ok');
    setSpeed('normal');
    out.push('temporada=' + s2.season);
    out.push('SELFTEST_OK');
  } catch (e) { out.push('SELFTEST_FAIL ' + e); }
  document.body.insertAdjacentHTML('beforeend', `<pre id="selftest">${out.join(' | ')}</pre>`);
})();

// Demonstração do fim de temporada: index.html?finale leva o jogo até a última rodada.
if (location.search.includes('finale')) {
  $('#btnNew').click();
  document.querySelector('#teamList button').click();
  while (JSON.parse(game.state()).round < 29) game.play_round();
  refresh(); tab = 'jogos'; render();
}
// Demonstração: index.html?demo inicia um jogo e começa uma rodada ao vivo.

if (location.search.includes('demo')) {
  $('#btnNew').click();
  document.querySelector('#teamList button').click();
  tab = 'jogos'; render();
  $('#btnPlay').click();
}
