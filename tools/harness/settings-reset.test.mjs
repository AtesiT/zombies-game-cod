// RESTORE DEFAULTS is the only row in the settings panel that throws work
// away. On a phone a thumb can land on it while scrolling, so it asks twice:
// the first press arms the row for a few seconds, the second one resets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nc, load } from './stub.mjs';

const M = await load();
const { settingsLayout } = await import('../../src/hud.js');
const H = 1 / 60;
const resetAt = M.SETTING_DEFS.findIndex((d) => d.id === 'reset');
const masterDef = M.SETTING_DEFS.find((d) => d.id === 'master').def;

const open = () => {
  const g = new M.Game(new M.Input(nc(800, 500)));
  g.settingsOpen = true;
  g.settingsIndex = resetAt;
  return g;
};
const press = (g, code) => {
  g.input.pressed.add(code);
  g.update(H);
  g.input.endFrame();
};

test('one press arms RESTORE DEFAULTS, the second one restores it', () => {
  const S = M.settings;
  const g = open();
  S.set('master', 40);

  press(g, 'Enter');
  assert.equal(S.get('master'), 40, 'the first press must not wipe anything');
  assert.ok(g._resetArmT > 0, 'the row is armed and says SURE?');
  assert.equal(g.settingsOpen, true);

  press(g, 'Enter');
  assert.equal(S.get('master'), masterDef, 'the second press is the real one');
  assert.equal(g._resetArmT, 0, 'and it disarms afterwards');
  g.settingsOpen = false;
});

test('the offer expires, and walking away cancels it', () => {
  const S = M.settings;
  const g = open();
  S.set('master', 40);

  press(g, 'Enter');
  assert.ok(g._resetArmT > 0);
  // four quiet seconds, then the row is a stranger again
  g._resetArmT = 0.01;
  g.update(H);
  assert.equal(g._resetArmT, 0);
  press(g, 'Enter');
  assert.equal(S.get('master'), 40, 'an expired arm must not reset anything');
  assert.ok(g._resetArmT > 0, 'it armed again instead');

  // closing the panel is "never mind" in every language
  g.input.pressed.add('Escape');
  g.update(H);
  g.input.endFrame();
  assert.equal(g.settingsOpen, false);
  assert.equal(g._resetArmT, 0);

  // and re-opening it must not find a loaded gun
  g.settingsOpen = true;
  assert.equal(g._resetArmT, 0);
  g.settingsOpen = false;
  S.set('master', masterDef);
});

test('a mouse click on the row follows the same two-step rule', () => {
  const S = M.settings;
  const g = open();
  S.set('master', 40);
  // the reset row is the last one, so the list is scrolled to the bottom and
  // the pointer is put on the row the layout says is there
  const L = settingsLayout(g, M.VW, M.VH);
  const row = resetAt - L.top;
  g.input.mouse.x = L.cx + 20;
  g.input.mouse.y = L.cy + L.HEAD - 12 + row * L.ROW + 5;
  g.input.mouse.pressed = true;
  g.update(H);
  g.input.endFrame();
  assert.equal(S.get('master'), 40, 'a click is still only the first press');
  assert.ok(g._resetArmT > 0, 'the click armed the row');

  g.input.mouse.pressed = true;
  g.update(H);
  g.input.endFrame();
  assert.equal(S.get('master'), masterDef, 'the second click resets');
  g.settingsOpen = false;
});
