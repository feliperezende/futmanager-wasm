// Jornal da rodada: "O Placar Diário", com arquivo de edições anteriores.
import { openWindow } from './wm.js';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TAG = { goleada: 'GOLEADA', zebra: 'ZEBRA', hattrick: 'ARTILHARIA', penalti: 'PÊNALTI', vermelho: 'CARTÃO VERMELHO', tabela: 'TABELA',
  copa: 'COPA NACIONAL', transferencia: 'MERCADO', demissao: 'BASTIDORES', seu_jogo: 'SEU CLUBE', geral: 'RODADA', humor: 'ARQUIBANCADA' };

/** Abre o jornal; getEdition(n) devolve o JSON da edição n (0 = mais recente). */
export function openJornal(getEdition, number = 0) {
  const e = getEdition(number);
  if (!e) return null;
  const art = (a) => `<article class="jn-art"><div class="jn-tag">${TAG[a.kind] || 'NOTÍCIA'}</div><h3>${esc(a.title)}</h3><p>${esc(a.text)}</p></article>`;
  const w = openWindow({ key: 'jornal', id: 'jornal', title: `${e.paper} — edição nº ${e.number}`, width: 820, className: 'jornal-win',
    html: `<div class="jn-tools">Arquivo: <select id="jnArchive">${e.archive.map((x) => `<option value="${x.number}" ${x.number === e.number ? 'selected' : ''}>Nº ${x.number} · T${x.season} · ${esc(x.label)}</option>`).join('')}</select>
      <button id="jnPrev" ${e.archive.some((x) => x.number < e.number) ? '' : 'disabled'}>◀ Anterior</button> <button id="jnNext" ${e.archive.some((x) => x.number > e.number) ? '' : 'disabled'}>Próxima ▶</button></div>
    <div class="jornal">
      <div class="jn-mast"><div class="jn-ears"><span>Nº ${e.number}</span><span>Temporada ${e.season}</span></div><h1>${esc(e.paper)}</h1>
        <div class="jn-sub">O jornal de quem vive o futebol · ${esc(e.label)} · R$ 1,50</div></div>
      <div class="jn-head"><div class="jn-tag">${TAG[e.headline.kind] || 'MANCHETE'}</div><h2>${esc(e.headline.title)}</h2><p class="jn-lead">${esc(e.headline.text)}</p></div>
      <div class="jn-body"><div class="jn-cols">${e.articles.map(art).join('') || '<p>Sem mais notícias.</p>'}</div>
        <aside class="jn-side">${e.mood && e.mood.title ? `<div class="jn-box"><div class="jn-tag">ARQUIBANCADA</div><h3>${esc(e.mood.title)}</h3><p>${esc(e.mood.text)}</p></div>` : ''}
          <div class="jn-box jn-rumor"><div class="jn-tag">DIZEM POR AÍ…</div>${e.rumors.map((r) => `<h4>${esc(r.title)}</h4><p>${esc(r.text)}</p>`).join('') || '<p>Semana calma nos bastidores.</p>'}
          <small>Rumores não confirmados. Alguns são verdade.</small></div></aside></div>
    </div>` });
  const go = (n) => openJornal(getEdition, n);
  w.body.querySelector('#jnArchive').onchange = (ev) => go(+ev.target.value);
  const nums = e.archive.map((x) => x.number);
  w.body.querySelector('#jnPrev').onclick = () => { const p = nums.filter((x) => x < e.number); if (p.length) go(Math.max(...p)); };
  w.body.querySelector('#jnNext').onclick = () => { const p = nums.filter((x) => x > e.number); if (p.length) go(Math.min(...p)); };
  return w;
}
