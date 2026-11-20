// БРУХТ — арена залізного хаосу. Головний модуль: стан гри, хост-логіка, мережа, камера, HUD.
import * as THREE from '../vendor/three.module.min.js';
import { CARS, CAR_IDS, WEAPONS, WEAPON_IDS, MG, MATCH, BOT_NAMES } from './config.js';
import { RetroRenderer } from './retro.js';
import { World } from './world.js';
import { FX } from './fx.js';
import { Car } from './car.js';
import { CarModel } from './carmodel.js';
import { Projectiles, Pickups, PROJ } from './weapons.js';
import { Bot } from './ai.js';
import { Net, makeCode } from './net.js';
import { Sound } from './audio.js';
import { Input } from './input.js';

const $ = (s) => document.querySelector(s);
const DT = 1 / 60;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const store = {
  get(k, d) { try { const v = localStorage.getItem('brukht.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('brukht.' + k, JSON.stringify(v)); } catch (e) {} },
};

class Game {
  constructor() {
    this.canvas = $('#game');
    this.rr = new RetroRenderer(this.canvas);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x4a2550, 80, 340);
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 900);
    this.scene.add(new THREE.HemisphereLight(0xc6a8ff, 0x5a3020, 1.25));
    const sun = new THREE.DirectionalLight(0xffb27a, 2.1);
    sun.position.set(-0.25, 0.45, -1);
    this.scene.add(sun);

    this.world = new World(this.scene);
    this.fx = new FX(this.scene, this.world);
    this.proj = new Projectiles(this);
    this.pickups = new Pickups(this);
    this.sound = new Sound();
    this.input = new Input();
    this.cars = new Map();
    this.bots = new Map();
    this.state = 'menu';
    this.isHost = true;
    this.net = null;
    this.myId = null;
    this.peerCar = new Map();
    this.respawnQ = [];
    this.pairCd = new Map();
    this.pn = 0;
    this.timeLeft = MATCH.time;
    this.over = false;
    this.camYaw = 0; this.hurt = 0; this.deadT = 0;
    this.inp = {};
    this.lastSnap = 0; this.lastSt = 0;
    this.carType = store.get('car', 'grim');
    if (!CARS[this.carType]) this.carType = 'grim';
    this.botCount = store.get('bots', 4);
    this.quality = store.get('quality', 300);
    this.rr.setQuality(this.quality);
    this.fx.setScale(this.rr.rt.height);

    this.setupMenu();
    this.setupHud();
    addEventListener('resize', () => this.onResize());
    this.onResize();
    this.acc = 0; this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    $('#loading').remove();
  }

  onResize() {
    this.rr.resize();
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.fx.setScale(this.rr.rt.height);
  }

  get me() { return this.cars.get(this.myId); }

  // ================================================================== МЕНЮ
  setupMenu() {
    const nick = $('#nick');
    nick.value = store.get('nick', BOT_NAMES[Math.random() * BOT_NAMES.length | 0].toUpperCase());
    nick.addEventListener('input', () => store.set('nick', nick.value));
    const show = () => {
      const s = CARS[this.carType];
      $('#carName').textContent = s.name; $('#carDesc').textContent = s.desc; $('#carSp').textContent = s.specialName;
      const names = ['ШВИДКІСТЬ', 'БРОНЯ', 'КЕРОВАНІСТЬ'];
      $('#carStats').innerHTML = s.stats.map((v, i) => `<div class="stat"><span>${names[i]}</span><div class="bar">${[1, 2, 3, 4, 5].map((k) => `<i class="${k <= v ? 'on' : ''}"></i>`).join('')}</div></div>`).join('');
      this.showcase();
      store.set('car', this.carType);
    };
    const step = (d) => { const i = CAR_IDS.indexOf(this.carType); this.carType = CAR_IDS[(i + d + CAR_IDS.length) % CAR_IDS.length]; show(); this.sound.init(); this.sound.play('pickup', 0.5); };
    $('#carPrev').onclick = () => step(-1);
    $('#carNext').onclick = () => step(1);
    show();

    const seg = $('#botSeg');
    [0, 1, 2, 3, 4, 5, 6].forEach((n) => {
      const b = document.createElement('button'); b.textContent = n;
      b.className = n === this.botCount ? 'on' : '';
      b.onclick = () => { this.botCount = n; store.set('bots', n); [...seg.children].forEach((x) => x.classList.toggle('on', x === b)); };
      seg.appendChild(b);
    });
    const qb = $('#btnQuality');
    const ql = [220, 300, 420];
    const showQ = () => { qb.textContent = 'ПІКСЕЛІ: ' + ({ 220: 'ГРУБІ', 300: 'РЕТРО', 420: 'ЧІТКІ' })[this.quality]; };
    showQ();
    qb.onclick = () => { this.quality = ql[(ql.indexOf(this.quality) + 1) % ql.length]; store.set('quality', this.quality); this.rr.setQuality(this.quality); this.onResize(); showQ(); };

    $('#btnSolo').onclick = () => this.startSolo();
    $('#btnHost').onclick = () => this.startHost();
    $('#btnJoin').onclick = () => this.startJoin($('#joinCode').value.trim());
    const jc = $('#joinCode');
    jc.addEventListener('input', () => { jc.value = jc.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    const q = new URLSearchParams(location.search).get('join');
    if (q) { jc.value = q.toUpperCase(); this.menuMsg('Тебе запросили в кімнату ' + q.toUpperCase() + ' — тисни «ПРИЄДНАТИСЯ»'); }
  }

  menuMsg(t, err) { const m = $('#menuMsg'); m.textContent = t; m.classList.toggle('err', !!err); }

  showcase() {
    if (this.preview) this.scene.remove(this.preview.root);
    this.preview = new CarModel(CARS[this.carType], CARS[this.carType].color);
    this.preview.root.position.set(0, 3.6, 0);
    this.scene.add(this.preview.root);
  }

  myName() { return ($('#nick').value.trim() || 'ГРАВЕЦЬ').toUpperCase().slice(0, 12); }

  beginPlay() {
    this.sound.init();
    if (this.preview) { this.scene.remove(this.preview.root); this.preview = null; }
    $('#menu').hidden = true; $('#hud').hidden = false;
    document.body.classList.add('playing');
    if (this.input.isTouch) { $('#touch').hidden = false; document.body.classList.add('touch'); this.input.setupTouch($('#touch')); }
    try { if (this.input.isTouch && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {}); } catch (e) {}
    try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}); } catch (e) {}
    this.state = 'play';
    this.updateWeaponHud();
  }

  startSolo() {
    this.isHost = true; this.net = null;
    this.beginPlay();
    this.hostSetup();
  }

  async startHost() {
    this.sound.init();
    const btn = $('#btnHost'); btn.disabled = true;
    this.menuMsg('Створюю кімнату…');
    const net = new Net();
    let code;
    for (let i = 0; i < 3; i++) {
      try { code = await net.host(makeCode()); break; } catch (e) {
        if (i === 2 || (e.type && e.type !== 'unavailable-id')) { btn.disabled = false; this.menuMsg('Не вдалося створити кімнату: ' + (e.message || e.type), true); return; }
      }
    }
    this.net = net; this.isHost = true;
    net.onJoin = (pid) => {};
    net.onMessage = (pid, m) => this.onHostMsg(pid, m);
    net.onLeave = (pid) => {
      const id = this.peerCar.get(pid);
      if (id != null) { const c = this.cars.get(id); this.peerCar.delete(pid); this.emit({ t: 'rm', id }); if (c) this.feed(`<b>${esc(c.name)}</b> вийшов`); }
    };
    this.roomCode = code;
    this.beginPlay();
    this.hostSetup();
    $('#roomBadge').hidden = false; $('#roomCode').textContent = code;
    this.toast('Кімната ' + code + ' — натисни «ЗАПРОСИТИ»', 4);
  }

  async startJoin(code) {
    this.sound.init();
    if (code.length < 4) return this.menuMsg('Введи код кімнати (5 символів)', true);
    const btn = $('#btnJoin'); btn.disabled = true;
    this.menuMsg('Під’єднуюсь до ' + code + '…');
    const net = new Net();
    try { await net.join(code); } catch (e) {
      btn.disabled = false; net.close();
      return this.menuMsg((e.message || 'Помилка з’єднання') + '. Перевір код.', true);
    }
    this.net = net; this.isHost = false; this.roomCode = code.toUpperCase();
    net.onMessage = (pid, m) => this.onClientMsg(m);
    net.onClosed = () => this.lost('Хост завершив гру або зв’язок обірвався');
    net.send({ t: 'hello', name: this.myName(), car: this.carType });
    this.menuMsg('Чекаю на хост…');
    this.joinTimer = setTimeout(() => { if (this.state !== 'play') { btn.disabled = false; this.menuMsg('Хост не відповів', true); net.close(); } }, 10000);
  }

  lost(msg) {
    if (this.state !== 'play') return;
    this.state = 'lost';
    $('#scoresTitle').textContent = 'ЗВ’ЯЗОК ВТРАЧЕНО';
    $('#scoresBody').innerHTML = '';
    $('#scoresNote').innerHTML = esc(msg) + '<br><br><button class="pix-btn" onclick="location.href=location.pathname">У МЕНЮ</button>';
    $('#scores').hidden = false;
  }

  // ================================================================== ХОСТ
  hostSetup() {
    this.myId = 1;
    this.nextId = 2;
    this.addCar({ id: 1, type: this.carType, name: this.myName(), bot: false }, true);
    const used = new Set();
    for (let i = 0; i < this.botCount; i++) {
      let nm; do { nm = BOT_NAMES[Math.random() * BOT_NAMES.length | 0]; } while (used.has(nm) && used.size < BOT_NAMES.length);
      used.add(nm);
      this.addCar({ id: 100 + i, type: CAR_IDS[Math.random() * CAR_IDS.length | 0], name: nm.toUpperCase(), bot: true }, true);
    }
    for (const c of this.cars.values()) this.hostRespawn(c, true);
    this.timeLeft = MATCH.time; this.over = false;
  }

  addCar(info, local) {
    if (this.cars.has(info.id)) return this.cars.get(info.id);
    const c = new Car(this, { id: info.id, type: info.type, name: info.name, bot: info.bot, local });
    c.kills = info.kills || 0; c.deaths = info.deaths || 0;
    c.isMe = info.id === this.myId;
    this.cars.set(info.id, c);
    if (info.bot && local) this.bots.set(info.id, new Bot(c, this));
    return c;
  }
  removeCar(id) {
    const c = this.cars.get(id);
    if (!c) return;
    if (c.alive) { c.explode(); this.fx.explosion(c.pos.x, c.pos.y, c.pos.z, 1); }
    c.dispose(); this.cars.delete(id); this.bots.delete(id);
  }
  carInfo(c) { return { id: c.id, type: c.type, name: c.name, bot: c.bot, kills: c.kills, deaths: c.deaths, alive: c.alive, hp: c.hp, s: c.stateArr() }; }

  emit(m) {
    this.handle(m);
    if (this.net && this.isHost) this.net.broadcast(m);
  }

  onHostMsg(pid, m) {
    const id = this.peerCar.get(pid);
    const c = id != null ? this.cars.get(id) : null;
    switch (m.t) {
      case 'hello': {
        if (id != null) return;
        if (this.cars.size >= MATCH.maxPlayers + 2) { this.net.sendTo(pid, { t: 'full' }); return; }
        // якщо гравців забагато — прибираємо бота
        const humans = [...this.cars.values()].filter((x) => !x.bot).length;
        if (this.cars.size >= MATCH.maxPlayers) { const b = [...this.cars.values()].find((x) => x.bot); if (b) this.emit({ t: 'rm', id: b.id }); }
        void humans;
        const nid = this.nextId++;
        this.peerCar.set(pid, nid);
        const type = CARS[m.car] ? m.car : 'grim';
        const name = String(m.name || 'ГРАВЕЦЬ').slice(0, 12).toUpperCase();
        const nc = this.addCar({ id: nid, type, name, bot: false }, false);
        this.net.sendTo(pid, {
          t: 'welcome', you: nid, tl: this.timeLeft,
          cars: [...this.cars.values()].map((x) => this.carInfo(x)),
          props: this.world.props.filter((p) => !p.alive).map((p) => p.idx),
          picks: this.pickups.items.map((it) => it.active ? 1 : 0),
        });
        this.net.broadcast({ t: 'add', car: this.carInfo(nc) }, pid);
        this.feed(`<b>${esc(name)}</b> у грі!`);
        this.hostRespawn(nc, true);
        this.updateRoomInfo();
        break;
      }
      case 'st': if (c) c.pushState(performance.now(), m.s); break;
      case 'fire':
        if (!c || !c.alive) return;
        this.proj.spawn(m.id, c.id, m.k, m.p, m.v, m.tg);
        this.fireSound(c, m.k);
        this.net.broadcast(m, pid);
        break;
      case 'act': if (c && c.alive) this.doAct(c, m.k, m.y); break;
      case 'prop': this.hostBreakProp(m.i, m.v, c ? c.id : null); break;
      case 'crash': if (c && c.alive) this.damage(c, crashDmg(m.a, c), new THREE.Vector3(...m.p), m.n[0], m.n[1], null, 'crash'); break;
      case 'ram': if (c && c.alive) c.ramT = 2.6; break;
    }
  }

  hostRespawn(c, immediate) {
    // найвіддаленіша від суперників точка
    let best = this.world.spawns[0], bs = -1;
    for (const s of this.world.spawns) {
      let md = 1e9;
      for (const o of this.cars.values()) if (o !== c && o.alive) md = Math.min(md, Math.hypot(o.pos.x - s.x, o.pos.z - s.z));
      md += Math.random() * 20;
      if (md > bs) { bs = md; best = s; }
    }
    const go = () => this.emit({ t: 'spawn', id: c.id, x: best.x, z: best.z, yaw: best.yaw });
    if (immediate) go(); else this.respawnQ.push({ id: c.id, t: MATCH.respawn });
  }

  // пошкодження (лише хост)
  damage(c, amount, point, dx, dz, by, kind, dent = true) {
    if (!c.alive || c.invuln > 0 || this.over) return;
    amount = Math.round(amount * 10) / 10;
    if (amount <= 0) return;
    c.hp = Math.max(0, c.hp - amount);
    if (by != null && by !== c.id) { c.lastHitBy = by; c.lastHitT = performance.now(); }
    const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    const wx = point.x - c.pos.x, wz = point.z - c.pos.z;
    const lp = [r2(wx * cs - wz * sn), r2(point.y - c.pos.y), r2(wx * sn + wz * cs)];
    const ld = [r2(dx * cs - dz * sn), r2(dx * sn + dz * cs)];
    this.emit({ t: 'hit', id: c.id, a: amount, hp: c.hp, lp, d: ld, k: kind, by, dn: dent ? 1 : 0 });
    if (c.hp <= 0) {
      let killer = by;
      if ((killer == null || killer === c.id) && c.lastHitBy != null && performance.now() - c.lastHitT < 5000) killer = c.lastHitBy;
      const kc = killer != null && killer !== c.id ? this.cars.get(killer) : null;
      c.deaths++;
      if (kc) kc.kills++;
      this.emit({ t: 'kill', id: c.id, by: kc ? kc.id : null, k: kind, sc: [...this.cars.values()].map((x) => [x.id, x.kills, x.deaths]) });
      this.hostRespawn(c, false);
      if (kc && kc.kills >= MATCH.killLimit) this.endMatch();
    }
  }

  impulse(c, vx, vy, vz, spin) {
    if (c.local) this.applyImpulse(c, vx, vy, vz, spin);
    else if (this.net && this.isHost) {
      for (const [pid, id] of this.peerCar) if (id === c.id) this.net.sendTo(pid, { t: 'imp', v: [r2(vx), r2(vy), r2(vz)], s: r2(spin) });
    }
  }
  applyImpulse(c, vx, vy, vz, spin) {
    c.vel.x += vx; c.vel.z += vz;
    if (vy > 0.5) { c.vel.y = Math.max(c.vel.y, vy); c.onGround = false; c.pos.y += 0.05; }
    c.angVel += spin;
  }

  explodeAt(x, y, z, radius, dmg, by, kind, size = 1, exclude = null) {
    this.emit({ t: 'boom', p: [r2(x), r2(y), r2(z)], s: size, k: kind });
    const P = new THREE.Vector3(x, y, z);
    for (const c of this.cars.values()) {
      if (!c.alive || c === exclude) continue;
      const cx = c.pos.x - x, cy = c.pos.y + 0.8 - y, cz = c.pos.z - z;
      const d = Math.hypot(cx, cy, cz);
      if (d > radius) continue;
      const f = 1 - d / radius;
      const n = Math.hypot(cx, cz) || 1;
      const hitPt = new THREE.Vector3(c.pos.x - cx / n * 1.1, c.pos.y + 0.7, c.pos.z - cz / n * 1.1);
      this.damage(c, dmg * (0.35 + 0.65 * f), hitPt, cx / n, cz / n, by, kind);
      const m = c.mass();
      this.impulse(c, cx / n * 16 * f / m, (6 + 10 * f) / m * (kind === 'mine' ? 1.8 : 1), cz / n * 16 * f / m, (Math.random() - 0.5) * 5 * f);
    }
    for (const p of this.world.props) {
      if (p.alive && Math.hypot(p.x - x, p.z - z) < radius * 0.8) {
        const n = Math.hypot(p.x - x, p.z - z) || 1;
        setTimeout(() => this.hostBreakProp(p.idx, [(p.x - x) / n * 14, (p.z - z) / n * 14], by), 90 + Math.random() * 120);
      }
    }
    void P;
  }

  projHit(pr, car, point) {
    if (!this.proj.list.has(pr.id)) return;
    this.proj.remove(pr.id);
    const n = Math.hypot(pr.v.x, pr.v.z) || 1, dx = pr.v.x / n, dz = pr.v.z / n;
    if (pr.kind === 'mg') {
      if (car) this.damage(car, MG.dmg, point, dx, dz, pr.owner, 'mg');
      return;
    }
    const s = pr.spec;
    if (pr.kind === 'mine') {
      this.emit({ t: 'boom', id: pr.id, p: [r2(point.x), r2(point.y), r2(point.z)], s: 1.3, k: 'mine' });
      this.explodeAt(point.x, point.y, point.z, s.radius, s.dmg, pr.owner, 'mine', 0, null);
      return;
    }
    if (car) {
      this.damage(car, s.dmg, point, dx, dz, pr.owner, pr.kind);
      const m = car.mass();
      this.impulse(car, dx * s.dmg * 0.35 / m, s.dmg * 0.22 / m, dz * s.dmg * 0.35 / m, (Math.random() - 0.5) * s.dmg * 0.12);
      if (pr.kind === 'fire') { car.burnT = s.burn; car.burnBy = pr.owner; }
    }
    this.emit({ t: 'boom', id: pr.id, p: [r2(point.x), r2(point.y), r2(point.z)], s: pr.kind === 'power' ? 1.8 : 1, k: pr.kind });
    this.explodeAt(point.x, point.y, point.z, s.radius, s.dmg * 0.45, pr.owner, pr.kind, 0, car);
  }

  doAct(c, k, yaw) {
    if (k === 'shock') {
      this.emit({ t: 'fx', k: 'shock', p: [r2(c.pos.x), r2(c.pos.y), r2(c.pos.z)] });
      for (const o of this.cars.values()) {
        if (o === c || !o.alive) continue;
        const dx = o.pos.x - c.pos.x, dz = o.pos.z - c.pos.z, d = Math.hypot(dx, dz);
        if (d > WEAPONS.shock.radius) continue;
        const f = 1 - d / WEAPONS.shock.radius, m = o.mass();
        this.damage(o, WEAPONS.shock.dmg * (0.5 + f * 0.5), new THREE.Vector3(o.pos.x - dx / d, o.pos.y + 0.8, o.pos.z - dz / d), dx / d, dz / d, c.id, 'shock');
        this.impulse(o, dx / d * 32 * f / m, 9 * f / m, dz / d * 32 * f / m, (Math.random() - 0.5) * 6);
      }
    } else if (k === 'zap') {
      const y = yaw ?? c.yaw;
      let best = null, bs = 1e9;
      for (const o of this.cars.values()) {
        if (o === c || !o.alive) continue;
        const dx = o.pos.x - c.pos.x, dz = o.pos.z - c.pos.z, d = Math.hypot(dx, dz);
        const a = Math.abs(wrap(Math.atan2(dx, dz) - y));
        if (d < 38 && a < 0.9 && d * (1 + a) < bs) { bs = d * (1 + a); best = o; }
      }
      const from = [r2(c.pos.x), r2(c.pos.y + 2.2), r2(c.pos.z)];
      if (best) {
        this.emit({ t: 'fx', k: 'zap', p: from, q: [r2(best.pos.x), r2(best.pos.y + 1), r2(best.pos.z)] });
        const dx = best.pos.x - c.pos.x, dz = best.pos.z - c.pos.z, d = Math.hypot(dx, dz) || 1;
        this.damage(best, 24, new THREE.Vector3(best.pos.x, best.pos.y + 1.6, best.pos.z), dx / d, dz / d, c.id, 'zap');
        best.burnT = Math.max(best.burnT, 1); best.burnBy = c.id;
        this.impulse(best, 0, 5, 0, (Math.random() - 0.5) * 8);
      } else {
        this.emit({ t: 'fx', k: 'zap', p: from, q: [r2(c.pos.x + Math.sin(y) * 20), 0.2, r2(c.pos.z + Math.cos(y) * 20)] });
      }
    }
  }

  hostBreakProp(i, v, by) {
    const p = this.world.props[i];
    if (!p || !p.alive) return;
    this.emit({ t: 'prop', i, v: [r2(v[0]), r2(v[1])] });
    if (p.type === 'barrel') this.explodeAt(p.x, 0.8, p.z, 8, 26, by, 'barrel', 1.2);
  }

  takePickup(it, c) {
    if (!it.active) return;
    let w = null, n = 0, hp = c.hp;
    if (it.kind === 'weapon') {
      const pool = ['homing', 'homing', 'fire', 'fire', 'mine', 'shock', 'power'];
      w = pool[Math.random() * pool.length | 0]; n = WEAPONS[w].ammo;
    } else if (it.kind === 'health') { hp = c.hp = Math.min(c.spec.hp, c.hp + c.spec.hp * 0.45); }
    this.emit({ t: 'pick', i: it.i, id: c.id, kind: it.kind, w, n, hp });
  }
  respawnPickup(i) { this.emit({ t: 'pk', i }); }

  endMatch() {
    if (this.over) return;
    const sorted = [...this.cars.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    this.emit({ t: 'end', w: sorted[0] ? sorted[0].id : null });
    setTimeout(() => this.emit({ t: 'restart' }), 10000);
  }

  // ================================================================== КЛІЄНТ
  onClientMsg(m) {
    switch (m.t) {
      case 'welcome': {
        clearTimeout(this.joinTimer);
        this.myId = m.you; this.timeLeft = m.tl;
        for (const ci of m.cars) {
          const c = this.addCar(ci, ci.id === m.you);
          c.hp = ci.hp;
          if (ci.alive && ci.id !== m.you) { c.spawn(ci.s[0], ci.s[2], ci.s[3]); c.invuln = 0; c.hp = ci.hp; c.pushState(performance.now(), ci.s); }
        }
        for (const i of m.props) this.breakPropVisual(i, [0, 0], true);
        m.picks.forEach((a, i) => this.pickups.set(i, !!a));
        this.beginPlay();
        $('#roomBadge').hidden = false; $('#roomCode').textContent = this.roomCode;
        this.updateRoomInfo();
        break;
      }
      case 'full': this.menuMsg('Кімната заповнена', true); $('#btnJoin').disabled = false; break;
      case 'snap': {
        const now = performance.now();
        for (const a of m.c) {
          const c = this.cars.get(a[0]);
          if (!c || c.id === this.myId) continue;
          c.pushState(now, a.slice(1, 11));
        }
        this.timeLeft = m.tl;
        break;
      }
      case 'fire': {
        const c = this.cars.get(m.o);
        this.proj.spawn(m.id, m.o, m.k, m.p, m.v, m.tg);
        if (c) this.fireSound(c, m.k);
        break;
      }
      case 'imp': { const me = this.me; if (me && me.alive) this.applyImpulse(me, m.v[0], m.v[1], m.v[2], m.s); break; }
      default: this.handle(m);
    }
  }

  // ================================================================== ПОДІЇ (усі піри)
  handle(m) {
    switch (m.t) {
      case 'add': this.addCar(m.car, false); this.updateRoomInfo(); break;
      case 'rm': { const c = this.cars.get(m.id); if (c) this.feed(`<b>${esc(c.name)}</b> зник`); this.removeCar(m.id); this.updateRoomInfo(); break; }
      case 'spawn': {
        const c = this.cars.get(m.id);
        if (!c) return;
        c.spawn(m.x, m.z, m.yaw);
        if (!c.local) c.pushState(performance.now(), [m.x, c.pos.y, m.z, m.yaw, 0, 0, 0, 0, 0, 4]);
        if (c.id === this.myId) { this.showCenter(''); this.deadT = 0; this.camSnap = true; this.updateWeaponHud(); }
        break;
      }
      case 'hit': {
        const c = this.cars.get(m.id);
        if (!c || !c.model) { if (c) c.hp = m.hp; return; }
        c.hp = m.hp;
        if (m.by != null) { c.lastHitBy = m.by; c.lastHitT = performance.now(); }
        const lp = new THREE.Vector3(m.lp[0], m.lp[1], m.lp[2]);
        const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
        const wx = c.pos.x + lp.x * cs + lp.z * sn, wz = c.pos.z - lp.x * sn + lp.z * cs, wy = c.pos.y + lp.y;
        if (m.dn) {
          const big = m.a >= 8;
          c.model.dent(lp, new THREE.Vector3(m.d[0], -0.2, m.d[1]), Math.min(0.7, 0.06 + m.a * 0.025), big ? 1.6 : 0.9);
          const parts = c.model.hitPart(lp, m.a, c.hp < c.spec.hp * 0.35);
          for (const p of parts) {
            this.fx.addDebris(p, null, null, null, c.vel.x * 0.6 - m.d[0] * 4 + (Math.random() - 0.5) * 6, 5 + Math.random() * 6, c.vel.z * 0.6 + (Math.random() - 0.5) * 6, 16, true, Math.random() < 0.3 ? 2 : 0);
            this.fx.sparks(wx, wy, wz, 14);
          }
          this.fx.sparks(wx, wy, wz, big ? 12 : 4, -m.d[0], -m.d[1]);
          if (big) this.fx.smoke(wx, wy, wz, 1.5);
        }
        if (c.id === this.myId) {
          this.hurt = Math.min(0.6, this.hurt + m.a * 0.03);
          this.fx.shake = Math.max(this.fx.shake, Math.min(0.8, m.a * 0.03));
          this.sound.play('hit', 0.9);
        } else this.sound.play('hit', this.vol(c.pos) * 0.7);
        if (m.by === this.myId && c.id !== this.myId) this.hitMarker();
        break;
      }
      case 'kill': {
        const c = this.cars.get(m.id), k = m.by != null ? this.cars.get(m.by) : null;
        for (const [id, kl, dt] of m.sc) { const x = this.cars.get(id); if (x) { x.kills = kl; x.deaths = dt; } }
        if (c) {
          if (c.alive) { this.fx.explosion(c.pos.x, c.pos.y + 0.5, c.pos.z, 1.6); c.explode(); }
          c.alive = false; c.hp = 0;
          const bot = this.bots.get(c.id); if (bot) bot.target = null;
        }
        this.sound.play('bigboom', c ? this.vol(c.pos) : 0.5);
        const wn = killName(m.k);
        this.feed(k ? `<b>${esc(k.name)}</b> <em>${wn}</em> ${esc(c ? c.name : '?')}` : `<b>${esc(c ? c.name : '?')}</b> <em>розбився</em>`);
        if (c && c.id === this.myId) { this.deadT = 0.001; this.killer = k; this.showCenter('ЗНИЩЕНО', k ? 'тебе підірвав ' + k.name : 'ти розбився'); }
        if (k && k.id === this.myId && c && c.id !== this.myId) { this.sound.play('kill', 0.8); this.showCenter('+1 ВБИВСТВО', c.name); setTimeout(() => this.me && this.me.alive && this.showCenter(''), 1500); }
        this.updateFragHud();
        break;
      }
      case 'boom': {
        if (m.id) this.proj.remove(m.id);
        if (m.s > 0) {
          this.fx.explosion(m.p[0], m.p[1], m.p[2], m.s);
          this.sound.play(m.s > 1.3 ? 'bigboom' : 'boom', this.vol({ x: m.p[0], y: m.p[1], z: m.p[2] }));
        }
        break;
      }
      case 'fx': {
        if (m.k === 'shock') { this.fx.shockwave(m.p[0], m.p[1], m.p[2], WEAPONS.shock.radius); this.sound.play('shock', this.vol({ x: m.p[0], y: m.p[1], z: m.p[2] })); }
        if (m.k === 'zap') { this.fx.bolt(...m.p, ...m.q); this.fx.bolt(...m.p, ...m.q); this.sound.play('zap', this.vol({ x: m.p[0], y: m.p[1], z: m.p[2] })); }
        break;
      }
      case 'prop': this.breakPropVisual(m.i, m.v, false); break;
      case 'pick': {
        this.pickups.set(m.i, false);
        const c = this.cars.get(m.id);
        if (!c) return;
        if (m.kind === 'health') c.hp = m.hp;
        if (c.local) {
          if (m.kind === 'weapon') { c.weapons[m.w] = (c.weapons[m.w] || 0) + m.n; if (!c.wsel) c.wsel = m.w; }
          if (m.kind === 'turbo') c.boost = 1;
        }
        if (c.id === this.myId) {
          this.sound.play(m.kind === 'health' ? 'heal' : 'pickup');
          this.toast(m.kind === 'weapon' ? `+ ${WEAPONS[m.w].name} ×${m.n}` : m.kind === 'health' ? '+ РЕМОНТ' : '+ ТУРБО');
          if (m.kind === 'weapon' && c.wsel === m.w) this.updateWeaponHud(true); else this.updateWeaponHud();
        }
        break;
      }
      case 'pk': this.pickups.set(m.i, true); break;
      case 'end': {
        this.over = true;
        const w = this.cars.get(m.w);
        this.showScores(true, w);
        this.sound.play('kill');
        break;
      }
      case 'restart': {
        this.over = false;
        $('#scores').hidden = true;
        this.timeLeft = MATCH.time;
        for (const c of this.cars.values()) { c.kills = 0; c.deaths = 0; c.specialT = 3; }
        this.proj.clear();
        this.pickups.items.forEach((it) => this.pickups.set(it.i, true));
        this.world.props.forEach((p) => { p.alive = true; p.mesh.visible = true; });
        if (this.isHost) { this.respawnQ.length = 0; for (const c of this.cars.values()) this.hostRespawn(c, true); }
        this.showCenter('НОВИЙ РАУНД!'); setTimeout(() => this.showCenter(''), 1500);
        this.updateFragHud();
        break;
      }
    }
  }

  breakPropVisual(i, v, silent) {
    const p = this.world.props[i];
    if (!p || !p.alive) return;
    p.alive = false;
    p.mesh.visible = false;
    if (silent) return;
    const vx = v[0] || 0, vz = v[1] || 0;
    if (p.type === 'lamp' || p.type === 'cone') {
      const cl = p.mesh.clone();
      cl.visible = true;
      this.fx.addDebris(cl, p.x, 0, p.z, vx * 0.5, p.type === 'cone' ? 6 : 1.5, vz * 0.5, p.type === 'lamp' ? 25 : 10, false);
      const d = this.fx.debris[this.fx.debris.length - 1];
      if (p.type === 'lamp') { d.wx = vz * 0.12; d.wz = -vx * 0.12; d.wy = 0; this.fx.sparks(p.x, 6.5, p.z, 12); }
    } else if (p.type === 'crate') {
      for (const ch of p.mesh.children) {
        for (let k = 0; k < 3; k++) {
          const pl = new THREE.Mesh(this.fx.chunkGeo, this.fx.plankMat);
          pl.scale.set(2.2, 0.35, 1.2 + Math.random());
          this.fx.addDebris(pl, p.x + (Math.random() - 0.5), ch.position.y, p.z + (Math.random() - 0.5), vx * 0.7 + (Math.random() - 0.5) * 8, 4 + Math.random() * 7, vz * 0.7 + (Math.random() - 0.5) * 8, 10, false);
        }
      }
      this.fx.dust(p.x, 0.5, p.z, 2);
      this.sound.play('crash', this.vol({ x: p.x, y: 1, z: p.z }) * 0.6);
    }
  }

  // ================================================================== КЕРУВАННЯ ТА ЗБРОЯ
  newPid() { return this.myId + '.' + (this.pn++); }

  fire(c, kind, p, v, tg = null) {
    const id = c.id + '.' + (this.pn++);
    this.proj.spawn(id, c.id, kind, p, v, tg);
    const m = { t: 'fire', id, o: c.id, k: kind, p: p.map(r2), v: v.map(r2), tg };
    if (this.net) { if (this.isHost) this.net.broadcast(m); else this.net.send(m); }
    this.fireSound(c, kind);
  }
  fireSound(c, kind) {
    const vol = this.vol(c.pos);
    if (kind === 'mg') this.sound.play('mg', vol * (c.id === this.myId ? 0.7 : 0.4));
    else if (kind === 'mine') this.sound.play('mine', vol);
    else this.sound.play('rocket', vol);
  }
  act(c, k) {
    if (this.isHost) this.doAct(c, k, c.yaw);
    else this.net.send({ t: 'act', k, y: r2(c.yaw) });
  }

  // ціль у конусі перед машиною (автонаведення)
  aimTarget(c, cone, range) {
    let best = null, bs = 1e9;
    for (const o of this.cars.values()) {
      if (o === c || !o.alive) continue;
      const dx = o.pos.x - c.pos.x, dz = o.pos.z - c.pos.z, d = Math.hypot(dx, dz);
      if (d > range) continue;
      const a = Math.abs(wrap(Math.atan2(dx, dz) - c.yaw));
      if (a > cone) continue;
      const sc = d * (1 + a * 3);
      if (sc < bs) { bs = sc; best = o; }
    }
    return best;
  }
  aimDir(c, cone, range, speed) {
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    const t = this.aimTarget(c, cone, range);
    if (!t) return [fx, 0, fz, null];
    const d = t.pos.distanceTo(c.pos), tt = d / speed;
    const ax = t.pos.x + t.vel.x * tt - c.pos.x, ay = t.pos.y + 0.9 - (c.pos.y + 1.2), az = t.pos.z + t.vel.z * tt - c.pos.z;
    const n = Math.hypot(ax, ay, az) || 1;
    // плавне доведення: 70% до цілі
    const k = 0.7;
    const x = fx * (1 - k) + ax / n * k, y = ay / n * k, z = fz * (1 - k) + az / n * k, m = Math.hypot(x, y, z);
    return [x / m, y / m, z / m, t];
  }

  controlCar(c, dt) {
    const inp = c.input;
    c.mgT -= dt; c.specialT = Math.max(0, c.specialT - dt);
    if (!c.alive) return;
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), rx = -fz, rz = fx;
    const L = c.spec.size[2] * 0.5;
    if (inp.fire && c.mgT <= 0) {
      c.mgT = MG.rate;
      c.gunSide = -(c.gunSide || 1);
      const [dx, dy, dz] = this.aimDir(c, 0.22, 80, MG.speed);
      const s = MG.speed, sp = 0.012;
      const p = [c.pos.x + fx * L + rx * c.gunSide * 0.5, c.pos.y + c.model.bodyY + 0.65, c.pos.z + fz * L + rz * c.gunSide * 0.5];
      this.fire(c, 'mg', p, [dx * s + c.vel.x + (Math.random() - 0.5) * s * sp, dy * s + (Math.random() - 0.5) * s * sp, dz * s + c.vel.z + (Math.random() - 0.5) * s * sp]);
      this.fx.muzzle(p[0] + fx * 0.4, p[1], p[2] + fz * 0.4);
    }
    if (inp.next) {
      const have = WEAPON_IDS.filter((w) => c.weapons[w] > 0);
      if (have.length) { c.wsel = have[(have.indexOf(c.wsel) + 1) % have.length]; if (c.id === this.myId) this.updateWeaponHud(true); }
    }
    if (inp.alt) {
      const w = c.wsel;
      if (!w || !(c.weapons[w] > 0)) { if (c.id === this.myId) this.sound.play('empty'); }
      else {
        c.weapons[w]--;
        const top = c.pos.y + c.model.bodyY + 1.0;
        if (w === 'homing') {
          const t = this.aimTarget(c, 1.4, 130) || this.aimTarget(c, Math.PI, 90);
          const s = WEAPONS.homing.speed;
          this.fire(c, 'homing', [c.pos.x + fx * L, top + 0.4, c.pos.z + fz * L], [fx * s * 0.8 + c.vel.x * 0.5, 9, fz * s * 0.8 + c.vel.z * 0.5], t ? t.id : null);
        } else if (w === 'fire' || w === 'power') {
          const s = WEAPONS[w].speed;
          const [dx, dy, dz] = this.aimDir(c, 0.3, 110, s);
          this.fire(c, w, [c.pos.x + fx * (L + 0.5), top, c.pos.z + fz * (L + 0.5)], [dx * s + c.vel.x * 0.5, dy * s + 1, dz * s + c.vel.z * 0.5]);
        } else if (w === 'mine') {
          this.fire(c, 'mine', [c.pos.x - fx * (L + 1.2), c.pos.y + 0.3, c.pos.z - fz * (L + 1.2)], [0, 0, 0]);
        } else if (w === 'shock') this.act(c, 'shock');
        if (c.weapons[w] <= 0) {
          delete c.weapons[w];
          const have = WEAPON_IDS.filter((x) => c.weapons[x] > 0);
          c.wsel = have[0] || null;
        }
        if (c.id === this.myId) this.updateWeaponHud(true);
      }
    }
    if (inp.special) {
      if (c.specialT > 0) { if (c.id === this.myId) this.sound.play('empty'); }
      else {
        c.specialT = c.spec.specialCd;
        const sp = c.spec.special, top = c.pos.y + c.model.bodyY + 1.2;
        if (sp === 'salvo') {
          const s = PROJ.salvo.speed;
          const t = this.aimTarget(c, 0.35, 100);
          [-0.12, -0.04, 0.04, 0.12].forEach((o, i) => setTimeout(() => {
            if (!c.alive) return;
            const y = c.yaw + o, cfx = Math.sin(y), cfz = Math.cos(y);
            const dy = t ? clamp((t.pos.y - c.pos.y) / Math.max(5, t.pos.distanceTo(c.pos)), -0.3, 0.3) : 0;
            this.fire(c, 'salvo', [c.pos.x + cfx * L, top, c.pos.z + cfz * L], [cfx * s + c.vel.x * 0.5, dy * s + 1.5, cfz * s + c.vel.z * 0.5]);
          }, i * 70));
        } else if (sp === 'ram') {
          c.ramT = 2.6;
          if (!this.isHost) this.net.send({ t: 'ram' });
          this.sound.play('rocket', this.vol(c.pos));
        } else if (sp === 'zap') this.act(c, 'zap');
        else if (sp === 'minefield') {
          [-1.6, 0, 1.6].forEach((o, i) => setTimeout(() => {
            if (!c.alive) return;
            const f2x = Math.sin(c.yaw), f2z = Math.cos(c.yaw);
            this.fire(c, 'mine', [c.pos.x - f2x * (L + 1.5) - f2z * o, c.pos.y + 0.3, c.pos.z - f2z * (L + 1.5) + f2x * o], [0, 0, 0]);
          }, i * 180));
        }
      }
    }
  }

  // зіткнення машин: імпульс + обертання; урон від тарану рахує хост
  collideCars() {
    const arr = [...this.cars.values()].filter((c) => c.alive);
    const now = performance.now();
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], b = arr[j];
      if (!a.local && !b.local && !this.isHost) continue;
      if (Math.abs(a.pos.y - b.pos.y) > 2.2) continue;
      if (Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) > 8) continue;
      let best = null;
      for (const ca of a.circles()) for (const cb of b.circles()) {
        const dx = ca[0] - cb[0], dz = ca[1] - cb[1], d = Math.hypot(dx, dz), rr = ca[2] + cb[2];
        if (d < rr && (!best || rr - d > best.depth)) best = { nx: dx / (d || 1), nz: dz / (d || 1), depth: rr - d, px: (ca[0] + cb[0]) / 2, pz: (ca[1] + cb[1]) / 2 };
      }
      if (!best) continue;
      const ma = a.mass(), mb = b.mass(), tot = ma + mb;
      if (a.local) { a.pos.x += best.nx * best.depth * mb / tot; a.pos.z += best.nz * best.depth * mb / tot; }
      if (b.local) { b.pos.x -= best.nx * best.depth * ma / tot; b.pos.z -= best.nz * best.depth * ma / tot; }
      const rvx = a.vel.x - b.vel.x, rvz = a.vel.z - b.vel.z;
      const vn = rvx * best.nx + rvz * best.nz;
      if (vn >= 0) continue;
      const e = 0.35;
      const jn = -(1 + e) * vn / (1 / ma + 1 / mb);
      const spinK = 0.09;
      if (a.local) {
        a.vel.x += jn / ma * best.nx; a.vel.z += jn / ma * best.nz;
        const rx = best.px - a.pos.x, rz = best.pz - a.pos.z;
        a.angVel += (rz * best.nx - rx * best.nz) * jn / ma * spinK;
      }
      if (b.local) {
        b.vel.x -= jn / mb * best.nx; b.vel.z -= jn / mb * best.nz;
        const rx = best.px - b.pos.x, rz = best.pz - b.pos.z;
        b.angVel -= (rz * best.nx - rx * best.nz) * jn / mb * spinK;
      }
      const closing = -vn;
      if (closing > 6) {
        const key = a.id < b.id ? a.id + ':' + b.id : b.id + ':' + a.id;
        if ((this.pairCd.get(key) || 0) < now) {
          this.pairCd.set(key, now + 350);
          const P = new THREE.Vector3(best.px, (a.pos.y + b.pos.y) / 2 + 0.8, best.pz);
          this.fx.sparks(P.x, P.y, P.z, Math.min(30, closing * 1.5));
          this.sound.play('crash', this.vol(P) * Math.min(1, closing / 25));
          if (a.id === this.myId || b.id === this.myId) this.fx.shake = Math.max(this.fx.shake, Math.min(0.9, closing / 40));
          if (this.isHost) {
            // хто бив передом — отримує менше
            const front = (c, nx, nz) => Math.max(0, -(Math.sin(c.yaw) * nx + Math.cos(c.yaw) * nz));
            const fa = front(a, best.nx, best.nz), fb = front(b, -best.nx, -best.nz);
            const base = (closing - 5) * 0.75;
            const da = base * Math.pow(mb / ma, 0.6) * (1 - fa * 0.5) * (b.ramT > 0 ? 3 : 1);
            const db = base * Math.pow(ma / mb, 0.6) * (1 - fb * 0.5) * (a.ramT > 0 ? 3 : 1);
            this.damage(a, da, P, -best.nx, -best.nz, b.id, b.ramT > 0 ? 'ram' : 'crash');
            this.damage(b, db, P, best.nx, best.nz, a.id, a.ramT > 0 ? 'ram' : 'crash');
          }
        }
      }
    }
  }

  // наїзд на ящики, бочки, ліхтарі
  propContacts(c) {
    const sp = Math.hypot(c.vel.x, c.vel.z);
    for (const p of this.world.props) {
      if (!p.alive) continue;
      const dx = p.x - c.pos.x, dz = p.z - c.pos.z;
      if (Math.abs(dx) > 4 || Math.abs(dz) > 4) continue;
      if (Math.hypot(dx, dz) > p.r + c.spec.size[0] * 0.6 || c.pos.y > p.h) continue;
      if (sp < 2) {
        // повільно — просто штовхаємо
        const d = Math.hypot(dx, dz) || 1, push = p.r + c.spec.size[0] * 0.6 - d;
        c.pos.x -= dx / d * push; c.pos.z -= dz / d * push;
        continue;
      }
      const v = [c.vel.x * 0.9, c.vel.z * 0.9];
      const slow = { crate: 0.82, barrel: 0.9, lamp: 0.7, cone: 0.97 }[p.type];
      c.vel.x *= slow; c.vel.z *= slow;
      if (this.isHost) this.hostBreakProp(p.idx, v, c.id);
      else { this.breakPropVisual(p.idx, v, false); this.net.send({ t: 'prop', i: p.idx, v: [r2(v[0]), r2(v[1])] }); }
      if (c.id === this.myId) this.fx.shake = Math.max(this.fx.shake, p.type === 'cone' ? 0.05 : 0.25);
    }
  }

  onCrash(c, speed, x, y, z, nx, nz) {
    if (c.crashCd && c.crashCd > performance.now()) return;
    c.crashCd = performance.now() + 400;
    this.fx.sparks(x, y, z, Math.min(30, speed), nx, nz);
    this.fx.dust(x, y - 0.5, z, 1.5);
    this.sound.play('crash', this.vol(c.pos) * Math.min(1, speed / 30));
    if (c.id === this.myId) this.fx.shake = Math.max(this.fx.shake, Math.min(0.8, speed / 40));
    const P = new THREE.Vector3(x, y, z);
    if (this.isHost) this.damage(c, crashDmg(speed, c), P, -nx, -nz, null, 'crash');
    else if (c.id === this.myId) this.net.send({ t: 'crash', a: r2(speed), p: [r2(x), r2(y), r2(z)], n: [r2(-nx), r2(-nz)] });
  }
  onLand(c, impact) {
    this.fx.dust(c.pos.x, c.pos.y, c.pos.z, 1.2 + impact * 0.05);
    if (impact > 12) this.fx.sparks(c.pos.x, c.pos.y + 0.2, c.pos.z, 8);
    this.sound.play('land', this.vol(c.pos) * Math.min(1, impact / 18));
    if (c.id === this.myId) this.fx.shake = Math.max(this.fx.shake, Math.min(0.6, impact / 35));
  }

  vol(p) {
    const d = Math.hypot(p.x - this.camera.position.x, p.y - this.camera.position.y, p.z - this.camera.position.z);
    return clamp(1.15 - d / 110, 0, 1);
  }

  // ================================================================== ЦИКЛ
  frame(t) {
    requestAnimationFrame((tt) => this.frame(tt));
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    if (this.state === 'play' || this.state === 'lost') {
      this.acc += dt;
      let n = 0;
      while (this.acc >= DT && n < 5) { this.tick(DT); this.acc -= DT; n++; }
      if (n === 5) this.acc = 0;
      this.netSend(t);
    } else if (this.preview) {
      this.preview.root.rotation.y += dt * 0.6;
    }
    // віддалені машини — інтерполяція
    const now = performance.now();
    for (const c of this.cars.values()) {
      if (!c.local && c.alive) c.interpolate(now);
      c.syncModel(dt);
      c.updateFx(dt, this.fx);
    }
    this.fx.update(dt);
    this.updateCamera(dt);
    this.fx.camPos.copy(this.camera.position);
    this.hurt = Math.max(0, this.hurt - dt * 1.2);
    this.rr.render(this.scene, this.camera, this.hurt);
    if (this.state === 'play') this.updateHud(dt);
  }

  tick(dt) {
    const me = this.me;
    this.input.read(this.inp);
    if (me) {
      const i = this.inp;
      Object.assign(me.input, { throttle: i.throttle, steer: i.steer, brake: i.brake, boost: i.boost, fire: i.fire && !this.over, alt: i.alt && !this.over, special: i.special && !this.over, next: i.next });
      if (!me.alive) me.input.fire = false;
    }
    if (this.inp.scores !== this.scoresHeld) { this.scoresHeld = this.inp.scores; if (!this.over) this.showScores(this.inp.scores); }
    for (const b of this.bots.values()) b.update(dt);
    for (const c of this.cars.values()) {
      if (!c.local) continue;
      if (!this.over) this.controlCar(c, dt);
      c.step(dt);
      if (c.alive) this.propContacts(c);
      c.input.alt = c.input.special = c.input.next = false;
    }
    this.collideCars();
    this.proj.update(dt, this.isHost);
    this.pickups.update(dt, this.isHost);
    if (this.isHost) {
      for (const c of this.cars.values()) {
        if (c.alive && c.burnT > 0) {
          c.burnT -= dt; c.burnAcc = (c.burnAcc || 0) + dt;
          if (c.burnAcc > 0.5) { c.burnAcc = 0; this.damage(c, 2.5, c.pos, 0, 0, c.burnBy, 'fire', false); }
        }
        if (!c.local && c.alive && c.invuln > 0) c.invuln = Math.max(0, c.invuln - dt);
      }
      for (let i = this.respawnQ.length - 1; i >= 0; i--) {
        const r = this.respawnQ[i];
        r.t -= dt;
        if (r.t <= 0) { this.respawnQ.splice(i, 1); const c = this.cars.get(r.id); if (c && !this.over) this.hostRespawn(c, true); }
      }
      if (!this.over) {
        this.timeLeft -= dt;
        if (this.timeLeft <= 0) { this.timeLeft = 0; this.endMatch(); }
      }
    } else {
      for (const c of this.cars.values()) if (!c.local && c.invuln > 0) c.invuln = Math.max(0, c.invuln - dt);
      if (!this.over) this.timeLeft = Math.max(0, this.timeLeft - dt);
    }
    if (me && !me.alive) this.deadT += dt;
  }

  netSend(t) {
    if (!this.net) return;
    if (this.isHost) {
      if (t - this.lastSnap > 50) {
        this.lastSnap = t;
        const c = [];
        for (const x of this.cars.values()) if (x.alive) c.push([x.id, ...x.stateArr()]);
        this.net.broadcast({ t: 'snap', c, tl: Math.round(this.timeLeft) });
      }
    } else if (t - this.lastSt > 33) {
      this.lastSt = t;
      const me = this.me;
      if (me && me.alive) this.net.send({ t: 'st', s: me.stateArr() });
    }
  }

  updateCamera(dt) {
    const cam = this.camera;
    if (this.state === 'menu' || !this.me) {
      const tt = performance.now() / 1000;
      cam.position.set(Math.sin(tt * 0.15) * 11, 7.5, Math.cos(tt * 0.15) * 11);
      cam.lookAt(0, 4.4, 0);
      cam.fov = 60; cam.updateProjectionMatrix();
      return;
    }
    let c = this.me;
    if (!c.alive && this.killer && this.killer.alive && this.deadT > 1.2) c = this.killer;
    const look = this.inp.look ? -1 : 1;
    const sp = Math.hypot(c.vel.x, c.vel.z);
    // камера тримається за курсом руху, а не носом — занос видно краще
    let target = c.yaw;
    if (sp > 6 && c.onGround) {
      const vy = Math.atan2(c.vel.x, c.vel.z);
      const fwd = Math.cos(vy - c.yaw) > 0;
      if (fwd) target = c.yaw + wrap(vy - c.yaw) * 0.45;
    }
    if (this.camSnap) { this.camYaw = target; }
    this.camYaw += wrap(target - this.camYaw) * Math.min(1, dt * 4.5);
    const fx = Math.sin(this.camYaw) * look, fz = Math.cos(this.camYaw) * look;
    const dist = (c.alive ? 9 : 14) + sp * 0.06, h = (c.alive ? 3.6 : 7) + sp * 0.02;
    let px = c.pos.x - fx * dist, py = c.pos.y + h, pz = c.pos.z - fz * dist;
    const bt = this.world.segmentBlocked(c.pos.x, c.pos.y + 2, c.pos.z, px, py, pz);
    if (bt >= 0) { const k = Math.max(0.25, bt - 0.08); px = c.pos.x + (px - c.pos.x) * k; py = c.pos.y + 2 + (py - c.pos.y - 2) * k; pz = c.pos.z + (pz - c.pos.z) * k; }
    py = Math.max(py, this.world.ground(px, pz, py) + 1.2);
    const k = this.camSnap ? 1 : 1 - Math.exp(-dt * 8);
    cam.position.x += (px - cam.position.x) * k;
    cam.position.y += (py - cam.position.y) * k;
    cam.position.z += (pz - cam.position.z) * k;
    this.camSnap = false;
    const sh = this.fx.shake;
    cam.position.x += (Math.random() - 0.5) * sh; cam.position.y += (Math.random() - 0.5) * sh;
    cam.lookAt(c.pos.x + fx * 5, c.pos.y + 1.6, c.pos.z + fz * 5);
    const fov = 70 + Math.min(18, sp * 0.33) + (c.boosting ? 6 : 0);
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
    cam.updateProjectionMatrix();
    if (this.me.alive) this.sound.setEngine(clamp(sp / this.me.spec.maxSpeed, 0, 1.3), this.me.boosting, true);
    else this.sound.setEngine(0, false, false);
  }

  // ================================================================== HUD
  setupHud() {
    this.radar = $('#radar').getContext('2d');
    $('#btnPause').onclick = () => { $('#pause').hidden = false; };
    $('#btnResume').onclick = () => { $('#pause').hidden = true; };
    $('#btnQuit').onclick = () => { location.href = location.pathname; };
    $('#btnScores').onclick = () => { $('#pause').hidden = true; this.showScores(true); setTimeout(() => !this.over && this.showScores(false), 4000); };
    const mb = $('#btnMusic'), sb = $('#btnSfx');
    let mus = store.get('music', true), sfx = store.get('sfx', true);
    const sync = () => { mb.textContent = 'МУЗИКА: ' + (mus ? 'ТАК' : 'НІ'); sb.textContent = 'ЗВУК: ' + (sfx ? 'ТАК' : 'НІ'); this.sound.setMusic(mus); this.sound.setSfx(sfx); };
    mb.onclick = () => { mus = !mus; store.set('music', mus); sync(); };
    sb.onclick = () => { sfx = !sfx; store.set('sfx', sfx); sync(); };
    this.sound.musicOn = mus; this.sound.sfxOn = sfx;
    const origInit = this.sound.init.bind(this.sound);
    this.sound.init = () => { origInit(); sync(); };
    $('#btnShareRoom').onclick = async () => {
      const url = location.origin + location.pathname + '?join=' + this.roomCode;
      try {
        if (navigator.share) await navigator.share({ title: 'БРУХТ', text: 'Заходь на арену! Код: ' + this.roomCode, url });
        else { await navigator.clipboard.writeText(url); this.toast('Посилання скопійовано'); }
      } catch (e) {}
    };
  }

  updateRoomInfo() {
    if (!this.roomCode) return;
    const humans = [...this.cars.values()].filter((c) => !c.bot).length;
    $('#roomPlayers').textContent = humans + ' гравц.';
  }

  updateHud() {
    const me = this.me;
    if (!me) return;
    const hpf = clamp(me.hp / me.spec.hp, 0, 1);
    const bar = $('#hpBar');
    bar.style.width = (hpf * 100) + '%';
    bar.className = hpf < 0.3 ? 'low' : hpf < 0.6 ? 'mid' : '';
    $('#hpNum').textContent = Math.ceil(me.hp);
    $('#hudName').textContent = me.spec.name;
    $('#boostBar').style.width = (me.boost * 100) + '%';
    const tl = Math.max(0, Math.ceil(this.timeLeft));
    $('#timer').textContent = Math.floor(tl / 60) + ':' + String(tl % 60).padStart(2, '0');
    const sp = $('#special'), f = me.specialT / me.spec.specialCd;
    $('#spFill').style.height = ((1 - f) * 100) + '%';
    $('#spName').textContent = me.spec.specialName;
    $('#spState').textContent = me.specialT > 0 ? Math.ceil(me.specialT) + ' с' : 'ГОТОВО';
    sp.classList.toggle('ready', me.specialT <= 0);
    if (!me.alive && this.deadT > 0 && !this.over) {
      const r = Math.ceil(Math.max(0, MATCH.respawn - this.deadT));
      const sm = $('#center small');
      if (sm) sm.textContent = (this.killer ? 'тебе підірвав ' + this.killer.name : 'ти розбився') + (r > 0 ? ' · повернення через ' + r : '');
    }
    this.drawRadar();
  }

  updateFragHud() {
    const me = this.me;
    if (me) $('#fragInfo').textContent = `ВБИВСТВА ${me.kills} / ${MATCH.killLimit}`;
  }

  updateWeaponHud(flash) {
    const me = this.me;
    if (!me) return;
    const w = me.wsel;
    if (w && me.weapons[w] > 0) {
      $('#wIco').textContent = WEAPONS[w].icon; $('#wName').textContent = WEAPONS[w].name;
      const others = WEAPON_IDS.filter((x) => x !== w && me.weapons[x] > 0).length;
      $('#wAmmo').textContent = '×' + me.weapons[w] + (others ? '  · ще ' + others + ' (⇄)' : '');
    } else { $('#wIco').textContent = '—'; $('#wName').textContent = 'НЕМАЄ ЗБРОЇ'; $('#wAmmo').textContent = 'шукай червоні ящики ?'; }
    if (flash) { const s = $('#weapon'); s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash'); }
    this.updateFragHud();
  }

  drawRadar() {
    const x = this.radar, me = this.me, W = 120, S = W / 260;
    x.fillStyle = '#0c0614'; x.fillRect(0, 0, W, W);
    const tx = (v) => W / 2 + v * S, tz = (v) => W / 2 + v * S;
    x.fillStyle = '#3a2550';
    for (const b of this.world.boxes) if (b.top > 4 && b.x1 - b.x0 < 100) x.fillRect(tx(b.x0), tz(b.z0), (b.x1 - b.x0) * S, (b.z1 - b.z0) * S);
    x.strokeStyle = '#5a3a78'; x.strokeRect(tx(-120), tz(-120), 240 * S, 240 * S);
    for (const it of this.pickups.items) {
      if (!it.active) continue;
      x.fillStyle = it.kind === 'weapon' ? '#ff3355' : it.kind === 'health' ? '#33ff77' : '#33c8ff';
      x.fillRect(tx(it.x) - 1, tz(it.z) - 1, 3, 3);
    }
    for (const c of this.cars.values()) {
      if (!c.alive) continue;
      const isMe = c.id === this.myId;
      x.save(); x.translate(tx(c.pos.x), tz(c.pos.z)); x.rotate(-c.yaw + Math.PI);
      x.fillStyle = isMe ? '#46f3ff' : c.bot ? '#ffb43a' : '#ff4fd8';
      x.beginPath(); x.moveTo(0, -4); x.lineTo(3, 3); x.lineTo(-3, 3); x.fill();
      x.restore();
    }
    void me;
  }

  feed(html) {
    const f = $('#feed');
    const d = document.createElement('div'); d.innerHTML = html;
    f.prepend(d);
    while (f.children.length > 5) f.lastChild.remove();
    setTimeout(() => d.remove(), 6000);
  }
  showCenter(t, sub) {
    const c = $('#center');
    c.innerHTML = t ? esc(t) + (sub ? `<small>${esc(sub)}</small>` : '') : '';
    c.classList.remove('pop'); void c.offsetWidth; if (t) c.classList.add('pop');
  }
  toast(t, sec = 1.8) {
    const e = $('#toast'); e.textContent = t; e.classList.add('show');
    clearTimeout(this.toastT); this.toastT = setTimeout(() => e.classList.remove('show'), sec * 1000);
  }
  hitMarker() {
    if (this._hm && performance.now() - this._hm < 60) return;
    this._hm = performance.now();
    this.sound.play('hit', 0.35);
  }

  showScores(on, winner) {
    const el = $('#scores');
    if (!on) { if (!this.over) el.hidden = true; return; }
    const rows = [...this.cars.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    $('#scoresTitle').textContent = winner !== undefined ? (winner ? `ПЕРЕМІГ ${winner.name}!` : 'КІНЕЦЬ РАУНДУ') : 'ТАБЛО';
    $('#scoresBody').innerHTML = rows.map((c, i) => `<tr class="${c.id === this.myId ? 'me' : ''} ${i === 0 ? 'first' : ''}"><td>${i + 1}</td><td>${esc(c.name)}${c.bot ? ' <span class="dim">бот</span>' : ''}</td><td>${c.spec.name}</td><td>${c.kills}</td><td>${c.deaths}</td></tr>`).join('');
    $('#scoresNote').textContent = winner !== undefined ? 'Новий раунд за 10 секунд…' : (this.roomCode ? 'Кімната ' + this.roomCode : '');
    el.hidden = false;
  }
}

function crashDmg(speed, c) { return Math.max(0, (speed - 13) * 0.55) / Math.sqrt(c.spec.mass); }
function r2(v) { return Math.round(v * 100) / 100; }
function esc(s) { return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]); }
function killName(k) {
  return ({ mg: 'розстріляв', homing: 'наздогнав ракетою', fire: 'підсмажив', power: 'рознiс', salvo: 'накрив залпом', mine: 'підірвав на міні', shock: 'розчавив хвилею', zap: 'спопелив блискавкою', ram: 'протаранив', crash: 'зім’яв', barrel: 'підірвав бочкою' })[k] || 'знищив';
}

window.addEventListener('error', (e) => { const l = document.getElementById('loading'); if (l) l.textContent = 'Помилка: ' + e.message; });
window.game = new Game();
