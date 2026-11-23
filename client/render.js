// Рендер на Canvas 2D: лава, арена, гравці, снаряди, частинки.
import { SPELLS, PLAYER, ARENA, TEAM_COLORS } from '/shared/config.js';

const VIEW_R = ARENA.startRadius + 60;

export class Renderer {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.bolts = [];
    this.rings = [];
    this.shake = 0;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.c.width = innerWidth * dpr;
    this.c.height = innerHeight * dpr;
    this.dpr = dpr;
    this.scale = (Math.min(innerWidth, innerHeight - 90) / (VIEW_R * 2)) * dpr;
  }

  toWorld(sx, sy) {
    return [(sx * this.dpr - this.c.width / 2) / this.scale, (sy * this.dpr - this.c.height / 2 + 20 * this.dpr) / this.scale];
  }

  // ---- ефекти ----
  burst(x, y, color, n = 14, speed = 160, life = 0.6, size = 4) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random());
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, size: size * (0.5 + Math.random()) });
    }
  }

  event(ev) {
    switch (ev.t) {
      case 'boom':
        this.burst(ev.x, ev.y, ev.c, Math.round(16 * ev.s), 200 * ev.s, 0.5 + 0.2 * ev.s, 4 + 2 * ev.s);
        this.rings.push({ x: ev.x, y: ev.y, r: 5, max: 40 + 50 * ev.s, life: 0.35, t: 0.35, c: ev.c });
        this.shake = Math.max(this.shake, 4 * ev.s);
        break;
      case 'bolt':
        this.bolts.push({ ...ev, life: 0.18 });
        this.burst(ev.x2, ev.y2, ev.c, 10, 180, 0.35, 3);
        break;
      case 'blink':
        this.burst(ev.x1, ev.y1, ev.c, 16, 120, 0.5, 3);
        this.burst(ev.x2, ev.y2, ev.c, 16, 120, 0.5, 3);
        break;
      case 'nova':
        this.rings.push({ x: ev.x, y: ev.y, r: 10, max: ev.r, life: 0.35, t: 0.35, c: ev.c, w: 8 });
        this.burst(ev.x, ev.y, ev.c, 30, 260, 0.5, 4);
        break;
      case 'death':
        this.burst(ev.x, ev.y, ev.c, 40, 260, 1.0, 6);
        this.burst(ev.x, ev.y, '#ff5a1a', 30, 200, 1.2, 5);
        this.shake = 10;
        break;
    }
  }

  // ---- кадр ----
  draw(state, players, meId, dt, time, clickMark) {
    const { ctx, c } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawLava(time);
    const sx = (Math.random() - 0.5) * this.shake * this.dpr;
    const sy = (Math.random() - 0.5) * this.shake * this.dpr;
    this.shake = Math.max(0, this.shake - dt * 30);
    ctx.setTransform(this.scale, 0, 0, this.scale, c.width / 2 + sx, c.height / 2 - 20 * this.dpr + sy);

    if (state) this.drawArena(state.ar, time);
    if (state) for (const z of state.z) this.drawZone(z, time);

    if (clickMark && clickMark.t > 0) {
      ctx.strokeStyle = `rgba(120,255,140,${clickMark.t})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(clickMark.x, clickMark.y, 10 * (1.5 - clickMark.t), 0, Math.PI * 2);
      ctx.stroke();
    }

    // сліди снарядів
    if (state) {
      for (const pr of state.pr) {
        const def = SPELLS[pr.ty];
        this.particles.push({ x: pr.x + (Math.random() - 0.5) * 6, y: pr.y + (Math.random() - 0.5) * 6, vx: 0, vy: 0, life: 0.3, max: 0.3, color: def.color, size: def.radius * 0.8 });
      }
    }
    this.drawParticles(dt);

    if (state) {
      for (const pr of state.pr) this.drawProjectile(pr, time);
      for (const sp of state.p) {
        const info = players.get(sp.id);
        if (info && !sp.d) this.drawPlayer(sp, info, sp.id === meId, time);
      }
    }

    for (const b of this.bolts) {
      b.life -= dt;
      ctx.save();
      ctx.strokeStyle = b.c;
      ctx.shadowColor = b.c;
      ctx.shadowBlur = 20;
      ctx.lineWidth = 4 * (b.life / 0.18) + 1;
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      const n = 7;
      for (let i = 1; i < n; i++) {
        const k = i / n;
        ctx.lineTo(b.x1 + (b.x2 - b.x1) * k + (Math.random() - 0.5) * 18, b.y1 + (b.y2 - b.y1) * k + (Math.random() - 0.5) * 18);
      }
      ctx.lineTo(b.x2, b.y2);
      ctx.stroke();
      ctx.restore();
    }
    this.bolts = this.bolts.filter((b) => b.life > 0);

    for (const r of this.rings) {
      r.t -= dt;
      const k = 1 - r.t / r.life;
      ctx.strokeStyle = r.c;
      ctx.globalAlpha = Math.max(0, r.t / r.life);
      ctx.lineWidth = r.w || 3;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r + (r.max - r.r) * k, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    this.rings = this.rings.filter((r) => r.t > 0);
  }

  drawLava(time) {
    const { ctx, c } = this;
    const g = ctx.createRadialGradient(c.width / 2, c.height / 2, 0, c.width / 2, c.height / 2, Math.max(c.width, c.height) * 0.7);
    g.addColorStop(0, '#5a1405');
    g.addColorStop(1, '#1a0402');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
    // повільні "бульбашки" лави
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 18; i++) {
      const x = ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
      const y = ((Math.sin(i * 78.233) * 12345.678) % 1 + 1) % 1;
      const px = x * c.width + Math.sin(time * 0.3 + i) * 40 * this.dpr;
      const py = y * c.height + Math.cos(time * 0.25 + i * 2) * 40 * this.dpr;
      const r = (80 + 60 * Math.sin(time * 0.5 + i)) * this.dpr;
      const bg = ctx.createRadialGradient(px, py, 0, px, py, r);
      bg.addColorStop(0, 'rgba(255,110,20,0.22)');
      bg.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = bg;
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  drawArena(r, time) {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = '#ff6a00';
    ctx.shadowBlur = 40;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, '#4b4048');
    g.addColorStop(0.85, '#3a3138');
    g.addColorStop(1, '#2a2026');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // плитки
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    for (let rr = 60; rr < ARENA.startRadius; rr += 60) {
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * 60, Math.sin(ang) * 60);
      ctx.lineTo(Math.cos(ang) * ARENA.startRadius, Math.sin(ang) * ARENA.startRadius);
      ctx.stroke();
    }
    // руни в центрі
    ctx.strokeStyle = `rgba(255,140,60,${0.25 + 0.1 * Math.sin(time * 2)})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 40, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // розжарений край
    ctx.strokeStyle = `rgba(255,${120 + 40 * Math.sin(time * 4)},40,0.9)`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawZone(z, time) {
    const ctx = this.ctx;
    if (z.ty === 'meteor') {
      const k = Math.max(0, z.t / SPELLS.meteor.delay);
      ctx.fillStyle = `rgba(255,50,30,${0.15 + 0.2 * (1 - k)})`;
      ctx.strokeStyle = '#ff3b2f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.r * k, 0, Math.PI * 2);
      ctx.stroke();
      // сам метеор, що падає
      const h = 260 * k;
      ctx.fillStyle = '#ffb347';
      ctx.shadowColor = '#ff3b2f';
      ctx.shadowBlur = 25;
      ctx.beginPath();
      ctx.arc(z.x - h * 0.4, z.y - h, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    } else if (z.ty === 'gravity') {
      ctx.save();
      ctx.translate(z.x, z.y);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, z.r);
      g.addColorStop(0, 'rgba(20,0,40,0.9)');
      g.addColorStop(0.3, 'rgba(110,90,255,0.35)');
      g.addColorStop(1, 'rgba(110,90,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, z.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(170,160,255,0.6)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        ctx.rotate(time * 2 + (i * Math.PI) / 2);
        ctx.beginPath();
        ctx.arc(0, 0, z.r * (0.3 + 0.15 * i), 0, Math.PI * 0.8);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawProjectile(pr, time) {
    const ctx = this.ctx;
    const def = SPELLS[pr.ty];
    ctx.save();
    ctx.shadowColor = def.color;
    ctx.shadowBlur = 20;
    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.arc(pr.x, pr.y, def.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(pr.x, pr.y, def.radius * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawPlayer(sp, info, isMe, time) {
    const ctx = this.ctx;
    const R = PLAYER.radius;
    ctx.save();
    ctx.translate(sp.x, sp.y);
    // тінь
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(3, 6, R, R * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    if (isMe) {
      ctx.strokeStyle = 'rgba(120,255,140,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, R + 7, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (info.teamMode) {
      ctx.strokeStyle = TEAM_COLORS[info.team];
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, R + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    // тіло-мантія
    const g = ctx.createRadialGradient(-5, -5, 2, 0, 0, R);
    g.addColorStop(0, '#fff');
    g.addColorStop(0.25, info.color);
    g.addColorStop(1, shade(info.color, -0.5));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    // капюшон
    ctx.fillStyle = shade(info.color, -0.65);
    ctx.beginPath();
    ctx.moveTo(-R * 0.7, -R * 0.2);
    ctx.lineTo(0, -R * 1.5);
    ctx.lineTo(R * 0.7, -R * 0.2);
    ctx.closePath();
    ctx.fill();
    if (sp.sl) {
      ctx.fillStyle = 'rgba(120,200,255,0.4)';
      ctx.beginPath();
      ctx.arc(0, 0, R + 2, 0, Math.PI * 2);
      ctx.fill();
    }
    if (sp.sh) {
      ctx.strokeStyle = SPELLS.shield.color;
      ctx.shadowColor = SPELLS.shield.color;
      ctx.shadowBlur = 15;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, R + 10 + Math.sin(time * 20) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    // HP та ім'я
    const w = 40;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(-w / 2, -R - 22, w, 6);
    const k = Math.max(0, sp.hp / sp.mhp);
    ctx.fillStyle = k > 0.5 ? '#69f0ae' : k > 0.25 ? '#ffd740' : '#ff5252';
    ctx.fillRect(-w / 2, -R - 22, w * k, 6);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(info.name, 0, -R - 27);
    // множник відкидання
    ctx.font = 'bold 10px system-ui';
    ctx.fillStyle = sp.dt > 60 ? '#ff5252' : '#ffd7a8';
    ctx.fillText(`×${(1 + sp.dt / PLAYER.knockScale).toFixed(1)}`, 0, R + 14);
    ctx.restore();
  }

  drawParticles(dt) {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
      const a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.particles = this.particles.filter((p) => p.life > 0);
    if (this.particles.length > 1500) this.particles.splice(0, this.particles.length - 1500);
  }
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (v) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
