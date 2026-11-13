// Audio sintetizado con WebAudio (sin archivos externos).
let ctx = null;
let master = null;
let muted = false;
let started = false;
let musicGain = null;
let musicBuf = null;
let musicSrc = null;
let musicLoading = false;
const MUSIC_URL = '/audio/melodia.mp3';
const MUSIC_VOL = 0.6; // única fuente de sonido

// Crea el contexto y el volumen maestro (idempotente). Se llama desde un gesto del usuario.
function ensureCtx() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {
    return false;
  }
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.7;
  master.connect(ctx.destination);
  musicGain = ctx.createGain();
  musicGain.gain.value = 0;
  musicGain.connect(master);
  return true;
}

/* ---------- SONIDOS DE LOS PODERES ESPECIALES ----------
   El resto del juego sigue sin efectos (solo la melodía). Los poderes especiales tienen su propio canal,
   sintetizado (sin archivos), a volumen moderado para no tapar la música. */
let sfxGain = null;
let noiseBuf = null;
function sfxOut() {
  if (!ensureCtx()) return null;
  if (!sfxGain) { sfxGain = ctx.createGain(); sfxGain.gain.value = 0.5; sfxGain.connect(master); }
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return sfxGain;
}
// ruido filtrado con envolvente (ataque, duración); f1 = frecuencia final del filtro (barrido)
function noise({ dur = 0.5, f0 = 800, f1 = f0, q = 1, type = 'lowpass', vol = 0.4, attack = 0.02, delay = 0 }) {
  const out = sfxOut(); if (!out) return;
  const t0 = ctx.currentTime + delay;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f); f.connect(g); g.connect(out);
  src.start(t0, Math.random()); src.stop(t0 + dur + 0.05);
}
function osc({ f0 = 440, f1 = f0, dur = 0.4, type = 'sine', vol = 0.2, attack = 0.01, delay = 0 }) {
  const out = sfxOut(); if (!out) return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + dur + 0.05);
}
const SFX = {
  rumble: () => { noise({ dur: 1.4, f0: 160, f1: 60, vol: 0.55, attack: 0.25 }); osc({ f0: 55, f1: 38, dur: 1.4, vol: 0.25, attack: 0.3 }); },
  eruption: () => { noise({ dur: 0.9, f0: 300, f1: 2200, type: 'bandpass', q: 0.7, vol: 0.5, attack: 0.03 }); noise({ dur: 1.2, f0: 120, f1: 50, vol: 0.5 }); },
  hiss: () => noise({ dur: 1.3, f0: 3500, f1: 1200, type: 'highpass', vol: 0.18, attack: 0.08 }),
  lava: () => { noise({ dur: 1.6, f0: 260, f1: 90, q: 3, vol: 0.4, attack: 0.1 }); for (let i = 0; i < 6; i++) noise({ dur: 0.08, f0: 900, f1: 500, type: 'bandpass', q: 4, vol: 0.2, delay: 0.15 + i * 0.2 * Math.random() + i * 0.1 }); },
  slurp: () => { osc({ f0: 300, f1: 1100, dur: 0.18, type: 'triangle', vol: 0.22 }); noise({ dur: 0.2, f0: 1800, f1: 600, type: 'bandpass', q: 2, vol: 0.2 }); },
  snap: () => { osc({ f0: 900, f1: 180, dur: 0.22, type: 'triangle', vol: 0.25 }); noise({ dur: 0.12, f0: 2500, type: 'highpass', vol: 0.2 }); },
  stick: () => { noise({ dur: 0.15, f0: 700, f1: 300, type: 'bandpass', q: 3, vol: 0.3 }); osc({ f0: 160, f1: 90, dur: 0.18, vol: 0.25 }); },
  boom: () => { noise({ dur: 1.0, f0: 200, f1: 40, vol: 0.7, attack: 0.005 }); osc({ f0: 90, f1: 30, dur: 0.9, vol: 0.4, attack: 0.005 }); },
  dark: () => { osc({ f0: 110, f1: 55, dur: 2.2, type: 'sawtooth', vol: 0.08, attack: 0.6 }); osc({ f0: 165, f1: 82, dur: 2.2, vol: 0.12, attack: 0.6 }); noise({ dur: 2, f0: 400, f1: 120, vol: 0.2, attack: 0.8 }); },
  chime: () => { [880, 1175, 1568, 1760].forEach((f, i) => osc({ f0: f, dur: 1.6, vol: 0.09, attack: 0.02, delay: i * 0.09 })); },
  moon: () => { [440, 554, 659].forEach((f, i) => osc({ f0: f, f1: f * 0.98, dur: 2.4, vol: 0.08, attack: 0.4, delay: i * 0.15 })); noise({ dur: 2, f0: 5000, f1: 2500, type: 'highpass', vol: 0.05, attack: 0.6 }); },
  blood: () => { osc({ f0: 70, f1: 45, dur: 3, type: 'sawtooth', vol: 0.12, attack: 1 }); [220, 233, 311].forEach((f, i) => osc({ f0: f, dur: 2.6, type: 'triangle', vol: 0.06, attack: 0.9, delay: i * 0.2 })); },
  blast: () => { noise({ dur: 1.4, f0: 1200, f1: 80, vol: 0.6, attack: 0.01 }); osc({ f0: 140, f1: 40, dur: 1.2, vol: 0.35, attack: 0.01 }); },
  shimmer: () => { for (let i = 0; i < 5; i++) osc({ f0: 1200 + Math.random() * 1400, dur: 0.5, vol: 0.05, delay: i * 0.06 }); noise({ dur: 0.6, f0: 6000, f1: 3000, type: 'highpass', vol: 0.06 }); },
  warp: () => { osc({ f0: 1400, f1: 200, dur: 0.25, type: 'sine', vol: 0.18 }); noise({ dur: 0.3, f0: 3000, f1: 400, type: 'bandpass', q: 2, vol: 0.2 }); },
  flap: () => noise({ dur: 0.14, f0: 700, f1: 250, type: 'bandpass', q: 1.2, vol: 0.28 }),
  wind: () => noise({ dur: 1.5, f0: 500, f1: 1400, type: 'bandpass', q: 0.8, vol: 0.22, attack: 0.3 }),
  land: () => { noise({ dur: 0.35, f0: 400, f1: 90, vol: 0.4 }); },
  crack: () => { for (let i = 0; i < 4; i++) noise({ dur: 0.09, f0: 2400, f1: 900, type: 'bandpass', q: 3, vol: 0.3, delay: i * 0.05 }); osc({ f0: 120, f1: 60, dur: 0.3, vol: 0.3 }); },
  roll: () => noise({ dur: 0.5, f0: 140, f1: 110, q: 2, vol: 0.25, attack: 0.05 }),
  avalanche: () => { noise({ dur: 2.4, f0: 250, f1: 70, vol: 0.6, attack: 0.2 }); for (let i = 0; i < 10; i++) noise({ dur: 0.1, f0: 1800, f1: 700, type: 'bandpass', q: 3, vol: 0.18, delay: 0.2 + i * 0.18 }); },
  wave: () => { noise({ dur: 2.6, f0: 300, f1: 1400, type: 'bandpass', q: 0.6, vol: 0.45, attack: 0.9 }); noise({ dur: 1.2, f0: 900, f1: 150, vol: 0.5, delay: 2.2 }); },
  vortex: () => { noise({ dur: 3.5, f0: 200, f1: 700, type: 'bandpass', q: 2, vol: 0.35, attack: 0.6 }); osc({ f0: 60, f1: 120, dur: 3.5, type: 'sawtooth', vol: 0.06, attack: 1 }); },
  aurora: () => { [523, 659, 784, 988, 1175].forEach((f, i) => osc({ f0: f, f1: f * 1.01, dur: 3.2, vol: 0.06, attack: 0.8, delay: i * 0.25 })); },
  sun: () => { osc({ f0: 220, f1: 880, dur: 1.2, type: 'triangle', vol: 0.12, attack: 0.4 }); noise({ dur: 1.4, f0: 600, f1: 3000, type: 'bandpass', q: 0.8, vol: 0.25, attack: 0.5 }); },
};

