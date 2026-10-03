// Halving the physics step doubles how far everything moves per step, so the
// question is whether anything now slips through a wall. Two invariants:
// nothing ever stands inside a solid tile, and every zombie is standing
// somewhere it could actually have walked to.
import { nc, load } from './stub.mjs';
const M = await load();
const { ZSTATE } = await import('/home/user/zombies-game-cod/src/entities.js');
const MOVING = ZSTATE.HUNT;      // climb / barricade / door / attack / dead all stand still by design
const T = 24;
let fails = 0;
const ok = (c, label, extra = '') => { console.log(`${c ? ' ok ' : 'FAIL'}  ${label}${extra ? '  -- ' + extra : ''}`); if (!c) fails++; };

function bfs(map, sx, sy) {
  const key = (x, y) => y * map.w + x;
  const seen = new Set([key(sx, sy)]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (seen.has(k) || !map.inside(nx, ny)) continue;
      if (map.solidTileOn(map.floor, nx, ny)) continue;
      seen.add(k); q.push([nx, ny]);
    }
  }
  return seen;
}

function play(H, seconds, round, seed) {
  // same seed for both rates, or the comparison is just dice
  const realRandom = Math.random;
  let s = seed;
  Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g.begin(); g.power = true; g.powerOn = true;
  g.startRound(round);
  g.player.hurt = () => false;
  const cx = nc(M.VW, M.VH).getContext('2d');
  const st = { insideSolid: 0, unreachable: 0, outside: 0, stuck: 0, minDist: 1e9, reached: 0, err: 0, maxStep: 0 };
  let prev = new Map();
  for (let f = 0; f < Math.round(seconds / H); f++) {
    g.player.hp = 100;
    let near = null, d2 = 1e9;
    for (const z of g.zombies) {
      if ((z.floor ?? 0) !== g.map.floor) continue;
      const d = Math.hypot(z.pos.x - g.player.pos.x, z.pos.y - g.player.pos.y);
      if (d < d2) { d2 = d; near = z; }
    }
    if (near) { g.input.mouse.x = near.pos.x; g.input.mouse.y = near.pos.y; st.minDist = Math.min(st.minDist, d2); }
    g.input.mouse.down = true; g.input.mouse.pressed = f % 8 === 0;
    try { g.update(H); } catch (e) { st.err++; if (st.err < 2) console.log('   threw:', e.message); }
    if (f % 6 === 0) g.draw(cx);

    if (f % Math.round(1 / H) === 0) {
      // A zombie is allowed to be somewhere the player can walk to, or still
      // outside in spawning country. What must never happen is it ending up in
      // a tile sealed off from both -- that would mean it went through a wall.
      const inner = bfs(g.map, Math.floor(g.player.pos.x / T), Math.floor(g.player.pos.y / T));
      const outer = new Set();
      for (const s of g.map.spawnPoints) for (const k of bfs(g.map, s.tx, s.ty)) outer.add(k);
      for (const z of g.zombies) {
        const fl = z.floor ?? 0;
        if (fl !== g.map.floor) continue;
        const tx = Math.floor(z.pos.x / T), ty = Math.floor(z.pos.y / T);
        const k = ty * g.map.w + tx;
        if (g.map.solidTileOn(fl, tx, ty)) st.insideSolid++;
        if (inner.has(k)) st.reached++;
        else if (outer.has(k)) st.outside++;
        else st.unreachable++;
      }
    }
    if (f % Math.round(4 / H) === 0) {                 // movement sanity: is anything frozen?
      for (const z of g.zombies) {
        if ((z.floor ?? 0) !== g.map.floor) continue;
        const p = prev.get(z);
        const d = p ? Math.hypot(z.pos.x - p.x, z.pos.y - p.y) : 99;
        st.maxStep = Math.max(st.maxStep, d);
        if (d < 1 && z.state === MOVING) st.stuck++;
      }
      prev = new Map(g.zombies.map((z) => [z, { x: z.pos.x, y: z.pos.y }]));
    }
  }
  st.kills = g.stats?.kills ?? 0;
  st.hits = g.stats?.hits ?? 0;
  st.round = g.round;
  Math.random = realRandom;
  return st;
}

