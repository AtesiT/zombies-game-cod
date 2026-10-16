// Headless harness: a guest walks the whole house.
//
// Written after a co-op session where the guest saw no buy prompts, could not
// knife or throw grenades, and after a few minutes the picture froze. All of
// that points at the guest's own frame: _guestUpdate runs interactionFor() and
// the menu code against a world that only exists as snapshots, so anything
// that assumes host-only state throws -- and an exception inside the rAF loop
// is exactly a frozen picture.
//
//   node guestwalk.mjs
import { createCanvas } from './node_modules/@napi-rs/canvas/index.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..', '..', 'src');

function canvasStub(w, h) {
  const c = createCanvas(w || 1, h || 1);
  c.style = {};
  c.addEventListener = () => {};
  c.getBoundingClientRect = () => ({ left: 0, top: 0, width: c.width, height: c.height });
  return c;
}
globalThis.window = { addEventListener() {}, removeEventListener() {}, innerWidth: 1280, innerHeight: 800 };
globalThis.document = {
  createElement: (t) => (t === 'canvas' ? canvasStub(800, 500) : { style: {}, appendChild() {}, addEventListener() {} }),
  getElementById: () => canvasStub(800, 500),
  body: { appendChild() {} },
};
globalThis.performance = globalThis.performance ?? { now: () => Date.now() };
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
globalThis.AudioContext = undefined;

let seed = 13579;
Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const { Game, VW, VH } = await import(SRC + '/game.js');
const { Powerup } = await import(SRC + '/powerups.js');
const { throwGrenade, MonkeyBomb } = await import(SRC + '/entities.js');
const { WEAPONS } = await import(SRC + '/weapons.js');

const fails = [];
const ok = (c, l, x = '') => {
  console.log(`${c ? ' ok ' : 'FAIL'}  ${l}${x ? '  -- ' + x : ''}`);
  if (!c) fails.push(l);
};
const DT = 1 / 60;

class Wire {
  constructor() { this.nets = new Map(); this.names = new Map(); this.next = 1; this.order = []; this.host = null; }
  attach(net, name) {
    const id = this.next++;
    this.nets.set(id, net);
    this.names.set(id, name);
    net.attach({
      send: (o) => this.deliver(id, o),
      close: () => { this.order = this.order.filter((k) => k !== id); net.state = 'closed'; net.role = 'off'; },
    });
    return id;
  }
  deliver(fromId, o) {
    if (o.t === 'rooms') return;
    if (o.t === 'hello') {
      if (!this.order.includes(fromId)) this.order.push(fromId);
      this.names.set(fromId, o.name);
      const wants = o.want === 'host';
      const busy = wants && this.host != null && this.host !== fromId;
      if (!busy && (this.host == null || wants)) this.host = fromId;
      const others = this.order.filter((k) => k !== fromId);
      this.nets.get(fromId)._onMessage({
        t: 'joined', you: fromId, host: this.host === fromId, busy, room: o.room, name: o.name,
        peers: others.map((k) => ({ id: k, name: this.names.get(k), host: this.host === k })),
      });
      return;
    }
    if (o.t === 'ping') return;
    const { t, to, ...rest } = o;
    for (const [id, net] of this.nets) {
      if (id === fromId) continue;
      if (to != null && id !== to) continue;
      net._onMessage({ ...rest, from: fromId });
    }
  }
}

function fakeInput() {
  return {
    keys: new Set(), pressed: new Set(), released: new Set(), menuLock: false,
    mouse: { x: VW / 2, y: VH / 2, cx: 0, cy: 0, down: false, pressed: false, released: false, rdown: false },
    wheel: 0, anyInput: false, stick: { x: 0, y: 0 },
    isDown(...c) { return c.some((k) => this.keys.has(k)); },
    moveVector() {
      if (this.menuLock) return { x: 0, y: 0 };
      let x = 0, y = 0;
      if (this.isDown('KeyA')) x -= 1;
      if (this.isDown('KeyD')) x += 1;
      if (this.isDown('KeyW')) y -= 1;
      if (this.isDown('KeyS')) y += 1;
      if (x && y) { const k = Math.SQRT1_2; x *= k; y *= k; }
      const st = this.stick;
      if (st && (st.x || st.y)) { x += st.x; y += st.y; const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; } }
      return { x, y };
    },
    wasPressed(...c) { return c.some((k) => this.pressed.has(k)); },
    wasReleased(...c) { return c.some((k) => this.released.has(k)); },
    endFrame() { this.pressed.clear(); this.released.clear(); this.mouse.pressed = false; this.mouse.released = false; this.wheel = 0; },
  };
}

