// The front door and the room list. Two rules, both learned the hard way:
// ESC is a way *out* of a list no matter which row happens to be selected,
// and closing a page puts the cursor back on the row that opened it -- which
// means finding that row by name, not by a number a new feature can move.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nc, load } from './stub.mjs';

const M = await load();
const { menuMetrics } = await import('../../src/hud.js');
const { uiView } = await import('../../src/ui.js');
const H = 1 / 60;

const fresh = () => new M.Game(new M.Input(nc(800, 500)));
const press = (g, code) => {
  g.input.pressed.add(code);
  g._menuUpdate(H);
  g.input.endFrame();
};
const indexOf = (g, scene, id) => M.menuRows(scene, g).findIndex((r) => r.id === id);

test('the SOLO row clears the title block on desktop and small screens', () => {
  const g = fresh();
  for (const [w, h] of [[800, 500], [640, 360], [360, 640]]) {
    g.setViewport(w, h);
    const U = uiView(w, h);
    const title = menuMetrics(U.w, U.h);
    const layout = M.menuLayout('menu', g, w, h);
    const soloTop = layout.top / U.k - layout.step / U.k / 2;
    assert.ok(soloTop - title.ruleY >= 16,
      `${w}x${h}: the SOLO button is crowding the title rule`);
    assert.equal(M.menuHitTest('menu', w / 2, layout.top, g), 0,
      `${w}x${h}: the moved SOLO row no longer matches its hit target`);
  }
});

test('closing a page leaves the cursor on the row that opened it', () => {
  const g = fresh();
  const mp = indexOf(g, 'menu', 'mp');
  const stats = indexOf(g, 'menu', 'stats');
  const achievements = indexOf(g, 'menu', 'achievements');

  g.scene = 'stats';
  press(g, 'Escape');
  assert.equal(g.scene, 'menu');
  assert.equal(g.menuIndex, stats);

  g.scene = 'achievements';
  press(g, 'Escape');
  assert.equal(g.scene, 'menu');
  assert.equal(g.menuIndex, achievements);

  // BACK in a room list belongs on MULTIPLAYER, not on TEST RANGE (the row
  // that used to be first past SOLO when the number was written down)
  g.scene = 'mp';
  g.menuIndex = indexOf(g, 'mp', 'back');
  press(g, 'Enter');
  assert.equal(g.scene, 'menu');
  assert.equal(g.menuIndex, mp);
});

test('ESC leaves a list even when the selected row is a verb or a notice', () => {
  // an empty relay: the only rows are NO ROOMS / REFRESH / BACK and the
  // selection sits on the notice, where ESC used to do nothing at all
  const g = fresh();
  g.scene = 'rooms';
  g.net.roomList = [];
  g.menuIndex = indexOf(g, 'rooms', 'none');
  press(g, 'Escape');
  assert.equal(g.scene, 'menu', 'ESC on the empty-room notice was swallowed');

  // with a room on the list the selection can sit on REFRESH, where ESC used
  // to refresh the list instead of leaving it
  const g2 = fresh();
  g2.scene = 'rooms';
  g2.net.roomList = [{ id: 'R1', name: 'ROOM', players: 1, round: 3 }];
  g2.menuIndex = indexOf(g2, 'rooms', 'refresh');
  press(g2, 'Escape');
  assert.equal(g2.scene, 'menu', 'ESC on REFRESH refreshed instead of leaving');
  assert.equal(g2.menuIndex, indexOf(g2, 'menu', 'mp'));
});

test('ENTER still does the row its job -- REFRESH asks, a room joins', () => {
  const g = fresh();
  g.scene = 'rooms';
  g.net.roomList = [{ id: 'R1', name: 'ROOM', players: 1, round: 3 }];
  let asked = 0;
  g.net.askForRooms = () => { asked++; };
  g.menuIndex = indexOf(g, 'rooms', 'refresh');
  press(g, 'Enter');
  assert.equal(asked, 1);
  assert.equal(g.scene, 'rooms', 'REFRESH is not a way out');
});

test('ESC from a room list or the multiplayer page both land on MULTIPLAYER', () => {
  const g = fresh();
  const mp = indexOf(g, 'menu', 'mp');
  g.scene = 'mp';
  g.menuIndex = 0;
  press(g, 'Escape');
  assert.equal(g.scene, 'menu');
  assert.equal(g.menuIndex, mp);
});
