// Headless harness for the guns bolted to the walls.
//
// Two things go wrong here. The weapon hangs off the *wall* tile, so anything
// that reads the geometry has to know which way that wall runs -- and a gun on
// a side wall hung flat across it, sticking out of the plaster like a shelf.
// It has to hang along the wall instead, muzzle down.
import { nc, load } from './stub.mjs';

const M = await load();
const H = 1 / 60;
const T = 24;
const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };

const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
g.begin();
g.startRound(1);
for (let i = 0; i < 30; i++) g.update(H);

// ---- every gun is bolted to a wall you can stand in front of ---------------
const seen = { up: 0, down: 0, left: 0, right: 0 };
let total = 0;
for (let f = 0; f < 3; f++) {
  g.map.setFloor(f);
  g.useFloor(f);
  for (const wb of g.map.wallBuys) {
    total++;
    const stx = Math.floor(wb.x / T), sty = Math.floor(wb.y / T);
    ok(g.map.solidAt(wb.wx, wb.wy),
      `the ${wb.weapon} on storey ${f} is bolted to tile ${wb.wx},${wb.wy}, which is not a wall`);
    ok(!g.map.solidAt(stx, sty),
      `you would have to stand inside a wall to buy the ${wb.weapon} on storey ${f}`);
    ok(g.map.reachable(wb.x, wb.y, f),
      `nothing can walk to the ${wb.weapon} on storey ${f}`);
    // the wall tile must be next to the tile you stand on
    ok(Math.abs(wb.wx - stx) + Math.abs(wb.wy - sty) === 1,
      `the ${wb.weapon}'s wall on storey ${f} is not even touching its own stand tile`);
    // and `facing` has to point from the stand tile at that wall
    const want = Math.abs(wb.wx - stx) > Math.abs(wb.wy - sty)
      ? (wb.wx > stx ? 'right' : 'left')
      : (wb.wy > sty ? 'down' : 'up');
    ok(wb.facing === want,
      `the ${wb.weapon} on storey ${f} faces ${wb.facing}, but its wall is ${want} of where you stand`);
    ok(['up', 'down', 'left', 'right'].includes(wb.facing), `the ${wb.weapon} faces "${wb.facing}"`);
    seen[wb.facing] = (seen[wb.facing] ?? 0) + 1;
  }
}
ok(total >= 13, `only ${total} wall guns in the whole map`);
ok(seen.left + seen.right >= 3, `only ${seen.left + seen.right} guns hang on a side wall`);

// ---- a gun on a side wall is drawn rotated, one on a flat wall is not ------
/**
 * Draw a frame with the player parked by `wb`, recording the canvas calls.
 * The world is drawn inside one big camera translate, so everything the
 * furniture draws is in world coordinates -- do not subtract the camera.
 */
function frameAt(wb, floor) {
  const g2 = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g2.begin();
  g2.startRound(1);
  g2.map.setFloor(floor);
  g2.useFloor(floor);
  // stand on the buy tile, exactly where the player would be
  g2.player.pos.x = wb.x;
  g2.player.pos.y = wb.y;
  g2.player.floor = floor;
  // the camera chases with damping, so give it a second or two to arrive
  for (let i = 0; i < 120; i++) g2.update(H);

  const calls = [];
  const ctx = nc(M.VW, M.VH).getContext('2d');
  for (const name of ['translate', 'rotate', 'drawImage']) {
    const orig = ctx[name].bind(ctx);
    ctx[name] = (...a) => { calls.push({ name, a }); return orig(...a); };
  }
  g2.draw(ctx);
  return { calls };
}

/** Was there a translate to (x,y) followed by a rotate and then a blit? */
function rotatedAt(calls, x, y) {
  for (let i = 0; i < calls.length - 2; i++) {
    const t = calls[i];
    if (t.name !== 'translate') continue;
    if (Math.abs(t.a[0] - x) > 1.5 || Math.abs(t.a[1] - y) > 1.5) continue;
    for (let j = i + 1; j < Math.min(i + 4, calls.length - 1); j++) {
      if (calls[j].name !== 'rotate') continue;
      for (let k = j + 1; k < Math.min(j + 3, calls.length); k++) {
        if (calls[k].name === 'drawImage') return calls[j].a[0];
      }
    }
  }
  return null;
}

for (let f = 0; f < 3; f++) {
  g.map.setFloor(f);
  g.useFloor(f);
  for (const wb of g.map.wallBuys) {
    const { calls } = frameAt(wb, f);
    const side = wb.facing === 'left' || wb.facing === 'right';
    const cy = wb.wallCY + (wb.facing === 'up' ? 7 : wb.facing === 'down' ? -7 : 0);
    const rot = rotatedAt(calls, wb.wallCX, cy);
    if (side) {
      ok(rot !== null,
        `the ${wb.weapon} on storey ${f} hangs on a ${wb.facing} wall but is drawn flat`);
      if (rot !== null) {
        ok(Math.abs(Math.abs(rot) - Math.PI / 2) < 0.01,
          `the ${wb.weapon} on storey ${f} is turned ${rot.toFixed(2)} rad, not a quarter turn`);
      }
    } else {
      ok(rot === null,
        `the ${wb.weapon} on storey ${f} hangs flat but is being rotated anyway`);
    }
  }
}

// ---- and the price stays on your side of the wall --------------------------
for (let f = 0; f < 3; f++) {
  g.map.setFloor(f);
  g.useFloor(f);
  for (const wb of g.map.wallBuys) {
    const side = wb.facing === 'left' || wb.facing === 'right';
    if (!side) continue;
    // where the label lands, in world space, and where you stand
    const lx = wb.wallCX + (wb.facing === 'right' ? -16 : 16);
    const towardStand = Math.abs(lx - wb.x) < Math.abs(wb.wallCX - wb.x);
    ok(towardStand,
      `the price of the ${wb.weapon} on storey ${f} is written on the far side of the wall from you`);
  }
}

if (fails.length) {
  console.log('WALLBUYS FAIL:');
  for (const f of fails) console.log('  -', f);
  process.exitCode = 1;
} else {
  console.log(`WALLBUYS PASS  ${total} guns bolted down, ${seen.left + seen.right} of them hanging sideways ` +
    `(${seen.up} up, ${seen.down} down, ${seen.left} left, ${seen.right} right)`);
}