// step both, but report the first frame either side throws: that throw is the
// frozen picture the player sees
let thrown = null;
const step = (g, n, label) => {
  for (let i = 0; i < n; i++) {
    try { g.update(DT); } catch (e) { if (!thrown) thrown = `${label}: ${e.message}\n${(e.stack ?? '').split('\n')[1] ?? ''}`; }
    g.input.endFrame();
  }
};

const host = new Game(fakeInput());
const guest = new Game(fakeInput());
host.applySettings();
host.begin();
host.player.hurt = () => false;
host.startRound(6);
host.powerOn = true;
host.powerOnAt = host.time;
step(host, 120, 'host');

const wire = new Wire();
wire.attach(host.net, 'HOST');
wire.attach(guest.net, 'GUEST');
host.net.hostGame('WALK', 'HOST');
guest.net.joinGame('WALK', 'GUEST');
step(host, 30, 'host'); step(guest, 30, 'guest');

const mate = host.players.find((o) => o.name === 'GUEST');
ok(!!mate, 'the guest is in the room');
mate.hurt = () => false;
mate.points = 20000;

// ---------------------------------------------------------------------------
// 1. a guest that walks past every purchasable thing must see a prompt for it
// ---------------------------------------------------------------------------
console.log('--- prompts for a guest ---');
const seen = new Set();
const visit = (floor, x, y, want) => {
  mate.floor = floor;
  mate.pos.x = x; mate.pos.y = y;
  step(host, 4, 'host');
  // the guest's own body only learns where it is from snapshots, and then
  // interpolates there: wait for it to arrive, or the prompt is for where it
  // used to be
  for (let i = 0; i < 90; i++) {
    step(guest, 1, 'guest');
    if (Math.hypot(guest.player.pos.x - x, guest.player.pos.y - y) < 6) break;
  }
  const got = guest.interaction?.type ?? null;
  if (got) seen.add(got);
  ok(got === want, `guest at ${want} on floor ${floor} sees "${want}"`, got ?? 'nothing');
};
const F0 = host.map.floors[0];
const wb0 = F0.wallBuys[0];
visit(0, wb0.x, wb0.y, 'wallbuy');
const door0 = F0.doors.find((d) => !d.open) ?? F0.doors[0];
visit(0, door0.cx, door0.cy, 'door');
visit(0, F0.perkSpots[0].x, F0.perkSpots[0].y, 'perk');
visit(0, host.map.floors[0].grenadeCrates[0].x, host.map.floors[0].grenadeCrates[0].y, 'grenade');
visit(0, F0.barricades[0].cx, F0.barricades[0].cy, 'barricade');
visit(0, host.map.powerSwitch.x, host.map.powerSwitch.y, 'power');
visit(0, host.map.papSpot.x, host.map.papSpot.y, 'pap');
// the box wanders: stand where the host says it is, not where the guest thinks
const boxSpot = host.box.spot;
visit(host.map.floor, boxSpot.x, boxSpot.y, 'box');
const trap = host.traps.list[0];
visit(trap.floor ?? 0, trap.x, trap.y, 'trap');
visit(2, host.map.floors[2].workbench.x, host.map.floors[2].workbench.y, 'workbench');


