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

// ---- 2. round 25 with four beacons arms the pad, in either order -----------
const g = boot();
M.settings.set('weather', true);
ok(g.heli && g.heli.phase === 0, 'a fresh run starts with no bird');
for (const sw of g.map.secretSwitches) sw.found = true;
g.egg.found = g.egg.switches.length;
g.jumpToRound(24);
for (let i = 0; i < 5; i++) g._heliStep(H);
ok(g.heli.phase === 0, `four dials at round 24 armed the pad early (phase ${g.heli.phase})`);
g.jumpToRound(25);
for (let i = 0; i < 5; i++) g._heliStep(H);
ok(g.heli.phase === 1, `round 25 with four lit dials gives phase ${g.heli.phase}, want 1 (armed)`);
ok(!!g.voice?.text?.length, 'the arming was not spoken');
{
  // the other order: the dials finished late, at round 40 -- arms on the spot
  const ga = boot();
  ga.jumpToRound(40);
  for (let i = 0; i < 5; i++) ga._heliStep(H);
  ok(ga.heli.phase === 0, 'round 40 without the dials armed anything');
  for (const sw of ga.map.secretSwitches) sw.found = true;
  ga.egg.found = ga.egg.switches.length;
  for (let i = 0; i < 5; i++) ga._heliStep(H);
  ok(ga.heli.phase === 1, `dials finished at round 40 give phase ${ga.heli.phase}, want 1`);
}

// ---- 3. the flare: green smoke and two minutes, no roof vigil --------------
g.map.setFloor(2); g.useFloor(2);
g.player.floor = 2;
g.player.pos.x = 18.5 * 24 + 8; g.player.pos.y = 15.5 * 24;
let flareIt = g.interactionFor(g.player);
ok(flareIt?.type === 'flare', `the armed pad offers ${flareIt?.type ?? 'nothing'} at its centre`);
g.doInteraction(g.player, flareIt);
ok(g.heli.phase === 2 && g.heli.flare === true,
  `lighting the flare gives phase ${g.heli.phase} flare ${g.heli.flare}, want 2 and true`);
ok(g._heliPos().alpha === 0, 'the bird is already visible two minutes out');
g.heli.t = 112;                          // the last nine seconds: wings appear
ok(g._heliPos().alpha > 0, 'the bird never appears over the west trees');
g.heli.t = 119.5;
for (let i = 0; i < 40; i++) g._heliStep(H);
ok(g.heli.phase === 3, `the two-minute burn ended at phase ${g.heli.phase}, want 3 (landed)`);
ok(g.heli.roofRounds === 0, 'somebody still counts rounds on the roof');

// the roof picture: pad, beacons, rotor -- and the evac screen after
g.map.setFloor(2); g.useFloor(2);
g.player.floor = 2;
g.draw(nc(M.VW, M.VH).getContext('2d'));

// ---- 4b. the standing offer: on the pad, and nowhere else ------------------
g.player.pos.x = 18.5 * 24 + 10; g.player.pos.y = 15.5 * 24;
let it = g.interactionFor(g.player);
ok(it?.type === 'heli', `the landed bird offers ${it?.type ?? 'nothing'} on its own pad`);
g.player.pos.x = 40 * 24;
it = g.interactionFor(g.player);
ok(it?.type !== 'heli', 'the bird offers itself from across the roof');
g.player.floor = 0;
g.player.pos.x = 18.5 * 24; g.player.pos.y = 15.5 * 24;
it = g.interactionFor(g.player);
ok(it?.type !== 'heli', 'the bird offers itself from the floor below the pad');
g.player.floor = 2;

