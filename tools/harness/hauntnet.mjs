// Headless harness: the haunt round in co-op.
//
// Totems, graves, thrown bottles, lightning bolts and the weather all live on
// the host -- but the guest has to SEE and HEAR them, drawn from real class
// instances rebuilt out of the snapshot. The frozen-picture class of bug is
// exactly this: a plain {x,y} object where the renderer expects a body with
// draw() on it. So this harness walks both machines frame by frame and then
// points a real canvas context at the guest's picture.
//
//   node hauntnet.mjs
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
  createElement: (t) => (t === 'canvas' ? canvasStub(300, 150) : { style: {}, appendChild() {}, addEventListener() {} }),
  getElementById: () => canvasStub(800, 500),
  body: { appendChild() {} },
};
globalThis.performance = globalThis.performance ?? { now: () => Date.now() };
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
globalThis.AudioContext = undefined;

let seed = 97531;
Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const { Game, VW, VH } = await import(SRC + '/game.js');
const { settings } = await import(SRC + '/settings.js');

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
    moveVector() { return { x: 0, y: 0 }; },
    wasPressed(...c) { return c.some((k) => this.pressed.has(k)); },
    wasReleased(...c) { return c.some((k) => this.released.has(k)); },
    endFrame() { this.pressed.clear(); this.released.clear(); this.mouse.pressed = false; this.mouse.released = false; this.wheel = 0; },
  };
}

let thrown = null;
const stepBoth = (n, label = '') => {
  for (let i = 0; i < n; i++) {
    try { host.update(DT); } catch (e) { if (!thrown) thrown = `host ${label}: ${e.message}\n${(e.stack ?? '').split('\n')[1] ?? ''}`; }
    host.input.endFrame();
    try { guest.update(DT); } catch (e) { if (!thrown) thrown = `guest ${label}: ${e.message}\n${(e.stack ?? '').split('\n')[1] ?? ''}`; }
    guest.input.endFrame();
  }
};

const host = new Game(fakeInput());
const guest = new Game(fakeInput());
host.applySettings();
guest.applySettings();
settings.set('weather', true);
host.begin();
host.player.hurt = () => true;
host.scorchPlayer = () => {};
host.powerOn = true;
host.powerOnAt = host.time;

const wire = new Wire();
wire.attach(host.net, 'HOST');
wire.attach(guest.net, 'GUEST');
host.net.hostGame('HAUNT', 'HOST');
guest.net.joinGame('HAUNT', 'GUEST');
stepBoth(60, 'join');

const mate = host.players.find((o) => o.name === 'GUEST');
ok(!!mate, 'the guest is in the room');
ok(guest.net.playing && host.net.playing, 'both machines are playing');
mate.hurt = () => true;
mate.points = 20000;

// ---------------------------------------------------------------------------
console.log('--- the storm is the same storm on both screens ---');
host.jumpToRound(16);
host.setWeatherKind('storm');
stepBoth(30, 'storm sync');
ok(guest.wx.kind === 'storm', 'guest stands in the storm too', `kind=${guest.wx.kind}`);
ok(Array.isArray(guest.wx.drops) && guest.wx.drops.length === 110, 'guest grew its own rain', `n=${guest.wx.drops?.length}`);
stepBoth(600, 'storm run');
ok(guest.wx.wet > 0.3, 'the guest glass fogs up as well', `wet=${guest.wx.wet.toFixed(2)}`);

