// Item B: the miner, the mimic, the field medic and the amalgam. Every one of
// them is a behaviour, so every one of them gets watched rather than trusted.
import { nc, load } from './stub.mjs';
const M = await load();
const { ZSTATE } = await import('/home/user/zombies-game-cod/src/entities.js');
const NAME = Object.fromEntries(Object.entries(ZSTATE).map(([k, v]) => [v, k]));
const H = 1 / 60, T = 24;
let s = 20240917;
Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };

const bad = [];
const fresh = (round = 6) => {
  const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g.begin(); g.started = true; g.power = true; g.powerOn = true;
  g.player.hurt = () => false;
  g.map.setFloor(0); g.useFloor(0);
  g.player.pos.x = g.map.playerStart.x; g.player.pos.y = g.map.playerStart.y;
  g.startRound(round);
  g.zombies.length = 0;
  // no round spawns: these tests are about one creature at a time
  g.roundActive = false;
  g.zombiesSpawned = g.zombiesTotal;
  g.spawnZombie = () => {};        // and no surprises from the round
  return g;
};
const at = (tx, ty) => ({ x: (tx + 0.5) * T, y: (ty + 0.5) * T });
const run = (g, secs) => { for (let i = 0; i < Math.round(secs * 60); i++) { g.player.hp = 100; g.update(H); } };

// ---------------------------------------------------------------- miner ----
{
  const g = fresh(12);
  const z = g.makeZombie(at(30, 15), 'miner');
  g.zombies.push(z);
  run(g, 3);
  console.log(`miner:  ${NAME[z.state]} at ${Math.round(Math.hypot(z.pos.x - g.player.pos.x, z.pos.y - g.player.pos.y))} px`);
  if (z.state !== ZSTATE.BURIED) bad.push(`miner did not dig in (${NAME[z.state]})`);
  const before = z.hp;
  const dealt = z.hurt(500, false, g, 0);
  if (dealt !== 0 || z.hp !== before) bad.push('a buried miner can still be shot');
  // walk up to it
  g.player.pos.x = z.pos.x - 40; g.player.pos.y = z.pos.y;
  run(g, 0.6);
  console.log(`        walked up: ${NAME[z.state]}  (emerge left ${z.emergeT.toFixed(2)}s)`);
  if (z.state !== ZSTATE.EMERGE && z.state !== ZSTATE.HUNT) bad.push(`miner stayed buried when stepped on (${NAME[z.state]})`);
  run(g, 1.2);
  if (z.state === ZSTATE.BURIED || z.state === ZSTATE.EMERGE) bad.push('miner never finished climbing out');
  console.log(`        after 1.8s: ${NAME[z.state]}`);
}

// ---------------------------------------------------------------- mimic ----
{
  const g = fresh(16);
  const z = g.makeZombie(at(28, 15), 'mimic');
  g.zombies.push(z);
  run(g, 1);
  const x0 = z.pos.x, y0 = z.pos.y;
  run(g, 2);
  const moved = Math.hypot(z.pos.x - x0, z.pos.y - y0);
  console.log(`mimic:  hidden=${z.hidden} moved ${moved.toFixed(1)} px in 2s`);
  if (!z.hidden) bad.push('mimic gave itself away immediately');
  if (moved > 6) bad.push(`a playing-dead mimic crawled ${moved.toFixed(0)} px`);
  // it is not immune: shooting it while it lies there works
  const dealt = z.hurt(9999, false, g, 0);
  if (dealt !== 2 && !z.dead) bad.push('a lying mimic cannot be killed');
  else console.log('        and it can be shot while it lies there');
  // a fresh one, walked up to
  const g2 = fresh(16);
  const m = g2.makeZombie(at(28, 15), 'mimic');
  g2.zombies.push(m);
  g2.player.pos.x = m.pos.x - 50; g2.player.pos.y = m.pos.y;
  run(g2, 0.5);
  const md = Math.hypot(m.pos.x - g2.player.pos.x, m.pos.y - g2.player.pos.y);
  console.log(`mimic:  approached -> hidden=${m.hidden} (pd ${Math.round(md)} px, floor ${m.floor}/${g2.map.floor}, state ${NAME[m.state]})`);
  if (m.hidden) bad.push('mimic stayed dead when the player walked up to it');
}

