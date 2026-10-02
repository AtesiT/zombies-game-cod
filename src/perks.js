// Perk-a-Cola machines. Eight of them, spread across the whole map.

export const PERKS = {
  juggernog: {
    id: 'juggernog', name: 'Juggernog', price: 2500, colour: '#d0503c', short: 'JUG',
    desc: 'Doubles your max health.',
  },
  speedcola: {
    id: 'speedcola', name: 'Speed Cola', price: 3000, colour: '#3fa9f5', short: 'SPD',
    desc: 'Reloads twice as fast.',
  },
  doubletap: {
    id: 'doubletap', name: 'Double Tap', price: 2000, colour: '#e8b53a', short: 'DBL',
    desc: 'Rounds leave the barrel 33% faster.',
  },
  quickrevive: {
    id: 'quickrevive', name: 'Quick Revive', price: 1500, colour: '#63c74d', short: 'QRV',
    desc: 'Health returns sooner, and quicker.',
  },
  staminup: {
    id: 'staminup', name: "Stamin-Up", price: 2000, colour: '#f5e04a', short: 'STM',
    desc: 'Run 25% faster, for longer.',
  },
  phdflopper: {
    id: 'phdflopper', name: 'PhD Flopper', price: 2000, colour: '#e07ab0', short: 'PHD',
    desc: 'Immune to your own explosions. Dive-blasts on landing.',
  },
  deadshot: {
    id: 'deadshot', name: 'Deadshot Daiquiri', price: 1500, colour: '#b07ad0', short: 'DED',
    desc: 'Your aim drifts toward the head.',
  },
  widowswine: {
    id: 'widowswine', name: "Widow's Wine", price: 2000, colour: '#7ad0c8', short: 'WID',
    desc: 'Knife and frags leave slowing webs.',
  },
};

export const PERK_ORDER = Object.keys(PERKS);

export const MAX_PERKS = 6;

/** Derived stats given an active perk set. */
export function perkEffects(perks) {
  const has = (id) => perks.has(id);
  return {
    maxHp: 100 + (has('juggernog') ? 100 : 0),
    reloadMul: has('speedcola') ? 0.5 : 1,
    fireDelayMul: has('doubletap') ? 0.67 : 1,
    speedMul: has('staminup') ? 1.25 : 1,
    sprintMul: has('staminup') ? 1.15 : 1,
    regenDelay: has('quickrevive') ? 2.4 : 5.0,
    regenRate: has('quickrevive') ? 58 : 30,
    splashImmune: has('phdflopper'),
    headMagnet: has('deadshot') ? 0.26 : 0,
    webs: has('widowswine'),
    diveBlast: has('phdflopper'),
  };
}
