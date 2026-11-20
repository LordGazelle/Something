// Онлайн через WebRTC (PeerJS). Хост — один із гравців, решта під’єднуються за кодом кімнати.
/* global Peer */
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PREFIX = 'brukht-arena-';

export function makeCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPH[Math.random() * ALPH.length | 0];
  return s;
}

function peerOpts() {
  // для локальних тестів: ?peerhost=localhost&peerport=9000
  const q = new URLSearchParams(location.search);
  const o = { debug: 1 };
  if (q.get('peerhost')) {
    o.host = q.get('peerhost'); o.port = +q.get('peerport') || 9000; o.path = q.get('peerpath') || '/';
    o.secure = q.get('peersecure') === '1';
  }
  return o;
}

export class Net {
  constructor() {
    this.peer = null; this.isHost = false; this.conns = new Map(); this.hostConn = null;
    this.onMessage = () => {}; this.onJoin = () => {}; this.onLeave = () => {}; this.onClosed = () => {};
    this.online = false;
  }

  host(code) {
    return new Promise((resolve, reject) => {
      if (typeof Peer === 'undefined') return reject(new Error('PeerJS не завантажився'));
      this.isHost = true;
      const p = new Peer(PREFIX + code, peerOpts());
      this.peer = p;
      let opened = false;
      p.on('open', () => { opened = true; this.online = true; resolve(code); });
      p.on('connection', (c) => {
        c.on('open', () => { this.conns.set(c.peer, c); this.onJoin(c.peer); });
        c.on('data', (d) => this.onMessage(c.peer, d));
        c.on('close', () => { if (this.conns.delete(c.peer)) this.onLeave(c.peer); });
        c.on('error', () => { if (this.conns.delete(c.peer)) this.onLeave(c.peer); });
      });
      p.on('disconnected', () => { try { p.reconnect(); } catch (e) {} });
      p.on('error', (e) => {
        if (!opened) { p.destroy(); reject(e); }
        else console.warn('peer error', e.type);
      });
    });
  }

  join(code) {
    return new Promise((resolve, reject) => {
      if (typeof Peer === 'undefined') return reject(new Error('PeerJS не завантажився'));
      this.isHost = false;
      const p = new Peer(peerOpts());
      this.peer = p;
      let done = false;
      const fail = (e) => { if (!done) { done = true; reject(e); } };
      const timer = setTimeout(() => fail(new Error('Кімнату не знайдено або вона не відповідає')), 15000);
      p.on('open', () => {
        const c = p.connect(PREFIX + code.toUpperCase(), { reliable: true });
        this.hostConn = c;
        c.on('open', () => { done = true; clearTimeout(timer); this.online = true; resolve(); });
        c.on('data', (d) => this.onMessage('host', d));
        c.on('close', () => { this.online = false; this.onClosed(); });
        c.on('error', (e) => fail(e));
      });
      p.on('error', (e) => {
        clearTimeout(timer);
        if (e.type === 'peer-unavailable') fail(new Error('Кімнату з таким кодом не знайдено'));
        else if (!done) fail(e);
        else if (e.type === 'network' || e.type === 'disconnected') { /* сигнальний сервер — не страшно */ }
      });
    });
  }

  send(msg) { if (this.hostConn && this.hostConn.open) this.hostConn.send(msg); }
  sendTo(peerId, msg) { const c = this.conns.get(peerId); if (c && c.open) c.send(msg); }
  broadcast(msg, except) {
    for (const [id, c] of this.conns) if (id !== except && c.open) c.send(msg);
  }
  get count() { return this.conns.size; }
  close() {
    this.online = false;
    try { this.peer && this.peer.destroy(); } catch (e) {}
    this.conns.clear(); this.hostConn = null; this.peer = null;
  }
}
