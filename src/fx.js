import * as THREE from 'three';
import { ParticleSystem } from './particles.js';
import { particleTexture, TAU } from './utils.js';

const r = (a, b) => a + Math.random() * (b - a);

export class FX {
  constructor(scene) {
    this.fire = new ParticleSystem(scene, { max: 1200, texture: particleTexture('soft'), additive: true });
    this.spark = new ParticleSystem(scene, { max: 900, texture: particleTexture('spark'), additive: true });
    this.smoke = new ParticleSystem(scene, { max: 500, texture: particleTexture('smoke'), additive: false });
    this.water = new ParticleSystem(scene, { max: 1200, texture: particleTexture('soft'), additive: false });
    this.ice = new ParticleSystem(scene, { max: 700, texture: particleTexture('flake'), additive: true });
    this.dust = new ParticleSystem(scene, { max: 500, texture: particleTexture('smoke'), additive: false });
    this.all = [this.fire, this.spark, this.smoke, this.water, this.ice, this.dust];
  }

  update(dt, camera, drawH) {
    const s = drawH / (2 * Math.tan((camera.fov * Math.PI) / 360));
    for (const p of this.all) {
      p.setScale(s);
      p.update(dt);
    }
  }

  flame(x, y, z, k = 1, spread = 0.25) {
    this.fire.emit(x + r(-spread, spread), y, z + r(-spread, spread), r(-0.4, 0.4), r(1.2, 3) * k, r(-0.4, 0.4), r(0.5, 1.0), 0.9 * k, 2.3 * k, 0xffd070, 0xff2a00, 0.95, 0, -1.6, 1);
  }
  ember(x, y, z, k = 1) {
    this.spark.emit(x + r(-0.5, 0.5), y + r(0, 1.5), z + r(-0.5, 0.5), r(-0.6, 0.6), r(0.5, 2.2), r(-0.6, 0.6), r(0.8, 1.8), 0.14 * k, 0.05, 0xffc060, 0xff5a10, 1, 0, -0.5, 0.3);
  }
  smokePuff(x, y, z, k = 1, col = 0x555a60) {
    this.smoke.emit(x, y, z, r(-0.3, 0.3), r(0.6, 1.4), r(-0.3, 0.3), r(1.2, 2.2), 0.7 * k, 3 * k, col, 0x20242a, 0.35, 0, 0, 0.5);
  }
  spray(x, y, z, vx = 0, vy = 3, vz = 0, k = 1) {
    this.water.emit(x, y, z, vx + r(-1.2, 1.2), vy + r(0, 2.5), vz + r(-1.2, 1.2), r(0.45, 0.9), 0.16 * k, 0.07 * k, 0xdff0ff, 0xaad4ff, 0.75, 0, 9, 0.3);
  }
  splash(x, y, z, n = 14, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = r(0.6, 3) * power;
      this.spray(x, y, z, Math.cos(a) * s, r(2, 5) * power, Math.sin(a) * s, 1.2);
    }
  }
  mist(x, y, z, col = 0xbfe6ff, k = 1) {
    this.smoke.emit(x, y, z, r(-0.6, 0.6), r(0.2, 0.8), r(-0.6, 0.6), r(0.9, 1.6), 0.5 * k, 2.4 * k, col, col, 0.3, 0, 0, 0.5);
  }
  iceShard(x, y, z, k = 1) {
    this.ice.emit(x + r(-0.4, 0.4), y, z + r(-0.4, 0.4), r(-1.5, 1.5), r(0.5, 3.5), r(-1.5, 1.5), r(0.6, 1.4), 0.35 * k, 0.12 * k, 0xa8e8ff, 0x60b0ff, 1, 0, 4, 0.5);
  }
  snow(x, y, z) {
    this.ice.emit(x + r(-8, 8), y + r(0, 6), z + r(-8, 8), r(-0.4, 0.4), r(-0.9, -0.3), r(-0.4, 0.4), r(2, 3.5), 0.16, 0.12, 0xffffff, 0xcfe8ff, 0.8, 0, 0, 0);
  }
  dustPuff(x, y, z, k = 1) {
    this.dust.emit(x + r(-0.3, 0.3), y + 0.1, z + r(-0.3, 0.3), r(-0.8, 0.8), r(0.3, 1.2), r(-0.8, 0.8), r(0.6, 1.1), 0.4 * k, 1.5 * k, 0x8a7a66, 0x6a5e50, 0.5, 0, 0, 1);
  }
  rock(x, y, z) {
    this.dust.emit(x + r(-0.5, 0.5), y, z + r(-0.5, 0.5), r(-3, 3), r(2, 6), r(-3, 3), r(0.6, 1.2), 0.22, 0.12, 0x7a6a58, 0x4a3a2a, 1, 0, 14, 0.2);
  }
  gem(x, y, z) {
    this.spark.emit(x + r(-0.5, 0.5), y, z + r(-0.5, 0.5), r(-1, 1), r(1, 4), r(-1, 1), r(0.6, 1.2), 0.3, 0.05, 0x40ff90, 0x10a050, 1, 0, 4, 0.5);
  }
  sparkle(x, y, z, col = 0xffe070, spd = 2) {
    this.spark.emit(x, y, z, r(-spd, spd), r(0.5, spd * 1.4), r(-spd, spd), r(0.6, 1.3), 0.32, 0.05, col, 0xffffff, 1, 0, 2, 0.4);
  }
  confetti(x, y, z) {
    const cols = [0xffe070, 0x67f0a5, 0xff7ab0, 0x7ad0ff];
    for (let i = 0; i < 26; i++) this.sparkle(x, y, z, cols[i % 4], 4);
  }
  flameRing(x, y, z, n = 26) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      this.fire.emit(x + Math.cos(a) * 0.5, y, z + Math.sin(a) * 0.5, Math.cos(a) * 5, r(0.5, 2), Math.sin(a) * 5, r(0.4, 0.8), 0.7, 1.6, 0xffc060, 0xff3a00, 0.9, 0, 0, 2);
    }
  }
  waterRing(x, y, z, n = 30) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      this.spray(x + Math.cos(a) * 0.6, y, z + Math.sin(a) * 0.6, Math.cos(a) * 5, 2, Math.sin(a) * 5, 1.4);
    }
  }
}
