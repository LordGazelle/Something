// Снаряди та бонуси.
import * as THREE from '../vendor/three.module.min.js';
import { WEAPONS, MG } from './config.js';
import { canvasTex, retroMaterial } from './retro.js';

const v3 = new THREE.Vector3();

export const PROJ = {
  mg:     { speed: MG.speed, life: MG.life, dmg: MG.dmg, radius: 0 },
  homing: WEAPONS.homing,
  fire:   WEAPONS.fire,
  power:  WEAPONS.power,
  salvo:  { speed: 75, life: 2.2, dmg: 11, radius: 4, color: 0xff9a3c },
  mine:   WEAPONS.mine,
};

export class Projectiles {
  constructor(game) {
    this.game = game;
    this.list = new Map();
    const N = 512;
    this.tracerPos = new Float32Array(N * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracers = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xfff1a0 }));
    this.tracers.frustumCulled = false;
    this.tracerN = N;
    game.scene.add(this.tracers);
    this.rocketGeo = new THREE.BoxGeometry(0.28, 0.28, 1.1);
    this.finGeo = new THREE.BoxGeometry(0.7, 0.06, 0.3);
    this.mineGeo = new THREE.CylinderGeometry(0.7, 0.8, 0.28, 8);
    this.mineMat = retroMaterial(new THREE.MeshLambertMaterial({ color: 0x2a2a30, flatShading: true }));
  }

  spawn(id, owner, kind, p, v, target = null) {
    if (this.list.has(id)) return;
    const spec = PROJ[kind];
    const pr = { id, owner, kind, p: new THREE.Vector3(...p), v: new THREE.Vector3(...v), life: spec.life || 1, target, mesh: null, age: 0, spec };
    if (kind !== 'mg') {
      if (kind === 'mine') {
        const m = new THREE.Mesh(this.mineGeo, this.mineMat);
        const led = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 0.25), new THREE.MeshBasicMaterial({ color: 0xff2255 }));
        led.position.y = 0.2; m.add(led); pr.led = led;
        pr.p.y = this.game.world.ground(pr.p.x, pr.p.z, pr.p.y + 1) + 0.14;
        pr.v.set(0, 0, 0);
        m.position.copy(pr.p);
        pr.mesh = m;
      } else {
        const col = spec.color || 0xffffff;
        const m = new THREE.Group();
        const body = new THREE.Mesh(this.rocketGeo, new THREE.MeshBasicMaterial({ color: col }));
        const fin = new THREE.Mesh(this.finGeo, new THREE.MeshBasicMaterial({ color: 0x333333 })); fin.position.z = -0.4;
        m.add(body, fin);
        if (kind === 'power') m.scale.setScalar(1.8);
        m.position.copy(pr.p);
        pr.mesh = m;
        pr.color = new THREE.Color(col).toArray();
      }
      this.game.scene.add(pr.mesh);
    }
    this.list.set(id, pr);
    return pr;
  }

  remove(id) {
    const pr = this.list.get(id);
    if (!pr) return null;
    if (pr.mesh) this.game.scene.remove(pr.mesh);
    this.list.delete(id);
    return pr;
  }

  // auth: цей пір вирішує попадання (хост)
  update(dt, auth) {
    const game = this.game, world = game.world, fx = game.fx;
    let ti = 0;
    for (const pr of [...this.list.values()]) {
      pr.age += dt;
      if (pr.kind === 'mine') {
        pr.led.visible = (pr.age * 3 | 0) % 2 === 0;
        if (auth) {
          for (const c of game.cars.values()) {
            if (!c.alive || (c.id === pr.owner && pr.age < 2.5)) continue;
            if (pr.age < 0.6) continue;
            if (Math.hypot(c.pos.x - pr.p.x, c.pos.z - pr.p.z) < 2.6 && Math.abs(c.pos.y - pr.p.y) < 2) { game.projHit(pr, c, pr.p); break; }
          }
          if (pr.age > pr.life && this.list.has(pr.id)) game.projHit(pr, null, pr.p);
        }
        continue;
      }
      // самонаведення
      if (pr.kind === 'homing' && pr.target != null) {
        const t = game.cars.get(pr.target);
        if (t && t.alive) {
          v3.set(t.pos.x - pr.p.x, t.pos.y + 0.8 - pr.p.y, t.pos.z - pr.p.z).normalize().multiplyScalar(pr.spec.speed);
          pr.v.lerp(v3, Math.min(1, pr.spec.turn * dt * (pr.age < 0.25 ? 0.2 : 1)));
          pr.v.setLength(pr.spec.speed);
        }
      }
      if (pr.kind !== 'mg') pr.v.y -= (pr.kind === 'power' ? 3 : 0.6) * dt;
      const ox = pr.p.x, oy = pr.p.y, oz = pr.p.z;
      pr.p.addScaledVector(pr.v, dt);
      pr.life -= dt;

      // попадання в машину
      let hitCar = null, best = 2;
      for (const c of game.cars.values()) {
        if (!c.alive || c.id === pr.owner) continue;
        const t = segCircle(ox, oz, pr.p.x, pr.p.z, c.pos.x, c.pos.z, c.spec.size[0] * 0.5 + 0.9);
        if (t < 0 || t > best) continue;
        const y = oy + (pr.p.y - oy) * t;
        if (y < c.pos.y - 0.4 || y > c.pos.y + 2.6) continue;
        best = t; hitCar = c;
      }
      const wt = world.segmentBlocked(ox, oy, oz, pr.p.x, pr.p.y, pr.p.z);
      const gH = world.ground(pr.p.x, pr.p.z, pr.p.y);
      let impact = null;
      if (hitCar && (wt < 0 || best <= wt)) impact = { car: hitCar, t: best };
      else if (wt >= 0) impact = { car: null, t: wt };
      else if (pr.p.y < gH) impact = { car: null, t: 1 };
      if (impact) {
        const ip = new THREE.Vector3(ox + (pr.p.x - ox) * impact.t, oy + (pr.p.y - oy) * impact.t, oz + (pr.p.z - oz) * impact.t);
        if (pr.kind === 'mg') {
          fx.sparks(ip.x, ip.y, ip.z, impact.car ? 5 : 3);
          if (auth && impact.car) game.projHit(pr, impact.car, ip);
          this.remove(pr.id);
        } else if (auth) game.projHit(pr, impact.car, ip);
        else { pr.mesh.visible = false; pr.dead = true; }
        continue;
      }
      if (pr.life <= 0) {
        if (pr.kind !== 'mg' && auth) game.projHit(pr, null, pr.p);
        else this.remove(pr.id);
        continue;
      }
      if (pr.kind === 'mg') {
        if (ti < this.tracerN) {
          const k = ti * 6, len = 3.2 / pr.spec.speed;
          this.tracerPos[k] = pr.p.x - pr.v.x * len; this.tracerPos[k + 1] = pr.p.y - pr.v.y * len; this.tracerPos[k + 2] = pr.p.z - pr.v.z * len;
          this.tracerPos[k + 3] = pr.p.x; this.tracerPos[k + 4] = pr.p.y; this.tracerPos[k + 5] = pr.p.z;
          ti++;
        }
      } else if (!pr.dead) {
        pr.mesh.position.copy(pr.p);
        v3.copy(pr.p).add(pr.v);
        pr.mesh.lookAt(v3);
        fx.trail(pr.p.x, pr.p.y, pr.p.z, pr.color);
      }
      if (pr.dead && pr.age > 3) this.remove(pr.id);
    }
    this.tracerPos.fill(0, ti * 6);
    this.tracers.geometry.attributes.position.needsUpdate = true;
  }

  clear() { for (const id of [...this.list.keys()]) this.remove(id); }
}

