import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nc, load } from './stub.mjs';
import { ACHIEVEMENT_ICONS, ACHIEVEMENT_ICON_SIZE, drawAchievementIcon } from '../../src/achievementIcons.js';
const M = await load();
const { Achievements } = await import('../../src/achievements.js');
const { drawAchievements } = await import('../../src/hud.js');

test('every achievement has a distinct, valid hand-pixelled badge', () => {
  const seen = new Set();
  assert.equal(ACHIEVEMENT_ICON_SIZE, 12);
  for (const a of M.ACHIEVEMENTS) {
    const rows = ACHIEVEMENT_ICONS[a.icon];
    assert.ok(rows, `missing artwork for ${a.id}`);
    assert.ok(rows.length <= 12 && rows.length >= 10);
    assert.ok(rows.every((row) => row.length === 12 && /^[.1234]+$/.test(row)));
    assert.ok(!seen.has(rows.join('/')), `duplicate badge for ${a.id}`);
    seen.add(rows.join('/'));
  }
  assert.equal(seen.size, M.ACHIEVEMENTS.length);
});

test('badges draw integer pixels inside bounds, preserving alpha and canvas state', () => {
  for (const a of M.ACHIEVEMENTS) for (const scale of [1, 2, 3]) {
    const c = nc(64, 64), ctx = c.getContext('2d');
    ctx.fillStyle = '#abcdef'; ctx.globalAlpha = 0.5;
    drawAchievementIcon(ctx, a.icon, 4.2, 5.4, scale);
    assert.ok(Math.abs(ctx.globalAlpha - 0.5) < 1 / 255);
    // Native canvas caches a stale fillStyle getter after restore; verify paint.
    ctx.fillRect(0, 0, 1, 1);
    const restored = ctx.getImageData(0, 0, 1, 1).data;
    assert.ok(restored[0] > 150 && restored[1] > 180 && restored[2] > 220);
    ctx.clearRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 64, 64).data;
    let pixels = 0;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const alpha = data[(y * 64 + x) * 4 + 3];
      if (!alpha) continue;
      assert.ok(x >= 4 && y >= 5 && x < 4 + 12 * scale && y < 5 + 12 * scale, a.id);
      assert.ok(alpha === 127 || alpha === 128, 'no antialiased edges or overlapping pixels');
      pixels++;
    }
    assert.ok(pixels > 25 * scale * scale);
  }
});

test('locked badges keep their silhouettes but become muted; unknown badge has a fallback', () => {
  for (const a of M.ACHIEVEMENTS) {
    const c = nc(24, 24), ctx = c.getContext('2d');
    drawAchievementIcon(ctx, a.icon, 0, 0, 2, true);
    const earned = ctx.getImageData(0, 0, 24, 24).data;
    ctx.clearRect(0, 0, 24, 24); drawAchievementIcon(ctx, a.icon, 0, 0, 2, false);
    const locked = ctx.getImageData(0, 0, 24, 24).data;
    assert.notDeepEqual(earned, locked);
    for (let i = 3; i < earned.length; i += 4) assert.equal(earned[i], locked[i]);
  }
  const c = nc(24, 24), ctx = c.getContext('2d');
  assert.doesNotThrow(() => drawAchievementIcon(ctx, 'future-achievement', 0, 0));
  assert.ok(ctx.getImageData(0, 0, 24, 24).data.some((v) => v > 0));
});

test('existing saved achievements and unlock queues survive the artwork change', () => {
  localStorage.setItem('ndu.achievements.v1', JSON.stringify(['first_blood', 'round_40']));
  const a = new Achievements();
  assert.deepEqual([...a.unlocked], ['first_blood', 'round_40']);
  assert.equal(a.unlock('first_blood'), null);
  const earned = a.unlock('field_medic'); a.update(0);
  assert.equal(earned.icon, 'medic'); assert.equal(a.banner, earned);
  assert.equal(new Achievements().has('field_medic'), true);
  localStorage.removeItem('ndu.achievements.v1');
});

test('list and every unlock toast render pixel icons, and descriptions fit within the toast', () => {
  const g = new M.Game(new M.Input(nc(800, 500)));
  const c = nc(800, 500), ctx = c.getContext('2d');
  g.achievements.unlocked = new Set(M.ACHIEVEMENTS.filter((_, i) => i % 2 === 0).map((a) => a.id));
  for (let scroll = 0; scroll < M.ACHIEVEMENTS.length; scroll += 7) {
    g.achScroll = scroll;
    assert.doesNotThrow(() => drawAchievements(ctx, g, 800, 500));
  }
  const written = [], fillText = ctx.fillText.bind(ctx);
  ctx.fillText = (str, x, y, max) => { written.push({ str, x, y, max, width: ctx.measureText(str).width }); fillText(str, x, y, max); };
  for (const a of M.ACHIEVEMENTS) {
    c.getContext('2d').clearRect(0, 0, 800, 500); written.length = 0;
    g.achievements.banner = a; g.achievements.bannerT = 2;
    g.hud._toast(ctx, g, 800, 500);
    const description = written.slice(2);
    assert.equal(description.map((line) => line.str).join(' '), a.desc, 'no truncated description');
    assert.ok(description.length <= 2);
    assert.ok(description.every((line) => line.width <= line.max));
    // the card moves to stay clear of the map, the sound chip and any banner,
    // so ask it where it landed rather than remembering where it used to be
    const box = g.hud._toastRect(g, 800, 500);
    const icon = ctx.getImageData(box.x + 10, box.y + 18, 36, 36).data;
    const colours = new Set();
    for (let i = 0; i < icon.length; i += 4) colours.add(`${icon[i]},${icon[i + 1]},${icon[i + 2]}`);
    assert.ok(colours.size >= 2, `${a.id} toast has no badge`);
  }
});
