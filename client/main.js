// Клієнт: мережа, інтерполяція, введення, UI.
import {
  SPELLS, SPELL_POOL, LOADOUT_SIZE, SLOT_KEYS, STAT_UPGRADES, MODES, MUTATORS,
  COLORS, TEAM_COLORS, MAX_LEVEL, levelCost, INTERP_DELAY,
} from '/shared/config.js';
import { Renderer } from '/client/render.js';

const $ = (id) => document.getElementById(id);
const renderer = new Renderer($('game'));

let ws = null;
let meId = null;
let room = null; // останній стан кімнати
const players = new Map(); // id -> публічна інфа
const snaps = []; // буфер знімків для інтерполяції
let clockOffset = null;
let mouse = { x: 0, y: 0, down: false };
let clickMark = null;
let lastMoveSent = 0;
let myColor = localStorage.getItem('wa_color') || COLORS[Math.floor(Math.random() * COLORS.length)];

// ---------- меню ----------
$('name').value = localStorage.getItem('wa_name') || '';
const urlCode = new URLSearchParams(location.search).get('room');
if (urlCode) $('code').value = urlCode;

function renderColors() {
  $('colors').innerHTML = '';
  for (const c of COLORS) {
    const d = document.createElement('div');
    d.style.background = c;
    if (c === myColor) d.className = 'sel';
    d.onclick = () => {
      myColor = c;
      renderColors();
    };
    $('colors').appendChild(d);
  }
}
renderColors();

function connect(first) {
  const name = $('name').value.trim() || 'Маг';
  localStorage.setItem('wa_name', name);
  localStorage.setItem('wa_color', myColor);
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => ws.send(JSON.stringify({ ...first, name, color: myColor }));
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  ws.onclose = () => {
    if (meId) {
      alert("З'єднання втрачено");
      location.reload();
    }
  };
}
const send = (o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));

$('btnCreate').onclick = () => connect({ type: 'create' });
$('btnJoin').onclick = () => connect({ type: 'join', code: $('code').value });
$('code').onkeydown = (e) => e.key === 'Enter' && $('btnJoin').click();

// ---------- повідомлення ----------
function onMessage(m) {
  if (m.type === 'error') {
    $('menuErr').textContent = m.text;
    ws.onclose = null;
    ws.close();
  } else if (m.type === 'welcome') {
    meId = m.id;
    history.replaceState(null, '', `?room=${m.code}`);
  } else if (m.type === 'room') {
    room = m;
    players.clear();
    for (const p of m.players) players.set(p.id, { ...p, teamMode: m.settings.mode === 'teams' });
    updateScreens();
  } else if (m.type === 's') {
    const now = performance.now();
    const est = m.t - now;
    if (clockOffset === null || Math.abs(est - clockOffset) > 500) clockOffset = est;
    else clockOffset += (est - clockOffset) * 0.05;
    snaps.push(m);
    if (snaps.length > 60) snaps.shift();
  }
}

const me = () => players.get(meId);

function updateScreens() {
  const st = room.state;
  $('menu').classList.add('hidden');
  $('lobby').classList.toggle('hidden', st !== 'lobby');
  $('shop').classList.toggle('hidden', st !== 'shop');
  $('hud').classList.toggle('hidden', st === 'lobby' || st === 'shop');
  if (st === 'lobby') renderLobby();
  if (st === 'shop') renderShop();
  renderSpellbar();
}

// ---------- лобі ----------
function renderLobby() {
  $('roomCode').textContent = room.code;
  const isHost = room.hostId === meId;
  const teams = room.settings.mode === 'teams';
  $('playerList').innerHTML = room.players
    .map((p) => `<li><span class="dot" style="background:${p.color}"></span>${esc(p.name)}
      ${teams ? `<span class="tag" style="color:${TEAM_COLORS[p.team]}">Команда ${p.team + 1}</span>` : ''}
      ${p.id === room.hostId ? '<span class="tag">хост</span>' : ''}
      ${p.id === meId ? '<span class="tag">ти</span>' : ''}</li>`)
    .join('');
  $('btnTeam').classList.toggle('hidden', !teams);
  $('hostCtl').classList.toggle('hidden', !isHost);
  $('waitHost').classList.toggle('hidden', isHost);
  fillSelect($('selMode'), MODES, room.settings.mode);
  fillSelect($('selMut'), MUTATORS, room.settings.mutator);
  if (document.activeElement !== $('inRounds')) $('inRounds').value = room.settings.rounds;
  $('btnStart').disabled = room.players.length < 2;
  $('btnStart').textContent = room.players.length < 2 ? 'Потрібно ≥2 гравців (додай бота)' : 'Почати гру';
  renderLoadout($('loadout'));
}

function fillSelect(sel, obj, val) {
  if (!sel.options.length) sel.innerHTML = Object.entries(obj).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
  sel.value = val;
}

