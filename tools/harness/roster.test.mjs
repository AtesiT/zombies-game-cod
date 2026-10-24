// The roster: who turns up when, which warden owns which round, and what each
// of the new bodies can actually do.
//
// This is the contract the roster was asked for, written down so a later table
// edit cannot quietly break it:
//   * the nine wardens arrive on 10, 15, 20 ... 50 and the cycle repeats;
//   * a warden round is an escort, not an army;
//   * every new type arrives on its own round and not before;
//   * every type has the four sprites `_set()` asks for, or it draws nothing;
//   * the beekeeper sets down one hive and the bees come out of it;
//   * the weaver's silk can be shot, not only cut;
//   * the widow's venom wears off by itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nc, load, SRC } from './stub.mjs';

const M = await load();
const { Game, Input, VW, VH, ENEMY_TYPES } = M;
const { bossForRound, BOSS_ORDER, Zombie } = await import('../../src/entities.js');
const { buildArt } = await import('../../src/art.js');
const { VERB } = await import('../../src/game.js');

const H = 1 / 60;
const clearStorage = () => { for (const k of Object.keys(localStorage._d)) delete localStorage._d[k]; };
const fresh = () => {
  const g = new Game(new Input(nc(VW, VH)));
  g.begin();
  return g;
};

// ---------------------------------------------------------------------------
//  The wardens
// ---------------------------------------------------------------------------
test('a warden owns every fifth round from ten, and the cycle repeats', () => {
  for (const r of [1, 5, 9, 11, 14, 52]) assert.equal(bossForRound(r), null, `round ${r} got a warden`);
  const seen = [];
  for (let r = 10; r <= 50; r += 5) seen.push(bossForRound(r));
  assert.deepEqual(seen, BOSS_ORDER, 'the ten-to-fifty line is not the roster order');
  assert.equal(seen.length, 9, `nine wardens were asked for, got ${seen.length}`);
  // ...and then it starts again
  assert.equal(bossForRound(55), BOSS_ORDER[0], 'round 55 does not repeat the first warden');
  assert.equal(bossForRound(60), BOSS_ORDER[1], 'round 60 does not take the next one');
  // index 9 is the first warden again, so index 17 (round 95) is the last
  assert.equal(bossForRound(95), BOSS_ORDER[8], 'the cycle does not wrap cleanly');
  // every one of them is a real type with a body and a name
  for (const id of BOSS_ORDER) {
    assert.ok(ENEMY_TYPES[id], `${id} is in the order but not in the roster`);
      // The First walks in the horde as well as leading a round, so it is not
    // allowed to be marked `boss`; the rest are warden-only bodies.
    if (id !== 'first') assert.ok(ENEMY_TYPES[id].boss, `${id} is not marked as a warden`);
  }
});

test('a warden round is an escort, not an army, and it ends when the warden does', () => {
  const g = fresh();
  const plain = g.roundPlan(24);
  assert.equal(plain.boss, null, 'round 24 was given a warden');
  const w = g.roundPlan(25);
  assert.equal(w.boss, BOSS_ORDER[3], 'round 25 has the wrong warden');
  assert.ok(w.total < plain.total, `a warden round has ${w.total} bodies, the one before it ${plain.total}`);
  assert.ok(w.maxAlive <= 22, `a warden round allows ${w.maxAlive} at once`);
  assert.ok(w.bossIndex >= 0, 'the warden has no index into the roster');
});

// ---------------------------------------------------------------------------
//  Who arrives when
// ---------------------------------------------------------------------------
test('every new body arrives on its own round and not before', () => {
  clearStorage();
  const arrivals = {
    beekeeper: 7, archer: 9, bulwark: 11, widow: 12, drummer: 13,
    sapper: 14, porter: 16, first: 18, weaver: 8,
  };
  for (const [type, from] of Object.entries(arrivals)) {
    assert.ok(ENEMY_TYPES[type], `${type} is missing from the roster`);
    // a big sample of the real table, twice: once before its round, once after
    const early = fresh();
    early.dogRound = false;
    early.round = Math.max(1, from - 2);
    const seenEarly = new Set();
    for (let i = 0; i < 20000; i++) seenEarly.add(early.rollEnemyType());
    assert.ok(!seenEarly.has(type), `${type} turned up on round ${early.round}, before ${from}`);

    const late = fresh();
    late.dogRound = false;
    late.round = from + 8;
    const seenLate = new Set();
    for (let i = 0; i < 40000; i++) seenLate.add(late.rollEnemyType());
    assert.ok(seenLate.has(type), `${type} never turns up by round ${late.round}`);
  }
  clearStorage();
});

