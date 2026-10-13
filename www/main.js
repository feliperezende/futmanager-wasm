import init, { FutManager } from '../pkg/futmanager.js';
import { initDesktop, openAbout } from './desktop.js';
import { openCup, openDraw, animateShootout } from './cup.js';
import { openJornal } from './jornal.js';
import { createPitch } from './pitch.js';
import { windowLabel, windowBanner, openOffers, openNegotiation, auctionHtml, openTransfers } from './market.js';
import { initWM, openWindow, closeWindow, getWindow, closeWhere, tbtn, manageMain } from './wm.js';
import { openFinale, finaleOpen, renderLiveTable, renderHistory, isFinalStretch } from './finale.js';
import { initSound, sfx, soundOn, setSound, getVolume, setVolume, played as soundLog, audioState } from './sound.js';
initSound();
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

function flash(r) { $('#msg').textContent = r.msg || r; $('#msg').style.color = r.ok === false && r.status !== 'counter' ? '#a00' : '#000080'; }
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
$('#slotsBtns').innerHTML = tbtn('close', '', false).replace('class="tbtn', 'id="slotsClose" class="tbtn');
$('#slotsClose').onclick = () => $('#slots').classList.add('hidden');

function enterGame() { $('#start').classList.add('hidden'); $('#main').classList.remove('hidden'); tab = 'clube'; refresh(); }
$('#btnSave').onclick = () => showSlots('save');
$('#btnQuit').onclick = () => { if (confirm('Voltar ao menu? Progresso não salvo será perdido.')) { closeWhere(() => true); showStart(); } };
initWM();
$('#mainBtns').innerHTML = tbtn('min', 'wm-min') + tbtn('max', 'wm-max') + tbtn('close', 'wm-close', true);
const mainWin = manageMain($('#app'), '⚽ FutManager 98');
let gameVersion = '';
document.querySelectorAll('.menubar [data-tab]').forEach((b) => b.onclick = () => { if (b.dataset.tab === 'historico') { openHistory(); return; } if (b.dataset.tab === 'copa') { openCup(st); return; } if (b.dataset.tab === 'jornal') { showJornal(); return; } if (!playing) { tab = b.dataset.tab; render(); } });
initTeams({ game: () => game, getState: () => st, refresh: () => { refresh(); }, flash, canAct: () => !playing,
  marketOpen: () => !!(st && st.market && st.market.open), negotiate: (p) => openNegotiation(p, st, mctx) });


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
  setBar(`${m.name} | Divisão ${m.division + 1} | Temporada ${st.season} | Rodada ${Math.min(st.round + 1, st.rounds)}/${st.rounds} | ${windowLabel(st.market)} | Caixa: ${money(m.budget)}`);
  document.querySelectorAll('.tab').forEach((s) => s.classList.add('hidden'));
  document.querySelectorAll('.menubar [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#tab-' + tab).classList.remove('hidden');
  ({ clube: renderClub, jogos: renderRound, tabela: renderTable, mercado: renderMarket, base: renderAcademy, financas: renderFinance, times: () => renderTeamsTab(st, $('#tab-times')) })[tab]();
  if (st.reportPending && !playing) showFinale();
  else if (st.cup && st.cup.drawPending && !playing) showDraw();
  else if (st.market.unseen && st.market.offers.length && !playing && !getWindow('sorteio')) openOffers(st, mctx);
  if (st.journal.unseen && !playing && !st.reportPending && !getWindow('jornal')) showJornal();
}
function showJornal(n = 0) {
  const w = openJornal((k) => JSON.parse(game.journal(k)), n);
  if (!w) { flash({ ok: false, msg: 'O Placar Diário ainda não publicou nenhuma edição: jogue uma rodada.' }); return; }
  game.ack_journal(); st.journal.unseen = false;
}
const mctx = { get game() { return game; }, refresh: () => refresh(), flash: (r) => flash(r) };
function showDraw() {
  if (getWindow('sorteio') || finaleOpen()) return;
  openDraw(st, () => { game.ack_cup_draw(); st = JSON.parse(game.state()); });
}
function openHistory() {
  const w = openWindow({ key: 'historico', id: 'historico', title: 'Histórico — galeria de campeões', width: 920 });
  renderHistory(st, w.body, () => openFinale(st.report, st, () => {}));
}
function refreshHistory() { if (getWindow('historico')) openHistory(); }
function showFinale() {
  if (finaleOpen() || !st.report) return;
  openFinale(st.report, st, () => { game.ack_report(); st = JSON.parse(game.state()); autosave(); render(); refreshHistory(); });
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
  const cupDay = st.dayType === 'cup';
  const mine = cupDay ? st.next : st.next.filter((x) => x.division === m.division);
  const myGame = mine.find((x) => x.home === m.id || x.away === m.id);
  $('#tab-jogos').innerHTML = `
    <div>${st.news.map((n) => `<div>📰 ${esc(n)}</div>`).join('')}</div>
    <p class="big" id="nextLabel">${cupDay ? `<span class="daytag">COPA NACIONAL</span> ${esc(st.cupRoundName)} — ` : ''}Próximo jogo: ${myGame ? `${esc(myGame.homeName)} x ${esc(myGame.awayName)}` : '—'}</p>
    <button id="btnPlay">${cupDay ? '▶ Jogar Copa' : '▶ Jogar rodada'}</button> <button id="btnPreview" title="Escalação provável do adversário">🔎 Pré-jogo</button> <button id="btnHalf" class="hidden">▶ Iniciar 2º tempo</button>
    <button id="btnPause" class="hidden">⏸ Pausar</button> <button id="btnSkip" class="hidden">⏩ Pular para o fim</button>
    &nbsp; <label title="Efeitos sonoros (apito, gols, cartões, pênaltis)"><input type="checkbox" id="sndOn" ${soundOn() ? 'checked' : ''}> 🔊 Som</label>
    <input type="range" id="sndVol" min="0" max="100" value="${Math.round(getVolume() * 100)}" title="Volume" ${soundOn() ? '' : 'disabled'} style="width:80px;vertical-align:middle">
    &nbsp; Velocidade: <select id="speed">${Object.entries(SPEEDS).map(([k, v]) => `<option value="${k}" ${k === getSpeed() ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
    &nbsp; <label title="Campinho animado da sua partida (oculto no modo Rápido)"><input type="checkbox" id="pitchOn" ${pitchPref() ? 'checked' : ''}> Mostrar campinho</label>
    <div><span class="clock" id="clock">00'</span> <span id="period" class="big"></span></div>
    <div class="cols"><div><table id="scoreboard"><tr><th>Mandante</th><th></th><th>Visitante</th><th>Público</th><th>Renda</th></tr>
      ${mine.map((x) => `<tr class="${x === myGame ? 'me' : ''}"><td>${teamLink(x.home, x.homeName)}</td><td id="sc-${x.home}">- x -</td><td>${teamLink(x.away, x.awayName)}</td><td id="pub-${x.home}">—</td><td id="renda-${x.home}">—</td></tr>`).join('')}
    </table><div id="subs"></div></div><div>${isFinalStretch(st) ? '<div id="liveTable"></div>' : ''}${myGame ? `<div class="pitchwin" id="pitchWin"><div class="pw-title"><span>⚽ Campinho — ${esc(myGame.homeName)} x ${esc(myGame.awayName)}</span><span class="pw-min" id="pitchMin"></span></div>
      <div class="pw-body"><canvas id="pitchCv" width="320" height="200"></canvas></div><div class="pw-note small" id="pitchNote"></div></div>` : ''}<div class="ticker" id="ticker">Aguardando o apito inicial...</div></div></div>
    <div id="onfield"></div>`;
  renderLiveTable(st, []);
  const oppId = myGame ? (myGame.home === m.id ? myGame.away : myGame.home) : null;
  const openPreview = () => openWindow({ key: 'pre-jogo', id: 'pre-jogo', title: `Pré-jogo — ${myGame ? myGame.homeName + ' x ' + myGame.awayName : ''}`, width: 860,
    x: Math.max(8, window.innerWidth - 880), y: window.scrollY + 230, html: previewHtml(game, m.id, oppId) });
  $('#btnPreview').onclick = openPreview;
  $('#btnPreview').disabled = !myGame || st.liveActive;
  if (myGame && !st.liveActive && previewRound !== st.season * 100 + st.round && window.innerWidth > 600) { previewRound = st.season * 100 + st.round; openPreview(); }
  $('#speed').onchange = (e) => { setSpeed(e.target.value); updatePitch(); if (playing) startTimer(); };
  pitch = myGame ? createPitch($('#pitchCv'), { sfx, getSpeed }) : null;
  $('#pitchOn').onchange = (e) => { localStorage.setItem('futmanager98_pref_pitch', e.target.checked ? '1' : '0'); updatePitch(); };
  if ($('#pitchMin')) $('#pitchMin').onclick = () => { pitchMin = !pitchMin; updatePitch(); };
  updatePitch();
  $('#btnPlay').onclick = () => { game.start_round(); halftimeDone = false; seenEvents = 0; lastMinute = 0; shootReveal = Infinity; runLive(); };
  $('#sndOn').onchange = (e) => { setSound(e.target.checked); $('#sndVol').disabled = !e.target.checked; if (e.target.checked) sfx('virar'); };
  $('#sndVol').oninput = (e) => setVolume(+e.target.value / 100);
  $('#sndVol').onchange = () => sfx('cartao');
  if (st.liveActive) { halftimeDone = JSON.parse(game.live())[0]?.minute > 45; runLive(); }
}

let previewRound = -1;
// ------------------------------------------------ campinho animado
let pitch = null, pitchMin = false, pitchForceOff = false, skipping = false;
const pitchPref = () => localStorage.getItem('futmanager98_pref_pitch') !== '0';
const pitchShown = () => !!pitch && pitchPref() && !pitchForceOff && !pitchMin && getSpeed() !== 'rapido';
function updatePitch() {
  const w = document.getElementById('pitchWin');
  if (!w) return;
  const fast = getSpeed() === 'rapido';
  w.classList.toggle('hidden', !pitchPref() || pitchForceOff);
  w.classList.toggle('min', pitchMin || fast);
  $('#pitchMin').innerHTML = tbtn(pitchMin ? 'max' : 'min');
  $('#pitchNote').textContent = fast ? 'Campinho oculto no modo Rápido.' : '';
  if (pitch) pitch.setActive(pitchShown());
}
let liveTimer = null, paused = false, halftime = false, halftimeDone = false, seenEvents = 0, lastMinute = 0;
let liveDone = false, shootReveal = Infinity, shootMatch = null;
function showLive(live) {
  const myId = st.managed.id;
  const myMatch = live.find((r) => r.home === myId || r.away === myId);
  const minute = myMatch ? myMatch.minute : live.reduce((a, r) => Math.max(a, r.minute), 0);
  liveDone = live.length > 0 && live.every((r) => r.over);
  // disputa por pênaltis da partida do usuário: revelada cobrança a cobrança (exceto no modo Rápido)
  if (myMatch && myMatch.pens && shootReveal === Infinity && !shootMatch && getSpeed() !== 'rapido') { shootReveal = 0; shootMatch = myMatch; }
  $('#clock').textContent = String(minute).padStart(2, '0') + "'";
  $('#period').textContent = myMatch && myMatch.pens ? 'Pênaltis' : (myMatch ? myMatch.over : liveDone) ? 'Fim de jogo' : halftime ? 'INTERVALO' : minute > 90 ? 'Prorrogação' : minute > 45 ? '2º tempo' : minute > 0 ? '1º tempo' : '';
  for (const r of live) {
    const c = document.getElementById('sc-' + r.home);
    if (c) {
      const txt = `${r.hg} x ${r.ag}${r.pens && (r !== myMatch || shootReveal === Infinity) ? ` (${r.pens[0]}x${r.pens[1]} pên.)` : r.et ? ' (prorr.)' : ''}`;
      // gol em outro jogo: só um destaque discreto na linha do placar (sem texto na narração)
      if (r !== myMatch && c.dataset.score !== undefined && c.dataset.score !== txt) { const tr = c.closest('tr'); tr.classList.remove('goal-flash'); void tr.offsetWidth; tr.classList.add('goal-flash'); }
      c.dataset.score = txt; c.textContent = txt;
    }
    const p = document.getElementById('pub-' + r.home); if (p) p.textContent = r.attendance.toLocaleString('pt-BR') + (r.attendance >= r.capacity ? ' (lotado)' : '');
    const g = document.getElementById('renda-' + r.home); if (g) g.textContent = money(r.receipts);
  }
  // narração: somente os lances da partida do usuário
  let shown = 0;
  const lines = myMatch ? myMatch.events.filter((e) => !e.kind.startsWith('disputa') || shown++ < shootReveal).reverse() : [];
  $('#ticker').innerHTML = (halftime ? '<div class="gol">⏸ INTERVALO — faça substituições ou mude a tática e clique em "Iniciar 2º tempo".</div>' : '') +
    (myMatch ? lines.map((e) => `<div class="${e.kind}" data-m="${myMatch.home}">${String(e.minute).padStart(2, '0')}' ${esc(e.text)}</div>`).join('')
      : (live.length ? '<div>Seu clube não joga nesta rodada. Acompanhe os placares na lista ao lado.</div>' : ''));
  if (pitch) pitch.update(myMatch, { halftime, halftimeDone, shootout: !!(myMatch && myMatch.pens), shootReveal, skip: skipping });
  if (typeof renderSubs === 'function') renderSubs(myMatch);
  renderLiveTable(st, live);
  const of = document.getElementById('onfield');
  if (of && myMatch && minute > 0) { closeWindow('pre-jogo'); if ($('#btnPreview')) $('#btnPreview').disabled = true; of.innerHTML = onFieldHtml(myMatch); }
  if (myMatch) {
    if (lastMinute === 0 && minute >= 1) sfx('kickoff', getSpeed());
    for (const e of myMatch.events.slice(seenEvents)) if (['gol', 'cartao', 'vermelho', 'penalti', 'penalti_perdido', 'prorrogacao'].includes(e.kind) && !(e.kind === 'gol' && pitchShown() && !skipping)) sfx(e.kind, getSpeed()); // com o campinho, o som do gol sai quando a bola balança a rede
    seenEvents = myMatch.events.length;
  }
  lastMinute = minute;
  return minute;
}
function enterHalftime() {
  halftime = true;
  sfx('halftime', getSpeed());
  clearInterval(liveTimer);
  $('#btnHalf').classList.remove('hidden'); $('#btnPause').classList.add('hidden');
  showLive(JSON.parse(game.live()));
}
function startSecondHalf() {
  halftime = false; halftimeDone = true;
  sfx('secondhalf', getSpeed());
  $('#btnHalf').classList.add('hidden'); $('#btnPause').classList.remove('hidden');
  startTimer();
}
function startTimer() {
  clearInterval(liveTimer);
  if (halftime) return;
  liveTimer = setInterval(() => {
    if (paused || (pitch && pitch.busy())) return;
    const minute = showLive(JSON.parse(game.step(1)));
    if (liveDone) {
      if (shootMatch && shootReveal === 0) {
        clearInterval(liveTimer);
        $('#btnPause').classList.add('hidden');
        animateShootout(shootMatch.events, (n) => { shootReveal = n; showLive(JSON.parse(game.live())); }, getSpeed(), () => { shootReveal = Infinity; finishLive(); });
      } else finishLive();
    }
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
  $('#btnSkip').onclick = () => { halftime = false; skipping = true; showLive(JSON.parse(game.step(200))); shootReveal = Infinity; finishLive(); skipping = false; };
  const minute = showLive(JSON.parse(game.live()));
  if (minute === 45 && !halftimeDone && getSpeed() !== 'rapido') enterHalftime(); else startTimer();
}
function finishLive() {
  clearInterval(liveTimer);
  halftime = false;
  if (!playing) return;
  const results = JSON.parse(game.finish_round());
  playing = false;
  shootMatch = null; shootReveal = Infinity;
  sfx('final', getSpeed());
  const myMatch = results.find((r) => st.managed && (r.home === st.managed.id || r.away === st.managed.id));
  const att = myMatch ? `Público: ${myMatch.attendance.toLocaleString('pt-BR')} — Renda: ${money(myMatch.receipts)}` : '';
  st = JSON.parse(game.state());
  $('#ticker').insertAdjacentHTML('afterbegin', `<div class="gol">FIM DE JOGO! ${att}</div>`);
  $('#btnSkip').classList.add('hidden'); $('#btnPause').classList.add('hidden'); $('#btnHalf').classList.add('hidden');
  $('#period').textContent = 'Fim de jogo';
  if (myMatch) {
    const pe = myMatch.events.find((e) => e.kind === 'disputa_fim');
    $('#nextLabel').textContent = `Resultado: ${myMatch.homeName} ${myMatch.hg} x ${myMatch.ag} ${myMatch.awayName}${pe ? ' — ' + pe.text : ''}`;
  }
  if (document.getElementById('subs')) $('#subs').innerHTML = '';
  if (st.managed) renderRoundSummary(st.managed.lastRound, myMatch);
  $('#btnPlay').disabled = false; $('#btnPlay').textContent = '▶ Próxima rodada';
  $('#btnPlay').onclick = () => { render(); };
  setStatus();
  autosave();
  if (st.reportPending) setTimeout(showFinale, 600);
  else if (st.cup.drawPending) setTimeout(showDraw, 700);
}


function renderRoundSummary(f, myMatch) {
  const isHome = myMatch && myMatch.home === st.managed.id;
  const income = f.tickets + f.tv + f.transfers_in + f.prizes + f.bank_in + Math.max(0, f.loan_fees);
  const costs = f.salaries + f.upkeep + f.investments + f.transfers_out + f.bank_paid + Math.max(0, -f.loan_fees);
  const row = (l, v, neg) => v ? `<tr><td>${l}</td><td class="n" style="${neg ? 'color:#a00' : ''}">${money(neg ? -v : v)}</td></tr>` : '';
  openWindow({ key: 'financas-rodada', id: 'financas-rodada', title: `Finanças da rodada ${st.round || st.rounds} — ${st.managed.name}`, width: 400, x: Math.max(8, window.innerWidth - 430), y: window.scrollY + 90, html: `<table class="round-fin">
    ${row(isHome ? `Bilheteria (${myMatch.attendance.toLocaleString('pt-BR')} pagantes)` : 'Bilheteria', f.tickets) || `<tr><td>Bilheteria</td><td style="text-align:right">${isHome ? money(0) : 'jogo fora de casa'}</td></tr>`}
    ${row('Cotas de TV/patrocínio', f.tv)}${row('Prêmios', f.prizes)}${row('Vendas de jogadores', f.transfers_in)}${row('Empréstimo bancário recebido', f.bank_in)}
    ${row('Salários', f.salaries, true)}${row('Manutenção/juros', f.upkeep, true)}${row('Investimentos', f.investments, true)}${row('Compras de jogadores', f.transfers_out, true)}${row('Parcelas do banco', f.bank_paid, true)}
    <tr><td><b>Saldo da rodada</b></td><td style="text-align:right"><b style="color:${income - costs >= 0 ? '#060' : '#a00'}">${money(income - costs)}</b></td></tr>
  </table>` });
}
function setStatus() {
  const m = st.managed;
  if (!m) { $('#btnPlay').onclick = () => render(); $('#btnPlay').textContent = '▶ Continuar'; return; }
  setBar(`${m.name} | Divisão ${m.division + 1} | Temporada ${st.season} | Rodada ${Math.min(st.round + 1, st.rounds)}/${st.rounds} | ${windowLabel(st.market)} | Caixa: ${money(m.budget)}`);
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
    ${windowBanner(st.market)}
    <div class="mkbtns"><button id="mkOffers">📨 Propostas recebidas (${st.market.offers.length})</button> <button id="mkTransfers">📋 Transferências</button></div>
    ${auctionHtml(st.market)}
    <div class="list"><table><tr><th>Pos</th><th>Nome</th><th>Hab.</th><th>Idade</th><th>Salário/rod.</th><th>Valor</th><th>Clube</th><th>Preço</th><th></th></tr>
    ${list.map((p) => `<tr>${playerRow(p, `<td>${teamLink(p.team, p.teamName)}</td>
<td>${money(p.buyPrice)}</td><td>${p.team === null ? `<button data-buy="${p.id}">Contratar</button>` : `<button data-neg="${p.id}" ${st.market.open ? '' : 'disabled title="Janela fechada"'}>Negociar</button>`}${p.team !== null ? ` <button data-loanin="${p.id}">Empréstimo (${money(p.loanFee)})</button>` : ''}</td>`)}</tr>`).join('')}
    </table></div><small>Jogadores sem clube custam 20% do valor (luvas) e podem ser contratados a qualquer momento; de outros clubes, só com a janela aberta e por negociação (preço pedido: 110% do valor). Empréstimo: 10% do valor até o fim da temporada (você paga o salário).</small>`;
  $('#mgo').onclick = () => { mkPos = $('#mpos').value; mkMax = $('#mmax').value; renderMarket(); };
  document.querySelectorAll('[data-loanin]').forEach((b) => b.onclick = () => { flash(JSON.parse(game.loan_in(+b.dataset.loanin))); refresh(); });
  document.querySelectorAll('[data-buy]').forEach((b) => b.onclick = () => { flash(JSON.parse(game.buy(+b.dataset.buy))); refresh(); });
  document.querySelectorAll('[data-neg]').forEach((b) => b.onclick = () => openNegotiation(list.find((p) => p.id === +b.dataset.neg), st, mctx));
  $('#mkOffers').onclick = () => openOffers(st, mctx);
  $('#mkTransfers').onclick = () => openTransfers(st);
  const bid = $('#bidGo'); if (bid) bid.onclick = () => { flash(JSON.parse(game.bid_auction(+$('#bidAmt').value))); refresh(); };
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
gameVersion = FutManager.version();
initDesktop(gameVersion);
await initStorage();
showStart();

// Autoteste opcional: abra index.html?selftest para validar o motor no navegador.
if (location.search.includes('selftest')) (async () => {
  const out = [];
  pitchForceOff = true; // o campinho segura o relógio nos lances; é testado na seção própria
  try {
    $('#btnNew').click();
    document.querySelector('#teamList button').click();
    out.push('time=' + st.managed.name);
    // janela principal: arrastar, minimizar/restaurar, maximizar/restaurar, posição salva
    {
      const app = $('#app'), bar = app.querySelector('.titlebar');
      const x0 = app.offsetLeft, y0 = app.offsetTop;
      const pe = (type, x, y) => bar.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true }));
      pe('pointerdown', 300, 10); pe('pointermove', 340, 60); pe('pointerup', 340, 60);
      if (app.offsetLeft !== x0 + 40 || app.offsetTop !== y0 + 50) throw `arrastar janela principal (${x0},${y0})->(${app.offsetLeft},${app.offsetTop})`;
      const saved = JSON.parse(localStorage.getItem('futmanager98_main_win'));
      if (saved.x !== app.offsetLeft || saved.y !== app.offsetTop) throw 'posição não salva';
      if (!app.querySelector('.tbtn-min svg') || !app.querySelector('.tbtn-max svg') || !app.querySelector('.tbtn-close svg')) throw 'botões de título';
      app.querySelector('.wm-min').click();
      if (!app.classList.contains('wm-min-state')) throw 'minimizar janela principal';
      document.querySelector('#taskbar .tb-start').click();
      if (app.classList.contains('wm-min-state')) throw 'restaurar janela principal';
      app.querySelector('.wm-max').click();
      if (!app.classList.contains('wm-maxed') || !app.querySelector('.tbtn-restore')) throw 'maximizar';
      app.querySelector('.tbtn-restore').click();
      if (app.classList.contains('wm-maxed') || !app.querySelector('.tbtn-max')) throw 'restaurar tamanho';
      pe('pointerdown', 340, 60); pe('pointermove', 340 - 40, 10); pe('pointerup', 300, 10);
      if (app.offsetLeft !== x0 || app.offsetTop !== y0) throw 'voltar posição';
      if ([...document.querySelectorAll('.titlebar button')].some((b) => !b.classList.contains('tbtn'))) throw 'botão de título fora do padrão';
      out.push('janela_principal=ok');
      // área de trabalho: ícone Sobre (clique seleciona, duplo clique abre)
      const ic = $('#icon-sobre');
      ic.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      if (!ic.classList.contains('sel') || $('#sobre')) throw 'clique simples no ícone';
      ic.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      const ab = $('#sobre');
      if (!ab || !ab.textContent.includes('Felipe Rezende e Grok Bot') || !ab.textContent.includes('Versão ' + gameVersion) || !/^\d+\.\d+\.\d+/.test(gameVersion)) throw 'janela Sobre';
      if (ab.querySelector('a').href !== 'https://github.com/feliperezende/futmanager-wasm') throw 'link do repositório';
      if (!document.querySelector('#taskbar [data-wkey="sobre"]')) throw 'Sobre na barra de tarefas';
      if ($('#desktop').getBoundingClientRect().right > app.getBoundingClientRect().left) throw 'janela principal cobre os ícones';
      $('#aboutOk').click();
      if ($('#sobre')) throw 'OK não fechou o Sobre';
      app.querySelector('.wm-min').click();
      $('#icon-futmanager').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      if (app.classList.contains('wm-min-state')) throw 'ícone FutManager não restaurou';
      out.push('sobre=ok');
    }

    // UI da rodada: pausa no intervalo (Normal) e 2º tempo automático (Rápido)
    const wait = async (cond, ms) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 50)); } return true; };
    setSpeed('normal');
    tab = 'jogos'; render();
    if ($('#speed').value !== 'normal') throw 'velocidade não persistida';
    // pré-jogo: escalação provável do adversário
    const boxes = document.querySelectorAll('#pre-jogo .xi-box');
    if (boxes.length !== 2 || !boxes[1].textContent.includes('Próximo adversário')) throw 'pré-jogo do adversário';
    if (boxes[1].querySelectorAll('tr').length !== 12) throw 'XI provável do adversário';
    if (!boxes[1].querySelector('.form') && !boxes[1].textContent.includes('Forma')) throw 'forma do adversário';
    boxes[1].querySelector('.tlink').click();
    if (!$('.wm-team')) throw 'ficha do adversário';
    const nSquad = document.querySelectorAll('.wm-team .sortable tr').length - 1;
    if (nSquad < 16) throw 'elenco na ficha: ' + nSquad;
    document.querySelector('.wm-team [data-sort="skill"]').click();
    const sk = [...document.querySelectorAll('.wm-team .sortable tr')].slice(1).map((r) => +r.children[2].textContent);
    if (sk.some((v, i) => i && v > sk[i - 1])) throw 'ordenação por habilidade';
    if (!document.querySelector('.wm-team [data-tvneg]') || !document.querySelector('.wm-team [data-tvloan]')) throw 'ações de mercado na ficha';
    document.querySelector('.wm-team .plink').click();
    if (!$('.wm-player') || !$('.wm-player').textContent.includes('Finalização')) throw 'cartão do jogador';
    openTeam(st.managed.id);
    if (document.querySelectorAll('.wm-team').length !== 2) throw 'duas fichas abertas';
    const wa = document.querySelectorAll('.wm-team')[0];
    wa.querySelector('.wm-min').click();
    if (!wa.classList.contains('wm-min-state') || !document.querySelector('#taskbar [data-wkey^="team-"]')) throw 'minimizar';
    document.querySelector(`#taskbar [data-wkey="team-${wa.dataset.teamId}"]`).click();
    if (wa.classList.contains('wm-min-state') || !wa.classList.contains('wm-active')) throw 'restaurar';
    closePlayer(); closeTeam();
    if (document.querySelector('.wm-team')) throw 'fechar janelas';
    out.push('adversario=ok');
    out.push('janelas=ok');
    tab = 'times'; render();
    if (document.querySelectorAll('#tab-times .team-card').length !== 16) throw 'aba times';
    $('#teamsDiv').value = '0'; $('#teamsDiv').onchange({ target: $('#teamsDiv') });
    document.querySelectorAll('#tab-times .team-card')[3].click();
    if (!$('.wm-team') || !$('.wm-team').textContent.includes('1ª')) throw 'ficha pela aba times';
    closeTeam();
    tab = 'tabela'; render();
    document.querySelector('#tab-tabela .tlink').click();
    if (!$('.wm-team')) throw 'ficha pela classificação';
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
    if ($('#pre-jogo')) throw 'pré-jogo deveria sumir durante o jogo';
    out.push('em_campo=ok');

    if (!soundLog.includes('kickoff') || !soundLog.includes('halftime')) throw 'sons de início/intervalo: ' + soundLog;
    {
      const lvx = JSON.parse(game.live());
      const mine = lvx.find((x) => x.home === st.managed.id || x.away === st.managed.id);
      const tl = [...document.querySelectorAll('#ticker div[data-m]')];
      if (tl.some((d) => d.dataset.m !== String(mine.home))) throw 'narração com lance de outro jogo';
      if (tl.length !== mine.events.length) throw `narração ${tl.length} != eventos do meu jogo ${mine.events.length}`;
      const others = lvx.filter((x) => x !== mine).flatMap((x) => x.events.map((e) => e.text));
      const txt = $('#ticker').textContent;
      if (others.some((t) => !mine.events.some((e) => e.text === t) && txt.includes(t))) throw 'texto de outro jogo na narração';
      if (/\[[^\]]+ x [^\]]+\]/.test(txt)) throw 'prefixo de outro jogo na narração';
      const sounds = soundLog.filter((k) => ['gol', 'cartao', 'vermelho', 'penalti', 'penalti_perdido'].includes(k)).length;
      const expect = mine.events.filter((e) => ['gol', 'cartao', 'vermelho', 'penalti', 'penalti_perdido'].includes(e.kind)).length;
      if (sounds !== expect) throw `sons de lances (${sounds}) != lances do meu jogo (${expect})`;
      out.push('narracao=ok');
    }

    $('#btnHalf').click();
    if (!(await wait(() => !playing, 15000))) throw 'partida não terminou';
    if (!soundLog.includes('secondhalf') || soundLog[soundLog.length - 1] !== 'final') throw 'sons de 2º tempo/final: ' + soundLog;
    if (!$('#sndOn').checked) throw 'som deveria vir ligado por padrão';
    $('#sndVol').value = '35'; $('#sndVol').oninput({ target: $('#sndVol') });
    if (getVolume() !== 0.35) throw 'volume';
    out.push('sons=ok');
    if (!($('#financas-rodada')?.textContent || '').includes('Saldo da rodada')) throw 'resumo da rodada';
    out.push('intervalo=ok');
    setSpeed('rapido');
    $('#btnPlay').click(); // volta à tela da rodada
    if ($('#speed').value !== 'rapido') throw 'velocidade';
    const t0 = Date.now();
    soundLog.length = 0;
    $('#btnPlay').click();
    if (!(await wait(() => !playing, 8000))) throw 'rápido não terminou (parou no intervalo?)';
    if (soundLog.some((k) => k !== 'gol' && k !== 'final') || !soundLog.includes('final')) throw 'sons no modo rápido: ' + soundLog;

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
    {
      const ms = JSON.parse(game.state());
      if (!ms.market || !/Mercado (aberto|fechado)/.test($('#status').textContent)) throw 'mercado: status sem janela';
      const other = mk.find((p) => p.team !== null && p.team !== ms.managed.id);
      if (ms.market.open) {
        const r1 = JSON.parse(game.negotiate(other.id, 1000));
        if (!['rejected', 'refused'].includes(r1.status)) throw 'mercado: proposta baixa aceita ' + r1.msg;
        // UI de negociação
        openNegotiation(other, ms, mctx);
        $('#negAmt').value = 2000; $('#negGo').click();
        if (!/recus|encerrou/.test($('#negMsg').textContent)) throw 'mercado: janela de negociação';
        closeWindow('negociar');
        // contraproposta / acordo: sobe a oferta até o clube responder
        let got = null;
        const seen = [];
        for (const p of JSON.parse(game.market('', ms.managed.budget)).filter((p) => p.team !== null && p.team !== ms.managed.id).reverse().slice(0, 40)) {
          const r = JSON.parse(game.negotiate(p.id, Math.round(p.buyPrice * 0.9)));
          seen.push(r.status || r.msg);
          if (r.status === 'counter' || r.status === 'accepted') { got = r; break; }
        }
        if (!got) throw 'mercado: nenhuma contraproposta ' + seen.slice(0, 5);
      } else if (JSON.parse(game.negotiate(other.id, 1e6)).ok) throw 'mercado: compra com janela fechada';
      // nenhum caminho compra direto de outro clube
      const dr = JSON.parse(game.buy(other.id));
      if (dr.ok || !/negocia|fechada/.test(dr.msg)) throw 'mercado: compra direta sem negociação ' + dr.msg;
      openTeam(other.team);
      const tw = document.querySelector('[id^="team-' + other.team + '"]') || document;
      if (tw.querySelector('[data-tvbuy]') || !tw.querySelector('[data-tvneg]')) throw 'mercado: ficha do clube sem negociação';
      if (ms.market.open) { tw.querySelector('[data-tvneg]').click(); if (!getWindow('negociar')) throw 'mercado: ficha não abriu negociação'; closeWindow('negociar'); }
      closeTeam();
      openPlayer(other.id);
      if (document.querySelector('#pcBuy') || !document.querySelector('#pcNeg')) throw 'mercado: cartão do jogador sem negociação';
      closePlayer();
      tab = 'mercado'; refresh();
      if (!$('.mkbanner') || !$('#mkOffers')) throw 'mercado: aba sem janela/propostas';
      $('#mkOffers').click();
      if (!getWindow('propostas')) throw 'mercado: janela de propostas';
      closeWindow('propostas');
      $('#mkTransfers').click();
      if (!getWindow('transferencias')) throw 'mercado: transferências';
      closeWindow('transferencias');
      tab = 'clube'; refresh();
      out.push('mercado_vivo=ok');
    }
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
    // Copa Nacional: dia de Copa no meio da semana, sorteio, chaveamento e pênaltis animados
    {
      let guard = 0;
      while (JSON.parse(game.state()).dayType !== 'cup' && guard++ < 30) game.play_round();
      refresh(); closeWindow('sorteio'); tab = 'jogos'; render();
      const cs = st;
      if (!$('#nextLabel').textContent.includes('COPA NACIONAL')) throw 'rótulo do dia de Copa';
      if (document.querySelectorAll('#scoreboard tr').length - 1 !== cs.cup.ties[cs.cup.round].length) throw 'jogos da Copa no placar';
      const cr = cs.cup.round, lr = cs.round;
      setSpeed('rapido');
      $('#btnPlay').click();
      if (!(await wait(() => !playing, 15000))) throw 'dia de Copa não terminou';
      const s3 = JSON.parse(game.state());
      if (s3.cup.round !== cr + 1 || s3.round !== lr) throw 'avanço da Copa';
      if (s3.cup.ties[cr].some((t) => !t.played || t.winner === null)) throw 'confrontos sem vencedor';
      if (!(await wait(() => !!$('#sorteio'), 3000))) throw 'janela do sorteio';
      if (document.querySelectorAll('#sorteio .draw-row').length !== s3.cup.ties[cr + 1].length) throw 'sorteio incompleto';
      $('#drawOk').click();
      if (JSON.parse(game.state()).cup.drawPending) throw 'sorteio não confirmado';
      document.querySelector('.menubar [data-tab=copa]').click();
      if (document.querySelectorAll('#copa .cupcol').length !== 6 || document.querySelectorAll('#copa .cuptie').length !== 32 + 16 + 8 + (cr >= 2 ? 4 : 0)) throw 'chaveamento da Copa';
      closeWindow('copa');
      // disputa por pênaltis revelada cobrança a cobrança, com sons
      const evs = [{ kind: 'disputa_inicio', text: 'x', minute: 120 }, { kind: 'disputa_gol', text: 'a', minute: 120 }, { kind: 'disputa_perdido', text: 'b', minute: 120 }, { kind: 'disputa_fim', text: 'c', minute: 120 }];
      soundLog.length = 0;
      const shown = [];
      await new Promise((res) => animateShootout(evs, (n) => shown.push(n), 'normal', res));
      if (shown.join(',') !== '1,2,3,4' || !soundLog.includes('disputa_gol') || !soundLog.includes('disputa_perdido') || !soundLog.includes('penalti')) throw 'animação dos pênaltis: ' + shown + ' / ' + soundLog;
      setSpeed('normal');
      out.push('copa=ok');
    {
      // campinho animado
      closeWhere(() => true);
      while (JSON.parse(game.state()).dayType === 'cup') { game.start_round(); game.finish_round(); }
      pitchForceOff = false; localStorage.setItem('futmanager98_pref_pitch', '1'); pitchMin = false;
      setSpeed('normal'); tab = 'jogos'; refresh(); closeWhere(() => true);
      if (!$('#pitchWin') || $('#pitchWin').classList.contains('hidden') || !$('#pitchOn').checked) throw 'campinho: painel ausente';
      $('#btnPlay').click();
      await new Promise((r) => setTimeout(r, 1200));
      const px = $('#pitchCv').getContext('2d').getImageData(150, 100, 20, 20).data;
      if (pitch.debug().frames < 5 || !px.some((v, i) => i % 4 === 1 && v > 100)) throw 'campinho: não desenhou';
      const real = JSON.parse(game.live()).find((x) => x.home === st.managed.id || x.away === st.managed.id);
      if (!real.colors || !real.strength) throw 'campinho: sem cores/força';
      // reage a um gol: animação segura o relógio e o som sai quando a bola entra
      const cv2 = document.createElement('canvas'); cv2.width = 320; cv2.height = 200;
      const tp = createPitch(cv2, { sfx, getSpeed });
      tp.setActive(true);
      const fake = { ...real, minute: 10, events: [], hg: 0, ag: 0, over: false, pens: null };
      tp.update(fake, {});
      await new Promise((r) => setTimeout(r, 1100));
      soundLog.length = 0;
      tp.update({ ...fake, minute: 11, hg: 1, events: [{ minute: 11, side: 0, kind: 'gol', text: 'GOOOL! ' + real.on[0][9].name }] }, {});
      if (!tp.busy()) throw 'campinho: gol não segurou o relógio';
      if (!(await wait(() => tp.debug().goals === 1, 5000))) throw 'campinho: bola não entrou';
      if (!soundLog.includes('gol')) throw 'campinho: som do gol';
      if (!(await wait(() => !tp.busy(), 5000))) throw 'campinho: animação não terminou';
      // disputa por pênaltis cobrança a cobrança
      const kicks = [{ kind: 'disputa_inicio', side: 0, text: 'x' }, { kind: 'disputa_gol', side: 0, text: real.on[0][10].name + ' converte' }, { kind: 'disputa_perdido', side: 1, text: real.on[1][10].name + ' chuta para fora' },
        { kind: 'disputa_gol', side: 0, text: 'y converte' }, { kind: 'disputa_fim', side: 0, text: 'fim' }];
      const sm = { ...fake, minute: 120, over: true, pens: [2, 0], events: kicks.map((k) => ({ minute: 120, ...k })) };
      for (let n = 1; n <= kicks.length; n++) { tp.update(sm, { shootout: true, shootReveal: n }); await new Promise((r) => setTimeout(r, 120)); }
      if (!(await wait(() => tp.debug().kicks === 3 && !tp.busy(), 6000)) || tp.debug().pens.join() !== '2,0') throw 'campinho: disputa ' + JSON.stringify(tp.debug());
      tp.setActive(false);
      // Rápido: campinho oculto e sem segurar o relógio
      $('#speed').value = 'rapido'; $('#speed').onchange({ target: { value: 'rapido' } });
      if (!$('#pitchWin').classList.contains('min') || pitch.debug().active || pitch.busy()) throw 'campinho: visível no Rápido';
      if (halftime) startSecondHalf();
      if (!(await wait(() => !playing, 15000))) throw 'campinho: rodada no Rápido não terminou';
      // preferência persistida
      $('#pitchOn').checked = false; $('#pitchOn').onchange({ target: $('#pitchOn') });
      if (localStorage.getItem('futmanager98_pref_pitch') !== '0') throw 'campinho: preferência';
      localStorage.setItem('futmanager98_pref_pitch', '1');
      setSpeed('normal'); pitchForceOff = true;
      out.push('campinho=ok');
    }
    {
      closeWindow('jornal');
      game.play_round(); refresh();
      if (!getWindow('jornal')) throw 'jornal: não abriu após a rodada';
      const jw = getWindow('jornal');
      const q = (sel) => jw.body ? jw.body.querySelector(sel) : document.querySelector('#jornal ' + sel);
      if (!/O Placar Diário/.test(q('.jn-mast').textContent)) throw 'jornal: cabeçalho';
      if (!q('.jn-head h2').textContent.trim()) throw 'jornal: manchete vazia';
      if (!q('.jn-box')) throw 'jornal: humor/rumores';
      const e = JSON.parse(game.journal(0));
      if (e.archive.length < 3) throw 'jornal: arquivo curto ' + e.archive.length;
      if (e.rumors.some((r) => 'truth' in r)) throw 'jornal: rumor revela a verdade';
      if (JSON.parse(game.state()).journal.unseen) throw 'jornal: não marcou como lido';
      q('#jnPrev').click();
      const prev = getWindow('jornal');
      if (!(prev.body || document).querySelector('.jn-mast').textContent.includes('Nº ' + (e.number - 1))) throw 'jornal: arquivo/anterior';
      closeWindow('jornal');
      document.querySelector('.menubar [data-tab=jornal]').click();
      if (!getWindow('jornal')) throw 'jornal: aba Jornal';
      closeWindow('jornal');
      out.push('jornal=ok');
    }
    }
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
    if (!(await wait(() => !!$('#finale'), 10000))) throw 'encerramento não abriu';
    const seen = [];
    for (let k = 0; k < 10 && !!$('#finale'); k++) {
      seen.push($('#finale').dataset.page);
      if (k === 0 && !$('#finale').textContent.includes('Copa Nacional')) throw 'campeão da Copa no encerramento';
      if (k === 1) { $('#finPrev').click(); if ($('#finale').dataset.page !== seen[0]) throw 'anterior'; $('#finNext').click(); }
      $('#finNext').click();
    }
    if (seen.join(',') !== 'campeao,acesso,premios,temporada,proxima') throw 'páginas do encerramento: ' + seen;
    const s2 = JSON.parse(game.state());
    if (s2.reportPending) throw 'encerramento não confirmado';
    if (s2.history.length !== 1 || s2.history[0].champions.length !== 4) throw 'histórico';
    out.push('encerramento=' + seen.length + 'p');
    openHistory();
    if (!$('#historico').textContent.includes('🏆 Copa') || !s2.history[0].cupWinner) throw 'Copa no histórico';
    if (!$('#historico').textContent
.includes('Galeria de campeões')) throw 'aba histórico';
    $('#btnReopen').click();
    if (!$('#finale')) throw 'rever encerramento';
    $('#finSkipBtn').click();
    if (!!$('#finale')) throw 'pular';
    out.push('historico=ok');
    setSpeed('normal');
    out.push('temporada=' + s2.season);
    out.push('SELFTEST_OK');
  } catch (e) { out.push('SELFTEST_FAIL ' + e); }
  document.body.insertAdjacentHTML('beforeend', `<pre id="selftest">${out.join(' | ')}</pre>`);
})();

