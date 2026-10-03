// Cached text still allocates a sprite the first time a string is seen. Does
// that settle, or does the HUD keep minting new strings forever?
import { nc, load } from './stub.mjs';
const M = await load();
const H = 1 / 120;
let made = 0;
const doc = globalThis.document, raw = doc.createElement;
const who = new Map();
doc.createElement = (t) => {
  if (t !== 'canvas') return raw(t);
  made++;
  const line = (new Error().stack || '').split('\n').find((l) => l.includes('/src/')) || '?';
  const k = line.trim().replace(/^at /, '').replace(/\s*\(.*\)$/, '').replace(/^.*\//, '');
  who.set(k, (who.get(k) || 0) + 1);
  return raw(t);
};
const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
const cx = nc(M.VW, M.VH).getContext('2d');
g.begin(); g.power = true; g.powerOn = true; g.started = true;
g.startRound(9);
g.player.hurt = () => false;
console.log('window        new sprites   (per drawn frame)');
globalThis.__TEXT_KEYS = [];
process.on('exit', () => {
  const tally = new Map();
  for (const k of globalThis.__TEXT_KEYS) {
    const parts = k.split('|'); const str = parts.slice(3).join('|');
    tally.set(str, (tally.get(str) || 0) + 1);
  }
  console.log('\ndistinct strings baked:', tally.size);
  for (const [k, v] of [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`  ${String(v).padStart(6)}x  ${JSON.stringify(k)}`);
  console.log('\nwho is minting them:'); for (const [k, v] of [...who.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${String(v).padStart(6)}  ${k}`); });
let drawn = 0;
for (let f = 0; f < 120 * 60; f++) {
  g.player.hp = 100; if (f % 40 === 0) g.points += 25;   // kills, not a firehose
  let near = null, d2 = 1e9;
  for (const z of g.zombies) { if ((z.floor ?? 0) !== g.map.floor) continue; const d = Math.hypot(z.pos.x - g.player.pos.x, z.pos.y - g.player.pos.y); if (d < d2) { d2 = d; near = z; } }
  if (near) { g.input.mouse.x = near.pos.x; g.input.mouse.y = near.pos.y; }
  g.input.mouse.down = true; g.input.mouse.pressed = f % 8 === 0;
  g.update(H);
  if (f % 2 === 0) { g.draw(cx); drawn++; }
  if (f % (120 * 10) === 0 && f > 0) { console.log(`t=${String((f / 120) | 0).padStart(3)}s  ${String(made).padStart(9)}   ${(made / drawn).toFixed(2)}`); made = 0; drawn = 0; }
}
