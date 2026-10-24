// The two ends of a night that used to lose things. QUIT TO MENU wrote the
// run into the diary but left the old world on the table, so the next SOLO
// started round one with the previous run's guns, points and tallies -- and
// with `_banked` still set, so that next night was never written down at all.
// RESTART, meanwhile, threw the run away without writing anything, when the
// identical decision made one row lower (QUIT) did write it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nc, load } from './stub.mjs';

const M = await load();
const L = await import('../../src/lifetime.js');
const H = 1 / 60;
const fresh = () => new M.Game(new M.Input(nc(800, 500)));
const press = (g, code) => {
  g.input.pressed.add(code);
  g._menuUpdate(H);
  g.input.endFrame();
};

test('QUIT TO MENU is a full stop, not a pause', () => {
  L.resetLifetime();
  const g = fresh();
  g.begin();
  g.round = 7;
  g.stats.kills = 42;
  g.runMetrics.kills = 42;
  g.player.points = 3000;

  g._quitToMenu();
  assert.equal(L.loadLifetime().runs, 1, 'the quit itself is banked');
  assert.equal(g.round, 0, 'the old night is still on the table');
  assert.equal(g.stats.kills, 0);
  assert.equal(g._banked, false, 'the next night would never reach the diary');

  // and the front door's SOLO row starts a genuinely new run
  g.menuIndex = M.menuRows('menu', g).findIndex((r) => r.id === 'solo');
  press(g, 'Enter');
  assert.equal(g.started, true);
  assert.equal(g.round, 1);
  assert.equal(g.stats.kills, 0);
  assert.equal(g.runMetrics.kills, 0);
  assert.equal(g.player.points, 500);
  assert.equal(g._banked, false);
  g.reset();
});

test('RESTART writes the night down before it wipes it', () => {
  L.resetLifetime();
  const g = fresh();
  g.begin();
  g.round = 9;
  g.stats.kills = 33;
  g.runMetrics.kills = 33;

  g._restartRun();
  const life = L.loadLifetime();
  assert.equal(life.runs, 1, 'restarting is not a way to erase a run');
  assert.equal(life.kills, 33);
  assert.equal(g.round, 1);
  assert.equal(g.started, true);
  assert.equal(g.runMetrics.kills, 0, 'the new run measured from zero');
  assert.equal(g._banked, false, 'and it has its own diary entry to earn');
  g.reset();
});

test('the death screen has a way back to the front door', () => {
  L.resetLifetime();
  const g = fresh();
  g.begin();
  g.gameOver = true;
  g.overT = 2;
  g.input.pressed.add('Escape');
  g.update(H);
  g.input.endFrame();
  assert.equal(g.started, false);
  assert.equal(g.scene, 'menu');
  assert.equal(g.paused, false);
  assert.equal(g.gameOver, false);
  g.reset();
});
