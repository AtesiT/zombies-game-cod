// Headless harness: the roof ending and the radio's night.
//
// Four dials light four beacons; at round 30 the board either has a bearing
// on you or it apologises; three rounds off the deck bring the bird in; E at
// the landed bird ends the run EVACUATED with its own mark on the board.
// The radio talks every 5-7 rounds, its storm forecast binds the next sky,
// and its supply crate is a real, walkable thing. The range buttons now live
// in two columns, all of them ON the floor. Co-op: the guest must be able to
// DRAW the whole finale off the snapshot, and must not keep its own board.
//
//   node heli.mjs
import { nc, load, SRC } from './stub.mjs';

const M = await load();
const { drawGameOver } = await import(SRC + '/hud.js');
const H = 1 / 60;
const fails = [];
const ok = (c, l, x = '') => {
  console.log(`${c ? ' ok ' : 'FAIL'}  ${l}${x ? '  -- ' + x : ''}`);
  if (!c) fails.push(l);
};

let seed = 31337;
Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

function boot(campaign = true) {
  const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
  if (!campaign) g._loadMap(true);
  g.begin();
  if (!campaign) g._rangeSetup();
  g.powerOn = true;
  g.powerOnAt = g.time;
  g.player.hurt = () => true;
  g.scorchPlayer = () => {};
  for (let i = 0; i < 30; i++) { g.update(H); g.input.endFrame(); }
  return g;
}

// ---- 1. the range: two columns, every button on the floor, all reachable ---
{
  const g = boot(false);
  const pads = g.map.rangePads.filter((q) => q.type);
  ok(pads.length === Object.keys(M.ENEMY_TYPES).length,
    `only ${pads.length} creature buttons on the range`);
  const xs = new Set(pads.map((q) => q.x));
  ok(xs.size === 2, `the buttons stand in ${xs.size} columns, want 2`);
  let offMap = 0, overlap = 0;
  for (const q of pads) {
    if (q.x < 0 || q.y < 0 || q.x > g.map.w * 24 || q.y > g.map.h * 24) offMap++;
    for (const o of pads) {
      if (o === q) continue;
      if (Math.hypot(o.x - q.x, o.y - q.y) < 30) overlap++;
    }
  }
  ok(offMap === 0, `${offMap} buttons stand off the floor`);
  ok(overlap === 0, `${overlap} button pairs overlap`);
  // every button still offers its creature when you stand on it
  let offered = 0;
  for (const q of pads) {
    g.player.pos.x = q.x + 6; g.player.pos.y = q.y;
    const it = g.interactionFor(g.player);
    if (it && it.type === 'pad' && it.pad.type === q.type) offered++;
  }
  ok(offered === pads.length, `only ${offered}/${pads.length} buttons offer their creature`);
  // and the whole hall still draws
  g.draw(nc(M.VW, M.VH).getContext('2d'));
}

// ---- 2. round 30 with four beacons: the board gets a bearing ---------------
const g = boot();
M.settings.set('weather', true);
ok(g.heli && g.heli.phase === 0, 'a fresh run starts with no bird');
for (const sw of g.map.secretSwitches) sw.found = true;
g.egg.found = g.egg.switches.length;
g.jumpToRound(30);
ok(g.heli.phase === 1, `four lit dials at round 30 give phase ${g.heli.phase}, want 1 (armed)`);
ok(!!g.voice?.text?.length, 'the bearing was not spoken');
ok(g.heli.roofRounds === 0, 'roof rounds start at zero');

// ---- 3. the roof tally: three full rounds off the deck, no cheating --------
g.player.floor = 2;
g.endRound();
ok(g.heli.roofRounds === 1, `one round on the roof counted ${g.heli.roofRounds}`);
g.endRound();
ok(g.heli.roofRounds === 2, `two rounds on the roof counted ${g.heli.roofRounds}`);
g.player.floor = 0;                      // came down: the count starts over
g.endRound();
ok(g.heli.roofRounds === 0, 'leaving the roof did not reset the tally');
g.player.floor = 2;
g.startRound(31); g.endRound();
g.startRound(32); g.endRound();
g.startRound(33); g.endRound();
ok(g.heli.phase === 2, `three held rounds give phase ${g.heli.phase}, want 2 (inbound)`);

