import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nc, load } from './stub.mjs';
const M = await load();
const { Settings } = await import('../../src/settings.js');
const { RemoteInput, Net } = await import('../../src/net.js');
const { loadBoard, submitScore } = await import('../../src/achievements.js');
const { Player, MonkeyBomb, ZSTATE } = await import('../../src/entities.js');
const { Powerup } = await import('../../src/powerups.js');
const fresh = () => { const g = new M.Game(new M.Input(nc(800, 500))); g.begin(); return g; };

test('network input fuzz cannot throw, introduce NaN, or invent keys', () => {
  const inp = new RemoteInput();
  const values = [null, undefined, false, '', 'oops', [], {}, 1e300, NaN, Infinity, -Infinity];
  for (const v of values) {
    assert.doesNotThrow(() => inp.apply({ mx: v, my: v, a: v, k: v, kp: v, w: v }));
    const mv = inp.moveVector();
    assert.ok(Number.isFinite(mv.x) && Number.isFinite(mv.y) && Math.hypot(mv.x, mv.y) <= 1.000001);
    assert.ok(Number.isFinite(inp.aim) && Math.abs(inp.aim) <= Math.PI * 2);
    inp.endFrame();
  }
  inp.apply({ k: ['KeyR', 'KeyA', '__proto__'], kp: ['KeyG', 'Escape'], mx: 9, my: 9 });
  assert.deepEqual([...inp.keys], ['KeyR']);
  assert.ok(inp.wasPressed('KeyG') && !inp.wasPressed('Escape'));
});

test('settings ignore invalid types, retain defaults and normalize enum indices', () => {
  localStorage.setItem('ndu.settings.v1', JSON.stringify({ lighting: 0.5, touchSize: 1.5, dlss: 'false', music: 'broken' }));
  const s = new Settings();
  assert.equal(s.get('lighting'), 1);
  assert.equal(s.get('touchSize'), 2);
  assert.equal(s.get('dlss'), false);
  assert.equal(s.get('music'), 70);
  for (const v of [NaN, Infinity, -Infinity, null, {}, 'bad']) s.set('lighting', v);
  assert.equal(s.get('lighting'), 1);
  s.set('lighting', -9); assert.equal(s.get('lighting'), 0);
  s.set('lighting', 9); assert.equal(s.get('lighting'), 2);
  localStorage.removeItem('ndu.settings.v1');
});

test('malformed leaderboard cannot crash submission or poison best score', () => {
  const valid = { round: 3, kills: 20, headshots: 5, points: 100, time: 40, date: 123 };
  localStorage.setItem('ndu.leaderboard.v1', JSON.stringify([null, {}, 'bad', { ...valid, round: '99' }, valid]));
  assert.deepEqual(loadBoard(), [{ ...valid, evac: false }]);
  assert.doesNotThrow(() => submitScore({ ...valid, round: 5 }));
  assert.equal(loadBoard()[0].round, 5);
  localStorage.removeItem('ndu.leaderboard.v1');
});

test('blur clears every held and edge input; zero-sized canvas does not poison aim', () => {
  const listeners = {};
  const old = window.addEventListener;
  window.addEventListener = (id, fn) => { listeners[id] = fn; };
  try {
    const c = nc(800, 500), input = new M.Input(c);
    input.keys.add('KeyW'); input.pressed.add('KeyG'); input.released.add('KeyF');
    Object.assign(input.mouse, { down: true, rdown: true, pressed: true });
    input.stick.x = 1; input.wheel = 2;
    listeners.blur();
    assert.equal(input.keys.size + input.pressed.size + input.released.size, 0);
    assert.equal(input.mouse.rdown, false); assert.equal(input.mouse.pressed, false);
    assert.equal(input.stick.x, 0); assert.equal(input.wheel, 0);
    c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 });
    listeners.mousemove({ clientX: 4, clientY: 5 });
    assert.ok(Number.isFinite(input.mouse.x));
  } finally { window.addEventListener = old; }
});

