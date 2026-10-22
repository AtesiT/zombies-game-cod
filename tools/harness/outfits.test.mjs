// Outfits, the dash and the viewport: the three things a player asked for in
// one go, and the three things that are easiest to break quietly.
//
// The rules being protected here:
//   * ten outfits, every one earned by a badge that exists, every one with a
//     bonus that is neither nothing nor a second perk;
//   * a locked outfit cannot be worn by any door -- the menu, the code, a
//     hand-written localStorage value;
//   * the outfit the player picks survives a death, a restart and a quit;
//   * Shift is a dash with a five-second clock, and the clock is what the HUD
//     and Stamin-Up read;
//   * the view is the screen's shape, not a fixed 800x500 box.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nc, load, SRC } from './stub.mjs';
import { readFileSync, readdirSync } from 'node:fs';

const { Game, Input, VW, VH, ACHIEVEMENTS, settings } = await load();
const {
  SKINS, SKIN_ORDER, DEFAULT_SKIN, skinEffects, skinOwned, ownedSkins, loadSkin, saveSkin,
} = await import('../../src/skins.js');
const { DASH_TIME, DASH_CD, ENEMY_TYPES } = await import('../../src/entities.js');
const HUD = await import('../../src/hud.js');
const { buildArt } = await import('../../src/art.js');
const { perkEffects } = await import('../../src/perks.js');

const H = 1 / 60;
const fresh = () => new Game(new Input(nc(VW, VH)));

const clearStorage = () => { for (const k of Object.keys(localStorage._d)) delete localStorage._d[k]; };

