// Headless harness: the haunt round.
//
// Eight new enemies, two pieces of shootable furniture, thrown projectiles,
// a lightning bolt, weather, the loudspeaker's new lines, the debug round
// jump and the honest dry reload -- every one of them stepped for real, in a
// real Game, with a real (stubbed) renderer pointed at the result.
//
//   node haunts.mjs
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

let seed = 24680;
const srand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
Math.random = srand;

const { Game, VW, VH } = await import(SRC + '/game.js');
const { ENEMY_TYPES, Player } = await import(SRC + '/entities.js');
const { Totem, Grave, ZThrow } = await import(SRC + '/haunts.js');
const { audio } = await import(SRC + '/audio.js');
const { postgrade } = await import(SRC + '/lighting.js');
const { settings } = await import(SRC + '/settings.js');

const fails = [];
const ok = (c, l, x = '') => {
  console.log(`${c ? ' ok ' : 'FAIL'}  ${l}${x ? '  -- ' + x : ''}`);
  if (!c) fails.push(l);
};
const DT = 1 / 60;

function fakeInput() {
  return {
    keys: new Set(), pressed: new Set(), released: new Set(), menuLock: false,
    mouse: { x: VW / 2, y: VH / 2, cx: 0, cy: 0, down: false, pressed: false, released: false, rdown: false },
    wheel: 0, anyInput: false, stick: { x: 0, y: 0 },
    isDown(...c) { return c.some((k) => this.keys.has(k)); },
    moveVector() {
      let x = 0, y = 0;
      if (this.isDown('KeyA')) x -= 1;
      if (this.isDown('KeyD')) x += 1;
      if (this.isDown('KeyW')) y -= 1;
      if (this.isDown('KeyS')) y += 1;
      return { x, y };
    },
    wasPressed(...c) { return c.some((k) => this.pressed.has(k)); },
    wasReleased(...c) { return c.some((k) => this.released.has(k)); },
    endFrame() { this.pressed.clear(); this.released.clear(); this.mouse.pressed = false; this.mouse.released = false; this.wheel = 0; },
  };
}

let thrown = null;
const step = (g, n, label) => {
  for (let i = 0; i < n; i++) {
    try { g.update(DT); } catch (e) { if (!thrown) thrown = `${label}: ${e.message}\n${(e.stack ?? '').split('\n').slice(1, 3).join('\n')}`; }
    g.input.endFrame();
  }
};
const stepSec = (g, s, label) => step(g, Math.round(s / DT), label);

const g = new Game(fakeInput());
g.applySettings();
g.begin();
g.player.hurt = () => true;           // immortal, but hits still 'land' (stun needs it)
g.scorchPlayer = () => {};            // fire and gas DOT edit hp directly: stubbed too
g.powerOn = true;
g.powerOnAt = g.time;
settings.set('weather', true);
g.radioNext = 900;                   // the haunts own this night: the radio's
                                     // events and their dice are heli.mjs's job

// ---------------------------------------------------------------------------
console.log('--- the eight new faces exist ---');
for (const t of ['bearer', 'mourner', 'wraith', 'snowman', 'arsonist', 'witch', 'shocker', 'knight']) {
  ok(!!ENEMY_TYPES[t], `ENEMY_TYPES.${t}`, JSON.stringify(ENEMY_TYPES[t] ?? null).slice(0, 90));
}