// ---------------------------------------------------------------------------
// 2. the guest's hands: knife and grenades must reach the host
// ---------------------------------------------------------------------------
console.log('--- the guest\'s hands ---');
mate.floor = 0;
const zombie = host.zombies.find((z) => !z.dead) ?? host.makeZombie({ x: mate.pos.x + 18, y: mate.pos.y, floor: 0 }, 'walker');
if (!host.zombies.includes(zombie)) host.zombies.push(zombie);
// stand the body along its own aim line: the knife is an arc, and the aim a
// guest reports has nothing to do with wherever the harness teleports its
// body -- offset by a fixed +x and the swipe legitimately sails past
step(host, 2, 'host');                 // let mate.aim settle on the reported one
mate.pos.x = zombie.pos.x - Math.cos(mate.aim) * 16;
mate.pos.y = zombie.pos.y - Math.sin(mate.aim) * 16;
const hpBefore = zombie.hp;
guest.input.pressed.add('KeyV');
step(guest, 3, 'guest'); step(host, 6, 'host'); step(guest, 2, 'guest');
ok(zombie.hp < hpBefore || zombie.dead, 'the guest\'s knife reached the walker',
  `${hpBefore} -> ${zombie.hp}`);

mate.grenades = 2;
const nBefore = host.grenades.length;
guest.input.pressed.add('KeyG');
step(guest, 3, 'guest'); step(host, 6, 'host'); step(guest, 2, 'guest');
ok(host.grenades.length > nBefore, 'the guest\'s grenade reached the host',
  `${nBefore} -> ${host.grenades.length}`);
ok(mate.grenades === 1, 'and it came out of the guest\'s pocket', String(mate.grenades));

// ---------------------------------------------------------------------------
// 3. three minutes of a guest living in the house: nothing may throw
// ---------------------------------------------------------------------------
console.log('--- three minutes of guest frames ---');
const ctx = canvasStub(VW, VH).getContext('2d');
const t0 = Date.now();
for (let s = 0; s < 180; s++) {
  // wander the guest around everything, including the things that move
  const spots = [
    [0, F0.wallBuys[s % F0.wallBuys.length].x, F0.wallBuys[s % F0.wallBuys.length].y],
    [0, boxSpot.x + Math.sin(s) * 20, boxSpot.y + Math.cos(s) * 20],
    [1, host.map.floors[1].perkSpots[0]?.x ?? 20, host.map.floors[1].perkSpots[0]?.y ?? 20],
    [2, host.map.floors[2].workbench.x, host.map.floors[2].workbench.y],
  ][s % 4];
  mate.floor = spots[0]; mate.pos.x = spots[1]; mate.pos.y = spots[2];
  // and let the world do the things a guest only ever sees as snapshots
  if (s === 40) host.box.relocate?.();
  if (s === 80) { host.startRound(7); }
  if (s === 120) { host.powerOn = false; }
  if (s === 140) { host.powerOn = true; host.powerOnAt = host.time; }
  step(host, 30, 'host');
  step(guest, 30, 'guest');
  if (s % 30 === 0) {
    try { guest.draw(ctx); host.draw(ctx); } catch (e) { if (!thrown) thrown = `draw: ${e.message}\n${e.stack}`; }
  }
}
ok(thrown === null, `no frame threw in 180s of co-op (${Date.now() - t0}ms wall)`, thrown ?? '');

// the guest must still be alive and moving at the end
const x0 = mate.pos.x;
guest.input.stick.x = 1;
step(guest, 10); step(host, 40); step(guest, 10);
guest.input.stick.x = 0;
ok(Math.abs(mate.pos.x - x0) > 10 || thrown !== null, 'the guest still walks at the end',
  `${(mate.pos.x - x0).toFixed(1)}px`);

