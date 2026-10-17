// Run skills: one card taken every fifth wave, carried for the rest of the
// night. These tests pin the contract that matters -- the draft cannot be
// farmed or skipped, the stats really change, and the choice survives the wire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nc, load } from './stub.mjs';

const M = await load();
const { SKILLS, SKILL_IDS, DRAFT_TIME, DRAFT_EVERY, makeDraft, skillEffects, skillLine } = await import('../../src/skills.js');
const { Player, Grenade, HEAD_OFF_Y } = await import('../../src/entities.js');
const { skillCardRects, skillCardAt } = await import('../../src/hud.js');
const H = 1 / 60;
const fresh = () => { const g = new M.Game(new M.Input(nc(800, 500))); g.begin(); return g; };
const endWave = (g, round) => { g.round = round; g.roundActive = true; g.endRound(); };

test('the pool is a real pool: sixteen distinct cards, all with a bounded effect', () => {
  assert.equal(SKILL_IDS.length, 16);
  assert.equal(new Set(SKILL_IDS).size, 16);
  for (const id of SKILL_IDS) {
    const s = SKILLS[id];
    assert.equal(s.id, id);
    assert.ok(s.name && s.short && s.desc && s.tag);
    assert.equal(s.short.length, 3, `${id} needs a three-letter HUD badge`);
    assert.ok(s.desc.length <= 72, `${id} must fit a card without a novel`);
  }
  const clean = skillEffects(null);
  assert.equal(clean.dmgMul, 1); assert.equal(clean.takenMul, 1); assert.equal(clean.bonusHp, 0);
  assert.equal(skillLine(new Set()), '');
});

test('a skill is a stat change, not a label; duplicates and unknown ids are refused', () => {
  const g = fresh(), p = g.player;
  assert.equal(p.addSkill('nonsense'), false);
  assert.equal(p.addSkill('ironhide'), true);
  assert.equal(p.maxHp, 130);
  assert.equal(p.hp, 130, 'the new maximum comes with the blood to fill it');
  assert.equal(p.addSkill('ironhide'), false, 'the same card cannot be taken twice');
  assert.equal(p.skills.size, 1);

  // perks and skills multiply, they do not overwrite each other
  p.addPerk('speedcola');
  p.addSkill('fastloader');
  assert.ok(Math.abs(p.perkFx.reloadMul - 0.5 * 0.8) < 1e-9);
  p.addSkill('deadeye');
  assert.equal(p.skillFx.dmgMul, 1.15);
  assert.equal(p.skillFx.headMul, 1.25);
  assert.equal(skillLine(p.skills), 'DEA · FST · IRN');
});

test('the draft excludes what you already own and never repeats a card', () => {
  const owned = new Set(['deadeye', 'ironhide']);
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const ids = makeDraft(owned, 3);
    assert.equal(ids.length, 3);
    assert.equal(new Set(ids).size, 3);
    for (const id of ids) {
      assert.ok(!owned.has(id));
      assert.ok(SKILL_IDS.includes(id));
      seen.add(id);
    }
  }
  assert.equal(seen.size, SKILL_IDS.length - 2, 'over enough runs every eligible card appears');
  assert.deepEqual(makeDraft(new Set(SKILL_IDS), 3), [], 'a full character is not dealt an empty hand');
});

test('every fifth cleared wave deals a draft; the other waves do not', () => {
  const g = fresh();
  endWave(g, 4);
  assert.equal(g.player.skillDraft, null);
  endWave(g, 5);
  const d = g.player.skillDraft;
  assert.ok(d, 'round five deals three cards');
  assert.equal(d.round, 5);
  assert.equal(d.ids.length, 3);
  assert.equal(d.t, DRAFT_TIME);
  assert.equal(g.banner.title, 'ROUND 5 CLEARED');
});

test('picking a card applies it, closes the draft and refuses anything not dealt', () => {
  const g = fresh();
  endWave(g, 5);
  const d = g.player.skillDraft;
  const notDealt = SKILL_IDS.find((id) => !d.ids.includes(id));
  assert.equal(g.pickSkill(g.player, notDealt), false);
  assert.ok(g.player.skillDraft, 'a rejected card does not consume the draft');
  assert.equal(g.pickSkill(g.player, d.ids[1]), true);
  assert.equal(g.player.skillDraft, null);
  assert.equal(g.player.skills.size, 1);
  assert.ok(g.player.skills.has(d.ids[1]));
  assert.equal(g.pickSkill(g.player, d.ids[0]), false, 'there is no second pick in the same draft');
});

test('keys and clicks take the card; the next wave waits while the cards are out', () => {
  const g = fresh();
  endWave(g, 10);
  assert.equal(g.intermission, 12);
  const d = g.player.skillDraft;
  const expected = d.ids[1];

  // the countdown to the next wave is frozen, not skipped
  g.update(3);
  assert.equal(g.intermission, 12);
  assert.ok(g.player.skillDraft);

  g.input.pressed.add('Digit2');
  g.update(H);
  g.input.endFrame();
  assert.ok(g.player.skills.has(expected));
  assert.equal(g.player.skillDraft, null);

  const before = g.intermission;
  g.update(1);
  assert.ok(g.intermission < before, 'the wave resumes once the hand is answered');

  // and the pointer works the same way, on the card it is actually over
  const g2 = fresh();
  endWave(g2, 15);
  const d2 = g2.player.skillDraft;
  const rect = skillCardRects(800, 500, 3)[2];
  Object.assign(g2.input.mouse, {
    x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, pressed: true, down: true,
  });
  g2.update(H);
  g2.input.endFrame();
  assert.ok(g2.player.skills.has(d2.ids[2]));
});