// ---- 4. the bird flies in and lands ----------------------------------------
for (let i = 0; i < 60 * 10 && g.heli.phase === 2; i++) g._heliStep(H);
ok(g.heli.phase === 3, `the inbound glide ended at phase ${g.heli.phase}, want 3 (landed)`);

// standing on the pad, the bird offers itself; nowhere else it does not
g.player.floor = 2;
g.player.pos.x = 26.5 * 24 + 10; g.player.pos.y = 28.5 * 24;
let it = g.interactionFor(g.player);
ok(it?.type === 'heli', `the landed bird offers ${it?.type ?? 'nothing'} on its own pad`);
g.player.pos.x = 40 * 24;
it = g.interactionFor(g.player);
ok(it?.type !== 'heli', 'the bird offers itself from across the roof');
g.player.floor = 0;
g.player.pos.x = 26.5 * 24; g.player.pos.y = 28.5 * 24;
it = g.interactionFor(g.player);
ok(it?.type !== 'heli', 'the bird offers itself from the floor below the pad');

// the roof picture: pad, beacons, rotor -- and the evac screen after
g.map.setFloor(2); g.useFloor(2);
g.player.floor = 2;
g.draw(nc(M.VW, M.VH).getContext('2d'));

// ---- 5. wheels up: EVACUATED, its own mark on the board --------------------
g.player.pos.x = 26.5 * 24; g.player.pos.y = 28.5 * 24 + 8;
g.doInteraction(g.player, { type: 'heli' });
ok(g.heli.phase === 4, `boarding gives phase ${g.heli.phase}, want 4 (leaving)`);
ok(g.achievements.has('leaving_tonight'), 'boarding did not earn LEAVING TONIGHT');
for (let i = 0; i < 60 * 6 && g.heli.phase === 4; i++) g._heliStep(H);
ok(g.heli.phase === 5 && g.gameOver && g.evacuated,
  `the climb-out ended phase=${g.heli.phase} over=${g.gameOver} evac=${g.evacuated}`);
ok(g.board?.[0]?.evac === true, 'the evac run is not marked on the board');
ok(g.board?.[0]?.round === 33, `the board remembers round ${g.board?.[0]?.round}, want 33`);
ok(g.rank >= 0, 'the evac run did not find its rank');
g.overT = 2;
drawGameOver(nc(M.VW, M.VH).getContext('2d'), g, M.VW, M.VH);   // must not throw

// ---- 6. fewer than four dials: the radio apologises, the night goes on -----
{
  const g2 = boot();
  g2.map.secretSwitches[0].found = true;
  g2.egg.found = 1;
  g2.jumpToRound(30);
  ok(g2.heli.phase === 0 && g2.heli.sorry, 'one dial at round 30 still called the bird');
  ok(!!g2.voice?.text?.length, 'the apology was not spoken');
  ok(!g2.gameOver, 'the apology ended the run');
  for (let i = 0; i < 60 * 20; i++) { g2.update(H); g2.input.endFrame(); }
  ok(!g2.gameOver && g2.heli.phase === 0, 'the run is not playable after the apology');
  ok(g2.zombies.length > 0 || g2.intermission > 0 || g2.roundActive,
    'the night stopped after the apology');
}

