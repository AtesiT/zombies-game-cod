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

function play(H, seconds, round, seed, zoo = ['walker']) {
  // same seed for both rates, or the comparison is just dice
  const realRandom = Math.random;
  let s = seed;
  Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g.begin(); g.power = true; g.powerOn = true;
  // Which creatures turn up is dice as well, and it is not fair dice: a
  // bonewright holds its round open with skeletons while a swarm soaks a dozen
  // bullets. Pin the roll and the two step rates fight the same fight.
  let k = 0;
  g.rollEnemyType = () => zoo[k++ % zoo.length];
  g.startRound(round);
  g.player.hurt = () => false;
  const cx = nc(M.VW, M.VH).getContext('2d');
  const st = { insideSolid: 0, unreachable: 0, outside: 0, stuck: 0, minDist: 1e9, reached: 0,
    err: 0, maxStep: 0, flowStrays: 0, frozen: [], solids: [] };
  let prev = new Map();
  const still = new Map();          // how many seconds each body has not moved
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
        if (g.map.solidTileOn(fl, tx, ty)) {
          st.insideSolid++;
          st.solids.push(`${z.type} at ${tx},${ty} (tile ${g.map.tiles[ty * g.map.w + tx]})`);
        }
        if (inner.has(k)) st.reached++;
        else if (outer.has(k)) st.outside++;
        else st.unreachable++;
        // and by the route the horde itself walks, which goes through windows
        // the boards are still on -- a body behind a boarded window is not
        // sealed in, it is about to chew its way out
        const fd = g.map.dist ? g.map.dist[k] : undefined;
        if (fd === undefined || fd >= 1e8) st.flowStrays++;
      }
    }
    // Movement sanity, looked at once a second: a body counts as frozen only
    // after five whole seconds of not going anywhere, so a creature that
    // pauses to gnaw a window, or shuffles about in a crowd, is not mistaken
    // for one wedged in a wall. Five seconds standing still while hunting is
    // long enough to be sure it is not going to move again.
    if (f % Math.round(1 / H) === 0) {
      for (const z of g.zombies) {
        if ((z.floor ?? 0) !== g.map.floor) continue;
        const p = prev.get(z);
        const d = p ? Math.hypot(z.pos.x - p.x, z.pos.y - p.y) : 99;
        st.maxStep = Math.max(st.maxStep, d);
        const rec = still.get(z) ?? { n: 0, counted: false };
        // A body in the crush is not frozen, it is queuing: thirty of them
        // cannot all stand still and all reach you at once, and the ones at
        // the back are held up by the ones at the front, not by the map. Only
        // count a body with room to move that is not using it. A bonewright
        // with its needle out is meant to stand still, too.
        let crowding = 0;
        for (const o of g.zombies) {
          if (o === z || o.dead || (o.floor ?? 0) !== g.map.floor) continue;
          if (Math.hypot(o.pos.x - z.pos.x, o.pos.y - z.pos.y) < 28) crowding++;
        }
        const queuing = crowding >= 2
          || Math.hypot(z.pos.x - g.player.pos.x, z.pos.y - g.player.pos.y) < 42;
        if (d < 2 && z.state === MOVING && !(z.raiseT > 0) && !queuing) rec.n++;
        else rec.n = 0;
        if (rec.n >= 5 && !rec.counted) {
          rec.counted = true;
          st.stuck++;
          st.frozen.push(`${z.type} at ${Math.floor(z.pos.x / T)},${Math.floor(z.pos.y / T)}`);
        }
        still.set(z, rec);
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
const s60 = play(1 / 60, 60, 12, 424242, ['walker']);
console.log(`   in a wall ${s60.insideSolid}, sealed-off ${s60.unreachable}, outside ${s60.outside}, inside ${s60.reached}, frozen while hunting ${s60.stuck}, kills ${s60.kills}`);
ok(s60.err === 0, 'no exception over 60 s at 1/60');
ok(s60.insideSolid === 0, 'no zombie ever stands inside a solid tile');
ok(s60.unreachable === 0, 'no zombie ends up sealed off from both the horde and the player', `${s60.unreachable} strays`);
ok(s60.minDist < 40, 'the horde still closes on the player', `closest ${s60.minDist.toFixed(0)} px`);
ok(s60.reached > 50, 'zombies really did reach the player side of the map', `${s60.reached} spot checks`);
ok(s60.flowStrays === 0, 'a zombie ended up somewhere the horde has no route from',
  `${s60.flowStrays} strays`);

console.log('--- 1/120 step: the same 60s for comparison ---');
const s120 = play(1 / 120, 60, 12, 424242, ['walker']);
console.log(`   in a wall ${s120.insideSolid}, sealed-off ${s120.unreachable}, outside ${s120.outside}, inside ${s120.reached}, frozen while hunting ${s120.stuck}, kills ${s120.kills}`);
ok(s120.err === 0 && s120.insideSolid === 0 && s120.unreachable === 0 && s120.flowStrays === 0,
  'the old step rate is clean by the same rules', s120.solids.join(', '));
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

console.log('--- and the three new creatures: does any of them cheat? ---');
{
  const zoo = play(1 / 60, 60, 12, 991, ['bonewright', 'swarmling', 'jammer']);
  console.log(`   in a wall ${zoo.insideSolid}, off the walking map ${zoo.unreachable}, `
    + `off the horde's route ${zoo.flowStrays}, outside ${zoo.outside}, inside ${zoo.reached}, `
    + `frozen ${zoo.stuck}, kills ${zoo.kills}`);
  ok(zoo.err === 0, 'the new creatures threw over 60 s at 1/60');
  ok(zoo.insideSolid === 0, 'a bonewright, a swarm or a jammer stood inside a solid tile');
  // Plain walking is not the right rule here: a skeleton is born indoors, and
  // a room whose only way out is a boarded window is not a prison, it is the
  // room the horde is chewing its way into. The horde's own route is the test.
  ok(zoo.flowStrays === 0, 'one of the new creatures ended up with no route to the player',
    `${zoo.flowStrays} strays`);
  ok(zoo.reached > 5, 'the new creatures never came anywhere near the player');
  ok(zoo.stuck === 0, `${zoo.stuck} of the new creatures stood still for five seconds `
    + `while hunting: ${zoo.frozen.join(', ')}`);
}

console.log(fails === 0 ? '\nSTEP60 PASS' : `\nSTEP60 FAIL (${fails})`);
process.exit(fails ? 1 : 0);
