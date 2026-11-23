// HTTP (статика) + WebSocket сервер на одному порту.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './game.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 3000;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  let url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url === '/') url = '/client/index.html';
  if (url === '/health') return res.end('ok');
  // дозволяємо лише client/ і shared/
  if (!url.startsWith('/client/') && !url.startsWith('/shared/')) {
    res.writeHead(404);
    return res.end();
  }
  const file = path.join(ROOT, path.normalize(url));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const rooms = new Map();
const makeCode = () => {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
  while (rooms.has(c));
  return c;
};

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

wss.on('connection', (ws) => {
  let room = null;
  let playerId = null;
  let msgCount = 0;
  const rate = setInterval(() => (msgCount = 0), 1000);

  const err = (text) => ws.send(JSON.stringify({ type: 'error', text }));

  ws.on('message', (raw) => {
    if (++msgCount > 120) return; // простий захист від флуду
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!room) {
      if (msg.type === 'create' || msg.type === 'join') {
        const code = msg.type === 'create' ? makeCode() : String(msg.code || '').toUpperCase().trim();
        if (msg.type === 'create') rooms.set(code, new Room(code, (c) => rooms.delete(c)));
        const r = rooms.get(code);
        if (!r) return err('Кімнату не знайдено');
        const p = r.addHuman(ws, msg.name, msg.color);
        if (!p) return err('Кімната заповнена');
        room = r;
        playerId = p.id;
        ws.send(JSON.stringify({ type: 'welcome', id: p.id, code }));
        r.broadcastRoom();
      }
      return;
    }
    room.handle(playerId, msg);
  });

  ws.on('close', () => {
    clearInterval(rate);
    if (room) room.removePlayer(playerId);
  });
});

server.listen(PORT, () => console.log(`Warlock Arena: http://localhost:${PORT}`));
