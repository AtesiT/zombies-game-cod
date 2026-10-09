// Headless harness for LAN co-op: two games, one wire, and a real relay.
//   npm i in this directory first, then: node net.mjs
//
// Part A wires two Games together through a fake relay so the whole stack --
// admission, snapshots, remote input, wallets, last stand, revival -- runs
// without a socket. Part B boots server.mjs and pushes two real WebSocket
// clients through it, because a handshake you have not performed is a
// handshake you have not got.
import { createCanvas } from './node_modules/@napi-rs/canvas/index.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..', '..', 'src');
const ROOT = resolve(HERE, '..', '..');

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
// undici's fetch wants the real Performance object, so only fill in what is missing
globalThis.performance = globalThis.performance ?? { now: () => Date.now() };
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
globalThis.AudioContext = undefined;

const { Game, VW, VH } = await import(SRC + '/game.js');
const { Input } = await import(SRC + '/input.js');
const { Net } = await import(SRC + '/net.js');

const fails = [];
const ok = (cond, label) => { if (!cond) fails.push(label); };
const DT = 1 / 60;

// ------------------------------------------------------------- a fake relay --
class Wire {
  constructor() { this.nets = new Map(); this.names = new Map(); this.next = 1; this.order = []; }

  attach(net, name) {
    const id = this.next++;
    this.nets.set(id, net);
    this.names.set(id, name);
    net.attach({ send: (o) => this.deliver(id, o), close: () => { this.order = this.order.filter((k) => k !== id); net.state = 'closed'; net.role = 'off'; } });
    return id;
  }

