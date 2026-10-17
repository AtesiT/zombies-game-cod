import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nc, load } from './stub.mjs';
import { AudioContext } from './webaudio.mjs';
import { SOUNDTRACKS, scoreBar, musicTime, SoundtrackPlayer } from '../../src/soundtracks.js';
const M = await load();
const { audio, AudioEngine } = await import('../../src/audio.js');
const { DEBUG_TABS, debugPanel, debugHitTest, debugTabBar, debugTabHit, drawDebug, drawGameOver, roundReportRows } = await import('../../src/hud.js');
class Clock extends AudioContext {
  constructor() { super(); this.all = []; }
  createOscillator() {
    const o = super.createOscillator(), stop = o.stop.bind(o);
    o.stop = (time = this.currentTime) => { o.ends = time; stop(time); };
    this.all.push(o); return o;
  }
  advance(dt) {
    super.advance(dt);
    for (const o of this.all) if (o.onended && o.ends <= this.currentTime) { const end = o.onended; o.onended = null; end(); }
  }
}
const fresh = () => { const g = new M.Game(new M.Input(nc(800, 500))); g.begin(); return g; };
const tick = (p) => { clearTimeout(p.timer); p._tick(); };
const cleanup = () => { audio.soundtrack?.stop(); audio._pianoWant(false); };

test('twenty original long-form scores have deterministic, distinct eight-section arrangements', () => {
  assert.equal(SOUNDTRACKS.length, 20);
  assert.equal(new Set(SOUNDTRACKS.map((t) => t.id)).size, 20);
  assert.ok(SOUNDTRACKS.reduce((n, t) => n + t.duration, 0) > 140 * 60);
  const fingerprints = new Set();
  for (const t of SOUNDTRACKS) {
    assert.ok(t.duration >= 320 && t.duration < 540);
    assert.equal(t.bars, 128);
    assert.deepEqual(scoreBar(t, 7), scoreBar(t, 7));
    assert.notDeepEqual(scoreBar(t, 0), scoreBar(t, 64));
    for (let bar = 0; bar < t.bars; bar++) for (const e of scoreBar(t, bar)) {
      assert.ok(Number.isFinite(e.note) && e.note >= 20 && e.note < 110);
      assert.ok(e.beat >= 0 && e.beat < 4 && e.length > 0 && e.gain > 0 && e.gain < 0.1);
    }
    fingerprints.add(JSON.stringify([scoreBar(t, 0), scoreBar(t, 64)]));
  }
  assert.equal(fingerprints.size, 20);
  assert.equal(musicTime(320), '5:20');
});

test('every score schedules valid audio; a full nine-minute run keeps bounded live voices', () => {
  const ctx = new Clock(), p = new SoundtrackPlayer(ctx, ctx.destination);
  for (const t of SOUNDTRACKS) {
    assert.equal(p.play(t.id), true);
    for (const offset of [60, 130, t.duration - 5]) {
      assert.equal(p.seek(offset), true); ctx.advance(0.25); tick(p);
      assert.ok(p.sources.size > 0 && p.sources.size < 100);
    }
    p.stop(); assert.equal(p.sources.size, 0);
  }
  p.play('snow'); const duration = p.current.duration; p.mode = 'once';
  for (let elapsed = 0; elapsed < duration + 1; elapsed += 0.25) { ctx.advance(0.25); tick(p); assert.ok(p.sources.size < 100); }
  assert.equal(p.current, null); assert.equal(p.sources.size, 0); p.stop();
});

test('repeat, playlist, once, seeking and fast switching clean up their schedulers', () => {
  const ctx = new Clock(), p = new SoundtrackPlayer(ctx, ctx.destination);
  p.play('ash'); assert.equal(p.play('missing'), false); assert.equal(p.current.id, 'ash');
  for (const t of SOUNDTRACKS) { p.play(t.id); assert.ok(p.sources.size < 100); }
  p.play('ash'); p.seek(100); assert.ok(p.elapsed >= 99 && p.elapsed <= 100);
  p.seek(-100); assert.equal(p.elapsed, 0);
  ctx.advance(p.current.duration + 1); tick(p); assert.equal(p.current.id, 'ash');
  p.mode = 'playlist'; ctx.advance(p.current.duration + 1); tick(p); assert.equal(p.current.id, 'wire');
  p.play('home'); ctx.advance(p.current.duration + 1); tick(p); assert.equal(p.current.id, 'ash');
  let finished = 0; p.onFinish = () => finished++; p.mode = 'once';
  ctx.advance(p.current.duration + 1); tick(p); assert.equal(p.current, null); assert.equal(finished, 1);
  assert.equal(p.timer, null); assert.equal(p.seek(20), false); p.stop();
});

