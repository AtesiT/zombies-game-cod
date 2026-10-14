// V. Atmosphere and sound. The WebAudio stub throws on exactly the things a
// real browser throws on, so a broken graph cannot pass silently here.
import { nc, load } from './stub.mjs';
import { AudioContext, stats } from './webaudio.mjs';
globalThis.window.AudioContext = AudioContext;
globalThis.AudioContext = AudioContext;

const M = await load();
const { audio } = await import('/home/user/zombies-game-cod/src/audio.js');
const { ZSTATE } = await import('/home/user/zombies-game-cod/src/entities.js');
const H = 1 / 60, T = 24;
let s = 31337;
Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };

const bad = [];
const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
const cv = nc(M.VW, M.VH), cx = cv.getContext('2d');
g.begin();

audio.init();
if (!audio.ready) bad.push('the audio engine never came up');
console.log(`engine up: ${audio.ready}, ${stats.nodes} nodes, ${stats.connects} connections`);
if (!audio._music) bad.push('the music layers were never built');
if (!audio._conv) bad.push('the reverb send was never built');

// the music answers the fight ------------------------------------------------
g.started = true; g.power = true; g.powerOn = true;
g.player.hurt = () => false;
g.map.setFloor(0); g.useFloor(0);
g.player.pos.x = g.map.playerStart.x; g.player.pos.y = g.map.playerStart.y;
g.startRound(12);
g.zombies.length = 0;
g.spawnZombie = () => {};
g.zombiesSpawned = g.zombiesTotal;   // everyone for this round is already out

const mix = () => ({ ...audio._musicMix });
const gainOf = (which) => audio._music[which].gain.value;

// quiet: nothing alive
for (let i = 0; i < 60 * 2; i++) { g.player.hp = 100; g.update(H); }
const quiet = mix();
console.log(`quiet:      calm ${quiet.calm.toFixed(2)} combat ${quiet.combat.toFixed(2)} last ${quiet.last.toFixed(2)}  (combat gain ${gainOf('combat').toFixed(4)})`);
if (quiet.combat > 0.01) bad.push('the fight music is up with nothing alive');

// a fight: four of them, close
for (let i = 0; i < 4; i++) {
  const at = { x: g.player.pos.x + 60 + i * 12, y: g.player.pos.y + 40, floor: 0 };
  g.zombies.push(g.makeZombie(at, 'walker'));
}
for (let i = 0; i < 60 * 3; i++) { g.player.hp = 100; g.update(H); }
const fight = mix();
console.log(`fighting:   combat ${fight.combat.toFixed(2)} last ${fight.last.toFixed(2)}  (combat gain ${gainOf('combat').toFixed(4)})`);
if (fight.combat <= 0.05) bad.push('the fight music never came up with four zombies on top of you');

// the last one standing
for (const z of g.zombies.slice(1)) { z.dead = true; z.remove = true; z.deadT = 99; }
for (let i = 0; i < 60 * 3; i++) {
  g.player.hp = 100;
  g.zombies.length && (g.zombies[0].dead = false, g.zombies[0].remove = false);
  g.update(H);
}
const lone = mix();
console.log(`last one:   combat ${lone.combat.toFixed(2)} last ${lone.last.toFixed(2)}  (last gain ${gainOf('last').toFixed(4)})`);
if (lone.last <= 0.05) bad.push('the "last one" layer never came up with a single zombie left');
if (gainOf('last') <= gainOf('combat') * 0.5) bad.push('the last-one layer is quieter than the fight layer');

// rooms ----------------------------------------------------------------------
const zoneAt = (floor, tx, ty) => {
  g.map.setFloor(floor); g.useFloor(floor);
  g.player.pos.x = (tx + 0.5) * T; g.player.pos.y = (ty + 0.5) * T;
  return g._reverbZone();
};
const zones = { yard: zoneAt(0, 5, 5), room: zoneAt(0, 21, 15), roof: zoneAt(2, 26, 15) };
console.log(`zones:      outside ${zones.yard}, inside ${zones.room}, on the roof ${zones.roof}`);
if (zones.yard !== 'yard') bad.push(`the yard reads as ${zones.yard}`);
if (zones.room !== 'room') bad.push(`a room reads as ${zones.room}`);
if (zones.roof !== 'roof') bad.push(`the roof reads as ${zones.roof}`);

g.map.setFloor(0); g.useFloor(0);
audio.setReverb('corridor');
if (!audio._conv.buffer) bad.push('the convolver has no impulse after setReverb');
const irLen = audio._conv.buffer ? audio._conv.buffer.length : 0;
console.log(`reverb:     corridor impulse ${irLen} samples (${(irLen / 48000).toFixed(2)}s)`);
if (!irLen) bad.push('the corridor impulse is empty');
for (const z of ['room', 'yard', 'roof']) {
  if (!audio._ir(z) || !audio._ir(z).length) bad.push(`the ${z} impulse is empty`);
}

// the house, and the loudspeaker ---------------------------------------------
g.round = 12;
try {
  audio.creak(1); audio.drip(1); audio.glass(1); audio.lastRound();
  const hold = audio.voice('They are inside. That window is gone.');
  console.log(`house:      creak/drip/glass/click ok; voice holds ${hold.toFixed(1)}s`);
  if (!(hold > 0)) bad.push('the loudspeaker returned no subtitle time');
} catch (e) { bad.push(`a house sound threw: ${e.message}`); }

g.voice = null; g._voiceCd = 0;
g.say('breach');
if (!g.voice || !g.voice.text) bad.push('say() did not put a line on screen');
else console.log(`voice:      "${g.voice.text}"`);
// it must not talk over itself, and it must stay quiet before round ten
const first = g.voice.text;
g.say('medic');
if (g.voice.text !== first) bad.push('a second line interrupted the first');
const g2 = new M.Game(new M.Input(nc(M.VW, M.VH)));
g2.begin(); g2.startRound(6);
g2.say('round');
if (g2.voice) bad.push('the loudspeaker talks before round ten');
else console.log('voice:      silent on round 6, as it should be');

// and the subtitle draws
try { g.draw(cx); } catch (e) { bad.push(`drawing the subtitle threw: ${e.message}`); }

await new Promise((r) => setTimeout(r, 120));   // let the reverb swap land
console.log(bad.length ? '\nATMOSPHERE FAIL\n  ' + bad.join('\n  ') : '\nATMOSPHERE PASS');
