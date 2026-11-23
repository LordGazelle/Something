// Швидка headless-симуляція матчів ботами: перевіряє, що всі режими проходять повний цикл.
import { Room } from '../server/game.js';
for (const mode of ['ffa','teams']) for (const mut of ['none','ice','chaos','rapid']) {
  let msgs = [];
  const ws = { readyState: 1, send: (d) => msgs.push(d) };
  const r = new Room('TEST', () => {});
  clearInterval(r.interval);
  const h = r.addHuman(ws, 'H', null);
  for (let i = 0; i < 5; i++) r.addBot();
  r.handle(h.id, { type: 'settings', mode, mutator: mut, rounds: 3 });
  r.handle(h.id, { type: 'start' });
  r.handle(h.id, { type: 'ready', ready: true });
  const seen = new Set(); let ticks = 0, roundLen = [], rs = 0;
  while (ticks < 30 * 60 * 8) { r.tick(); ticks++; seen.add(r.state);
    if (r.state === 'playing' && rs === 0) rs = ticks; if (r.state === 'roundEnd' && rs) { roundLen.push(((ticks - rs) / 30).toFixed(0)); rs = 0; }
    if (r.state === 'lobby' && seen.has('gameOver')) break; }
  const ps = [...r.players.values()].map(p => `${p.name.slice(0,6)}:${p.score}/${p.kills}k/lv${Object.values(p.levels).join('')}`);
  if (!seen.has('gameOver')) { console.error('FAIL', mode, mut, 'не дійшов до gameOver'); process.exitCode = 1; }
  console.log(mode, mut, 'states', [...seen].join(','), 'roundSec', roundLen.join(','), '|', ps.join(' '));
}