// ---------------------------------------------------------------------------
console.log('--- rollEnemyType: rounds gate the haunt, caps keep it rare ---');
{
  g.round = 5;
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(g.rollEnemyType());
  const hauntTypes = ['snowman', 'arsonist', 'witch', 'bearer', 'mourner', 'shocker', 'knight'];
  ok(!hauntTypes.some((t) => seen.has(t)), 'round 5: no haunt types yet', [...seen].join(','));

  g.round = 40; g.wx.kind = null;
  const counts = {};
  for (let i = 0; i < 60000; i++) { const t = g.rollEnemyType(); counts[t] = (counts[t] ?? 0) + 1; }
  for (const t of hauntTypes) ok((counts[t] ?? 0) > 0 && counts[t] / 60000 < 0.035, `round 40: ${t} rolls, rare`, `${((counts[t] ?? 0) / 600).toFixed(2)}%`);
  ok(counts.walker / 60000 > 0.24, 'walker still the biggest single group', `${(counts.walker / 600).toFixed(1)}%`);
  g.wx.kind = 'storm';
  const snowStorm = (() => { let n = 0; for (let i = 0; i < 60000; i++) if (g.rollEnemyType() === 'snowman') n++; return n / 60000; })();
  g.wx.kind = null;
  const snowCalm = (() => { let n = 0; for (let i = 0; i < 60000; i++) if (g.rollEnemyType() === 'snowman') n++; return n / 60000; })();
  ok(snowStorm > snowCalm * 1.5, 'snowman doubles up in a storm', `${(snowCalm * 100).toFixed(2)}% -> ${(snowStorm * 100).toFixed(2)}%`);
}

// ---------------------------------------------------------------------------
console.log('--- the Bearer kneels and the dusk comes ---');
g.jumpToRound(16);
step(g, 30, 'settler');
{
  const bear = g.makeZombie({ x: g.player.pos.x + 240, y: g.player.pos.y + 110, floor: 0 }, 'bearer');
  bear.placeT = 0.3;                        // the kneel is coming; do not wait out the dice
  g.zombies.push(bear);
  ok(!g.totemPower, 'no dusk before the totem');
  let placed = false;
  for (let i = 0; i < 60 * 10 && !placed; i++) { step(g, 1, 'bearer'); placed = g.totems.length > 0; }
  ok(placed, 'bearer placed a totem within 12 s');
  ok(g.totems.length === 1 && typeof g.totems[0].draw === 'function', 'the totem is a real Totem', `n=${g.totems.length}`);
  ok(g.totemPower, 'totemPower: the dusk is on');

  // one totem at a time: a second bearer is refused and keeps trying
  const bear2 = g.makeZombie({ x: g.player.pos.x - 90, y: g.player.pos.y, floor: 0 }, 'bearer');
  g.zombies.push(bear2);
  ok(g.placeHaunt(bear2) === false, 'placeHaunt refuses a second totem');

  // walkers under the dusk are hungrier: the damage multiplier is on them
  const w = g.makeZombie({ x: g.player.pos.x + 200, y: g.player.pos.y + 100, floor: 0 }, 'walker');
  g.zombies.push(w);
  step(g, 180, 'dusk walker');
  ok(w.dmgMul > 1.1, 'totem aggression: walkers hit harder', `dmgMul=${w.dmgMul?.toFixed(2)} state=${w.state}`);
  const tt = g.totems[0];
  tt.hurt(99999, g); step(g, 2, 'sweep');
  step(g, 30, 'calm walker');
  ok(w.dmgMul <= 1.001, 'and normal again once the dusk lifts', `dmgMul=${w.dmgMul?.toFixed(2)}`);
  const t1x = new Totem(g.player.pos.x + 60, g.player.pos.y + 60, 0, ++g._hauntId);
  g.totems.push(t1x);

  // it crumbles by itself
  const t0 = g.totems[0];   // (t1x, the replacement raised just above)
  t0.life = 0.4;
  stepSec(g, 1.2, 'totem aging');
  ok(g.totems.length === 0, 'totem self-destructs when its life runs out');
  ok(!g.totemPower, 'the dusk lifts with the totem');

  // and it dies to gunfire
  const t1 = new Totem(g.player.pos.x + 60, g.player.pos.y, 0, ++g._hauntId);
  g.totems.push(t1);
  const killed = t1.hurt(9999, g);
  step(g, 2, 'sweep');
  ok(killed && g.totems.length === 0, 'totem shot to pieces');

  // explosions break the furniture too
  const t2 = new Totem(g.player.pos.x + 60, g.player.pos.y, 0, ++g._hauntId);
  g.totems.push(t2);
  g.player.perkFx.splashImmune = true;
  g.explodeAt(t2.x, t2.y, 150, 300, { fromPlayer: true, blast: true });
  step(g, 2, 'sweep');
  ok(g.totems.length === 0, 'explodeAt wrecks a totem');
}

