// Headless harness: the join watchdog.
//
// The real session: the guest sat on JOINING... forever because his 'hi' never
// reached the host (or the host's tab was asleep). There was no retry and no
// sentence -- just a spinner. Now: one retry at 2.5s, and at 9s the guest says
// HOST DID NOT LET YOU IN, closes the socket and the game bounces to the room
// list. This harness holds the wire closed on purpose and waits it out on real
// timers (~13s wall).
//
//   node joinwatch.mjs
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

let seed = 24680;
Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const { Game, VW, VH } = await import(SRC + '/game.js');

const fails = [];
const ok = (c, l, x = '') => {
  console.log(`${c ? ' ok ' : 'FAIL'}  ${l}${x ? '  -- ' + x : ''}`);
  if (!c) fails.push(l);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The relay from guestwalk, with a valve: dropHi swallows the guest's 'hi'. */
class Wire {
  constructor() { this.nets = new Map(); this.names = new Map(); this.next = 1; this.order = []; this.host = null; this.dropHi = false; this.hiCount = 0; this.dropWelcomeOnce = false; }
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
    if (o.m === 'hi') {
      this.hiCount++;
      if (this.dropHi) return;
    }
    if (o.m === 'welcome' && this.dropWelcomeOnce) { this.dropWelcomeOnce = false; return; }
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

const makePair = () => {
  const host = new Game(fakeInput());
  const guest = new Game(fakeInput());
  host.applySettings?.();
  guest.applySettings?.();
  host.begin();
  const wire = new Wire();
  wire.attach(host.net, 'HOST');
  wire.attach(guest.net, 'GUEST');
  return { host, guest, wire };
};

// ------------------------------------------------------- the valve is shut ----
console.log('--- a host that never answers ---');
{
  const { host, guest, wire } = makePair();
  wire.dropHi = true;
  host.net.hostGame('WATCH', 'HOST');
  guest.net.joinGame('WATCH', 'GUEST');
  guest.scene = 'waiting';   // what _joinRoom() does in the real flow
  for (let i = 0; i < 10; i++) { host.update(1 / 60); guest.update(1 / 60); }
  await sleep(2900);
  ok(wire.hiCount === 2, `the guest asked twice by 2.9s (${wire.hiCount})`);
  ok(guest.net.error === null && guest.net.state === 'open',
    'at 2.9s the guest is still waiting, not sentenced', String(guest.net.error ?? guest.net.state));
  await sleep(6600);   // ~9.5s since join
  ok(guest.net.error === 'HOST DID NOT LET YOU IN',
    'at 9s the guest says why', String(guest.net.error));
  ok(guest.net.state === 'closed', 'and hangs up', guest.net.state);
  // the game must show the sentence, not sit on a dead spinner
  for (let i = 0; i < 5; i++) guest.update(1 / 60);
  ok(guest.scene === 'rooms', `the guest is back at the room list (${guest.scene})`);
  ok(String(guest.netMsg ?? '').includes('HOST DID NOT LET YOU IN'),
    'the room list says what happened', String(guest.netMsg ?? ''));
  wire.dropHi = false;
}

// ------------------------------------------------------ the valve is open ----
console.log('--- a host that does answer ---');
{
  const { host, guest, wire } = makePair();
  host.net.hostGame('WATCH2', 'HOST');
  guest.net.joinGame('WATCH2', 'GUEST');
  guest.scene = 'waiting';
  for (let i = 0; i < 30; i++) { host.update(1 / 60); guest.update(1 / 60); }
  await sleep(150);
  ok(guest.net._welcomed === true, 'the welcome arrived at once');
  await sleep(3400);   // past the retry point, short of the sentence
  ok(wire.hiCount === 1, `a welcomed guest does not nag (${wire.hiCount} hi)`);
  ok(guest.net.error === null && guest.net.state === 'open',
    'and is never sentenced', String(guest.net.error ?? guest.net.state));
  ok(!!host.players.find((o) => o.name === 'GUEST'), 'the host has him in the room');
  ok(host.players.filter((o) => o.name === 'GUEST').length === 1, 'exactly one body for him');
}

// --------------------------------------------- the welcome is lost going out --
console.log('--- a welcome lost on the way out ---');
{
  const { host, guest, wire } = makePair();
  wire.dropWelcomeOnce = true;   // the host admits him, but the welcome never lands
  host.net.hostGame('WATCH3', 'HOST');
  guest.net.joinGame('WATCH3', 'GUEST');
  guest.scene = 'waiting';
  for (let i = 0; i < 30; i++) { host.update(1 / 60); guest.update(1 / 60); }
  await sleep(3200);             // the retry at 2.5s must be what gets him in
  ok(wire.hiCount === 2, `the guest asked again (${wire.hiCount} hi)`);
  ok(guest.net._welcomed === true, 'the retry got him in');
  ok(guest.net.error === null && guest.net.state === 'open', 'no sentence for a guest who is in');
  ok(host.players.filter((o) => o.name === 'GUEST').length === 1,
    'the re-welcome gave him one body, not two',
    String(host.players.filter((o) => o.name === 'GUEST').length));
  for (let i = 0; i < 30; i++) { host.update(1 / 60); guest.update(1 / 60); }
  ok(guest.net._welcomed === true && guest.net.state === 'open', 'and he stays in');
}

if (fails.length) {
  console.error(`\nJOINWATCH FAIL (${fails.length})`);
  for (const f of fails) console.error(' -', f);
  process.exit(1);
}
console.log('\nJOINWATCH PASS  one retry, then a sentence -- and a welcomed guest is left alone');
