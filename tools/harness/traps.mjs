// Headless harness for the level traps: which storey they belong to, who can
// reach them, and who they cook.
//
// Traps used to be one flat list. The second floor therefore showed the ground
// floor's traps hanging in its own walls, let you arm them from a staircase
// away, and -- the part that gave it away -- killed zombies on every storey at
// once when one of them went off.
import { nc, load, SRC } from './stub.mjs';

const M = await load();
const { Trap } = await import(SRC + '/traps.js');
const H = 1 / 60;
const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };

const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
g.begin();
g.startRound(3);
for (let i = 0; i < 60; i++) g.update(H);

// ---- every trap belongs to exactly one storey ------------------------------
const all = g.traps.list;
const f0 = g.traps.on(0), f1 = g.traps.on(1), f2 = g.traps.on(2);
ok(f0.length > 0, 'the ground floor has no traps of its own');
ok(f1.length > 0, 'the second floor has no traps of its own');
ok(f0.length + f1.length + f2.length === all.length, 'a trap belongs to no storey at all');
ok(all.every((t) => Number.isInteger(t.floor)), 'a trap has no storey number');
for (const t of f0) ok(!f1.includes(t), `trap ${t.i} is bolted to two storeys at once`);

// ---- you can only reach the traps on the storey you are standing on --------
// The storeys share a grid, so a trap upstairs can sit within arm's reach of
// one downstairs: what must never happen is reaching across storeys.
for (const t of f0) {
  const got = g.traps.nearest(t.x, t.y, 46, 1);
  ok(!got || (got.floor ?? 0) === 1,
    `trap ${t.i} of the ground floor can be armed from the second floor`);
}
for (const t of f1) {
  const got = g.traps.nearest(t.x, t.y, 46, 0);
  ok(!got || (got.floor ?? 0) === 0,
    `trap ${t.i} of the second floor can be armed from the ground floor`);
}
ok(g.traps.nearest(f1[0].x, f1[0].y, 20, 1) === f1[0], 'a trap cannot be found on its own storey');

// ---- and it is not offered to you from another storey ----------------------
const playerFloor = g.player.floor;
g.map.setFloor(1);
g.player.floor = 1;
g.player.pos.x = f0[0].x;
g.player.pos.y = f0[0].y;
const far = g.interactionFor(g.player);
ok(!far || far.type !== 'trap', 'a trap on the floor below is offered to you');

g.player.pos.x = f1[0].x;
g.player.pos.y = f1[0].y;
const near = g.interactionFor(g.player);
ok(near && near.type === 'trap', 'standing at a trap on your own storey offers nothing');

// ---- a running trap only cooks its own storey ------------------------------
const t = f1[0];
t.arm();
ok(t.running, 'the trap would not arm');

const put = (floor) => {
  const z = new M.Zombie(g.map, t.centre().x, t.centre().y, { hp: 4000 });
  z.floor = floor;
  z.state = 0;
  g.zombies.push(z);
  return z;
};
// two walkers at the very same spot, one on each storey
const above = put(1);
const below = put(0);
const hpAbove = above.hp, hpBelow = below.hp;
for (let i = 0; i < 30; i++) g.traps.update(H, g);
ok(above.hp < hpAbove, 'the trap did not touch the walker standing in it');
ok(below.hp === hpBelow,
  `the trap reached a walker on another storey (${hpBelow - below.hp} damage)`);

// ---- and it draws only where it is -----------------------------------------
const drawn = [];
const origDraw = Trap.prototype.draw;
Trap.prototype.draw = function spy(ctx, time) { drawn.push(this.floor); return origDraw.call(this, ctx, time); };
try {
  g.traps.draw(nc(M.VW, M.VH).getContext('2d'), 1, 1);
} finally { Trap.prototype.draw = origDraw; }
ok(drawn.length > 0, 'no trap drew at all');
ok(drawn.every((fl) => fl === 1), `the wrong storey's traps were drawn: ${drawn.join(',')}`);

g.map.setFloor(playerFloor ?? 0);

// ---- each one is bolted to a wall, and its zone is somewhere a walker goes --
// A trap floating in the middle of a room, or a zone full of wall, is a trap
// you can pay for and never use.
const T = 24;
for (const tr of all) {
  const f = tr.floor;
  g.map.setFloor(f);
  ok(g.map.solidAt(tr.tx, tr.ty), `trap ${tr.i} (${tr.kind.id}) is bolted to tile ${tr.tx},${tr.ty}, which is not a wall`);
  let walk = 0, reach = 0, tot = 0;
  for (let ty = Math.floor(tr.zy / T); ty < Math.ceil((tr.zy + tr.zh) / T); ty++) {
    for (let tx = Math.floor(tr.zx / T); tx < Math.ceil((tr.zx + tr.zw) / T); tx++) {
      tot++;
      if (g.map.solidAt(tx, ty)) continue;
      walk++;
      if (g.map.reachable((tx + 0.5) * T, (ty + 0.5) * T, f)) reach++;
    }
  }
  ok(tot > 0, `trap ${tr.i} has an empty trigger zone`);
  ok(reach > 0, `nothing can ever walk into trap ${tr.i}'s zone`);
  ok(reach >= Math.ceil(walk * 0.5),
    `trap ${tr.i}'s zone is ${walk - reach} tiles of floor the horde cannot even reach`);
  const c = tr.centre();
  ok(Math.hypot(c.x - tr.x, c.y - tr.y) < 200, `trap ${tr.i}'s zone is nowhere near the device`);
}
g.map.setFloor(playerFloor ?? 0);

if (fails.length) {
  console.log('TRAPS FAIL:');
  for (const f of fails) console.log('  -', f);
  process.exitCode = 1;
} else {
  console.log(`TRAPS PASS  ${all.length} traps across the storeys: each reaches its own, and only its own`);
}