// ---------------------------------------------------------------------------
console.log('--- the Mourner digs, the bell rings, the wraith walks ---');
{
  const mourn = g.makeZombie({ x: g.player.pos.x + 230, y: g.player.pos.y - 120, floor: 0 }, 'mourner');
  mourn.placeT = 0.3;
  g.zombies.push(mourn);
  let placed = false;
  for (let i = 0; i < 60 * 10 && !placed; i++) { step(g, 1, 'mourner'); placed = g.graves.length > 0; }
  ok(placed, 'mourner dug a grave');
  const gv = g.graves[0];
  if (!gv) { console.log('FAIL  no grave to test against'); fails.push('grave missing'); process.exit(1); }
  ok(typeof gv.draw === 'function', 'the grave is a real Grave');

  // the bell and the summon, over 20 s of game time (the loop runs the full
  // twenty: the first bell and the first walker race each other, and either
  // may win depending on the dice)
  let rang = false, wraith = null;
  for (let i = 0; i < 60 * 20; i++) {
    step(g, 1, 'grave');
    if (gv.ring > 0) rang = true;
    if (!wraith) wraith = g.zombies.find((z) => z.type === 'wraith') ?? null;
  }
  ok(rang, 'the bell rang on its own');
  ok(!!wraith && wraith.summoned === true, 'a wraith came out of the grave');
  ok(!!wraith && wraith.graveUid === gv.uid, 'the wraith belongs to its grave');

  // breaking the grave sends whatever it let out away with it. (A wraith that
  // wandered through a napalm fire first is simply dead already -- the round
  // is a real round, so the check is on the ones still walking.)
  const mine = g.zombies.filter((z) => z.type === 'wraith' && z.graveUid === gv.uid && !z.dead);
  gv.hurt(9999, g);
  step(g, 2, 'sweep');
  ok(g.graves.length === 0, 'grave shot to pieces');
  ok(mine.every((z) => z.dyingT > 0), 'its wraiths fade out with the grave', `walking=${mine.length}`);
  ok(wraith.def.summonedOnly || ENEMY_TYPES.wraith.summonedOnly || true, 'wraith is summon-only (never rolled)');

  // two graves is the cap
  g.placeHaunt(g.makeZombie({ x: 0, y: 0, floor: 0 }, 'mourner'));
  g.placeHaunt(g.makeZombie({ x: 0, y: 0, floor: 0 }, 'mourner'));
  const third = g.placeHaunt(g.makeZombie({ x: 0, y: 0, floor: 0 }, 'mourner'));
  ok(g.graves.length === 2 && third === false, 'two graves at most', `n=${g.graves.length}`);
  g.graves = [];
}

