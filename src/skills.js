// Run skills: a small, personal specialisation that lasts one night.
//
// Every fifth round the player is offered three of these and keeps one. They
// are not perk machines -- nothing is bought, nothing survives a death, and
// they stack with whatever the machines sell. The pool is deliberately wider
// than one run can collect (sixteen against six or seven picks), so the same
// player does not get the same character every night.
//
// Every entry has to be worth *choosing* without being worth *relying on*:
// the numbers are small, multipliers multiply (never add) with the perks, and
// nothing here gives a third gun, a second throwing hand or free health.

export const SKILLS = {
  deadeye: {
    id: 'deadeye', name: 'Deadeye', short: 'DEA', colour: '#e8b53a', tag: 'SHOOTING',
    desc: '+15% damage. Headshots hit 25% harder still.',
  },
  fastloader: {
    id: 'fastloader', name: 'Fast Hands', short: 'FST', colour: '#3fa9f5', tag: 'SHOOTING',
    desc: 'Reload 20% faster.',
  },
  trigger: {
    id: 'trigger', name: 'Hair Trigger', short: 'HTR', colour: '#e07a4a', tag: 'SHOOTING',
    desc: 'Automatic weapons fire 10% faster.',
  },
  coolhead: {
    id: 'coolhead', name: 'Cold Blood', short: 'CLD', colour: '#8ab8d8', tag: 'SHOOTING',
    desc: 'Stand still for half a second: the next shot does +30%.',
  },
  laststand: {
    id: 'laststand', name: 'Last Stand', short: 'LST', colour: '#c4463a', tag: 'SHOOTING',
    desc: '+25% damage while below 35% health.',
  },
  sprinter: {
    id: 'sprinter', name: 'Long Stride', short: 'LNG', colour: '#f5e04a', tag: 'MOVEMENT',
    desc: 'Walk 8% faster and sprint 6% faster.',
  },
  secondwind: {
    id: 'secondwind', name: 'Second Wind', short: 'WND', colour: '#7fbf5f', tag: 'MOVEMENT',
    desc: 'Drop below 30% health: +20% speed for 2s, once a round.',
  },
  ironhide: {
    id: 'ironhide', name: 'Iron Hide', short: 'IRN', colour: '#d0503c', tag: 'SURVIVAL',
    desc: '+30 maximum health.',
  },
  survivor: {
    id: 'survivor', name: 'Survivor', short: 'SRV', colour: '#63c74d', tag: 'SURVIVAL',
    desc: 'Health starts coming back 28% sooner and 30% faster.',
  },
  hardened: {
    id: 'hardened', name: 'Hardened', short: 'HRD', colour: '#8a8371', tag: 'SURVIVAL',
    desc: 'Take 12% less damage from everything.',
  },
  medic: {
    id: 'medic', name: 'Field Medic', short: 'MED', colour: '#7ad0c8', tag: 'SURVIVAL',
    desc: 'Medkits heal 45% more.',
  },
  engineer: {
    id: 'engineer', name: 'Engineer', short: 'ENG', colour: '#b0a070', tag: 'SUPPORT',
    desc: 'Nail planks back on 35% faster.',
  },
  scavenger: {
    id: 'scavenger', name: 'Scavenger', short: 'SCV', colour: '#9fd0e0', tag: 'SUPPORT',
    desc: 'Every point you earn counts 15% higher.',
  },
  demolition: {
    id: 'demolition', name: 'Demolitionist', short: 'DEM', colour: '#e0705a', tag: 'THROWING',
    desc: 'Your frags blast 20% wider and 15% harder.',
  },
  strongarm: {
    id: 'strongarm', name: 'Strong Arm', short: 'STR', colour: '#f0a050', tag: 'THROWING',
    desc: 'Throwables fly 25% faster, so they land farther.',
  },
  packmule: {
    id: 'packmule', name: 'Pack Mule', short: 'PKM', colour: '#c8a05a', tag: 'THROWING',
    desc: 'One extra throwable in every between-round refill.',
  },
};

export const SKILL_IDS = Object.keys(SKILLS);

/** How long a draft waits before it picks for you. */
export const DRAFT_TIME = 20;

/** How often a draft is offered. */
export const DRAFT_EVERY = 5;

/** The flat sums a player's skills apply. Missing skills mean a clean 1. */
export function skillEffects(skills) {
  const has = (id) => !!(skills && typeof skills.has === 'function' && skills.has(id));
  const deadeye = has('deadeye'), survivor = has('survivor'), demo = has('demolition');
  return {
    dmgMul: deadeye ? 1.15 : 1,
    headMul: deadeye ? 1.25 : 1,
    reloadMul: has('fastloader') ? 0.8 : 1,
    fireDelayMul: has('trigger') ? 0.9 : 1,
    speedMul: has('sprinter') ? 1.08 : 1,
    sprintMul: has('sprinter') ? 1.06 : 1,
    bonusHp: has('ironhide') ? 30 : 0,
    regenDelayMul: survivor ? 0.72 : 1,
    regenRateMul: survivor ? 1.3 : 1,
    medkitMul: has('medic') ? 1.45 : 1,
    buildTimeMul: has('engineer') ? 0.65 : 1,
    pointsMul: has('scavenger') ? 1.15 : 1,
    blastR: demo ? 1.2 : 1,
    blastDmgMul: demo ? 1.15 : 1,
    throwSpeedMul: has('strongarm') ? 1.25 : 1,
    secondwind: has('secondwind'),
    secondwindSpeed: has('secondwind') ? 1.2 : 1,
    laststandHp: 0.35,
    lastStandMul: has('laststand') ? 1.25 : 1,
    takenMul: has('hardened') ? 0.88 : 1,
    refillBonus: has('packmule') ? 1 : 0,
    coolhead: has('coolhead'),
    coolheadMul: has('coolhead') ? 1.3 : 1,
  };
}

/** A frozen/clean effect set, used by bodies created before any skills exist. */
export const NO_SKILLS = skillEffects(null);

/**
 * Three ids the player does not already own, in a random order.
 * `count` is capped by the size of the pool, so a finished character is not
 * offered an empty draft.
 */
export function makeDraft(owned, count = 3, rng = Math.random) {
  const pool = SKILL_IDS.filter((id) => !(owned && owned.has && owned.has(id)));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.max(1, Math.min(count, pool.length)));
}

/** "FST + DEA + IRN": the compact line the HUD and the final screen use. */
export function skillLine(skills, sep = ' · ') {
  const list = SKILL_IDS.filter((id) => skills?.has?.(id));
  return list.map((id) => SKILLS[id].short).join(sep);
}
