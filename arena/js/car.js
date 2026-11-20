// Машина: аркадна фізика з заносами, стрибками й ударами + візуальний стан.
import * as THREE from '../vendor/three.module.min.js';
import { CARS } from './config.js';
import { CarModel } from './carmodel.js';

const G = 26;
const tmp = { x: 0, z: 0 }, hitOut = {};

export class Car {
  constructor(game, { id, type, name, bot = false, local = false }) {
    this.game = game;
    this.id = id; this.type = type; this.spec = CARS[type]; this.name = name;
    this.bot = bot; this.local = local;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.angVel = 0; this.pitch = 0; this.roll = 0; this.bounce = 0; this.bounceV = 0;
    this.onGround = true; this.alive = false;
    this.hp = this.spec.hp; this.boost = 1;
    this.weapons = {}; this.wsel = null;
    this.specialT = 4; this.mgT = 0; this.burnT = 0; this.burnBy = null; this.invuln = 0; this.ramT = 0;
    this.kills = 0; this.deaths = 0;
    this.input = { throttle: 0, steer: 0, brake: false, boost: false, fire: false, alt: false, special: false };
    this.flags = 0;
    this.buf = [];
    this.spin = 0; this.steerVis = 0; this.lastSkid = new THREE.Vector3(); this.fxT = 0;
    this.lastHitBy = null; this.lastHitT = 0;
    this.makeTag();
  }