test('third debug tab is reachable by keyboard/click, every row fits, and guest auditions stay local', () => {
  window.AudioContext = Clock;
  const g = fresh(); g.debugOpen = true; g.paused = true;
  const key = (code) => { g.input.pressed.add(code); g.update(1 / 60); g.input.endFrame(); };
  key('ArrowRight'); key('ArrowRight'); assert.equal(g.debugTab, 2); assert.equal(DEBUG_TABS[2].id, 'music');
  const p = debugPanel(g, 800, 500), b = debugTabBar(g, 800, 500);
  assert.ok(p.y >= 8 && p.y + p.ch <= 492);
  assert.equal(debugTabHit(g, 800, 500, b.x + b.w * 5 / 6, b.y + 10), 2);
  p.rows.forEach((r, i) => {
    const y = p.y + p.head + (i + 0.5) * p.rowH;
    assert.ok(y < p.y + p.ch - 40); assert.equal(debugHitTest(g, 800, 500, p.x + 40, y), i);
  });
  assert.equal(p.rows.filter((r) => SOUNDTRACKS.some((t) => r.id === `music:${t.id}`)).length, 20);
  const canvas = nc(800, 500); assert.doesNotThrow(() => drawDebug(canvas.getContext('2d'), g, 800, 500));
  g.net.role = 'guest'; g.net.isHost = false; g.net.state = 'open';
  const sent = []; g.net.send = (...args) => sent.push(args);
  g.debugIndex = g.debugRows().findIndex((r) => r.id === 'music:ash'); key('Enter');
  assert.equal(audio.soundtrack.current.id, 'ash'); assert.equal(sent.length, 0);
  key('Escape'); assert.equal(g.debugOpen, false); assert.equal(audio.soundtrack.current.id, 'ash');
  g._debugRun('music:stop'); assert.equal(audio.soundtrack.current, null);
  cleanup(); window.AudioContext = undefined;
});

test('selected scores suppress adaptive music, honour faders and stop for an upbeat evacuation cue', () => {
  window.AudioContext = Clock;
  const a = new AudioEngine(); a.init(); a.setVolumes({ master: 80, music: 35, sfx: 0 });
  a.playSoundtrack('grave'); a.setMusic({ calm: 1, combat: 1, last: 1, elegy: 1 });
  assert.deepEqual(a._musicMix, { calm: 0, combat: 0, last: 0, elegy: 0 });
  assert.ok(Math.abs(a.musicBus.gain.value - 0.35) < 1e-6);
  a.setMuted(true); assert.equal(a.master.gain.value, 0); a.setMuted(false);
  a.victory(); assert.equal(a.soundtrack.current, null); assert.ok(!a._pianoTimer);
  assert.ok(a._victoryUntil >= a.t + 17);
  a.setMusic({ elegy: 1, combat: 1 }); assert.equal(a._musicMix.elegy, 0);
  const group = a._victoryGroup; assert.ok(group._out.includes(a.musicBus));
  const tones = a.ctx.all.filter((o) => o._started && o.ends > a.t);
  assert.ok(tones.length > 30, 'fanfare must contain a full melody and major chords');
  a.stopSoundtrack(); a._pianoWant(false); cleanup(); window.AudioContext = undefined;
});