// відрізок (a→b) проти кола; повертає параметр t першого перетину або -1
function segCircle(ax, az, bx, bz, cx, cz, r) {
  const dx = bx - ax, dz = bz - az, fx = ax - cx, fz = az - cz;
  const a = dx * dx + dz * dz, b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - r * r;
  if (c <= 0) return 0;
  if (a < 1e-9) return -1;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

// ---------------------------------------------------------------- бонуси
const KINDS = {
  weapon: { color: 0xff3355, glyph: '?', bg: '#c4122f' },
  health: { color: 0x33ff77, glyph: '+', bg: '#139a43' },
  turbo:  { color: 0x33c8ff, glyph: '»', bg: '#1468b8' },
};

export class Pickups {
  constructor(game) {
    this.game = game;
    this.items = [];
    const tex = {};
    for (const k in KINDS) {
      tex[k] = canvasTex(16, 16, (x, w, h) => {
        x.fillStyle = KINDS[k].bg; x.fillRect(0, 0, w, h);
        x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, 1); x.fillRect(0, h - 1, w, 1); x.fillRect(0, 0, 1, h); x.fillRect(w - 1, 0, 1, h);
        x.font = 'bold 13px monospace'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(KINDS[k].glyph, 8, 9);
      }, false);
    }
    game.world.pickupPts.forEach((pt, i) => {
      const kind = i === 0 || i >= 9 ? 'weapon' : ['weapon', 'health', 'turbo', 'weapon'][i % 4];
      const g = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 1.3), new THREE.MeshBasicMaterial({ map: tex[kind] }));
      const halo = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.5, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: KINDS[kind].color, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
      halo.position.y = -0.95;
      g.add(box, halo);
      g.position.set(pt.x, pt.y + 1.4, pt.z);
      game.scene.add(g);
      this.items.push({ i, kind, x: pt.x, y: pt.y, z: pt.z, g, box, active: true, t: 0 });
    });
  }
  set(i, active) { const it = this.items[i]; if (!it) return; it.active = active; it.g.visible = active; it.t = 0; }
  update(dt, auth) {
    const now = performance.now() / 1000;
    for (const it of this.items) {
      if (it.active) {
        it.box.rotation.y = now * 2 + it.i; it.box.rotation.x = Math.sin(now + it.i) * 0.3;
        it.g.position.y = it.y + 1.4 + Math.sin(now * 3 + it.i) * 0.2;
        if (auth) for (const c of this.game.cars.values()) {
          if (!c.alive) continue;
          if (Math.hypot(c.pos.x - it.x, c.pos.z - it.z) < 2.6 && Math.abs(c.pos.y - it.y) < 2.5) { this.game.takePickup(it, c); break; }
        }
      } else if (auth) {
        it.t += dt;
        if (it.t > 14) this.game.respawnPickup(it.i);
      }
    }
  }
}