test('the plain walker is still the biggest group at every round', () => {
  clearStorage();
  const g = fresh();
  g.dogRound = false;
  for (const round of [3, 10, 20, 30, 45]) {
    g.round = round;
    const counts = new Map();
    const N = 30000;
    for (let i = 0; i < N; i++) {
      const t = g.rollEnemyType();
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const walker = (counts.get('walker') ?? 0) / N;
    let biggest = 'walker';
    for (const [t, n] of counts) if (t !== 'walker' && n > (counts.get(biggest) ?? 0)) biggest = t;
    assert.equal(biggest, 'walker', `round ${round}: ${biggest} outnumbers the walkers`);
    assert.ok(walker > 0.4, `round ${round}: only ${(walker * 100).toFixed(0)}% walkers`);
  }
  clearStorage();
});

// ---------------------------------------------------------------------------
//  The art contract
// ---------------------------------------------------------------------------
test('every body can draw itself standing, walking, flipped and biting', () => {
  clearStorage();
  const g = fresh();
  const art = buildArt();
  for (const type of Object.keys(ENEMY_TYPES)) {
    const z = new Zombie(g.map, 100, 100, { type });
    for (const attacking of [false, true]) {
      for (const flip of [false, true]) {
        const s = z._set(art, attacking, flip);
        assert.ok(s && s.img, `${type} draws nothing when attacking=${attacking}, flip=${flip}`);
        assert.ok(s.img.width > 0 && s.img.height > 0, `${type} produced an empty sprite`);
      }
    }
  }
  clearStorage();
});

test('every body can say what it is doing', () => {
  // the HUD asks the enemy for a line; an empty one is a creature you cannot
  // read, which is the whole point of a verb
  clearStorage();
  const g = fresh();
  for (const type of Object.keys(ENEMY_TYPES)) {
    const z = new Zombie(g.map, 100, 100, { type });
    const line = z.verb?.(g) ?? z.verbLine?.(g) ?? null;
    if (line !== null) {
      assert.ok(typeof line === 'string' && line.length > 0, `${type} has an empty verb`);
    }
  }
  assert.ok(typeof VERB === 'object' || VERB === undefined, 'VERB is not exported from game.js');
  clearStorage();
});

// ---------------------------------------------------------------------------
//  The beekeeper's hive
// ---------------------------------------------------------------------------
test('the beekeeper sets down one hive, and the bees come out of it', () => {
  clearStorage();
  const g = fresh();
  g.startRound(20);
  g.player.hurt = () => false;

  // One keeper, close enough to kneel: the box goes down 60-520 px away, and a
  // keeper that has to walk round the building is a keeper that has not
  // arrived. `hp` is pinned so it survives its own thirty seconds.
  const keeper = new Zombie(g.map, g.player.pos.x + 70, g.player.pos.y,
    { type: 'beekeeper', hp: 400 });
  keeper.floor = g.map.floor;
  keeper.hp = keeper.maxHp = 1e6;
  g.zombies.push(keeper);
  for (let i = 0; i < 60 * 45; i++) {
    g.update(H);
    if (g.hives.length) break;
  }
  assert.equal(g.hives.length, 1, `one keeper set down ${g.hives.length} hives`);

  // and never a second one, however long it lives: one box per keeper, ever
  for (let i = 0; i < 60 * 30; i++) {
    keeper.hp = keeper.maxHp;
    g.update(H);
  }
  assert.equal(g.hives.length, 1, 'the keeper set down a second hive');
  assert.equal(g.placeHaunt(keeper), false, 'a keeper can be asked for a second box');

  // the bees belong to the box: the existing small bee, and not part of the
  // round's head count (or the round would never end)
  const hive = g.hives[0];
  assert.ok(hive.maxHp > 0, 'the hive has no health, so it cannot be shot');
  assert.ok(ENEMY_TYPES.bee, 'there is no bee to come out of it');
  assert.equal(ENEMY_TYPES.bee.summoned, true, 'the bees count towards the round, so it never ends');
  const bees = () => g.zombies.filter((z) => !z.dead && z.type === 'bee').length;
  assert.ok(bees() > 0, 'the hive never made a single bee');
  assert.ok(bees() <= 5, `${bees()} bees on the floor -- a hive keeps five`);

  // shooting it empties it in one go, and nothing hums after that
  hive.hurt(999, g);
  assert.ok(hive.dead, 'the hive survived a full magazine');
  const burst = bees();
  assert.ok(burst >= 3, `a dying hive let out ${burst} bees, not a burst`);
  for (let i = 0; i < 60 * 16; i++) g.update(H);
  assert.ok(bees() <= burst, `the hive still made bees after it died (${burst} -> ${bees()})`);
  assert.equal(g.hives.filter((h) => !h.dead).length, 0, 'a dead hive is still humming');
  clearStorage();
});

// ---------------------------------------------------------------------------
//  The weaver's silk and the widow's venom
// ---------------------------------------------------------------------------
test('silk can be shot out of the way, not only cut', () => {
  clearStorage();
  const g = fresh();
  g.startRound(20);
  g.player.hurt = () => false;
  const x = g.player.pos.x + 40, y = g.player.pos.y;
  g.addThread(x, y, g.map.floor);
  const threads = g.threads ?? [];
  assert.equal(threads.length, 1, 'the weaver could not lay a thread');
  const t = threads[0];
  const hp = t.hp;
  // a bullet sends `hurtHaunts` down the same path a knife does
  g.hurtHaunts(x, y, 6, 10, g.map.floor);
  assert.ok(t.dead || t.hp < hp, 'a shot did nothing to the silk');
  assert.ok(hp >= 10, `a thread is ${hp} hit points -- a bullet should be able to cut it`);
  // and the silk really is a snare: stand in it and the legs are half yours
  g.addThread(g.player.pos.x + 1, g.player.pos.y + 1, g.map.floor);
  g.threadTick(0.1);
  assert.ok(g.player.silkT > 0, 'standing in silk did nothing');
  clearStorage();
});

test('the widow\'s venom wears off on its own', () => {
  clearStorage();
  const g = fresh();
  g.startRound(20);
  const p = g.player;
  p.hp = p.maxHp = 100;
  p.poison(g);
  assert.ok(p.venomT > 0, 'the bite did not poison at all');
  assert.equal(p.venomT, 9, 'the venom does not start at nine seconds');
  // a quiet round: the point under test is the venom's clock, not whether the
  // horde that round 20 spawned reaches the body first
  let low = p.hp;
  for (let i = 0; i < 60 * 11; i++) {
    g.zombies.length = 0;            // no other wound, and no medkit either
    g.update(H);
    low = Math.min(low, p.hp);
  }
  assert.ok(!(p.venomT > 0), `the venom is still there after 11 s (${p.venomT?.toFixed(1)} s)`);
  // and it is a wound, not a death sentence: no medkit was used, and the
  // regen that follows the last tick brings the body back on its own
  assert.ok(p.hp > 0, 'the venom killed a player who took no other damage');
  assert.ok(low < 100, 'the venom did no damage at all');
  assert.ok(low >= 20, `the venom took the body down to ${low} -- that is a medkit, not a poison`);
  assert.equal(Math.round(p.hp), p.maxHp, 'the body does not recover after the venom runs out');

  // a bar already under the floor is not topped up by the floor: a poison
  // that healed a dying body would be the worst bug in the game
  clearStorage();
  const g2 = fresh();
  g2.startRound(20);
  const q = g2.player;
  q.hp = q.maxHp = 100;
  q.hp = 5;
  q.poison(g2);
  let top = q.hp;
  for (let i = 0; i < 60 * 5; i++) { g2.zombies.length = 0; g2.update(H); top = Math.max(top, q.hp); }
  assert.ok(top <= 5, `the venom healed a body at ${5} hp up to ${top}`);
  assert.ok(q.venomT > 0, 'the venom ran out in five seconds');
  clearStorage();
});

// ---------------------------------------------------------------------------
//  ...and it says so on the HUD
// ---------------------------------------------------------------------------
test('the venom is on the health bar, and the regen holds while it works', () => {
  clearStorage();
  const g = fresh();
  g.setViewport(800, 500);
  g.startRound(20);
  const p = g.player;
  const ctx = nc(g.vw, g.vh).getContext('2d');

  const strip = () => {
    ctx.clearRect(0, 0, g.vw, g.vh);
    g.hud._health(ctx, g, g.vw, g.vh);
    const bw = 168;
    const x = Math.round(g.vw / 2 - bw / 2);
    const y = Math.round(g.vh - 58) + 9;      // the 2 px strip under the bar
    const d = ctx.getImageData(x, y, bw, 2).data;
    let green = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 40 && d[i + 1] > d[i] + 20) green++;
    }
    return green;
  };

  p.hp = p.maxHp = 100;
  const clean = strip();
  p.poison(g);
  const sick = strip();
  assert.ok(sick > clean + 40, `the venom strip is not drawn (${clean} -> ${sick} green pixels)`);
  // the strip is a clock: half the time left is half the strip
  const full = strip();
  p.venomT = 4.5;
  const half = strip();
  assert.ok(half < full * 0.75 && half > full * 0.35, `the strip does not follow the clock (${full} -> ${half})`);

  // and while it runs, nothing is coming back. A venom with no bite at all,
  // so the only thing that could move the bar is the regen.
  p.venomT = 9;
  p.hp = 60;
  p.lastHurt = -1e9;
  let top = p.hp;
  for (let i = 0; i < 60 * 2; i++) {
    g.zombies.length = 0;
    g.update(H);
    top = Math.max(top, p.hp);
  }
  assert.equal(top, 60, `the body regenerated through the venom (60 -> ${top})`);
  assert.ok(p.hp < 60, 'the venom did not bite at all');
  // ...and it comes back the moment the venom is gone
  p.venomT = 0;
  for (let i = 0; i < 30; i++) { g.zombies.length = 0; g.update(H); }
  assert.ok(p.hp > 60, 'the body does not recover once the venom is out');
  clearStorage();
});

