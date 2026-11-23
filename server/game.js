// Авторитетна симуляція кімнати. Клієнти надсилають лише наміри (рух/каст/покупка),
// а сервер вирішує, що сталося насправді, і розсилає знімки стану.
import {
  TICK_RATE, ARENA, PLAYER, SPELLS, SPELL_POOL, LOADOUT_SIZE, MAX_LEVEL,
  levelCost, lvlDamage, lvlKnock, lvlCooldown, STAT_UPGRADES, MODES, MUTATORS,
  COLORS, PHASE_TIME,
} from '../shared/config.js';

const DT = 1 / TICK_RATE;
const MAX_PLAYERS = 8;
const BOT_NAMES = ['Мерлін', 'Моргана', 'Гендальф', 'Саруман', 'Ведмідь-маг', 'Кощій', 'Відьмак', 'Мавка'];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const len = (x, y) => Math.hypot(x, y);
const norm = (x, y) => {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
};
const num = (v, d = 0) => (Number.isFinite(v) ? clamp(v, -5000, 5000) : d);
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export class Room {
  constructor(code, onEmpty) {
    this.code = code;
    this.onEmpty = onEmpty;
    this.sockets = new Map(); // playerId -> ws
    this.players = new Map();
    this.settings = { mode: 'ffa', mutator: 'none', rounds: 5 };
    this.state = 'lobby';
    this.hostId = null;
    this.round = 0;
    this.timer = 0;
    this.time = 0;
    this.roundTime = 0;
    this.arenaR = ARENA.startRadius;
    this.projectiles = [];
    this.zones = [];
    this.events = [];
    this.nextId = 1;
    this.lastWinner = null;
    this.interval = setInterval(() => this.tick(), 1000 / TICK_RATE);
  }

  // ---------- з'єднання ----------
  addHuman(ws, name, color) {
    if (this.players.size >= MAX_PLAYERS) return null;
    const p = this.createPlayer(name, color, false);
    this.sockets.set(p.id, ws);
    if (!this.hostId) this.hostId = p.id;
    return p;
  }

  addBot() {
    if (this.players.size >= MAX_PLAYERS) return;
    const used = new Set([...this.players.values()].map((p) => p.name.replace(' 🤖', '')));
    const name = BOT_NAMES.find((n) => !used.has(n)) || 'Бот';
    const p = this.createPlayer(name + ' 🤖', null, true);
    p.spells = ['fireball', ...shuffle([...SPELL_POOL]).slice(0, LOADOUT_SIZE)];
    this.broadcastRoom();
  }

  removeBot() {
    const bots = [...this.players.values()].filter((p) => p.isBot);
    if (bots.length) this.removePlayer(bots[bots.length - 1].id);
  }

  createPlayer(name, color, isBot) {
    const id = this.nextId++;
    const usedColors = new Set([...this.players.values()].map((p) => p.color));
    const c = color && !usedColors.has(color) ? color : COLORS.find((x) => !usedColors.has(x)) || '#ccc';
    const p = {
      id, name: String(name || 'Маг').slice(0, 16), color: c, isBot,
      team: 0, spells: ['fireball', 'lightning', 'blink', 'gravity', 'meteor'],
      levels: {}, cds: {}, stats: { vit: 0, boots: 0, anchor: 0 },
      x: 0, y: 0, vx: 0, vy: 0, tx: null, ty: null,
      hp: PLAYER.maxHp, maxHp: PLAYER.maxHp, dead: true, dmgTaken: 0,
      gold: 4, score: 0, kills: 0, roundKills: 0, dmgDealt: 0,
      shieldT: 0, slowT: 0, dashT: 0, dashDir: [0, 0], dashHit: new Set(),
      lastHitBy: null, lastHitTime: -99, ready: false,
      aiT: 0, aiTarget: null,
    };
    this.players.set(id, p);
    this.rebalanceTeams();
    return p;
  }

  removePlayer(id) {
    this.players.delete(id);
    this.sockets.delete(id);
    if (this.hostId === id) {
      const human = [...this.players.values()].find((p) => !p.isBot);
      this.hostId = human ? human.id : null;
    }
    if (!this.hostId) {
      this.destroy();
      return;
    }
    this.rebalanceTeams();
    this.broadcastRoom();
  }

  destroy() {
    clearInterval(this.interval);
    this.onEmpty(this.code);
  }

  rebalanceTeams() {
    const list = [...this.players.values()];
    if (this.settings.mode === 'teams') list.forEach((p, i) => (p.team = i % 2));
    else list.forEach((p) => (p.team = p.id));
  }

  // ---------- повідомлення від клієнта ----------
  handle(playerId, msg) {
    const p = this.players.get(playerId);
    if (!p || typeof msg !== 'object') return;
    const isHost = playerId === this.hostId;
    switch (msg.type) {
      case 'move':
        if (p.dead) return;
        p.tx = num(msg.x);
        p.ty = num(msg.y);
        break;
      case 'stop':
        p.tx = p.ty = null;
        break;
      case 'cast':
        this.cast(p, msg.slot | 0, num(msg.x), num(msg.y));
        break;
      case 'loadout':
        if (this.state !== 'lobby' && this.state !== 'shop') return;
        if (!Array.isArray(msg.spells)) return;
        {
          const uniq = [...new Set(msg.spells.filter((s) => SPELL_POOL.includes(s)))];
          if (uniq.length !== LOADOUT_SIZE) return;
          p.spells = ['fireball', ...uniq];
        }
        this.broadcastRoom();
        break;
      case 'buy':
        if (this.state === 'shop' || this.state === 'lobby') this.buy(p, String(msg.item));
        break;
      case 'ready':
        p.ready = !!msg.ready;
        this.broadcastRoom();
        break;
      case 'team':
        if (this.settings.mode === 'teams' && this.state === 'lobby') {
          p.team = p.team ? 0 : 1;
          this.broadcastRoom();
        }
        break;
      case 'settings':
        if (!isHost || this.state !== 'lobby') return;
        if (MODES[msg.mode]) this.settings.mode = msg.mode;
        if (MUTATORS[msg.mutator]) this.settings.mutator = msg.mutator;
        if (Number.isFinite(msg.rounds)) this.settings.rounds = clamp(msg.rounds | 0, 1, 15);
        this.rebalanceTeams();
        this.broadcastRoom();
        break;
      case 'addBot':
        if (isHost && this.state === 'lobby') this.addBot();
        break;
      case 'removeBot':
        if (isHost && this.state === 'lobby') this.removeBot();
        break;
      case 'start':
        if (isHost && this.state === 'lobby' && this.players.size >= 2) this.startGame();
        break;
    }
  }

  buy(p, item) {
    if (item.startsWith('spell:')) {
      const s = item.slice(6);
      if (!p.spells.includes(s)) return;
      const lvl = p.levels[s] || 1;
      if (lvl >= MAX_LEVEL || p.gold < levelCost(lvl)) return;
      p.gold -= levelCost(lvl);
      p.levels[s] = lvl + 1;
    } else if (STAT_UPGRADES[item]) {
      const u = STAT_UPGRADES[item];
      if (p.stats[item] >= u.max || p.gold < u.cost) return;
      p.gold -= u.cost;
      p.stats[item]++;
    }
    this.broadcastRoom();
  }

  // ---------- фази гри ----------
  startGame() {
    this.round = 0;
    for (const p of this.players.values()) {
      Object.assign(p, { score: 0, kills: 0, gold: 4, levels: {}, stats: { vit: 0, boots: 0, anchor: 0 } });
    }
    this.enterShop();
  }

  enterShop() {
    this.state = 'shop';
    this.timer = this.round === 0 ? 10 : PHASE_TIME.shop;
    for (const p of this.players.values()) p.ready = p.isBot;
    for (const p of this.players.values()) if (p.isBot) this.botShop(p);
    this.projectiles = [];
    this.zones = [];
    this.broadcastRoom();
  }

  startRound() {
    this.round++;
    this.state = 'countdown';
    this.timer = PHASE_TIME.countdown;
    this.roundTime = 0;
    this.arenaR = ARENA.startRadius;
    this.projectiles = [];
    this.zones = [];
    const list = shuffle([...this.players.values()]);
    const spawnR = ARENA.startRadius * 0.6;
    list.forEach((p, i) => {
      const a = (i / list.length) * Math.PI * 2;
      p.maxHp = PLAYER.maxHp + 12 * p.stats.vit;
      Object.assign(p, {
        x: Math.cos(a) * spawnR, y: Math.sin(a) * spawnR, vx: 0, vy: 0, tx: null, ty: null,
        hp: p.maxHp, dead: false, dmgTaken: 0, shieldT: 0, slowT: 0, dashT: 0,
        lastHitBy: null, roundKills: 0, dmgDealt: 0, cds: {},
      });
    });
    this.broadcastRoom();
  }

  endRound() {
    const alive = [...this.players.values()].filter((p) => !p.dead);
    const winTeam = alive.length ? alive[0].team : null;
    const winners = [...this.players.values()].filter((p) => winTeam !== null && p.team === winTeam);
    for (const p of this.players.values()) {
      p.gold += 3 + p.roundKills * 2 + Math.floor(p.dmgDealt / 25);
      p.score += p.roundKills;
    }
    for (const w of winners) {
      w.score += 3;
      w.gold += 3;
    }
    this.lastWinner = winners.length ? winners.map((w) => w.name).join(', ') : 'Нічия';
    this.events.push({ t: 'roundEnd', winner: this.lastWinner });
    this.state = 'roundEnd';
    this.timer = PHASE_TIME.roundEnd;
    this.broadcastRoom();
  }

  // ---------- головний цикл ----------
  tick() {
    this.time += DT;
    switch (this.state) {
      case 'shop': {
        this.timer -= DT;
        const humans = [...this.players.values()].filter((p) => !p.isBot);
        if (this.timer <= 0 || (humans.length && humans.every((p) => p.ready))) this.startRound();
        break;
      }
      case 'countdown':
        this.timer -= DT;
        if (this.timer <= 0) this.state = 'playing';
        break;
      case 'playing':
        this.simulate();
        break;
      case 'roundEnd':
        this.timer -= DT;
        this.simulate(true);
        if (this.timer <= 0) {
          if (this.round >= this.settings.rounds) {
            this.state = 'gameOver';
            this.timer = PHASE_TIME.gameOver;
            this.broadcastRoom();
          } else this.enterShop();
        }
        break;
      case 'gameOver':
        this.timer -= DT;
        if (this.timer <= 0) {
          this.state = 'lobby';
          for (const p of this.players.values()) p.dead = true;
          this.broadcastRoom();
        }
        break;
    }
    if (this.state !== 'lobby') this.broadcastSnapshot();
  }

  simulate(frozen = false) {
    if (!frozen) this.roundTime += DT;
    const k = clamp((this.roundTime - ARENA.shrinkDelay) / ARENA.shrinkTime, 0, 1);
    this.arenaR = ARENA.startRadius - (ARENA.startRadius - ARENA.minRadius) * k;
    const mut = this.settings.mutator;
    const friction = mut === 'ice' ? 1.1 : PLAYER.friction;
    const players = [...this.players.values()];
    const alive = players.filter((p) => !p.dead);

    if (!frozen) for (const p of alive) if (p.isBot) this.botThink(p, alive);

    for (const p of alive) {
      for (const s in p.cds) p.cds[s] = Math.max(0, p.cds[s] - DT);
      p.shieldT = Math.max(0, p.shieldT - DT);
      p.slowT = Math.max(0, p.slowT - DT);
      let mx = 0, my = 0;
      if (p.dashT > 0) {
        p.dashT -= DT;
        mx = p.dashDir[0] * SPELLS.dash.speed;
        my = p.dashDir[1] * SPELLS.dash.speed;
      } else if (p.tx !== null) {
        const dx = p.tx - p.x, dy = p.ty - p.y;
        const d = len(dx, dy);
        if (d < 4) p.tx = p.ty = null;
        else {
          const sp = PLAYER.speed * (1 + 0.08 * p.stats.boots) * (p.slowT > 0 ? 0.5 : 1);
          const step = Math.min(sp, d / DT);
          mx = (dx / d) * step;
          my = (dy / d) * step;
        }
      }
      p.x += (mx + p.vx) * DT;
      p.y += (my + p.vy) * DT;
      const f = Math.exp(-friction * DT);
      p.vx *= f;
      p.vy *= f;
      // лава
      if (len(p.x, p.y) > this.arenaR && !frozen) {
        this.damage(p, PLAYER.lavaDps * DT, null);
      }
    }

    // зіткнення гравців + таран ривком
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = len(dx, dy);
        const min = PLAYER.radius * 2;
        if (d < min && d > 0) {
          const push = (min - d) / 2;
          a.x -= (dx / d) * push; a.y -= (dy / d) * push;
          b.x += (dx / d) * push; b.y += (dy / d) * push;
          for (const [att, vic, sx] of [[a, b, 1], [b, a, -1]]) {
            if (att.dashT > 0 && att.team !== vic.team && !att.dashHit.has(vic.id)) {
              att.dashHit.add(vic.id);
              const lvl = att.levels.dash || 1;
              this.hit(vic, att, SPELLS.dash.damage * lvlDamage(lvl), SPELLS.dash.knock * lvlKnock(lvl), (dx / d) * sx, (dy / d) * sx);
              att.dashT = 0;
              att.vx *= 0.2; att.vy *= 0.2;
              this.events.push({ t: 'boom', x: vic.x, y: vic.y, c: SPELLS.dash.color, s: 0.6 });
            }
          }
        }
      }
    }

    this.updateProjectiles(alive);
    this.updateZones(alive);

    // смерті
    for (const p of alive) {
      if (p.hp <= 0 && !p.dead) {
        p.dead = true;
        p.tx = p.ty = null;
        this.events.push({ t: 'death', x: p.x, y: p.y, c: p.color, name: p.name });
        const killer = p.lastHitBy && this.time - p.lastHitTime < 6 ? this.players.get(p.lastHitBy) : null;
        if (killer && killer.team !== p.team) killer.roundKills++, killer.kills++;
        this.events.push({ t: 'feed', text: killer ? `${killer.name} ➜ ${p.name}` : `${p.name} згорів у лаві` });
      }
    }

    if (!frozen && this.state === 'playing') {
      const teams = new Set(players.filter((p) => !p.dead).map((p) => p.team));
      if (teams.size <= 1) this.endRound();
    }
  }

  updateProjectiles(alive) {
    const keep = [];
    for (const pr of this.projectiles) {
      pr.life -= DT;
      const def = SPELLS[pr.type];
      if (def.homing) {
        let best = null, bd = 520;
        for (const p of alive) {
          if (p.team === pr.team) continue;
          const d = len(p.x - pr.x, p.y - pr.y);
          if (d < bd) (bd = d), (best = p);
        }
        if (best) {
          const cur = Math.atan2(pr.vy, pr.vx);
          const want = Math.atan2(best.y - pr.y, best.x - pr.x);
          let diff = ((want - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          const turn = clamp(diff, -def.homing * DT, def.homing * DT);
          const sp = len(pr.vx, pr.vy);
          pr.vx = Math.cos(cur + turn) * sp;
          pr.vy = Math.sin(cur + turn) * sp;
        }
      }
      pr.x += pr.vx * DT;
      pr.y += pr.vy * DT;

      let gone = pr.life <= 0;
      if (!gone) {
        for (const p of alive) {
          if (p.team === pr.team || p.dead) continue;
          if (len(p.x - pr.x, p.y - pr.y) > PLAYER.radius + pr.r) continue;
          if (p.shieldT > 0) {
            // відбиття
            const [nx, ny] = norm(pr.x - p.x, pr.y - p.y);
            const sp = len(pr.vx, pr.vy);
            pr.vx = nx * sp; pr.vy = ny * sp;
            pr.owner = p.id; pr.team = p.team;
            pr.life = Math.max(pr.life, 1);
            this.events.push({ t: 'boom', x: pr.x, y: pr.y, c: SPELLS.shield.color, s: 0.4 });
            break;
          }
          const owner = this.players.get(pr.owner);
          const [dx, dy] = norm(pr.vx, pr.vy);
          this.hit(p, owner, pr.dmg, pr.knock, dx, dy);
          if (def.swap && owner && !owner.dead) {
            const ox = owner.x, oy = owner.y;
            owner.x = p.x; owner.y = p.y; p.x = ox; p.y = oy;
            owner.tx = owner.ty = p.tx = p.ty = null;
            this.events.push({ t: 'blink', x1: ox, y1: oy, x2: owner.x, y2: owner.y, c: def.color });
          }
          gone = true;
          break;
        }
      }
      // снаряди різних власників знищують один одного
      if (!gone) {
        for (const o of this.projectiles) {
          if (o === pr || o.dead || o.team === pr.team) continue;
          if (len(o.x - pr.x, o.y - pr.y) < o.r + pr.r) {
            o.dead = true;
            gone = true;
            this.events.push({ t: 'boom', x: pr.x, y: pr.y, c: '#fff', s: 0.5 });
            break;
          }
        }
      }
      if (gone || pr.dead) {
        pr.dead = true;
        if (def.field) {
          this.zones.push({ id: this.nextId++, type: 'gravity', x: pr.x, y: pr.y, r: def.field.radius, t: def.field.time, owner: pr.owner, team: pr.team, pull: def.field.pull * pr.lvlK });
        } else this.events.push({ t: 'boom', x: pr.x, y: pr.y, c: def.color, s: 0.5 });
      } else keep.push(pr);
    }
    this.projectiles = keep.filter((p) => !p.dead);
  }

  updateZones(alive) {
    const keep = [];
    for (const z of this.zones) {
      z.t -= DT;
      if (z.type === 'gravity') {
        for (const p of alive) {
          if (p.id === z.owner) continue;
          const dx = z.x - p.x, dy = z.y - p.y;
          const d = len(dx, dy);
          if (d < z.r && d > 1) {
            const f = z.pull * (0.35 + 0.65 * (1 - d / z.r)) * DT * (1 - 0.1 * p.stats.anchor);
            p.vx += (dx / d) * f;
            p.vy += (dy / d) * f;
          }
        }
      } else if (z.type === 'meteor' && z.t <= 0) {
        const owner = this.players.get(z.owner);
        for (const p of alive) {
          if (p.team === z.team) continue;
          const dx = p.x - z.x, dy = p.y - z.y;
          const d = len(dx, dy);
          if (d < z.r + PLAYER.radius) {
            const [nx, ny] = d > 1 ? [dx / d, dy / d] : norm(Math.random() - 0.5, Math.random() - 0.5);
            this.hit(p, owner, z.dmg, z.knock, nx, ny);
          }
        }
        this.events.push({ t: 'boom', x: z.x, y: z.y, c: SPELLS.meteor.color, s: 1.6 });
      }
      if (z.t > 0) keep.push(z);
    }
    this.zones = keep;
  }

  damage(p, amount, attacker) {
    p.hp -= amount;
    p.dmgTaken += amount;
    if (attacker && attacker.team !== p.team) attacker.dmgDealt += amount;
  }

  hit(victim, attacker, dmg, knock, dx, dy) {
    if (victim.dead) return;
    this.damage(victim, dmg, attacker);
    let mult = (1 + victim.dmgTaken / PLAYER.knockScale) * (1 - 0.1 * victim.stats.anchor);
    if (this.settings.mutator === 'chaos') mult *= 2;
    victim.vx += dx * knock * mult;
    victim.vy += dy * knock * mult;
    victim.dashT = 0;
    if (attacker) {
      victim.lastHitBy = attacker.id;
      victim.lastHitTime = this.time;
    }
  }

  cast(p, slot, ax, ay) {
    if (this.state !== 'playing' || p.dead) return;
    const id = p.spells[slot];
    const def = SPELLS[id];
    if (!def || (p.cds[id] || 0) > 0) return;
    const lvl = p.levels[id] || 1;
    let [dx, dy] = norm(ax - p.x, ay - p.y);
    const dmg = (def.damage || 0) * lvlDamage(lvl);
    const knock = (def.knock || 0) * lvlKnock(lvl);

    switch (def.kind) {
      case 'projectile': {
        const off = PLAYER.radius + def.radius + 2;
        this.projectiles.push({
          id: this.nextId++, type: id, owner: p.id, team: p.team,
          x: p.x + dx * off, y: p.y + dy * off, vx: dx * def.speed, vy: dy * def.speed,
          r: def.radius, life: def.life, dmg, knock, lvlK: lvlKnock(lvl),
        });
        break;
      }
      case 'beam': {
        let best = null, bt = def.range;
        for (const o of this.players.values()) {
          if (o.dead || o.team === p.team) continue;
          const t = (o.x - p.x) * dx + (o.y - p.y) * dy;
          if (t < 0 || t > def.range) continue;
          const px = p.x + dx * t, py = p.y + dy * t;
          if (len(o.x - px, o.y - py) < PLAYER.radius + 8 && t < bt) (bt = t), (best = o);
        }
        if (best) this.hit(best, p, dmg, knock, dx, dy);
        this.events.push({ t: 'bolt', x1: p.x, y1: p.y, x2: p.x + dx * bt, y2: p.y + dy * bt, c: def.color });
        break;
      }
      case 'blink': {
        const d = Math.min(def.range * (1 + 0.15 * (lvl - 1)), len(ax - p.x, ay - p.y));
        const ox = p.x, oy = p.y;
        p.x += dx * d; p.y += dy * d;
        p.tx = p.ty = null;
        this.events.push({ t: 'blink', x1: ox, y1: oy, x2: p.x, y2: p.y, c: def.color });
        break;
      }
      case 'dash':
        p.dashT = def.time;
        p.dashDir = [dx, dy];
        p.dashHit = new Set();
        p.tx = p.ty = null;
        break;
      case 'shield':
        p.shieldT = def.time * (1 + 0.2 * (lvl - 1));
        break;
      case 'meteor': {
        const d = Math.min(def.range, len(ax - p.x, ay - p.y));
        this.zones.push({ id: this.nextId++, type: 'meteor', x: p.x + dx * d, y: p.y + dy * d, r: def.radius, t: def.delay, owner: p.id, team: p.team, dmg, knock });
        break;
      }
      case 'nova': {
        for (const o of this.players.values()) {
          if (o.dead || o.team === p.team) continue;
          const ox = o.x - p.x, oy = o.y - p.y;
          if (len(ox, oy) < def.radius + PLAYER.radius) {
            const [nx, ny] = norm(ox, oy);
            this.hit(o, p, dmg, knock, nx, ny);
            o.slowT = def.slow;
          }
        }
        this.events.push({ t: 'nova', x: p.x, y: p.y, r: def.radius, c: def.color });
        break;
      }
    }
    let cd = def.cd * lvlCooldown(lvl);
    if (this.settings.mutator === 'rapid') cd *= 0.5;
    p.cds[id] = cd;
  }

  // ---------- боти ----------
  botShop(p) {
    let guard = 10;
    while (guard-- > 0 && p.gold >= 3) {
      const opts = p.spells.filter((s) => (p.levels[s] || 1) < MAX_LEVEL && p.gold >= levelCost(p.levels[s] || 1));
      if (Math.random() < 0.3 && p.stats.vit < 3 && p.gold >= 4) this.buy(p, 'vit');
      else if (opts.length) this.buy(p, 'spell:' + opts[Math.floor(Math.random() * opts.length)]);
      else break;
    }
  }

  botThink(p, alive) {
    p.aiT -= DT;
    const enemies = alive.filter((o) => o.team !== p.team);
    if (!enemies.length) return;
    let target = enemies[0], bd = Infinity;
    for (const e of enemies) {
      const d = len(e.x - p.x, e.y - p.y);
      if (d < bd) (bd = d), (target = e);
    }
    const distC = len(p.x, p.y);
    // рятуємося з лави
    if (distC > this.arenaR - 30) {
      if (p.spells.includes('blink') && !(p.cds.blink > 0) && distC > this.arenaR + 10) {
        this.cast(p, p.spells.indexOf('blink'), 0, 0);
      }
      p.tx = (-p.x / distC) * this.arenaR * 0.3;
      p.ty = (-p.y / distC) * this.arenaR * 0.3;
    } else if (p.aiT <= 0) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * this.arenaR * 0.55;
      p.tx = Math.cos(a) * r;
      p.ty = Math.sin(a) * r;
    }
    if (p.aiT > 0) return;
    p.aiT = 0.35 + Math.random() * 0.5;

    // щит від вхідних снарядів
    if (p.spells.includes('shield') && !(p.cds.shield > 0)) {
      const danger = this.projectiles.some((pr) => pr.team !== p.team && len(pr.x - p.x, pr.y - p.y) < 90);
      if (danger) return this.cast(p, p.spells.indexOf('shield'), p.x, p.y);
    }
    // упереджувальне прицілювання
    const lead = bd / SPELLS.fireball.speed;
    const ax = target.x + (target.vx + (target.tx !== null ? 0 : 0)) * lead * 0.5;
    const ay = target.y + target.vy * lead * 0.5;
    const order = shuffle(p.spells.slice(1)).concat('fireball');
    for (const s of order) {
      if ((p.cds[s] || 0) > 0) continue;
      const def = SPELLS[s];
      const slot = p.spells.indexOf(s);
      if (def.kind === 'beam' && bd < def.range) return this.cast(p, slot, target.x, target.y);
      if (def.kind === 'nova' && bd < def.radius) return this.cast(p, slot, p.x, p.y);
      if (def.kind === 'meteor' && bd < def.range && Math.random() < 0.5) return this.cast(p, slot, ax, ay);
      if (def.kind === 'dash' && bd < 200) return this.cast(p, slot, target.x, target.y);
      if (def.kind === 'projectile' && bd < 650 && Math.random() < 0.8) return this.cast(p, slot, ax, ay);
    }
  }

  // ---------- мережа ----------
  publicPlayer(p) {
    return {
      id: p.id, name: p.name, color: p.color, team: p.team, isBot: p.isBot,
      spells: p.spells, levels: p.levels, stats: p.stats, gold: p.gold,
      score: p.score, kills: p.kills, ready: p.ready,
    };
  }

  broadcastRoom() {
    this.send({
      type: 'room', code: this.code, hostId: this.hostId, state: this.state,
      settings: this.settings, round: this.round, winner: this.lastWinner,
      players: [...this.players.values()].map((p) => this.publicPlayer(p)),
    });
  }

  broadcastSnapshot() {
    const r1 = (v) => Math.round(v * 10) / 10;
    this.send({
      type: 's',
      t: Math.round(this.time * 1000),
      st: this.state,
      tm: r1(this.timer),
      ar: r1(this.arenaR),
      p: [...this.players.values()].map((p) => ({
        id: p.id, x: r1(p.x), y: r1(p.y), hp: Math.ceil(p.hp), mhp: p.maxHp, d: p.dead ? 1 : 0,
        sh: p.shieldT > 0 ? 1 : 0, sl: p.slowT > 0 ? 1 : 0, ds: p.dashT > 0 ? 1 : 0,
        dt: Math.round(p.dmgTaken),
        cd: p.spells.map((s) => r1(p.cds[s] || 0)),
      })),
      pr: this.projectiles.map((pr) => ({ id: pr.id, ty: pr.type, x: r1(pr.x), y: r1(pr.y) })),
      z: this.zones.map((z) => ({ id: z.id, ty: z.type, x: r1(z.x), y: r1(z.y), r: z.r, t: r1(z.t) })),
      ev: this.events,
    });
    this.events = [];
  }

  send(obj) {
    const data = JSON.stringify(obj);
    for (const ws of this.sockets.values()) if (ws.readyState === 1) ws.send(data);
  }
}
