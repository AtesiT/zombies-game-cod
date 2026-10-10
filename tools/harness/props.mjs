// Headless harness for the furniture: the mystery box, the machines.
//
// None of it is a tile, and tiles were the only thing collision knew about, so
// you could walk straight through a crate standing in the middle of a room.
// The box also kept the ground floor's list of spots forever, which parked it
// inside a wall the moment you climbed the stairs.
import { nc, load } from './stub.mjs';

const M = await load();
const H = 1 / 60;
const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };

const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
g.begin();
g.startRound(1);
g.update(H);

const T = 24;  // src/art.js: one tile is 24 world pixels
const r = g.player.r ?? 8;

// ---- the box has a body ----------------------------------------------------
const bs = g.box.spot;
ok(!!bs, 'there is no mystery box anywhere');
ok((g.map.solidProps ?? []).length > 0, 'nothing was registered as solid furniture');
const prop = (g.map.solidProps ?? []).find((p) => bs.x > p.x0 && bs.x < p.x1 && bs.y > p.y0 && bs.y < p.y1);
ok(!!prop, 'the mystery box is not solid');

// stand in the middle of it and take a step: you must end up outside
g.player.pos.x = bs.x;
g.player.pos.y = bs.y;
g.map.moveCircle(g.player.pos, 0, 0, r, g.map.floor);
const out = Math.hypot(g.player.pos.x - bs.x, g.player.pos.y - bs.y);
ok(out > r * 0.9, `the player is still inside the box (${out.toFixed(1)}px from its middle)`);

// walk into it from the left: you must stop at its side
g.player.floor = g.map.floor;
g.player.pos.x = bs.x - 40;
g.player.pos.y = bs.y;
g.map.moveCircle(g.player.pos, 26, 0, r, g.map.floor);
ok(g.player.pos.x <= bs.x - 13 + 0.5,
  `the player walked through the box and came out at ${g.player.pos.x.toFixed(1)}`);

// and from below
g.player.pos.x = bs.x;
g.player.pos.y = bs.y + 40;
g.map.moveCircle(g.player.pos, 0, -26, r, g.map.floor);
ok(g.player.pos.y >= bs.y + 8 - 0.5, 'the player walked through the box from below');

// ---- the machines are solid too --------------------------------------------
for (const ps of g.map.perkSpots ?? []) {
  const p = (g.map.solidProps ?? []).find((o) => ps.x > o.x0 && ps.x < o.x1 && ps.y > o.y0 && ps.y < o.y1);
  ok(!!p, `the ${ps.id} machine can be walked through`);
}

// ---- and the box follows the storey you are on ------------------------------
const groundSpot = { ...g.box.spot };
g.map.setFloor(1);
g.useFloor(1);
g.update(H);
const upSpot = g.box.spot;
ok(!!upSpot, 'the box has no spot on the second floor');
ok(g.box.spots.every((s, i) => s.x === g.map.boxSpots[i].x && s.y === g.map.boxSpots[i].y),
  'the box is still using the ground floor\'s spots');
const utx = Math.floor(upSpot.x / T), uty = Math.floor(upSpot.y / T);
ok(!g.map.solidAt(utx, uty), 'the box is standing inside a wall upstairs');
// its solid body moved with it
const upProp = (g.map.solidProps ?? []).some((p) => upSpot.x > p.x0 && upSpot.x < p.x1
  && upSpot.y > p.y0 && upSpot.y < p.y1);
ok(upProp, 'the box is not solid on the second floor');

g.map.setFloor(0);
g.useFloor(0);
g.update(H);
ok(Math.abs(g.box.spot.x - groundSpot.x) < 0.01 && Math.abs(g.box.spot.y - groundSpot.y) < 0.01,
  'the box did not come back to its old spot downstairs');

// ---- zombies cannot walk through it either ----------------------------------
const z = new M.Zombie(g.map, bs.x, bs.y);
z.floor = g.map.floor;
g.map.moveCircle(z.pos, 0, 0, z.r ?? 7, g.map.floor);
const zOut = Math.hypot(z.pos.x - bs.x, z.pos.y - bs.y);
ok(zOut > 4, `a walker is standing inside the box (${zOut.toFixed(1)}px from its middle)`);

// ---- and none of it jams the map -------------------------------------------
// A crate is not a tile, so the flow field does not know it is there. If one
// of these stands in a doorway the horde piles up against it and the round
// stops moving. Put a walker on each side of every prop and make sure it can
// still get to the player on the other side.
{
  const g3 = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g3.begin();
  g3.startRound(2);
  for (let i = 0; i < 30; i++) g3.update(H);
  g3.zombies.length = 0;
  g3.zombiesTotal = 999;
  g3.zombiesSpawned = 999;
  g3.spawnTimer = 999;

  const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const props = (g3.map.solidProps ?? []).slice();
  ok(props.length > 0, 'nothing solid to test');
  for (const p of props) {
    const px = (p.x0 + p.x1) / 2, py = (p.y0 + p.y1) / 2;
    for (const [dx, dy] of sides) {
      const at = { x: px + dx * 60, y: py + dy * 60 };
      const from = { x: px - dx * 40, y: py - dy * 40 };
      if (g3.map.solidAt(Math.floor(from.x / T), Math.floor(from.y / T))) continue;
      if (g3.map.solidAt(Math.floor(at.x / T), Math.floor(at.y / T))) continue;
      g3.zombies.length = 0;
      g3.player.pos.x = at.x;
      g3.player.pos.y = at.y;
      g3.player.floor = g3.map.floor;
      g3.rebuildFlow();
      // a pair of spots with no route between them says nothing about props
      if (!g3.map.reachable(from.x, from.y)) continue;
      const z = new M.Zombie(g3.map, from.x, from.y);
      z.floor = g3.map.floor;
      g3.zombies.push(z);
      let closest = Infinity;
      // some routes go the long way round the building: give it 45 seconds
      for (let i = 0; i < 60 * 45; i++) {
        g3.update(H);
        // a jammed walker despawns and comes back elsewhere, so watch the
        // whole horde rather than the one we put down
        for (const o of g3.zombies) {
          if (o.dead) continue;
          const d = Math.hypot(o.pos.x - g3.player.pos.x, o.pos.y - g3.player.pos.y);
          if (d < closest) closest = d;
        }
        if (closest < 34) break;
      }
      ok(closest < 34,
        `a walker stuck on the far side of the prop at ${px.toFixed(0)},${py.toFixed(0)} ` +
        `never got round it (closest ${closest.toFixed(0)}px)`);
    }
  }
}

if (fails.length) {
  console.log('PROPS FAIL:');
  for (const f of fails) console.log('  -', f);
  process.exitCode = 1;
} else {
  console.log('PROPS PASS  the box and the machines have bodies, and the box moves with the storey');
}
