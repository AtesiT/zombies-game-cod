// One throwing hand: frag, molotov and gas share a single slot. Buying a
// different kind replaces what is in it; G throws whatever it holds. These
// tests pin the contract down because three separate pockets used to mean
// three buttons, three keys and three HUD lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nc, load } from './stub.mjs';

const M = await load();
const H = 1 / 60;
const fresh = () => { const g = new M.Game(new M.Input(nc(800, 500))); g.begin(); return g; };
const key = (g, code) => { g.input.pressed.add(code); g.update(H); g.input.endFrame(); };
const POCKET = { frag: 'grenades', molotov: 'molotovs', gas: 'gasbombs' };

test('buying another kind replaces the hand; the same kind stacks to the cap', () => {
  const g = fresh(), p = g.player;
  p.giveThrowable('frag', 2);
  assert.equal(p.throwableKind(), 'frag');
  assert.equal(p.throwableCount(), 2);
  assert.equal(p.grenades, 2);

  p.giveThrowable('molotov', 2);
  assert.equal(p.throwableKind(), 'molotov');
  assert.equal(p.throwableCount(), 2);
  assert.equal(p.grenades, 0, 'the frags were replaced, not stacked beside');
  assert.equal(p.molotovs, 2);

  p.giveThrowable('molotov', 2);
  assert.equal(p.molotovs, 4, 'the same kind fills the slot to the cap');

  p.giveThrowable('gas', 2);
  assert.equal(p.throwableKind(), 'gas');
  assert.equal(p.molotovs, 0, 'the bottles went with the replacement');
  assert.equal(p.gasbombs, 2);
});

test('the crate sells a replacement even when the hand is full of another kind', () => {
  const g = fresh(), p = g.player;
  const crates = g.map.floors[0].grenadeCrates;
  const gasCrate = crates.find((c) => (c.kind ?? 'frag') === 'gas');
  const otherCrate = crates.find((c) => (c.kind ?? 'frag') !== 'gas');
  assert.ok(gasCrate && otherCrate, 'the ground floor has more than one kind of crate');
  p.points = 100000;
  p.floor = 0;
  p.pos = { x: gasCrate.x, y: gasCrate.y };
  // the hand is full of the OTHER kind: that must not block the replacement
  const otherKind = otherCrate.kind ?? 'frag';
  p.giveThrowable(otherKind, 4);
  assert.equal(p.throwableCount(), 4);
  const before = p.points;
  g.doInteraction(p, g.interactionFor(p));
  assert.equal(p.throwableKind(), 'gas');
  assert.equal(p.throwableCount(), 2);
  assert.ok(p.points < before, 'the replacement was paid for');
  assert.equal(p[POCKET[otherKind]], 0, 'the replaced kind is gone');
});

test('G throws what is in the hand; X and B are aliases, an empty hand throws nothing', () => {
  const g = fresh(), p = g.player;
  p.giveThrowable('molotov', 2);
  g.input.mouse = { x: 520, y: 260, down: false, pressed: false };
  key(g, 'KeyG');
  assert.equal(p.molotovs, 1);
  assert.equal(p.grenades, 0, 'G did not fall back to a different pocket');
  assert.equal(g.pThrows.length, 1);
  assert.equal(g.pThrows[0].kind, 'molotov');

  key(g, 'KeyX');
  assert.equal(p.molotovs, 0);
  assert.equal(g.pThrows.length, 2);

  key(g, 'KeyB');
  assert.equal(g.pThrows.length, 2, 'an empty hand throws nothing at all');
});

test('the between-round refill restores the kind in the hand only', () => {
  const g = fresh(), p = g.player;
  p.giveThrowable('gas', 1);
  assert.equal(p.takeThrowable(), 'gas');
  assert.equal(p.throwableCount(), 0);
  g.startRound(g.round + 1);
  assert.equal(p.gasbombs, 2);
  assert.equal(p.grenades, 0);
  assert.equal(p.molotovs, 0);
});

test('a guest throw resolves to the guest hand, not to a fixed pocket', () => {
  const g = fresh(), p = g.player;
  p.giveThrowable('gas', 1);
  g.input.mouse = { x: 460, y: 250, down: false, pressed: false };
  g.throwFor(p);
  assert.equal(p.gasbombs, 0);
  assert.equal(p.grenades, 0);
  assert.equal(p.molotovs, 0);
  assert.equal(g.pThrows.length, 1);
  assert.equal(g.pThrows[0].kind, 'gas');
});
