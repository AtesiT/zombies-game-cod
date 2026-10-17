// Looking away. A window keeps drawing while another app has the focus, so a
// solo night used to keep running -- and keep biting -- during a coffee break.
// The rule: a solo round pauses, a shared one does not (the world belongs to
// the host), and menus or a finished run have nothing to pause.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nc, load } from './stub.mjs';

const M = await load();
const fresh = () => new M.Game(new M.Input(nc(800, 500)));

test('losing focus pauses a solo round', () => {
  const g = fresh();
  g.begin();
  assert.equal(g.paused, false);
  assert.equal(g.pauseForFocusLoss(), true);
  assert.equal(g.paused, true, 'the pause screen is what the player comes back to');
  // and it does not stack or re-arm over an existing pause
  assert.equal(g.pauseForFocusLoss(), false);
});

test('nothing is paused when there is nothing live to pause', () => {
  const g = fresh();
  assert.equal(g.pauseForFocusLoss(), false, 'the front door');

  g.begin();
  g.gameOver = true;
  assert.equal(g.pauseForFocusLoss(), false, 'the death screen');
  g.gameOver = false;

  g.paused = true;
  assert.equal(g.pauseForFocusLoss(), false, 'already paused by the player');
  g.paused = false;

  g.player.skillDraft = { ids: [] };
  assert.equal(g.pauseForFocusLoss(), false, 'the card draft owns the screen');
  g.player.skillDraft = null;
});

test('a co-op world is not frozen because one window lost focus', () => {
  const g = fresh();
  g.begin();
  // a host with peers, and a guest whose world lives on the host: in both
  // cases pausing here would stop somebody else's night too
  g.net.role = 'host';
  g.net.state = 'open';
  assert.equal(g.net.playing, true);
  assert.equal(g.pauseForFocusLoss(), false);
  assert.equal(g.paused, false);

  g.net.role = 'guest';
  assert.equal(g.pauseForFocusLoss(), false);
  g.net.role = 'off';
  g.net.state = 'idle';
  assert.equal(g.pauseForFocusLoss(), true, 'back to solo, back to pausing');
});
