// Headless harness for the soundtrack, which is there and has been the whole
// time -- you just could not hear it.
//
// Two reasons. The ceiling every layer was scaled by was 0.12, and the game
// asked for 0.45 of calm, so the drone sat at about a twentieth of a gunshot.
// Worse, both the calm chord and the combat heartbeat lived down at 41-82 Hz:
// a phone speaker cannot move that much air, so on a handset it was silence
// with a filter sweeping over it.
import { nc, load, SRC } from './stub.mjs';
import { AudioContext } from './webaudio.mjs';

const created = [];
class SpyCtx extends AudioContext {
  createOscillator() { const o = super.createOscillator(); created.push(o); return o; }
}
globalThis.window.AudioContext = SpyCtx;

const M = await load();
const { audio } = await import(SRC + '/audio.js');
const H = 1 / 60;
const fails = [];
const ok = (c, l) => { if (!c) fails.push(l); };

audio.init();
audio.setVolumes({ master: 85, sfx: 100, ambient: 100, music: 70 });

ok(audio.ready, 'the audio engine did not start');
ok(!!audio._music, 'no music was ever built');

/** Does this node's output end up at `target`? */
function reaches(from, target, seen = new Set()) {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  for (const o of from._out ?? []) if (reaches(o, target, seen)) return true;
  return false;
}

/** Every oscillator that feeds one of the three music layers. */
function feeds(layer) {
  return created.filter((o) => reaches(o, layer));
}

// ---- it is wired up and it is turned up ------------------------------------
ok((audio.musicBus._out ?? []).includes(audio.bus), 'the music bus is not connected to anything');
ok((audio.bus._out ?? []).includes(audio.master), 'the shared bus is not connected to the master');

const calmOsc = feeds(audio._music.calm);
const combatOsc = feeds(audio._music.combat);
const lastOsc = feeds(audio._music.last);
ok(calmOsc.length >= 2, `the calm layer has ${calmOsc.length} voices in it`);
ok(combatOsc.length >= 2, `the combat layer has ${combatOsc.length} voices in it`);
ok(lastOsc.length >= 2, `the last-standing layer has ${lastOsc.length} voices in it`);

// ---- the chord has to be in a register a small speaker can play ------------
// 55 Hz is a feeling, not a note: on a phone it comes out of the case, not the
// speaker. At least two voices have to be up where a 40 mm driver works.
const audible = calmOsc.filter((o) => o.frequency.value >= 100);
ok(audible.length >= 2,
  `only ${audible.length} of the calm chord's voices are above 100 Hz: [${calmOsc.map((o) => o.frequency.value).join(', ')}]`);
const combatHigh = combatOsc.filter((o) => o.frequency.value >= 80);
ok(combatHigh.length >= 1,
  `the heartbeat is all down at [${combatOsc.map((o) => o.frequency.value).join(', ')}] -- nothing a phone can reproduce`);

// ---- the level it actually comes out at ------------------------------------
audio.setMusic({ calm: 0.7, combat: 0, last: 0 });
const calmGain = audio._music.calm.gain.value;
const path = calmGain * audio.musicBus.gain.value * audio.bus.gain.value * audio.master.gain.value;
ok(calmGain > 0.15, `the calm layer sits at ${calmGain.toFixed(3)} gain -- that is a rumour, not music`);
ok(path > 0.08, `the drone reaches the speakers at ${path.toFixed(3)} -- inaudible under a gunshot`);
ok(path < 0.6, `the drone reaches the speakers at ${path.toFixed(3)} -- that is louder than the gunfire`);

// what it used to be, for the record: 0.45 asked for, 0.12 ceiling, and only
// the two sub-bass voices carrying it
console.log(`  calm layer ${calmGain.toFixed(3)} -> speakers at ${path.toFixed(3)} ` +
  `(was ${(0.45 * 0.12 * 0.7 * 0.85).toFixed(3)})`);

// ---- the layers are independent and all of them answer ---------------------
audio.setMusic({ calm: 0.4, combat: 1, last: 0.8 });
ok(audio._music.combat.gain.value > 0.2, 'the fight layer never comes up');
ok(audio._music.last.gain.value > 0.15, 'the last-standing scrape never comes up');
ok(audio._music.calm.gain.value < calmGain, 'the drone does not duck when the fight starts');

audio.setMusic({ calm: 0, combat: 0, last: 0 });
ok(audio._music.combat.gain.value < 0.01, 'the fight layer will not go away again');

// ---- and the game drives it every quarter second ---------------------------
{
  const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g.begin();
  g.startRound(3);
  let calls = 0;
  const real = audio.setMusic.bind(audio);
  audio.setMusic = (m) => { calls++; return real(m); };
  try {
    for (let i = 0; i < 120; i++) g.update(H);   // two seconds
  } finally {
    audio.setMusic = real;
  }
  ok(calls >= 4, `the game only touched the music ${calls} times in two seconds`);
  ok((audio._musicMix?.calm ?? 0) > 0, 'the game left the calm layer at nothing');
}

if (fails.length) {
  console.log('MUSIC FAIL:');
  for (const f of fails) console.log('  -', f);
  process.exitCode = 1;
} else {
  console.log('MUSIC PASS  the drone is loud enough to hear and in a register you can hear it in');
}
