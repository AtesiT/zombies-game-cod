// Headless harness for the Magic Box.
//
// The crate has several homes but only ever exists in one place at a time --
// five on the ground, three on each floor above -- and it packs up and moves
// once the teddy bear comes for it. That reads, quite reasonably, as "there
// are several mystery boxes", so these tests pin down that there is exactly
// one, that it never lands somewhere you cannot stand, and that the arrow at
// the edge of the screen always leads you back to it.
import { nc, load } from './stub.mjs';

const M = await load();
const H = 1 / 60;
const T = 24;
const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };

let seed = 991;
Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

/** Record every call the frame makes, so the arrow can be found in it. */
function spy(ctx) {
  const calls = [];
  const proxy = new Proxy(ctx, {
    get(t, k) {
      const v = t[k];
      if (typeof v === 'function') return (...a) => { calls.push([k, ...a]); return v.apply(t, a); };
      return v;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  proxy.__calls = calls;
  return proxy;
}

/** Where the box arrow landed this frame, or null if there was none. */
function arrowAt(game) {
  const cv = nc(M.VW, M.VH);
  game.draw(cv.getContext('2d'));
  return game.hud._boxArrowAt ?? null;
}

function boot() {
  const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g.begin();
  g.startRound(1);
  g.powerOn = true;
  for (let i = 0; i < 20; i++) g.update(H);
  return g;
}

const goTo = (g, f) => { g.map.setFloor(f); g.useFloor(f); };

// ---- 1. there is one box, and every one of its homes is somewhere you can go
{
  const g = boot();
  for (let f = 0; f < 3; f++) {
    goTo(g, f);
    const spots = g.map.boxSpots;
    ok(spots.length >= 2, `storey ${f} only has ${spots.length} place(s) for the box`);
    g.map.buildFlow(g.map.playerStart.x, g.map.playerStart.y);
    for (const s of spots) {
      ok(!g.map.solidTileOn(f, s.tx, s.ty),
        `storey ${f}: the box home at ${s.tx},${s.ty} is inside something solid`);
      const d = g.map.dist[s.ty * g.map.w + s.tx];
      ok(d !== undefined && d < 1e8,
        `storey ${f}: you cannot walk to the box home at ${s.tx},${s.ty}`);
    }
    // no two homes on top of each other
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        ok(Math.hypot(spots[i].tx - spots[j].tx, spots[i].ty - spots[j].ty) > 3,
          `storey ${f}: two box homes sit on top of each other`);
      }
    }
    console.log(`  storey ${f}: ${spots.length} homes, all standable and reachable`);
  }
}

// ---- 2. it is drawn once, wherever it happens to be ------------------------
{
  const g = boot();
  const proto = Object.getPrototypeOf(g.box);
  const orig = proto.draw;
  let calls = 0;
  proto.draw = function (c, a) { calls++; return orig.call(this, c, a); };
  for (let i = 0; i < 30; i++) { calls = 0; g.update(H); g.draw(nc(M.VW, M.VH).getContext('2d')); ok(calls === 1, `frame ${i} drew ${calls} boxes`); }
  proto.draw = orig;
  console.log('  exactly one crate is drawn, every frame');
}

// ---- 3. the spot is always a real place, however you shuffle it ------------
{
  const g = boot();
  for (let round = 0; round < 400; round++) {
    if (round % 7 === 0) goTo(g, round % 3);
    if (round % 3 === 0) g.box.relocate();
    if (round % 11 === 0) g.box.state = 'leaving', g.box.timer = 0;
    g.update(H);
    const s = g.box.spot;
    ok(s && Number.isFinite(s.x) && Number.isFinite(s.y),
      `after ${round} shuffles the box has no real position`);
  }
  // and a guest whose list is shorter than the host's cannot fall off the end
  g.box.current = 99;
  ok(g.box.spot && Number.isFinite(g.box.spot.x), 'a synchronised index past the end breaks the box');
  console.log('  the crate always has a real position, even after 400 shuffles');
}

// ---- 4. it moves when it can, and does not pretend to when it cannot -------
{
  const g = boot();
  goTo(g, 0);                                   // five homes down here
  let moved = 0;
  for (let i = 0; i < 40; i++) {
    const before = g.box.current;
    g.box.relocate();
    if (g.box.current !== before) moved++;
  }
  ok(moved === 40, `it only moved ${moved}/40 times with five homes to choose from`);

  // a storey with a single home must not burn twenty dice rolls for nothing
  g.box.useSpots([{ x: 100, y: 100, tx: 4, ty: 4 }]);
  g.box.current = 0;
  g.box.relocate();
  ok(g.box.current === 0, 'it wandered off a storey that only has one home');
  ok(g.box.spot && g.box.spot.x === 100, 'it lost its only home');
  console.log('  it moves between homes when there are any, and stays put when there are none');
}

// ---- 5. the arrow finds it when it is off screen, and only then ------------
{
  const g = boot();
  goTo(g, 0);
  g.box.current = 0;
  // stand right next to the box: no arrow, you can see the thing
  const s = g.box.spot;
  g.player.pos.x = s.x + 40; g.player.pos.y = s.y + 40;
  g.update(H);
  g.cam.x = Math.max(0, Math.min(g.player.pos.x - M.VW / 2, g.map.w * T - M.VW));
  g.cam.y = Math.max(0, Math.min(g.player.pos.y - M.VH / 2, g.map.h * T - M.VH));
  ok(arrowAt(g) === null, 'the arrow shows even though the box is right there');

  // walk to the far side of the map: the arrow appears
  g.player.pos.x = g.map.w * T - 80; g.player.pos.y = g.map.h * T - 80;
  g.update(H);
  g.cam.x = Math.max(0, Math.min(g.player.pos.x - M.VW / 2, g.map.w * T - M.VW));
  g.cam.y = Math.max(0, Math.min(g.player.pos.y - M.VH / 2, g.map.h * T - M.VH));
  const a = arrowAt(g);
  ok(a, 'the box is off screen and nothing points at it');
  if (a) {
    // and it points the right way: towards the box, not away from it
    const cx = M.VW / 2, cy = M.VH / 2;
    const toBox = Math.atan2(s.y - g.cam.y - cy, s.x - g.cam.x - cx);
    const toArrow = Math.atan2(a.y - cy, a.x - cx);
    let diff = Math.abs(toBox - toArrow);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    ok(diff < 0.2, `the arrow points the wrong way (off by ${(diff * 57.3).toFixed(0)} deg)`);
    console.log(`  arrow sits at ${a.x.toFixed(0)},${a.y.toFixed(0)} and points `
      + `${(diff * 57.3).toFixed(1)} deg off the box`);
  }

  // and it flares for a few seconds after the crate has moved
  g.box.movedAt = g.time;
  ok(arrowAt(g), 'the arrow vanished right after the box moved');
  console.log('  the arrow is quiet when you can see the box, and flares after it moves');
}

// ---- 6. the move is announced ----------------------------------------------
{
  const g = boot();
  goTo(g, 0);
  g.box.current = 0;
  g.update(H);
  g.banner = null;
  g.box.state = 'leaving';
  g.box.timer = 0;
  g.update(H);
  g.update(H);
  const title = g.banner?.title ?? '(none)';
  ok(/BOX/.test(title), `no banner about the move (saw "${title}")`);
  console.log(`  banner after the move: ${title}`);
}

if (fails.length) {
  console.log('BOX FAIL:');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log('BOX PASS  one crate, many homes, and an arrow that always finds it');
