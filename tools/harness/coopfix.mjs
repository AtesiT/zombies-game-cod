// The co-op and play-rule fixes of the odd-jobs batch, each one reproduced:
//   1. a downed body bleeds on the clock alone -- zombies cannot hurry it
//   2. revival is a channel: ten seconds of holding him, five with Quick Revive
//   3. a body that bled out comes back next round with its sidearm only
//   4. god mode is god mode: fire and gas bow to it too, and so does your own
//      fire when you own the Flopper
//   5. molotovs and gas bombs: real pools and clouds, from the pockets
//   6. power-ups belong to the body that walks over them
//   7. the room holds more than four, and a hosted room gets a fresh code
import { nc, load, SRC } from './stub.mjs';

const M = await load();
const ENT = await import(SRC + '/entities.js');
const NET = await import(SRC + '/net.js');
const PU = await import(SRC + '/powerups.js');
const { Player } = ENT;
const MAX_PLAYERS = NET.MAX_PLAYERS;
const H = 1 / 60;
let fails = 0;
const failNames = [];
const ok = (c, m, extra = '') => {
  if (c) console.log(' ok  ', m);
  else { fails++; failNames.push(m + (extra ? ` (${extra})` : '')); console.log('FAIL ', m, extra); }
};

const boot = () => {
  const g = new M.Game(new M.Input(nc(M.VW, M.VH)));
  g.begin();
  g.powerOn = true;
  for (let i = 0; i < 30; i++) { g.update(H); g.input.endFrame(); }
  return g;
};
const mate = (g, x, y) => {
  const p = new Player(g.map, x, y);
  p.game = g;
  p.netId = 900 + g.players.length;
  p.name = 'MATE';
  p.floor = g.map.floor;
  g.players.push(p);
  return p;
};

// ---- 1. the clock is the only finisher -------------------------------------
{
  const g = boot();
  const m = mate(g, g.player.pos.x + 60, g.player.pos.y);
  m.hp = 0; m.downed = true; m.bleedT = 60;
  ok(m.bleedT === 60, 'a fresh down is a full minute', String(m.bleedT));
  const before = m.bleedT;
  m.hurt(40, m.pos.x + 5, m.pos.y, g);
  m.hurt(40, m.pos.x - 5, m.pos.y, g);
  ok(m.bleedT === before && !m.dead, 'a zombie chewing a downed body hurried the clock',
    `${before} -> ${m.bleedT}`);
  for (let i = 0; i < 60 * 30; i++) m.update(H, g, g.input);
  ok(!m.dead && m.downed, 'thirty seconds of bleeding ended him early');
  for (let i = 0; i < 60 * 31; i++) m.update(H, g, g.input);
  ok(m.dead && !m.downed, 'the minute ran out and he was still down');
}

// ---- 2. revival is a channel, not a tap ------------------------------------
{
  const g = boot();
  // the horde must not vote in this test -- and the wave logic must not
  // start the next round under us (intermission<=0 restarts it immediately)
  g.zombies.length = 0; g.roundActive = false; g.intermission = 1e6; g.respawnQueue = 0;
  const m = mate(g, g.player.pos.x + 20, g.player.pos.y);
  m.hp = 0; m.downed = true; m.bleedT = 60;
  g.input.keys.add('KeyF');
  for (let i = 0; i < 60 * 4; i++) { g.update(H); g.input.endFrame(); }
  ok(m.downed, 'four seconds of holding him was enough (it must take ten)');
  for (let i = 0; i < 60 * 7; i++) { g.update(H); g.input.endFrame(); }
  ok(!m.downed && m.hp > 0, 'ten seconds of holding him did not bring him up');
  // and with Quick Revive the same hands take half the time
  const m2 = mate(g, g.player.pos.x + 18, g.player.pos.y + 30);
  m2.hp = 0; m2.downed = true; m2.bleedT = 60;
  g.player.perks.add('quickrevive'); g.player.applyPerks?.();
  g.zombies.length = 0; g.roundActive = false; g.intermission = 1e6; g.respawnQueue = 0;
  for (let i = 0; i < 60 * 5.5; i++) { g.update(H); g.input.endFrame(); }
  ok(!m2.downed, 'Quick Revive did not halve the channel',
    `reviveT=${g._reviveT} need=${g.reviveNeed} downed=${m2.downed} hp=${m2.hp} `
    + `lastHurt=${(m2.lastHurt ?? -1).toFixed(2)} t=${g.time.toFixed(2)} zombies=${g.zombies.length} `
    + `bleed=${(m2.bleedT ?? 0).toFixed(1)} invuln=${(m2.invuln ?? 0).toFixed(2)}`);
  g.input.keys.delete('KeyF');
}

// ---- 3. bled out: back next round with the sidearm -------------------------
{
  const g = boot();
  const m = mate(g, g.player.pos.x + 60, g.player.pos.y);
  m.giveWeapon('mp40');
  m.dead = true;
  g.startRound(g.round + 1);
  ok(!m.dead, 'the dead stayed dead into the next round');
  ok(m.slots.filter(Boolean).join(',') === 'm1911',
    `he came back carrying ${m.slots.filter(Boolean).join(',')}, want the m1911 alone`);
  ok(m.hp === m.maxHp, 'he came back hurt');
}

