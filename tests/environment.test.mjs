import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { nc, load } from '../tools/harness/stub.mjs';
import { validateRegistry } from '../src/systems/map/MapSchema.js';
import { TILE } from '../src/art.js';
const M = await load(),
  data = JSON.parse(await readFile(new URL('../assets/maps/registry.json', import.meta.url)));
async function setup(id = 'neon-night-market') {
  const g = new M.Game(new M.Input(nc(800, 500)));
  await g.mapManager.load('', async () => ({ ok: true, json: async () => structuredClone(data) }));
  g.playMap(id);
  g.roundActive = false;
  g.intermission = 1e9;
  return g;
}
const ticks = (g, n) => {
  for (let i = 0; i < n; i++) {
    g.update(1 / 60);
    g.input.endFrame();
  }
};
const press = (g, key = 'KeyE') => {
  g.input.pressed.add(key);
  g.update(1 / 60);
  g.input.endFrame();
};
function shoot(g, item, damage = 10000) {
  const c = item.config,
    x = c.x,
    y = c.y + 50;
  g.fireHitscan(
    x,
    y,
    -Math.PI / 2,
    { ...g.player.def, dmg: damage, range: 100, pierce: 0 },
    { x, y },
    g.player,
  );
}
test('descriptor validation rejects unknown types, duplicate IDs, invalid zipline references and blocked decks', () => {
  for (const mutate of [
    (d) => (d.maps[1].level.environment[0].type = 'unknown'),
    (d) => (d.maps[1].level.environment[1].id = d.maps[1].level.environment[0].id),
    (d) => (d.maps[2].level.environment.find((c) => c.type === 'zipline').to = 'missing'),
    (d) => (d.maps[1].level.environment.find((c) => c.type === 'platform').width = 400),
  ]) {
    const d = structuredClone(data);
    mutate(d);
    assert.throws(() => validateRegistry(d), /environment/);
  }
});
test('real hitscan drops signs once and electrical DOT damages player/zombies; zones expire to pool', async () => {
  const g = await setup(),
    env = g.environment,
    item = env.destructibles.items[0],
    c = item.config;
  shoot(g, item, 20);
  assert.equal(item.hp, c.hp - 20);
  shoot(g, item);
  assert.equal(item.state, 'falling');
  ticks(g, 40);
  assert.equal(item.state, 'fallen');
  assert.equal(env.hazards.zones.length, 1);
  g.player.pos = { x: c.x, y: c.y };
  g.player.invuln = 0;
  const hp = g.player.hp;
  const z = g.makeZombie({ x: c.x + 12, y: c.y }, 'walker');
  z.state = 1;
  z.baseSpeed = 0;
  g.zombies = [z];
  const zh = z.hp;
  ticks(g, 60);
  assert.ok(g.player.hp < hp);
  assert.ok(z.hp < zh);
  shoot(g, item);
  assert.equal(env.hazards.zones.length, 1);
  g.player.pos = { x: 852, y: 612 };
  g.zombies = [];
  ticks(g, 1500);
  assert.equal(env.hazards.zones.length, 0);
  assert.ok(env.hazards.pool.free.length > 0);
});
test('shootable targets obey wall occlusion and closer zombie bullet stopping', async () => {
  const g = await setup(),
    item = g.environment.destructibles.items[0],
    c = item.config,
    x = c.x,
    y = c.y + 70;
  const index = g.map.tileIdxAt(c.x, c.y + 35),
    old = g.map.tiles[index];
  g.map.tiles[index] = TILE.WALL;
  g.fireHitscan(x, y, -Math.PI / 2, { ...g.player.def, dmg: 100, range: 100 }, { x, y }, g.player);
  assert.equal(item.hp, c.hp);
  g.map.tiles[index] = old;
  const z = g.makeZombie({ x: c.x, y: c.y + 45 }, 'walker');
  z.pos = { x: c.x, y: c.y + 45 };
  z.state = 1;
  g.zombies = [z];
  g.fireHitscan(
    x,
    y,
    -Math.PI / 2,
    { ...g.player.def, dmg: 10, range: 100, pierce: 0 },
    { x, y },
    g.player,
  );
  assert.equal(item.hp, c.hp, 'closer zombie stops the shot');
});
test('fire escape provides real reduced spread, constrains deck and delays enemy melee until climb completes', async () => {
  const g = await setup(),
    env = g.environment,
    platform = env.elevation.platforms[0];
  Object.assign(g.player.pos, platform.entry);
  press(g);
  assert.equal(env.elevation.platform(g.player).id, platform.id);
  assert.equal(env.accuracyMultiplier(g.player), 0.65);
  const z = g.makeZombie({ x: platform.x, y: platform.y }, 'walker');
  z.pos = { x: platform.x, y: platform.y };
  z.state = 1;
  z.baseSpeed = 0;
  g.zombies = [z];
  g.player.invuln = 0;
  const hp = g.player.hp;
  ticks(g, 60);
  assert.equal(g.player.hp, hp);
  assert.equal(env.elevation.canMelee(z, g.player), false);
  ticks(g, platform.climbSeconds * 60 + 5);
  assert.equal(env.elevation.canMelee(z, g.player), true);
  assert.ok(g.player.hp < hp);
  g.zombies = [];
  g.input.keys.add('KeyD');
  ticks(g, 60);
  g.input.keys.clear();
  assert.ok(g.player.pos.x <= platform.x + platform.width / 2 - g.player.r);
  press(g);
  assert.equal(env.elevation.isElevated(g.player), false);
  assert.equal(env.accuracyMultiplier(g.player), 1);
});
test('ordered relay quest requires fallen signs and defend timer; completion pays only once', async () => {
  const g = await setup(),
    env = g.environment,
    q = env.quests[0];
  Object.assign(g.player.pos, q.config.finale);
  press(g);
  assert.equal(q.charging, false);
  Object.assign(g.player.pos, q.config.switches[1]);
  press(g);
  assert.equal(q.stage, 0);
  for (const item of env.destructibles.items.slice(0, 2)) shoot(g, item);
  ticks(g, 40);
  for (const s of q.config.switches) {
    Object.assign(g.player.pos, s);
    press(g);
  }
  assert.equal(q.stage, q.config.switches.length);
  Object.assign(g.player.pos, q.config.finale);
  press(g);
  assert.equal(q.charging, true);
  g.player.pos.x += 200;
  ticks(g, 1);
  assert.equal(q.charging, false);
  Object.assign(g.player.pos, q.config.finale);
  const before = g.player.points;
  press(g);
  ticks(g, q.config.holdSeconds * 60 + 1);
  assert.equal(q.complete, true);
  assert.equal(g.player.points - before, q.config.reward);
  press(g);
  ticks(g, 60);
  assert.equal(g.player.points - before, q.config.reward);
});
test('bear traps damage/root both actors then release movement; pause freezes timer', async () => {
  const g = await setup('blackwood-logging-camp'),
    env = g.environment,
    c = env.hazards.traps[0].config;
  g.player.pos = { x: c.x, y: c.y };
  g.player.invuln = 0;
  const hp = g.player.hp;
  ticks(g, 1);
  assert.ok(g.player.hp < hp);
  assert.equal(env.hazards.rooted(g.player), true);
  const x = g.player.pos.x;
  g.input.keys.add('KeyD');
  ticks(g, 60);
  assert.equal(g.player.pos.x, x);
  g.paused = true;
  const elapsed = env.elapsed;
  ticks(g, 120);
  assert.equal(env.elapsed, elapsed);
  assert.equal(env.hazards.rooted(g.player), true);
  g.paused = false;
  ticks(g, 110);
  assert.equal(env.hazards.rooted(g.player), false);
  assert.ok(g.player.pos.x > x);
  g.input.keys.clear();
  const trap = env.hazards.traps[1],
    z = g.makeZombie({ x: trap.config.x, y: trap.config.y }, 'walker');
  z.pos = { x: trap.config.x, y: trap.config.y };
  z.state = 1;
  g.zombies = [z];
  const zh = z.hp;
  ticks(g, 1);
  assert.ok(z.hp < zh);
  assert.equal(env.hazards.rooted(z), true);
  const pos = { ...z.pos };
  ticks(g, 90);
  assert.deepEqual(z.pos, pos);
});
test('mud composes a 40% movement slowdown for player and zombie without modifying base speed', async () => {
  const g = await setup('blackwood-logging-camp'),
    env = g.environment,
    c = env.mud[1];
  g.player.pos = { x: c.x, y: c.y };
  const base = g.player.baseSpeed;
  assert.equal(env.speedMultiplier(g.player), 0.6);
  g.input.keys.add('KeyD');
  ticks(g, 10);
  assert.equal(g.player.speed, base * 0.6);
  assert.equal(g.player.baseSpeed, base);
  g.input.keys.clear();
  const z = g.makeZombie({ x: c.x, y: c.y }, 'walker');
  z.pos = { x: c.x, y: c.y };
  assert.equal(env.speedMultiplier(z), 0.6);
  g.player.pos = { x: 852, y: 612 };
  assert.equal(env.speedMultiplier(g.player), 1);
});
test('shooting supports installs bullet-blocking cover, evacuates actors and updates routes exactly once', async () => {
  const g = await setup('blackwood-logging-camp'),
    env = g.environment,
    item = env.destructibles.items[0],
    c = item.config,
    cell = c.cells[2];
  g.player.pos = { x: (cell.x + 0.5) * 24, y: (cell.y + 0.5) * 24 };
  g.player.invuln = 0;
  let topology = 0;
  g.mapManager.on('environment:topology', () => topology++);
  shoot(g, item);
  assert.equal(item.state, 'falling');
  ticks(g, 50);
  assert.equal(item.state, 'fallen');
  assert.equal(topology, 1);
  for (const p of c.cells) assert.equal(g.map.solidAt(p.x, p.y), true);
  assert.equal(g.map._inSolid(g.player.pos, g.player.r, 0), false);
  const hit = g.map.rayWall(cell.x * 24, cell.y * 24 - 20, cell.x * 24, cell.y * 24 + 40);
  assert.ok(hit);
  ticks(g, 30);
  assert.equal(topology, 1);
  assert.ok(g.map.flowStep(g.player.pos.x + 60, g.player.pos.y));
});
test('zipline connects raised platforms, suspends walking/shooting, lands cleanly and supports return', async () => {
  const g = await setup('blackwood-logging-camp'),
    env = g.environment,
    platform = env.elevation.platforms[0];
  Object.assign(g.player.pos, platform.entry);
  press(g);
  assert.equal(env.elevation.isElevated(g.player), true);
  const ammo = g.player.slot.mag;
  press(g);
  assert.equal(env.elevation.inTransit(g.player), true);
  g.input.keys.add('KeyD');
  g.input.mouse.down = true;
  ticks(g, 50);
  assert.equal(g.player.slot.mag, ammo);
  g.input.keys.clear();
  g.input.mouse.down = false;
  ticks(g, 80);
  assert.equal(env.elevation.inTransit(g.player), false);
  assert.equal(env.elevation.platform(g.player).id, 'forest-lookout');
  assert.equal(g.map._inSolid(g.player.pos, g.player.r, 0), false);
  press(g);
  assert.equal(env.elevation.inTransit(g.player), true);
  ticks(g, 130);
  assert.equal(env.elevation.platform(g.player).id, 'mill-lookout');
});
test('repeated reset/map changes release effects, roots, quest and topology state; complete drawing remains valid', async () => {
  const g = await setup('blackwood-logging-camp'),
    old = g.environment,
    item = old.destructibles.items[0];
  shoot(g, item);
  ticks(g, 50);
  g.draw(nc(800, 500).getContext('2d'));
  g.reset();
  assert.notEqual(g.environment, old);
  assert.equal(old.entities.length, 0);
  assert.equal(old.effects.length, 0);
  assert.equal(g.map.solidAt(item.config.cells[0].x, item.config.cells[0].y), false);
  g.playMap('neon-night-market');
  g.draw(nc(800, 500).getContext('2d'));
  g.playMap('terminal-transit');
  assert.equal(g.environment, null);
  assert.ok(g.bus);
  g._loadMap(true);
  assert.ok(g.map.rangePads);
});
test('actual player shots have lower spread on deck; traps cannot be bypassed by climb interaction', async () => {
  const g = await setup(),
    p = g.player,
    env = g.environment,
    platform = env.elevation.platforms[0];
  const angles = [],
    fire = g.fireHitscan,
    random = Math.random;
  g.fireHitscan = (x, y, a) => angles.push(a);
  p.aim = 0;
  p.vel.x = p.vel.y = 0;
  p.speed = p.baseSpeed;
  try {
    Math.random = () => 0.9;
    p.fire(g);
    env.elevation.states.set(p, { platform, progress: 1 });
    p.fire(g);
  } finally {
    Math.random = random;
    g.fireHitscan = fire;
  }
  assert.ok(Math.abs(angles[1]) < Math.abs(angles[0]));
  env.hazards.roots.set(p, env.elapsed + 2);
  env.interact(p, { kind: 'descend', platform });
  assert.equal(env.elevation.isElevated(p), true);
});
test('all spawns retain navigation routes after every logging support falls', async () => {
  const g = await setup('blackwood-logging-camp'),
    env = g.environment;
  for (const item of env.destructibles.items) env.destructibles.hit(item, 10000);
  ticks(g, 55);
  g.rebuildFlow();
  for (const p of g.map.spawnPoints)
    assert.ok(g.map.dist[g.map.tileIdxAt(p.x, p.y)] < 0x3fffffff, 'spawn must remain reachable');
});