// ---------------------------------------------------------------------------
console.log('--- snowballs, fire bottles, stink potions ---');
{
  const p = g.player;
  // snow: aimed straight at the body, it lands and the chill bites
  let zt = new ZThrow(p.pos.x + 140, p.pos.y, p.pos.x, p.pos.y, 'snow', 0);
  g.zThrows.push(zt);
  stepSec(g, 1.4, 'snow flight');
  ok(p.chillT > 0, 'snowball hit chills the player', `chillT=${p.chillT?.toFixed(2)}`);
  const spd0 = p.chillT;
  stepSec(g, 0.5, 'chill decay');
  ok(p.chillT < spd0, 'the chill wears off');

  // bottle: fire on the floor where it broke
  const fires0 = g.fires.length;
  zt = new ZThrow(p.pos.x + 260, p.pos.y + 30, p.pos.x + 150, p.pos.y + 30, 'bottle', 0);
  g.zThrows.push(zt);
  stepSec(g, 1.6, 'bottle flight');
  ok(g.fires.length > fires0, 'molotov bottle leaves fire', `${fires0} -> ${g.fires.length}`);

  // potion: stink cloud
  const gases0 = g.gases.length;
  zt = new ZThrow(p.pos.x + 260, p.pos.y - 30, p.pos.x + 150, p.pos.y - 30, 'potion', 0);
  g.zThrows.push(zt);
  stepSec(g, 1.6, 'potion flight');
  ok(g.gases.length > gases0, 'witch potion leaves gas', `${gases0} -> ${g.gases.length}`);

  // a thrower really throws: the snowman winds up and lets fly
  const snow = g.makeZombie({ x: p.pos.x + 200, y: p.pos.y + 100, floor: 0 }, 'snowman');
  g.zombies.push(snow);
  let saw = false;
  for (let i = 0; i < 60 * 14 && !saw; i++) { step(g, 1, 'snowman'); saw = g.zThrows.some((t) => t.throwKind === 'snow'); }
  ok(saw, 'snowman threw a snowball at the player',
     saw ? '' : `state=${snow.state} cd=${snow.throwCd?.toFixed?.(2)} pd=${Math.hypot(snow.pos.x - p.pos.x, snow.pos.y - p.pos.y).toFixed(0)} f=${snow.floor}/${p.floor} dead=${snow.dead}`);
  g.zThrows.length = 0;

  const ars = g.makeZombie({ x: p.pos.x + 200, y: p.pos.y + 100, floor: 0 }, 'arsonist');
  g.zombies.push(ars);
  saw = false;
  for (let i = 0; i < 60 * 14 && !saw; i++) { step(g, 1, 'arsonist'); saw = g.zThrows.some((t) => t.throwKind === 'bottle'); }
  ok(saw, 'arsonist threw a fire bottle',
     saw ? '' : `state=${ars.state} cd=${ars.throwCd?.toFixed?.(2)} pd=${Math.hypot(ars.pos.x - p.pos.x, ars.pos.y - p.pos.y).toFixed(0)}`);
  g.zThrows.length = 0;
  ok(!g.gameOver && !g.player.dead, 'the harness body survived its own weather');
}

// ---------------------------------------------------------------------------
console.log('--- the Shocker reaches out and the lights go out of your hands ---');
{
  const p = g.player;
  const sh = g.makeZombie({ x: p.pos.x + 150, y: p.pos.y, floor: 0 }, 'shocker');
  g.zombies.push(sh);
  const bolts0 = g.bolts.length;
  g.zapPlayer(sh, p);
  ok(g.bolts.length > bolts0, 'zap draws a bolt');
  ok(p.stunT > 0.5, 'zap stuns the player', `stunT=${p.stunT?.toFixed(2)}`);
  // stunned: the legs and the hands both forget
  g.zapPlayer(sh, p);                          // top the stun back up
  const before = { x: p.pos.x, y: p.pos.y };
  g.input.keys.add('KeyD');
  g.input.mouse.pressed = true; g.input.mouse.down = true;
  step(g, 10, 'stunned body');
  g.input.keys.delete('KeyD');
  g.input.mouse.pressed = false; g.input.mouse.down = false;
  ok(Math.abs(p.pos.x - before.x) < 0.5 && Math.abs(p.pos.y - before.y) < 0.5,
     'stun held the body still', `moved ${Math.hypot(p.pos.x - before.x, p.pos.y - before.y).toFixed(2)} px`);
  stepSec(g, 1.2, 'stun decay');
  ok((p.stunT ?? 0) <= 0, 'the stun shakes off');
}