function renderLoadout(el) {
  const mine = me();
  if (!mine) return;
  const chosen = mine.spells.slice(1);
  el.innerHTML = '';
  for (const id of SPELL_POOL) {
    const s = SPELLS[id];
    const idx = chosen.indexOf(id);
    const d = document.createElement('div');
    d.className = 'spell' + (idx >= 0 ? ' sel' : '');
    d.innerHTML = `<div class="t">${s.icon} ${s.name}<span class="k">${idx >= 0 ? SLOT_KEYS[idx + 1] : ''}</span></div>
      <div class="d">${s.desc} · КД ${s.cd}с</div>`;
    d.onclick = () => {
      let next = [...chosen];
      if (idx >= 0) return; // вже вибрано — щоб замінити, клікни інший
      next.shift(); // найстаріший слот вилітає
      next.push(id);
      if (next.length === LOADOUT_SIZE) send({ type: 'loadout', spells: next });
    };
    el.appendChild(d);
  }
}

$('selMode').onchange = (e) => send({ type: 'settings', mode: e.target.value });
$('selMut').onchange = (e) => send({ type: 'settings', mutator: e.target.value });
$('inRounds').onchange = (e) => send({ type: 'settings', rounds: +e.target.value });
$('btnAddBot').onclick = () => send({ type: 'addBot' });
$('btnRemBot').onclick = () => send({ type: 'removeBot' });
$('btnStart').onclick = () => send({ type: 'start' });
$('btnTeam').onclick = () => send({ type: 'team' });
$('btnCopy').onclick = () => {
  navigator.clipboard?.writeText(location.href);
  $('btnCopy').textContent = 'Скопійовано!';
  setTimeout(() => ($('btnCopy').textContent = 'Скопіювати посилання'), 1500);
};

// ---------- магазин ----------
function renderShop() {
  const mine = me();
  if (!mine) return;
  $('shopRound').textContent = `${room.round + 1} / ${room.settings.rounds}`;
  $('gold').textContent = mine.gold;
  $('upSpells').innerHTML = '';
  mine.spells.forEach((id, i) => {
    const s = SPELLS[id];
    const lvl = mine.levels[id] || 1;
    const cost = levelCost(lvl);
    $('upSpells').appendChild(upRow(`[${SLOT_KEYS[i]}] ${s.icon} ${s.name}`, lvl, MAX_LEVEL, cost, 'spell:' + id, mine.gold));
  });
  $('upStats').innerHTML = '';
  for (const [k, u] of Object.entries(STAT_UPGRADES)) {
    $('upStats').appendChild(upRow(`${u.icon} ${u.name} <small class="sub">${u.desc}</small>`, mine.stats[k], u.max, u.cost, k, mine.gold));
  }
  renderLoadout($('shopLoadout'));
  $('btnReady').textContent = mine.ready ? 'Чекаємо інших…' : 'Готовий';
}

function upRow(label, lvl, max, cost, item, gold) {
  const d = document.createElement('div');
  d.className = 'up';
  d.innerHTML = `<span class="n">${label}</span><span class="pips">${'●'.repeat(lvl)}${'○'.repeat(max - lvl)}</span>`;
  const b = document.createElement('button');
  b.className = 'small';
  b.textContent = lvl >= max ? 'MAX' : `💰${cost}`;
  b.disabled = lvl >= max || gold < cost;
  b.onclick = () => send({ type: 'buy', item });
  d.appendChild(b);
  return d;
}
$('btnReady').onclick = () => send({ type: 'ready', ready: !me()?.ready });

// ---------- HUD ----------
function renderSpellbar() {
  const mine = me();
  if (!mine) return;
  $('spellbar').innerHTML = mine.spells
    .map((id, i) => `<div class="slot" title="${SPELLS[id].name}"><span class="key">${SLOT_KEYS[i]}</span>${SPELLS[id].icon}
      <span class="lv">${'★'.repeat(mine.levels[id] || 1)}</span><div class="cd" id="cd${i}"></div><span class="cdt" id="cdt${i}"></span></div>`)
    .join('');
}