// ---- 5. wheels up: a majority vote, then EVACUATED -------------------------
{
  // three bodies: one yes is not a majority, two are
  const gv = boot();
  gv.heli.phase = 3;
  const mate = (dx) => {
    const m = new (Object.getPrototypeOf(gv.player).constructor)(gv.map, gv.player.pos.x + dx, gv.player.pos.y);
    m.game = gv; m.netId = 900 + gv.players.length; m.name = 'MATE'; m.floor = 0;
    gv.players.push(m);
    return m;
  };
  const m1 = mate(40), m2 = mate(-40);
  gv.evacuate(gv.player);
  ok(gv.heli.phase === 3 && !gv.player.evac,
    `one yes of three lifted the bird (phase ${gv.heli.phase}) or seated a voter (evac ${gv.player.evac})`);
  gv.evacuate(m1);
  ok(gv.heli.phase === 4, `two yeses of three give phase ${gv.heli.phase}, want 4 (leaving)`);
  ok(gv.players.every((o) => o.evac), 'somebody was left standing on the deck');
  gv.players.length = 1;
  gv.player.evac = false; gv.player.evacVote = false; gv.heli.phase = 3;
  // and a raised hand can be taken back
  gv.evacuate(m1);
  ok(gv.player.evacVote === false, 'a second press did not take the vote back');
  gv.evacuate(gv.player);
  ok(gv.heli.phase === 4, 'the lone survivor could not leave alone');
}
g.player.pos.x = 18.5 * 24; g.player.pos.y = 15.5 * 24 + 8;
g.doInteraction(g.player, { type: 'heli' });
ok(g.heli.phase === 4, `a lone survivor is his own majority: phase ${g.heli.phase}, want 4`);
ok(g.player.evac === true, 'the one who boarded is still standing on the deck');
// boot() stubs hurt() to always land, so ask the real prototype instead
ok(Object.getPrototypeOf(g.player).hurt.call(g.player, 99, 0, 0, g) === false,
  'a passenger can still be hurt');
{
  // a passenger cannot shoot his way back into the war
  const before = g.tracers.length + g.stats.shots;
  g.input.mouse.down = true;
  for (let i = 0; i < 30; i++) g.update(H);
  g.input.mouse.down = false;
  ok(g.tracers.length + g.stats.shots === before, 'a passenger kept firing from the cabin');
}
{
  // the horde cannot grab whoever is already in the cabin
  const fake = { pos: { x: 100, y: 100 }, floor: 0, dead: false, evac: false, downed: false };
  g.players.push(fake);
  ok(g.pickTarget({ pos: { x: 0, y: 0 } }) === fake, 'a zombie still targets the passenger');
  g.players.pop();
}
ok(g.achievements.has('leaving_tonight'), 'boarding did not earn LEAVING TONIGHT');
for (let i = 0; i < 60 * 6 && g.heli.phase === 4; i++) g._heliStep(H);
ok(g.heli.phase === 5 && g.gameOver && g.evacuated,
  `the climb-out ended phase=${g.heli.phase} over=${g.gameOver} evac=${g.evacuated}`);
ok(g.board?.[0]?.evac === true, 'the evac run is not marked on the board');
ok(g.board?.[0]?.round === 25, `the board remembers round ${g.board?.[0]?.round}, want 25`);
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
  host.player.pos.x = 18.5 * 24; host.player.pos.y = 15.5 * 24 + 6;
  const hit = host.interactionFor(host.player);
  ok(hit?.type === 'heli', `the host's own body gets ${hit?.type ?? 'nothing'} at the pad`);
  host.doInteraction(host.player, hit);
  ok(host.heli.phase === 3, `the bird left with somebody still on the deck (phase ${host.heli.phase})`);
  // boarding is a vote: the guest's body has to press its own board
  const gbody = host.players.find((o) => o !== host.player);
  host.doInteraction(gbody, { type: 'heli' });
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

