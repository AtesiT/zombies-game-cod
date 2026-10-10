// Headless harness for the first three creatures off the shortlist:
//   Bonewright -- stands off and sews skeletons out of the dirt
//   Swarmling  -- seven bodies sharing one pool of hit points
//   Jammer     -- carries a wireless set that takes your markers away
import { nc, load, SRC } from './stub.mjs';

const M = await load();
const { ENEMY_TYPES } = await import(SRC + '/entities.js');
const H = 1 / 60;
const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };

let seed = 4242;
Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

function boot(round = 1) {
  const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g.begin();
  g.startRound(round);
  g.powerOn = true;
  for (let i = 0; i < 10; i++) g.update(H);
  return g;
}

const d2 = (a, b) => Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
function spawn(g, type, x, y) {
  const z = g.makeZombie({ x, y, floor: g.map.floor }, type);
  g.zombies.push(z);
  return z;
}
/** Put the creature somewhere sensible near the player, and let it settle. */
function place(g, type, dist = 260) {
  const p = g.player.pos;
  // find an open tile that far away, or as close to it as the map allows
  let best = null, bd = 1e9;
  for (let ty = 1; ty < g.map.h - 1; ty++) {
    for (let tx = 1; tx < g.map.w - 1; tx++) {
      if (g.map.solidAt(tx, ty)) continue;
      const x = (tx + 0.5) * 24, y = (ty + 0.5) * 24;
      const d = Math.abs(Math.hypot(x - p.x, y - p.y) - dist);
      if (d < bd) { bd = d; best = { x, y }; }
    }
  }
  return spawn(g, type, best.x, best.y);
}

// ---------------------------------------------------------------- bonewright --
{
  const g = boot(6);
  const bw = place(g, 'bonewright', 300);
  ok(bw.def.raises && bw.standoff === 260, 'the bonewright is not the stand-off type it should be');

  let peak = 0, sawSewing = false;
  for (let i = 0; i < 60 * 45; i++) {
    g.update(H);
    if (bw.raiseT > 0) sawSewing = true;
    // the round may well spawn a second one, so count each man's own work
    const mine = g.zombies.filter((z) => z.type === 'skeleton' && !z.dead && z.summonedBy === bw.id);
    peak = Math.max(peak, mine.length);
    // it must never come to you
    if (!bw.dead) ok(d2(bw, g.player) > 60, `the bonewright closed to ${d2(bw, g.player).toFixed(0)}px`);
  }
  ok(sawSewing, 'it never started sewing');
  ok(peak <= 4, `it had ${peak} skeletons on their feet at once -- four is the ceiling`);
  ok(peak >= 2, 'nothing ever climbed out of the ground');

  const sk = g.zombies.find((z) => z.type === 'skeleton');
  ok(sk.summoned === true, 'a skeleton is being counted as one of the round');
  ok(sk.maxHp === 40, `a skeleton has ${sk.maxHp} hit points, and it should have 40`);
  ok(sk.def.headless && sk.def.noBlood, 'a skeleton has a head and blood -- it should have neither');
  console.log(`  bonewright: stood off, sewed, and kept ${peak} skeletons at most, 40hp each`);

  // Killing it stops the sewing: no new skeletons once it is down.
  const before = g.zombies.filter((z) => z.type === 'skeleton').length;
  bw.hurt(99999, false, g, 0);
  g.onZombieKilled(bw, false);
  for (let i = 0; i < 60 * 20; i++) g.update(H);
  const after = g.zombies.filter((z) => z.type === 'skeleton' && !z.dead).length;
  ok(after <= before, `it raised ${after - before} more after dying`);
  console.log(`  bonewright: dead, and the skeletons it left (${after}) are still yours to clear`);
}

// ------------------------------------------------- the round waits for them --
{
  const g = boot(2);
  // clear the round's own horde without touching the tally
  for (const z of g.zombies) { z.dead = true; z.remove = true; }
  g.zombies = g.zombies.filter((z) => !z.remove);
  g.zombiesKilled = g.zombiesTotal;
  // the tally is full and the floor is empty, so the only thing keeping the
  // round open is the skeleton that is about to climb out of the dirt
  const sk = place(g, 'skeleton', 120);
  for (let i = 0; i < 60 * 3; i++) g.update(H);
  ok(g.roundActive, 'the round ended with skeletons still walking about');
  ok(g.zombiesKilled === g.zombiesTotal, 'killing a skeleton moved the round along');
  // ...and it closes the moment they are gone
  for (const z of g.zombies) { z.dead = true; z.remove = true; }
  g.zombies = [];
  for (let i = 0; i < 10; i++) g.update(H);
  ok(!g.roundActive, 'the round never ended after the last skeleton died');
  console.log('  the round waits for the skeletons, and ends when they do');
}

// --------------------------------------------------------------- swarmling --
{
  const g = boot(20);
  const sw = place(g, 'swarmling', 200);
  ok(sw.units === 7, `the cloud has ${sw.units} bodies in it`);
  const unitHp = sw.unitHp;
  const pool = sw.maxHp;
  ok(Math.abs(pool - unitHp * 7) < 1, 'the pool is not seven shares');

  // every fifth hit knocks one loose
  const before = g.zombies.filter((z) => z.type === 'swarmlet').length;
  for (let i = 0; i < 5; i++) sw.hurt(3, false, g, 0);
  const after = g.zombies.filter((z) => z.type === 'swarmlet').length;
  ok(after === before + 1, `five hits took ${after - before} pieces off, not one`);
  ok(sw.units === 6, `the cloud is down to ${sw.units} bodies`);
  const bit = g.zombies.find((z) => z.type === 'swarmlet');
  ok(bit && bit.summoned, 'a piece that came off is being counted as one of the round');
  ok(bit && Math.abs(bit.maxHp - unitHp) < 1.5,
    `a piece carries ${bit?.maxHp?.toFixed(1)}hp, its share was ${unitHp.toFixed(1)}`);

  // chip it to death: the pool runs out and everything still in it goes too
  let guard = 0;
  while (!sw.dead && guard++ < 4000) sw.hurt(4, false, g, 0);
  ok(sw.dead, 'the cloud could not be killed at all');
  ok(sw.units >= 1, `the cloud ended up with ${sw.units} bodies, which is nonsense`);
  console.log(`  swarmling: ${7 - sw.units} pieces came off before the pool ran dry`);
}