  makeTag() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 24;
    const x = c.getContext('2d');
    x.font = '14px "Press Start 2P", monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = 'rgba(0,0,0,.55)'; const w = Math.min(124, x.measureText(this.name).width + 10); x.fillRect(64 - w / 2, 2, w, 20);
    x.fillStyle = this.bot ? '#ffb347' : '#7df9ff'; x.fillText(this.name, 64, 13);
    const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    this.tag.scale.set(4.4, 0.85, 1);
    this.tag.renderOrder = 10;
    this.game.scene.add(this.tag);
  }

  buildModel() {
    this.model = new CarModel(this.spec, this.spec.color);
    this.game.scene.add(this.model.root);
  }

  spawn(x, z, yaw) {
    if (this.model) this.game.scene.remove(this.model.root);
    this.buildModel(); // завжди свіжий, неушкоджений кузов
    const y = this.game.world.ground(x, z, 10);
    this.pos.set(x, y, z); this.vel.set(0, 0, 0);
    this.yaw = yaw; this.angVel = 0; this.pitch = 0; this.roll = 0;
    this.hp = this.spec.hp; this.alive = true; this.onGround = true;
    this.boost = 1; this.burnT = 0; this.invuln = 2.5; this.ramT = 0;
    this.weapons = {}; this.wsel = null;
    this.specialT = Math.min(this.specialT, 5);
    this.buf.length = 0;
    this.syncModel(0);
  }

  // ---------------------------------------------------------------- фізика (лише для «своїх» машин)
  step(dt) {
    const s = this.spec, inp = this.input, world = this.game.world;
    if (!this.alive) return;
    this.invuln = Math.max(0, this.invuln - dt);
    this.ramT = Math.max(0, this.ramT - dt);
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = -fz, rz = fx;
    let vF = this.vel.x * fx + this.vel.z * fz;
    let vR = this.vel.x * rx + this.vel.z * rz;
    const boosting = inp.boost && this.boost > 0.02 && this.onGround !== null;
    if (boosting) this.boost = Math.max(0, this.boost - dt * 0.38); else this.boost = Math.min(1, this.boost + dt * 0.07);
    this.boosting = boosting;
    const maxS = s.maxSpeed * (boosting ? 1.35 : 1) * (this.ramT > 0 ? 1.35 : 1);

    if (this.onGround) {
      let acc = 0;
      const th = inp.throttle;
      if (th > 0) acc = vF < -0.5 ? 48 * th : s.accel * th * Math.max(0, 1 - vF / maxS) * (vF < maxS * 0.35 ? 1.3 : 1);
      else if (th < 0) acc = vF > 0.5 ? 48 * th : s.accel * 0.65 * th * Math.max(0, 1 + vF / (maxS * 0.42));
      if (boosting || this.ramT > 0) acc += s.accel * 0.9 * Math.max(0, 1 - vF / maxS);
      vF += acc * dt;
      if (!th) vF -= vF * 0.55 * dt;
      vF -= vF * Math.abs(vF) * 0.002 * dt;
      let grip = s.grip;
      if (inp.brake) { grip *= 0.16; vF -= vF * 0.45 * dt; }
      if (Math.abs(vR) > 8) grip *= 0.55; // зрив у ковзання — плавний занос
      vR *= Math.exp(-grip * dt);
      const sp = Math.abs(vF);
      const sf = Math.min(1, sp / 5) * (1 - 0.48 * Math.min(1, sp / s.maxSpeed));
      const target = -inp.steer * s.steer * sf * (vF < -0.5 ? -1 : 1) * (inp.brake ? 1.5 : 1);
      this.angVel += (target - this.angVel) * Math.min(1, 8 * dt);
      // кермо «тягне» частину бокової швидкості вперед — машина виходить із заносу
      if (!inp.brake) { const t = Math.min(1, 1.5 * dt); vF += Math.abs(vR) * t * 0.25 * Math.sign(vF || 1); }
    } else {
      this.angVel += (-inp.steer * 1.4 - this.angVel) * Math.min(1, 1.5 * dt);
    }
    this.yaw += this.angVel * dt;
    this.vel.x = fx * vF + rx * vR;
    this.vel.z = fz * vF + rz * vR;
    this.vF = vF; this.vR = vR;

    // горизонтальний рух зі сходинками (боки рамп — як стіни)
    let nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    const y = this.pos.y;
    if (world.ground(nx, nz, y) > y + 0.85) {
      const bx = world.ground(nx, this.pos.z, y) > y + 0.85, bz = world.ground(this.pos.x, nz, y) > y + 0.85;
      if (bx || !bz) { nx = this.pos.x; this.vel.x *= -0.25; }
      if (bz || !bx) { nz = this.pos.z; this.vel.z *= -0.25; }
      this.crash(Math.hypot(this.vel.x, this.vel.z) * 0.5);
    }
    this.pos.x = nx; this.pos.z = nz;

    const g = world.ground(this.pos.x, this.pos.z, this.pos.y);
    if (this.onGround) {
      if (g >= this.pos.y - 0.45) {
        this.vel.y = Math.min(25, (g - this.pos.y) / dt);
        this.pos.y = g;
      } else this.onGround = false;
    }
    if (!this.onGround) {
      this.vel.y -= G * dt;
      this.pos.y += this.vel.y * dt;
      if (this.pos.y <= g) {
        const impact = -this.vel.y;
        this.pos.y = g; this.vel.y = 0; this.onGround = true;
        this.bounceV -= impact * 0.06;
        if (impact > 6) { this.game.onLand(this, impact); }
      }
    }

    // стіни: два кола вздовж машини
    const off = s.size[2] * 0.26, r = s.size[0] * 0.55;
    let hitN = null, hitD = 0, lever = 0;
    for (const sgn of [1, -1]) {
      tmp.x = this.pos.x + fx * off * sgn; tmp.z = this.pos.z + fz * off * sgn;
      const ox = tmp.x, oz = tmp.z;
      if (world.collideCircle(tmp, r, this.pos.y, hitOut)) {
        this.pos.x += tmp.x - ox; this.pos.z += tmp.z - oz;
        if (hitOut.depth > hitD) { hitD = hitOut.depth; hitN = { x: hitOut.nx, z: hitOut.nz }; lever = sgn; }
      }
    }
    if (hitN) {
      const vn = this.vel.x * hitN.x + this.vel.z * hitN.z;
      if (vn < 0) {
        this.vel.x -= 1.3 * vn * hitN.x; this.vel.z -= 1.3 * vn * hitN.z;
        this.vel.x *= 0.9; this.vel.z *= 0.9;
        // удар кутом розвертає машину
        const lx = fx * off * lever, lz = fz * off * lever;
        const jx = -vn * hitN.x, jz = -vn * hitN.z;
        this.angVel += (lz * jx - lx * jz) * 0.12;
        this.crash(-vn, this.pos.x - hitN.x * r, this.pos.y + 0.8, this.pos.z - hitN.z * r, hitN.x, hitN.z);
      }
    }

    this.pos.x = Math.max(-125, Math.min(125, this.pos.x));
    this.pos.z = Math.max(-125, Math.min(125, this.pos.z));
    if (this.pos.y < -5) this.pos.y = world.ground(this.pos.x, this.pos.z, 20);

    this.flags = (boosting ? 1 : 0) | (inp.brake ? 2 : 0) | (this.onGround ? 4 : 0) | (this.ramT > 0 ? 8 : 0);
  }

  crash(speed, x, y, z, nx, nz) {
    if (speed < 13) return;
    this.game.onCrash(this, speed, x ?? this.pos.x, y ?? this.pos.y + 0.8, z ?? this.pos.z, nx || 0, nz || 0);
  }

  mass() { return this.spec.mass * (this.ramT > 0 ? 2.5 : 1); }

  // кола для зіткнень машина-машина
  circles() {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), off = this.spec.size[2] * 0.26, r = this.spec.size[0] * 0.58;
    return [[this.pos.x + fx * off, this.pos.z + fz * off, r], [this.pos.x - fx * off, this.pos.z - fz * off, r]];
  }

  // ---------------------------------------------------------------- мережева інтерполяція
  pushState(t, a) {
    // a: [x,y,z,yaw,pitch,roll,vx,vy,vz,flags]
    this.buf.push({ t, a });
    if (this.buf.length > 12) this.buf.shift();
  }
  interpolate(now) {
    const b = this.buf;
    if (!b.length) return;
    const rt = now - 110;
    let i = b.length - 1;
    while (i > 0 && b[i - 1].t > rt) i--;
    const A = i > 0 ? b[i - 1] : b[0], B = b[i];
    let k = B.t === A.t ? 1 : (rt - A.t) / (B.t - A.t);
    let ext = 0;
    if (k > 1) { ext = Math.min(0.15, (rt - B.t) / 1000); k = 1; }
    k = Math.max(0, k);
    const a = A.a, c = B.a;
    const L = (u, v) => u + (v - u) * k;
    let dy = c[3] - a[3]; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.pos.set(L(a[0], c[0]) + c[6] * ext, L(a[1], c[1]) + c[7] * ext, L(a[2], c[2]) + c[8] * ext);
    this.yaw = a[3] + dy * k;
    this.pitch = L(a[4], c[4]); this.roll = L(a[5], c[5]);
    this.vel.set(c[6], c[7], c[8]);
    this.flags = c[9];
    this.onGround = !!(c[9] & 4); this.boosting = !!(c[9] & 1); this.ramT = (c[9] & 8) ? 0.1 : 0;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    this.vF = this.vel.x * fx + this.vel.z * fz;
    this.vR = this.vel.x * -fz + this.vel.z * fx;
  }
  stateArr() {
    const r = (v) => Math.round(v * 100) / 100;
    return [r(this.pos.x), r(this.pos.y), r(this.pos.z), r(this.yaw), r(this.pitch), r(this.roll), r(this.vel.x), r(this.vel.y), r(this.vel.z), this.flags];
  }

  // ---------------------------------------------------------------- вигляд
  syncModel(dt) {
    const m = this.model;
    if (!m) return;
    const world = this.game.world;
    if (this.local && dt > 0) {
      // нахил по рельєфу та від бокового прискорення
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), L = this.spec.size[2] * 0.4;
      let tp, tr;
      if (this.onGround) {
        const hf = world.ground(this.pos.x + fx * L, this.pos.z + fz * L, this.pos.y + 0.5);
        const hb = world.ground(this.pos.x - fx * L, this.pos.z - fz * L, this.pos.y + 0.5);
        tp = -Math.atan2(hf - hb, 2 * L);
        tr = Math.max(-0.12, Math.min(0.12, this.angVel * (this.vF || 0) * 0.004));
      } else {
        tp = Math.max(-0.5, Math.min(0.5, -this.vel.y * 0.025));
        tr = this.roll * 0.98;
      }
      this.pitch += (tp - this.pitch) * Math.min(1, 10 * dt);
      this.roll += (tr - this.roll) * Math.min(1, 6 * dt);
    }
    // пружна підвіска
    this.bounceV += (-this.bounce * 140 - this.bounceV * 9) * dt;
    this.bounce += this.bounceV * dt;
    m.root.position.copy(this.pos);
    m.root.rotation.y = this.yaw;
    m.tilt.rotation.set(this.pitch, 0, this.roll);
    m.tilt.position.y = this.bounce;
    this.spin += (this.vF || 0) * dt / this.spec.wheelR;
    this.steerVis += ((this.local ? this.input.steer : -this.angVel * 0.4) * -1 - this.steerVis) * Math.min(1, 10 * dt);
    m.updateWheels(this.steerVis, this.spin);
    m.root.visible = !(this.invuln > 0 && this.alive && (performance.now() / 90 | 0) % 2 === 0);
  }

  updateFx(dt, fx) {
    this.tag.visible = this.alive && !this.isMe;
    this.tag.position.set(this.pos.x, this.pos.y + 3.6, this.pos.z);
    if (!this.alive || !this.model) return;
    this.fxT += dt;
    const fxv = Math.sin(this.yaw), fzv = Math.cos(this.yaw), L = this.spec.size[2];
    const hood = [this.pos.x + fxv * L * 0.3, this.pos.y + 1.4, this.pos.z + fzv * L * 0.3];
    const hpf = this.hp / this.spec.hp;
    if (this.fxT > 0.05) {
      this.fxT = 0;
      if (hpf < 0.55) fx.smoke(...hood, hpf < 0.3 ? 1.4 : 0.8);
      if (hpf < 0.28 || this.burnT > 0) { fx.fire(...hood); fx.fire(...hood, 0.7); }
      if (this.boosting || (this.ramT > 0 && this.flags & 8)) {
        const bx = this.pos.x - fxv * L * 0.55, bz = this.pos.z - fzv * L * 0.55;
        fx.add.emit(bx, this.pos.y + 0.6, bz, -fxv * 8, 0.5, -fzv * 8, 0.18, 1.2, 0.2, this.ramT > 0 ? [1, 0.4, 0.2] : [0.5, 0.8, 1], [0.2, 0.2, 1]);
      }
    }
    // сліди шин і пил у заносі
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const sliding = this.onGround && (Math.abs(this.vR || 0) > 4.5 || (this.flags & 2 && sp > 8));
    if (sliding && this.pos.distanceTo(this.lastSkid) > 0.7) {
      this.lastSkid.copy(this.pos);
      const w = this.spec.size[0] * 0.5, back = L * 0.32;
      for (const s of [-1, 1]) {
        const x = this.pos.x - fxv * back - fzv * w * s, z = this.pos.z - fzv * back + fxv * w * s;
        fx.skid(x, this.pos.y, z, this.yaw);
        if (Math.random() < 0.5) fx.dust(x, this.pos.y, z, 0.8);
      }
    }
  }

  explode() {
    const fx = this.game.fx, m = this.model;
    if (!m) return;
    const parts = m.detachAll();
    for (const p of parts) {
      const a = Math.random() * Math.PI * 2;
      fx.addDebris(p, null, null, null, this.vel.x * 0.5 + Math.cos(a) * (6 + Math.random() * 10), 8 + Math.random() * 12, this.vel.z * 0.5 + Math.sin(a) * (6 + Math.random() * 10), 16, true, Math.random() < 0.4 ? 3 : 0);
    }
    m.burn(0.85);
    // обгорілий кістяк підкидає в повітря і він ще горить
    fx.addDebris(m.root, null, null, null, this.vel.x * 0.4, 11, this.vel.z * 0.4, 14, true, 9);
    this.model = null;
    this.alive = false;
  }

  dispose() {
    if (this.model) { this.game.scene.remove(this.model.root); this.model = null; }
    this.game.scene.remove(this.tag);
  }
}