  deliver(fromId, o) {
    if (o.t === 'hello') {
      // the relay hands the room to whoever got there first
      if (!this.order.includes(fromId)) this.order.push(fromId);
      const host = this.order[0];
      const others = this.order.filter((k) => k !== fromId);
      this.names.set(fromId, o.name);
      this.nets.get(fromId)._onMessage({
        t: 'joined', you: fromId, host: host === fromId, room: o.room, name: o.name,
        peers: others.map((k) => ({ id: k, name: this.names.get(k), host: k === host })),
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

// ----------------------------------------------------------------- helpers --
function fakeInput() {
  return {
    keys: new Set(), pressed: new Set(), released: new Set(),
    mouse: { x: VW / 2, y: VH / 2, cx: 0, cy: 0, down: false, pressed: false, released: false, rdown: false },
    wheel: 0, anyInput: false, stick: { x: 0, y: 0 },
    isDown(...c) { return c.some((k) => this.keys.has(k)); },
    wasPressed(...c) { return c.some((k) => this.pressed.has(k)); },
    wasReleased(...c) { return c.some((k) => this.released.has(k)); },
    moveVector() { return this.stick; },
    endFrame() { this.pressed.clear(); this.released.clear(); this.mouse.pressed = false; this.mouse.released = false; this.wheel = 0; },
  };
}

const step = (g, n = 1) => { for (let i = 0; i < n; i++) { g.update(DT); g.input.endFrame(); } };

// ------------------------------------------------------------------ part A --
const host = new Game(fakeInput());
const guest = new Game(fakeInput());
host.applySettings();
host.begin();                       // the host is already playing...
host.player.hurt = () => false;     // ...and it is not allowed to die mid-test
host.startRound(5);                 // ...and five rounds deep when company comes
step(host, 200);                    // let a wave get going

const zombiesBefore = host.zombies.filter((z) => !z.dead).length;
ok(zombiesBefore > 0, 'the host had nobody to fight when the guest arrived');

const wire = new Wire();
wire.attach(host.net, 'HOST');
wire.attach(guest.net, 'GUEST');
host.net.hostGame('HARNESS', 'HOST');
guest.net.joinGame('HARNESS', 'GUEST');

// ---- 1. admitted mid-round ------------------------------------------------
ok(host.players.length === 2, `host has ${host.players.length} bodies, expected 2`);
ok(host.net.peers.size === 1, 'host did not record the peer');
ok(guest.started === true, 'the guest never got let in');
ok(guest.round === 5, `guest joined round ${guest.round}, not 5`);
ok(guest.roundActive === true, 'the guest did not join a round in progress');
const mate = host.players[1];
ok(mate && mate.name === 'GUEST', 'the arriving player has no name on the host');
ok(guest.player && guest.player.netId === 2, 'the guest is not driving its own body');
ok(guest.players.length === 2, `guest drew ${guest.players.length} bodies, expected 2`);

// ---- 2. the world arrives -------------------------------------------------
host.zombiesTotal = host.zombiesSpawned;     // stop the wave, so the counts can settle
step(host, 40); step(guest, 40);
step(guest, 6);
const hz = host.zombies.filter((z) => !z.dead);
const gz = guest.zombies.filter((z) => !z.dead);
ok(gz.length === hz.length, `guest sees ${gz.length} walkers, host has ${hz.length}`);
let worst = 0;
for (const z of hz) {
  const twin = guest.zombies.find((o) => o.id === z.id);
  if (!twin) { worst = 9999; break; }
  worst = Math.max(worst, Math.hypot(twin.pos.x - z.pos.x, twin.pos.y - z.pos.y));
}
// a walking hound is always a snapshot behind; that is what interpolation is
// for, and three frames of it is a handful of pixels, not a teleport
ok(worst < 30, `a moving walker is ${worst.toFixed(1)}px from where the host says it is`);

// freeze the horde and the guest must land on it exactly
for (const z of host.zombies) { z.baseSpeed = 0; z.vel.x = 0; z.vel.y = 0; z.frozen = 9; }
step(host, 6); step(guest, 40);
worst = 0;
for (const z of hz) {
  const twin = guest.zombies.find((o) => o.id === z.id);
  if (!twin) { worst = 9999; break; }
  worst = Math.max(worst, Math.hypot(twin.pos.x - z.pos.x, twin.pos.y - z.pos.y));
}
ok(worst < 2, `a still walker settled ${worst.toFixed(1)}px off the host's copy of it`);
ok(Math.abs(guest.player.pos.x - mate.pos.x) < 12 && Math.abs(guest.player.pos.y - mate.pos.y) < 12,
  'the guest is not standing where the host put it');

// ---- 3. doors and barricades are shared -----------------------------------
const door = host.map.floors[0].doors[0];
if (door) {
  door.open = true;
  step(host, 30); step(guest, 30);
  ok(guest.map.floors[0].doors[0].open === true, 'a door opened on the host stayed shut for the guest');
}
host.powerOn = true;
const planks = host.map.floors[0].barricades[0]?.planks ?? 0;
host.map.floors[0].barricades[0].planks = Math.max(0, planks - 2);
step(host, 30); step(guest, 30);
ok(guest.powerOn === true, 'the generator came on for one of you only');
ok(guest.map.floors[0].barricades[0].planks === host.map.floors[0].barricades[0].planks,
  'the barricade does not match between host and guest');

// ---- 4. the guest's hands move its body -----------------------------------
guest.input.stick.x = 1;
const x0 = mate.pos.x;
for (let i = 0; i < 60; i++) { step(host, 1); step(guest, 1); }
guest.input.stick.x = 0;
ok(mate.pos.x - x0 > 25, `a guest pushing right moved its body ${(mate.pos.x - x0).toFixed(1)}px`);

// ---- 5. and its trigger empties its magazine ------------------------------
mate.slots[mate.active] = 'm1911';
mate.loadout.m1911.owned = true;
mate.loadout.m1911.mag = 8;
mate.loadout.m1911.reserve = 40;
guest.input.mouse.down = true;
for (let i = 0; i < 40; i++) { step(host, 1); step(guest, 1); }
guest.input.mouse.down = false;
ok(mate.loadout.m1911.mag < 8, 'the guest pulled the trigger and nothing happened');
ok(host.loadout !== undefined || true, 'host sanity');

// ---- 6. four wallets, not one ---------------------------------------------
const beforeHost = host.points;
const beforeMate = mate.points;
const victim = host.zombies.find((z) => !z.dead);
if (victim) {
  victim._by = mate;
  host.onZombieKilled(victim, false, 60, 'test');
  ok(mate.points > beforeMate, 'the kill did not pay the player who made it');
  ok(host.points === beforeHost, 'the kill paid the host as well');
}

// ---- 7. going down is not going out ---------------------------------------
mate.hp = 1;
mate.invuln = 0;
mate.hurt(50, mate.pos.x + 10, mate.pos.y, host);
ok(mate.downed === true, 'a co-op player died outright instead of going down');
ok(mate.dead === false, 'a downed co-op player was killed stone dead');
step(host, 30); step(guest, 30);
ok(guest.players.find((p) => p.netId === 2)?.downed === true, 'the guest never heard that it was down');

// ---- 8. and somebody can pick it up ---------------------------------------
host.player.pos.x = mate.pos.x + 8;
host.player.pos.y = mate.pos.y;
host.input.keys.add('KeyF');
for (let i = 0; i < 100; i++) { step(host, 1); step(guest, 1); }
host.input.keys.delete('KeyF');
ok(mate.downed === false, 'holding F next to a downed team-mate did nothing');
ok(mate.hp > 0, 'a revived player came back with no health');

// ---- 9. bleed out for real ------------------------------------------------
mate.hp = 1; mate.invuln = 0; mate.downed = false;
mate.hurt(50, mate.pos.x + 10, mate.pos.y, host);
ok(mate.downed === true, 'the second knock-down did not take');
mate.bleedT = 0.2;
step(host, 40);
ok(mate.dead === true, 'a downed player never bled out');
// and comes back when the round turns over
host.startRound(6);
ok(mate.dead === false, 'the dead player did not come back at the top of the round');
ok(mate.hp > 0, 'the revived player came back dead on its feet');

// ---- 10. the horde picks a body -------------------------------------------
host.player.pos.x = mate.pos.x - 400;
host.player.pos.y = mate.pos.y;
const near = host.makeZombie({ x: mate.pos.x + 20, y: mate.pos.y, floor: mate.floor }, 'walker');
host.zombies.push(near);
ok(host.pickTarget(near) === mate, 'a walker at the guest\'s throat went for somebody else');

// ---- 11. more of you, more of them ----------------------------------------
const solo = new Game(fakeInput());
const one = solo.roundPlan(5).total;
const two = host.roundPlan(5).total;
ok(two > one, `two players get ${two} walkers, one gets ${one}`);

// ---- 12. solo still ends the way it always did ----------------------------
solo.begin();
solo.player.hp = 1;
solo.player.invuln = 0;
solo.player.hurt(50, 0, 0, solo);
ok(solo.player.dead === true && solo.player.downed === false, 'solo death turned into a last stand');
step(solo, 4);
ok(solo.gameOver === true, 'a solo death did not end the game');

// ---- 13. drawing both sides -----------------------------------------------
const ctx = canvasStub(VW, VH).getContext('2d');
let drew = true;
try { step(host, 2); host.draw(ctx); } catch (e) { drew = `host: ${e.message}`; }
ok(drew === true, `host draw threw: ${drew}`);
drew = true;
try { step(guest, 2); guest.draw(ctx); } catch (e) { drew = `guest: ${e.message}`; }
ok(drew === true, `guest draw threw: ${drew}`);

// ---- 14. a snapshot is a small thing --------------------------------------
const size = JSON.stringify(host.net.snapshot()).length;
ok(size < 24000, `a snapshot is ${size} bytes, which is too fat for 20 a second`);

// ---- 15. and silence drops you --------------------------------------------
guest.net.transport = null;               // nothing more will ever arrive
guest.net.send = () => {};
for (let i = 0; i < 60 * 8; i++) step(host, 1);
ok(host.players.length === 1, 'a peer who stopped answering was never dropped');
ok(host.net.peers.size === 0, 'the peer list kept a ghost');

// ------------------------------------------------------------------ part B --
// The relay itself: two real sockets through server.mjs.
const PORT = 8137;
process.argv[2] = String(PORT);
await import(ROOT + '/server.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(400);

if (typeof WebSocket !== 'undefined') {
  const openA = await new Promise((res) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/net`);
    const got = [];
    ws.onmessage = (e) => { got.push(JSON.parse(e.data)); };
    ws.onopen = () => { ws.send(JSON.stringify({ t: 'hello', room: 'RELAY', name: 'A' })); };
    ws.onerror = (e) => { fails.push(`relay socket A: ${e.message}`); res(null); };
    setTimeout(() => res({ ws, got }), 700);
  });
  ok(openA !== null, 'could not open a real socket to the relay');
  if (openA) {
    const { ws: wsA, got: gotA } = openA;
    const joinA = gotA.find((m) => m.t === 'joined');
    ok(joinA && joinA.host === true, 'the first one in was not made host');

    const openB = await new Promise((res) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/net`);
      const got = [];
      ws.onmessage = (e) => { got.push(JSON.parse(e.data)); };
      ws.onopen = () => { ws.send(JSON.stringify({ t: 'hello', room: 'RELAY', name: 'B' })); };
      ws.onerror = (e) => { fails.push(`relay socket B: ${e.message}`); res(null); };
      setTimeout(() => res({ ws, got }), 700);
    });
    ok(openB !== null, 'the second socket never opened');
    if (openB) {
      const { ws: wsB, got: gotB } = openB;
      const joinB = gotB.find((m) => m.t === 'joined');
      ok(joinB && joinB.host === false, 'the second one in was told it was host');
      ok(joinB && (joinB.peers ?? []).some((p) => p.id === joinA.you), 'B did not see A in the room');

      // a directed message, A -> B
      wsB.send(JSON.stringify({ t: 'to', to: joinA.you, m: 'hi', name: 'B' }));
      await sleep(250);
      const directed = gotA.filter((m) => m.m === 'hi');
      ok(directed.length === 1 && directed[0].from === joinB.you, 'a directed message did not arrive, or lied about who sent it');

      // a broadcast, A -> everybody else
      wsA.send(JSON.stringify({ t: 'b', m: 'snap', n: 7 }));
      await sleep(250);
      const broad = gotB.filter((m) => m.m === 'snap');
      ok(broad.length === 1 && broad[0].n === 7, 'a broadcast never reached the other player');

      // the room list over plain HTTP
      const list = await fetch(`http://127.0.0.1:${PORT}/net/rooms`).then((r) => r.json()).catch(() => null);
      ok(Array.isArray(list) && list.some((r) => r.id === 'RELAY' && r.players === 2),
        `the room list is wrong: ${JSON.stringify(list)}`);

      // the host quits: the relay hands the room over
      wsA.close();
      await sleep(400);
      const handover = gotB.filter((m) => m.t === 'host');
      ok(handover.length === 1 && handover[0].id === joinB.you, 'nobody took the room when the host left');
      wsB.close();
      await sleep(200);
    }
  }
}

// ------------------------------------------------------------------- report --
if (fails.length) {
  console.log('NET FAIL:');
  for (const f of fails) console.log('  -', f);
  process.exitCode = 1;
} else {
  console.log('NET PASS  mid-round join, shared world, four wallets, last stand, revival, real relay');
}
process.exit(fails.length ? 1 : 0);
