// Частинки, уламки з фізикою, сліди шин, вогняні кулі, ударні хвилі, блискавки.
import * as THREE from '../vendor/three.module.min.js';
import { retroMaterial } from './retro.js';

const PVS = `
attribute float size; attribute vec3 color; attribute float alpha;
varying vec3 vC; varying float vA;
uniform float uScale;
void main(){
  vC = color; vA = alpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale / max(-mv.z, 0.5);
  gl_Position = projectionMatrix * mv;
}`;
const PFS = `
varying vec3 vC; varying float vA;
uniform float uAlpha;
void main(){
  vec2 q = gl_PointCoord - 0.5;
  if (max(abs(q.x), abs(q.y)) > 0.5) discard;
  float a = vA * uAlpha;
  gl_FragColor = vec4(vC * a, a);
}`;

class Particles {
  constructor(scene, max, additive) {
    this.max = max; this.n = 0; this.head = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
    this.c = new Float32Array(max * 3); this.s = new Float32Array(max); this.a = new Float32Array(max);
    this.life = new Float32Array(max); this.age = new Float32Array(max);
    this.c0 = new Float32Array(max * 3); this.c1 = new Float32Array(max * 3);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.g = new Float32Array(max); this.drag = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.c, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.s, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.a, 1).setUsage(THREE.DynamicDrawUsage));
    this.uScale = { value: 300 };
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: this.uScale, uAlpha: { value: additive ? 1 : 0.55 } }, vertexShader: PVS, fragmentShader: PFS,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.geo = geo;
  }
  emit(x, y, z, vx, vy, vz, life, s0, s1, c0, c1, g = 0, drag = 0) {
    const i = this.head; this.head = (this.head + 1) % this.max;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.life[i] = life; this.age[i] = 0; this.s0[i] = s0; this.s1[i] = s1;
    this.c0[i * 3] = c0[0]; this.c0[i * 3 + 1] = c0[1]; this.c0[i * 3 + 2] = c0[2];
    this.c1[i * 3] = c1[0]; this.c1[i * 3 + 1] = c1[1]; this.c1[i * 3 + 2] = c1[2];
    this.g[i] = g; this.drag[i] = drag;
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] >= this.life[i]) { this.a[i] = 0; this.s[i] = 0; continue; }
      this.age[i] += dt;
      const t = Math.min(1, this.age[i] / this.life[i]);
      const k = Math.exp(-this.drag[i] * dt);
      this.v[i * 3] *= k; this.v[i * 3 + 1] = this.v[i * 3 + 1] * k - this.g[i] * dt; this.v[i * 3 + 2] *= k;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      if (this.p[i * 3 + 1] < 0.05) { this.p[i * 3 + 1] = 0.05; this.v[i * 3 + 1] *= -0.3; }
      for (let j = 0; j < 3; j++) this.c[i * 3 + j] = this.c0[i * 3 + j] + (this.c1[i * 3 + j] - this.c0[i * 3 + j]) * t;
      this.s[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.a[i] = t < 0.1 ? t * 10 : 1 - (t - 0.1) / 0.9;
    }
    for (const k of ['position', 'color', 'size', 'alpha']) this.geo.attributes[k].needsUpdate = true;
  }
}

const rnd = (a = 1) => (Math.random() - 0.5) * 2 * a;
const FIRE0 = [1.0, 0.85, 0.3], FIRE1 = [0.9, 0.15, 0.02], SMOKE0 = [0.25, 0.22, 0.24], SMOKE1 = [0.08, 0.07, 0.08];

export class FX {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    this.add = new Particles(scene, 2600, true);
    this.norm = new Particles(scene, 2200, false);
    this.debris = [];
    this.balls = [];
    this.rings = [];
    this.bolts = [];
    this.shake = 0;
    this.camPos = new THREE.Vector3();
    this.ballGeo = new THREE.IcosahedronGeometry(1, 1);
    this.ringGeo = new THREE.RingGeometry(0.85, 1, 24);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.chunkGeo = new THREE.BoxGeometry(0.4, 0.3, 0.5);
    this.chunkMat = retroMaterial(new THREE.MeshLambertMaterial({ color: 0x2b2522, flatShading: true }));
    this.plankMat = retroMaterial(new THREE.MeshLambertMaterial({ color: 0x8a5d2c, flatShading: true }));