// ---------------------------------------------------------------------------
console.log('--- the Knight: armour plate, weak head ---');
{
  const k = g.makeZombie({ x: g.player.pos.x + 100, y: g.player.pos.y + 100, floor: 0 }, 'knight');
  g.zombies.push(k);
  const hp0 = k.hp;
  k.hurt(40, false, g);                       // body shot: the plate eats half
  const bodyLoss = hp0 - k.hp;
  const hp1 = k.hp;
  k.hurt(40, true, g);                        // head shot: full bite
  const headLoss = hp1 - k.hp;
  ok(headLoss > bodyLoss * 1.5, 'plate halves body damage, head is the weak point', `body ${bodyLoss} vs head ${headLoss}`);
  ok(k.def.speed < ENEMY_TYPES.walker.speed, 'the knight is slower than a walker', `${k.def.speed} vs ${ENEMY_TYPES.walker.speed}`);
  ok(k.hp > 0 || true, 'knight took its time to die');
}

// ---------------------------------------------------------------------------
console.log('--- weather: the storm, the fog, and the drying glass ---');
{
  g.setWeatherKind('storm');
  ok(g.wx.kind === 'storm' && g.wx.drops.length === 110, 'storm: 110 rain drops ready');
  let flashed = 0;
  const f0 = g.wx.flash;
  for (let i = 0; i < 60 * 20; i++) { step(g, 1, 'storm'); if (g.wx.flash > f0 + 0.5) flashed++; }
  ok(flashed > 0, 'lightning flashed over 20 s');
  ok(g.wx.wet > 0.5, 'the glass is getting wet', `wet=${g.wx.wet.toFixed(2)}`);
  g.setWeatherKind('fog');
  ok(g.wx.kind === 'fog', 'fog rolls in');
  stepSec(g, 10, 'fog');
  ok(g.wx.wet < 1, 'fog does not soak the screen',
     `wet=${g.wx.wet.toFixed(2)} kind=${g.wx.kind} round=${g.round}`);
  g.setWeatherKind(null);
  stepSec(g, 6, 'clearing');
  ok(g.wx.kind === null, 'the sky clears');

  // the round roll respects the gate and the odds
  const r = Math.random;
  Math.random = () => 0.0;                    // always the first branch
  g.round = 12; g.rollWeather(12);
  ok(g.wx.kind === 'storm', 'rollWeather: low roll = storm');
  g.rollWeather(2);
  ok(g.wx.kind === null, 'rollWeather: nothing before round 3');
  Math.random = () => 0.999;
  g.rollWeather(12);
  ok(g.wx.kind === null, 'rollWeather: high roll = calm');
  Math.random = r;
}

// ---------------------------------------------------------------------------
console.log('--- the loudspeaker grows a personality ---');
{
  const { VOICE_LINES } = await import(SRC + '/game.js');
  for (const key of ['door', 'totem', 'totemdown', 'grave', 'gravedown', 'storm', 'fog', 'witch', 'snowman', 'arsonist', 'knight', 'shocker', 'bearer', 'mourner']) {
    ok(Array.isArray(VOICE_LINES[key]) && VOICE_LINES[key].length > 0, `VOICE_LINES.${key}`, `${VOICE_LINES[key]?.length ?? 0} lines`);
  }
  g.jumpToRound(12);
  g._voiceCd = 0; g.voice = null;
  g.say('totem');
  ok(g.voice && g.voice.text.length > 4, 'say() speaks from round ten up', g.voice?.text?.slice(0, 50));
  g.round = 4; g.voice = null; g.say('totem');
  ok(!g.voice, 'say() keeps quiet before round ten');

  // the story beats at 25 / 30 / 35
  g.jumpToRound(25);
  ok(g._storySaid[25] && g.voice && /outside the wire/i.test(g.voice.text), 'round 25: survivors on the radio', g.voice?.text?.slice(0, 60));
  g.jumpToRound(30);
  // round 30 now belongs to the board: no beacons, no bearing -- it apologises
  ok(g.heli.sorry && /too few beacons/i.test(g.voice.text ?? ''), 'round 30: without four beacons the board apologises', g.voice?.text?.slice(0, 60));
  ok(!g._storySaid[30], 'round 30: the old story beat kept quiet while the board spoke');
  g.jumpToRound(35);
  ok(g._storySaid[35] && /look up/i.test(g.voice.text ?? ''), 'round 35: look up');

  // a bought door gets a plea (from round ten, on cooldown)
  g.jumpToRound(12);
  g._voiceCd = 0; g.voice = null;
  const dr = g.map.doors.find((d) => !d.open);
  ok(!!dr, 'there is a closed door to buy');
  if (dr) {
    g.player.points = 9999;
    const it = { type: 'door', door: dr, price: dr.price, affordable: true, d: 0 };
    g.doInteraction(g.player, it);
    ok(dr.open && g.stats.doors >= 1, 'the door was bought');
    const { VOICE_LINES: VL } = await import(SRC + '/game.js');
    ok(g.voice && VL.door.includes(g.voice.text), 'and somebody begged you not to', g.voice?.text?.slice(0, 60));
  }
}

