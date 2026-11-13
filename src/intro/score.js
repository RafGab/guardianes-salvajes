/* ======================================================================
   CATAC 7 · BANDA SONORA DE LA INTRO (sintetizada con WebAudio, sin archivos)
   Todo se programa sobre el reloj de audio: cada golpe cae exactamente en su corte de plano.
   Tonalidad: Re menor. Estructura (segundos):
     0–10  MISTERIO      dron grave, viento, latido y destellos sutiles (despertar de Lira)
     10–28 DESCUBRIMIENTO pads que progresan Dm · B♭ · F · C (un acorde por guardián), taiko suave,
                          ostinato de cuerdas desde Ámbar
     28–40 INTENSIDAD    golpes de metal y percusión en cada entrada, montaje rítmico, crescendo
     40–41.2 PAUSA       silencio total y una inspiración
     41.2  REVELACIÓN    gran impacto (sub + ruido + acorde de quinta en Re) y cola brillante
   ====================================================================== */
const N = { D1: 36.71, A1: 55, D2: 73.42, E2: 82.41, F2: 87.31, G2: 98, A2: 110, Bb2: 116.54, C3: 130.81, Cs3: 138.59, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196, A3: 220, Bb3: 233.08, C4: 261.63, Cs4: 277.18, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, D5: 587.33, F5: 698.46, A5: 880 };

export const CHORDS = {
  Dm: [N.D2, N.A2, N.D3, N.F3, N.A3],
  Bb: [58.27, N.F2, N.Bb2, N.D3, N.F3],
  F: [N.F2, N.C3, N.F3, N.A3, N.C4],
  C: [65.41, N.G2, N.C3, N.E3, N.G3],
  Gm: [N.G2, N.D3, N.G3, N.Bb3, N.D4],
  A: [55, N.E2, N.A2, N.Cs3, N.E3],
  D5: [N.D1, N.D2, N.A2, N.D3, N.A3, N.D4],
};