    // сліди шин — пул пласких квадів
    this.skidN = 700; this.skidI = 0;
    this.skids = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.42, 0.9).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x050505, transparent: true, opacity: 0.55, depthWrite: false }), this.skidN);
    this.skids.frustumCulled = false;
    const z = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.skidN; i++) this.skids.setMatrixAt(i, z);
    scene.add(this.skids);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3(1, 1, 1); this._p = new THREE.Vector3();
  }

  setScale(h) { this.add.uScale.value = h * 0.7; this.norm.uScale.value = h * 0.55; }

  skid(x, y, z, yaw) {
    this._p.set(x, y + 0.03, z);
    this._q.setFromEuler(this._e.set(0, yaw, 0));
    this._m.compose(this._p, this._q, this._s);
    this.skids.setMatrixAt(this.skidI, this._m);
    this.skidI = (this.skidI + 1) % this.skidN;
    this.skids.instanceMatrix.needsUpdate = true;
  }

  sparks(x, y, z, n = 8, nx = 0, nz = 0) {
    for (let i = 0; i < n; i++) this.add.emit(x, y, z, nx * 6 + rnd(9), Math.random() * 7, nz * 6 + rnd(9), 0.25 + Math.random() * 0.3, 0.35, 0.05, [1, 0.95, 0.6], [1, 0.4, 0.05], 18, 1);
  }
  smoke(x, y, z, k = 1) {
    this.norm.emit(x + rnd(0.3), y, z + rnd(0.3), rnd(0.6), 2 + Math.random() * 1.5, rnd(0.6), 1.6 + Math.random(), 0.8 * k, 3 * k, SMOKE0, SMOKE1, -0.5, 0.6);
  }
  fire(x, y, z, k = 1) {
    this.add.emit(x + rnd(0.4), y, z + rnd(0.4), rnd(0.8), 2.5 + Math.random() * 2, rnd(0.8), 0.35 + Math.random() * 0.3, 1.2 * k, 0.3, FIRE0, FIRE1, -1, 1);
  }
  dust(x, y, z, k = 1) {
    this.norm.emit(x + rnd(0.5), y + 0.2, z + rnd(0.5), rnd(1.5), 0.8 + Math.random(), rnd(1.5), 0.8 + Math.random() * 0.5, 0.6 * k, 2.2 * k, [0.42, 0.36, 0.4], [0.2, 0.18, 0.2], 0, 1.5);
  }
  muzzle(x, y, z) { this.add.emit(x, y, z, 0, 0, 0, 0.06, 0.9, 0.4, [1, 0.95, 0.6], [1, 0.6, 0.1]); }
  trail(x, y, z, color) {
    this.add.emit(x, y, z, rnd(0.5), rnd(0.5), rnd(0.5), 0.25, 0.8, 0.1, color, [0.8, 0.2, 0.05]);
    this.norm.emit(x, y, z, rnd(0.4), 0.6, rnd(0.4), 0.9, 0.4, 1.6, [0.45, 0.42, 0.45], [0.12, 0.1, 0.12]);
  }

  explosion(x, y, z, size = 1) {
    const s = size;
    for (let i = 0; i < 46 * s; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.3, sp = (4 + Math.random() * 12) * s;
      this.add.emit(x, y + 0.5, z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp, Math.sin(a) * Math.cos(e) * sp, 0.5 + Math.random() * 0.6, 2.2 * s, 0.3, FIRE0, FIRE1, 4, 2.5);
    }
    for (let i = 0; i < 26 * s; i++) {
      const a = Math.random() * Math.PI * 2, sp = (2 + Math.random() * 6) * s;
      this.norm.emit(x, y + 0.6, z, Math.cos(a) * sp, 2 + Math.random() * 5, Math.sin(a) * sp, 1.5 + Math.random() * 1.5, 2 * s, 6 * s, SMOKE0, SMOKE1, -0.6, 1.2);
    }
    this.sparks(x, y + 0.5, z, 24 * s);
    for (let i = 0; i < 5 * s; i++) {
      const m = new THREE.Mesh(this.chunkGeo, this.chunkMat);
      m.scale.setScalar(0.6 + Math.random());
      this.addDebris(m, x, y + 0.6, z, rnd(12 * s), 6 + Math.random() * 10 * s, rnd(12 * s), 5, true);
    }
    // вогняна куля
    const ball = new THREE.Mesh(this.ballGeo, new THREE.MeshBasicMaterial({ color: 0xffc040, transparent: true, depthWrite: false }));
    ball.position.set(x, y + 0.8, z);
    this.scene.add(ball);
    this.balls.push({ m: ball, t: 0, life: 0.45, r: 3.2 * s });
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    ring.position.set(x, this.world.ground(x, z, y + 1) + 0.1, z);
    this.scene.add(ring);
    this.rings.push({ m: ring, t: 0, life: 0.5, r: 9 * s });
    const d = this.camPos.distanceTo(ring.position);
    this.shake = Math.max(this.shake, Math.min(1.2, 18 * s / (d + 6)));
  }

  shockwave(x, y, z, r) {
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xb388ff, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    ring.position.set(x, y + 0.4, z);
    this.scene.add(ring);
    this.rings.push({ m: ring, t: 0, life: 0.45, r });
    for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; this.add.emit(x, y + 0.5, z, Math.cos(a) * 30, 1, Math.sin(a) * 30, 0.45, 1.2, 0.2, [0.8, 0.6, 1], [0.3, 0.1, 0.8], 0, 1.5); }
  }

  bolt(ax, ay, az, bx, by, bz) {
    const pts = [];
    const N = 10;
    for (let i = 0; i <= N; i++) {
      const t = i / N, j = i === 0 || i === N ? 0 : 1.2;
      pts.push(new THREE.Vector3(ax + (bx - ax) * t + rnd(j), ay + (by - ay) * t + rnd(j), az + (bz - az) * t + rnd(j)));
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xaaf6ff }));
    this.scene.add(line);
    this.bolts.push({ m: line, t: 0, life: 0.25 });
    for (let i = 0; i < 16; i++) this.add.emit(bx, by, bz, rnd(8), rnd(8), rnd(8), 0.3, 0.8, 0.1, [0.7, 1, 1], [0.2, 0.4, 1]);
  }

  // уламок: будь-який меш, що падає, відскакує й лежить
  addDebris(mesh, x, y, z, vx, vy, vz, life = 14, owned = false, burning = 0) {
    if (x !== undefined && x !== null) mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.debris.push({ m: mesh, vx, vy, vz, wx: rnd(9), wy: rnd(9), wz: rnd(9), t: 0, life, owned, burning, rest: false });
    if (this.debris.length > 160) this.killDebris(0);
  }
  killDebris(i) {
    const d = this.debris[i];
    this.scene.remove(d.m);
    if (d.owned) d.m.traverse((o) => { if (o.geometry && o.geometry !== this.chunkGeo) o.geometry.dispose(); });
    this.debris.splice(i, 1);
  }

  update(dt) {
    this.add.update(dt); this.norm.update(dt);
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i], m = d.m;
      d.t += dt;
      if (d.t > d.life) {
        m.scale.multiplyScalar(0.9);
        if (m.scale.x < 0.05) { this.killDebris(i); continue; }
      }
      if (d.burning > 0) {
        d.burning -= dt;
        if (Math.random() < 0.5) this.fire(m.position.x, m.position.y + 0.3, m.position.z, 0.8);
        if (Math.random() < 0.3) this.smoke(m.position.x, m.position.y + 0.5, m.position.z, 1.2);
      }
      if (d.rest) continue;
      d.vy -= 24 * dt;
      m.position.x += d.vx * dt; m.position.y += d.vy * dt; m.position.z += d.vz * dt;
      m.rotation.x += d.wx * dt; m.rotation.y += d.wy * dt; m.rotation.z += d.wz * dt;
      const gh = this.world.ground(m.position.x, m.position.z, m.position.y) + 0.15;
      if (m.position.y < gh) {
        m.position.y = gh;
        if (Math.abs(d.vy) > 2.5) {
          d.vy *= -0.35; d.vx *= 0.6; d.vz *= 0.6; d.wx *= 0.5; d.wy *= 0.5; d.wz *= 0.5;
          if (Math.random() < 0.5) this.sparks(m.position.x, gh, m.position.z, 3);
        } else {
          d.vy = 0; d.vx *= 0.8; d.vz *= 0.8; d.wx *= 0.7; d.wz *= 0.7; d.wy *= 0.7;
          if (Math.abs(d.vx) + Math.abs(d.vz) < 0.3) {
            d.rest = true;
            // лягти «плиском»
            m.rotation.x = Math.round(m.rotation.x / (Math.PI / 2)) * (Math.PI / 2);
            m.rotation.z = Math.round(m.rotation.z / (Math.PI / 2)) * (Math.PI / 2);
          }
        }
      }
      // відбиття від стін
      const p = m.position;
      const tmp = { x: p.x, z: p.z }, o = {};
      if (this.world.collideCircle(tmp, 0.3, p.y, o)) {
        p.x = tmp.x; p.z = tmp.z;
        const vn = d.vx * o.nx + d.vz * o.nz;
        if (vn < 0) { d.vx -= 1.6 * vn * o.nx; d.vz -= 1.6 * vn * o.nz; }
      }
    }
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i]; b.t += dt;
      const t = b.t / b.life;
      b.m.scale.setScalar(b.r * (0.4 + t * 0.9));
      b.m.material.opacity = 1 - t;
      b.m.material.color.setRGB(1, 0.85 - t * 0.6, 0.3 - t * 0.3);
      if (t >= 1) { this.scene.remove(b.m); b.m.material.dispose(); this.balls.splice(i, 1); }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.t += dt;
      const t = r.t / r.life;
      r.m.scale.setScalar(r.r * (0.2 + t));
      r.m.material.opacity = 1 - t;
      if (t >= 1) { this.scene.remove(r.m); r.m.material.dispose(); this.rings.splice(i, 1); }
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i]; b.t += dt;
      b.m.visible = Math.random() > 0.3;
      if (b.t >= b.life) { this.scene.remove(b.m); b.m.geometry.dispose(); b.m.material.dispose(); this.bolts.splice(i, 1); }
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
  }
}