// ---- 4. god mode owns the fire and the gas too -----------------------------
{
  const g = boot();
  g.debug.god = true;
  const hp = g.player.hp;
  g.fires.push({ x: g.player.pos.x, y: g.player.pos.y, r: 40, life: 2, max: 2, tick: 0, puff: 0, f: 0 });
  g.gases.push({ x: g.player.pos.x, y: g.player.pos.y, r: 40, life: 2, max: 2, puff: 0, drift: 0, f: 0, owner: {} });
  for (let i = 0; i < 60 * 2; i++) g.update(H);
  ok(g.player.hp === hp, `god mode leaked: ${hp} -> ${g.player.hp}`);
  g.debug.god = false;
  // your own fire knows you, if you own the flopper
  const g2 = boot();
  g2.player.perks.add('phdflopper'); g2.player.applyPerks?.();
  const hp2 = g2.player.hp;
  g2.fires.push({ x: g2.player.pos.x, y: g2.player.pos.y, r: 40, life: 2, max: 2, tick: 0, puff: 0, f: 0, owner: g2.player });
  for (let i = 0; i < 60 * 2; i++) g2.update(H);
  ok(g2.player.hp === hp2, `the Flopper did not own your own fire: ${hp2} -> ${g2.player.hp}`);
  // but somebody else's fire still burns you
  const g3 = boot();
  const hp3 = g3.player.hp;
  g3.fires.push({ x: g3.player.pos.x, y: g3.player.pos.y, r: 40, life: 2, max: 2, tick: 0, puff: 0, f: 0, owner: null });
  for (let i = 0; i < 60 * 1; i++) g3.update(H);
  ok(g3.player.hp < hp3, 'strange fire did not burn at all');
}

// ---- 5. the bottles and the pots do what the crate promised ----------------
{
  const g = boot();
  g.zombies.length = 0;
  const z = new M.Zombie(g.map, g.player.pos.x + 190, g.player.pos.y);
  z.floor = 0;
  g.zombies.push(z);
  const zhp = z.hp;
  g.player.ownThrow.molotov = true; g.player.molotovs = 2;
  g.player.aim = 0;
  g.throwFor(g.player, 'molotov');
  ok(g.player.molotovs === 1, 'the bottle did not leave the pocket');
  for (let i = 0; i < 60 * 3; i++) g.update(H);
  ok(g.fires.some((f) => f.owner === g.player), 'the bottle landed without leaving fire');
  for (let i = 0; i < 60 * 2; i++) g.update(H);
  ok(z.hp < zhp || z.dead, 'the pool of fire did not cook the walker in it', `${zhp} -> ${z.hp}`);
  // gas: slow, and a little biting
  const g2 = boot();
  g2.zombies.length = 0;
  const z2 = new M.Zombie(g2.map, g2.player.pos.x + 190, g2.player.pos.y);
  z2.floor = 0;
  g2.zombies.push(z2);
  g2.player.ownThrow.gas = true; g2.player.gasbombs = 2;
  g2.player.aim = 0;
  g2.throwFor(g2.player, 'gas');
  let maxWeb = 0;
  for (let i = 0; i < 60 * 3; i++) { g2.update(H); maxWeb = Math.max(maxWeb, z2.webbed ?? 0); }
  ok(g2.gases.some((x) => x.owner === g2.player), 'the pot landed without leaving a cloud');
  ok(maxWeb > 0.2, 'the cloud did not slow the walker in it', String(maxWeb));
  // the pockets come back two at a time, and stop at four
  const g3 = boot();
  g3.player.ownThrow.frag = true; g3.player.grenades = 3;
  g3.startRound(g3.round + 1);
  ok(g3.player.grenades === 4, `replenish overshot: ${g3.player.grenades}`);
  g3.player.ownThrow.molotov = false; g3.player.molotovs = 0;
  g3.startRound(g3.round + 2);
  ok(g3.player.molotovs === 0, 'an unowned pocket replenished itself');
}

// ---- 6. the power-up pays the body that picked it up -----------------------
{
  const g = boot();
  const m = mate(g, g.player.pos.x + 200, g.player.pos.y);
  m.slots[0] = 'm1911';
  m.loadout.m1911.reserve = 0;
  g.powerups.push(new PU.Powerup(m.pos.x + 4, m.pos.y, 'maxammo', 0));
  for (let i = 0; i < 60 * 1; i++) g.update(H);
  ok(m.loadout.m1911.reserve > 0, 'the mate walked over MAX AMMO and the host got the bullets');
}

// ---- 7. the room: more chairs, and a fresh code per host -------------------
{
  ok(MAX_PLAYERS >= 8, `the room still caps at ${MAX_PLAYERS}`);
  const g = boot();
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(g.net.makeRoomCode());
  ok(seen.size === 40, 'two hosts drew the same room code');
  ok([...seen][0].length === 5 && /^[ABDEFGHJKLMNPQRSTUWXYZ23456789]{5}$/.test([...seen][0]),
    `the code looks wrong: ${[...seen][0]}`);
}

console.log(fails
  ? `\n${fails} FAILURES:\n  ${failNames.join('\n  ')}`
  : '\nCOOPFIX PASS  the clock, the channel, the pockets and the room all hold');
process.exit(fails ? 1 : 0);
