import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { nc, load } from '../tools/harness/stub.mjs';
import { validateRegistry } from '../src/systems/map/MapSchema.js';
import { ObjectPool } from '../src/utils/ObjectPool.js';
const M = await load(),
  data = JSON.parse(await readFile(new URL('../assets/maps/registry.json', import.meta.url)));
async function setup() {
  const g = new M.Game(new M.Input(nc()));
  await g.mapManager.load('', async () => ({ ok: true, json: async () => structuredClone(data) }));
  g.playMap('terminal-transit');
  return g;
}
const press = (g, key) => {
  g.input.pressed.add(key);
  g.update(1 / 60);
  g.input.endFrame();
};
const ticks = (g, n) => {
  for (let i = 0; i < n; i++) {
    g.update(1 / 60);
    g.input.endFrame();
  }
};
test('vehicle/config rejects invalid physics and object references', () => {
  const d = structuredClone(data);
  d.maps[0].level.vehicle.maxSpeed = Infinity;
  assert.throws(() => validateRegistry(d), /vehicle/);
  const d2 = structuredClone(data);
  d2.maps[0].level.wallBuys[0].weapon = 'missing';
  assert.throws(() => validateRegistry(d2), /weapon/);
});
test('E entry, acceleration, inertia, braking, safe exit, restart and disposal', async () => {
  const g = await setup(),
    v = g.bus,
    b = v.body;
  Object.assign(g.player.pos, v.seat());
  press(g, 'KeyE');
  assert.equal(b.driving, true);
  const fuel = b.fuel;
  g.input.keys.add('KeyW');
  ticks(g, 60);
  assert.ok(Math.hypot(b.vel.x, b.vel.y) > 60);
  assert.ok(b.fuel < fuel);
  g.input.keys.add('KeyD');
  ticks(g, 30);
  g.input.keys.delete('KeyD');
  assert.ok(Math.abs(b.angle) > 0.05);
  assert.ok(
    Math.abs(-b.vel.x * Math.sin(b.angle) + b.vel.y * Math.cos(b.angle)) > 0.1,
    'visible lateral slip',
  );
  g.input.keys.clear();
  assert.equal(v.exit(), false, 'moving exit is refused');
  g.input.keys.add('Space');
  ticks(g, 90);
  assert.ok(Math.hypot(b.vel.x, b.vel.y) < 10);
  g.input.keys.clear();
  assert.equal(v.exit(), true);
  assert.equal(b.driving, false);
  assert.ok(b.distance(g.player.pos.x, g.player.pos.y) > g.player.r);
  g.reset();
  assert.notEqual(g.bus, v);
  assert.equal(v.contacts.size, 0);
  assert.equal(g.bus.body.fuel, 100);
});
test('fuel exhaustion, repair/refuel price and nearby stationary zombie damage', async () => {
  const g = await setup(),
    v = g.bus,
    b = v.body;
  b.driving = true;
  b.fuel = 0;
  g.input.keys.add('KeyW');
  v.update(1);
  assert.equal(Math.hypot(b.vel.x, b.vel.y), 0);
  const service = g.map.definition.level.stations[0];
  b.driving = false;
  Object.assign(b.pos, { x: service.x + 50, y: service.y });
  Object.assign(g.player.pos, service);
  b.hp = 500;
  g.player.points = 1000;
  assert.equal(v.interact(), true);
  assert.equal(b.hp, 2000);
  assert.equal(g.player.points, 500);
  const refuel = g.map.definition.level.stations[1];
  Object.assign(b.pos, { x: refuel.x - 50, y: refuel.y });
  Object.assign(g.player.pos, refuel);
  v.interact();
  assert.equal(b.fuel, 100);
  assert.equal(g.player.points, 250);
  const z = g.makeZombie({ x: b.pos.x, y: b.pos.y + 26 }, 'walker');
  z.state = 1;
  g.zombies = [z];
  const hp = b.hp;
  v.collide();
  assert.ok(b.hp < hp);
  assert.ok(b.distance(z.pos.x, z.pos.y) >= z.r);
});
test('ten moving bus hits kill walkers and route rewards through game combat', async () => {
  const g = await setup(),
    v = g.bus,
    b = v.body;
  b.driving = true;
  b.vel.x = 140;
  g.zombies = [];
  for (let i = 0; i < 10; i++) {
    const z = g.makeZombie({ x: b.pos.x + 35, y: b.pos.y }, 'walker');
    z.state = 1;
    z.pos = { x: b.pos.x + 35, y: b.pos.y };
    g.zombies.push(z);
  }
  const kills = g.stats.kills;
  v.collide();
  assert.equal(g.zombies.filter((z) => z.dead).length, 10);
  assert.equal(g.stats.kills - kills, 10);
  assert.ok(b.hp < 2000);
  const ctx = nc(800, 500).getContext('2d');
  g.draw(ctx);
  assert.ok(v.sparks.length <= 32);
});
test('sparse footprint insertion/removal, cached detour, fixed search budget; no bus-triggered full rebuild', async () => {
  const g = await setup(),
    v = g.bus,
    b = v.body;
  g.player.pos = { x: 650, y: 600 };
  g.rebuildFlow();
  v.navigation.begin();
  let builds = 0;
  const raw = g.map.buildFlow.bind(g.map);
  g.map.buildFlow = (...args) => {
    builds++;
    return raw(...args);
  };
  let x = 1000,
    y = 600,
    movedAround = false;
  for (let k = 0; k < 100; k++) {
    v.navigation.begin();
    const step = g.map.flowStep(x, y);
    if (!step) break;
    assert.equal(v.obstacle.cells.has(step.ti), false, 'detour never chooses occupied cell');
    x = step.x;
    y = step.y;
    if (Math.abs(y - 600) > 36) movedAround = true;
    if (x < 740) break;
  }
  assert.ok(movedAround, 'route bends around bus');
  assert.ok(x < 740, 'route reaches far side');
  const cells = new Set(v.obstacle.cells);
  b.pos.y += 120;
  const changes = v.obstacle.update(b, g.map);
  assert.ok(changes.length > 0 && changes.length < 100);
  assert.ok([...cells].some((i) => !v.obstacle.cells.has(i)));
  v.navigation.begin();
  for (let i = 0; i < 100; i++) v.navigation.step(940 + (i % 5) * 24, 600 + Math.floor(i / 5) * 2);
  assert.ok(v.navigation.expansions <= 1200);
  assert.equal(builds, 0);
});
test('full body respects walls and finite physics under repeated steering', async () => {
  const g = await setup(),
    v = g.bus,
    b = v.body;
  b.driving = true;
  b.pos = { x: 1600, y: 600 };
  g.input.keys.add('KeyW');
  for (let i = 0; i < 500; i++) v.update(1 / 60);
  assert.ok(b.pos.x < 1728 - b.length / 2);
  assert.equal(v.physics.blocked(), false);
  assert.ok(Number.isFinite(b.angle));
});
test('pool reset and bounded retention', () => {
  const pool = new ObjectPool(
    () => ({}),
    (v, n) => {
      v.n = n;
    },
    2,
  );
  const a = pool.acquire(1);
  pool.release(a);
  assert.equal(pool.acquire(2), a);
  assert.equal(a.n, 2);
  pool.release(a);
  pool.release({});
  pool.release({});
  assert.equal(pool.free.length, 2);
});
test('doors, both power points, three upgrades and wall weapons use existing economy', async () => {
  const g = await setup();
  g.player.points = 30000;
  assert.equal(g.map.powerSwitches.length, 2);
  assert.equal(g.map.papSpots.length, 3);
  assert.equal(g.map.barricades.length, 2);
  for (const power of g.map.powerSwitches) {
    g.powerOn = false;
    Object.assign(g.player.pos, power);
    const it = g.interactionFor();
    assert.equal(it.type, 'power');
    g.doInteraction();
    assert.equal(g.powerOn, true);
  }
  for (const spot of g.map.papSpots) {
    g.player.packed.clear();
    Object.assign(g.player.pos, spot);
    const before = g.player.points;
    const it = g.interactionFor();
    assert.equal(it.type, 'pap');
    g.doInteraction();
    assert.ok(g.player.points < before);
    assert.ok(g.player.packed.has(g.player.current));
  }
  const door = g.map.doors[0];
  g.player.pos = { x: door.cx, y: door.cy + 24 };
  g.doInteraction(g.player, { type: 'door', door, price: door.price });
  assert.equal(door.open, true);
  assert.equal(g.map.solidAt(door.tx, door.ty), false);
  const gun = g.map.wallBuys[0];
  Object.assign(g.player.pos, gun);
  assert.equal(g.interactionFor().type, 'wallbuy');
  g.doInteraction();
  assert.equal(g.player.loadout[gun.weapon].owned, true);
});
test('bus destruction ejects driver, disables acceleration; blocked exits refuse safely', async () => {
  const g = await setup(),
    v = g.bus,
    b = v.body;
  b.driving = true;
  b.hp = 0;
  v.update(1 / 60);
  assert.equal(b.driving, false);
  b.driving = true;
  b.hp = 2000;
  const raw = g.map._inSolid;
  g.map._inSolid = () => true;
  assert.equal(v.exit(), false);
  assert.equal(b.driving, true);
  g.map._inSolid = raw;
  const z = g.makeZombie({ x: 900, y: 600 }, 'brute');
  z.pos = { x: 900, y: 600 };
  g.zombies = [z];
  b.vel.x = 60;
  v.collide();
  assert.ok(z.hp < z.maxHp);
  assert.ok(Math.hypot(z.vel.x, z.vel.y) > 0);
});
test('engine voice is reused, changes pitch, and disconnects on stop', async () => {
  const { VehicleAudio } = await import('../src/systems/vehicle/VehicleAudio.js');
  const { audio } = await import('../src/audio.js');
  const oldCtx = audio.ctx,
    oldBus = audio.sfxBus;
  let created = 0,
    stopped = 0,
    disconnected = 0;
  const pitches = [];
  audio.ctx = {
    currentTime: 0,
    createOscillator() {
      created++;
      return {
        connect() {},
        disconnect() {
          disconnected++;
        },
        start() {},
        stop() {
          stopped++;
        },
        frequency: {
          setTargetAtTime(v) {
            pitches.push(v);
          },
        },
      };
    },
    createGain() {
      return {
        gain: { value: 0 },
        connect() {},
        disconnect() {
          disconnected++;
        },
      };
    },
  };
  audio.sfxBus = {};
  try {
    const sound = new VehicleAudio();
    sound.update(true, 0);
    sound.update(true, 200);
    assert.equal(created, 1);
    assert.ok(pitches[1] > pitches[0]);
    sound.stop();
    sound.stop();
    assert.equal(stopped, 1);
    assert.equal(disconnected, 2);
  } finally {
    audio.ctx = oldCtx;
    audio.sfxBus = oldBus;
  }
});
test('end-to-end entered bus drives through ten walkers, shields driver and leads camera', async () => {
  const g = await setup(), v = g.bus, b = v.body;
  g.roundActive = false; g.intermission = 1e9;
  g.zombies = [];
  for (let i=0;i<10;i++) { const z=g.makeZombie({x:945+i*26,y:600},'walker'); z.pos={x:945+i*26,y:600};z.state=1;g.zombies.push(z); }
  Object.assign(g.player.pos,v.seat());press(g,'KeyE');
  const ammo=g.player.slot.mag,hp=g.player.hp;
  g.input.keys.add('KeyW');g.input.mouse.down=true;ticks(g,210);g.input.keys.clear();g.input.mouse.down=false;
  assert.ok(g.stats.kills>=10);assert.equal(g.player.slot.mag,ammo);assert.equal(g.player.hp,hp);
  assert.ok(b.pos.x>1050);assert.equal(g.player.pos.x,b.pos.x);assert.ok(g.cam.x>b.pos.x-400);
  const ctx=nc(800,500).getContext('2d');g.draw(ctx);
});
