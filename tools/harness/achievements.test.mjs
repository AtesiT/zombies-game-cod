// A badge you cannot earn is a small lie on the wall, and a retired one that
// survives in the save file makes the screen read 34 / 33. These tests keep
// the list and the code that awards it in step, and make a wipe a real wipe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load, SRC } from './stub.mjs';

const M = await load();
const { Achievements, ACHIEVEMENTS } = await import('../../src/achievements.js');
const ACH_KEY = 'ndu.achievements.v1';

test('every badge on the wall has a way to earn it', () => {
  const awarded = new Set();
  for (const file of readdirSync(SRC)) {
    if (!file.endsWith('.js')) continue;
    const text = readFileSync(join(SRC, file), 'utf8');
    // `unlock(id)` with a variable is the API itself, not an award site
    for (const m of text.matchAll(/unlock\(['"]([a-z0-9_]+)['"]\)/g)) awarded.add(m[1]);
  }
  const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
  assert.equal(ids.size, ACHIEVEMENTS.length, 'two badges share an id');
  for (const a of ACHIEVEMENTS) {
    assert.ok(awarded.has(a.id), `${a.id} ("${a.name}") is never awarded anywhere in src/`);
  }
  for (const id of awarded) {
    assert.ok(ids.has(id), `src/ awards "${id}", which is not in ACHIEVEMENTS`);
  }
});

test('wiping the list also wipes what is queued to pop up', () => {
  const ach = new Achievements();
  ach.reset();
  ach.unlock('first_blood');
  ach.unlock('round_10');
  ach.update(0.016);            // the first toast is on screen, the second waits
  assert.ok(ach.banner);
  assert.equal(ach.pending.length, 1);

  ach.reset();
  assert.equal(ach.unlocked.size, 0);
  assert.equal(ach.banner, null, 'a toast for a deleted badge still flashed');
  assert.equal(ach.pending.length, 0);
});

test('a badge retired from the list does not linger in the save file', () => {
  // `daily_dogged` was retired when its challenge never shipped: an old save
  // can still carry it, and the counter must not inherit it
  localStorage.setItem(ACH_KEY, JSON.stringify(['first_blood', 'daily_dogged', 'not_a_badge']));
  const ach = new Achievements();
  assert.deepEqual([...ach.unlocked], ['first_blood']);
  assert.equal(ach.count, 1);
  ach.reset();
  assert.deepEqual(JSON.parse(localStorage.getItem(ACH_KEY)), []);
});
