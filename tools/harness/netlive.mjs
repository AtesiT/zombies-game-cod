// The real thing: two Games, two live WebSockets, one real server.mjs.
//
// net.mjs wires two Games to a fake relay, which proves the protocol but not
// the wire -- frame sizes, masking, ordering and timing are all the fake's
// invention. This harness walks the path a phone and a laptop actually take,
// so a guest that joins and then freezes shows up here or nowhere.
import { createCanvas } from './node_modules/@napi-rs/canvas/index.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..', '..', 'src');
const ROOT = resolve(HERE, '..', '..');
const PORT = 8139;

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

const { Game } = await import(SRC + '/game.js');

// -------------------------------------------------------------- the relay ---
process.argv[2] = String(PORT);
await import(ROOT + '/server.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(400);

const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };
const DT = 1 / 60;

function fakeInput() {
  return {
    keys: new Set(), pressed: new Set(), released: new Set(),
    mouse: { x: 400, y: 250, cx: 0, cy: 0, down: false, pressed: false, released: false, rdown: false },
    wheel: 0, anyInput: false, stick: { x: 0, y: 0 },
    isDown(...c) { return c.some((k) => this.keys.has(k)); },
    wasPressed(...c) { return c.some((k) => this.pressed.has(k)); },
    wasReleased(...c) { return c.some((k) => this.released.has(k)); },
    moveVector() {
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
    endFrame() { this.pressed.clear(); this.released.clear(); this.mouse.pressed = false; this.mouse.released = false; this.wheel = 0; },
  };
}

/** Hang a Game's Net off a real WebSocket instead of the browser's. */
async function connect(game, name, room, want) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/net`);
  const sizes = [];
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = (e) => rej(new Error(`socket ${name}: ${e.message ?? 'error'}`));
    setTimeout(() => rej(new Error(`socket ${name} never opened`)), 3000);
  });
  ws.onmessage = (e) => {
    const raw = typeof e.data === 'string' ? e.data : String(e.data);
    sizes.push(raw.length);
    let m = null;
    try { m = JSON.parse(raw); } catch { return; }
    game.net._onMessage(m);
  };
  game.net._attach({ send: (o) => ws.send(JSON.stringify(o)), close: () => ws.close() });
  game.net.room = room;
  game.net.name = name;
  if (want === 'host') game.net.hostGame(room, name);
  else game.net.joinGame(room, name);
  return { ws, sizes };
}

// ------------------------------------------------------------------ set up --
const host = new Game(fakeInput());
const guest = new Game(fakeInput());
host.applySettings();
guest.applySettings();
host.begin();
host.player.hurt = () => false;
host.startRound(4);
for (let i = 0; i < 120; i++) { host.update(DT); host.input.endFrame(); }

const linked = [];
try {
  linked.push(await connect(host, 'PHONE', 'LIVE', 'host'));
} catch (e) { fails.push(e.message); }
ok(linked.length === 1, 'the host could not open a socket to the relay');

for (let i = 0; i < 10; i++) { host.update(DT); host.input.endFrame(); }
await sleep(200);

try {
  linked.push(await connect(guest, 'DESKTOP', 'LIVE', 'join'));
} catch (e) { fails.push(e.message); }
ok(linked.length === 2, 'the guest could not open a socket to the relay');

// ------------------------------------------------------------------- run ----
// interleaved with real waiting: the sockets only flush when time passes
const tick = async (n, ms = 4) => {
  for (let i = 0; i < n; i++) {
    host.update(DT); host.input.endFrame();
    guest.update(DT); guest.input.endFrame();
    await sleep(ms);
  }
};

await tick(30);
ok(host.players.length === 2, `the host sees ${host.players.length} players, not 2`);
ok(guest.started === true, 'the guest never got into the game');
ok(guest.players.length === 2, `the guest drew ${guest.players.length} bodies, not 2`);

// ---- the world on the guest's screen has to keep moving ---------------------
// a frozen picture is the bug: the first snapshot lands and nothing after it
const gz0 = guest.zombies.filter((z) => !z.dead).map((z) => ({ id: z.id, x: z.pos.x, y: z.pos.y }));
const mate = host.players[1];
const px0 = mate ? { x: mate.pos.x, y: mate.pos.y } : null;
await tick(150);                    // two and a half seconds of real co-op
const gz1 = guest.zombies.filter((z) => !z.dead).map((z) => ({ id: z.id, x: z.pos.x, y: z.pos.y }));

let moved = 0;
for (const a of gz0) {
  const b = gz1.find((z) => z.id === a.id);
  if (b && Math.hypot(b.x - a.x, b.y - a.y) > 4) moved++;
}
ok(gz0.length > 0, 'the host has no walkers to watch');
ok(moved > 0, `nothing moved on the guest's screen: ${gz0.length} walkers, ${moved} of them shifted`);

const hz = host.zombies.filter((z) => !z.dead);
ok(Math.abs(guest.zombies.filter((z) => !z.dead).length - hz.length) <= 2,
  `the guest sees ${guest.zombies.filter((z) => !z.dead).length} walkers, the host has ${hz.length}`);

// ---- the guest's hands have to reach the host -------------------------------
if (mate && px0) {
  guest.input.keys.add('KeyD');
  await tick(90);
  guest.input.keys.delete('KeyD');
  const walked = Math.hypot(mate.pos.x - px0.x, mate.pos.y - px0.y);
  ok(walked > 12, `a keyboard guest moved its body ${walked.toFixed(1)}px over the real wire`);

  // and the body the guest is driving has to be where the host put it
  const gp = guest.player;
  const off = gp ? Math.hypot(gp.pos.x - mate.pos.x, gp.pos.y - mate.pos.y) : 9999;
  ok(off < 24, `the guest's own body is ${off.toFixed(1)}px from where the host says it is`);
}

// ---- sizes on the wire, for the record --------------------------------------
const biggest = Math.max(0, ...linked.flatMap((l) => l.sizes));
ok(biggest > 0, 'not one byte came back from the relay');

for (const l of linked) l.ws.close();
await sleep(200);

if (fails.length) {
  console.log('NETLIVE FAIL:');
  for (const f of fails) console.log('  -', f);
  process.exitCode = 1;
} else {
  console.log(`NETLIVE PASS  two games over a real relay: the guest's world moves, its hands reach the host (biggest frame ${(biggest / 1024).toFixed(1)} kB)`);
}
process.exit(fails.length ? 1 : 0);