// ---------------------------------------------------------------------------
//  The catalogue
// ---------------------------------------------------------------------------
test('ten outfits, one per badge, and every badge really exists', () => {
  assert.equal(SKIN_ORDER.length, 10, 'there are meant to be ten outfits');
  assert.equal(new Set(SKIN_ORDER).size, 10, 'a duplicate id in the catalogue');
  const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
  for (const id of SKIN_ORDER) {
    const skin = SKINS[id];
    assert.ok(skin, `${id} is in SKIN_ORDER but not in SKINS`);
    assert.ok(ids.has(skin.ach), `${id} is unlocked by '${skin.ach}', which is not a badge`);
    assert.ok(skin.name && skin.buff && skin.short, `${id} is missing its words`);
    assert.ok(/^#[0-9a-f]{6}$/i.test(skin.colour), `${id} has no colour to draw in the list`);
    assert.ok(skin.pal && Object.keys(skin.pal).length >= 4, `${id} barely changes the uniform`);
  }
  // one outfit per badge: two coats off one badge would leave a badge that
  // grants nothing and a coat that grants nothing
  const badges = SKIN_ORDER.map((id) => SKINS[id].ach);
  assert.equal(new Set(badges).size, badges.length, 'two outfits share a badge');
});

test('every bonus is real, small, and lands in the stat block', () => {
  const neutral = skinEffects(null);
  for (const id of SKIN_ORDER) {
    const fx = skinEffects(id);
    const moved = Object.keys(fx).filter((k) => k !== 'id' && fx[k] !== neutral[k]);
    assert.ok(moved.length >= 1, `${id} changes nothing at all`);
    for (const k of moved) {
      // a coat is a run skill, not a perk: nothing here may double a stat
      if (typeof fx[k] === 'number' && neutral[k] === 1) {
        assert.ok(fx[k] <= 1.6 && fx[k] >= 0.6, `${id} multiplies ${k} by ${fx[k]}`);
      }
    }
  }
  assert.equal(skinEffects('no-such-outfit'), neutral, 'an unknown id must stay neutral');
  assert.equal(skinEffects(undefined), neutral);
  // the specific promises the list makes to the player
  assert.equal(skinEffects('scout').speedMul, 1.08);
  assert.equal(skinEffects('speedloader').reloadMul, 0.85);
  assert.equal(skinEffects('juggernaut').bonusHp, 15);
  assert.equal(skinEffects('veteran').startArmor, 25);
  assert.equal(skinEffects('ghost').dashMul, 0.6);
});

test('an outfit is only wearable once its badge is earned, by any route', () => {
  clearStorage();
  const g = fresh();
  const id = 'scout';
  const badge = SKINS[id].ach;
  assert.equal(skinOwned(id, g.achievements), false, 'a fresh save owns nothing');
  assert.equal(g.equipSkin(id), false, 'the code let a locked coat on');
  assert.equal(g.player.skin, DEFAULT_SKIN, 'a body put on a coat nobody earned');

  g.achievements.unlock(badge);
  assert.equal(skinOwned(id, g.achievements), true);
  assert.deepEqual(ownedSkins(g.achievements), [id]);
  assert.equal(g.equipSkin(id), true);
  assert.equal(g.player.skin, id, 'the coat did not go on');
  assert.equal(loadSkin(g.achievements), id, 'the choice was not remembered');

  // the stat block follows the coat, immediately
  assert.ok(Math.abs(g.player.baseSpeed - 132 * 1.08) < 0.01,
    `the coat did not change the legs: baseSpeed ${g.player.baseSpeed}`);

  // back to the standard kit
  assert.equal(g.equipSkin(null), true);
  assert.equal(g.player.skin, null);
  assert.equal(loadSkin(g.achievements), null);
  clearStorage();
});

test('a hand-edited save cannot wear what the wall does not have', () => {
  clearStorage();
  localStorage.setItem('ndu.skin.v1', 'veteran');       // written, never earned
  const g = fresh();
  assert.equal(g.player.skin, null, 'a locked coat came off the disk onto the body');
  localStorage.setItem('ndu.skin.v1', 'not-a-coat');
  assert.equal(loadSkin(g.achievements), null, 'a made-up id survived the load');
  // saveSkin refuses unknown ids and never throws in private mode
  assert.equal(saveSkin('not-a-coat'), null);
  assert.equal(saveSkin('medic'), 'medic');
  localStorage.removeItem('ndu.skin.v1');
  clearStorage();
});

test('the coat survives a death, a restart and a quit', () => {
  clearStorage();
  const g = fresh();
  g.achievements.unlock(SKINS.ghost.ach);
  g.equipSkin('ghost');
  g.begin();
  assert.equal(g.player.skin, 'ghost', 'begin() took the coat off');
  g._restartRun();
  assert.equal(g.player.skin, 'ghost', 'a restart took the coat off');
  g._quitToMenu();
  assert.equal(g.player.skin, 'ghost', 'quitting took the coat off');
  assert.equal(loadSkin(g.achievements), 'ghost');
  clearStorage();
});

// ---------------------------------------------------------------------------
//  The bonuses, where the game actually spends them
// ---------------------------------------------------------------------------
test('the coat reaches the game: scrap, refills, armour, headshots, dash', () => {
  clearStorage();
  const g = fresh();

  // THE SCAVENGER: the salvage roll is scaled
  g.achievements.unlock(SKINS.scavenger.ach);
  g.equipSkin('scavenger');
  assert.equal(g.player.skinFx.salvageMul, 1.5);

  // THE HOARDER: one more throwable in the between-round refill
  const g2 = fresh();
  g2.achievements.unlock(SKINS.hoarder.ach);
  g2.equipSkin('hoarder');
  g2.begin();
  g2.player.giveThrowable('frag', 1);
  g2.player.grenades = 0;
  g2.startRound(2);                       // 2 a round, +1 from the coat
  assert.equal(g2.player.grenades, 3, `the Hoarder refilled ${g2.player.grenades}, not 3`);

  // THE VETERAN: the plate is handed out at the top of the night...
  const g3 = fresh();
  g3.achievements.unlock(SKINS.veteran.ach);
  g3.equipSkin('veteran');
  g3.begin();
  assert.equal(g3.player.armor, 25, 'the Veteran started with no armour');
  // ...and never refilled by a wave, or the coat would be free armour for ever
  g3.player.armor = 0;
  g3.startRound(5);
  assert.equal(g3.player.armor, 0, 'the Veteran got a free plate on wave five');

  // THE MARKSMAN: the headshot multiplier is on the damage path
  const g4 = fresh();
  g4.achievements.unlock(SKINS.marksman.ach);
  g4.equipSkin('marksman');
  assert.equal(g4.player.skinFx.headMul, 1.25);
  clearStorage();
});

// ---------------------------------------------------------------------------
//  The debug wardrobe: the reason it exists is to check all this in a hurry
// ---------------------------------------------------------------------------
test('the debug tab grants the badge and puts the coat on', () => {
  clearStorage();
  const g = fresh();
  g.debugOpen = true; g.paused = true; g.debugTab = 2;
  const rows = g.debugRows();
  assert.equal(rows.length, SKIN_ORDER.length + 2, 'the wardrobe tab lost a row');
  assert.deepEqual(rows.slice(0, SKIN_ORDER.length).map((r) => r.id),
    SKIN_ORDER.map((id) => `skin:${id}`), 'the rows do not follow the catalogue');
  assert.ok(rows.every((r) => r.local), 'a wardrobe row would be sent to the host');

  for (const id of SKIN_ORDER) {
    assert.equal(g.achievements.has(SKINS[id].ach), false, `${id} was already earned`);
    g._debugRun(`skin:${id}`);
    assert.equal(g.achievements.has(SKINS[id].ach), true, `the debug row did not grant ${id}'s badge`);
    assert.equal(g.player.skin, id, `the debug row did not put ${id} on`);
    assert.equal(loadSkin(g.achievements), id);
  }
  // the wardrobe now reports all ten, and "standard kit" takes it off again
  g._debugRun('skin:none');
  assert.equal(g.player.skin, null);
  assert.equal(ownedSkins(g.achievements).length, 10);

  // and the grant is permanent: a new game on the same machine still has them
  const g2 = fresh();
  assert.equal(ownedSkins(g2.achievements).length, 10, 'the grants did not reach the wall');
  clearStorage();
});

test('the debug panel on a phone still fits its rows', () => {
  clearStorage();
  const g = fresh();
  g.setViewport(430, 930);
  g.debugOpen = true; g.debugTab = 2;
  const p = HUD.debugPanel(g, g.vw, g.vh);
  assert.ok(p.x >= 0 && p.x + p.cw <= g.vw, `the panel is ${p.cw} wide on a ${g.vw}-unit screen`);
  assert.ok(p.y >= 0 && p.y + p.ch <= g.vh + 1, 'the panel runs off the bottom');
  p.rows.forEach((r, i) => {
    const y = p.y + p.head + (i + 0.5) * p.rowH;
    assert.ok(y < p.y + p.ch - 10, `row ${r.id} is under the footer`);
  });
  const ctx = nc(g.vw, g.vh).getContext('2d');
  assert.doesNotThrow(() => HUD.drawDebug(ctx, g, g.vw, g.vh));
  clearStorage();
});

// ---------------------------------------------------------------------------
//  The outfits screen
// ---------------------------------------------------------------------------
test('the wardrobe screen selects the row it draws, on any shaped screen', () => {
  clearStorage();
  const g = fresh();
  g.achievements.unlock(SKINS.scout.ach);
  g.equipSkin('scout');
  // open it the way a player does: the front page row, then Enter
  g.scene = 'menu';
  g.menuIndex = HUD.menuRows('menu', g).findIndex((r) => r.id === 'outfits');
  g.input.pressed.add('Enter'); g.update(H); g.input.endFrame();
  assert.equal(g.scene, 'outfits', 'the OUTFITS row did not open the wardrobe');
  // row 0 is the standard kit, so THE SCOUT (first in the catalogue) is row 1
  assert.equal(g.outfitIndex, 1, 'opening the wardrobe did not start on the worn coat');
  assert.equal(HUD.outfitIdAt(g, g.outfitIndex), 'scout');

  for (const [w, h] of [[800, 500], [430, 930], [1440, 810]]) {
    g.setViewport(w, h);
    const L = HUD.outfitsLayout(g, g.vw, g.vh);
    assert.ok(L.x >= 0 && L.x + L.cw <= g.vw, `${w}x${h}: the panel is ${L.cw} wide`);
    assert.ok(L.y >= 0 && L.y + L.ch <= g.vh, `${w}x${h}: the panel runs off the screen`);
    for (let i = 0; i < L.rows; i++) {
      const y = L.y + L.head + (i + 0.5) * L.rowH;
      assert.equal(HUD.outfitRowAt(g, g.vw, g.vh, g.vw / 2, y), i,
        `${w}x${h}: row ${i} does not hit-test as itself`);
    }
    assert.equal(HUD.outfitIdAt(g, 0), null, 'row 0 must be the standard kit');
    assert.equal(HUD.outfitIdAt(g, 1), SKIN_ORDER[0]);
    assert.equal(HUD.outfitIdAt(g, L.rows - 1), SKIN_ORDER[SKIN_ORDER.length - 1]);
    const ctx = nc(g.vw, g.vh).getContext('2d');
    assert.doesNotThrow(() => HUD.drawOutfits(ctx, g, g.vw, g.vh), `${w}x${h} threw`);
  }
  clearStorage();
});

test('picking a row in the wardrobe wears it, and a locked row only refuses', () => {
  clearStorage();
  const g = fresh();
  g.achievements.unlock(SKINS.scout.ach);
  g.scene = 'menu';
  g.menuIndex = HUD.menuRows('menu', g).findIndex((r) => r.id === 'outfits');
  g.input.pressed.add('Enter'); g.update(H); g.input.endFrame();
  assert.equal(g.scene, 'outfits');
  const press = (code) => { g.input.pressed.add(code); g.update(H); g.input.endFrame(); };
  const click = (row) => {
    const L = HUD.outfitsLayout(g, g.vw, g.vh);
    g.input.mouse.x = g.vw / 2;
    g.input.mouse.y = L.y + L.head + (row + 0.5) * L.rowH;
    g.input.mouse.pressed = true;
    g.update(H); g.input.endFrame();
  };

  click(1);                                  // THE SCOUT, earned above
  assert.equal(g.player.skin, 'scout', 'clicking an owned row did not wear it');

  click(2);                                  // FIELD MEDIC, still locked
  assert.equal(g.player.skin, 'scout', 'a locked row was worn');
  assert.equal(g.achievements.has(SKINS.medic.ach), false, 'a locked row granted itself');

  press('ArrowDown');                        // onto row 3, SPEED LOADER
  press('Enter');
  assert.equal(g.player.skin, 'scout', 'Enter wore a locked coat');
  press('Enter');                            // still locked: still nothing
  assert.equal(g.player.skin, 'scout');

  press('Escape');
  assert.equal(g.scene, 'menu', 'ESC did not leave the wardrobe');
  assert.equal(HUD.menuRows('menu', g)[g.menuIndex].id, 'outfits', 'ESC landed on the wrong row');
  clearStorage();
});

// ---------------------------------------------------------------------------
//  The dash
// ---------------------------------------------------------------------------
test('Shift dashes once, then waits five seconds', () => {
  clearStorage();
  const g = fresh();
  g.begin();
  g.paused = false;
  const p = g.player;
  p.pos.x = g.map.playerStart.x; p.pos.y = g.map.playerStart.y;

  const shift = () => { g.input.pressed.add('ShiftLeft'); g.update(H); g.input.endFrame(); };

  shift();
  assert.equal(p.dashT > 0, true, 'Shift did not dash');
  assert.ok(Math.abs(p.dashMax - DASH_CD) < 1e-6 || p.dashMax <= DASH_CD,
    `the clock started at ${p.dashMax}`);
  // the burst is real speed, not a walk with a different name
  assert.ok(Math.hypot(p.vel.x, p.vel.y) > 300, `the dash only reached ${Math.hypot(p.vel.x, p.vel.y).toFixed(0)} px/s`);

  // one press is one dash: holding the key does nothing while it burns
  const startCd = p.dashCd;
  for (let i = 0; i < 30; i++) { g.input.keys.add('ShiftLeft'); g.update(H); g.input.endFrame(); }
  g.input.keys.delete('ShiftLeft');
  assert.ok(p.dashCd < startCd, 'the clock did not run');
  assert.equal(p.dashT, 0, `the dash lasted ${p.dashT.toFixed(2)}s -- it should be a burst`);

  // and it is on cooldown: pressing again does nothing
  p.dashCd = 2;
  shift();
  assert.equal(p.dashT, 0, 'a second dash fired inside the cooldown');
  assert.ok(p.dashCd > 0);

  // once the clock is done it fires again
  p.dashCd = 0;
  shift();
  assert.ok(p.dashT > 0, 'the dash never came back');

  // a body that is down, stunned or in a menu does not dash
  for (const hurt of [{ downed: true }, { stunT: 1 }, { evac: true }]) {
    p.dashCd = 0; p.dashT = 0;
    Object.assign(p, hurt);
    shift();
    assert.equal(p.dashT, 0, `a body dashed while ${Object.keys(hurt)[0]}`);
    Object.assign(p, { downed: false, stunT: 0, evac: false });
  }
  p.dashCd = 0;
  g.paused = true;
  shift();
  assert.equal(p.dashT, 0, 'the game dashed while paused');
  clearStorage();
});

test('the dash is what the wire and the HUD see', () => {
  clearStorage();
  const g = fresh();
  g.begin();
  const p = g.player;
  g.input.pressed.add('ShiftLeft'); g.update(H); g.input.endFrame();
  assert.equal(p.sprinting, true, 'a dashing body must read as sprinting on the wire');
  assert.ok(p.dashMax >= 1, 'no clock for the HUD to draw');

  // the outfit and Stamin-Up both shorten the clock, and neither is free
  g.achievements.unlock(SKINS.ghost.ach);
  g.equipSkin('ghost');
  p.dashCd = 0; p.dashT = 0;
  g.input.pressed.add('ShiftLeft'); g.update(H); g.input.endFrame();
  assert.ok(p.dashMax < DASH_CD, `THE GHOST did not shorten the clock (${p.dashMax})`);
  const ghostMax = p.dashMax;
  p.perks.add('staminup'); p.applyPerks();
  p.dashCd = 0; p.dashT = 0;
  g.input.pressed.add('ShiftLeft'); g.update(H); g.input.endFrame();
  assert.ok(p.dashMax < ghostMax, 'STAMIN-UP did not shorten the clock the coat left');
  assert.ok(p.dashMax > 1, 'the two together are a dash every frame');

  // the HUD draws the clock without throwing, ready or not
  const ctx = nc(VW, VH).getContext('2d');
  p.dashCd = 0; p.dashT = 0;
  assert.doesNotThrow(() => g.hud.draw(ctx, g, g.vw, g.vh), 'the dash meter threw when it was ready');
  p.dashCd = 3.4;
  assert.doesNotThrow(() => g.hud.draw(ctx, g, g.vw, g.vh), 'the dash meter threw while it cooled');
  clearStorage();
});

// ---------------------------------------------------------------------------
//  The viewport
// ---------------------------------------------------------------------------
test('the view is the shape of the screen, not a fixed box', () => {
  clearStorage();
  const g = fresh();
  const original = { w: g.vw, h: g.vh };
  assert.deepEqual(original, { w: VW, h: VH }, 'a bare game should still be the classic 800x500');

  // a portrait phone: tall view, and the camera stays inside the map
  assert.equal(g.setViewport(430, 930), true);
  assert.equal(g.vw, 430);
  assert.equal(g.vh, 930);
  assert.ok(g.cam.x >= 0 && g.cam.y >= 0, 'the camera went negative on a resize');
  assert.ok(g.cam.y <= g.map.h * 24 - g.vh + 1, 'the camera left the map at the bottom');

  // the lighting layer is re-cut with it, or the shadows are the wrong size
  assert.equal(g.lighting.baseW, 430);
  assert.equal(g.lighting.baseH, 930);

  // never larger than the map: a view bigger than the world has nothing to
  // draw in the gap, and the camera clamp would have nothing to clamp to
  g.setViewport(99999, 99999);
  assert.ok(g.vw <= g.map.w * 24 && g.vh <= g.map.h * 24);

  // and back to something sane for the rest
  g.setViewport(VW, VH);
  assert.equal(g.setViewport(VW, VH), false, 'a no-op resize reported a change');
  clearStorage();
});

test('every screen still draws on a phone-shaped viewport', () => {
  clearStorage();
  const g = fresh();
  for (const [w, h] of [[430, 930], [800, 500], [1440, 810], [360, 640]]) {
    g.setViewport(w, h);
    g.input.setLogicalSize(w, h);
    const ctx = nc(g.vw, g.vh).getContext('2d');
    for (const scene of ['menu', 'mp', 'rooms', 'waiting']) {
      g.scene = scene;
      g.started = false;
      assert.doesNotThrow(() => g.draw(ctx), `the ${scene} screen threw at ${w}x${h}`);
    }
    g.scene = 'menu';
    assert.doesNotThrow(() => g.draw(ctx), `the front page threw at ${w}x${h}`);
    // the front page's rows all fit, and all hit-test to themselves
    const L = HUD.menuLayout('menu', g, g.vw, g.vh);
    const rows = HUD.menuRows('menu', g);
    rows.forEach((r, i) => {
      const y = L.top + i * L.step;
      assert.ok(y + L.step / 2 <= g.vh, `${w}x${h}: row ${r.id} is off the bottom`);
      assert.equal(HUD.menuHitTest('menu', g.vw / 2, y, g), i, `${w}x${h}: row ${r.id} hit-tests wrong`);
    });
    // and a live round, HUD and all
    g.begin();
    for (let i = 0; i < 20; i++) { g.update(H); g.input.endFrame(); }
    assert.doesNotThrow(() => g.draw(ctx), `a round threw at ${w}x${h}`);
    g.reset();
  }
  clearStorage();
});

// ---------------------------------------------------------------------------
//  Co-op: the coat has to be visible on the other machine
// ---------------------------------------------------------------------------
test('the outfit travels on the wire, in both directions', () => {
  clearStorage();
  const host = fresh();

  // the snapshot index: every catalogue id round-trips, and the standard kit
  // is the one value that is not an index at all
  const order = SKIN_ORDER;
  for (const id of order) {
    host.achievements.unlock(SKINS[id].ach);
    host.player.setSkin(id);
    const snap = host.net.snapshot();
    const e = snap.p[0];
    const idx = e[26];
    assert.equal(order[idx], id, `${id} did not survive the snapshot (index ${idx})`);
  }
  host.player.setSkin(null);
  const none = host.net.snapshot().p[0][26];
  assert.ok(none < 0 || none > order.length - 1, 'the standard kit collided with a coat index');

  // a guest applies what arrives, through setSkin (so the stat block follows)
  const g2 = fresh();
  g2.achievements.unlock(SKINS.medic.ach);
  g2.player.setSkin('medic');
  const e = [0, 10, 10, 0, 100, 100, 0, 0, 'm1911', 8, 40, 0, 0, 0, 0, 0, 0, 0, 'GUEST',
    0, 0, 0, 0, 0, 0, null, order.indexOf('medic')];
  g2.net._skinWire(g2.player, { skin: order[e[26]] });
  assert.equal(g2.player.skin, 'medic', 'the wire did not settle the coat');
  g2.net._skinWire(g2.player, { skin: order[0] });
  assert.equal(g2.player.skin, order[0], 'a coat change never reached the body');
  assert.ok(Math.abs(g2.player.baseSpeed - 132 * 1.08) < 0.01, 'the new coat did not change the stats');
  clearStorage();
});

// ---------------------------------------------------------------------------
//  The dog: a dog, at dog size
// ---------------------------------------------------------------------------
test('the hellhound is a dog, three times smaller than the pony it was', () => {
  const dog = ENEMY_TYPES.dog;
  // it was 1.75 on a 26x16 sprite -- 45x28 world pixels, wider than two
  // soldiers. It is drawn at 1:1 now: 26x16, and it must not creep back up.
  assert.ok(dog.scale <= 1.05, `the hound is drawn at ${dog.scale}`);
  assert.ok(26 * dog.scale <= 30, 'nose to tail it should be about one tile');
  assert.ok(dog.r >= 5 && dog.r <= 8, `the hound collides as a ${dog.r}-unit body`);
  // the hit box follows the body down: a small dog is a small target
  assert.ok(dog.hitScale >= 1.2 && dog.hitScale <= 1.5, `hitScale is ${dog.hitScale}`);
  // and the sprite itself is still a quadruped's frame, not the human one
  const art = buildArt();
  assert.ok(art.dogFrames?.[0] && art.dogFrames.length === 2, 'the trot frames are missing');
  assert.ok(art.dogFrames[0].width >= 24 && art.dogFrames[0].height >= 14,
    `the hound is still ${art.dogFrames[0].width}x${art.dogFrames[0].height}`);
});

// ---------------------------------------------------------------------------
//  Nothing else in the tree is allowed to forget the new switch
// ---------------------------------------------------------------------------
test('nothing in src still asks for the settings row we removed', () => {
  const files = readdirSync(SRC).filter((f) => f.endsWith('.js'));
  const offenders = [];
  for (const f of files) {
    const src = readFileSync(`${SRC}/${f}`, 'utf8');
    if (/settings\.get\(['"]screen['"]\)/.test(src)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], 'these files still read the removed SCREEN setting');
  assert.ok(!('screen' in (settings.values ?? {})), 'the old row is still in the settings object');
  assert.ok('view' in settings.values, 'the PICTURE SIZE row is missing');
});
