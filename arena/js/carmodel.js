// Низькополігональна модель машини з деталей, що відриваються,
// і кузовом, який м’ється в точці удару.
import * as THREE from '../vendor/three.module.min.js';
import { retroMaterial } from './retro.js';

const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();

function mat(color, vc = false) {
  return retroMaterial(new THREE.MeshLambertMaterial({ color, flatShading: true, vertexColors: vc }));
}
function withColors(g) {
  const n = g.attributes.position.count;
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  g.userData.orig = g.attributes.position.array.slice();
  return g;
}
function box(w, h, d, m, sx = 1, sy = 1, sz = 1) {
  return new THREE.Mesh(withColors(new THREE.BoxGeometry(w, h, d, sx, sy, sz)), m);
}

export class CarModel {
  constructor(spec, color) {
    this.spec = spec;
    this.root = new THREE.Group();
    this.tilt = new THREE.Group();
    this.root.add(this.tilt);
    this.parts = [];
    this.dentables = [];
    this.wheels = [];
    this.mats = [];
    const [w, h, l] = spec.size, wr = spec.wheelR;
    const bodyY = wr + h / 2 - 0.02;
    this.bodyY = bodyY;
    const top = bodyY + h / 2;

    const bodyMat = mat(color, true), darkMat = mat(new THREE.Color(color).multiplyScalar(0.7), true),
      trimMat = mat(spec.trim, true), glassMat = mat(0x1a2433, true), tireMat = mat(0x151515), hubMat = mat(0x9a9aa8),
      headMat = new THREE.MeshBasicMaterial({ color: 0xfff3b0 }), tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
    this.mats.push(bodyMat, darkMat, trimMat, glassMat);

    // кузов з сегментами — щоб вм’ятини виглядали «рвано»
    this.body = box(w, h, l, bodyMat, 3, 2, 6);
    this.body.position.y = bodyY;
    this.tilt.add(this.body);
    this.dentables.push(this.body);

    const [cw, ch, cl] = spec.cabin;
    const cg = new THREE.BoxGeometry(cw, ch, cl, 2, 1, 2);
    const cp = cg.attributes.position;
    for (let i = 0; i < cp.count; i++) if (cp.getY(i) > 0) { cp.setX(i, cp.getX(i) * 0.86); cp.setZ(i, cp.getZ(i) * 0.78); }
    this.cabin = new THREE.Mesh(withColors(cg), glassMat);
    this.cabin.position.set(0, top + ch / 2 - 0.02, spec.cabinZ);
    this.tilt.add(this.cabin);
    this.dentables.push(this.cabin);
    // дах кольору кузова
    const roof = box(cw * 0.8, 0.1, cl * 0.72, bodyMat);
    roof.position.y = ch / 2 + 0.03;
    this.cabin.add(roof);

    const part = (name, mesh, hp, x, y, z, dent = true) => {
      mesh.position.set(x, y, z);
      this.tilt.add(mesh);
      const p = { name, mesh, hp, max: hp, center: new THREE.Vector3(x, y, z), attached: true };
      this.parts.push(p);
      if (dent) this.dentables.push(mesh);
      return p;
    };

    const hood = part('hood', box(w * 0.94, 0.14, l * 0.3, bodyMat, 2, 1, 2), 14, 0, top + 0.06, l * 0.33);
    part('trunk', box(w * 0.92, 0.14, l * 0.2, bodyMat), 14, 0, top + 0.06, -l * 0.39);
    const bf = part('bumperF', box(w * 1.04, 0.34, 0.32, trimMat), 10, 0, wr * 0.85, l / 2 + 0.12);
    const br = part('bumperR', box(w * 1.04, 0.34, 0.32, trimMat), 10, 0, wr * 0.85, -l / 2 - 0.12);
    part('doorL', box(0.14, h * 0.8, l * 0.32, darkMat), 16, -w / 2 - 0.06, bodyY, spec.cabinZ);
    part('doorR', box(0.14, h * 0.8, l * 0.32, darkMat), 16, w / 2 + 0.06, bodyY, spec.cabinZ);

    // фари / стопи летять разом з бамперами
    for (const s of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.06), headMat); hl.position.set(s * w * 0.34, 0.12, 0.17); bf.mesh.add(hl);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.06), tailMat); tl.position.set(s * w * 0.34, 0.12, -0.17); br.mesh.add(tl);
    }
    // кулемети на капоті
    for (const s of [-1, 1]) {
      const gun = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.9), hubMat);
      gun.position.set(s * w * 0.28, 0.14, 0.15); hood.mesh.add(gun);
    }

    // індивідуальні деталі
    const t = spec.special;
    if (t === 'salvo') {
      const sp = box(w * 0.95, 0.09, 0.45, trimMat);
      for (const s of [-1, 1]) { const post = box(0.08, 0.35, 0.08, trimMat); post.position.set(s * w * 0.35, -0.2, 0); sp.add(post); }
      part('spoiler', sp, 8, 0, top + 0.45, -l / 2 + 0.25);
      const pod = box(0.6, 0.35, 0.9, trimMat); for (const s of [-1, 1]) { const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.95, 6), hubMat); tube.rotation.x = Math.PI / 2; tube.position.set(s * 0.15, 0.05, 0.05); pod.add(tube); }
      part('pod', pod, 10, 0, top + spec.cabin[1] + 0.25, spec.cabinZ);
    } else if (t === 'ram') {
      const plow = box(w * 1.35, 1.1, 0.28, mat(0x777780, true), 3, 2, 1);
      plow.rotation.x = -0.25;
      part('plow', plow, 26, 0, wr + 0.35, l / 2 + 0.55);
      const st = new THREE.Group();
      for (const s of [-1, 1]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.7, 6), hubMat); c.position.set(s * spec.cabin[0] * 0.42, 0, 0); st.add(c); }
      part('stacks', st, 8, 0, top + 0.9, spec.cabinZ - spec.cabin[2] / 2 - 0.15, false);
    } else if (t === 'zap') {
      const cage = new THREE.Group();
      const bar = (x, y, z, sx, sy, sz) => { const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), trimMat); b.position.set(x, y, z); cage.add(b); };
      for (const s of [-1, 1]) { bar(s * 0.7, 0.45, 0.6, 0.1, 0.9, 0.1); bar(s * 0.7, 0.45, -0.6, 0.1, 0.9, 0.1); bar(s * 0.7, 0.9, 0, 0.1, 0.1, 1.3); }
      bar(0, 0.9, 0.6, 1.5, 0.1, 0.1); bar(0, 0.9, -0.6, 1.5, 0.1, 0.1);
      const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.3, 0.7, 6), new THREE.MeshBasicMaterial({ color: 0x8ff7ff })); coil.position.y = 1.25; cage.add(coil);
      part('cage', cage, 12, 0, top, spec.cabinZ, false);
      const wing = box(w * 1.1, 0.08, 0.6, bodyMat);
      for (const s of [-1, 1]) { const post = box(0.07, 0.6, 0.07, trimMat); post.position.set(s * 0.5, -0.3, 0); wing.add(post); }
      part('wing', wing, 8, 0, top + 0.6, -l / 2 + 0.2);
    } else if (t === 'minefield') {
      const rack = new THREE.Group();
      for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(spec.cabin[0] * 0.9, 0.08, 0.08), hubMat); b.position.set(0, 0, (i - 1) * 0.8); rack.add(b); }
      const cof = box(0.7, 0.35, 1.8, mat(0x3a2a1a, true)); cof.position.y = 0.2; rack.add(cof);
      part('rack', rack, 10, 0, top + spec.cabin[1] + 0.12, spec.cabinZ, false);
      for (const s of [-1, 1]) {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, l * 0.55, 6), hubMat); pipe.rotation.x = Math.PI / 2;
        part(s < 0 ? 'pipeL' : 'pipeR', pipe, 8, s * (w / 2 + 0.16), wr * 0.7, 0, false);
      }
    }

    // колеса: передні на шарнірі повороту
    const wg = new THREE.CylinderGeometry(wr, wr, 0.46, 8);
    wg.rotateZ(Math.PI / 2);
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const pivot = new THREE.Group();
      const tire = new THREE.Mesh(wg, tireMat);
      const hub = new THREE.Mesh(new THREE.BoxGeometry(0.48, wr * 0.9, wr * 0.35), hubMat);
      tire.add(hub);
      pivot.add(tire);
      const pp = part('wheel', pivot, 30, sx * (w / 2 + 0.08), wr, sz * l * 0.32, false);
      pp.front = sz > 0; pp.tire = tire;
      this.wheels.push(pp);
    }
    this.radius = Math.hypot(w, l) / 2;
  }

  // вм’ятина: точка lp і напрям ld у системі машини
  dent(lp, ld, strength, radius = 1.3) {
    for (const m of this.dentables) {
      if (!m.parent || m.parent !== this.tilt) continue;
      const g = m.geometry, pos = g.attributes.position, col = g.attributes.color, orig = g.userData.orig;
      if (!orig) continue;
      const ox = lp.x - m.position.x, oy = lp.y - m.position.y, oz = lp.z - m.position.z;
      let changed = false;
      for (let i = 0; i < pos.count; i++) {
        const dx = pos.getX(i) - ox, dy = pos.getY(i) - oy, dz = pos.getZ(i) - oz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > radius) continue;
        const k = (1 - d / radius) ** 2 * strength;
        let nx = pos.getX(i) + ld.x * k, ny = pos.getY(i) + ld.y * k * 0.7, nz = pos.getZ(i) + ld.z * k;
        // не даємо кузову вивернутися навиворіт
        const lim = 0.55;
        nx = Math.max(orig[i * 3] - lim, Math.min(orig[i * 3] + lim, nx));
        ny = Math.max(orig[i * 3 + 1] - lim, Math.min(orig[i * 3 + 1] + lim, ny));
        nz = Math.max(orig[i * 3 + 2] - lim, Math.min(orig[i * 3 + 2] + lim, nz));
        pos.setXYZ(i, nx, ny, nz);
        if (col) { const c = Math.max(0.25, col.getX(i) - k * 0.5); col.setXYZ(i, c, c * 0.95, c * 0.9); }
        changed = true;
      }
      if (changed) { pos.needsUpdate = true; if (col) col.needsUpdate = true; g.computeBoundingSphere(); }
    }
  }

  // пошкодження найближчої деталі; повертає відірвані меші
  hitPart(lp, amount, allowWheels) {
    let best = null, bd = 1e9;
    for (const p of this.parts) {
      if (!p.attached) continue;
      if (p.name === 'wheel' && !allowWheels) continue;
      const d = p.center.distanceTo(lp);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best || bd > 2.6) return [];
    best.hp -= amount;
    if (best.hp > 0) {
      // деталь «висне»: трохи перекошуємо
      best.mesh.rotation.z += (Math.random() - 0.5) * 0.08 * amount / 10;
      best.mesh.rotation.x += (Math.random() - 0.5) * 0.06 * amount / 10;
      return [];
    }
    return [this.detach(best)];
  }

  detach(p) {
    p.attached = false;
    const m = p.mesh;
    m.updateWorldMatrix(true, false);
    m.matrixWorld.decompose(tmpV, tmpQ, tmpS);
    m.parent.remove(m);
    m.position.copy(tmpV); m.quaternion.copy(tmpQ);
    return m;
  }

  detachAll() {
    const out = [];
    for (const p of this.parts) if (p.attached) out.push(this.detach(p));
    return out;
  }

  burn(f) {
    for (const m of this.mats) m.color.lerp(new THREE.Color(0x141210), f);
  }

  updateWheels(steer, spin) {
    for (const wh of this.wheels) {
      if (!wh.attached) continue;
      if (wh.front) wh.mesh.rotation.y = steer * 0.45;
      wh.tire.rotation.x = spin;
    }
  }
}