// ---- 10. the odd jobs that rode along with the bird ------------------------
{
  const g5 = boot();
  // the H is painted on the deck from the very first night, bird or no bird
  ok(g5.heli.phase === 0, 'a fresh run should have no bird yet');
  g5.map.setFloor(2); g5.useFloor(2); g5.player.floor = 2;
  g5.player.pos.x = 18.5 * 24; g5.player.pos.y = 15.5 * 24;
  g5.draw(nc(M.VW, M.VH).getContext('2d'));      // the empty deck must not throw

  // the bench moved into the attic, out of the weather
  const wb = g5.map.floors[2].workbench;
  ok(wb && Math.abs(wb.x - 32.5 * 24) < 1 && Math.abs(wb.y - 17.5 * 24) < 1,
    `the bench is not in the attic (${wb?.x}, ${wb?.y})`);
  ok(!g5.map.solidTileOn(2, 32, 17), 'the bench tile is not standable');
  g5.player.pos.x = wb.x; g5.player.pos.y = wb.y + 12;
  ok(g5.interactionFor(g5.player)?.type === 'workbench', 'the attic bench does not offer itself');

  // the wrecks in the fields: solid where the metal is, grass around it
  for (const [tx, ty] of [[30, 46], [31, 46], [63, 43], [64, 43], [65, 43], [63, 44], [64, 44], [65, 44]]) {
    ok(g5.map.solidTileOn(0, tx, ty), `the wreck at ${tx},${ty} is not solid`);
  }
  ok(!g5.map.solidTileOn(0, 29, 46) && !g5.map.solidTileOn(0, 66, 43),
    'the wrecks spilled solid tiles into the grass');
  g5.map.setFloor(0); g5.useFloor(0); g5.player.floor = 0;
  g5.draw(nc(M.VW, M.VH).getContext('2d'));      // wrecks must paint without a word

  // one box for the whole map: upstairs it neither answers nor shows
  const bs = g5.box.spot;
  g5.player.pos.x = bs.x + 6; g5.player.pos.y = bs.y;
  g5.player.floor = 0;
  ok(g5.interactionFor(g5.player)?.type === 'box', 'the box went quiet on its own floor');
  g5.map.setFloor(1); g5.useFloor(1); g5.player.floor = 1;
  g5.player.pos.x = bs.x + 6; g5.player.pos.y = bs.y;
  ok(g5.interactionFor(g5.player)?.type !== 'box', 'the box answered from the floor above');
  const proto = Object.getPrototypeOf(g5.box);
  const orig = proto.draw;
  let calls = 0;
  proto.draw = function (c, a) { calls++; return orig.call(this, c, a); };
  g5.draw(nc(M.VW, M.VH).getContext('2d'));
  proto.draw = orig;
  ok(calls === 0, `the box drew ${calls} times through the floorboards`);

  // a broadcast that long has to wrap inside its own box
  g5.voice = { text: ('the radio is testing the wrapping of a very long transmission '.repeat(4)).trim(), left: 3 };
  g5._drawVoice(nc(M.VW, M.VH).getContext('2d'), M.VW, M.VH);
  g5.draw(nc(M.VW, M.VH).getContext('2d'));

  // the pause screen: five clickable rows, and the last one walks you home
  g5.map.setFloor(0); g5.useFloor(0); g5.player.floor = 0;
  const { pauseHitTest, PAUSE_ROWS, pauseRowRect } = await import(SRC + '/hud.js');
  ok(PAUSE_ROWS.length === 5, `the pause menu has ${PAUSE_ROWS.length} rows, want 5`);
  g5.paused = true;
  for (let i = 0; i < 5; i++) {
    const r = pauseRowRect(i, M.VW, M.VH);
    ok(pauseHitTest(g5, M.VW, M.VH, r.x + 20, r.y + 15) === i, `row ${i} is not where it is drawn`);
  }
  // click RESUME
  g5.input.mouse.x = M.VW / 2; g5.input.mouse.y = pauseRowRect(0, M.VW, M.VH).y + 15;
  g5.input.mouse.pressed = true;
  g5.update(H); g5.input.endFrame();
  ok(!g5.paused, 'clicking RESUME did not resume');
  // click RETURN TO MENU
  g5.paused = true;
  g5.input.mouse.x = M.VW / 2; g5.input.mouse.y = pauseRowRect(4, M.VW, M.VH).y + 15;
  g5.input.mouse.pressed = true;
  g5.update(H); g5.input.endFrame();
  ok(!g5.started && g5.scene === 'menu' && !g5.paused,
    `RETURN TO MENU left started=${g5.started} scene=${g5.scene} paused=${g5.paused}`);
}