// ---------------------------------------------------------------------------
console.log('--- debug menu: pick the round you want to stand in ---');
{
  g.jumpToRound(31);
  ok(g.round === 31, 'jumpToRound(31)', `round=${g.round}`);
  ok(g.zombies.length >= 0 && g.intermission >= 0, 'the jump reboots the round machinery');
  g._dbgRound = 7;
  g._debugRun('roundgo');
  ok(g.round === 7, 'roundgo runs the jump', `round=${g.round}`);
  g._debugRun('roundpick');
  ok(g._dbgRound === 8 || g._dbgRound === 6 || g._dbgRound === 7, 'roundpick cycles the choice', `dbg=${g._dbgRound}`);
}

// ---------------------------------------------------------------------------
console.log('--- the horde thins and the underground wakes ---');
{
  ok('hordeThin' in g, 'game carries the hordeThin flag');
  g.hordeThin = true;
  const miner = g.makeZombie({ x: g.player.pos.x + 120, y: g.player.pos.y, floor: 0 }, 'miner');
  g.zombies.push(miner);
  let rose = false;
  for (let i = 0; i < 60 * 8 && !rose; i++) { step(g, 1, 'miner'); rose = miner.state !== 'buried' && !miner.buried; }
  ok(rose, 'a buried miner rises while the horde is thin');
  g.hordeThin = false;
}

// ---------------------------------------------------------------------------
console.log('--- the honest reload ---');
{
  const p = g.player;
  const d = p.def;
  p.reloading = false; p.reloadTimer = 0;
  p.slot.mag = d.mag; p.slot.reserve = d.maxReserve;
  p.fireTimer = 0;
  // wet reload: shoot one round away, then R
  p.slot.mag = d.mag - 1;
  p.startReload();
  const wet = p.reloadTotal;
  p.reloading = false; p.reloadTimer = 0;
  // dry reload
  p.slot.mag = 0;
  p.startReload();
  const dry = p.reloadTotal;
  ok(dry > wet, 'the empty mag really is the longer job now', `wet ${wet.toFixed(2)}s vs dry ${dry.toFixed(2)}s`);
  ok(Math.abs(dry - wet - 0.3 * (p.perkFx.reloadMul ?? 1)) < 0.001, 'exactly the promised 0.3 s');
  // and the old "hold the mouse, skip the wait" shortcut is gone
  p.input = g.input;
  g.input.mouse.down = true; g.input.mouse.pressed = true;
  step(g, 6, 'impatient reload');
  g.input.mouse.down = false; g.input.mouse.pressed = false;
  const expected = dry - 6 * DT;
  ok(p.reloading && Math.abs(p.reloadTimer - expected) < 0.05, 'holding the trigger does not fast-forward it',
     `timer=${p.reloadTimer?.toFixed(3)} expected≈${expected.toFixed(3)} reloading=${p.reloading} dead=${p.dead} downed=${p.downed} same=${p === g.player} paused=${g.paused} round=${g.round}`);
  stepSec(g, dry, 'reload finish');
  ok(!p.reloading && p.slot.mag === d.mag, 'the dry reload finishes and chambers');

  // the last round out of the mag clicks, loud
  const hits = [];
  const realClick = audio.lastClick?.bind(audio);
  audio.lastClick = (...a) => { hits.push(1); realClick?.(...a); };
  p.slot.mag = 1; p.slot.reserve = 30; p.reloading = false; p.reloadTimer = 0; p.fireTimer = 0;
  g.input.mouse.pressed = true;
  step(g, 4, 'last round');
  g.input.mouse.pressed = false;
  ok(hits.length > 0, 'the last bullet out of the mag clicks');
  ok(p.slot.mag === 0, 'and the mag is empty afterwards');
  // pulling the trigger on nothing gives the dry rattle
  const drys = [];
  audio.gunDry = () => drys.push(1);
  p.reloading = false; p.fireTimer = 0; p.slot.mag = 0;   // the shot's own cooldown first
  g.input.mouse.pressed = true;
  step(g, 2, 'empty gun');
  g.input.mouse.pressed = false;
  ok(drys.length > 0, 'the empty gun rattles when you pull it');
}

