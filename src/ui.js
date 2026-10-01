import * as THREE from 'three';
import { HEROES, ELEMENTS } from './heroes.js';
import { makeCanvas } from './utils.js';
import { LEVELS } from './levels.js';
import { Save, BADGES } from './save.js';
import { ITEMS, heroPowerItem } from './items.js';
import { IS_TOUCH } from './platform.js';

const $ = (id) => document.getElementById(id);
export const HERO_ICON = { jago: '🐆', kairo: '🦎', lira: '🐈', halley: '🦊', nilo: '🦦', kyra: '❄️', ambar: '🦅' };

const SCREENS = ['loading', 'title', 'missions', 'select', 'pause', 'how', 'end', 'reveal', 'inventory', 'levelintro'];

class TipManager {
  constructor() {
    this.el = $('tip');
    this.text = $('tip-text');
    this.bar = $('tip-progress');
    this.queue = [];
    this.current = null;
    this.timer = 0;
    this.dur = 8;
    this.gap = 0;
    this.shown = new Map();
    this.onShow = null;
  }
  reset() {
    this.queue.length = 0;
    this.current = null;
    this.timer = 0;
    this.gap = 0;
    this.shown = new Map();
    this.el.classList.remove('show');
  }
  push(id, text, { force = false } = {}) {
    if (this.shown.has(id) && !force) return false;
    if (this.queue.some((q) => q.id === id)) return false;
    if (this.current && this.current.id === id) return false;
    this.queue.push({ id, text });
    if (this.queue.length > 3) this.queue.shift();
    return true;
  }
  showNow(id, text) {
    this.queue = this.queue.filter((q) => q.id !== id);
    this.current = { id, text };
    this.text.textContent = text;
    this.timer = this.dur = Math.max(6.5, 3.5 + text.length * 0.055);
    this.el.classList.add('show');
    this.shown.set(id, text);
  }
  update(dt) {
    if (this.current) {
      this.timer -= dt;
      this.bar.style.transform = `scaleX(${Math.max(0, this.timer / this.dur)})`;
      if (this.timer <= 0) {
        this.el.classList.remove('show');
        this.current = null;
        this.gap = 1.0;
      }
    } else {
      this.gap -= dt;
      if (this.queue.length && this.gap <= 0) {
        this.current = this.queue.shift();
        this.text.textContent = this.current.text;
        this.timer = this.dur = Math.max(6.5, 3.5 + this.current.text.length * 0.055);
        this.el.classList.add('show');
        this.shown.set(this.current.id, this.current.text);
        if (this.onShow) this.onShow(this.current);
      }
    }
  }
}

