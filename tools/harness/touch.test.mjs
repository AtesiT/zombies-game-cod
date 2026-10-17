// The on-screen panel's two rules, which are really one rule: a phone has no
// keyboard, so a tap has to mean the right thing depending on what is on the
// screen. In a list it is a click on release (so a thumb can slide to the row
// it wants); in a round it is a trigger pull on the way down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nc, load } from './stub.mjs';

const { TouchControls } = await import('../../src/touch.js');
const proto = TouchControls.prototype;
const mode = (g) => proto._menuMode.call({ game: g }, g);

test('everything that is not the round counts as a menu', () => {
  assert.equal(mode(undefined), false, 'no game yet: the panel has nothing to cover');
  assert.equal(mode({ started: false }), true, 'the front door');
  assert.equal(mode({ started: true, player: {} }), false, 'a live round');
  for (const flag of ['gameOver', 'paused', 'settingsOpen', 'craftOpen', 'controlsOpen', 'debugOpen']) {
    assert.equal(mode({ started: true, player: {}, [flag]: true }), true, `${flag} must hide the panel`);
  }
  assert.equal(mode({ started: true, player: { skillDraft: { ids: [] } } }), true, 'the card draft');
  assert.equal(mode({ started: true, player: {}, gameOver: false, paused: false }), false);
});

test('a tap is a click in a menu and a trigger in a round', () => {
  const mk = () => {
    const input = {
      canvas: nc(800, 500), vw: 800, vh: 500,
      mouse: { x: 0, y: 0, cx: 0, cy: 0, down: false, pressed: false, released: false },
      stick: { x: 0, y: 0 }, pressed: new Set(), keys: new Set(), released: new Set(),
    };
    const t = {
      input, game: { started: true, player: {} }, _slid: false,
      _menuOpen: () => false,
    };
    return { t, input };
  };

  // in a round: fire on the way down, so a shot is never a thumb-beat late
  {
    const { t, input } = mk();
    proto._tap.call(t, { clientX: 400, clientY: 250 }, 'down');
    assert.equal(input.mouse.down, true);
    assert.equal(input.mouse.pressed, true);
  }

  // in a menu: the row lights up under the finger and the click lands on
  // release, so a thumb can slide off a row it did not mean
  {
    const { t, input } = mk();
    t._menuOpen = () => true;
    proto._tap.call(t, { clientX: 400, clientY: 250 }, 'down');
    assert.equal(input.mouse.pressed, false, 'nothing is chosen yet');
    assert.equal(t._slid, true);
    proto._tap.call(t, { clientX: 400, clientY: 300 }, 'move');
    assert.equal(input.mouse.pressed, false, 'sliding does not click');
    proto._tap.call(t, { clientX: 400, clientY: 300 }, 'up');
    assert.equal(input.mouse.pressed, true, 'letting go is the choice');
    assert.equal(input.mouse.down, false);
    assert.equal(input.mouse.y, 300, 'the click lands where the finger ended');
    assert.equal(t._slid, false);
  }
});


const M = await load();

test('the all-time page opens from the front door and a tap leaves it', () => {
  const g = new M.Game(new M.Input(nc(800, 500)));
  const rows = M.menuRows('menu', g);
  const at = rows.findIndex((r) => r.id === 'stats');
  assert.ok(at >= 0, 'the menu has no STATISTICS row');
  g.menuIndex = at;
  g.input.mouse.pressed = true;
  g._menuUpdate(1 / 60);
  assert.equal(g.scene, 'stats', 'choosing the row did not open the page');

  g.input.mouse.pressed = false;
  g.input.mouse.down = true;
  g._menuUpdate(1 / 60);
  g.input.mouse.down = false;
  g.input.mouse.pressed = true;
  g._menuUpdate(1 / 60);
  assert.equal(g.scene, 'menu', 'a tap did not close the page');
  assert.equal(g.menuIndex, at, 'closing did not leave the cursor on its row');
});

test('the achievements page scrolls by drag and closes by tap, not by dragging', () => {
  const g = new M.Game(new M.Input(nc(800, 500)));
  g.scene = 'achievements';
  g.achScroll = 0;
  // drag upwards: the list moves on, and letting go must not close it
  g.input.mouse.down = true;
  g.input.mouse.y = 300;
  g._menuUpdate(1 / 60);
  g.input.mouse.y = 220;          // drag upwards: further down the list
  g._menuUpdate(1 / 60);
  assert.ok(g.achScroll > 0, 'dragging the list did not scroll it');
  g.input.mouse.down = false;
  g.input.mouse.pressed = true;
  g._menuUpdate(1 / 60);
  assert.equal(g.scene, 'achievements', 'the end of a drag closed the page');

  // a clean tap closes it: on a phone there is no ESC key
  g.input.mouse.pressed = false;
  g.input.mouse.down = true;
  g.input.mouse.y = 300;
  g._menuUpdate(1 / 60);
  g.input.mouse.down = false;
  g.input.mouse.pressed = true;
  g._menuUpdate(1 / 60);
  assert.equal(g.scene, 'menu');
});
