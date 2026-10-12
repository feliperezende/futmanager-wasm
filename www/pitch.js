// Campinho animado: visualiza, em pixel art estilo 1998, a partida AO VIVO do usuário.
// Não é simulação física: segue os eventos do motor minuto a minuto (gol, chance, cartões, pênaltis, lesões,
// prorrogação, disputa por pênaltis) e a força de ataque/defesa de cada time para a posse de bola.
const W = 320, H = 200, TOP = 18;
const PX = { l: 8, r: 312, t: TOP + 6, b: H - 6 };
const MIDX = 160, MIDY = (PX.t + PX.b) / 2, LEN = PX.r - PX.l;
const C = { line: '#e8f8e8', black: '#000', white: '#fff', yel: '#ffe000', red: '#e01818', skin: '#f0b080', ref: '#101010',
  board: '#101018', led: '#ffb000', crowd1: '#504860', crowd2: '#706080', net: '#d0d0d0', gk: ['#30d0a0', '#f09020'] };
const lerp = (a, b, k) => a + (b - a) * k, clamp = (v, a, b) => Math.max(a, Math.min(b, v)), ease = (k) => k * k * (3 - 2 * k);

// ---------------------------------------------------------------- fonte de pixels 3x5
const F = {A:'010101111101101',B:'110101110101110',C:'011100100100011',D:'110101101101110',E:'111100110100111',F:'111100110100100',G:'011100101101011',
H:'101101111101101',I:'111010010010111',J:'001001001101010',K:'101101110101101',L:'100100100100111',M:'101111111101101',N:'110101101101101',O:'010101101101010',
P:'110101110100100',Q:'010101101011001',R:'110101110101101',S:'011100010001110',T:'111010010010010',U:'101101101101111',V:'101101101101010',W:'101101111111101',
X:'101101010101101',Y:'101101010010010',Z:'111001010100111','0':'111101101101111','1':'010110010010111','2':'110001010100111','3':'110001010001110',
'4':'101101111001001','5':'111100110001110','6':'011100111101111','7':'111001010010010','8':'111101111101111','9':'111101111001110',
':':'000010000010000','!':'010010010000010',"'":'010010000000000','-':'000000111000000','.':'000000000000010','(':'010100100100010',')':'010001001001010',' ':'000000000000000'};
const plain = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const textW = (s, sc = 1) => plain(s).length * 4 * sc - sc;
function shortName(name) {
  const w = plain(name).split(' ').filter((x) => !['ESPORTE', 'CLUBE', 'ATLETICO', 'UNIAO', 'SPORT', 'ASSOCIACAO', 'REAL', 'RECREATIVO', 'DO', 'DA'].includes(x));
  return (w[0] || plain(name)).slice(0, 4);
}