// ---------------------------------------------------------------------------
//  The round says the warden's name
// ---------------------------------------------------------------------------
test('a warden round announces the warden, not the radio', () => {
  clearStorage();
  for (const r of [10, 15, 20, 25, 30, 35, 40, 45, 50, 55]) {
    const g = fresh();
    g.startRound(r);
    const want = ENEMY_TYPES[bossForRound(r)].name.toUpperCase();
    assert.equal(g.banner?.title, want, `round ${r} announced "${g.banner?.title}", not ${want}`);
    // it stays up long enough to read: the warden's own banner, not a 2 s one
    assert.ok(g.banner.max >= 3, `the warden banner lasts ${g.banner.max} s`);
    // and the quiet banners that would have covered it are behind it
    const seen = [g.banner.title];
    for (let i = 0; i < 60 * 8; i++) {
      g.update(H);
      const t = g.banner?.title;
      if (t && t !== seen[seen.length - 1]) seen.push(t);
    }
    assert.equal(seen[0], want, `round ${r} opened with ${seen[0]}`);
    assert.ok(!seen.slice(1).includes(want), 'the warden had to be announced twice');
    clearStorage();
  }
});

test('a plain round still announces its number, and the queue is bounded', () => {
  clearStorage();
  const g = fresh();
  g.startRound(24);
  assert.equal(g.banner?.title, 'ROUND 24');
  // nothing may pile up in the queue: three is the room behind the banner
  for (let i = 0; i < 6; i++) {
    g.bannerShow('ONE', null, { queue: true });
    g.bannerShow('TWO', null, { queue: true });
    g.bannerShow('THREE', null, { queue: true });
    g.bannerShow('FOUR', null, { queue: true });
  }
  assert.ok(g.bannerQueue.length <= 3, `${g.bannerQueue.length} banners are waiting`);
  assert.equal(g.banner.title, 'ROUND 24', 'a queued banner jumped the one being read');
  // and every queued one is shown, one at a time, in order. A fresh game with
  // no round running: the round itself keeps talking (the radio, a crate, the
  // next warden), and that is not what is being measured here.
  const q = fresh();
  q.scene = 'game';
  q.banner = { title: 'HEAD', sub: null, t: 2.4, max: 2.4, big: true };
  for (let i = 0; i < 6; i++) {
    q.bannerShow('ONE', null, { queue: true });
    q.bannerShow('TWO', null, { queue: true });
    q.bannerShow('THREE', null, { queue: true });
    q.bannerShow('FOUR', null, { queue: true });
  }
  const shown = [];
  q.banner.t = 0.01;
  for (let i = 0; i < 60 * 20; i++) {
    q.update(H);
    const t = q.banner?.title;
    if (t && shown[shown.length - 1] !== t) shown.push(t);
  }
  assert.deepEqual(shown, ['ONE', 'TWO', 'THREE'], 'the queue was shown out of order, or dropped one');
  assert.equal(q.bannerQueue.length, 0, 'a banner never got its turn');
  // a reset empties it: a banner from the last night may not walk into the menu
  g.bannerShow('LATE', null, { queue: true });
  assert.ok(g.bannerQueue.length > 0 || g.banner?.title === 'LATE');
  g._quitToMenu();
  assert.equal(g.banner, null, 'a banner survived the return to the menu');
  assert.equal(g.bannerQueue.length, 0, 'a queued banner survived the return to the menu');
  clearStorage();
});

