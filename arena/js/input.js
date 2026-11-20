// Клавіатура, геймпад і сенсорне керування для телефона.
export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { steer: 0, throttle: 0, fire: false, alt: false, special: false, brake: false, boost: false };
    this.pressed = new Set(); // одноразові натискання
    this.isTouch = matchMedia('(pointer: coarse)').matches;
    addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    this.mouse = { l: false, r: false };
    addEventListener('mousedown', (e) => { if (e.target.id === 'game') { if (e.button === 0) this.mouse.l = true; if (e.button === 2) { this.mouse.r = true; this.pressed.add('Mouse2'); } } });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.l = false; if (e.button === 2) this.mouse.r = false; });
    addEventListener('contextmenu', (e) => { if (e.target.id === 'game') e.preventDefault(); });
    this.prevPad = {};
  }

  setupTouch(root) {
    const stick = root.querySelector('#stick'), knob = stick.querySelector('i');
    let sid = null, cx = 0, cy = 0;
    const R = 56;
    const move = (x, y) => {
      let dx = x - cx, dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const sx = dx / R, sy = -dy / R;
      this.touch.steer = Math.abs(sx) < 0.12 ? 0 : sx;
      this.touch.throttle = sy > 0.25 ? Math.min(1, (sy - 0.1) * 1.4) : sy < -0.35 ? -1 : 0;
      // невеликий кут угору — все одно газуємо, щоб було зручно кермувати
      if (Math.abs(sx) > 0.5 && sy > -0.35) this.touch.throttle = Math.max(this.touch.throttle, 0.85);
    };
    const zone = root.querySelector('#stickZone');
    zone.addEventListener('pointerdown', (e) => {
      sid = e.pointerId; zone.setPointerCapture(sid);
      const r = zone.getBoundingClientRect();
      cx = e.clientX; cy = e.clientY;
      stick.style.left = (cx - r.left) + 'px'; stick.style.top = (cy - r.top) + 'px';
      stick.classList.add('on');
      move(e.clientX, e.clientY - 30);
    });
    zone.addEventListener('pointermove', (e) => { if (e.pointerId === sid) move(e.clientX, e.clientY); });
    const end = (e) => {
      if (e.pointerId !== sid) return;
      sid = null; this.touch.steer = 0; this.touch.throttle = 0;
      knob.style.transform = ''; stick.classList.remove('on');
    };
    zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);

    root.querySelectorAll('[data-btn]').forEach((b) => {
      const k = b.dataset.btn;
      const on = (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); b.classList.add('down'); this.touch[k] = true; if (k === 'alt' || k === 'special' || k === 'next') this.pressed.add('T_' + k); };
      const off = () => { b.classList.remove('down'); this.touch[k] = false; };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off);
    });
  }

  read(out) {
    const K = (c) => this.keys.has(c);
    const P = (c) => this.pressed.has(c);
    let steer = (K('KeyD') || K('ArrowRight') ? 1 : 0) - (K('KeyA') || K('ArrowLeft') ? 1 : 0);
    let throttle = (K('KeyW') || K('ArrowUp') ? 1 : 0) - (K('KeyS') || K('ArrowDown') ? 1 : 0);
    let brake = K('Space'), boost = K('ShiftLeft') || K('ShiftRight');
    let fire = K('KeyJ') || K('ControlLeft') || this.mouse.l;
    let alt = P('KeyK') || P('Mouse2') || P('KeyF');
    let special = P('KeyL') || P('KeyE');
    let next = P('KeyQ') || P('KeyR');
    let look = K('KeyC');
    const t = this.touch;
    if (t.steer || t.throttle) { steer = t.steer; throttle = t.throttle; }
    brake = brake || t.brake; boost = boost || t.boost; fire = fire || t.fire;
    alt = alt || P('T_alt'); special = special || P('T_special'); next = next || P('T_next');

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find((p) => p && p.connected);
    if (gp) {
      const b = (i) => gp.buttons[i] && gp.buttons[i].pressed;
      const edge = (i) => { const v = b(i), was = this.prevPad[i]; this.prevPad[i] = v; return v && !was; };
      const ax = gp.axes[0] || 0;
      if (Math.abs(ax) > 0.15) steer = ax;
      const rt = gp.buttons[7] ? gp.buttons[7].value : 0, lt = gp.buttons[6] ? gp.buttons[6].value : 0;
      if (rt > 0.05 || lt > 0.05) throttle = rt - lt;
      brake = brake || b(0); boost = boost || b(4) || b(10);
      fire = fire || b(5) || b(2);
      alt = alt || edge(1); special = special || edge(3); next = next || edge(12) || edge(15);
      look = look || b(11);
      this.prevPad.scores = b(8) || b(9);
    }
    out.steer = Math.max(-1, Math.min(1, steer));
    out.throttle = Math.max(-1, Math.min(1, throttle));
    out.brake = brake; out.boost = boost; out.fire = fire; out.alt = alt; out.special = special;
    out.next = next; out.look = look;
    out.scores = K('Tab') || !!this.prevPad.scores;
    this.pressed.clear();
  }
}
