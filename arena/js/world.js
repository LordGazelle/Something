// Арена: індустріальний квартал на заході сонця.
// Колізії: прямокутники (AABB) з висотою «даху» + рампи з аналітичною висотою.
import * as THREE from '../vendor/three.module.min.js';
import { retroMaterial, canvasTex, rng } from './retro.js';

export const HALF = 120;

function lambert(opts) { return retroMaterial(new THREE.MeshLambertMaterial({ flatShading: true, ...opts })); }

// UV у світових одиницях, щоб текстура не розтягувалась
function boxGeo(w, h, d, scale = 4) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    uv.setXY(i, uv.getX(i) * dims[f][0] / scale, uv.getY(i) * dims[f][1] / scale);
  }
  return g;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.boxes = [];   // {x0,x1,z0,z1,top}
    this.ramps = [];   // {x,z,dx,dz,L,W,H}
    this.props = [];
    this.pickupPts = [];
    this.spawns = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.r = rng(1337);
    this.makeTextures();
    this.build();
  }

  makeTextures() {
    const R = rng(7);
    this.tex = {
      asphalt: canvasTex(64, 64, (x, w, h) => {
        x.fillStyle = '#2a2730'; x.fillRect(0, 0, w, h);
        for (let i = 0; i < 700; i++) { const v = 30 + R() * 40 | 0; x.fillStyle = `rgb(${v},${v - 4},${v + 6})`; x.fillRect(R() * w | 0, R() * h | 0, 1, 1); }
        x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(0, 0, w, 1); x.fillRect(0, 0, 1, h);
      }),
      concrete: canvasTex(32, 32, (x, w, h) => {
        x.fillStyle = '#6c6574'; x.fillRect(0, 0, w, h);
        for (let i = 0; i < 260; i++) { const v = 85 + R() * 40 | 0; x.fillStyle = `rgb(${v},${v - 8},${v + 4})`; x.fillRect(R() * w | 0, R() * h | 0, 1, 1); }
        x.fillStyle = '#4b4552'; x.fillRect(0, h - 2, w, 2); x.fillRect(w - 1, 0, 1, h);
      }),
      windows: canvasTex(32, 32, (x, w, h) => {
        x.fillStyle = '#3a3346'; x.fillRect(0, 0, w, h);
        for (let yy = 3; yy < h; yy += 8) for (let xx = 2; xx < w; xx += 8) {
          const lit = R() < 0.35;
          x.fillStyle = lit ? (R() < 0.5 ? '#ffd27a' : '#ff9d5c') : '#1b1726';
          x.fillRect(xx, yy, 5, 4);
        }
      }),
      hazard: canvasTex(32, 32, (x, w, h) => {
        x.fillStyle = '#1a1a1a'; x.fillRect(0, 0, w, h);
        x.fillStyle = '#f2b600';
        for (let i = -h; i < w; i += 16) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 8, 0); x.lineTo(i + 8 + h, h); x.lineTo(i + h, h); x.fill(); }
      }),
      crate: canvasTex(16, 16, (x, w, h) => {
        x.fillStyle = '#9a6a35'; x.fillRect(0, 0, w, h);
        x.fillStyle = '#6e4620'; x.fillRect(0, 0, w, 2); x.fillRect(0, h - 2, w, 2); x.fillRect(0, 0, 2, h); x.fillRect(w - 2, 0, 2, h);
        for (let i = 0; i < w; i++) x.fillRect(i, i, 1, 1), x.fillRect(i, h - 1 - i, 1, 1);
      }, false),
      container: canvasTex(16, 16, (x, w, h) => {
        x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
        x.fillStyle = 'rgba(0,0,0,.28)'; for (let i = 0; i < w; i += 3) x.fillRect(i, 0, 1, h);
      }),
    };
  }

  addBox(cx, cz, w, d, h, mat, scale) {
    const m = new THREE.Mesh(boxGeo(w, h, d, scale), mat);
    m.position.set(cx, h / 2, cz);
    this.group.add(m);
    this.boxes.push({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, top: h });
    return m;
  }

  addRamp(x, z, ang, L, W, H) {
    const dx = Math.sin(ang), dz = Math.cos(ang);
    this.ramps.push({ x, z, dx, dz, L, W, H });
    const hw = W / 2;
    // клин: низький край у (x,z), високий — на відстані L по напрямку
    const p = (u, v, y) => [x + dx * u + dz * v, y, z + dz * u - dx * v];
    const A = p(0, -hw, 0), B = p(0, hw, 0), C = p(L, -hw, 0), D = p(L, hw, 0), E = p(L, -hw, H), F = p(L, hw, H);
    const tris = [A, E, F, A, F, B, C, D, F, C, F, E, A, C, E, B, F, D];
    const uvs = [0, 0, 0, 4, 1.5, 4, 0, 0, 1.5, 4, 1.5, 0, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, this.mat.ramp);
    mesh.material.side = THREE.DoubleSide;
    this.group.add(mesh);
  }

  build() {
    const T = this.tex, R = this.r;
    T.asphalt.repeat.set(HALF / 4, HALF / 4);
    this.mat = {
      ground: lambert({ map: T.asphalt }),
      wall: lambert({ map: T.concrete, color: 0xb9aec6 }),
      building: lambert({ map: T.windows, color: 0xffffff }),
      ramp: lambert({ map: T.hazard }),
      platform: lambert({ map: T.concrete, color: 0x9a8fb0 }),
      line: new THREE.MeshBasicMaterial({ color: 0xd9c25a }),
    };

    // земля
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + 40, HALF * 2 + 40), this.mat.ground);
    ground.rotation.x = -Math.PI / 2;
    this.group.add(ground);
    // дорожня розмітка — кільце навколо центру
    for (let a = 0; a < 48; a++) {
      const an = a / 48 * Math.PI * 2;
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 3), this.mat.line);
      s.rotation.x = -Math.PI / 2; s.rotation.z = -an;
      s.position.set(Math.cos(an) * 52, 0.02, Math.sin(an) * 52);
      this.group.add(s);
    }

    // периметр
    const H = HALF;
    this.addBox(0, -H - 2, H * 2 + 8, 4, 9, this.mat.wall, 6);
    this.addBox(0, H + 2, H * 2 + 8, 4, 9, this.mat.wall, 6);
    this.addBox(-H - 2, 0, 4, H * 2 + 8, 9, this.mat.wall, 6);
    this.addBox(H + 2, 0, 4, H * 2 + 8, 9, this.mat.wall, 6);

    // кутові будівлі
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz], i) => {
      this.addBox(sx * 92, sz * 92, 34, 34, 22 + i * 3, this.mat.building, 8);
      this.addBox(sx * 66, sz * 100, 14, 18, 12, this.mat.building, 8);
    });
    // бічні цехи
    this.addBox(-100, 0, 22, 34, 15, this.mat.building, 8);
    this.addBox(100, 0, 22, 34, 15, this.mat.building, 8);

    // центральна платформа «пагорб» з чотирма рампами
    this.addBox(0, 0, 26, 26, 3.6, this.mat.platform, 4);
    this.addRamp(0, 33, Math.PI, 20, 10, 3.6);
    this.addRamp(0, -33, 0, 20, 10, 3.6);
    this.addRamp(33, 0, -Math.PI / 2, 20, 10, 3.6);
    this.addRamp(-33, 0, Math.PI / 2, 20, 10, 3.6);

    // контейнери (на них можна заскочити з трампліна)
    const contColors = [0xc0392b, 0x2c6fbb, 0x2e9e6a, 0xd68a1c, 0x8e44ad];
    const conts = [[-60, -40, 1], [-48, -40, 1], [60, 40, 1], [48, 40, 1], [-30, 75, 0], [30, -75, 0], [-75, 55, 0], [75, -55, 0]];
    conts.forEach(([x, z, rot], i) => {
      const mat = lambert({ map: T.container, color: contColors[i % contColors.length] });
      if (rot) this.addBox(x, z, 5, 13, 5, mat, 2); else this.addBox(x, z, 13, 5, 5, mat, 2);
    });
    // трампліни для стрибків на контейнери й через проїзди
    this.addRamp(-54, -18, Math.PI, 12, 7, 3.2);
    this.addRamp(54, 18, 0, 12, 7, 3.2);
    this.addRamp(-60, 72, Math.PI / 2, 14, 8, 3.4);
    this.addRamp(60, -72, -Math.PI / 2, 14, 8, 3.4);

    // руйнівні об’єкти
    const crateMat = lambert({ map: T.crate });
    const barrelMat = lambert({ color: 0xc8261b });
    const bandMat = lambert({ color: 0xf2d43a });
    const poleMat = lambert({ color: 0x3b3646 });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
    const coneMat = lambert({ color: 0xff6a00 });
    const crateGeo = new THREE.BoxGeometry(1.7, 1.7, 1.7);
    const barrelGeo = new THREE.CylinderGeometry(0.6, 0.6, 1.4, 8);
    const coneGeo = new THREE.ConeGeometry(0.4, 1.0, 6);

    const addProp = (type, x, z, rot = 0) => {
      const g = new THREE.Group();
      let r = 1, h = 1.7;
      if (type === 'crate') {
        const n = 1 + (R() * 2 | 0);
        for (let i = 0; i < n; i++) { const m = new THREE.Mesh(crateGeo, crateMat); m.position.y = 0.85 + i * 1.7; m.rotation.y = R() * 0.4; g.add(m); }
        r = 1.1; h = n * 1.7;
      } else if (type === 'barrel') {
        const m = new THREE.Mesh(barrelGeo, barrelMat); m.position.y = 0.7; g.add(m);
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.25, 8), bandMat); b.position.y = 0.95; g.add(b);
        r = 0.75; h = 1.4;
      } else if (type === 'lamp') {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 7, 5), poleMat); p.position.y = 3.5; g.add(p);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 1.8), poleMat); arm.position.set(0, 6.9, 0.8); g.add(arm);
        const l = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.25, 0.9), lampMat); l.position.set(0, 6.75, 1.5); g.add(l);
        r = 0.35; h = 7;
      } else if (type === 'cone') {
        const m = new THREE.Mesh(coneGeo, coneMat); m.position.y = 0.5; g.add(m);
        r = 0.45; h = 1;
      }
      g.position.set(x, 0, z); g.rotation.y = rot;
      this.group.add(g);
      this.props.push({ type, x, z, r, h, mesh: g, alive: true, idx: this.props.length });
    };

    // ліхтарі по колу
    for (let a = 0; a < 16; a++) {
      const an = a / 16 * Math.PI * 2 + 0.1;
      addProp('lamp', Math.cos(an) * 60, Math.sin(an) * 60, -an + Math.PI / 2);
    }
    // ящики й бочки купками
    const clusters = [[-30, -30], [30, 30], [-30, 30], [30, -30], [-85, -45], [85, 45], [-15, -95], [15, 95], [-100, 50], [100, -50], [-45, 100], [45, -100], [0, -60], [0, 60]];
    clusters.forEach(([cx, cz], i) => {
      const n = 3 + (R() * 4 | 0);
      for (let k = 0; k < n; k++) {
        const t = R() < 0.35 ? 'barrel' : 'crate';
        addProp(t, cx + (R() - 0.5) * 7, cz + (R() - 0.5) * 7, R() * 3);
      }
      if (i % 2 === 0) for (let k = 0; k < 4; k++) addProp('cone', cx + 6 + k * 1.5, cz - 5, 0);
    });

    // точки бонусів і появи
    this.pickupPts = [[0, 0, 4.4], [-40, 0, 0], [40, 0, 0], [0, -46, 0], [0, 46, 0], [-80, -75, 0], [80, 75, 0], [-80, 75, 0], [80, -75, 0],
      [-54, -40, 5.6], [54, 40, 5.6], [-105, -100, 0], [105, 100, 0], [-30, -100, 0], [30, 100, 0]]
      .map(([x, z, y]) => ({ x, z, y: y || 0 }));
    for (let a = 0; a < 12; a++) {
      const an = a / 12 * Math.PI * 2;
      const r = a % 2 ? 78 : 44;
      this.spawns.push({ x: Math.cos(an) * r, z: Math.sin(an) * r, yaw: Math.atan2(-Math.cos(an), -Math.sin(an)) });
    }

    this.buildSky();
  }

  buildSky() {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 16, 12), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP;
        void main(){
          float y = vP.y;
          vec3 top = vec3(0.05,0.03,0.18), mid = vec3(0.55,0.12,0.42), hor = vec3(1.0,0.45,0.25);
          vec3 c = y > 0.12 ? mix(mid, top, smoothstep(0.12, 0.6, y)) : mix(hor, mid, smoothstep(-0.02, 0.12, y));
          // сонце з ретро-смугами
          vec3 sd = normalize(vec3(0.0, 0.08, -1.0));
          float d = distance(vP, sd);
          float stripes = step(0.5, fract((vP.y - 0.02) * 70.0)) + step(0.13, vP.y);
          if(d < 0.16 && (vP.y > 0.08 || stripes > 0.5)) c = mix(vec3(1.0,0.85,0.3), vec3(1.0,0.3,0.45), smoothstep(0.24, -0.02, vP.y));
          c += vec3(1.0,0.5,0.4) * exp(-d*6.0) * 0.25;
          gl_FragColor = vec4(pow(c, vec3(2.2)), 1.0);
        }`,
    }));
    this.scene.add(sky);
    // силует міста за стінами
    const silMat = new THREE.MeshBasicMaterial({ map: this.tex.windows, color: 0x6a5a88, fog: true });
    const R = rng(99);
    for (let i = 0; i < 70; i++) {
      const an = i / 70 * Math.PI * 2, dist = 170 + R() * 80;
      const w = 12 + R() * 22, h = 20 + R() * 70;
      const g = boxGeo(w, h, w, 8);
      const m = new THREE.Mesh(g, silMat);
      m.position.set(Math.cos(an) * dist, h / 2, Math.sin(an) * dist);
      m.rotation.y = -an;
      this.scene.add(m);
    }
  }

  // висота опори під точкою для об’єкта на висоті y
  ground(x, z, y = 0) {
    let h = 0;
    for (const b of this.boxes) {
      if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && b.top <= y + 0.9 && b.top > h) h = b.top;
    }
    for (const r of this.ramps) {
      const rx = x - r.x, rz = z - r.z;
      const u = rx * r.dx + rz * r.dz;
      if (u < 0 || u > r.L) continue;
      const v = rx * r.dz - rz * r.dx;
      if (Math.abs(v) > r.W / 2) continue;
      const rh = r.H * u / r.L;
      if (rh > h) h = rh;
    }
    return h;
  }

  // штовхнути коло з прямокутників-стін; повертає нормаль і глибину найсильнішого контакту
  collideCircle(p, r, y, out) {
    let hit = false;
    out.nx = 0; out.nz = 0; out.depth = 0;
    for (const b of this.boxes) {
      if (b.top <= y + 0.9) continue;
      const cx = Math.max(b.x0, Math.min(p.x, b.x1));
      const cz = Math.max(b.z0, Math.min(p.z, b.z1));
      let dx = p.x - cx, dz = p.z - cz;
      let d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      let d = Math.sqrt(d2), nx, nz, depth;
      if (d < 1e-4) {
        // центр усередині — виштовхуємо через найближчу грань
        const l = p.x - b.x0, rr = b.x1 - p.x, t = p.z - b.z0, bb = b.z1 - p.z;
        const m = Math.min(l, rr, t, bb);
        if (m === l) { nx = -1; nz = 0; depth = l + r; } else if (m === rr) { nx = 1; nz = 0; depth = rr + r; }
        else if (m === t) { nx = 0; nz = -1; depth = t + r; } else { nx = 0; nz = 1; depth = bb + r; }
      } else { nx = dx / d; nz = dz / d; depth = r - d; }
      p.x += nx * depth; p.z += nz * depth;
      if (depth > out.depth) { out.nx = nx; out.nz = nz; out.depth = depth; }
      hit = true;
    }
    return hit;
  }

  // перетин відрізка з будівлями (для снарядів і «видимості» ботів)
  segmentBlocked(ax, ay, az, bx, by, bz) {
    for (const b of this.boxes) {
      let t0 = 0, t1 = 1;
      const dx = bx - ax, dz = bz - az;
      const sl = [[ax, dx, b.x0, b.x1], [az, dz, b.z0, b.z1]];
      let ok = true;
      for (const [a, d, mn, mx] of sl) {
        if (Math.abs(d) < 1e-6) { if (a < mn || a > mx) { ok = false; break; } continue; }
        let ta = (mn - a) / d, tb = (mx - a) / d;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) { ok = false; break; }
      }
      if (!ok) continue;
      const yAt = ay + (by - ay) * t0;
      if (yAt < b.top) return t0;
    }
    return -1;
  }

  insideSolid(x, y, z) {
    for (const b of this.boxes) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && y < b.top) return true;
    return y < this.ground(x, z, y) - 0.05;
  }
}