// ---------------------------------------------------------------------------
console.log('--- the totem crosses the wire as a real Totem ---');
{
  const bear = host.makeZombie({ x: host.player.pos.x + 240, y: host.player.pos.y + 110, floor: 0 }, 'bearer');
  bear.placeT = 0.3;
  host.zombies.push(bear);
  let placed = false;
  for (let i = 0; i < 60 * 10 && !placed; i++) { stepBoth(1, 'bearer'); placed = host.totems.length > 0; }
  ok(placed, 'host: the bearer knelt');
  stepBoth(20, 'totem sync');
  ok(guest.totems.length === 1, 'guest sees the totem', `n=${guest.totems.length}`);
  const gt = guest.totems[0], ht = host.totems[0];
  ok(gt && typeof gt.draw === 'function' && typeof gt.hurt === 'function',
     'and it is a real Totem, draw() and all');
  ok(gt && gt.uid === ht.uid, 'same totem, same uid', `${gt?.uid}/${ht.uid}`);
  ok(gt && Math.abs(gt.life - ht.life) < 1.2, 'guest does not age it twice', `host ${ht.life.toFixed(1)} guest ${gt?.life?.toFixed(1)}`);
  ok(guest.totemPower, 'the dusk weighs on the guest picture too');

  // the guest draws it without a single frame of trouble
  const gctx = canvasStub(800, 500).getContext('2d');
  let drew = null;
  try { guest.draw(gctx); } catch (e) { drew = `${e.message}\n${(e.stack ?? '').split('\n')[1] ?? ''}`; }
  ok(!drew, 'guest.draw() survives the totem, the storm and the dusk', drew ?? '');

  // host shoots it down: the guest watches it go. First retire every bearer
  // on the map -- round sixteen rolls its own, and a fresh kneeler would
  // legitimately raise a NEW totem the instant the old one dies
  for (const z of host.zombies) if (z.def.places === 'totem') { z.dead = true; z.remove = true; }
  stepBoth(4, 'retire bearers');
  ht.hurt(9999, host);
  ok(ht.dead, 'host: the killing blow registered');
  stepBoth(30, 'totem down');
  ok(host.totems.length === 0, 'host: totem gone', thrown ? `thrown: ${thrown}` :
     `n=${host.totems.length} dead=${ht.dead} same=${host.totems[0] === ht} uid=${host.totems[0]?.uid} life=${host.totems[0]?.life?.toFixed?.(1)} hp=${host.totems[0]?.hp}`);
  ok(guest.totems.length === 0, 'guest: totem gone with it');
  ok(!guest.totemPower, 'and the guest dusk lifts');
}

// ---------------------------------------------------------------------------
console.log('--- the grave and its bells ---');
{
  const mourn = host.makeZombie({ x: host.player.pos.x + 230, y: host.player.pos.y - 120, floor: 0 }, 'mourner');
  mourn.placeT = 0.3;
  host.zombies.push(mourn);
  let placed = false;
  for (let i = 0; i < 60 * 10 && !placed; i++) { stepBoth(1, 'mourner'); placed = host.graves.length > 0; }
  ok(placed, 'host: the mourner dug');
  stepBoth(20, 'grave sync');
  ok(guest.graves.length === 1, 'guest sees the grave', `n=${guest.graves.length}`);
  const gg = guest.graves[0];
  ok(gg && typeof gg.draw === 'function' && typeof gg.hurt === 'function', 'a real Grave on the guest');
  ok(gg && gg.uid === host.graves[0].uid, 'same grave, same uid');

  // the guest's copy of the bell follows the synced timer (the instance is
  // rebuilt every snapshot, so sample the list, not a captured reference)
  let rang = false;
  for (let i = 0; i < 60 * 14 && !rang; i++) { stepBoth(1, 'bells'); if ((guest.graves[0]?.ring ?? 0) > 0) rang = true; }
  ok(rang, 'the guest hears its own bell on time');

  // a wraith the host lets out arrives as a wraith, summoned and all
  let hw = null;
  for (let i = 0; i < 60 * 14 && !hw; i++) { stepBoth(1, 'wraith'); hw = host.zombies.find((z) => z.type === 'wraith' && !z.dead) ?? null; }
  ok(!!hw, 'host: the grave let a wraith out');
  if (hw) {
    let gw = null;
    for (let i = 0; i < 60 * 4 && !gw; i++) { stepBoth(1, 'wraith sync'); gw = guest.zombies.find((z) => z.type === 'wraith') ?? null; }
    ok(!!gw, 'guest: the wraith crossed the wire');
    ok(gw && gw.summoned === true, 'still marked summoned, so the round tally stays honest');
  }

  // breaking the grave on the host takes the guest copy with it
  host.graves[0].hurt(9999, host);
  stepBoth(30, 'grave down');
  ok(host.graves.length === 0 && guest.graves.length === 0, 'the grave is gone on both screens');
}

