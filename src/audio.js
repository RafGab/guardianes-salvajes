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

export const Audio3D = {
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
