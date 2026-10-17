import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nc, load } from './stub.mjs';
const M = await load();
const { MAX_THROW_SPEED } = await import('../../src/game.js');
const { T, TILE } = await import('../../src/art.js');
const { FLOORS } = await import('../../src/mapData.js');
const { GRENADE_MAX } = await import('../../src/weapons.js');
const { Player } = await import('../../src/entities.js');
const fresh = () => { const g = new M.Game(new M.Input(nc(800, 500))); g.begin(); return g; };

test('closed doors face the fixed camera; open doors leave the aperture empty on both axes', () => {
  const g = fresh(); g._vis = () => true; g.player.pos = { x: 900, y: 900 };
  const images = [];
  for (const horizontal of [false, true]) {
    const d = { tx: 3, ty: 3, cx: 84, cy: 84, horizontal, price: 750, open: false };
    g.map.doors = [d];
    const c = nc(160, 160), ctx = c.getContext('2d');
    g.drawDoors(ctx); images.push(ctx.getImageData(72, 72, T, T).data);
    ctx.clearRect(0, 0, 160, 160); d.open = true; g.drawDoors(ctx);
    const centre = ctx.getImageData(75, 75, 18, 18).data;
    assert.ok(centre.every((v) => v === 0), 'the centre of an open doorway must be bare floor');
    const parked = horizontal ? ctx.getImageData(50, 74, 20, 4).data : ctx.getImageData(74, 50, 4, 20).data;
    assert.ok(parked.some((v, i) => i % 4 === 3 && v > 0), 'leaf must remain visible on the neighbouring wall');
  }
  assert.deepEqual(images[0], images[1], 'do not rotate the slab/handle with the wall');
});

test('every real door remains a collision gate and clears when bought', () => {
  const g = fresh(); let count = 0;
  for (let f = 0; f < g.map.floors.length; f++) {
    for (const d of g.map.floors[f].doors) {
      assert.equal(g.map.solidTileOn(f, d.tx, d.ty), true);
      d.open = true;
      assert.equal(g.map.solidTileOn(f, d.tx, d.ty), false);
      count++;
    }
  }
  assert.ok(count >= 8);
});

test('throwable shops retain types on every floor, fill the correct pocket and respect cap', () => {
  const g = fresh(), seen = new Set();
  g.player.points = 100000;
  for (let f = 0; f < g.map.floors.length; f++) {
    for (const crate of g.map.floors[f].grenadeCrates) {
      const kind = crate.kind; seen.add(kind);
      const pocket = { frag: 'grenades', molotov: 'molotovs', gas: 'gasbombs' }[kind];
      assert.ok(pocket);
      const p = g.player; p.floor = f; p.pos = { x: crate.x, y: crate.y };
      p[pocket] = GRENADE_MAX - 1;
      const it = g.interactionFor(p);
      assert.equal(it.type, 'grenade'); assert.equal(it.kind, kind);
      const points = p.points;
      g.doInteraction(p, it);
      assert.equal(p[pocket], GRENADE_MAX); assert.ok(p.points < points);
      const paid = p.points; g.doInteraction(p, g.interactionFor(p));
      assert.equal(p.points, paid); assert.equal(p[pocket], GRENADE_MAX);
    }
  }
  assert.deepEqual([...seen].sort(), ['frag', 'gas', 'molotov']);
});

test('far cursor and remote throws share a short speed cap and bounded travel', () => {
  const g = fresh();
  const start = { x: 500, y: 500 }; g.player.pos = { ...start }; g.player.aim = 0;
  g.map.moveCircle = (pos, dx, dy) => { pos.x += dx; pos.y += dy; };
  for (const hz of [60, 120]) {
    for (const kind of ['frag', 'molotov', 'gas']) {
      for (const mode of ['cursor', 'remote', 'override']) {
        g.input.mouse = { x: 1e8, y: 500 }; g.cam = { x: 0, y: 0 };
        g.throwAtCursor(g.player, kind, mode === 'cursor' ? undefined : 0, mode === 'override' ? 1e9 : undefined);
        const item = kind === 'frag' ? g.grenades.at(-1) : g.pThrows.at(-1);
        const speed = kind === 'frag' ? Math.hypot(item.vel.x, item.vel.y) : Math.hypot(item.vx, item.vy);
        assert.ok(speed <= MAX_THROW_SPEED + 1e-6);
        if (kind === 'frag') {
          for (let i = 0; i < Math.floor(2.3 * hz); i++) item.update(1 / hz, g);
          assert.ok(Math.hypot(item.pos.x - start.x, item.pos.y - start.y) < 180);
        }
      }
    }
  }
});