// ---------------------------------------------------------------- medic ----
{
  const g = fresh(14);
  // same room, clear line: the medic must not have to solve a maze to help
  const patient = g.makeZombie(at(24, 15), 'crawler');
  const medic = g.makeZombie(at(27, 15), 'medic');
  g.zombies.push(patient, medic);
  patient.hp = patient.maxHp;
  run(g, 1.2);                       // it spends the first half second climbing in
  console.log(`medic:  after 1.2s target=${medic.reviveTarget ? medic.reviveTarget.type : 'none'} floor=${medic.floor}/${g.map.floor}`);
  if (!medic.reviveTarget) bad.push('medic cannot see a crawler two tiles away');
  run(g, 6);
  console.log(`medic:  patient alive=${!patient.dead} removed=${patient.remove} dist=${Math.round(Math.hypot(medic.pos.x - patient.pos.x, medic.pos.y - patient.pos.y))}px reviveT=${medic.reviveT.toFixed(2)}`);
  console.log(`        medic: cd=${medic.medicCd.toFixed(2)} goto=${!!medic._goto} state=${NAME[medic.state]} dead=${medic.dead} remove=${medic.remove} def=${medic.def.id} crawlers=${g.zombies.filter((z) => z.type === 'crawler' && !z.dead).length} zombies=${g.zombies.length}`);
  console.log(`medic:  patient is now a ${patient.type} (hp ${Math.round(patient.hp)}/${Math.round(patient.maxHp)}), revived=${!medic.reviveTarget}`);
  if (patient.type !== 'walker') bad.push(`medic did not put the crawler back up (still ${patient.type})`);
  if (patient.hp < patient.maxHp * 0.5) bad.push('the revived crawler came back nearly dead');
  // and while it works, you can see it working
  const g2 = fresh(14);
  const p2 = g2.makeZombie(at(24, 15), 'crawler');
  const m2 = g2.makeZombie(at(25, 15), 'medic');
  g2.zombies.push(p2, m2);
  let casting = false;
  for (let i = 0; i < 60 * 4; i++) { g2.player.hp = 100; g2.update(H); if (m2.reviveT > 0) casting = true; }
  run(g2, 2.5);
  console.log(`medic:  cast beam while working: ${casting}`);
  if (!casting) bad.push('the medic gives no visible sign of what it is doing');
}

// --------------------------------------------------------------- amalgam ---
{
  const g = fresh(8);
  const group = [at(24, 15), at(25, 15), at(24, 16)].map((p) => g.makeZombie(p, 'walker'));
  for (const z of group) g.zombies.push(z);
  const killed0 = g.zombiesKilled;
  run(g, 7);
  const fused = g.zombies.filter((z) => z.type === 'fusion');
  console.log(`amalgam: ${fused.length} fusion, ${g.zombies.filter((z) => !z.dead).length} alive, killed ${killed0} -> ${g.zombiesKilled}`);
  if (fused.length !== 1) bad.push(`three walkers huddling for 7s made ${fused.length} amalgams`);
  if (fused[0] && fused[0].maxHp < group[0].maxHp * 2) bad.push('the amalgam is not actually tougher than the parts');
  if (g.zombiesKilled !== killed0 + 2) bad.push('the round counter did not absorb the two that were replaced');
  // and it must not happen instantly
  const g2 = fresh(8);
  for (const p of [at(24, 15), at(25, 15), at(24, 16)]) g2.zombies.push(g2.makeZombie(p, 'walker'));
  run(g2, 1.5);
  if (g2.zombies.some((z) => z.type === 'fusion')) bad.push('walkers fuse the moment they touch');
  console.log(`amalgam: none after 1.5s of crowding: ${!g2.zombies.some((z) => z.type === 'fusion')}`);
}

// ---------------------------------------------------------- and it draws ---
{
  const g = fresh(20);
  const cv = nc(M.VW, M.VH), cx = cv.getContext('2d');
  for (const [type, p] of [['miner', at(30, 15)], ['mimic', at(28, 16)], ['medic', at(26, 17)],
    ['fusion', at(32, 15)], ['crawler', at(27, 18)]]) {
    g.zombies.push(g.makeZombie(p, type));
  }
  try {
    run(g, 1);
    g.draw(cx);
    console.log('draw:   all five on screen, no exceptions');
  } catch (e) { bad.push(`drawing the new types threw: ${e.message}`); }
}

// ------------------------------------------------- and the mix of enemies --
{
  const g = fresh(24);
  const tally = {};
  for (let i = 0; i < 600; i++) {
    const t = g.rollEnemyType();
    tally[t] = (tally[t] ?? 0) + 1;
  }
  const share = Object.entries(tally).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${(v / 6).toFixed(0)}%`).join(', ');
  console.log(`mix at round 24: ${share}`);
  const walkers = (tally.walker ?? 0) / 600;
  if (walkers < 0.35) bad.push(`walkers are only ${(walkers * 100).toFixed(0)}% of the late mix -- specials have taken over`);
  for (const t of ['miner', 'mimic', 'medic']) {
    if (!tally[t]) bad.push(`${t} never appears even on round 24`);
  }
  // and none of them before their round
  const g2 = fresh(6);
  let early = 0;
  for (let i = 0; i < 600; i++) if (g2.rollEnemyType() !== 'walker') early++;
  if (['miner', 'mimic', 'medic'].some((t) => {
    const gg = fresh(10);
    for (let i = 0; i < 400; i++) if (gg.rollEnemyType() === t) return t === 'mimic';
    return false;
  })) bad.push('a type shows up before its round');
  console.log(`mix at round 6: ${(early / 6).toFixed(0)}% specials`);
}

console.log(bad.length ? '\nSPECIALS FAIL\n  ' + bad.join('\n  ') : '\nSPECIALS PASS');