export function createPitch(canvas, opts) {
  const cx = canvas.getContext('2d');
  const { sfx, getSpeed } = opts;
  // gramado pré-renderizado com listras em dithering
  const grass = document.createElement('canvas'); grass.width = W; grass.height = H;
  {
    const g = grass.getContext('2d'), id = g.createImageData(W, H), c1 = [0x2f, 0x8f, 0x2f], c2 = [0x3a, 0xa6, 0x3a];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const s = (x - PX.l) / 19, f = s - Math.floor(s);
      let a = Math.floor(s) % 2 === 0;
      if (f < 0.12 || f > 0.88) a = (x + y) % 2 === 0 ? a : !a;
      const c = a ? c1 : c2, o = (y * W + x) * 4;
      id.data[o] = c[0]; id.data[o + 1] = c[1]; id.data[o + 2] = c[2]; id.data[o + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    g.fillStyle = C.line;
    const R = (x, y, w, h) => { g.fillRect(x, y, w, 1); g.fillRect(x, y + h, w + 1, 1); g.fillRect(x, y, 1, h); g.fillRect(x + w, y, 1, h); };
    R(PX.l, PX.t, LEN, PX.b - PX.t); g.fillRect(MIDX, PX.t, 1, PX.b - PX.t);
    for (let a = 0; a < 64; a++) g.fillRect(Math.round(MIDX + 20 * Math.cos(a / 64 * 6.283)), Math.round(MIDY + 20 * Math.sin(a / 64 * 6.283)), 1, 1);
    R(PX.l, MIDY - 40, 44, 80); R(PX.r - 44, MIDY - 40, 44, 80); R(PX.l, MIDY - 18, 14, 36); R(PX.r - 14, MIDY - 18, 14, 36);
    g.fillRect(PX.l + 30, MIDY, 1, 1); g.fillRect(PX.r - 30, MIDY, 1, 1); g.fillRect(MIDX, MIDY, 1, 1);
  }
  const text = (s, x, y, col, sc = 1) => {
    cx.fillStyle = col;
    for (const ch of plain(s)) { const g = F[ch] || F[' ']; for (let i = 0; i < 15; i++) if (g[i] === '1') cx.fillRect(x + (i % 3) * sc, y + Math.floor(i / 3) * sc, sc, sc); x += 4 * sc; }
  };

  // ---------------------------------------------------------------- estado
  let m = null, ctxInfo = {}, seen = 0, kicksSeen = 0, minute = 0;
  let queue = [], anim = null, banners = [], raf = 0, last = 0, clock = 0, active = false;
  let poss = 0, prog = 0, ballY = MIDY, phase = 'kickoff', phaseT = 0, kickSide = 0;
  const ball = { x: MIDX, y: MIDY, z: 0 }, pos = new Map(), ghosts = new Map();
  const stats = { frames: 0, goals: 0, kicks: 0, goalSounds: 0, anims: [] };
  let shake = [0, 0], postFlash = 0, crowdFlash = 0, pens = [0, 0];

  const half = () => (minute > 105 ? 4 : minute > 90 ? 3 : minute > 45 || (ctxInfo.halftimeDone && minute >= 45) ? 2 : 1);
  // mandante ataca para a direita no 1º tempo (e no 1º tempo da prorrogação); disputa por pênaltis: gol da direita
  const dir = (side) => (ctxInfo.shootout ? 1 : ((side === 0) === (half() % 2 === 1) ? 1 : -1));
  const goalX = (side) => (dir(side) === 1 ? PX.r : PX.l);
  const scale = () => (getSpeed() === 'lento' ? 1.4 : 1);

  function lineups() {
    if (!m) return [[], []];
    return [0, 1].map((s) => (m.on[s] || []).map((p) => ({ id: p.id, pos: p.pos, name: p.name })));
  }
  // posição-alvo de cada jogador: forma do time conforme bola e posse
  function targets() {
    const out = new Map();
    const bfx = (ball.x - PX.l) / LEN;                       // bola em fração do campo (0 = gol esquerdo)
    lineups().forEach((xi, side) => {
      const d = dir(side), toOwn = (f) => (d === 1 ? f : 1 - f); // fração medida a partir do próprio gol
      const bp = toOwn(bfx);                                 // progresso da bola rumo ao gol adversário (0..1)
      const attacking = poss === side;
      const groups = { G: [], D: [], M: [], A: [] };
      xi.forEach((p) => (groups[p.pos] || groups.M).push(p));
      const place = (list, depth, role) => list.forEach((p, i) => {
        const n = list.length, spread = n === 1 ? 0 : (i / (n - 1) - 0.5);
        let f = depth, y = MIDY + spread * (role === 'D' ? 120 : 110);
        if (attacking) {
          // time com a bola sobe junto: meio e ataque acompanham, zaga segura a linha
          const push = Math.max(0, bp - 0.35);
          if (role === 'D') { f += 0.08 + push * 0.45; if (n >= 4 && (i === 0 || i === n - 1) && bp > 0.45) { f += 0.22; y = MIDY + Math.sign(spread) * 66; } } // laterais apoiam
          else if (role === 'M') f += 0.12 + push * 0.6;
          else if (role === 'A') f += 0.10 + push * 0.55;
        } else {
          // sem a bola: recua, compacta e a zaga fica entre a bola e o gol
          const threat = Math.max(0, 0.6 - (1 - bp));        // bola perto do meu gol -> 1-bp pequeno
          if (role === 'D') f = Math.min(f + 0.05 - threat * 0.1, Math.max(0.08, bp - 0.06));
          else if (role === 'M') f -= 0.02 + threat * 0.35;
          else if (role === 'A') f -= threat * 0.45;
          y = lerp(y, ball.y, 0.25);
        }
        if (role !== 'G') y = lerp(y, ball.y, 0.18);
        f = clamp(f, 0.03, 0.95);
        out.set(p.id, [PX.l + LEN * toOwn(f), clamp(y, PX.t + 4, PX.b - 4), side]);
      });
      place(groups.D, 0.2, 'D'); place(groups.M, 0.4, 'M'); place(groups.A, 0.56, 'A');
      groups.G.forEach((p) => out.set(p.id, [goalX(1 - side) === PX.r ? PX.r - 5 : PX.l + 5, clamp(lerp(MIDY, ball.y, 0.35), MIDY - 12, MIDY + 12), side]));
      // goleiro: lado do próprio gol
      groups.G.forEach((p) => { const own = d === 1 ? PX.l + 5 : PX.r - 5; out.get(p.id)[0] = own; });
      // quem disputa a bola
      const field = xi.filter((p) => p.pos !== 'G');
      let best = null, bd = 1e9;
      for (const p of field) { const t = out.get(p.id), dd = (t[0] - ball.x) ** 2 + (t[1] - ball.y) ** 2; if (dd < bd) { bd = dd; best = p; } }
      if (best) { const t = out.get(best.id); t[0] = lerp(t[0], ball.x - d * 3, attacking ? 0.9 : 0.7); t[1] = lerp(t[1], ball.y + 2, attacking ? 0.9 : 0.7); }
    });
    return out;
  }
  function kickoffTargets(side) {
    const out = targets();
    for (const [id, t] of out) {
      const s = t[2], d = dir(s);
      t[0] = d === 1 ? Math.min(t[0] - 30, MIDX - 4) : Math.max(t[0] + 30, MIDX + 4);
      t[0] = clamp(t[0], PX.l + 4, PX.r - 4);
    }
    const xi = lineups()[side], a = xi.find((p) => p.pos === 'A') || xi[xi.length - 1];
    if (a) { const t = out.get(a.id); t[0] = MIDX - dir(side) * 2; t[1] = MIDY; }
    return out;
  }

  // ---------------------------------------------------------------- animações de evento
  const findPlayer = (txt) => {
    for (const [s, xi] of lineups().entries()) for (const p of xi) if (txt.includes(p.name)) return { id: p.id, side: s };
    for (const p of (m.outPlayers || [])) if (txt.includes(p.name)) return { id: p.id, side: p.team === m.home ? 0 : 1 };
    return null;
  };
  function enqueue(e, next) {
    const sc = scale();
    switch (e.kind) {
      case 'gol': queue.push({ kind: 'gol', side: e.side, dur: 2.6 * sc, from: [ball.x, ball.y] }); break;
      case 'chance': queue.push({ kind: 'chance', side: e.side, dur: 1.5 * sc, how: /trave/.test(e.text) ? 'trave' : /defesa/.test(e.text) ? 'defesa' : /cabeceia/.test(e.text) ? 'cima' : 'fora' }); break;
      case 'penalti': { const scored = next && next.kind === 'gol'; if (next) next._consumed = true; queue.push({ kind: 'penalti', side: e.side, kicker: (findPlayer(e.text) || {}).id, dur: 3.2 * sc, scored, how: next && /defende/.test(next.text) ? 'defesa' : 'fora' }); break; }
      case 'penalti_perdido': queue.push({ kind: 'penalti', side: e.side, dur: 3.2 * sc, scored: false, how: /defende/.test(e.text) ? 'defesa' : 'fora' }); break;
      case 'cartao': case 'vermelho': { const p = findPlayer(e.text); if (p) queue.push({ kind: 'cartao', red: e.kind === 'vermelho', who: p, dur: 1.4 * sc }); break; }
      case 'lesao': { const p = findPlayer(e.text); if (p) queue.push({ kind: 'lesao', who: p, dur: 1.6 * sc }); break; }
      case 'prorrogacao': queue.push({ kind: 'banner', msg: 'PRORROGACAO', dur: 1.3 * sc, col: C.led }); break;
      default: break;
    }
  }
  function startAnim(a) {
    anim = { ...a, t: 0 }; stats.anims.push(a.kind); if (stats.anims.length > 50) stats.anims.shift();
    if (a.kind === 'gol' || a.kind === 'chance') { poss = a.side; anim.from = [ball.x, ball.y]; }
    if (a.kind === 'penalti' || a.kind === 'kick') poss = a.side;
    if ((a.kind === 'cartao' || a.kind === 'lesao') && pos.has(a.who.id)) ghosts.set(a.who.id, [...pos.get(a.who.id), a.who.side]);
  }
  function finishAnim() {
    const a = anim; anim = null;
    if (a.kind === 'gol') { phase = 'kickoff'; phaseT = 0; kickSide = 1 - a.side; ball.x = MIDX; ball.y = MIDY; prog = 0; }
    if (a.kind === 'penalti' || a.kind === 'chance') { prog = 0.6 * dir(a.side) * (a.scored ? 0 : 1); if (a.scored) { phase = 'kickoff'; phaseT = 0; kickSide = 1 - a.side; ball.x = MIDX; ball.y = MIDY; prog = 0; } else poss = 1 - a.side; }
    if (a.kind === 'cartao' || a.kind === 'lesao') ghosts.delete(a.who.id);
  }
  function animBall(a, dt) {
    const k = clamp(a.t / a.dur, 0, 1), gx = goalX(a.side), d = dir(a.side);
    if (a.kind === 'gol') {
      if (k < 0.4) { const q = ease(k / 0.4); ball.x = lerp(a.from[0], gx - d * 36, q); ball.y = lerp(a.from[1], MIDY + (a.side ? 10 : -10), q); }
      else if (k < 0.52) { const q = (k - 0.4) / 0.12; ball.x = lerp(gx - d * 36, gx + d * 5, q); ball.y = lerp(MIDY + (a.side ? 10 : -10), MIDY - 3, q); ball.z = Math.sin(q * 3.14) * 3; }
      else { if (!a.hit) { a.hit = true; ball.z = 0; netHit(a.side); } ball.x = gx + d * 5; ball.y = MIDY - 3; }
    } else if (a.kind === 'chance') {
      if (k < 0.55) { const q = ease(k / 0.55); ball.x = lerp(a.from[0], gx - d * 38, q); ball.y = lerp(a.from[1], MIDY + 16, q); }
      else if (k < 0.72) {
        const q = (k - 0.55) / 0.17;
        const ty = a.how === 'trave' ? MIDY + 11 : a.how === 'defesa' ? MIDY + 4 : a.how === 'cima' ? MIDY - 2 : MIDY + 24;
        ball.x = lerp(gx - d * 38, gx - d * (a.how === 'defesa' ? 6 : 0), q); ball.y = lerp(MIDY + 16, ty, q); ball.z = a.how === 'cima' ? Math.sin(q * 3.14) * 6 : q * 2;
        if (q > 0.95 && !a.hit) { a.hit = true; if (a.how === 'trave') { postFlash = 0.5; } }
      } else { const q = (k - 0.72) / 0.28; ball.z = 0; ball.x = lerp(gx - d * (a.how === 'defesa' ? 6 : 0), gx - d * 30, q); ball.y = MIDY + 11 + q * 30; }
    } else if (a.kind === 'penalti' || a.kind === 'kick') {
      const spot = gx - d * 30, ko = a.kind === 'kick' ? 0.25 : 0.55;
      if (k < ko) { ball.x = spot; ball.y = MIDY; }
      else if (k < ko + 0.1) {
        const q = (k - ko) / 0.1, tx = a.scored ? gx + d * 4 : a.how === 'defesa' ? gx - d * 4 : gx + d * 2, ty = a.scored ? MIDY - 6 : a.how === 'defesa' ? MIDY + 5 : MIDY - 16;
        ball.x = lerp(spot, tx, q); ball.y = lerp(MIDY, ty, q);
      } else if (a.scored && !a.hit) { a.hit = true; netHit(a.side, a.kind === 'kick'); }
      else if (!a.scored && a.how === 'defesa' && k > ko + 0.1) { const q = clamp((k - ko - 0.1) / 0.3, 0, 1); ball.x = lerp(gx - d * 4, gx - d * 26, q); ball.y = MIDY + 5 + q * 26; }
    }
  }
  function netHit(side, shootoutKick) {
    shake[goalX(side) === PX.r ? 1 : 0] = 0.8; crowdFlash = 1.2;
    if (!shootoutKick) { stats.goals++; if (sfx('gol', getSpeed())) stats.goalSounds++; banners.push({ msg: 'GOL!', t: 0, dur: 1.4 * scale(), col: C.yel }); }
  }

  // ---------------------------------------------------------------- desenho
  function sprite(x, y, side, isGk, blink) {
    if (blink && Math.floor(clock * 8) % 2) return;
    x = Math.round(x); y = Math.round(y);
    const [c1, c2] = m.colors[side];
    cx.fillStyle = 'rgba(0,0,0,.35)'; cx.fillRect(x - 1, y + 4, 4, 1);
    cx.fillStyle = C.skin; cx.fillRect(x, y - 3, 2, 2);
    cx.fillStyle = isGk ? C.gk[side] : c1; cx.fillRect(x - 1, y - 1, 4, 3);
    if (!isGk) { cx.fillStyle = c2; cx.fillRect(x, y - 1, 2, 1); cx.fillRect(x - 1, y + 2, 4, 1); } // gola e calção na 2ª cor
    cx.fillStyle = C.black; cx.fillRect(x - 1, y + 3, 1, 1); cx.fillRect(x + 2, y + 3, 1, 1);
  }
  function goal(xg, sh) {
    const d = xg < MIDX ? -1 : 1, s = sh > 0 ? Math.round(Math.sin(clock * 40) * 1.5) : 0;
    cx.fillStyle = C.net;
    for (let y = MIDY - 10; y <= MIDY + 10; y += 2) cx.fillRect(xg + (d === 1 ? 1 : -5) + (y % 4 ? s : 0), y, 5, 1);
    for (let x = 0; x <= 5; x += 2) cx.fillRect(xg + d * x + (x % 4 ? s : 0), MIDY - 10, 1, 21);
    cx.fillStyle = C.white; cx.fillRect(xg, MIDY - 11, 1, 23);
  }
  function banner(b) {
    const k = clamp(b.t * 4, 0, 1), sc = 3, w = textW(b.msg, sc), y = Math.round(lerp(-20, 78, ease(k)));
    cx.fillStyle = C.black; cx.fillRect((W - w) / 2 - 6, y - 4, w + 12, 5 * sc + 8);
    cx.fillStyle = b.col; cx.fillRect((W - w) / 2 - 5, y - 3, w + 10, 1); cx.fillRect((W - w) / 2 - 5, y + 5 * sc + 3, w + 10, 1);
    text(b.msg, (W - w) / 2, y, Math.floor(clock * 6) % 3 ? b.col : C.white, sc);
  }
  function draw() {
    stats.frames++;
    cx.drawImage(grass, 0, 0);
    // arquibancada
    for (let x = 0; x < W; x += 2) for (let y = TOP; y < TOP + 5; y++) {
      const on = ((x * 7 + y * 13) % 5 === 0) !== (Math.floor(clock * (crowdFlash > 0 ? 10 : 1.5) + x) % 9 === 0);
      cx.fillStyle = crowdFlash > 0 && on ? (x % 6 ? C.yel : C.white) : on ? C.crowd2 : C.crowd1; cx.fillRect(x, y, 2, 1);
    }
    // placar
    cx.fillStyle = C.board; cx.fillRect(0, 0, W, TOP);
    if (m) {
      text(shortName(m.homeName), 4, 6, C.white); cx.fillStyle = m.colors[0][0]; cx.fillRect(24, 5, 6, 7); cx.fillStyle = m.colors[0][1]; cx.fillRect(26, 5, 2, 7);
      cx.fillStyle = m.colors[1][0]; cx.fillRect(290, 5, 6, 7); cx.fillStyle = m.colors[1][1]; cx.fillRect(292, 5, 2, 7); text(shortName(m.awayName), 300, 6, C.white);
      const sc = `${m.hg}-${m.ag}`; text(sc, (W - textW(sc, 2)) / 2, 4, C.led, 2);
      text(String(minute).padStart(2, '0') + "'", 92, 6, C.led);
      const per = ctxInfo.shootout ? `PEN ${pens[0]}-${pens[1]}` : ctxInfo.halftime ? 'INT' : ['1T', '1T', '2T', 'PR1', 'PR2'][half()];
      text(per, 206, 6, C.led);
    }
    goal(PX.l, shake[0]); goal(PX.r, shake[1]);
    if (postFlash > 0 && Math.floor(clock * 12) % 2 && anim) { const gx = goalX(anim.side); cx.fillStyle = C.yel; cx.fillRect(gx - 1, MIDY + 7, 3, 6); text('TRAVE!', gx === PX.r ? gx - 40 : gx + 10, MIDY + 18, C.yel); }
    // jogadores
    const list = [];
    lineups().forEach((xi, side) => xi.forEach((p) => { const q = pos.get(p.id); if (q) list.push([q[0], q[1], side, p.pos === 'G', p.id]); }));
    for (const [id, g] of ghosts) if (!list.some((x) => x[4] === id)) list.push([g[0], g[1], g[2], false, id]);
    list.sort((a, b) => a[1] - b[1]);
    const hurt = anim && anim.kind === 'lesao' ? anim.who.id : -1;
    for (const p of list) sprite(p[0], p[1], p[2], p[3], p[4] === hurt && anim.t < anim.dur * 0.6);
    // bola
    if (phase !== 'off') { const bx = Math.round(ball.x), by = Math.round(ball.y); cx.fillStyle = 'rgba(0,0,0,.4)'; cx.fillRect(bx, by + 1, 2, 1); cx.fillStyle = C.white; cx.fillRect(bx, by - Math.round(ball.z), 2, 2); }
    // cartão / lesão
    if (anim && (anim.kind === 'cartao' || anim.kind === 'lesao')) {
      const q = pos.get(anim.who.id) || ghosts.get(anim.who.id);
      if (q) {
        const x = Math.round(q[0]), y = Math.round(q[1]);
        if (anim.kind === 'cartao') {
          cx.fillStyle = C.skin; cx.fillRect(x + 7, y - 3, 2, 2); cx.fillStyle = C.ref; cx.fillRect(x + 6, y - 1, 4, 4); cx.fillStyle = C.yel; cx.fillRect(x + 6, y - 1, 4, 1);
          if (anim.t > anim.dur * 0.2) { cx.fillStyle = C.black; cx.fillRect(x + 8, y - 14, 6, 8); cx.fillStyle = anim.red ? C.red : C.yel; cx.fillRect(x + 9, y - 13, 4, 6); }
        } else if (anim.t > anim.dur * 0.3) {
          cx.fillStyle = C.white; cx.fillRect(x - 6, y + 5, 12, 3); cx.fillStyle = C.red; cx.fillRect(x - 1, y - 8, 3, 7); cx.fillRect(x - 3, y - 6, 7, 3);
        }
      }
    }
    for (const b of banners) banner(b);
    if (ctxInfo.halftime && phase === 'off') { cx.fillStyle = 'rgba(0,0,40,.55)'; cx.fillRect(0, TOP, W, H - TOP); }
  }

  // ---------------------------------------------------------------- laço de animação
  function update(dt) {
    clock += dt;
    shake = shake.map((v) => Math.max(0, v - dt)); postFlash = Math.max(0, postFlash - dt); crowdFlash = Math.max(0, crowdFlash - dt);
    banners.forEach((b) => (b.t += dt)); banners = banners.filter((b) => b.t < b.dur);
    if (!anim && queue.length) startAnim(queue.shift());
    let tg;
    if (anim) {
      anim.t += dt; animBall(anim, dt);
      if (anim.kind === 'penalti' || anim.kind === 'kick') tg = penaltyTargets(anim);
      else tg = targets();
      if (anim && anim.t >= anim.dur) finishAnim();
    } else if (phase === 'off') {
      tg = new Map(); lineups().forEach((xi, s) => xi.forEach((p) => tg.set(p.id, [MIDX + (s ? 8 : -8), PX.b + 14, s])));
    } else if (phase === 'kickoff') {
      phaseT += dt; tg = kickoffTargets(kickSide); ball.x = MIDX; ball.y = MIDY; ball.z = 0;
      if (phaseT > 0.9 * scale()) { phase = 'play'; poss = kickSide; }
    } else if (ctxInfo.shootout) {
      tg = penaltyTargets(null);
    } else {
      // posse de bola: deriva para o ataque mais forte
      const tx = MIDX + prog * 135, ty = ballY;
      ball.x += clamp(tx - ball.x, -60 * dt, 60 * dt); ball.y += clamp(ty - ball.y, -40 * dt, 40 * dt); ball.z = 0;
      tg = targets();
    }
    // jogadores caminham até o alvo
    for (const [id, t] of tg) {
      const p = pos.get(id);
      if (!p) { pos.set(id, [t[0], t[1]]); continue; }
      const sp = (phase === 'off' ? 30 : (ctxInfo.shootout || (anim && (anim.kind === 'penalti' || anim.kind === 'kick'))) ? 260 : 70) * dt;
      p[0] += clamp(t[0] - p[0], -sp, sp) + Math.sin(clock * 1.3 + id) * 0.03;
      p[1] += clamp(t[1] - p[1], -sp, sp);
    }
  }
  function penaltyTargets(a) {
    const out = new Map(), side = a ? a.side : 0, gx = goalX(side), d = dir(side), spot = gx - d * 30;
    const k = a ? a.t / a.dur : 0;
    lineups().forEach((xi, s) => xi.forEach((p, i) => {
      if (ctxInfo.shootout) {
        // disputa: todos no círculo central, só o cobrador e o goleiro adversário na área
        let x = MIDX - 18 + (i % 6) * 7, y = MIDY + (s ? 12 : -12) + Math.floor(i / 6) * 5;
        if (a && s === side && p.id === a.kicker) { const run = clamp((k - 0.05) / 0.2, 0, 1); x = spot - d * lerp(14, 3, run); y = MIDY + lerp(5, 1, run); }
        if (p.pos === 'G' && s !== side) { x = gx - d * 3; y = MIDY + (a && k > 0.25 ? (a.scored ? -1 : 1) * clamp((k - 0.25) / 0.1, 0, 1) * 8 : 0); }
        out.set(p.id, [x, y, s]); return;
      }
      let x, y;
      if (p.pos === 'G' && s !== side) { x = gx - d * 3; y = MIDY + (k > 0.55 ? clamp((k - 0.55) / 0.1, 0, 1) * (a && a.scored ? 9 : -6) : 0); }
      else if (p.pos === 'G') { x = goalX(1 - side) - dir(1 - side) * 5; y = MIDY; }
      else if (a && s === side && p.id === a.kicker) { const run = clamp((k - 0.3) / 0.25, 0, 1); x = spot - d * lerp(14, 3, run); y = MIDY + lerp(6, 1, run); }
      else { const j = i + s * 11; x = gx - d * (48 + (j % 3) * 4); y = MIDY - 34 + (j * 7) % 68; }
      out.set(p.id, [x, y, s]);
    }));
    return out;
  }
  function loop(now) {
    raf = 0;
    if (!active || document.hidden) return;
    const dt = Math.min(0.1, (now - (last || now)) / 1000); last = now;
    update(dt); draw();
    raf = requestAnimationFrame(loop);
  }
  function run() { if (active && !document.hidden && !raf) { last = 0; raf = requestAnimationFrame(loop); } }
  document.addEventListener('visibilitychange', run);

  // ---------------------------------------------------------------- API
  return {
    /** Atualiza com a partida do usuário (JSON de live) a cada minuto. */
    update(match, info = {}) {
      if (!match) { m = null; return; }
      const fresh = !m || m.home !== match.home || match.minute < minute;
      m = match; ctxInfo = info; minute = match.minute;
      if (fresh) { seen = 0; kicksSeen = 0; queue = []; anim = null; banners = []; pos.clear(); ghosts.clear(); prog = 0; pens = [0, 0]; phase = 'kickoff'; phaseT = 0; kickSide = 0; poss = 0; }
      // novos eventos do tempo normal/prorrogação
      const evs = match.events.filter((e) => !e.kind.startsWith('disputa'));
      const fast = getSpeed() === 'rapido' || info.skip;
      if (info.skip) { queue = []; anim = null; kicksSeen = 1e9; }
      for (let i = seen; i < evs.length; i++) { if (evs[i]._consumed) continue; if (!fast) enqueue(evs[i], evs[i + 1]); else if (evs[i].kind === 'gol') stats.goals++; }
      seen = evs.length;
      // posse de bola a cada minuto (sem evento): ataque x defesa
      if (!queue.length && !anim && match.strength && minute > 0) {
        const [a0, d0] = match.strength[0], [a1, d1] = match.strength[1];
        const p0 = (a0 / d1) / ((a0 / d1) + (a1 / d0));
        if (Math.random() < 0.35) poss = Math.random() < p0 ? 0 : 1;
        prog = clamp(prog + dir(poss) * (0.1 + Math.random() * 0.25), -0.78, 0.78);
        if (Math.abs(prog) > 0.7 && Math.random() < 0.5) { poss = 1 - poss; }
        ballY = clamp(ballY + (Math.random() - 0.5) * 50, PX.t + 15, PX.b - 15);
      }
      // disputa por pênaltis: cobrança a cobrança, conforme o jogo revela
      if (info.shootout) {
        const kicks = match.events.filter((e) => e.kind.startsWith('disputa')).slice(0, info.shootReveal === Infinity ? 999 : info.shootReveal);
        for (let i = kicksSeen; i < kicks.length; i++) {
          const e = kicks[i];
          if (e.kind === 'disputa_inicio') { banners.push({ msg: 'PENALTIS', t: 0, dur: 1.2, col: C.yel }); phase = 'play'; continue; }
          if (e.kind === 'disputa_fim') { banners.push({ msg: 'FIM', t: 0, dur: 1.5, col: C.led }); continue; }
          const pl = findPlayer(e.text);
          const scored = e.kind === 'disputa_gol';
          if (scored) pens[e.side]++;
          stats.kicks++;
          queue.push({ kind: 'kick', side: e.side, kicker: pl ? pl.id : -1, scored, how: /defende|goleiro/.test(e.text) ? 'defesa' : 'fora', dur: (getSpeed() === 'lento' ? 1.2 : 0.75) });
        }
        kicksSeen = kicks.length;
      }
      if (info.halftime || (match.over && !info.shootout)) {
        if (phase !== 'off') { phase = 'off'; banners.push({ msg: info.halftime ? 'INTERVALO' : 'FIM DE JOGO', t: 0, dur: 99, col: C.led }); }
      } else if (phase === 'off') { phase = 'kickoff'; phaseT = 0; kickSide = 1; banners = []; pos.clear(); }
    },
    /** Liga/desliga o desenho (painel visível, não minimizado). */
    setActive(on) { active = on; if (on) run(); },
    /** Uma animação de lance está em andamento: o relógio da partida espera. */
    busy() { return active && getSpeed() !== 'rapido' && (!!anim || queue.length > 0 || (phase === 'kickoff' && phaseT < 0.9 * scale() && minute > 0)); },
    reset() { m = null; queue = []; anim = null; banners = []; pos.clear(); ghosts.clear(); phase = 'kickoff'; },
    debug() { return { ...stats, anim: anim && anim.kind, queue: queue.length, phase, active, pens: [...pens] }; },
    frameNow() { update(0); draw(); },
  };
}