// ---------------------------------------------------------------- part 4 ----
// Every loose thing the host can put on screen, the guest must be able to
// draw. This is the freeze the real session hit: the relay carried grenades as
// {x,y} while the renderer wanted pos/rot/fuse, so the first grenade thrown by
// anybody killed the guest's frame loop -- picture frozen, keys dead, no
// prompts. Powerups, monkeys, fire, rifts and gas were the same bug waiting.
console.log('--- the host\'s clutter must not freeze the guest ---');
const px = host.player.pos.x, py = host.player.pos.y, pf = host.player.floor;
host.grenades.length = 0;
throwGrenade(host, px, py, 0.4);
throwGrenade(host, px + 40, py + 20, 1.1);
host.powerups.length = 0;
// away from the host's own feet, or he collects them before the snapshot goes out
const pu1 = new Powerup(px + 220, py, 'maxammo', pf); pu1.life = 12;
const pu2 = new Powerup(px + 250, py, 'nuke', pf); pu2.life = 9;
const junk = new Powerup(px + 260, py + 40, 'no_such_id', pf); junk.life = 10;
host.powerups.push(pu1, pu2, junk);   // a bad id must not take the frame loop with it
host.addFire(px - 60, py + 40, 90, 4);
host.rifts.push({ x: px + 80, y: py - 30, r: 70, dmg: 20, life: 6, max: 6, tick: 0, seed: 42, f: pf });
host.addGas(px - 30, py - 50, 100, 8);
host.monkeys.length = 0;
host.monkeys.push(new MonkeyBomb(px + 120, py + 60, 30, -20, WEAPONS.monkeybomb, pf));
mate.floor = pf; mate.pos.x = px + 10; mate.pos.y = py + 10;
// snapshots go out 20 times a second: two frames of host and two of guest is
// a phase lottery, not a sync. Step until the wire has actually delivered.
for (let i = 0; i < 40 && guest.grenades.length < 2; i++) { step(host, 1, 'host'); step(guest, 1, 'guest'); }
let clutterErr = '';
try { guest.draw(ctx); } catch (e) { clutterErr = `${e.message}\n${e.stack}`; }
ok(clutterErr === '', 'the guest drew grenades, powerups, fire, a rift, gas and a monkey', clutterErr);
ok(guest.grenades.length === 2, `the guest sees both grenades (${guest.grenades.length})`);
ok(guest.grenades.every((n) => n.pos && Number.isFinite(n.rot) && Number.isFinite(n.fuse)),
  'guest grenades carry the shape the renderer reads');
ok(guest.powerups.length === 2 && guest.powerups.every((q) => typeof q.draw === 'function' && q.life > 0),
  `guest powerups are drawable and have a life (${guest.powerups.length})`);
ok(!guest.powerups.some((q) => q.id === 'no_such_id'), 'an unknown powerup id is filtered, not drawn');
ok(guest.fires.length === 1 && guest.fires[0].life > 0, 'the guest sees the fire');
ok(guest.rifts.length === 1 && guest.rifts[0].max > 0, 'the guest sees the rift');
ok(guest.gases.length === 1 && guest.gases[0].drift !== undefined, 'the guest sees the gas');
ok(guest.monkeys.length === 1 && typeof guest.monkeys[0].draw === 'function',
  'the guest monkey is drawable');
// and it must keep drawing while all of it ages, expires and goes off
for (let i = 0; i < 240 && !clutterErr; i++) {
  step(host, 1, 'host'); step(guest, 1, 'guest');
  if (i % 40 === 0) { try { guest.draw(ctx); } catch (e) { clutterErr = `aged ${i}: ${e.message}\n${e.stack}`; } }
}
ok(clutterErr === '', 'the guest kept drawing while the clutter aged and went off', clutterErr);
ok(guest.grenades.every((n) => n.pos && Number.isFinite(n.fuse)), 'grenades stayed drawable to the end');

// ---------------------------------------------------------------------------
// 3. the roof offers, last: they change the round, so they must not disturb
//    the hand tests above
// ---------------------------------------------------------------------------
console.log('--- the roof offers ---');
visit(2, 40.5 * 24, 12.5 * 24, 'radio');
for (const sw of host.map.secretSwitches) sw.found = true;
host.egg.found = 4;
host.jumpToRound(25);
for (let i = 0; i < 5; i++) { step(host, 1, 'host'); step(guest, 1, 'guest'); }
visit(2, 18.5 * 24, 15.5 * 24, 'flare');
host.heli.phase = 3;
for (let i = 0; i < 30; i++) { step(host, 1, 'host'); step(guest, 1, 'guest'); }
visit(2, 18.5 * 24 + 8, 15.5 * 24, 'heli');

if (fails.length) {
  console.error(`\nGUESTWALK FAIL (${fails.length})`);
  for (const f of fails) console.error(' -', f);
  process.exit(1);
}
console.log(`\nGUESTWALK PASS  prompts seen: ${[...seen].sort().join(', ')}`);