console.log('--- 1/60 step: 60s at round 12 ---');
const s60 = play(1 / 60, 60, 12, 424242);
console.log(`   in a wall ${s60.insideSolid}, sealed-off ${s60.unreachable}, outside ${s60.outside}, inside ${s60.reached}, frozen while hunting ${s60.stuck}, kills ${s60.kills}`);
ok(s60.err === 0, 'no exception over 60 s at 1/60');
ok(s60.insideSolid === 0, 'no zombie ever stands inside a solid tile');
ok(s60.unreachable === 0, 'no zombie ends up sealed off from both the horde and the player', `${s60.unreachable} strays`);
ok(s60.minDist < 40, 'the horde still closes on the player', `closest ${s60.minDist.toFixed(0)} px`);
ok(s60.reached > 50, 'zombies really did reach the player side of the map', `${s60.reached} spot checks`);

console.log('--- 1/120 step: the same 60s for comparison ---');
const s120 = play(1 / 120, 60, 12, 424242);
console.log(`   in a wall ${s120.insideSolid}, sealed-off ${s120.unreachable}, outside ${s120.outside}, inside ${s120.reached}, frozen while hunting ${s120.stuck}, kills ${s120.kills}`);
ok(s120.err === 0 && s120.insideSolid === 0 && s120.unreachable === 0, 'the old step rate is clean by the same rules');
ok(s60.stuck <= s120.stuck * 2 + 5, 'hunting zombies freeze no more often than at 120 Hz', `${s60.stuck} vs ${s120.stuck}`);
ok(Math.abs(s60.kills - s120.kills) <= Math.max(4, s120.kills * 0.5),
  'kills at 60 Hz are in the same ballpark as at 120 Hz', `${s60.kills} vs ${s120.kills}`);

console.log('--- player-vs-wall at 1/60 ---');
{
  const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g.begin(); g.player.hurt = () => false;
  let bad = 0, moved = 0;
  const start = { x: g.player.pos.x, y: g.player.pos.y };
  for (const [kx, ky] of [['KeyW','KeyD'],['KeyW','KeyA'],['KeyS','KeyD'],['KeyS','KeyA'],['KeyW',null],['KeyS',null],['KeyA',null],['KeyD',null]]) {
    for (let f = 0; f < 240; f++) {
      g.input.keys.clear();
      g.input.keys.add(kx); if (ky) g.input.keys.add(ky);
      g.update(1 / 60);
      const tx = Math.floor(g.player.pos.x / T), ty = Math.floor(g.player.pos.y / T);
      if (g.map.solidTileOn(g.map.floor, tx, ty)) bad++;
    }
  }
  g.input.keys.clear();
  moved = Math.hypot(g.player.pos.x - start.x, g.player.pos.y - start.y);
  ok(bad === 0, 'the player is never pushed inside a wall', `${bad} bad frames`);
  console.log(`   ended ${moved.toFixed(0)} px from the start`);
}

console.log('--- stairs at 1/60 ---');
{
  const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g.begin(); g.player.hurt = () => false;
  const link = g.map.linksOn(0)[0];
  g.player.pos.x = (link.a.tx + 0.5) * T; g.player.pos.y = (link.a.ty + 0.5) * T;
  const before = g.map.floor;
  for (let f = 0; f < 30; f++) g.update(1 / 60);
  ok(g.map.floor !== before, 'stepping onto the staircase still carries you up', `floor ${before} -> ${g.map.floor}`);
  const f1 = g.map.floor;
  for (let f = 0; f < 30; f++) g.update(1 / 60);
  ok(g.map.floor === f1, 'standing on the arrival tile does not bounce you back', `floor ${g.map.floor}`);
}

console.log(fails === 0 ? '\nSTEP60 PASS' : `\nSTEP60 FAIL (${fails})`);
process.exit(fails ? 1 : 0);