export const Audio3D = {
  // sonido de un poder especial (ver SFX)
  sfx(name) { try { if (!muted && SFX[name]) SFX[name](); } catch (e) { /* sin audio */ } },
  // Melodía de fondo en bucle (intro y todos los niveles). Idempotente: se puede llamar en cada gesto.
  startMusic() {
    if (!ensureCtx() || musicSrc || musicLoading) return;
    const play = () => {
      if (musicSrc) return;
      musicSrc = ctx.createBufferSource();
      musicSrc.buffer = musicBuf;
      musicSrc.loop = true;
      musicSrc.connect(musicGain);
      musicSrc.start();
      musicGain.gain.setTargetAtTime(MUSIC_VOL, ctx.currentTime, 1.2); // entrada suave
    };
    if (musicBuf) return play();
    musicLoading = true;
    fetch(MUSIC_URL)
      .then((r) => r.arrayBuffer())
      .then((ab) => ctx.decodeAudioData(ab))
      .then((buf) => { musicBuf = buf; musicLoading = false; play(); })
      .catch((e) => { musicLoading = false; console.warn('[música]', e); });
  },
  // Detiene la melodía (por ejemplo, para ver la intro cinematográfica); startMusic la vuelve a poner
  stopMusic() {
    if (!musicSrc) return;
    try { musicSrc.stop(); } catch (e) { /* */ }
    musicSrc.disconnect();
    musicSrc = null;
    if (musicGain) musicGain.gain.value = 0;
  },
  init() {
    if (!ensureCtx()) return;
    if (started) return;
    started = true;

    // Sin sonido ambiente (ni lluvia ni viento): el fondo sonoro es solo la melodía (startMusic).
  },
  setMuted(m) {
    muted = m;
    if (master) master.gain.value = m ? 0 : 0.7;
  },
  get muted() {
    return muted;
  },
  get musicPlaying() {
    return !!musicSrc && !!ctx && ctx.state === 'running';
  },
  setIntensity() {
    // sin ambiente que regular (se quitaron la lluvia y el viento)
  },
  // Efectos de sonido eliminados: solo suena la melodía. Se conservan las funciones (las llama el juego)
  // como no-ops para no tocar el resto del código; para devolver un efecto basta con reimplementar tone/noiseBurst.
  tone() {},
  noiseBurst() {},
  thunder() {},
  rumble() {
    this.noiseBurst(2.5, 140, 0.6, 'lowpass');
  },
  splash() {
    this.noiseBurst(0.25, 1400, 0.12, 'bandpass');
  },
  whoosh() {
    this.noiseBurst(0.35, 1800, 0.18, 'bandpass');
  },
  click() {
    this.tone(660, 0.07, 'triangle', 0.12);
  },
  found() {
    this.tone(523, 0.12, 'triangle', 0.18);
    this.tone(784, 0.18, 'triangle', 0.18, 0, 0.11);
  },
  pick() {
    this.tone(392, 0.12, 'sine', 0.2);
    this.tone(587, 0.2, 'sine', 0.2, 0, 0.1);
  },
  success() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.28, 'triangle', 0.2, 0, i * 0.1));
  },
  alert() {
    for (let i = 0; i < 3; i++) this.tone(440, 0.22, 'sawtooth', 0.14, -120, i * 0.3);
  },
  power(type) {
    if (type === 'ice') this.tone(1400, 0.6, 'sine', 0.14, -900);
    else if (type === 'pillar') this.noiseBurst(0.6, 220, 0.6, 'lowpass');
    else if (type === 'surf') this.tone(300, 0.5, 'sine', 0.14, 500);
    else this.tone(220, 0.45, 'sawtooth', 0.12, 600);
    this.whoosh();
  },
  tip() {
    this.tone(880, 0.1, 'sine', 0.1);
  },
};