// ---- 7. the radio's night: it talks, it forecasts, it drops crates ---------
{
  const g3 = boot();
  M.settings.set('weather', true);
  const heard0 = g3._radioHeard;
  g3.radioNext = 9;
  g3.startRound(9);
  ok(g3._radioHeard === heard0 + 1, 'the radio stayed silent past its slot');
  ok(!!g3.voice?.text?.length, 'the radio had nothing to say');
  ok(g3.radioNext >= 14, `the next broadcast is at round ${g3.radioNext}, want >= 14`);
  // the story rounds own the wire
  const heard1 = g3._radioHeard;
  g3.radioNext = 25;
  g3.startRound(25);
  ok(g3._radioHeard === heard1 && g3.radioNext === 26, 'the radio talked over the survivors at round 25');

  // the forecast binds the next round's sky
  g3.wx.forecast = 'storm';
  g3.startRound(11);
  ok(g3.wx.kind === 'storm' && g3.wx.forecast === null,
    `the promised storm did not arrive: kind=${g3.wx.kind} forecast=${g3.wx.forecast}`);

  // the crate is real: it falls, it smokes, it pays
  g3.map.setFloor(0); g3.useFloor(0);
  g3.player.floor = 0;
  g3.dropSupply();
  ok(g3.supplies.length === 1, 'the radio promised a crate and none fell');
  g3.player.pos.x = 1.5 * 24; g3.player.pos.y = 1.5 * 24;    // out of pickup range
  for (let i = 0; i < 60 * 3; i++) g3._heliStep(H);          // under the canopy
  ok(g3.supplies.length === 1 && g3.supplies[0].t > g3.supplies[0].fall, 'the crate never landed');
  const s = g3.supplies[0];
  const pts0 = g3.player.points, sal0 = g3.player.salvage;
  g3.player.pos.x = s.x + 4; g3.player.pos.y = s.y;
  g3._heliStep(H);
  ok(g3.supplies.length === 0, 'walking over the crate did not take it');
  ok(g3.player.points === pts0 + 1500, `the crate paid ${g3.player.points - pts0}, want 1500`);
  ok(g3.player.salvage === sal0 + 12, `the crate carried ${g3.player.salvage - sal0} salvage, want 12`);
  ok(g3.achievements.has('care_package'), 'the crate did not earn CARE PACKAGE');
  g3.draw(nc(M.VW, M.VH).getContext('2d'));
  // an untouched crate goes home eventually
  g3.dropSupply();
  g3.supplies[0].life = 0.01; g3.supplies[0].t = 9;
  g3._heliStep(H);
  ok(g3.supplies.length === 0, 'a forgotten crate never left');
}

// ---- 8. the debug menu can call the bird and the crate ---------------------
{
  const g4 = boot();
  const rows = g4.debugRows().map((r) => r.id);
  ok(rows.includes('callbird') && rows.includes('supply'), 'the debug menu lost the roof finale');
  g4._debugRun('callbird');
  ok(g4.heli.phase === 2, `CALL THE BIRD gave phase ${g4.heli.phase}, want 2`);
  g4._debugRun('supply');
  ok(g4.supplies.length === 1, 'DROP A SUPPLY CRATE dropped nothing');
}