test('wave metrics are independent snapshots; intermission support only affects run totals', () => {
  const g = fresh();
  g.recordRound('kills', 8); g.recordRound('headshots', 3); g.recordRound('rays', 10); g.recordRound('hitRays', 7);
  g.recordRound('seconds', 63.5); g.recordRound('points', 1500); g.recordRound('planks', 2);
  g.recordRound('kills', NaN); g.recordRound('damage', -4);
  g.endRound(); assert.equal(g.intermission, 12);
  const report = g.roundReport; assert.equal(report.kills, 8); assert.equal(report.accuracy, 70); assert.equal(report.headshotRate, 38);
  g.endRound(); assert.equal(g.roundReport, report);
  g.recordRound('crafted'); assert.equal(report.crafted, 0); assert.equal(g.runMetrics.crafted, 1);
  g.startRound(2); assert.equal(g.roundMetrics.kills, 0); assert.equal(g.runMetrics.kills, 8);
  g.recordRound('kills'); assert.equal(report.kills, 8);
  assert.equal(roundReportRows(report).length, 20);
  assert.doesNotThrow(() => g.hud._roundReport(nc(800, 500).getContext('2d'), { ...g, roundActive: false, intermission: 10 }, 800, 500));
  g.rangeMode = true; g.recordRound('kills', 100); assert.equal(g.runMetrics.kills, 9);
  g.reset(); assert.equal(g.roundReport, null); assert.equal(g.runMetrics.kills, 0); assert.equal(g._evacAudioPlayed, false);
  cleanup();
});

test('real damage, armour, throws and points feed the ledger; piercing accuracy cannot exceed 100%', () => {
  const g = fresh(); g.player.invuln = 0; g.player.armor = 20; g.player.hp = 100;
  g.player.hurt(35, 0, 0, g); assert.equal(g.roundMetrics.armor, 20); assert.equal(g.roundMetrics.damage, 15);
  g.addPoints(50); g.throwAtCursor(g.player, 'frag', 0, 1e7);
  assert.equal(g.roundMetrics.points, 50); assert.equal(g.roundMetrics.throws, 1);
  const def = { ...M.WEAPONS.m1911, dmg: 1, pierce: 5, range: 200 };
  g.player.pos = { x: 300, y: 300 }; g.map.rayWall = () => null;
  g.zombies = [350, 400].map((x) => { const z = g.makeZombie({ x, y: 300 }, 'walker'); z.pos = { x, y: 300 }; return z; });
  g.fireHitscan(300, 300, 0, def, { x: 300, y: 300 });
  assert.equal(g.roundMetrics.rays, 1); assert.equal(g.roundMetrics.hitRays, 1);
  g.endRound(); assert.equal(g.roundReport.accuracy, 100); cleanup();
});

test('reports and run totals reach guests; evacuation celebration plays once, including late snapshots', () => {
  const host = fresh(), guest = fresh();
  host.recordRound('kills', 12); host.recordRound('revives', 2); host.endRound();
  guest.net._apply(host.net.snapshot(), true);
  assert.deepEqual(guest.roundReport, host.roundReport); assert.equal(guest.runMetrics.revives, 2);
  let cues = 0; const victory = audio.victory; audio.victory = () => cues++;
  try {
    host.heli.phase = 4; const snap = host.net.snapshot();
    guest.net._apply(snap, true); guest.net._apply(snap, true); assert.equal(cues, 1);
    snap.evc = 1; snap.go = 1; guest.net._apply(snap, true); assert.equal(cues, 1);
    guest.reset(); guest.net._apply(snap, true); assert.equal(cues, 2);
    guest.overT = 2; assert.doesNotThrow(() => drawGameOver(nc(800, 500).getContext('2d'), guest, 800, 500));
  } finally { audio.victory = victory; cleanup(); }
});

test('round reports can be hidden with Tab or their close button, without firing a shot', () => {
  const g = fresh(); g.recordRound('kills', 2); g.endRound();
  g.input.pressed.add('Tab'); g.update(1 / 60); g.input.endFrame();
  assert.equal(g._reportHidden, g.round);
  g.input.pressed.add('Tab'); g.update(1 / 60); g.input.endFrame();
  assert.equal(g._reportHidden, null);
  const before = g.stats.shots;
  Object.assign(g.input.mouse, { x: 692, y: 145, pressed: true, down: true });
  g.update(1 / 60); g.input.endFrame();
  assert.equal(g._reportHidden, g.round); assert.equal(g.stats.shots, before);
  const seconds = g.runMetrics.seconds; g.debugOpen = true; g.paused = true;
  g.update(3); assert.equal(g.runMetrics.seconds, seconds, 'paused time is not combat time');
  cleanup();
});
