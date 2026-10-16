// Headless harness: the bench in co-op.
//
// The workbench used to belong to the host and nobody else. A guest who
// climbed to the roof and pressed E was played a "no" sound, the menu flag
// lived on the game rather than on a body, and the only keys that built
// anything -- Digit3..Digit6 -- were not on the list a guest is allowed to
// send. So this file walks a guest up to the bench and makes it build
// something with its own money, then tries to lie to the host over the wire.
//
//   node craftnet.mjs
import { createCanvas } from './node_modules/@napi-rs/canvas/index.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..', '..', 'src');

// ---------------------------------------------------------------- fake DOM --
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

let seed = 90210;
Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const { Game, VW, VH } = await import(SRC + '/game.js');
const { Input } = await import(SRC + '/input.js');
const { RECIPES, SHELVED_RECIPES } = await import(SRC + '/crafting.js');

const fails = [];
const ok = (c, l, x = '') => {
  console.log(`${c ? ' ok ' : 'FAIL'}  ${l}${x ? '  -- ' + x : ''}`);
  if (!c) fails.push(l);
};
const DT = 1 / 60;

// ------------------------------------------------------------- a fake relay --
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
      if (this.isDown('KeyA', 'ArrowLeft')) x -= 1;
      if (this.isDown('KeyD', 'ArrowRight')) x += 1;
      if (this.isDown('KeyW', 'ArrowUp')) y -= 1;
      if (this.isDown('KeyS', 'ArrowDown')) y += 1;
      if (x && y) { const k = Math.SQRT1_2; x *= k; y *= k; }
      const st = this.stick;
      if (st && (st.x || st.y)) {
        x += st.x; y += st.y;
        const len = Math.hypot(x, y);
        if (len > 1) { x /= len; y /= len; }
      }
      return { x, y };
    },
    wasPressed(...c) { return c.some((k) => this.pressed.has(k)); },
    wasReleased(...c) { return c.some((k) => this.released.has(k)); },
    endFrame() { this.pressed.clear(); this.released.clear(); this.mouse.pressed = false; this.mouse.released = false; this.wheel = 0; },
  };
}
const step = (g, n = 1) => { for (let i = 0; i < n; i++) { g.update(DT); g.input.endFrame(); } };
const both = (n = 1) => { for (let i = 0; i < n; i++) { step(host, 1); step(guest, 1); } };

// ------------------------------------------------------------------ a room --
const host = new Game(fakeInput());
const guest = new Game(fakeInput());
host.applySettings();
host.begin();
host.player.hurt = () => false;
host.startRound(5);
step(host, 60);

const wire = new Wire();
wire.attach(host.net, 'HOST');
wire.attach(guest.net, 'GUEST');
host.net.hostGame('BENCH', 'HOST');
guest.net.joinGame('BENCH', 'GUEST');
both(20);

const mate = host.players.find((o) => o.name === 'GUEST');
ok(!!mate, 'the guest is in the room');
mate.hurt = () => false;

// The bench is on the roof, so put the guest's body up there. The host stays
// downstairs on purpose: the two of them are on different storeys, which is
// exactly the case the old single bench flag could not represent.
const roofBench = host.map.floors[2].workbench;
ok(!!roofBench, 'the roof has a bench on it');
mate.floor = 2;
mate.pos.x = roofBench.x;
mate.pos.y = roofBench.y + 10;
host.player.pos.x = host.map.playerStart.x;
host.player.pos.y = host.map.playerStart.y;
both(30);
ok(guest.player.floor === 2, 'the guest followed its body up to the roof', String(guest.player.floor));

// hang the shelf on the bench, in both worlds at once (one module, one table)
for (const [id, r] of Object.entries(SHELVED_RECIPES)) RECIPES[id] = r;

console.log('--- a guest can see and open the bench ---');
ok(guest.interaction?.type === 'workbench', 'the guest gets a prompt at the bench',
  guest.interaction?.type ?? 'nothing');
guest.input.pressed.add('KeyE');
step(guest, 1);
ok(guest.craftOpen === true, 'E opened the bench for the guest');
ok(host.craftOpen === false, '...and did not open the host\'s menu');
ok(mate.craftOpen === false, 'the host keeps no copy of a guest\'s menu to go stale');