test('late transport events cannot reopen or close a replacement connection', () => {
  const old = globalThis.WebSocket;
  const sockets = [];
  class FakeWS { constructor() { sockets.push(this); } send() {} close() { this.closed = true; } }
  globalThis.WebSocket = FakeWS;
  const n = new Net(null);
  try {
    n.open('ws://test');
    const first = sockets[0], lateOpen = first.onopen, lateClose = first.onclose;
    n.open('ws://test');
    assert.ok(first.closed);
    sockets[1].onopen();
    lateOpen(); lateClose();
    assert.equal(n.state, 'open');
    assert.equal(n._ws, sockets[1]);
    const late = sockets[1].onopen;
    n.close(); late();
    assert.equal(n.state, 'closed'); assert.equal(n.transport, null);
    assert.equal(n._ping?._destroyed, true);
  } finally { n.close(); globalThis.WebSocket = old; }
});

test('host-only messages from other guests and peer control frames are ignored', () => {
  const n = new Net({}); n.hostId = 1; n.role = 'guest'; n.state = 'open';
  n._onMessage({ from: 2, m: 'full' });
  n._onMessage({ from: 2, m: 'hostis', host: 2 });
  n._onMessage({ from: 2, t: 'host', id: 2 });
  assert.equal(n.hostId, 1); assert.equal(n.state, 'open');
  n._onMessage({ from: 1, m: 'full' });
  assert.equal(n.state, 'closed'); assert.equal(n.error, 'ROOM FULL');
});

test('fire and gas respect hazard floor and affect guests, not host duplicates below', () => {
  for (const kind of ['fire', 'gas']) {
    const g = fresh();
    g.roundActive = false; g.intermission = 999; g.zombiesSpawned = g.zombiesTotal;
    const { x, y } = g.player.pos;
    g.player.invuln = 0;
    const guest = new Player(g.map, x, y); guest.floor = 1; guest.game = g;
    g.players.push(guest);
    const zombie = (floor) => { const z = g.makeZombie({ x: x + 5, y }, 'walker'); z.floor = floor; z.update = () => {}; return z; };
    const below = zombie(0), above = zombie(1); g.zombies.push(below, above);
    g._fxOn({ floor: 1 });
    if (kind === 'fire') g.addFire(x, y, 40, 10); else { g.addGas(x, y, 40, 10); g.gases[0].owner = guest; }
    const h0 = g.player.hp, gh0 = guest.hp, b0 = below.hp, a0 = above.hp;
    for (let i = 0; i < 40; i++) { g.update(1 / 60); g.input.endFrame(); }
    assert.equal(g.player.hp, h0, `${kind} should not reach floor 0`);
    assert.ok(guest.hp < gh0, `${kind} should hurt guest on floor 1`);
    assert.equal(below.hp, b0, `${kind} should not hurt floor 0 zombie`);
    assert.ok(above.hp < a0, `${kind} should hurt floor 1 zombie`);
    assert.equal(g.inFire + g.inGas, 0);
  }
});

test('revives require same floor and switching patient restarts remote progress', () => {
  const g = fresh(); const p = g.player;
  const a = new Player(g.map, p.pos.x + 10, p.pos.y); a.downed = true; a.floor = 1;
  const b = new Player(g.map, p.pos.x + 15, p.pos.y); b.downed = true; b.floor = 0;
  g.players.push(a, b);
  g.revive(a, p); assert.ok(a.downed);
  const input = new RemoteInput(); input.keys.add('KeyF');
  const peer = { player: p, input, reviveT: 9, reviveTarget: a };
  g.net._remoteInteract(peer, 0.1);
  assert.ok(b.downed); assert.ok(peer.reviveT < 0.2);
  peer.reviveT = 10; g.net._remoteInteract(peer, 0.1); assert.equal(b.downed, false);
});