// ---- 9. co-op: the guest draws the finale and keeps no board ---------------
{
  // a second pair of machines on a live wire
  let seed2 = 424242;
  const rand = Math.random;
  Math.random = () => { seed2 = (seed2 * 1103515245 + 12345) & 0x7fffffff; return seed2 / 0x7fffffff; };

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
      if (o.t === 'rooms' || o.t === 'ping') return;
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
      const { t, to, ...rest } = o;
      for (const [id, net] of this.nets) {
        if (id === fromId) continue;
        if (to != null && id !== to) continue;
        net._onMessage({ ...rest, from: fromId });
      }
    }
  }
  const fakeInput = () => ({
    keys: new Set(), pressed: new Set(), released: new Set(), menuLock: false,
    mouse: { x: M.VW / 2, y: M.VH / 2, cx: 0, cy: 0, down: false, pressed: false, released: false, rdown: false },
    wheel: 0, anyInput: false, stick: { x: 0, y: 0 },
    isDown(...c) { return c.some((k) => this.keys.has(k)); },
    moveVector() { return { x: 0, y: 0 }; },
    wasPressed(...c) { return c.some((k) => this.pressed.has(k)); },
    wasReleased(...c) { return c.some((k) => this.released.has(k)); },
    endFrame() { this.pressed.clear(); this.released.clear(); this.mouse.pressed = false; this.mouse.released = false; this.wheel = 0; },
  });

  const host = new M.Game(fakeInput());
  const guest = new M.Game(fakeInput());
  host.applySettings(); guest.applySettings();
  M.settings.set('weather', true);
  host.begin();
  host.player.hurt = () => true;
  host.scorchPlayer = () => {};
  host.powerOn = true; host.powerOnAt = host.time;
  const wire = new Wire();
  wire.attach(host.net, 'HOST');
  wire.attach(guest.net, 'GUEST');
  host.net.hostGame('BIRD', 'HOST');
  guest.net.joinGame('BIRD', 'GUEST');
  const stepBoth = (n) => {
    for (let i = 0; i < n; i++) {
      host.update(H); host.input.endFrame();
      guest.update(H); guest.input.endFrame();
    }
  };
  stepBoth(90);
  const mate = host.players.find((o) => o.name === 'GUEST');
  ok(!!mate && host.net.playing && guest.net.playing, 'the co-op room did not come up');

  // the dials: host throws them, the guest must SEE the beacons light
  for (const sw of host.map.secretSwitches) sw.found = true;
  host.egg.found = 4;
  host.jumpToRound(30);
  ok(host.heli.phase === 1, 'the host did not arm at round 30');
  stepBoth(30);
  ok(guest.heli.phase === 1, `the guest sees phase ${guest.heli.phase}, want 1`);
  const gsw = guest.map.floors[0].secretSwitches;
  ok(gsw.every((s) => s.found) && guest.egg.found === 4, 'the guest did not get the dial states');

  // inbound: the guest draws the bird off the snapshot, on the roof
  host.heli.phase = 2; host.heli.t = 0;
  stepBoth(30);
  ok(guest.heli.phase === 2, `the guest sees phase ${guest.heli.phase}, want 2 (inbound)`);
  guest.map.setFloor(2); guest.useFloor(2);
  guest.draw(nc(M.VW, M.VH).getContext('2d'));       // must not throw

  // the crate rides along
  host.dropSupply();
  stepBoth(20);
  ok(guest.supplies.length === 1, `the guest sees ${guest.supplies.length} crates, want 1`);

  // landing, boarding, and the ending on both screens
  host.heli.phase = 3; host.heli.t = 0;
  stepBoth(20);
  host.player.floor = 2;
  host.map.setFloor(2); host.useFloor(2);
  host.player.pos.x = 26.5 * 24; host.player.pos.y = 28.5 * 24 + 6;
  const hit = host.interactionFor(host.player);
  ok(hit?.type === 'heli', `the host's own body gets ${hit?.type ?? 'nothing'} at the pad`);
  host.doInteraction(host.player, hit);
  ok(host.heli.phase === 4, 'the host did not board');
  for (let i = 0; i < 60 * 6 && host.heli.phase === 4; i++) host.update(H);
  ok(host.gameOver && host.evacuated, 'the host did not end EVACUATED');
  stepBoth(30);
  ok(guest.gameOver && guest.evacuated,
    `the guest screen shows over=${guest.gameOver} evac=${guest.evacuated}`);
  ok(!guest.board, 'the guest kept its own board');
  guest.overT = 2;
  drawGameOver(nc(M.VW, M.VH).getContext('2d'), guest, M.VW, M.VH);   // must not throw

  Math.random = rand;
}

console.log(fails.length ? `\n${fails.length} FAILURES:\n  ${fails.join('\n  ')}` : '\nHELI PASS  the roof ending, the radio and the two-column range all hold');
process.exit(fails.length ? 1 : 0);