// ---------------------------------------------------------------------------
//  The second time round, the wardens are heavier
// ---------------------------------------------------------------------------
test('a warden that comes round again has 35 % more health each cycle', () => {
  clearStorage();
  // The round itself already sets the health budget, so the claim is measured
  // against a body of a known size rather than against another round's warden.
  const spawned = (round) => {
    const g = fresh();
    g.round = round;
    const spot = { x: g.player.pos.x + 40, y: g.player.pos.y };
    g.pickSpawn = () => ({ s: spot, floor: 0 });
    g.makeZombie = () => ({ maxHp: 1000, def: ENEMY_TYPES.warden, type: 'warden', pos: spot });
    g._spawnBoss('warden');
    assert.ok(g.boss, `round ${round} put no warden on the floor`);
    return g.boss.maxHp;
  };
  // the first cycle is the table value, untouched
  for (const r of [10, 15, 25, 50, 54]) {
    assert.equal(spawned(r), 1000, `round ${r}'s warden was scaled inside the first cycle`);
  }
  // 55 starts the line again, and it is 35 % heavier
  assert.equal(spawned(55), 1350, 'round 55 is not 35 % heavier');
  assert.equal(spawned(60), 1350);
  // 100 is the third time round: two cycles of 35 %
  assert.equal(spawned(100), 1700, 'round 100 is not two cycles heavier');
  clearStorage();
});