test('an untouched draft answers itself after twenty seconds', () => {
  const g = fresh();
  endWave(g, 5);
  const d = g.player.skillDraft;
  d.t = 0.01;
  g.update(0.02);
  assert.equal(g.player.skillDraft, null);
  assert.equal(g.player.skills.size, 1, 'the clock picks a card rather than losing it');
  assert.equal(g.intermission <= 12, true);
});

test('damage, medkits, points, planks and throwables really change', () => {
  // Deadeye: 100 damage leaves a 110 hp walker standing, 115 does not
  const g = fresh();
  g.player.pos = { x: 300, y: 300 };
  g.map.rayWall = () => null;
  const def = { ...M.WEAPONS.m1911, dmg: 100, range: 220, pierce: 0 };
  const dummy = (hp) => {
    const z = g.makeZombie({ x: 360, y: 300 }, 'walker');
    z.pos = { x: 360, y: 300 }; z.hp = z.maxHp = hp;
    return z;
  };
  const plain = dummy(110);
  g.zombies = [plain];
  g.fireHitscan(300, 300, 0, def, { x: 300, y: 300 }, g.player, false);
  assert.equal(plain.dead, false);
  assert.ok(Math.abs(plain.hp - 10) < 1e-6);

  g.player.addSkill('deadeye');
  const buffed = dummy(110);
  g.zombies = [buffed];
  g.fireHitscan(300, 300, 0, def, { x: 300, y: 300 }, g.player, false);
  assert.equal(buffed.dead, true, '115 damage kills what 100 does not');

  // Hardened and Field Medic
  const p = g.player;
  p.addSkill('hardened');
  p.invuln = 0; p.armor = 0; p.hp = 100; p.maxHp = 100;
  p.hurt(50, 0, 0, g);
  assert.equal(Math.round(p.hp), 56, '12% off the top');
  p.addSkill('medic');
  p.medkits = 1; p.hp = 10;
  p.useMedkit();
  assert.equal(p.hp, 90, '55 heals become 80');

  // Scavenger
  p.addSkill('scavenger');
  const before = p.points;
  g.addPoints(100, undefined, undefined, undefined, p);
  assert.equal(p.points - before, 115);

  // Engineer: 0.2 s of nails is enough at a 0.195 s cadence, and not at 0.3
  const g2 = fresh();
  const b = { cx: 100, cy: 100, planks: 0, maxPlanks: 6 };
  const it = { type: 'barricade', barricade: b };
  g2.rebuildTick(0.2, g2.player, it);
  assert.equal(b.planks, 0);
  g2.player.addSkill('engineer');
  g2._rebuildT = 0;
  g2.rebuildTick(0.2, g2.player, it);
  assert.equal(b.planks, 1);

  // Pack Mule: the between-wave refill carries one more
  const g3 = fresh();
  g3.player.ownThrow.frag = true;
  g3.player.grenades = 0;
  g3.player.addSkill('packmule');
  g3.startRound(2);
  assert.equal(g3.player.grenades, 3);
});

test('Demolitionist widens the frag; a plain frag does not reach that far', () => {
  const blast = (owner) => {
    const g = fresh();
    const z = g.makeZombie({ x: 300 + 110, y: 300 }, 'walker');
    z.pos = { x: 300 + 110, y: 300 }; z.hp = z.maxHp = 5000;
    g.zombies = [z];
    const n = new Grenade(300, 300, 0, 0, 0, owner(g));
    n.explode(g);
    return z.hp;
  };
  const plain = blast((g) => g.player);
  const demo = blast((g) => { g.player.addSkill('demolition'); return g.player; });
  assert.equal(plain, 5000, '96 px of blast does not reach a body 110 px away');
  assert.ok(demo < 5000, '115 px does');
  assert.ok(demo > 4700, 'the far edge of the ring is a graze, not a kill');
});

test('the draft panel has real card geometry and draws inside the canvas', () => {
  const cards = skillCardRects(800, 500, 3);
  assert.equal(cards.length, 3);
  for (const c of cards) {
    assert.ok(c.x >= 0 && c.x + c.w <= 800 && c.y >= 0 && c.y + c.h <= 500);
  }
  assert.equal(skillCardAt(800, 500, cards[0].x + 2, cards[0].y + 2, 3), 0);
  assert.equal(skillCardAt(800, 500, cards[2].x + 5, cards[2].y + 5, 3), 2);
  assert.equal(skillCardAt(800, 500, 2, 2, 3), -1);

  const g = fresh();
  endWave(g, 5);
  assert.doesNotThrow(() => g.hud._skillDraft(nc(800, 500).getContext('2d'), g, 800, 500));
  assert.doesNotThrow(() => g.hud._skills(nc(800, 500).getContext('2d'), g, 800, 500));
});

test('the choice reaches a guest: the mask, the stats and the open cards', () => {
  const host = fresh(), guest = fresh();
  host.player.addSkill('ironhide');
  host.player.addSkill('deadeye');
  const d = host.player.skillDraft = { round: 5, ids: makeDraft(host.player.skills, 3), index: 1, t: 12 };
  guest.net._apply(host.net.snapshot(), true);
  assert.equal(guest.player.skills.size, 2);
  assert.ok(guest.player.skills.has('ironhide'));
  assert.equal(guest.player.maxHp, 130, 'a guest calculates the same body');
  assert.deepEqual(guest.player.skillDraft.ids, d.ids);
  assert.equal(guest.player.skillDraft.index, 1);

  // and the guest's answer is checked against the cards the host dealt
  assert.equal(host.pickSkill(guest.player, d.ids[2]), true);
  assert.ok(guest.player.skills.has(d.ids[2]));
  assert.equal(host.pickSkill(guest.player, d.ids[2]), false, 'one card, one pick');
});