// ------------------------------------------------------------------ jammer --
{
  const g = boot(26);
  const jm = place(g, 'jammer', 200);
  // it spends just over half a second climbing out of the spawn before it
  // does anything at all, so give it a full second
  for (let i = 0; i < 70; i++) g.update(H);
  ok(g.jammed, 'a jammer standing next to you is not jamming anything');
  ok(g.jamT > 5, `the jam only lasts ${g.jamT.toFixed(1)}s`);

  // the markers it takes: prompts, minimap, and the target highlight
  const count = (hud, name) => {
    let n = 0;
    const orig = hud[name].bind(hud);
    hud[name] = (...a) => { n++; return orig(...a); };
    g.draw(nc(M.VW, M.VH).getContext('2d'));
    hud[name] = orig;
    return n;
  };
  const hud = g.hud;
  const mapOn = count(hud, '_minimap'), promptOn = count(hud, '_prompt');
  const was = g.jamT;
  g.jamT = 0;
  const mapOff = count(hud, '_minimap'), promptOff = count(hud, '_prompt');
  g.jamT = was;
  ok(mapOn === 0 && mapOff === 1, `the minimap is drawn ${mapOn} times jammed and ${mapOff} clear`);
  ok(promptOn === 0 && promptOff === 1, `the prompt is drawn ${promptOn} times jammed and ${promptOff} clear`);

  // and the crosshair stops telling you that you are on target
  const cv = nc(M.VW, M.VH);
  const ctx = cv.getContext('2d');
  const m = g.input.mouse;
  m.x = M.VW / 2; m.y = M.VH / 2;
  const shot = () => {
    g.draw(ctx);
    const d = ctx.getImageData(m.x - 12, m.y - 12, 24, 24).data;
    let r = 0, gg = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
    return [r, gg, b];
  };
  g.aimOnTarget = true;      // something under the sights, as if you were aiming at one
  const warm = shot();
  g.jamT = 0;
  const cold = shot();
  g.jamT = was;
  const diff = Math.abs(warm[0] - cold[0]) + Math.abs(warm[1] - cold[1]) + Math.abs(warm[2] - cold[2]);
  ok(diff > 60, `the crosshair looks the same jammed or not (delta ${diff.toFixed(0)})`);
  console.log(`  jammer: markers gone, crosshair changed by ${diff.toFixed(0)}`);

  // it only jams from the same storey, and killing it brings the picture back
  g.jamT = 0;
  jm.floor = (g.map.floor + 1) % 3;
  for (let i = 0; i < 10; i++) g.update(H);
  ok(!g.jammed, 'it jams you through a ceiling');
  jm.floor = g.map.floor;
  for (let i = 0; i < 10; i++) g.update(H);
  ok(g.jammed, 'it stopped jamming once it was back on your floor');
  jm.hurt(99999, false, g, 0);
  g.onZombieKilled(jm, false);
  for (let i = 0; i < 40; i++) g.update(H);
  ok(!g.jammed, `the picture stayed broken for ${g.jamT.toFixed(1)}s after the radio died`);
  console.log('  jammer: only from your own storey, and the picture returns when it dies');
}

// --------------------------------------------------------- they arrive late --
{
  const g = boot(30);
  g.dogRound = false;              // a dog round rolls nothing but dogs
  const seen = new Set();
  for (let i = 0; i < 60000; i++) seen.add(g.rollEnemyType());
  for (const t of ['bonewright', 'swarmling', 'jammer']) {
    ok(seen.has(t), `${t} never turns up in round 30`);
  }
  const g2 = boot(3);
  g2.dogRound = false;
  const early = new Set();
  for (let i = 0; i < 20000; i++) early.add(g2.rollEnemyType());
  ok(!early.has('swarmling') && !early.has('jammer'),
    'a swarm or a jammer turned up in round 3, and they belong to the late game');
  console.log('  all three arrive on their own rounds, and not before');
}

// ------------------------------------------------------------- nothing throws --
{
  const g = boot(28);
  for (const t of ['bonewright', 'swarmling', 'jammer', 'skeleton', 'swarmlet']) {
    const z = place(g, t, 150);
    z.floor = g.map.floor;
    for (let i = 0; i < 120; i++) g.update(H);
    g.draw(nc(M.VW, M.VH).getContext('2d'));
  }
  for (const t of Object.keys(ENEMY_TYPES)) {
    const z = spawn(g, t, g.player.pos.x + 60, g.player.pos.y);
    z.floor = g.map.floor;
    for (let i = 0; i < 30; i++) g.update(H);
    g.draw(nc(M.VW, M.VH).getContext('2d'));
  }
  console.log('  every type, new and old, survives two seconds and a frame');
}

if (fails.length) {
  console.log('CREATURES FAIL:');
  for (const f of fails) if (f) console.log('  - ' + f);
  process.exit(1);
}
console.log('CREATURES PASS  bonewright, swarmling and jammer all behave');