// ---------------------------------------------------------------------------
console.log('--- throws, bolts, chill and stun cross the wire ---');
{
  // a snowman on the host lobs at the host player; the guest must see the arc
  const snow = host.makeZombie({ x: host.player.pos.x + 240, y: host.player.pos.y + 90, floor: 0 }, 'snowman');
  snow.throwCd = 0.2;
  host.zombies.push(snow);
  let saw = false;
  for (let i = 0; i < 60 * 6 && !saw; i++) { stepBoth(1, 'snow throw'); saw = host.zThrows.length > 0; }
  ok(saw, 'host: the snowman threw');
  if (saw) {
    let gsaw = false;
    for (let i = 0; i < 20 && !gsaw; i++) { stepBoth(1, 'throw sync'); gsaw = guest.zThrows.some((t) => typeof t.draw === 'function' && t.throwKind === 'snow'); }
    ok(gsaw, 'guest: a real ZThrow in the air', `n=${guest.zThrows.length}`);
  }
  // retire the throwers before watching the sky empty -- the snowman reloads
  // every few seconds and would legitimately put another ball in the air
  for (const z of host.zombies) if (z.def.throws) { z.dead = true; z.remove = true; }
  stepBoth(150, 'throws land');
  ok(guest.zThrows.length === 0 && host.zThrows.length === 0, 'both skies are empty again',
     `host=${host.zThrows.map((t) => `${t.throwKind} t=${t.t.toFixed(2)}/${t.dur.toFixed(2)} dead=${t.dead}`).join(';')} guest=${guest.zThrows.length}`);

  // the shocker zaps the GUEST body on the host; the guest must feel it.
  // Walk a circle for a spot with real line of sight -- walls eat bolts, and
  // that is the rule, not the test
  mate.pos.x = host.player.pos.x + 60; mate.pos.y = host.player.pos.y; mate.floor = 0;
  let sh = null;
  for (let a = 0; a < 16 && !sh; a++) {
    const ang = (a / 16) * Math.PI * 2;
    const cand = host.makeZombie({ x: mate.pos.x + Math.cos(ang) * 110, y: mate.pos.y + Math.sin(ang) * 110, floor: 0 }, 'shocker');
    if (!host.map.rayWall(cand.pos.x, cand.pos.y - 12, mate.pos.x, mate.pos.y - 6)) sh = cand;
  }
  ok(!!sh, 'found a line of sight for the shocker');
  host.zombies.push(sh);
  host.zapPlayer(sh, mate);
  ok(host.bolts.length > 0, 'host: the bolt is drawn');
  ok(mate.stunT > 0.4, 'host: the guest body is stunned', `stunT=${mate.stunT?.toFixed(2)}`);
  stepBoth(6, 'bolt sync');
  ok(guest.bolts.length > 0, 'guest: the bolt lights up over there too', `n=${guest.bolts.length}`);
  ok(Number(guest.player.stunT) > 0.3, 'guest: and its hands stop working', `stunT=${guest.player.stunT}`);
  stepBoth(90, 'stun fade');
  ok(Number(guest.player.stunT) <= 0.001, 'the stun shakes off on the guest');

  // chill rides the same tuple
  mate.chillT = 2.5;
  stepBoth(6, 'chill sync');
  ok(Number(guest.player.chillT) > 1.5, 'guest: the snow chill arrives', `chillT=${guest.player.chillT}`);
}

// ---------------------------------------------------------------------------
console.log('--- the guest picture holds together ---');
{
  const gctx = canvasStub(800, 500).getContext('2d');
  host.setWeatherKind('fog');
  stepBoth(30, 'fog sync');
  ok(guest.wx.kind === 'fog', 'fog drifts over to the guest');
  let drew = null;
  try { guest.draw(gctx); } catch (e) { drew = e.message; }
  ok(!drew, 'guest.draw() survives the fog', drew ?? '');
  host.setWeatherKind(null);
  stepBoth(30, 'clear');
  try { guest.draw(gctx); drew = null; } catch (e) { drew = e.message; }
  ok(!drew, 'guest.draw() survives the clearing', drew ?? '');
}

// ---------------------------------------------------------------------------
console.log(thrown ? `FAIL  a frame threw: ${thrown}` : ' ok  neither machine ever threw');
if (thrown) fails.push('a frame threw');
console.log(fails.length ? `\n${fails.length} FAILURES:\n  ${fails.join('\n  ')}` : '\nall clear');
process.exit(fails.length ? 1 : 0);