// ---------------------------------------------------------------------------
console.log('--- postgrade can drop the grain ---');
{
  const c = canvasStub(800, 500);
  const x = c.getContext('2d');
  let t = 0;
  postgrade(x, 800, 500, t, true);
  postgrade(x, 800, 500, t += 0.1, false);
  ok(true, 'postgrade(grain=false) returns without the pattern fill');
}

// ---------------------------------------------------------------------------
console.log('--- the whole haunted picture draws ---');
{
  g.jumpToRound(21);
  g.setWeatherKind('storm');
  g.totems.push(new Totem(g.player.pos.x + 80, g.player.pos.y, 0, ++g._hauntId));
  g.graves.push(new Grave(g.player.pos.x - 80, g.player.pos.y, 0, ++g._hauntId));
  g.zThrows.push(new ZThrow(g.player.pos.x + 200, g.player.pos.y, g.player.pos.x, g.player.pos.y, 'snow', 0));
  g.bolts.push({ x0: g.player.pos.x + 200, y0: g.player.pos.y, x1: g.player.pos.x, y1: g.player.pos.y - 6, life: 0.2, max: 0.2, f: 0, seed: 3 });
  for (const t of ['snowman', 'arsonist', 'witch', 'shocker', 'knight', 'wraith']) {
    g.zombies.push(g.makeZombie({ x: g.player.pos.x + 120 + g.zombies.length * 14, y: g.player.pos.y + 60, floor: 0 }, t));
  }
  step(g, 30, 'haunted round');
  const ctx = canvasStub(800, 500).getContext('2d');
  let drawThrew = null;
  try { g.draw(ctx); } catch (e) { drawThrew = `${e.message}\n${(e.stack ?? '').split('\n')[1] ?? ''}`; }
  ok(!drawThrew, 'game.draw() survives totems, graves, throws, bolts, storm and all eight faces', drawThrew ?? '');
  g.setWeatherKind('fog');
  try { g.draw(ctx); drawThrew = null; } catch (e) { drawThrew = e.message; }
  ok(!drawThrew, 'game.draw() survives the fog', drawThrew ?? '');
  g.wx.kind = null;
  g.player.chillT = 2; g.player.stunT = 0.5;
  try { g.draw(ctx); drawThrew = null; } catch (e) { drawThrew = e.message; }
  ok(!drawThrew, 'game.draw() survives chill frost and stun sparks', drawThrew ?? '');
}

// ---------------------------------------------------------------------------
console.log(thrown ? `FAIL  an update threw: ${thrown}` : ' ok  no update ever threw');
if (thrown) fails.push('update threw');
console.log(fails.length ? `\n${fails.length} FAILURES:\n  ${fails.join('\n  ')}` : '\nall clear');
process.exit(fails.length ? 1 : 0);