// Demonstração da Copa: index.html?copa vai ao 1º dia de Copa com um clube cujo jogo terá pênaltis.
if (location.search.includes('copa')) {
  $('#btnNew').click();
  document.querySelector('#teamList button').click();
  game.play_round(); game.play_round();
  const snap = game.save();
  game.start_round();
  const lv = JSON.parse(game.step(200));
  const t = lv.find((x) => x.pens) || lv.find((x) => x.et) || lv[0];
  const pick = t.home;
  game = FutManager.load(snap);
  game.choose_team(pick);
  closeWhere(() => true);
  refresh(); tab = 'jogos'; render();
}
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
// Demonstração do mercado: index.html?mercado avança até haver propostas e um leilão (janela aberta).
if (location.search.includes('mercado')) {
  $('#btnNew').click();
  document.querySelector('#teamList button').click();
  const snap = game.save();
  for (let i = 0; i < 40; i++) {
    game = FutManager.load(snap); game.choose_team(JSON.parse(game.state()).teams[i].id);
    let ok = false;
    for (let r = 0; r < 3 && !ok; r++) { game.play_round(); const m = JSON.parse(game.state()).market; ok = m.open && m.offers.length > 0 && !!m.auction; }
    if (ok) break;
  }
  closeWhere(() => true);
  mkMax = '4000000';
  tab = 'mercado'; refresh();
}
// Demonstração do jornal: index.html?jornal joga 8 rodadas e abre a última edição.
if (location.search.includes('jornal')) {
  $('#btnNew').click();
  document.querySelector('#teamList button').click();
  for (let i = 0; i < 8; i++) game.play_round();
  closeWhere(() => true);
  tab = 'clube'; refresh();
}
// Demonstração do campinho: index.html?campinho começa uma rodada ao vivo com o campinho visível.
if (location.search.includes('campinho')) {
  $('#btnNew').click();
  document.querySelector('#teamList button').click();
  localStorage.setItem('futmanager98_pref_pitch', '1'); setSpeed('normal');
  closeWhere(() => true);
  tab = 'jogos'; refresh(); closeWhere(() => true);
  if (!location.search.includes('wait')) $('#btnPlay').click();
}
window.__pitch = () => pitch;