export class Score {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const c = this.ctx;
    this.out = c.createGain(); this.out.gain.value = 0.9;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
    this.out.connect(comp); comp.connect(c.destination);
    // reverberación de sala grande (respuesta al impulso generada)
    this.verb = c.createConvolver();
    this.verb.buffer = this.impulse(3.6, 2.4);
    this.verbIn = c.createGain(); this.verbIn.gain.value = 0.6;
    this.verbIn.connect(this.verb);
    this.verbOut = c.createGain(); this.verb.connect(this.verbOut); this.verbOut.connect(this.out);
    this.dry = c.createGain(); this.dry.gain.value = 1; this.dry.connect(this.out);
    this.noise = this.noiseBuf(3);
    this.nodes = [];
  }
  impulse(sec, decay) {
    const c = this.ctx, len = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return b;
  }
  noiseBuf(sec) {
    const c = this.ctx, len = Math.floor(c.sampleRate * sec), b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  // salida con mezcla seco / reverberado
  bus(wet = 0.4) {
    const g = this.ctx.createGain();
    const w = this.ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(this.verbIn);
    const d = this.ctx.createGain(); d.gain.value = 1 - wet * 0.5; g.connect(d); d.connect(this.dry);
    return g;
  }
  track(n) { this.nodes.push(n); return n; }
  env(g, t, a, peak, hold, r, base = 0.0001) {
    g.gain.setValueAtTime(base, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + Math.max(0.005, a));
    g.gain.setValueAtTime(Math.max(peak, 0.0002), t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + r);
  }

  /* ---------- instrumentos ---------- */
  drone(t, dur, f, vol = 0.18) {
    const c = this.ctx, o = this.bus(0.5), g = c.createGain(); g.connect(o);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180; lp.Q.value = 3; lp.connect(g);
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 90; lfo.connect(lg); lg.connect(lp.frequency);
    for (const [type, mul, det] of [['sawtooth', 1, -6], ['sawtooth', 1, 7], ['sine', 0.5, 0], ['triangle', 2, 3]]) {
      const x = c.createOscillator(); x.type = type; x.frequency.value = f * mul; x.detune.value = det; x.connect(lp); x.start(t); x.stop(t + dur + 0.1); this.track(x);
    }
    lfo.start(t); lfo.stop(t + dur + 0.1); this.track(lfo);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(4, dur * 0.4)); g.gain.setValueAtTime(vol, t + dur - Math.min(2, dur * 0.3)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  wind(t, dur, vol = 0.06) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8; bp.frequency.setValueAtTime(400, t);
    for (let k = 0; k < dur; k += 2.5) bp.frequency.linearRampToValueAtTime(300 + Math.random() * 700, t + k + 2.5);
    const g = c.createGain(); s.connect(bp); bp.connect(g); g.connect(this.bus(0.6));
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 2); g.gain.setValueAtTime(vol, t + dur - 1.5); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.start(t); s.stop(t + dur + 0.1); this.track(s);
  }
  // pad orquestal (cuerdas / coro) con ataque lento y filtro que se abre
  pad(t, dur, notes, vol = 0.07, bright = 1400) {
    const c = this.ctx, o = this.bus(0.55), g = c.createGain(); g.connect(o);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7; lp.connect(g);
    lp.frequency.setValueAtTime(bright * 0.35, t); lp.frequency.linearRampToValueAtTime(bright, t + dur * 0.6);
    for (const f of notes) for (const det of [-9, 0, 8]) {
      const x = c.createOscillator(); x.type = 'sawtooth'; x.frequency.value = f; x.detune.value = det + (Math.random() - 0.5) * 4; x.connect(lp); x.start(t); x.stop(t + dur + 0.2); this.track(x);
    }
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(1.6, dur * 0.35)); g.gain.setValueAtTime(vol, t + dur - 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.2);
  }
  // nota corta de cuerdas (ostinato)
  pluck(t, f, vol = 0.05, len = 0.22) {
    const c = this.ctx, g = c.createGain(), lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(500, t + len);
    lp.connect(g); g.connect(this.bus(0.35));
    for (const det of [-6, 6]) { const x = c.createOscillator(); x.type = 'sawtooth'; x.frequency.value = f; x.detune.value = det; x.connect(lp); x.start(t); x.stop(t + len + 0.05); this.track(x); }
    this.env(g, t, 0.008, vol, 0.02, len);
  }
  taiko(t, vol = 0.6, pitch = 1) {
    const c = this.ctx, o = this.bus(0.4);
    const x = c.createOscillator(), g = c.createGain(); x.type = 'sine';
    x.frequency.setValueAtTime(150 * pitch, t); x.frequency.exponentialRampToValueAtTime(45 * pitch, t + 0.35);
    x.connect(g); g.connect(o); this.env(g, t, 0.004, vol, 0.04, 0.7); x.start(t); x.stop(t + 1); this.track(x);
    const s = c.createBufferSource(); s.buffer = this.noise; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const ng = c.createGain(); s.connect(lp); lp.connect(ng); ng.connect(o); this.env(ng, t, 0.002, vol * 0.5, 0.01, 0.18);
    s.start(t, Math.random()); s.stop(t + 0.3); this.track(s);
  }
  snare(t, vol = 0.18) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noise;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
    const g = c.createGain(); s.connect(hp); hp.connect(g); g.connect(this.bus(0.35)); this.env(g, t, 0.002, vol, 0.01, 0.12);
    s.start(t, Math.random() * 2); s.stop(t + 0.2); this.track(s);
  }
  // golpe de metal (acorde de metales + sub) para las entradas
  brass(t, notes, vol = 0.12, len = 1.2) {
    const c = this.ctx, g = c.createGain(), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
    lp.frequency.setValueAtTime(300, t); lp.frequency.exponentialRampToValueAtTime(2800, t + 0.08); lp.frequency.exponentialRampToValueAtTime(700, t + len);
    lp.connect(g); g.connect(this.bus(0.45));
    for (const f of notes) for (const det of [-7, 7]) { const x = c.createOscillator(); x.type = 'sawtooth'; x.frequency.value = f; x.detune.value = det; x.connect(lp); x.start(t); x.stop(t + len + 0.1); this.track(x); }
    this.env(g, t, 0.02, vol, 0.15, len);
  }
  boom(t, vol = 0.9, f0 = 70, f1 = 28, len = 2.2) {
    const c = this.ctx, x = c.createOscillator(), g = c.createGain(); x.type = 'sine';
    x.frequency.setValueAtTime(f0, t); x.frequency.exponentialRampToValueAtTime(f1, t + len * 0.7);
    x.connect(g); g.connect(this.bus(0.3)); this.env(g, t, 0.005, vol, 0.1, len); x.start(t); x.stop(t + len + 0.2); this.track(x);
    const s = c.createBufferSource(); s.buffer = this.noise; const lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5000, t); lp.frequency.exponentialRampToValueAtTime(120, t + 1.2);
    const ng = c.createGain(); s.connect(lp); lp.connect(ng); ng.connect(this.bus(0.7)); this.env(ng, t, 0.003, vol * 0.55, 0.05, 1.4);
    s.start(t); s.stop(t + 1.8); this.track(s);
  }
  whoosh(t, dur = 0.7, vol = 0.12, up = true) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noise;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(up ? 250 : 3500, t); bp.frequency.exponentialRampToValueAtTime(up ? 3500 : 250, t + dur);
    const g = c.createGain(); s.connect(bp); bp.connect(g); g.connect(this.bus(0.5));
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.start(t, Math.random()); s.stop(t + dur + 0.05); this.track(s);
  }
  riser(t, dur, vol = 0.14) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const hp = c.createBiquadFilter(); hp.type = 'bandpass'; hp.Q.value = 2; hp.frequency.setValueAtTime(400, t); hp.frequency.exponentialRampToValueAtTime(7000, t + dur);
    const g = c.createGain(); s.connect(hp); hp.connect(g); g.connect(this.bus(0.5));
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.04);
    s.start(t); s.stop(t + dur + 0.1); this.track(s);
    for (const det of [0, 7]) {
      const x = c.createOscillator(), xg = c.createGain(); x.type = 'sawtooth'; x.frequency.setValueAtTime(110, t); x.frequency.exponentialRampToValueAtTime(880, t + dur); x.detune.value = det * 100;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
      x.connect(lp); lp.connect(xg); xg.connect(this.bus(0.4));
      xg.gain.setValueAtTime(0.0001, t); xg.gain.exponentialRampToValueAtTime(vol * 0.35, t + dur); xg.gain.linearRampToValueAtTime(0.0001, t + dur + 0.04);
      x.start(t); x.stop(t + dur + 0.1); this.track(x);
    }
  }
  chime(t, f, vol = 0.05, len = 2.5) {
    const c = this.ctx;
    for (const [mul, v] of [[1, 1], [2.76, 0.35], [5.4, 0.15]]) {
      const x = c.createOscillator(), g = c.createGain(); x.type = 'sine'; x.frequency.value = f * mul;
      x.connect(g); g.connect(this.bus(0.7)); this.env(g, t, 0.004, vol * v, 0.02, len); x.start(t); x.stop(t + len + 0.1); this.track(x);
    }
  }
  heart(t, vol = 0.35) { this.taiko(t, vol, 0.55); this.taiko(t + 0.22, vol * 0.7, 0.5); }

  /* ---------- partitura completa ---------- */
  play(delay = 0.15) {
    const c = this.ctx;
    if (c.state === 'suspended') c.resume();
    const T = c.currentTime + delay;
    this.t0 = T;
    const at = (s) => T + s;
    // ACTO 1 — MISTERIO
    this.drone(at(0), 40, N.D1, 0.2);
    this.wind(at(0), 40, 0.05);
    this.heart(at(2.4), 0.25);
    this.boom(at(3.1), 0.35, 60, 30, 3);               // primera revelación: los ojos de Lira
    this.pad(at(3.1), 6.6, [N.D3, N.A3, N.D4], 0.035, 900);
    this.chime(at(4.2), N.A4, 0.035); this.chime(at(5.5), N.D5, 0.04); this.chime(at(7.5), N.F5, 0.035);
    this.heart(at(6.2), 0.3); this.heart(at(8.6), 0.34);
    this.whoosh(at(9.0), 1.0, 0.13);
    // ACTO 2 — DESCUBRIMIENTO: un acorde por guardián
    const act2 = [[10, 'Dm'], [14.5, 'Bb'], [19, 'F'], [23.5, 'C']];
    for (const [s, ch] of act2) { this.pad(at(s), 4.9, CHORDS[ch], 0.05 + (s - 10) * 0.002, 1200 + (s - 10) * 80); this.boom(at(s), 0.32, 65, 32, 1.6); }
    for (const s of [14.1, 18.6, 23.1, 27.6]) this.whoosh(at(s), 0.75, 0.12);
    for (let s = 14.5; s < 28; s += 1.13) this.taiko(at(s), 0.32 + (s - 14.5) * 0.012);
    const ost = [[19, 'F'], [23.5, 'C']];
    for (const [s0, ch] of ost) { const nn = CHORDS[ch]; for (let k = 0; k < 16; k++) this.pluck(at(s0 + k * 0.28), nn[2 + (k % 3)] * 2, 0.03 + k * 0.001); }
    // ACTO 3 — INTENSIDAD
    this.brass(at(28), CHORDS.Dm.slice(0, 4), 0.14, 1.8); this.boom(at(28), 0.8, 80, 30, 2.4); this.taiko(at(28), 0.9);
    this.pad(at(28), 3.6, CHORDS.Dm, 0.065, 2200);
    this.brass(at(31.5), CHORDS.Bb.slice(0, 4), 0.14, 1.6); this.boom(at(31.5), 0.7, 80, 30, 2); this.taiko(at(31.5), 0.9);
    this.pad(at(31.5), 3.6, CHORDS.Bb, 0.065, 2400);
    for (let s = 28; s < 35; s += 0.28) { this.pluck(at(s), (s < 31.5 ? CHORDS.Dm : CHORDS.Bb)[2 + (Math.round(s / 0.28) % 3)] * 2, 0.04); }
    for (let s = 28.56; s < 35; s += 0.56) this.taiko(at(s), 0.45, 1.1);
    for (let s = 29.1; s < 35; s += 1.12) this.snare(at(s), 0.14);
    this.whoosh(at(34.7), 0.4, 0.14);
    // montaje: un golpe por cada guardián
    for (let k = 0; k < 7; k++) { const s = 35 + k * 0.34; this.taiko(at(s), 0.8, 1 + k * 0.04); this.brass(at(s), [CHORDS.Gm[k % 5], CHORDS.Gm[(k + 2) % 5]], 0.07, 0.3); this.snare(at(s + 0.17), 0.12); }
    // plano de conjunto: crescendo hacia la revelación
    this.pad(at(37.4), 2.7, CHORDS.A, 0.08, 3000);
    this.brass(at(37.4), CHORDS.A.slice(1, 5), 0.12, 2.6);
    this.taiko(at(37.4), 1);
    for (let k = 0; k < 18; k++) this.snare(at(37.5 + 2.5 * (1 - Math.pow(1 - k / 18, 1.6))), 0.08 + k * 0.008);
    this.riser(at(36.9), 3.1, 0.16);
    // ACTO 4 — PAUSA Y REVELACIÓN
    this.whoosh(at(40.55), 0.65, 0.07, false); // inspiración en el silencio
    this.boom(at(41.2), 1.0, 90, 26, 3.2);
    this.taiko(at(41.2), 1.0, 0.8);
    this.brass(at(41.2), [N.D2, N.A2, N.D3, N.A3], 0.16, 4.5);
    this.pad(at(41.2), 9, CHORDS.D5, 0.085, 3200);
    this.drone(at(41.2), 10, N.D1, 0.16);
    const arp = [N.D4, N.A4, N.D5, N.A5, N.F5, N.D5];
    arp.forEach((f, k) => this.chime(at(42.4 + k * 0.42), f, 0.03, 2.4));
    this.chime(at(44.5), N.A5, 0.035, 3); this.chime(at(47.5), N.D5 * 2, 0.03, 3);
    this.out.gain.setValueAtTime(0.9, at(48.5));
    this.out.gain.linearRampToValueAtTime(0.0001, at(52));
    // silencio real en la pausa dramática: se baja el bus de reverberación para cortar las colas
    this.verbIn.gain.setValueAtTime(0.6, at(39.95));
    this.verbIn.gain.linearRampToValueAtTime(0.0, at(40.05));
    this.verbIn.gain.setValueAtTime(0.0, at(41.15));
    this.verbIn.gain.linearRampToValueAtTime(0.7, at(41.2));
    this.dry.gain.setValueAtTime(1, at(39.95)); this.dry.gain.linearRampToValueAtTime(0.0001, at(40.08));
    this.dry.gain.setValueAtTime(0.0001, at(40.5)); this.dry.gain.linearRampToValueAtTime(1, at(40.55));
    this.verbOut.gain.setValueAtTime(1, at(39.95)); this.verbOut.gain.linearRampToValueAtTime(0.0001, at(40.1)); this.verbOut.gain.setValueAtTime(0.0001, at(41.15)); this.verbOut.gain.linearRampToValueAtTime(1, at(41.2));
  }
  get time() { return this.ctx.currentTime - (this.t0 || this.ctx.currentTime); }
  stop(fade = 0.6) {
    const c = this.ctx;
    try {
      this.out.gain.cancelScheduledValues(c.currentTime);
      this.out.gain.setValueAtTime(this.out.gain.value, c.currentTime);
      this.out.gain.linearRampToValueAtTime(0.0001, c.currentTime + fade);
    } catch (e) { /* */ }
    setTimeout(() => { try { c.close(); } catch (e) { /* */ } }, fade * 1000 + 200);
  }
}