class Minimap {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.size = 176;
    this.cx = 0;
    this.cz = -15;
    this.half = 95;
    this.base = makeCanvas(352);
    this.waterC = makeCanvas(128);
    this.waterG = this.waterC.getContext('2d');
    this.acc = 99;
  }
  init(world) {
    this.world = world;
    const mv = world.mapView;
    this.cx = mv.cx;
    this.cz = mv.cz;
    this.half = mv.half;
    const g = this.base.getContext('2d');
    const gc = world.groundCanvas;
    const k = gc.width / 256;
    const sx = (this.cx - this.half + 128) * k, sy = (this.cz - this.half + 128) * k, sw = this.half * 2 * k;
    g.drawImage(gc, sx, sy, sw, sw, 0, 0, 352, 352);
    const f = 352 / (this.half * 2);
    g.fillStyle = 'rgba(40,44,54,.92)';
    for (const b of world.city.buildings) {
      g.fillRect((b.x - b.w / 2 - (this.cx - this.half)) * f, (b.z - b.d / 2 - (this.cz - this.half)) * f, b.w * f, b.d * f);
    }
    g.fillStyle = 'rgba(70,200,140,.9)';
    const S = world.safe;
    g.beginPath();
    g.arc((S.x - (this.cx - this.half)) * f, (S.z - (this.cz - this.half)) * f, 8 * f, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = 'bold 26px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('+', (S.x - (this.cx - this.half)) * f, (S.z - (this.cz - this.half)) * f + 1);
  }
  toPx(x, z) {
    const f = this.size / (this.half * 2);
    return [(x - (this.cx - this.half)) * f, (z - (this.cz - this.half)) * f];
  }
  updateWater(waterY) {
    const w = this.world;
    const img = this.waterG.createImageData(128, 128);
    const H = w.heightData;
    for (let j = 0; j < 128; j++) {
      for (let i = 0; i < 128; i++) {
        const wx = this.cx - this.half + ((i + 0.5) / 128) * this.half * 2;
        const wz = this.cz - this.half + ((j + 0.5) / 128) * this.half * 2;
        const ii = Math.floor(wx + 128), jj = Math.floor(wz + 128);
        const h = ii >= 0 && jj >= 0 && ii < 256 && jj < 256 ? H[jj * 256 + ii] : 99;
        const k = (j * 128 + i) * 4;
        if (h < waterY) {
          img.data[k] = 40; img.data[k + 1] = 140; img.data[k + 2] = 230; img.data[k + 3] = 140;
        }
      }
    }
    this.waterG.putImageData(img, 0, 0);
  }
  draw(dt, st) {
    this.acc += dt;
    if (this.acc > 0.5 && st.waterY > -40) {
      this.acc = 0;
      this.updateWater(st.waterY);
    }
    const g = this.g, S = this.size;
    g.clearRect(0, 0, S, S);
    g.drawImage(this.base, 0, 0, S, S);
    g.imageSmoothingEnabled = true;
    if (st.waterY > -40) g.drawImage(this.waterC, 0, 0, S, S);
    const t = performance.now() / 1000;
    for (const v of st.victims) {
      if (v.state === 'delivered') continue;
      const [x, y] = this.toPx(v.wx, v.wz);
      if (v.state === 'carried') continue;
      const pulse = 1 + 0.35 * Math.sin(t * (v.urgent ? 9 : 4) + v.id);
      g.fillStyle = v.urgent ? '#ff3030' : '#ffb020';
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, 4.2 * pulse, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    const [px, py] = this.toPx(st.px, st.pz);
    g.save();
    g.translate(px, py);
    g.rotate(-st.facing + Math.PI);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#0a1420';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, 8);
    g.lineTo(-6, -6);
    g.lineTo(0, -3);
    g.lineTo(6, -6);
    g.closePath();
    g.stroke();
    g.fill();
    g.restore();
  }
}

export const ui = {
  tips: null,
  minimap: null,
  edges: {},
  selected: 0,
  onPick: null,

  init() {
    this.tips = new TipManager();
    this.minimap = new Minimap($('minimap'));
    this.tickEl = $('gauge-ticks');
  },

  showScreen(name) {
    for (const s of SCREENS) $(s).classList.toggle('show', s === name);
  },
  showOverlay(name, on) {
    $(name).classList.toggle('show', on);
  },
  hud(on) {
    $('hud').classList.toggle('show', on);
    $('touch').classList.toggle('show', on && IS_TOUCH);
  },
  loadingMsg(t) {
    $('loading-msg').textContent = t;
  },
  setElementColor(css) {
    document.documentElement.style.setProperty('--el', css);
  },

  /* ---------- selección ---------- */
  buildSelect(onPick) {
    this.onPick = onPick;
    const box = $('hero-cards');
    box.innerHTML = '';
    HEROES.forEach((h, i) => {
      const el = ELEMENTS[h.element];
      const c = document.createElement('div');
      c.className = 'card';
      c.style.setProperty('--cel', el.css);
      c.innerHTML = `<div class="em">${HERO_ICON[h.id]}</div><div class="nm">${h.name}</div><div class="sp">${h.species}</div><div class="el">${el.icon} ${el.name}</div>`;
      c.addEventListener('click', () => onPick(i));
      box.appendChild(c);
    });
  },
  fillSelect(i) {
    this.selected = i;
    const h = HEROES[i];
    const el = ELEMENTS[h.element];
    this.setElementColor(el.css);
    [...$('hero-cards').children].forEach((c, k) => c.classList.toggle('sel', k === i));
    $('sel-name').textContent = h.name;
    $('sel-species').textContent = h.species;
    $('sel-element').textContent = `${el.icon} ${el.name}`;
    $('sel-bio').textContent = h.bio;
    $('sel-power-name').textContent = h.power.name;
    $('sel-power-desc').textContent = h.power.desc;
    const stats = [
      ['Velocidad', (h.stats.speed - 5.5) / 2.4],
      ['Salto', (h.stats.jump - 7.8) / 1.8],
      ['Natación', (h.stats.swim - 3) / 2.4],
      ['Carga', h.stats.carry / 3],
    ];
    $('sel-stats').innerHTML = stats
      .map(([n, v]) => `<div class="stat"><span>${n}</span><div class="bar"><i style="width:${Math.round(Math.max(0.12, Math.min(1, v)) * 100)}%"></i></div></div>`)
      .join('');
  },

  /* ---------- misiones ---------- */
  buildMissions(onPick) {
    const box = $('mission-cards');
    box.innerHTML = '';
    const done = Save.completed;
    $('progress-line').innerHTML = `Progreso <b>${done}/${LEVELS.length}</b> · Herramientas: ${Save.items.map((id) => ITEMS[id].icon).join(' ') || '—'}`;
    LEVELS.forEach((m, i) => {
      const unlocked = Save.isUnlocked(m.n);
      const st = Save.stars(m.id);
      const c = document.createElement('div');
      c.className = 'mcard' + (unlocked ? '' : ' locked') + (unlocked && done >= m.n ? ' done' : '');
      const rec = m.best.map((e) => ELEMENTS[e].icon).join(' ');
      const rw = ITEMS[m.reward];
      c.innerHTML = `<div class="m-kicker">${unlocked ? '🔓' : '🔒'} ${m.kicker}</div><div class="m-icon">${m.icon}</div><div class="m-name">${m.name}</div><div class="m-place">${m.place}</div><p>${m.desc}</p>
        <div class="m-meta"><span>Dificultad ${'🔥'.repeat(Math.ceil(m.n / 2))}</span><span class="m-stars">${[0, 1, 2].map((k) => (k < st ? '⭐' : '☆')).join('')}</span></div>
        <div class="m-meta"><span>Ideal: ${rec}</span><span>Premio: ${rw ? rw.icon : ''}</span></div>
        ${unlocked ? '<button class="btn primary small-play">JUGAR</button>' : `<div class="m-lock">Completa el nivel ${m.n - 1} para desbloquearlo</div>`}`;
      if (unlocked) c.addEventListener('click', () => onPick(i));
      box.appendChild(c);
    });
  },
  markRecommended(mission) {
    [...$('hero-cards').children].forEach((c, k) => {
      const h = HEROES[k];
      c.classList.toggle('rec', !!mission && mission.best.includes(h.element));
    });
    $('sel-mission').textContent = mission ? `${mission.icon} ${mission.name}` : '';
  },
  setOverlay(kind, v) {
    const el = $('ov-' + kind);
    if (el) el.style.opacity = String(Math.max(0, Math.min(1, v)));
  },
  setGaugeMode(mission) {
    this.gaugeMission = mission;
    $('gauge-title').textContent = mission ? mission.gauge : 'AGUA';
    $('gauge-fill').style.background = '';
    $('gauge-fill').style.boxShadow = '';
    this.tickEl.innerHTML = '';
  },
  setGauge(g) {
    $('gauge-title').textContent = g.label;
    $('gauge-fill').style.height = `${Math.round(g.pct * 100)}%`;
    $('gauge-fill').style.background = g.danger ? 'linear-gradient(0deg, #b91c1c, #ff6a3a)' : `linear-gradient(0deg, ${g.color}55, ${g.color})`;
    $('gauge-fill').style.boxShadow = `0 0 12px ${g.color}`;
    $('gauge-val').textContent = g.text;
    this.tickEl.innerHTML = '';
  },

  /* ---------- HUD ---------- */
  setHero(h) {
    const el = ELEMENTS[h.element];
    this.setElementColor(el.css);
    $('hud-icon').textContent = HERO_ICON[h.id];
    $('hud-name').textContent = h.name;
    $('hud-el').textContent = `${el.icon} ${el.name}`;
    $('hud-power-name').textContent = `Q · ${h.power.name}`;
  },
  setPower(ratio, ability) {
    // ratio: 0 = listo, 1 = recién usado
    const ring = $('power-ring');
    ring.style.strokeDashoffset = String(119.4 * ratio);
    $('power-btn').classList.toggle('ready', ratio <= 0.001);
    if (ability && this._abKey !== ability.id) {
      this._abKey = ability.id;
      $('power-key').textContent = ability.icon;
      $('hud-power-name').textContent = `Q · ${ability.name}`;
      const tp = document.querySelector('.t-power');
      if (tp) tp.textContent = ability.icon;
    }
  },
  setAbilities(list, index, onPick) {
    const bar = $('skillbar');
    bar.innerHTML = '';
    this._abKey = null;
    list.forEach((a, i) => {
      const b = document.createElement('button');
      b.className = 'skill' + (i === index ? ' sel' : '');
      b.innerHTML = `<span class="sk">${i + 1}</span><span class="ic">${a.icon}</span><i class="cdo"></i>`;
      b.title = a.name;
      b.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); onPick(i); });
      bar.appendChild(b);
    });
    bar.style.display = list.length > 1 ? 'flex' : 'none';
  },
  selectAbilityUI(i) {
    [...$('skillbar').children].forEach((b, k) => b.classList.toggle('sel', k === i));
    this._abKey = null;
  },
  setAbilityCds(arr) {
    const bar = $('skillbar');
    arr.forEach((r, i) => {
      const el = bar.children[i] && bar.children[i].querySelector('.cdo');
      if (el) el.style.height = `${Math.round(Math.max(0, Math.min(1, r)) * 100)}%`;
    });
  },
  setRescued(n, total) {
    $('hud-rescued').innerHTML = `${n}<span>/${total}</span>`;
  },
  setTime(sec) {
    const s = Math.max(0, Math.ceil(sec));
    const el = $('hud-time');
    el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    el.classList.toggle('low', s <= 30);
  },
  setScore(v) {
    $('score-val').textContent = v.toLocaleString('es-ES');
  },
  setCarry(list, cap) {
    const row = $('carry-row');
    row.innerHTML = '';
    for (let i = 0; i < cap; i++) {
      const d = document.createElement('div');
      d.className = 'carry-slot' + (list[i] ? ' full' : '');
      d.textContent = list[i] ? list[i].info.icon : '';
      row.appendChild(d);
    }
  },
  setWater(level, maxLevel, victims) {
    const pct = Math.min(1, level / maxLevel);
    $('gauge-fill').style.height = `${pct * 100}%`;
    $('gauge-val').textContent = `${level.toFixed(1)} m`;
    // marcas de altura de las personas que faltan por rescatar
    this.tickEl.innerHTML = '';
    for (const v of victims) {
      if (v.state === 'delivered' || v.state === 'carried') continue;
      const t = document.createElement('div');
      t.className = 'tick' + (level > v.platformY - 0.8 ? ' danger' : '');
      t.style.bottom = `${Math.min(1, Math.max(0, v.platformY / maxLevel)) * 100}%`;
      this.tickEl.appendChild(t);
    }
  },
  prompt(html) {
    const el = $('prompt');
    if (!html) {
      el.classList.remove('show');
      return;
    }
    if (el.dataset.k !== html) {
      el.innerHTML = html;
      el.dataset.k = html;
    }
    el.classList.add('show');
  },
  banner(cls, title, sub = '') {
    const el = $('banner');
    el.className = `banner ${cls}`;
    el.innerHTML = `<div class="b1">${title}</div><div class="b2">${sub}</div>`;
    void el.offsetWidth;
    el.classList.add('show');
  },
  alert(text, ms = 4500) {
    const el = $('alert');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this._alertT);
    this._alertT = setTimeout(() => el.classList.remove('show'), ms);
  },
  clickHint(on) {
    $('click-hint').style.display = on ? 'block' : 'none';
  },
  lightning(v) {
    $('lightning').style.opacity = String(v);
  },

  updateEdges(camera, items) {
    const box = $('edge-markers');
    const W = box.clientWidth, H = box.clientHeight;
    const used = new Set();
    const v = new THREE.Vector3();
    for (const it of items) {
      used.add(it.id);
      let e = this.edges[it.id];
      if (!e) {
        e = document.createElement('div');
        e.className = 'edge' + (it.safe ? ' safe' : '');
        e.innerHTML = '<div class="arrow">➤</div><div class="dist"></div>';
        box.appendChild(e);
        this.edges[it.id] = e;
      }
      v.set(it.x, it.y, it.z).project(camera);
      let nx = v.x, ny = v.y;
      const behind = v.z > 1;
      if (behind) { nx = -nx; ny = -ny; }
      const on = !behind && Math.abs(nx) < 0.9 && Math.abs(ny) < 0.86;
      if (on) {
        e.style.display = 'none';
        continue;
      }
      e.style.display = 'grid';
      let dx = nx * (W / 2), dy = -ny * (H / 2);
      const m = 62;
      const k = Math.min((W / 2 - m) / Math.max(1e-3, Math.abs(dx)), (H / 2 - m) / Math.max(1e-3, Math.abs(dy)));
      dx *= k; dy *= k;
      e.style.left = `${W / 2 + dx}px`;
      e.style.top = `${H / 2 + dy}px`;
      e.firstChild.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
      e.lastChild.textContent = `${Math.round(it.dist)} m`;
      e.lastChild.style.color = it.urgent ? '#ff6a6a' : '#fff';
    }
    for (const id in this.edges) {
      if (!used.has(Number(id)) && !used.has(id)) this.edges[id].style.display = 'none';
    }
  },
  clearEdges() {
    for (const id in this.edges) this.edges[id].remove();
    this.edges = {};
  },

  /* ---------- resultados, recompensa e inventario ---------- */
  showResults(d) {
    $('end-mission').textContent = d.level ? `${d.level.icon} ${d.level.name}` : '';
    $('end-kicker').textContent = d.success ? 'MISIÓN COMPLETADA' : 'SE ACABÓ EL TIEMPO';
    $('end-kicker').classList.toggle('fail', !d.success);
    $('end-title').textContent = d.success
      ? (d.rescued >= d.total ? `¡Increíble, ${d.heroName}! Has salvado a todos.` : `¡Bien hecho, ${d.heroName}! Misión superada.`)
      : `${d.level ? d.level.failTitle : 'El tiempo se agotó'}. ¡Inténtalo de nuevo!`;
    $('end-stars').innerHTML = [0, 1, 2].map((i) => `<span class="${i < d.stars ? '' : 'off'}">⭐</span>`).join('');
    $('end-people').textContent = String(d.people);
    $('end-animals').textContent = String(d.animals);
    $('end-score').textContent = d.score.toLocaleString('es-ES');
    $('end-eco').textContent = String(d.eco);
    const sec = Math.round(d.time);
    $('end-time').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    $('end-rescued').textContent = `${d.rescued}/${d.total}`;
    $('end-tips').textContent = String(d.learned.length);
    $('end-reward').innerHTML = d.reward
      ? `<div class="rw-card"><div class="rw-ic">${d.reward.icon}</div><div><div class="rw-k">🎁 NUEVA RECOMPENSA</div><b>${d.reward.name}</b><p>${d.reward.func}</p><small>No sustituye a tu poder: es una habilidad adicional (teclas 1, 2, 3…)</small></div></div>`
      : '';
    $('end-unlock').innerHTML = d.unlockedNext && d.nextLevel
      ? `<div class="un-card">🔓 <b>¡NUEVO NIVEL DESBLOQUEADO!</b><span>${d.nextLevel.icon} ${d.nextLevel.name}</span></div>`
      : '';
    $('end-badges').innerHTML = (d.newBadges || []).map((b) => `<span class="badge new">${b.icon} ${b.name}</span>`).join('');
    $('end-learn').innerHTML = d.learned.length ? d.learned.slice(0, 8).map((t) => `<li>${t}</li>`).join('') : '<li>Lee los carteles y presta atención a los consejos durante la misión.</li>';
    const nb = $('btn-next');
    nb.style.display = d.hasNext ? '' : 'none';
    nb.textContent = 'CONTINUAR AL SIGUIENTE NIVEL ▶';
    $('end').scrollTop = 0;
    if (d.reward) this.showReveal(d.reward, d.nextLevel && d.unlockedNext ? d.nextLevel : null, () => this.showScreen('end'));
    else this.showScreen('end');
  },
  showReveal(item, nextLevel, done) {
    $('reveal-icon').textContent = item.icon;
    $('reveal-name').textContent = item.name;
    $('reveal-func').textContent = item.func;
    $('reveal-unlock').textContent = nextLevel ? `🔓 ¡Nuevo nivel desbloqueado! ${nextLevel.icon} ${nextLevel.name}` : '';
    this.showScreen('reveal');
    $('btn-reveal').onclick = () => done();
  },
  showInventory(hero) {
    const grid = $('inv-grid');
    grid.innerHTML = '';
    const cards = [];
    if (hero) cards.push({ it: heroPowerItem(hero), unlocked: true, level: 0 });
    for (const l of LEVELS) {
      const it = ITEMS[l.reward];
      if (it) cards.push({ it, unlocked: Save.hasItem(it.id), level: l.n });
    }
    for (const c of cards) {
      const el = document.createElement('div');
      el.className = 'inv-card' + (c.unlocked ? '' : ' locked');
      el.innerHTML = c.unlocked
        ? `<div class="ic">${c.it.icon}</div><div><b>${c.it.name}</b><p>${c.it.desc}</p><p class="fn">⚙️ ${c.it.func}</p><small>${c.level ? `Desbloqueado al completar el nivel ${c.level}` : 'Poder original del héroe'}</small></div>`
        : `<div class="ic">🔒</div><div><b>???</b><p>Completa el nivel ${c.level} para obtenerlo.</p></div>`;
      grid.appendChild(el);
    }
    const d = Save.data;
    $('inv-totals').innerHTML = `❤️ ${d.people} personas · 🐾 ${d.animals} animales · ⭐ ${d.score.toLocaleString('es-ES')} puntos · 🌱 ${d.eco} eco`;
    $('inv-badges').innerHTML = Object.values(BADGES).map((b) => `<span class="badge${d.badges.includes(b.id) ? ' new' : ' off'}">${b.icon} ${b.name}</span>`).join('');
    $('inventory').scrollTop = 0;
    this.showOverlay('inventory', true);
  },
  showLevelIntro(level) {
    $('li-kicker').textContent = level.kicker;
    $('li-icon').textContent = level.icon;
    $('li-name').textContent = level.name;
    $('li-place').textContent = level.place;
    $('li-desc').textContent = level.desc;
    $('li-mech').textContent = `⚠️ ${level.mechanic}`;
    const rw = ITEMS[level.reward];
    $('li-diff').innerHTML = `Dificultad ${'🔥'.repeat(Math.ceil(level.n / 2))} · Premio del nivel: ${rw ? rw.icon + ' ' + rw.name : ''}`;
    $('li-progress').style.width = '4%';
    $('li-msg').textContent = 'Cargando el escenario 3D…';
    $('li-bg').className = 'li-bg ' + level.scenario;
    this.showScreen('levelintro');
  },
  levelIntroProgress(p, msg) {
    $('li-progress').style.width = `${Math.round(p * 100)}%`;
    if (msg) $('li-msg').textContent = msg;
  },
};