// ---- 8. the roof radio: scrap in, a crate every second round ---------------
{
  const g6 = boot();
  g6.map.setFloor(2); g6.useFloor(2); g6.player.floor = 2;
  g6.player.pos.x = 40.5 * 24; g6.player.pos.y = 12.5 * 24;
  let it6 = g6.interactionFor(g6.player);
  ok(it6?.type === 'radio' && !it6.affordable,
    `the dead radio offers ${it6?.type ?? 'nothing'} and refuses ${g6.player.salvage} scrap`);
  g6.player.salvage = 25;
  it6 = g6.interactionFor(g6.player);
  ok(!!it6?.affordable, '25 scrap does not cover the radio');
  g6.doInteraction(g6.player, it6);
  ok(g6.roofRadio.fixed === true && g6.player.salvage === 0,
    `the radio took the scrap: fixed=${g6.roofRadio.fixed} salvage=${g6.player.salvage}`);
  const crates0 = g6.supplies.length;
  g6.startRound(g6.round + 1);                       // an even round: a crate
  ok(g6.supplies.length === crates0 + 1 && g6.supplies[g6.supplies.length - 1].f === 2,
    'the even round brought no crate to the roof');
  g6.startRound(g6.round + 1);                       // an odd round: silence
  ok(g6.supplies.length === crates0 + 1, 'a crate fell on an odd round');
  g6.map.setFloor(2); g6.useFloor(2); g6.player.floor = 2;
  g6.draw(nc(M.VW, M.VH).getContext('2d'));          // the shack must draw
}

// ---- 9. the horde reads your footsteps --------------------------------------
{
  const g7 = boot();
  const west = g7.map.links[0], east = g7.map.links[1];
  ok(g7.map.hopTowards(0, 1)?.link === west, 'the west stair is not the default way up');
  g7.noteTrail(east.a.floor, east.a.tx, east.a.ty);
  g7.noteTrail(east.b.floor, east.b.tx, east.b.ty);
  g7.map.trail = g7.trail; g7.map.trailT = g7.time;
  ok(g7.map.hopTowards(0, 1)?.link === east, 'the horde ignored the hatch you came through');
  // and a window you climbed is a way in, not a 4000-cost detour
  const wtx = 20, wty = 19;
  ok(!g7.map._trailHas(0, wty * g7.map.w + wtx), 'an unwalked window reads as walked');
  g7.noteTrail(0, wtx, wty);
  ok(g7.map._trailHas(0, wty * g7.map.w + wtx), 'the window you came through left no trail');
}

// ---- 10. a window you walked through is cheaper for the horde -------------
{
  const g8 = boot();
  const F0b = g8.map.floors[0];
  let wi = -1;
  for (let i = 0; i < F0b.tiles.length; i++) if (F0b.tiles[i] === 3) { wi = i; break; }
  ok(wi >= 0, 'the map has no windows to crawl through');
  g8.map.trail = null; g8.map.trailT = g8.time;
  g8.rebuildFlow();
  const bare = F0b.dist[wi];
  g8.noteTrail(0, wi % g8.map.w, (wi / g8.map.w) | 0);
  g8.rebuildFlow();
  const lit = F0b.dist[wi];
  ok(Number.isFinite(bare) && lit < bare,
    `a window you crawled through is not cheaper to cross (${bare} -> ${lit})`);
}

console.log(fails.length ? `\n${fails.length} FAILURES:\n  ${fails.join('\n  ')}` : '\nHELI PASS  the roof ending, the radio and the two-column range all hold');
process.exit(fails.length ? 1 : 0);
