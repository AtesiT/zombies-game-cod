// Staircases have to be findable: a marker on the floor, an arrow saying
// which way it goes, a label when you are close, and a pin on the minimap.
import { nc, load } from './stub.mjs';
const M = await load();
// the lamps flicker with Math.random, and this test counts warm pixels --
// without a fixed seed the numbers move around enough to fail by luck
let seed = 5150;
Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const H = 1 / 60, T = 24;
let fails = 0;
const ok = (c, l, x = '') => { console.log(`${c ? ' ok ' : 'FAIL'}  ${l}${x ? '  -- ' + x : ''}`); if (!c) fails++; };
const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
const cx = nc(M.VW, M.VH).getContext('2d');
g.begin(); g.started = true; g.power = true; g.powerOn = true;
g.player.hurt = () => false;

// Stand next to the west stair on the ground floor and look at the pixels.
// NB: stand on the *centre* of a tile. A tile corner is only 12px from the
// stair tile's centre in both axes, which is inside the trigger box, so the
// old version of this test was quietly carried upstairs on its first frame
// and spent the whole time measuring the second floor.
const ink = () => {
  const d = cx.getImageData(0, 0, M.VW, M.VH).data;
  let warm = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 110 && d[i] - d[i + 2] > 45) warm++;
  return warm;
};
const centre = (tx, ty) => { g.player.pos.x = (tx + 0.5) * T; g.player.pos.y = (ty + 0.5) * T; };
centre(20, 13);                                        // beside the west stair
for (let f = 0; f < 40; f++) { g.player.hp = 100; g.update(H); }
ok(g.map.floor === 0, 'standing beside the stair carried the player upstairs anyway');
g.draw(cx);
const near = ink();
centre(30, 24);                                        // far away, down the room
for (let f = 0; f < 40; f++) { g.player.hp = 100; g.update(H); }
ok(g.map.floor === 0, 'walking away from the stair changed storey');
g.draw(cx);
const far = ink();
ok(near > far + 200, 'the stair draws a marker and label when you stand by it', `${near} vs ${far} warm px`);

// every storey's links are marked, pointing the right way
for (const f of [0, 1, 2]) {
  g.map.setFloor(f);
  g.useFloor(f);
  const links = g.map.linksOn(f);
  ok(links.length > 0, `storey ${f} has links to mark`, `${links.length}`);
  for (const l of links) {
    const here = l.a.floor === f ? l.a : l.b;
    const there = l.a.floor === f ? l.b : l.a;
    const up = there.floor > f;
    const dest = g.map.floors[there.floor]?.def?.name;
    console.log(`     ${l.name.padEnd(14)} at ${here.tx},${here.ty} -> ${up ? 'UP  ' : 'DOWN'} to ${dest}`);
    ok(!!dest, `  ${l.name}: destination named`);
  }
}
// ---- a staircase works both ways --------------------------------------------
// A bunk ended up parked on the west stair landing upstairs, and a link tile
// you cannot stand on is a one-way trip: you climb out of the room you woke
// up in and there is no way back down for the rest of the run.
{
  const g2 = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g2.begin(); g2.started = true; g2.powerOn = true;
  g2.player.hurt = () => false;
  const H2 = 1 / 60;

  // every end of every link has to be somewhere you can stand
  for (const l of g2.map.links) {
    for (const end of [l.a, l.b]) {
      const solid = g2.map.solidTileOn(end.floor, end.tx, end.ty);
      ok(!solid, `${l.name}: the ${end.floor === l.a.floor ? 'lower' : 'upper'} end at `
        + `${end.tx},${end.ty} is solid -- you could never step on it`);
    }
  }

  // and climbing up and straight back down again must land you where you began
  for (const l of g2.map.links) {
    for (const from of [l.a.floor, l.b.floor]) {
      const g3 = new M.Game(new M.Input(nc(M.VW, M.VH)));
      g3.begin(); g3.started = true; g3.powerOn = true;
      g3.player.hurt = () => false;
      g3.map.setFloor(from); g3.useFloor(from);
      const at = g3.map.linkPos(l, from);
      g3.player.pos.x = at.x; g3.player.pos.y = at.y;
      g3.update(H2);
      const climbed = g3.map.floor;
      ok(climbed !== from, `${l.name}: standing on it from storey ${from} did nothing`);
      for (let i = 0; i < 80; i++) { g3.player.hp = 100; g3.update(H2); }   // wait out the cooldown
      const back = g3.map.linkPos(l, climbed);
      g3.player.pos.x = back.x; g3.player.pos.y = back.y;
      g3.update(H2);
      ok(g3.map.floor === from,
        `${l.name}: went up from storey ${from} to ${climbed} and could not get back`);
    }
  }
  console.log('     every link climbed both ways');
}

// the top of the house is where the bench is, and the storeys above the
// ground floor have nothing to pay for
{
  const g4 = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g4.begin();
  for (const f of [0, 1, 2]) {
    g4.map.setFloor(f);
    const doors = g4.map.doors.length;
    const bench = !!g4.map.workbench;
    if (f > 0) {
      ok(doors === 0, `storey ${f} still has ${doors} doors to buy`);
      console.log(`     storey ${f}: ${doors} doors, ${bench ? 'the bench is here' : 'no bench'}`);
    }
    ok(bench === (f === 2),
      `storey ${f} ${bench ? 'has' : 'has no'} workbench, and it should ${f === 2 ? '' : 'not '}`);
  }
}

// the marker must not throw when the player is miles away
g.map.setFloor(0); g.useFloor(0);
g.player.pos.x = 100; g.player.pos.y = 900;
try { g.draw(cx); ok(true, 'drawing with every stair off screen is fine'); }
catch (e) { ok(false, 'drawing with every stair off screen is fine', e.message); }

console.log(fails === 0 ? '\nSTAIRS PASS' : `\nSTAIRS FAIL (${fails})`);
process.exit(fails ? 1 : 0);