console.log('--- and build with its own money ---');
mate.salvage = 30;
mate.points = 4000;
mate.medkits = 0;
const hostMedkits = host.player.medkits;
guest.input.pressed.add('Digit1');
step(guest, 1);
both(20);
ok(mate.medkits === 1, 'the host built the medkit for the guest', String(mate.medkits));
ok(mate.salvage === 22, `...and took it out of the guest's scrap (${mate.salvage})`);
ok(host.player.medkits === hostMedkits, 'the host did not get a medkit out of it');
ok(guest.player.medkits === 1, 'the snapshot carried the medkit back to the guest',
  String(guest.player.medkits));
ok(guest.player.salvage === mate.salvage, 'and the scrap it cost',
  `${guest.player.salvage} vs ${mate.salvage}`);

console.log('--- a tap on a card is not a trigger pull ---');
mate.slots[mate.active] = 'm1911';
mate.loadout.m1911.owned = true;
mate.loadout.m1911.mag = 8;
mate.loadout.m1911.reserve = 40;
guest.input.mouse.down = true;
guest.input.mouse.pressed = true;
guest.input.mouse.x = VW / 2;
guest.input.mouse.y = 200;
both(30);
guest.input.mouse.down = false;
guest.input.mouse.pressed = false;
ok(mate.loadout.m1911.mag === 8, 'the guest at the bench fired nothing',
  `${mate.loadout.m1911.mag}/8`);
ok(guest.craftOpen === true, 'and is still standing at the bench');

console.log('--- the wire is not a way in ---');
const sal = mate.salvage, pts = mate.points;
for (const bad of ['no_such_thing', '', '__proto__', 'constructor', 'toString', 'medkit;drop', 'x'.repeat(400)]) {
  guest.net.requestCraft(bad);
}
both(20);
ok(mate.salvage === sal && mate.points === pts, 'none of them moved any money',
  `${sal}->${mate.salvage}, ${pts}->${mate.points}`);
ok(Object.getPrototypeOf(mate.crafted) === Object.prototype,
  'a __proto__ id did not touch the crafted bag');
ok(mate.medkits === 1, 'and nobody got anything built', String(mate.medkits));

console.log('--- the host still has its own bench ---');
host.map.setFloor(2);
host.useFloor(2);
host.player.floor = 2;
host.player.pos.x = roofBench.x;
host.player.pos.y = roofBench.y - 10;
host.player.salvage = 40;
host.player.medkits = 0;
step(host, 3);
ok(host.interaction?.type === 'workbench', 'the host finds the bench too',
  host.interaction?.type ?? 'nothing');
host.input.pressed.add('KeyE');
step(host, 1);
ok(host.craftOpen === true, 'the host opened its own menu');
ok(guest.craftOpen === true && mate.craftOpen === false,
  'two menus, two bodies, no shared flag');
host.input.pressed.add('Digit1');
step(host, 1);
ok(host.player.medkits === 1, 'and built itself a medkit', String(host.player.medkits));
ok(mate.medkits === 1, 'without touching the guest\'s', String(mate.medkits));

// the host closing its menu must not close the guest's
host.input.pressed.add('KeyE');
step(host, 1);
ok(host.craftOpen === false, 'the host stepped away');
step(guest, 1);
ok(guest.craftOpen === true, 'the guest is still at the bench');

console.log('--- and a guest can step away ---');
guest.input.pressed.add('KeyE');
step(guest, 1);
ok(guest.craftOpen === false, 'E closed the guest\'s menu');
mate.pos.x += 400;
guest.input.pressed.add('KeyE');
step(guest, 1);
both(10);
ok(guest.craftOpen === false, 'walking off the bench leaves it shut');

console.log('--- both sides still draw ---');
const ctx = canvasStub(VW, VH).getContext('2d');
guest.player.craftOpen = true;
let drew = true;
try { step(guest, 2); guest.draw(ctx); } catch (e) { drew = `guest: ${e.message}`; }
ok(drew === true, `the guest's bench menu threw: ${drew}`);
drew = true;
try { step(host, 2); host.draw(ctx); } catch (e) { drew = `host: ${e.message}`; }
ok(drew === true, `the host threw: ${drew}`);

for (const id of Object.keys(RECIPES)) delete RECIPES[id];

if (fails.length) {
  console.error(`\nCRAFTNET FAIL (${fails.length})`);
  for (const f of fails) console.error(' -', f);
  process.exit(1);
}
console.log('\nCRAFTNET PASS  a guest sees the bench, opens it, builds with its own scrap, and the wire refuses junk');
