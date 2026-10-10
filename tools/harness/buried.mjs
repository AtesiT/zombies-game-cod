// Headless harness for the thing that used to stall rounds: a miner dug in
// under the soil only ever came back up when you walked within a couple of
// steps of it. Camp at the far end of the map and the round never ends --
// the counter sits at "1 left" forever and the next wave never comes.
//
// The rule now: when the round is down to its last ten per cent, everything
// that is hiding comes out and finishes it.
import { nc, load, SRC } from './stub.mjs';

const M = await load();
const { ZSTATE } = await import(SRC + '/entities.js');
const H = 1 / 60;
const T = 24;
const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };

const d2p = (z, g) => Math.hypot(z.pos.x - g.player.pos.x, z.pos.y - g.player.pos.y);

/** A spot on the player's own storey, inside, walkable, and a long way off. */
function farSpot(g, want = 150) {
  const m = g.map, p = g.player.pos;
  let best = null, bestErr = 1e9;
  for (let ty = 1; ty < m.h - 1; ty++) {
    for (let tx = 1; tx < m.w - 1; tx++) {
      if (m.solidAt(tx, ty)) continue;
      const x = (tx + 0.5) * T, y = (ty + 0.5) * T;
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < want || !m.reachable(x, y)) continue;
      const err = Math.abs(d - want);
      if (err < bestErr) { bestErr = err; best = { x, y }; }
    }
  }
  return best;
}

/** A fresh round with the field swept clean and nothing else due to spawn. */
function stage(total) {
  const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g.begin();
  g.startRound(6);
  for (let i = 0; i < 30; i++) g.update(H);
  g.zombies.length = 0;
  g.zombiesTotal = total;
  g.zombiesSpawned = total;   // nothing else is coming
  g.spawnTimer = 999;
  return g;
}

// ---- a round that is nearly over: it must dig itself out --------------------
{
  const g = stage(10);
  const at = farSpot(g);
  ok(!!at, 'no reachable spot far enough from the player');
  const z = g.makeZombie({ x: at.x, y: at.y, floor: g.map.floor }, 'miner');
  z.floor = g.map.floor;
  g.zombies.push(z);
  g.update(H);
  z.state = ZSTATE.BURIED;
  z.vel.x = 0; z.vel.y = 0;
  const d0 = d2p(z, g);
  ok(d0 > 58, `the miner was placed inside its own trigger radius (${d0.toFixed(0)}px)`);
  ok(g.lastCall === true, 'with one left of ten the game did not call it the last stretch');

  for (let i = 0; i < 90; i++) g.update(H);            // 1.5s
  ok(z.state !== ZSTATE.BURIED, 'the round is nearly over but the miner is still underground');
  let closest = d0;
  for (let i = 0; i < 180; i++) { g.update(H); closest = Math.min(closest, d2p(z, g)); }
  ok(z.state !== ZSTATE.BURIED, 'it climbed out and then went straight back under');
  ok(closest < d0 - 40,
    `the miner surfaced but never came over (${d0.toFixed(0)} -> closest ${closest.toFixed(0)}px)`);
}

// ---- a round in full swing: it stays under and waits for you ---------------
{
  const g = stage(40);
  const at = farSpot(g);
  const z = g.makeZombie({ x: at.x, y: at.y, floor: g.map.floor }, 'miner');
  z.floor = g.map.floor;
  g.zombies.push(z);
  g.update(H);
  z.state = ZSTATE.BURIED;
  z.vel.x = 0; z.vel.y = 0;
  // eleven others wandering about, so this is nowhere near the last ten per cent
  for (let i = 0; i < 10; i++) {
    const o = g.makeZombie({ x: at.x - i * 14, y: at.y + 40, floor: g.map.floor }, 'walker');
    o.floor = g.map.floor;
    g.zombies.push(o);
  }
  for (let i = 0; i < 120; i++) g.update(H);           // 2s
  ok(!g.lastCall, 'the game called it the last ten per cent with eleven left of forty');
  ok(z.state === ZSTATE.BURIED, 'a miner popped out in the middle of a full round');
  // and the old trigger still works: walk up to it and up it comes
  g.player.pos.x = z.pos.x + 30;
  g.player.pos.y = z.pos.y;
  for (let i = 0; i < 30; i++) g.update(H);
  ok(z.state !== ZSTATE.BURIED, 'the miner ignored somebody walking right up to its mound');
}

// ---- the one playing dead among the corpses ---------------------------------
{
  const g = stage(8);
  const at = farSpot(g, 140);
  const z = g.makeZombie({ x: at.x, y: at.y, floor: g.map.floor }, 'mimic');
  z.floor = g.map.floor;
  z.hidden = true;
  z.state = ZSTATE.HIDDEN;
  g.zombies.push(z);
  g.update(H);
  const d0 = d2p(z, g);
  ok(d0 > 72, `the mimic was placed inside its wake-up radius (${d0.toFixed(0)}px)`);
  ok(g.lastCall === true, 'with one left of eight the game did not call it the last stretch');
  let closest = d0;
  for (let i = 0; i < 240; i++) { g.update(H); closest = Math.min(closest, d2p(z, g)); }
  ok(!z.hidden, 'the round is nearly over but the thing playing dead is still lying there');
  ok(closest < d0 - 40,
    `the mimic got up but never came over (${d0.toFixed(0)} -> closest ${closest.toFixed(0)}px)`);
}

// ---- and a stalled round actually finishes ----------------------------------
// While it is under the soil the bullets only stir the dirt, so a round whose
// last zombie is buried can never be finished. It has to come out.
{
  const g = stage(6);
  const at = farSpot(g);
  const z = g.makeZombie({ x: at.x, y: at.y, floor: g.map.floor }, 'miner');
  z.floor = g.map.floor;
  g.zombies.push(z);
  g.update(H);
  z.state = ZSTATE.BURIED;
  z.vel.x = 0; z.vel.y = 0;
  g.zombiesKilled = g.zombiesTotal;   // every one but this one is already down
  let ended = false, surfaced = false;
  for (let i = 0; i < 60 * 60 && !ended; i++) {
    g.zombiesKilled = g.zombiesTotal;
    g.update(H);
    if (z.state !== ZSTATE.BURIED) surfaced = true;
    if (surfaced) z.hurt(9999, false, g, 0);   // it is killable the moment it is out
    if (!g.roundActive || z.dead) ended = true;
  }
  ok(surfaced, 'the last miner never came out of the ground at all');
  ok(ended, 'the round never finished: one miner hid underground for a full minute');
}

if (fails.length) {
  console.log('BURIED FAIL:');
  for (const f of fails) console.log('  -', f);
  process.exitCode = 1;
} else {
  console.log('BURIED PASS  the last ten per cent dig themselves out and come and finish it');
}
