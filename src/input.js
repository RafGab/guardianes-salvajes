// Teclado + ratón (con bloqueo de puntero) + mando + táctil
import { IS_TOUCH } from './platform.js';

export class Input {
  constructor(el) {
    this.el = el;
    this.keys = new Set();
    this.jumpPressed = false;
    this.lookX = 0;
    this.lookY = 0;
    this.wheel = 0;
    this.locked = false;
    this.dragging = false;
    this.enabled = false;
    this.handlers = {};
    this.padPrev = [];
    this.pad = { x: 0, y: 0, lx: 0, ly: 0, sprint: false, jump: false };
    this.canLock = !IS_TOUCH;
    this.touch = { x: 0, y: 0, run: false, sprint: false, jumpHeld: false, lookX: 0, lookY: 0 };
    this.attach();
    if (IS_TOUCH) this.attachTouch();
  }

  on(name, fn) {
    (this.handlers[name] ||= []).push(fn);
  }
  emit(name, arg) {
    (this.handlers[name] || []).forEach((f) => f(arg));
  }

  attach() {
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code) && this.enabled) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (!this.enabled) {
        if (e.code === 'ArrowLeft') this.emit('selectPrev');
        if (e.code === 'ArrowRight') this.emit('selectNext');
        if (e.code === 'Enter') this.emit('confirm');
        if (e.code === 'KeyM') this.emit('mute');
        return;
      }
      switch (e.code) {
        case 'Space': this.jumpPressed = true; break;
        case 'KeyQ': this.emit('power'); break;
        case 'KeyF': this.emit('rescue'); break;
        case 'KeyE': this.emit('interact'); break;
        case 'KeyC': this.emit('recenter'); break;
        case 'KeyM': this.emit('mute'); break;
        case 'KeyR': this.emit('respawn'); break;
        case 'Escape': this.emit('pause'); break;
        case 'KeyP': this.emit('pause'); break;
        default: break;
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.el.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked) {
        this.dragging = true;
        this.requestLock();
        return;
      }
      if (e.button === 0) this.emit('power');
      else if (e.button === 2) this.emit('rescue');
    });
    window.addEventListener('mouseup', () => (this.dragging = false));
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked || this.dragging) {
        this.lookX += e.movementX || 0;
        this.lookY += e.movementY || 0;
      }
    });
    window.addEventListener('wheel', (e) => {
      if (this.enabled) this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.el;
      if (was && !this.locked && this.enabled) this.emit('unlocked');
      this.emit('lockchange', this.locked);
    });
    document.addEventListener('pointerlockerror', () => (this.canLock = false));
  }

  attachTouch() {
    const $ = (id) => document.getElementById(id);
    const zone = $('stick-zone'), base = $('stick-base'), knob = $('stick-knob'), look = $('look-zone');
    const R = 56;
    let stickId = null, cx = 0, cy = 0;
    zone.addEventListener('pointerdown', (e) => {
      if (stickId !== null) return;
      stickId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      cx = e.clientX;
      cy = e.clientY;
      base.style.left = cx + 'px';
      base.style.top = cy + 'px';
      base.classList.add('on');
      knob.style.transform = 'translate(0px,0px)';
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== stickId) return;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      const k = Math.min(1, d / R);
      this.touch.x = (dx / R);
      this.touch.y = -(dy / R);
      this.touch.run = k > 0.96;
    });
    const endStick = (e) => {
      if (e.pointerId !== stickId) return;
      stickId = null;
      this.touch.x = this.touch.y = 0;
      this.touch.run = false;
      base.classList.remove('on');
    };
    zone.addEventListener('pointerup', endStick);
    zone.addEventListener('pointercancel', endStick);

    let lookId = null, lx = 0, ly = 0;
    look.addEventListener('pointerdown', (e) => {
      if (lookId !== null) return;
      lookId = e.pointerId;
      look.setPointerCapture(e.pointerId);
      lx = e.clientX;
      ly = e.clientY;
      e.preventDefault();
    });
    look.addEventListener('pointermove', (e) => {
      if (e.pointerId !== lookId) return;
      this.touch.lookX += e.clientX - lx;
      this.touch.lookY += e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
    });
    const endLook = (e) => { if (e.pointerId === lookId) lookId = null; };
    look.addEventListener('pointerup', endLook);
    look.addEventListener('pointercancel', endLook);

    document.querySelectorAll('.tbtn').forEach((b) => {
      const act = b.dataset.act;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.classList.add('down');
        try { b.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
        if (act === 'jump') { this.jumpPressed = true; this.touch.jumpHeld = true; }
        else if (act === 'power') this.emit('power');
        else if (act === 'rescue') this.emit('rescue');
        else if (act === 'interact') this.emit('interact');
        else if (act === 'sprint') { this.touch.sprint = !this.touch.sprint; b.classList.toggle('on', this.touch.sprint); }
        else if (act === 'pause') this.emit('pause');
      });
      const up = () => {
        b.classList.remove('down');
        if (act === 'jump') this.touch.jumpHeld = false;
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    });
    ['gesturestart', 'gesturechange', 'contextmenu', 'dblclick'].forEach((n) => document.addEventListener(n, (e) => e.preventDefault()));
  }

  requestLock() {
    if (!this.canLock) return;
    try {
      const p = this.el.requestPointerLock();
      if (p && p.catch) p.catch(() => (this.canLock = false));
    } catch (e) {
      this.canLock = false;
    }
  }
  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find((p) => p && p.connected);
    const p = this.pad;
    p.x = p.y = p.lx = p.ly = 0;
    p.sprint = p.jump = false;
    if (!gp) return;
    const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
    p.x = dz(gp.axes[0]);
    p.y = -dz(gp.axes[1]);
    p.lx = dz(gp.axes[2]);
    p.ly = dz(gp.axes[3]);
    const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    p.jump = b(0);
    p.sprint = b(10) || b(5);
    const prev = this.padPrev;
    const edge = (i, fn) => {
      if (b(i) && !prev[i]) fn();
    };
    if (this.enabled) {
      edge(0, () => (this.jumpPressed = true));
      edge(2, () => this.emit('power'));
      edge(1, () => this.emit('rescue'));
      edge(3, () => this.emit('interact'));
      edge(9, () => this.emit('pause'));
    }
    for (let i = 0; i < gp.buttons.length; i++) prev[i] = b(i);
  }

  getMove() {
    const k = this.keys;
    let x = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    let y = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    x += this.pad.x + this.touch.x;
    y += this.pad.y + this.touch.y;
    const jump = k.has('Space') || this.pad.jump || this.touch.jumpHeld;
    const out = {
      x: Math.max(-1, Math.min(1, x)),
      y: Math.max(-1, Math.min(1, y)),
      sprint: k.has('ShiftLeft') || k.has('ShiftRight') || this.pad.sprint || this.touch.sprint || this.touch.run,
      jump,
      jumpPressed: this.jumpPressed,
    };
    this.jumpPressed = false;
    return out;
  }

  getLook(dt) {
    const k = this.keys;
    let dx = this.lookX * 0.0026;
    let dy = this.lookY * 0.0022;
    this.lookX = this.lookY = 0;
    dx += ((k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0)) * dt * 2.0;
    dy += ((k.has('ArrowDown') ? 1 : 0) - (k.has('ArrowUp') ? 1 : 0)) * dt * 1.4;
    dx += this.touch.lookX * 0.0055;
    dy += this.touch.lookY * 0.0045;
    this.touch.lookX = this.touch.lookY = 0;
    dx += this.pad.lx * dt * 2.6;
    dy += this.pad.ly * dt * 1.8;
    const zoom = this.wheel * 0.7;
    this.wheel = 0;
    return { dx, dy, zoom };
  }
}