test('monkey blast and collision use explosive floor, not host view floor', () => {
  const g = fresh(); const { x, y } = g.player.pos;
  const below = g.makeZombie({ x, y }, 'walker'); below.floor = 0;
  const above = g.makeZombie({ x, y }, 'walker'); above.floor = 1;
  g.zombies.push(below, above);
  const hp = below.hp, ph = g.player.hp;
  g.tryCrawl = () => { throw new Error('must check floor before crawling'); };
  g.explodeAt(x, y, 100, 1, { floor: 1, blast: false });
  assert.equal(below.hp, hp); assert.equal(g.player.hp, ph); assert.ok(above.hp < above.maxHp);
  above.dead = true;
  assert.doesNotThrow(() => g.explodeAt(x, y, 100, 1, { floor: 1, blast: true }));
  const monkey = new MonkeyBomb(x, y, 1, 1, M.WEAPONS.monkeybomb, 1);
  g.map.solidAt = () => { throw new Error('host floor collision used'); };
  assert.doesNotThrow(() => monkey.update(1 / 60, g));
});

test('hitscan, shockwave, frost and melee only hit the attacker floor', () => {
  for (const attack of ['hitscan', 'shock', 'freeze', 'knife']) {
    const g = fresh();
    const p = new Player(g.map, g.player.pos.x, g.player.pos.y); p.floor = 1; p.aim = 0;
    const below = g.makeZombie({ x: p.pos.x + 25, y: p.pos.y }, 'walker'); below.floor = 0;
    const above = g.makeZombie({ x: p.pos.x + 25, y: p.pos.y }, 'walker'); above.floor = 1;
    below.pos = { x: p.pos.x + 25, y: p.pos.y };
    above.pos = { ...below.pos };
    g.zombies.push(below, above); g._fxOn(p);
    const b0 = below.hp, a0 = above.hp;
    g.map.rayWall = (...args) => { assert.equal(args[5], 1, 'raycast must use attacker floor'); return null; };
    if (attack === 'hitscan') g.fireHitscan(p.pos.x, p.pos.y, 0, M.WEAPONS.m1911, p.pos, p);
    if (attack === 'shock') g.fireShockwave(p.pos.x, p.pos.y, 0, M.WEAPONS.thundergun, p);
    if (attack === 'freeze') g.applySpecial(M.WEAPONS.winterhowl, above.pos.x, above.pos.y, above);
    if (attack === 'knife') p.knife(g);
    assert.equal(below.hp, b0, `${attack} should not damage the other floor`);
    assert.ok(above.hp < a0, `${attack} should damage attacker's floor`);
  }
});

test('remote-floor pickups and rifts work while host remains downstairs', () => {
  const g = fresh(); g.roundActive = false; g.intermission = 999;
  const p = new Player(g.map, g.player.pos.x, g.player.pos.y); p.floor = 1; g.players.push(p);
  g.powerups.push(new Powerup(p.pos.x, p.pos.y, 'doublepoints', 1));
  const below = g.makeZombie({ ...p.pos }, 'walker'); below.floor = 0; below.update = () => {};
  const above = g.makeZombie({ ...p.pos }, 'walker'); above.floor = 1; above.update = () => {};
  g.zombies.push(below, above);
  g.rifts.push({ ...{ x: p.pos.x, y: p.pos.y }, r: 50, dmg: 10, life: 2, max: 2, tick: 0.4, f: 1 });
  const b0 = below.hp, a0 = above.hp;
  g.update(1 / 60);
  assert.ok(g.timers.doublepoints > 0); assert.equal(g.powerups.length, 0);
  assert.equal(below.hp, b0); assert.ok(above.hp < a0);
});

test('nuke kill counters only include enemies that actually died', () => {
  const g = fresh();
  const z = g.makeZombie({ ...g.player.pos }, 'miner');
  z.state = ZSTATE.BURIED;
  g.zombies.push(z);
  const before = g.zombiesKilled, kills = g.stats.kills;
  g.collectPowerup(new Powerup(z.pos.x, z.pos.y, 'nuke'));
  assert.equal(z.dead, false);
  assert.equal(g.zombiesKilled, before);
  assert.equal(g.stats.kills, kills);
});

test('offscreen blood and scorch marks stay on the effect floor', () => {
  const g = fresh();
  g._fxOn({ floor: 1 });
  g.splat(100, 100, 10);
  assert.equal(g._decalCount[0] ?? 0, 0);
  assert.equal(g._decalCount[1], 1);
  assert.ok(g._decals[1]);
  assert.equal(g.map.floor, 0);
});
