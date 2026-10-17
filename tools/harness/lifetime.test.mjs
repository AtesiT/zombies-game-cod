// The all-time diary: every finished run, added up, kept across reloads.
// These tests pin the arithmetic (bests are maxima, totals are sums), the
// tolerance for whatever an old browser left in the key, and the one-shot
// rule: a night is banked once, not once per way out of the game-over screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nc, load } from './stub.mjs';

const M = await load();
const L = await import('../../src/lifetime.js');
const clear = () => { for (const k of Object.keys(localStorage._d)) delete localStorage._d[k]; };

test('an empty diary is all zeroes, and so is one that has been scribbled on', () => {
  clear();
  assert.deepEqual({ ...L.loadLifetime() }, { ...L.EMPTY_LIFETIME });
  localStorage.setItem(L.LIFETIME_KEY, '{not json');
  assert.deepEqual({ ...L.loadLifetime() }, { ...L.EMPTY_LIFETIME });
  localStorage.setItem(L.LIFETIME_KEY, JSON.stringify({ runs: 'x', kills: -4, bestRound: 3.7 }));
  const life = L.loadLifetime();
  assert.equal(life.runs, 0);
  assert.equal(life.kills, 0);
  assert.equal(life.bestRound, 4, 'a number is rounded, not discarded');
});

test('a run adds its totals and only ever lifts a best', () => {
  clear();
  let life = L.bankRun(L.loadLifetime(), {
    round: 12,
    metrics: { kills: 120, headshots: 30, points: 5000, seconds: 600, salvage: 40 },
  });
  assert.equal(life.runs, 1);
  assert.equal(life.deaths, 1);
  assert.equal(life.evacs, 0);
  assert.equal(life.clearedRounds, 11, 'a death on twelve cleared eleven');
  assert.equal(life.bestRound, 12);
  assert.equal(life.bestKills, 120);
  assert.equal(life.bestTime, 600);

  life = L.bankRun(life, {
    round: 6, evac: true,
    metrics: { kills: 40, points: 900, seconds: 120 },
  });
  assert.equal(life.runs, 2);
  assert.equal(life.evacs, 1);
  assert.equal(life.deaths, 1);
  assert.equal(life.clearedRounds, 17);
  assert.equal(life.kills, 160);
  assert.equal(life.points, 5900);
  assert.equal(life.bestRound, 12, 'a best is a maximum, not the latest');
  assert.equal(life.bestPoints, 5000);
  assert.equal(life.bestTime, 600, 'the longest night, not the last one');

  // and the written copy is what the next load reads back
  assert.deepEqual({ ...L.loadLifetime() }, { ...life });
});

test('the rows are the whole diary, in two readable columns', () => {
  const rows = L.lifetimeRows(L.EMPTY_LIFETIME);
  assert.equal(rows.length, 24);
  assert.equal(rows.filter((r) => r[2] === 0).length, 8);
  assert.equal(rows.filter((r) => r[2] === 1).length, 16);
  for (const [label, value] of rows) {
    assert.equal(typeof label, 'string');
    assert.equal(typeof value, 'string');
    assert.ok(label.length && value.length);
  }
  assert.equal(rows[0][0], 'RUNS FINISHED');
  assert.equal(rows.at(-1)[0], 'TIME PLAYED');
  // thousands are spaced, so a seven-figure score is still a number at a glance
  const big = L.bankRun({ ...L.EMPTY_LIFETIME }, { round: 3, metrics: { kills: 1234567 } });
  assert.equal(L.lifetimeRows(big)[8][1], '1 234 567');
});

test('the menu gets a summary, and says so when there is nothing to summarise', () => {
  const [first, second] = L.lifetimeMenuLines(L.EMPTY_LIFETIME);
  assert.match(first, /NO NIGHTS YET/);
  assert.equal(second, null);
  const life = L.bankRun({ ...L.EMPTY_LIFETIME }, { round: 21, evac: true, metrics: { kills: 555 } });
  const [a, b] = L.lifetimeMenuLines(life);
  assert.match(a, /1 RUN/);
  assert.match(a, /BEST ROUND 21/);
  assert.match(a, /555 KILLS/);
  assert.match(b, /1 EVACUATION/);
});

test('a run that ends lands in the diary once, however many times you leave', () => {
  clear();
  const g = new M.Game(new M.Input(nc(800, 500)));
  g.begin();
  g.round = 9;
  g.runMetrics.kills = 77;
  g.runMetrics.points = 1234;
  g._quitToMenu();
  const life = L.loadLifetime();
  assert.equal(life.runs, 1);
  assert.equal(life.bestRound, 9);
  assert.equal(life.kills, 77);
  assert.equal(life.points, 1234);
  assert.equal(life.deaths, 1);
  assert.equal(g.lifetime.runs, 1, 'the menu reads the same diary');

  g._quitToMenu();
  assert.equal(L.loadLifetime().runs, 1, 'quitting again must not bank it twice');
  assert.equal(g._bankRun(), undefined);
  assert.equal(L.loadLifetime().runs, 1, 'nor must the helper');

  // a range run is practice, not a night
  const r = new M.Game(new M.Input(nc(800, 500)));
  r.rangeMode = true;
  r.started = true;
  r.round = 5;
  r._bankRun();
  assert.equal(L.loadLifetime().runs, 1);
});
