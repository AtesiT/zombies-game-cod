// The achievement card shares the top of the screen with the map, the sound
// chip, the floor tag and the round banner. It used to be a fixed 360 x 72
// rectangle at `w - 374, h * 0.16`, which on a 360-unit phone started 14 units
// outside the glass and on a laptop printed straight through the minimap and
// the SOUND IS OFF chip. This holds the four of them apart at every size.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nc, load } from './stub.mjs';

const { Game, Input, ACHIEVEMENTS } = await load();

const clearStorage = () => { for (const k of Object.keys(localStorage._d)) delete localStorage._d[k]; };

function scene(w, h) {
  clearStorage();
  const g = new Game(new Input(nc(w, h)));
  g.setViewport(w, h);
  g.begin();
  g.startRound(12);
  g.achievements.banner = ACHIEVEMENTS.find((a) => a.id === 'round_20') ?? ACHIEVEMENTS[0];
  g.achievements.bannerT = 1.2;
  return g;
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('the achievement card stays on the glass and out of the corner furniture', () => {
  for (const [w, h] of [[360, 640], [360, 560], [430, 930], [640, 360], [800, 500], [1280, 800], [1920, 1080]]) {
    const g = scene(w, h);
    g.banner = { title: 'THE BELLRINGER', sub: 'IT RINGS FOR YOU', t: 3, max: 4, big: true };
    const full = g.vw, tall = g.vh;
    const card = g.hud._toastRect(g, full, tall);
    assert.ok(card, `${w}x${h}: no card drawn`);
    assert.ok(card.x >= 0 && card.y >= 0, `${w}x${h}: card starts outside the glass at ${card.x},${card.y}`);
    assert.ok(card.x + card.w <= full && card.y + card.h <= tall,
      `${w}x${h}: card ends at ${card.x + card.w},${card.y + card.h}`);

    const mini = g.hud._miniRectFor(g, full);
    assert.ok(!overlaps(card, mini), `${w}x${h}: card covers the minimap`);
    const snd = g.hud._soundRectFor(g, full);
    if (snd) assert.ok(!overlaps(card, snd), `${w}x${h}: card covers the sound chip`);
    const band = g.hud._bannerBand(tall);
    assert.ok(!overlaps(card, { x: 0, y: band.y, w: full, h: band.h }),
      `${w}x${h}: card covers the round banner`);
    clearStorage();
  }
});

test('a long banner title is measured down to the glass, not run off it', () => {
  const written = [];
  for (const [w, h] of [[360, 640], [360, 560], [640, 360], [800, 500]]) {
    const g = scene(w, h);
    g.banner = { title: 'THE BELLRINGER', sub: 'IT RINGS FOR YOU', t: 3, max: 4, big: true };
    const c = nc(g.vw, g.vh), ctx = c.getContext('2d');
    ctx.fillText = (str) => written.push(str);
    const sprites = [];
    const real = ctx.drawImage;
    ctx.drawImage = (img, x, y, ...rest) => {
      if (img?.textInfo) sprites.push({ t: img.textInfo, x, y, w: img.width, h: img.height });
      return real.call(ctx, img, x, y, ...rest);
    };
    written.length = 0; sprites.length = 0;
    g.hud._banners(ctx, g, g.vw, g.vh);
    const boxes = sprites.map((s) => ({ l: s.x, r: s.x + s.w }));
    assert.deepEqual(boxes.length, 2, `${w}x${h}: expected a title and a subtitle`);
    for (const b of boxes) {
      assert.ok(b.l >= 0 && b.r <= g.vw, `${w}x${h}: banner text spans ${b.l}..${b.r} on ${g.vw}`);
    }
  }
});
