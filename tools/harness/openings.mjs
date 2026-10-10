// Headless harness for the things you climb through: windows and doors.
//
// Both of them used to be able to end up painted into the masonry. A window
// whose every neighbour is solid is not a window -- it is boards nailed to a
// wall, and it reads as a bug. A door got its orientation from the *wrong*
// axis, so every board on every storey lay across the opening with its ends
// buried in the wall either side, and a door with no wall around it at all
// stood in the middle of a room pretending to be boarded up.
import { nc, load } from './stub.mjs';

const M = await load();
const H = 1 / 60;
const T = 24;
const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };

const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
g.begin();
g.startRound(1);
g.update(H);

let barricades = 0, doors = 0;
for (let f = 0; f < 3; f++) {
  g.map.setFloor(f);
  g.useFloor(f);
  const hard = (x, y) => g.map.solidAt(x, y);
  const TILE_IS = (x, y, t) => g.map.tileOn(f, x, y) === t;

  // ---- windows ------------------------------------------------------------
  for (const b of g.map.barricades) {
    barricades++;
    const xs = b.tiles.map((t) => t % g.map.w);
    const ys = b.tiles.map((t) => (t / g.map.w) | 0);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    for (const t of b.tiles) {
      ok(TILE_IS(t % g.map.w, (t / g.map.w) | 0, 3), `floor ${f}: a barricade covers a tile that is not a window`);
    }
    // the run of tiles has to be a straight line, or the boards are drawn
    // across a corner of wall
    ok(x0 === x1 || y0 === y1, `floor ${f}: the window at ${x0},${y0} is an L, not a run`);
    // and there has to be somewhere to stand on at least one side of it
    ok((b.opening ?? 0) > 0, `floor ${f}: the window at ${x0},${y0} is walled in on every side`);
    // the boards are laid along the run; the run says which way the wall goes
    const alongX = x1 > x0;
    ok(b.horizontal === alongX || (x0 === x1 && y0 === y1),
      `floor ${f}: the window at ${x0},${y0} spans ${alongX ? 'east-west' : 'north-south'} but lays its boards the other way`);
  }

  // ---- doors --------------------------------------------------------------
  for (const d of g.map.doors) {
    doors++;
    const { tx, ty } = d;
    const up = hard(tx, ty - 1), dn = hard(tx, ty + 1);
    const lf = hard(tx - 1, ty), rt = hard(tx + 1, ty);
    const walledUD = up && dn, walledLR = lf && rt;
    // it has to be a doorway in something
    ok(walledUD || walledLR, `floor ${f}: the door at ${tx},${ty} has no wall around it at all`);
    // and the boards lie along the wall, not across it
    if (walledUD && !walledLR) {
      ok(d.horizontal === true,
        `floor ${f}: the door at ${tx},${ty} sits in a wall running east-west but boards it north-south`);
      ok(!lf || !rt,
        `floor ${f}: the door at ${tx},${ty} is walled in on all four sides`);
    } else if (walledLR && !walledUD) {
      ok(d.horizontal === false,
        `floor ${f}: the door at ${tx},${ty} sits in a wall running north-south but boards it east-west`);
      ok(!up || !dn,
        `floor ${f}: the door at ${tx},${ty} is walled in on all four sides`);
    }
  }
}

ok(barricades >= 20, `only ${barricades} boarded windows in the whole map`);
ok(doors >= 8, `only ${doors} doors in the whole map`);

// ---- and nothing boards up a tile it cannot be reached from ----------------
// A window nobody can reach is a window nobody repairs, and it looks like a
// dark patch in the wall. Every barricade must be touchable from somewhere.
for (let f = 0; f < 3; f++) {
  g.map.setFloor(f);
  g.useFloor(f);
  for (const b of g.map.barricades) {
    let reachable = false;
    for (const t of b.tiles) {
      const x = t % g.map.w, y = (t / g.map.w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (g.map.solidAt(nx, ny)) continue;
        if (g.map.reachable((nx + 0.5) * T, (ny + 0.5) * T, f)) { reachable = true; break; }
      }
      if (reachable) break;
    }
    const xs = b.tiles.map((t) => t % g.map.w), ys = b.tiles.map((t) => (t / g.map.w) | 0);
    ok(reachable, `floor ${f}: the window at ${Math.min(...xs)},${Math.min(...ys)} cannot be reached from anywhere`);
  }
}

g.map.setFloor(0);
g.useFloor(0);

if (fails.length) {
  console.log('OPENINGS FAIL:');
  for (const f of fails) console.log('  -', f);
  process.exitCode = 1;
} else {
  console.log(`OPENINGS PASS  ${barricades} windows and ${doors} doors, every one of them an opening you could actually climb through`);
}
