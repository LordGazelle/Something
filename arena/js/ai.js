// Боти: полюють, тікають по аптечки, уникають стін, виїжджають із застрягань.
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Bot {
  constructor(car, game) {
    this.car = car; this.game = game;
    this.target = null; this.retarget = 0;
    this.stuckT = 0; this.reverseT = 0; this.revSteer = 1;
    this.skill = 0.65 + Math.random() * 0.35;
    this.think = 0; this.wander = null;
  }

  pickTarget() {
    const me = this.car;
    let best = null, bs = 1e9;
    for (const c of this.game.cars.values()) {
      if (c === me || !c.alive) continue;
      let d = c.pos.distanceTo(me.pos);
      if (me.lastHitBy === c.id && performance.now() - me.lastHitT < 4000) d *= 0.4; // мстимося
      if (!c.bot) d *= 0.85;
      if (d < bs) { bs = d; best = c; }
    }
    this.target = best;
  }

  update(dt) {
    const me = this.car, inp = me.input, g = this.game, world = g.world;
    inp.fire = inp.alt = inp.special = inp.boost = inp.brake = false;
    if (!me.alive) return;
    this.retarget -= dt;
    if (this.retarget <= 0 || !this.target || !this.target.alive) { this.pickTarget(); this.retarget = 1.2 + Math.random(); }
    const T = this.target;

    // мета руху
    let gx, gz, chasing = false;
    const low = me.hp / me.spec.hp < 0.4;
    const hasW = Object.keys(me.weapons).length > 0;
    let pk = null, pd = 1e9;
    for (const it of g.pickups.items) {
      if (!it.active) continue;
      if (it.kind === 'health' && !low) continue;
      if (it.kind === 'weapon' && hasW && !low) continue;
      if (it.kind === 'turbo' && me.boost > 0.4) continue;
      const d = Math.hypot(it.x - me.pos.x, it.z - me.pos.z);
      if (d < pd) { pd = d; pk = it; }
    }
    const tDist = T ? T.pos.distanceTo(me.pos) : 1e9;
    if (pk && (low || pd < 45 || !T || (pd < tDist * 0.6))) { gx = pk.x; gz = pk.z; }
    else if (T) {
      const lead = Math.min(1.2, tDist / 60);
      gx = T.pos.x + T.vel.x * lead; gz = T.pos.z + T.vel.z * lead; chasing = true;
    } else {
      if (!this.wander || Math.hypot(this.wander[0] - me.pos.x, this.wander[1] - me.pos.z) < 10) this.wander = [(Math.random() - 0.5) * 180, (Math.random() - 0.5) * 180];
      [gx, gz] = this.wander;
    }

    const dx = gx - me.pos.x, dz = gz - me.pos.z;
    const dist = Math.hypot(dx, dz);
    let a = wrap(Math.atan2(dx, dz) - me.yaw);

    // щупи: уникаємо будівель
    const fy = me.pos.y + 1;
    const feel = (ang, len) => world.segmentBlocked(me.pos.x, fy, me.pos.z, me.pos.x + Math.sin(me.yaw + ang) * len, fy, me.pos.z + Math.cos(me.yaw + ang) * len);
    const sp = Math.hypot(me.vel.x, me.vel.z);
    const look = 8 + sp * 0.5;
    const c0 = feel(0, look), cl = feel(0.5, look * 0.8), cr = feel(-0.5, look * 0.8);
    if (c0 >= 0 || cl >= 0 || cr >= 0) {
      const lFree = cl < 0 ? 1 : cl, rFree = cr < 0 ? 1 : cr;
      a += (lFree >= rFree ? 1 : -1) * (c0 >= 0 ? 1.1 : 0.5);
    }

    let steer = clamp(-a * 2.2, -1, 1);
    let throttle = Math.abs(a) < 1.5 ? 1 : 0.45;
    if (Math.abs(a) > 0.9 && sp > 18) inp.brake = true;

    // застрягли?
    if (this.reverseT > 0) {
      this.reverseT -= dt; throttle = -1; steer = this.revSteer;
    } else if (throttle > 0 && sp < 2.5) {
      this.stuckT += dt;
      if (this.stuckT > 1.1) { this.reverseT = 1 + Math.random() * 0.6; this.stuckT = 0; this.revSteer = Math.random() < 0.5 ? -1 : 1; }
    } else this.stuckT = 0;

    inp.steer = steer; inp.throttle = throttle;

    // стрільба
    if (T && T.alive) {
      const tx = T.pos.x - me.pos.x, tz = T.pos.z - me.pos.z;
      const ta = Math.abs(wrap(Math.atan2(tx, tz) - me.yaw));
      const td = Math.hypot(tx, tz);
      const los = world.segmentBlocked(me.pos.x, me.pos.y + 1.2, me.pos.z, T.pos.x, T.pos.y + 1.2, T.pos.z) < 0;
      const tol = 0.25 / this.skill;
      if (los && td < 60 && ta < tol) inp.fire = Math.random() < 0.85;
      if (chasing && ta < 0.25 && td > 45 && me.boost > 0.5) inp.boost = true;
      this.think -= dt;
      if (this.think <= 0 && los) {
        this.think = 0.3 + Math.random() * 0.5;
        const w = me.wsel;
        if (w) {
          if (w === 'homing' && td < 85) inp.alt = true;
          else if ((w === 'fire' || w === 'power') && ta < 0.14 && td < 65) inp.alt = true;
          else if (w === 'mine' && ta > 2.4 && td < 25) inp.alt = true;
          else if (w === 'shock' && td < 13) inp.alt = true;
        }
        if (me.specialT <= 0) {
          const s = me.spec.special;
          if (s === 'salvo' && ta < 0.2 && td < 55) inp.special = true;
          else if (s === 'ram' && ta < 0.25 && td < 32) inp.special = true;
          else if (s === 'zap' && ta < 0.7 && td < 34) inp.special = true;
          else if (s === 'minefield' && ta > 2.2 && td < 30) inp.special = true;
        }
      }
    }
  }
}
