// Mercado mais vivo: janelas, propostas recebidas, negociação, leilões e transferências.
import { openWindow, getWindow, closeWindow } from './wm.js';
import { teamLink, playerLink } from './teams.js';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (v) => { const n = Math.round(v); return (n < 0 ? '−' : '') + 'R$ ' + Math.abs(n).toLocaleString('pt-BR'); };

/** Texto curto da janela para a barra de status. */
export function windowLabel(mk) {
  return mk.open ? `Mercado aberto (${mk.name}): fecha em ${mk.roundsLeft} rod.` : `Mercado fechado: abre em ${mk.roundsLeft} rod. (só livres)`;
}

export function windowBanner(mk) {
  return `<div class="mkbanner ${mk.open ? 'open' : 'closed'}">${mk.open
    ? `🟢 <b>Janela de transferências aberta</b> (${esc(mk.name)}) — fecha em <b>${mk.roundsLeft}</b> rodada(s).`
    : `🔴 <b>Janela fechada</b> — só jogadores sem clube. Próxima janela (${esc(mk.name)}) abre em <b>${mk.roundsLeft}</b> rodada(s).`}</div>`;
}

/** Janela de propostas recebidas pelos seus jogadores. ctx = {game, refresh, flash} */
export function openOffers(st, ctx) {
  const mk = st.market;
  const rows = mk.offers.map((o) => `<tr><td class="pos-${o.player.pos}">${o.player.pos}</td><td>${playerLink(o.player.id, o.player.name)}</td><td>${o.player.skill}</td>
    <td>${money(o.player.value)}</td><td>${teamLink(o.club, o.clubName)}</td><td><b>${money(o.amount)}</b></td><td>${o.roundsLeft}</td>
    <td class="nowrap"><button data-oacc="${o.id}">Aceitar</button> <button data-orej="${o.id}">Recusar</button> ${o.countered ? '' : `<button data-octr="${o.id}" data-amt="${o.amount}">Contraproposta</button>`}</td></tr>`).join('');
  const w = openWindow({ key: 'propostas', id: 'propostas', title: `Propostas recebidas (${mk.offers.length})`, width: 760,
    html: `${windowBanner(mk)}${mk.offers.length ? `<div class="list"><table><tr><th>Pos</th><th>Jogador</th><th>Hab.</th><th>Valor</th><th>Clube</th><th>Oferta</th><th>Rod.</th><th></th></tr>${rows}</table></div>
      <small>Contraproposta: uma única tentativa — se pedir demais, o clube desiste. Propostas expiram após 3 rodadas.</small>`
      : '<p>Nenhuma proposta no momento.</p>'}<div id="offmsg" class="small"></div>` });
  const act = (r) => { ctx.flash(r); ctx.refresh(); if (getWindow('propostas')) openOffers(JSON.parse(ctx.game.state()), ctx); const m = w.body.querySelector('#offmsg'); if (m) m.textContent = r.msg; };
  w.body.querySelectorAll('[data-oacc]').forEach((b) => b.onclick = () => act(JSON.parse(ctx.game.accept_offer(+b.dataset.oacc))));
  w.body.querySelectorAll('[data-orej]').forEach((b) => b.onclick = () => act(JSON.parse(ctx.game.reject_offer(+b.dataset.orej))));
  w.body.querySelectorAll('[data-octr]').forEach((b) => b.onclick = () => {
    const v = ctx.ask ? ctx.ask(+b.dataset.amt) : prompt('Quanto você pede (R$)?', String(Math.round(+b.dataset.amt * 1.2)));
    if (v) act(JSON.parse(ctx.game.counter_offer(+b.dataset.octr, +v)));
  });
  ctx.game.ack_offers();
  return w;
}

/** Janela de negociação por um jogador de outro clube. */
export function openNegotiation(p, st, ctx) {
  const neg = st.market.negotiations.find((n) => n.player.id === p.id);
  const w = openWindow({ key: 'negociar', id: 'negociar', title: `Negociação — ${p.name}`, width: 440,
    html: `<fieldset><legend>${esc(p.name)} (${p.pos}, hab. ${p.skill}, ${p.age} anos)</legend>
      Clube: ${teamLink(p.team, p.teamName)}<br>Valor de mercado: <b>${money(p.value)}</b> · Preço pedido: <b>${money(p.buyPrice)}</b><br>
      Seu orçamento: ${money(st.managed.budget)}</fieldset>
      <div class="negrow">Sua proposta (R$): <input id="negAmt" type="number" step="10000" value="${neg ? neg.counter : Math.round(p.buyPrice * 0.85 / 1000) * 1000}"> <button id="negGo">Enviar proposta</button></div>
      <div id="negMsg" class="negmsg">${neg ? `Contraproposta do clube: <b>${money(neg.counter)}</b> <button id="negAcc">Aceitar ${money(neg.counter)}</button>` : 'Faça uma proposta. Clubes podem contrapropor — ou se recusar a vender peças-chave.'}</div>` });
  const bind = () => { const a = w.body.querySelector('#negAcc'); if (a) a.onclick = () => { const r = JSON.parse(ctx.game.accept_counter(p.id)); ctx.flash(r); show(r); ctx.refresh(); }; };
  const show = (r) => {
    const m = w.body.querySelector('#negMsg');
    m.className = 'negmsg ' + (r.status || (r.ok ? 'accepted' : 'rejected'));
    m.innerHTML = esc(r.msg) + (r.status === 'counter' ? ` <button id="negAcc">Aceitar ${money(r.counter)}</button>` : '');
    if (r.status === 'counter') w.body.querySelector('#negAmt').value = r.counter;
    bind();
  };
  w.body.querySelector('#negGo').onclick = () => {
    const r = JSON.parse(ctx.game.negotiate(p.id, +w.body.querySelector('#negAmt').value));
    show(r); ctx.flash(r); if (r.ok) ctx.refresh();
  };
  bind();
  return w;
}

/** Leilão em andamento + últimas transferências (HTML para a aba Mercado). */
export function auctionHtml(mk) {
  if (!mk.auction) return '';
  const a = mk.auction;
  return `<fieldset class="auction"><legend>🔨 Leilão</legend>${teamLink(a.seller, a.sellerName)} leiloa ${playerLink(a.player.id, a.player.name)}
    (${a.player.pos}, hab. ${a.player.skill}, valor ${money(a.player.value)}). Lance mínimo <b>${money(a.minBid)}</b>.
    ${a.userBid ? `Seu lance: <b>${money(a.userBid)}</b>.` : ''} <input id="bidAmt" type="number" step="10000" value="${Math.max(a.minBid, a.userBid + 10000)}"> <button id="bidGo">Dar lance</button>
    <small>Lances fechados: o resultado sai após a próxima rodada.</small></fieldset>`;
}

export function openTransfers(st) {
  const t = st.market.transfers;
  return openWindow({ key: 'transferencias', id: 'transferencias', title: 'Transferências recentes', width: 720,
    html: `<div class="list"><table><tr><th>Temp./Rod.</th><th>Jogador</th><th>De</th><th>Para</th><th>Valor</th></tr>
    ${t.map((x) => `<tr><td>${x.season}/${x.round + 1}</td><td>${playerLink(x.player, x.name)}</td><td>${x.from === null ? 'Sem clube' : teamLink(x.from, x.fromName)}</td><td>${teamLink(x.to, x.toName)}</td><td>${x.kind === 'livre' ? 'livre' : money(x.fee)}</td></tr>`).join('') || '<tr><td colspan="5">Nenhuma ainda.</td></tr>'}</table></div>` });
}