let lastScores = '';
function updateHud(snap) {
  const mine = me();
  if (!room || !mine) return;
  $('roundInfo').textContent = `Раунд ${room.round}/${room.settings.rounds}`;
  const phases = { countdown: 'Приготуйся!', playing: 'Бій', roundEnd: 'Кінець раунду', gameOver: 'Кінець гри' };
  $('phase').textContent = phases[snap.st] || '';
  const mySnap = snap.p.find((p) => p.id === meId);
  if (mySnap) {
    mySnap.cd.forEach((cd, i) => {
      const el = $('cd' + i);
      if (!el) return;
      const def = SPELLS[mine.spells[i]];
      el.style.height = `${Math.min(100, (cd / def.cd) * 100)}%`;
      $('cdt' + i).textContent = cd > 0 ? Math.ceil(cd) : '';
    });
  }
  let center = '';
  if (snap.st === 'countdown') center = Math.ceil(snap.tm) || 'БІЙ!';
  else if (snap.st === 'roundEnd') center = `🏆 ${esc(room.winner || '')}`;
  else if (snap.st === 'gameOver') {
    const best = [...room.players].sort((a, b) => b.score - a.score)[0];
    center = `Переможець гри: ${esc(best?.name || '')}`;
  } else if (mySnap && mySnap.d && snap.st === 'playing') center = '<span style="font-size:24px">Ти вибув — спостерігай</span>';
  if ($('center').innerHTML !== String(center)) $('center').innerHTML = center;

  const deadSet = new Set(snap.p.filter((p) => p.d).map((p) => p.id));
  const html = [...room.players]
    .sort((a, b) => b.score - a.score)
    .map((p) => `<div class="${deadSet.has(p.id) ? 'dead' : ''}"><span class="dot" style="background:${p.color};${room.settings.mode === 'teams' ? `box-shadow:0 0 0 2px ${TEAM_COLORS[p.team]}` : ''}"></span>${esc(p.name)}<span class="s">${p.score}</span></div>`)
    .join('');
  if (html !== lastScores) $('scores').innerHTML = lastScores = html;
}

function feed(text) {
  const d = document.createElement('div');
  d.textContent = text;
  $('feed').appendChild(d);
  setTimeout(() => d.remove(), 5000);
}

// ---------- введення ----------
const canvas = $('game');
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  mouse.down = true;
  sendMove(true);
});
addEventListener('mouseup', () => (mouse.down = false));
addEventListener('mousemove', (e) => {
  [mouse.x, mouse.y] = renderer.toWorld(e.clientX, e.clientY);
  if (mouse.down) sendMove(false);
});
function sendMove(force) {
  const now = performance.now();
  if (!force && now - lastMoveSent < 66) return;
  lastMoveSent = now;
  send({ type: 'move', x: mouse.x, y: mouse.y });
  clickMark = { x: mouse.x, y: mouse.y, t: 1 };
}
const KEY_SLOTS = { KeyQ: 0, KeyW: 1, KeyE: 2, KeyR: 3, KeyF: 4, Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4 };
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  // e.code — фізична клавіша, працює і на кириличній розкладці
  if (e.code in KEY_SLOTS) send({ type: 'cast', slot: KEY_SLOTS[e.code], x: mouse.x, y: mouse.y });
  if (e.code === 'KeyS') send({ type: 'stop' });
});

// ---------- інтерполяція та цикл рендеру ----------
const lerp = (a, b, k) => a + (b - a) * k;
let lastEvT = -1;
function interpolated() {
  if (!snaps.length) return null;
  const rt = performance.now() + clockOffset - INTERP_DELAY;
  // події з усіх знімків, час яких настав
  for (const s of snaps) {
    if (s.t > lastEvT && s.t <= rt) {
      for (const ev of s.ev) {
        renderer.event(ev);
        if (ev.t === 'feed') feed(ev.text);
      }
      lastEvT = s.t;
    }
  }
  let i = snaps.length - 1;
  while (i > 0 && snaps[i - 1].t > rt) i--;
  const b = snaps[i];
  const a = snaps[i - 1];
  if (!a || rt >= b.t) return b;
  const k = Math.max(0, Math.min(1, (rt - a.t) / (b.t - a.t)));
  const amap = new Map(a.p.map((p) => [p.id, p]));
  const prmap = new Map(a.pr.map((p) => [p.id, p]));
  return {
    ...b,
    ar: lerp(a.ar, b.ar, k),
    p: b.p.map((p) => {
      const o = amap.get(p.id);
      // великий стрибок (телепорт/обмін) — без інтерполяції
      if (!o || Math.hypot(o.x - p.x, o.y - p.y) > 60) return p;
      return { ...p, x: lerp(o.x, p.x, k), y: lerp(o.y, p.y, k) };
    }),
    pr: b.pr.map((p) => {
      const o = prmap.get(p.id);
      return o ? { ...p, x: lerp(o.x, p.x, k), y: lerp(o.y, p.y, k) } : p;
    }),
  };
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const st = room && room.state !== 'lobby' ? interpolated() : null;
  if (clickMark) clickMark.t -= dt * 2;
  renderer.draw(st, players, meId, dt, now / 1000, clickMark);
  if (st) updateHud(st);
  if (room?.state === 'shop') {
    const s = snaps[snaps.length - 1];
    if (s) $('shopTimer').textContent = Math.ceil(s.tm);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// для автотестів
window.__wa = { get room() { return room; }, get meId() { return meId; }, send };