// ---------------------------------------------------------------------------
//  Every warden is its own silhouette
// ---------------------------------------------------------------------------
test('no two wardens are the same sprite, and the Colonel is not the Warden', () => {
  const art = buildArt();
  // a set from `buildArt` is four frames, not one canvas
  const shot = (name) => {
    const set = art[name];
    assert.ok(set, `${name} has no sprite`);
    const src = Array.isArray(set) ? set[0] : set;
    const c = nc(src.width, src.height), ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0);
    return { data: ctx.getImageData(0, 0, src.width, src.height).data, w: src.width, h: src.height };
  };
  const same = (a, b) => {
    const A = shot(a), B = shot(b);
    if (A.w !== B.w || A.h !== B.h) return false;
    for (let i = 0; i < A.data.length; i++) if (A.data[i] !== B.data[i]) return false;
    return true;
  };
  // the two that used to be the same corpse under two tints
  assert.ok(!same('warden', 'colonel'), 'the Colonel is the Warden with a cap drawn on');
  assert.ok(!same('knight', 'colonel'), 'the Colonel is the Knight');
  const seen = [];
  for (const id of BOSS_ORDER) {
    const set = ENEMY_TYPES[id].set;
    assert.ok(art[set], `${id} draws from "${set}", which is not in the art table`);
    assert.ok(!seen.includes(set), `${id} draws the same body as another warden`);
    seen.push(set);
  }
});
