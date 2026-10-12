// Efeitos sonoros originais sintetizados com WebAudio (sem amostras gravadas): apito, torcida, cartões, pênalti.
const SOUND_KEY = 'futmanager98_pref_sound';
const VOL_KEY = 'futmanager98_pref_volume';
/** Som ligado por padrão para novos jogadores. */
export const soundOn = () => localStorage.getItem(SOUND_KEY) !== '0';
export const setSound = (v) => localStorage.setItem(SOUND_KEY, v ? '1' : '0');
export const getVolume = () => { const v = parseFloat(localStorage.getItem(VOL_KEY)); return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.6; };
export const setVolume = (v) => { localStorage.setItem(VOL_KEY, String(v)); if (master) master.gain.value = curve(v); };
const curve = (v) => 0.5 * v * v;

let ctx = null, master = null, noiseBuf = null;
export const played = []; // registro para o autoteste
function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = curve(getVolume()); master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return ctx;
}
/** Navegadores exigem um gesto do usuário: o áudio é liberado no primeiro clique/tecla. */
export function initSound() {
  const unlock = () => { const c = ac(); if (c && c.state === 'suspended') c.resume(); };
  document.addEventListener('pointerdown', unlock, { capture: true });
  document.addEventListener('keydown', unlock, { capture: true });
}
export const audioState = () => ctx ? ctx.state : 'none';

function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
function tone(t, f, dur, type = 'square', peak = 0.25, slideTo) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  env(g, t, 0.01, peak, dur); o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
}
/** Apito: senoide aguda com trinado (a "bolinha" do apito) e um sopro de ruído. */
function whistle(t, dur) {
  const o = ctx.createOscillator(), lfo = ctx.createOscillator(), depth = ctx.createGain(), g = ctx.createGain();
  o.type = 'sine'; o.frequency.value = 2650;
  lfo.frequency.value = 28; depth.gain.value = 140; lfo.connect(depth).connect(o.frequency);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.02); g.gain.setValueAtTime(0.22, t + dur - 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master); o.start(t); lfo.start(t); o.stop(t + dur + 0.02); lfo.stop(t + dur + 0.02);
  noise(t, dur, 3000, 0.04, 6);
}
function noise(t, dur, freq, peak, q = 0.7, attack = 0.02) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; s.loop = true; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  env(g, t, attack, peak, dur); s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + attack + dur + 0.05);
}
const SFX = {
  kickoff: (t) => whistle(t, 0.7),
  halftime: (t) => { whistle(t, 0.35); whistle(t + 0.5, 0.6); },
  secondhalf: (t) => whistle(t, 0.6),
  final: (t) => { whistle(t, 0.35); whistle(t + 0.5, 0.35); whistle(t + 1.0, 1.2); },
  gol: (t) => {
    noise(t, 2.2, 700, 0.5, 0.5, 0.35); noise(t + 0.1, 1.8, 1500, 0.2, 0.8, 0.3); // a torcida explode
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(t + 0.15 + i * 0.11, f, 0.16, 'square', 0.12)); // vinheta "GOOOL"
    tone(t + 0.85, 1319, 0.5, 'square', 0.1);
  },
  cartao: (t) => { whistle(t, 0.25); tone(t + 0.32, 880, 0.12, 'square', 0.14); tone(t + 0.46, 1175, 0.18, 'square', 0.14); },
  vermelho: (t) => { whistle(t, 0.25); whistle(t + 0.35, 0.25); tone(t + 0.7, 440, 0.45, 'sawtooth', 0.15, 160); noise(t + 0.7, 0.9, 400, 0.12); },
  penalti: (t) => { whistle(t, 0.18); whistle(t + 0.24, 0.18); whistle(t + 0.48, 0.5); for (let i = 0; i < 14; i++) tone(t + 1.05 + i * 0.06, 90, 0.05, 'triangle', 0.25); noise(t + 1.0, 0.9, 900, 0.12, 0.6, 0.4); },
  penalti_perdido: (t) => { noise(t, 0.9, 500, 0.25, 0.6, 0.05); tone(t, 392, 0.2, 'square', 0.1); tone(t + 0.2, 330, 0.2, 'square', 0.1); tone(t + 0.4, 262, 0.35, 'square', 0.1); },
  virar: (t) => tone(t, 700, 0.06, 'square', 0.06),
  festa: (t) => { [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.13, f, 0.2, 'square', 0.1)); noise(t, 1.5, 800, 0.2, 0.5, 0.3); },
  triste: (t) => [392, 330, 262].forEach((f, i) => tone(t + i * 0.2, f, 0.3, 'triangle', 0.15)),
};
/** No modo Rápido só tocam gols e o apito final. */
const FAST_OK = new Set(['gol', 'final', 'festa', 'triste', 'virar']);
export function sfx(kind, speed) {
  if (!soundOn() || !SFX[kind]) return false;
  if (speed === 'rapido' && !FAST_OK.has(kind)) return false;
  played.push(kind); if (played.length > 200) played.shift();
  const c = ac(); if (!c || c.state !== 'running') return true;
  try { SFX[kind](c.currentTime + 0.02); } catch (e) { /* sem áudio */ }
  return true;
}