test('aim target uses camera coordinates, stays red and updates for guests', () => {
  const g = fresh();
  g.player.pos = { x: 800, y: 500 }; g.player.floor = 0;
  g.cam = { x: 500, y: 300 };
  const z = g.makeZombie({ x: 850, y: 500 }, 'walker'); z.pos = { x: 850, y: 500 };
  g.zombies = [z]; g.input.mouse.x = 350; g.input.mouse.y = 200;
  g.map.rayWall = () => null;
  g.updateAimTarget(); assert.equal(g.aimOnTarget, true);
  const c = nc(800, 500), ctx = c.getContext('2d');
  M.settings.set('crosshair', true);
  g.hud._crosshair(ctx, g, 800, 500);
  const data = ctx.getImageData(350, 200, 1, 1).data;
  assert.ok(data[0] > data[1] * 3 && data[0] > data[2] * 3);
  g.aimOnTarget = false; g.net.role = 'guest'; g.net.state = 'idle';
  g._guestUpdate(1 / 60); assert.equal(g.aimOnTarget, true);
  z.floor = 1; g.updateAimTarget(); assert.equal(g.aimOnTarget, false);
  z.floor = 0; z.dead = true; g.updateAimTarget(); assert.equal(g.aimOnTarget, false);
  z.dead = false; g.map.rayWall = () => ({ t: 1 }); g.updateAimTarget(); assert.equal(g.aimOnTarget, false);
});

test('upper-floor caches draw, stay reachable and synchronize opening from another floor', () => {
  const host = fresh(), guest = fresh();
  const F = host.map.floors[1];
  host.map.buildFlowOn(1, 18.5 * T, 11.5 * T);
  for (const c of F.cacheSpots) {
    assert.equal(host.map.blockedAt(c.x, c.y, 10, 1), false);
    assert.equal(host.map.reachable(c.x, c.y, 1), true);
  }
  const cache = F.cacheSpots[0];
  const p = new Player(host.map, cache.x, cache.y); p.floor = 1;
  host.players.push(p);
  const it = host.interactionFor(p);
  assert.equal(it.type, 'cache');
  host.doInteraction(p, it); assert.equal(cache.taken, true);
  guest.net._apply(host.net.snapshot(), true);
  assert.equal(guest.map.floors[1].cacheSpots[0].taken, true);
  assert.equal(host.map.floor, 0, 'remote interaction must not change the host view');
  host.map.setFloor(1); host.useFloor(1); host._vis = () => true;
  const c = F.cacheSpots[1];
  const canvas = nc(host.map.w * T, host.map.h * T), ctx = canvas.getContext('2d');
  host.drawCaches(ctx); host.drawCaches(ctx, true);
  const pixels = ctx.getImageData(c.x - 12, c.y - 10, 24, 20).data;
  assert.ok(pixels.some((v, i) => i % 4 === 3 && v > 0), 'cache cannot be invisible');
  ctx.clearRect(0, 0, canvas.width, canvas.height); c.taken = true;
  host.drawCaches(ctx); host.drawCaches(ctx, true);
  assert.equal(ctx.getImageData(c.x, c.y, 1, 1).data[3], 0);
});

test('second floor removes only low-contrast wooden tables, keeping crates and other furniture', () => {
  const g = fresh(), upper = g.map.floors[1];
  assert.equal(FLOORS[1].rows.some((row) => row.includes('t')), false);
  assert.equal(upper.tiles.includes(TILE.TABLE), false);
  for (const tile of [TILE.CRATE, TILE.LOCKER, TILE.BUNK]) assert.ok(upper.tiles.includes(tile));
});

test('enlarged car and tank block bodies, bullets and flow over their complete hulls', () => {
  const g = fresh(), m = g.map;
  for (const [x0, y0, w, h] of [[28, 45, 6, 3], [61, 42, 7, 4]]) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      assert.equal(m.tileAt(x, y), TILE.VEHICLE);
      assert.equal(m.solidTileOn(0, x, y), true);
      assert.equal(m.blocksBullets(x, y), true);
    }
    const y = (y0 + h / 2) * T;
    const pos = { x: (x0 - 1) * T, y };
    for (let i = 0; i < 180; i++) m.moveCircle(pos, 2, 0, 9, 0);
    assert.ok(pos.x <= x0 * T - 9 + 0.01);
  }
  m.buildFlow(31 * T, 44 * T);
  assert.equal(m.reachable(31 * T, 46.5 * T), false);
  assert.equal(m.reachable(64.5 * T, 44 * T), false);
});
