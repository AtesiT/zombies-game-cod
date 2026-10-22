// The audio engine used to brick itself: one exception halfway through init()
// left `ctx` set, so every later call returned early, `ready` stayed false and
// the game was silent until a reload. These tests make sure a failed build is
// rolled back, a closed context is rebuilt, a rejected resume is harmless, and
// the M key always comes back to a real master gain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nc, load } from './stub.mjs';
import { AudioContext } from './webaudio.mjs';

window.AudioContext = AudioContext;
const { audio, AudioEngine } = await import('../../src/audio.js');

test('a build that throws halfway is rolled back, and the next tap retries', () => {
  let fail = true;
  class Flaky extends AudioContext {
    createConvolver() {
      if (fail) { fail = false; throw new Error('no convolver today'); }
      return super.createConvolver();
    }
  }
  window.AudioContext = Flaky;
  const a = new AudioEngine();
  a.init();
  assert.equal(a.ready, false, 'a broken build must not claim to be ready');
  assert.equal(a.ctx, null, 'the half-built context must be released');
  assert.match(a.lastError ?? '', /convolver/);

  // the next gesture builds a healthy engine instead of hitting `if (ctx) return`
  window.AudioContext = AudioContext;
  a.init();
  assert.equal(a.ready, true);
  assert.equal(a.lastError, null);
  assert.equal(a.master.gain.value, 0.85);
  a._pianoWant(false);
});

test('a context the browser closed is rebuilt on the next resume', () => {
  const a = new AudioEngine();
  a.init();
  const old = a.ctx;
  assert.ok(old);
  old.state = 'closed';
  a.resume();
  assert.notEqual(a.ctx, old);
  assert.equal(a.ready, true);
  assert.equal(a.running, true);
  a._pianoWant(false);
});

test('a resume rejected for lack of a gesture is swallowed, not fatal', async () => {
  class Grumpy extends AudioContext {
    constructor() { super(); this.state = 'suspended'; }
    resume() { return Promise.reject(new Error('no user gesture')); }
  }
  window.AudioContext = Grumpy;
  const a = new AudioEngine();
  assert.doesNotThrow(() => a.init());
  assert.equal(a.ready, true, 'the graph still gets built while suspended');
  await new Promise((r) => setTimeout(r, 0));   // an unhandled rejection would fail here
  assert.equal(a.running, false);                // still suspended: the next real tap resumes it
  a._pianoWant(false);
  window.AudioContext = AudioContext;
});

test('M mutes and unmutes the real master gain, and the game can say so', async () => {
  const M = await load();
  const g = new M.Game(new M.Input(nc(800, 500)));
  g.begin();
  const press = (code) => { g.input.pressed.add(code); g.update(1 / 60); g.input.endFrame(); };
  assert.equal(audio.muted, false);
  assert.ok(audio.master.gain.value > 0);

  press('KeyM');
  assert.equal(audio.muted, true);
  assert.equal(audio.master.gain.value, 0);
  assert.match(g.banner?.title ?? '', /SOUND OFF/);

  press('KeyM');
  assert.equal(audio.muted, false);
  assert.ok(audio.master.gain.value > 0, 'unmute must restore the fader, not stay silent');
  assert.match(g.banner?.title ?? '', /SOUND ON/);
  audio._pianoWant(false);
});

test('the HUD draws its sound warning without touching the frame loop', async () => {
  const M = await load();
  const g = new M.Game(new M.Input(nc(800, 500)));
  g.begin();
  const canvas = nc(800, 500), ctx = canvas.getContext('2d');
  audio.setMuted(true);
  assert.doesNotThrow(() => g.hud.draw(ctx, g, 800, 500));
  audio.setMuted(false);
  assert.doesNotThrow(() => g.hud.draw(ctx, g, 800, 500));
  audio._pianoWant(false);
});

test('the reverb tail is installed at build time, not on the first round', () => {
  const a = new AudioEngine();
  a.init();
  // `_build` runs before `ready` is set, and `setReverb` refuses to run before
  // then -- so the old code left the convolver with a null buffer while its
  // send was already open, and the menu had no reverb at all
  assert.equal(a.ready, true);
  assert.ok(a._conv, 'the convolver exists');
  assert.ok(a._conv.buffer, 'the impulse is in it from the first frame');
  assert.ok(a._conv.buffer.length > 1000);
  assert.equal(a._reverbZone, 'room');
  a._pianoWant(false);
});

test('a shot reaches the speakers with a non-zero gain', () => {
  const ctx = new AudioContext();
  const NodeProto = Object.getPrototypeOf(Object.getPrototypeOf(ctx.createGain()));
  const realConnect = NodeProto.connect;
  // record reverse edges so the graph can be walked upwards from the output
  NodeProto.connect = function (dest) { (dest._in ??= []).push(this); return realConnect.call(this, dest); };
  const a = new AudioEngine();
  a.init();
  a.shot('m1911');
  const seen = new Set();
  const up = (n) => {
    if (!n || seen.has(n)) return; seen.add(n);
    for (const from of n._in ?? []) up(from);
  };
  up(a.ctx.destination);
  const sources = [...seen].filter((n) => n.kind === 'osc' || n.kind === 'bufsrc');
  assert.ok(sources.length > 0, 'something is playing');
  const gainOf = (n) => (n.gain?.value ?? 1);
  let best = 0;
  const down = (n, gain, branch) => {
    if (n === a.ctx.destination) { best = Math.max(best, gain); return; }
    if (branch.has(n)) return;
    branch.add(n);
    for (const out of n._out ?? []) down(out, gain * (out.kind === 'gain' ? gainOf(out) : 1), branch);
  };
  for (const s of sources) down(s, 1, new Set());
  assert.ok(best > 0.001, `a shot must be audible, not routed at ${best}`);
  NodeProto.connect = realConnect;
  a._pianoWant(false);
});

test('a suspended clock is asked to start again until it runs', async () => {
  class Slow extends AudioContext {
    constructor() { super(); this.state = 'suspended'; this.refused = 0; }
    resume() {
      if (this.refused < 2) { this.refused++; return Promise.resolve(); }  // ignored
      this.state = 'running';
      return Promise.resolve();
    }
  }
  window.AudioContext = Slow;
  const a = new AudioEngine();
  a.init();
  assert.equal(a.ctx.state, 'suspended');
  assert.ok(a._kickTimer, 'a retry is armed');
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(a.ctx.state, 'running', 'the clock starts itself once the browser allows it');
  a._teardown();
  assert.equal(a._kickTimer, null, 'and the timer dies with the engine');
  window.AudioContext = AudioContext;
});
