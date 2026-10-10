// Weapon table. 15 distinct guns: 10 wall buys + 5 wonder weapons (box only).
//
//   dmg      base body damage per pellet/bullet
//   headMul  headshot multiplier
//   delay    seconds between shots
//   spread   standard deviation of the aim cone, in radians
//   pierce   how many extra zombies a bullet passes through
//   special  on-hit extra effect (see game.js)

export const WEAPONS = {
  m1911: {
    id: 'm1911', name: 'M1911', slot: 'pistol', kind: 'semi',
    price: 0, ammoPrice: 100, dmg: 62, headMul: 2.4, mag: 8, reserve: 120, maxReserve: 120,
    delay: 0.17, reload: 1.45, spread: 0.010, pierce: 0, range: 900,
    recoil: 0.030, kick: 1.4, flash: 0.8, tracer: '#d9c27a', tint: '#c8b070',
    desc: 'Trusty sidearm. Always with you.',
  },
  mp40: {
    id: 'mp40', name: 'MP40', slot: 'smg', kind: 'auto',
    price: 1000, ammoPrice: 300, dmg: 50, headMul: 2.2, mag: 32, reserve: 288, maxReserve: 288,
    delay: 0.088, reload: 2.60, spread: 0.032, pierce: 0, range: 760,
    recoil: 0.020, kick: 1.0, flash: 1.0, tracer: '#cdd3dd', tint: '#a9b0bb',
    desc: 'Cheap, controllable, reliable.',
  },
  thompson: {
    id: 'thompson', name: 'M1A1 Thompson', slot: 'smg', kind: 'auto',
    price: 1200, ammoPrice: 300, dmg: 56, headMul: 2.2, mag: 20, reserve: 240, maxReserve: 240,
    delay: 0.078, reload: 2.35, spread: 0.028, pierce: 0, range: 720,
    recoil: 0.024, kick: 1.1, flash: 1.1, tracer: '#d8d2c0', tint: '#b6ae96',
    desc: 'Fast drum-fed classic.',
  },
  trenchgun: {
    id: 'trenchgun', name: 'M1897 Trench Gun', slot: 'shotgun', kind: 'pump',
    price: 1200, ammoPrice: 300, dmg: 36, headMul: 1.6, pellets: 6, mag: 6, reserve: 72, maxReserve: 72,
    delay: 0.72, reload: 3.40, spread: 0.115, pierce: 1, range: 420,
    recoil: 0.10, kick: 4.2, flash: 1.8, tracer: '#e0d0a0', tint: '#c5ab72',
    desc: 'Six pellets of close-range grief.',
  },
  ppsh: {
    id: 'ppsh', name: 'PPSh-41', slot: 'smg', kind: 'auto',
    price: 1800, ammoPrice: 400, dmg: 52, headMul: 2.1, mag: 71, reserve: 355, maxReserve: 355,
    delay: 0.062, reload: 3.20, spread: 0.052, pierce: 0, range: 700,
    recoil: 0.030, kick: 1.2, flash: 1.2, tracer: '#d5cdb8', tint: '#b0a68c',
    desc: 'Huge drum, wildly inaccurate. Spray and pray.',
  },
  kar98k: {
    id: 'kar98k', name: 'Kar98k', slot: 'sniper', kind: 'bolt',
    price: 1500, ammoPrice: 300, dmg: 340, headMul: 2.0, mag: 5, reserve: 90, maxReserve: 90,
    delay: 1.05, reload: 3.10, spread: 0.004, pierce: 3, range: 1400,
    recoil: 0.075, kick: 3.4, flash: 1.6, tracer: '#cdd6e2', tint: '#9aa3b0',
    desc: 'Punches straight through a queue.',
  },
  fg42: {
    id: 'fg42', name: 'FG 42', slot: 'rifle', kind: 'auto',
    price: 2000, ammoPrice: 450, dmg: 96, headMul: 2.1, mag: 25, reserve: 250, maxReserve: 250,
    delay: 0.110, reload: 2.80, spread: 0.030, pierce: 1, range: 1000,
    recoil: 0.036, kick: 2.0, flash: 1.4, tracer: '#d0d6e0', tint: '#a4acba',
    desc: 'Paratrooper rifle. Hard hits, hard kick.',
  },
  bar: {
    id: 'bar', name: 'M1918 BAR', slot: 'rifle', kind: 'auto',
    price: 2500, ammoPrice: 500, dmg: 112, headMul: 2.0, mag: 20, reserve: 240, maxReserve: 240,
    delay: 0.140, reload: 3.00, spread: 0.034, pierce: 1, range: 1050,
    recoil: 0.048, kick: 2.6, flash: 1.5, tracer: '#d6dbe4', tint: '#aab2c0',
    desc: 'Walking firepower. Slow to reload.',
  },
  mg42: {
    id: 'mg42', name: 'MG 42', slot: 'lmg', kind: 'auto',
    price: 3000, ammoPrice: 600, dmg: 102, headMul: 1.9, mag: 125, reserve: 500, maxReserve: 500,
    delay: 0.055, reload: 5.50, spread: 0.055, pierce: 1, range: 1000,
    recoil: 0.032, kick: 1.8, flash: 1.6, tracer: '#dbe0e8', tint: '#b2bac6',
    desc: 'Belt-fed. Never stop, never reload quickly.',
  },
  ptrs41: {
    id: 'ptrs41', name: 'PTRS-41', slot: 'sniper', kind: 'semi',
    price: 3000, ammoPrice: 600, dmg: 540, headMul: 1.9, mag: 5, reserve: 60, maxReserve: 60,
    delay: 1.20, reload: 3.60, spread: 0.003, pierce: 5, range: 1600,
    recoil: 0.11, kick: 5.0, flash: 2.0, tracer: '#e2e6ee', tint: '#9ba3b2',
    desc: 'Anti-tank rifle. Skewer the whole lane.',
  },

  // ---------------------------------------------------------- wonder weapons
  raygun: {
    id: 'raygun', name: 'Ray Gun', slot: 'wonder', kind: 'semi', wonder: true, boxTier: 34,
    price: 0, ammoPrice: 0, dmg: 400, headMul: 1.0, mag: 20, reserve: 160, maxReserve: 160,
    delay: 0.28, reload: 2.60, spread: 0.008, pierce: 0, range: 1000,
    recoil: 0.040, kick: 2.4, flash: 1.8, tracer: '#8fe05a', tint: '#7fd75a',
    special: 'splash', splashR: 34, splashDmg: 180, splashColor: '#8fe05a',
    desc: 'Green plasma. Splashes. Do not stand near the wall.',
  },
  wunderwaffe: {
    id: 'wunderwaffe', name: 'Wunderwaffe DG-2', slot: 'wonder', kind: 'semi', wonder: true, boxTier: 18,
    price: 0, ammoPrice: 0, dmg: 300, headMul: 1.0, mag: 12, reserve: 96, maxReserve: 96,
    delay: 0.50, reload: 3.00, spread: 0.006, pierce: 0, range: 950,
    recoil: 0.050, kick: 2.6, flash: 2.0, tracer: '#a8dcff', tint: '#8fd6ff',
    special: 'chain', chainCount: 4, chainRange: 190, chainFalloff: 0.7, chainColor: '#a8dcff',
    desc: 'Arcs lightning through the crowd.',
  },
  thundergun: {
    id: 'thundergun', name: 'Thunder Gun', slot: 'wonder', kind: 'semi', wonder: true, boxTier: 16,
    price: 0, ammoPrice: 0, dmg: 900, headMul: 1.0, mag: 8, reserve: 40, maxReserve: 40,
    delay: 0.90, reload: 3.50, spread: 0.0, pierce: 0, range: 320,
    recoil: 0.02, kick: 5.5, flash: 2.2, tracer: '#f5b45c', tint: '#f0a03c',
    special: 'shock', shockRange: 300, shockAngle: 0.62, shockDmg: 900, shockPush: 620,
    shockColor: '#f5b45c',
    desc: 'Blows the whole hallway into next week.',
  },
  winterhowl: {
    id: 'winterhowl', name: "Winter's Howl", slot: 'wonder', kind: 'semi', wonder: true, boxTier: 16,
    price: 0, ammoPrice: 0, dmg: 70, headMul: 1.0, mag: 20, reserve: 100, maxReserve: 100,
    delay: 0.35, reload: 3.00, spread: 0.0, pierce: 0, range: 700,
    recoil: 0.02, kick: 1.6, flash: 1.6, tracer: '#9fe9ff', tint: '#7fe6ff',
    special: 'freeze', freezeR: 90, freezeTime: 5.0, freezeColor: '#9fe9ff',
    desc: 'Freezes everything it touches solid.',
  },
  monkeybomb: {
    id: 'monkeybomb', name: 'Monkey Bomb', slot: 'wonder', kind: 'throw', wonder: true, boxTier: 16,
    price: 0, ammoPrice: 0, dmg: 3000, headMul: 1.0, mag: 3, reserve: 9, maxReserve: 9,
    delay: 0.90, reload: 1.20, spread: 0, pierce: 0, range: 480,
    recoil: 0, kick: 0, flash: 0, tracer: '#d8c070', tint: '#b9b06a',
    special: 'lure', lureTime: 6.0, lureR: 460, fuse: 6.0, boomR: 150, boomDmg: 3000,
    desc: 'Wind it up, throw it, walk away. They love it.',
  },
};

/** Order shown in the weapon-select bar and cycled with 1..9 / the wheel. */
export const WEAPON_ORDER = [
  'm1911', 'mp40', 'thompson', 'trenchgun', 'ppsh',
  'kar98k', 'fg42', 'bar', 'mg42', 'ptrs41',
  'raygun', 'wunderwaffe', 'thundergun', 'winterhowl', 'monkeybomb',
];

/** Wonder weapons occupy the whole kit: they replace nothing, they join it. */
export const WONDER_IDS = Object.values(WEAPONS).filter((w) => w.wonder).map((w) => w.id);

export const GRENADE_PRICE = 250;
export const GRENADE_MAX = 4;

/** Auto-fire weapons hold the trigger; everything else needs a fresh click. */
export function isAuto(w) { return w.kind === 'auto'; }

const SLOT_SOUND = {
  pistol: 'pistol', smg: 'smg', shotgun: 'shotgun',
  sniper: 'sniper', rifle: 'rifle', lmg: 'rifle', wonder: 'raygun',
};

export function shotSound(w) {
  if (w.wonder) return w.id === 'monkeybomb' ? 'throw' : w.id;
  return SLOT_SOUND[w.slot] ?? 'pistol';
}

/** Weighted roll for the Mystery Box. */
export function rollBox(rng = Math.random) {
  const entries = Object.values(WEAPONS).filter((w) => w.price > 0 || w.wonder);
  let total = 0;
  for (const w of entries) total += w.wonder ? (w.boxTier ?? 12) : 10;
  let r = rng() * total;
  for (const w of entries) {
    r -= w.wonder ? (w.boxTier ?? 12) : 10;
    if (r <= 0) return w.id;
  }
  return entries[0].id;
}

export function weapon(id) { return WEAPONS[id]; }

// ---------------------------------------------------------------------------
//  Pack-a-Punch
// ---------------------------------------------------------------------------
export const PAP_PRICE = 5000;

export const PAP_NAMES = {
  m1911: 'Mustang & Sally',
  mp40: 'Afterburner',
  thompson: 'Gibs-O-Matic',
  trenchgun: 'Gut Shot',
  ppsh: 'The Reaper',
  kar98k: 'Headcutter',
  fg42: 'Payload',
  bar: 'Barracudda',
  mg42: 'Belt-Fed Fury',
  ptrs41: 'The Penetrator',
  raygun: "Porter's X2 Ray Gun",
  wunderwaffe: 'Wunderwaffe DG-3 JZ',
  thundergun: 'Zeus Cannon',
  winterhowl: "Winter's Fury",
  monkeybomb: 'Quantum Entangler',
};

const PACKED = {};
for (const w of Object.values(WEAPONS)) {
  const p = {
    ...w,
    packed: true,
    name: PAP_NAMES[w.id] ?? `${w.name} (Punched)`,
    dmg: Math.round(w.dmg * 2.2),
    mag: Math.max(1, Math.round(w.mag * 1.5)),
    maxReserve: Math.round(w.maxReserve * 2),
    pierce: (w.pierce ?? 0) + 1,
    reload: Math.round(w.reload * 0.9 * 100) / 100,
    spread: Math.round(w.spread * 0.8 * 1e5) / 1e5,
    range: Math.round(w.range * 1.15),
    tracer: '#8fe05a',
    tint: '#7fd75a',
    kick: Math.round(w.kick * 1.15 * 10) / 10,
    flash: w.flash * 1.3,
  };
  if (w.splashDmg) p.splashDmg = Math.round(w.splashDmg * 2);
  if (w.splashR) p.splashR = Math.round(w.splashR * 1.3);
  if (w.shockDmg) p.shockDmg = Math.round(w.shockDmg * 2);
  if (w.freezeTime) p.freezeTime = w.freezeTime * 1.5;
  if (w.boomDmg) p.boomDmg = Math.round(w.boomDmg * 2);
  if (w.boomR) p.boomR = Math.round(w.boomR * 1.35);
  if (w.chainCount) p.chainCount = w.chainCount + 2;
  PACKED[w.id] = p;
}

/**
 * A punched gun fires a rainbow: no two bullets leave the barrel the same
 * colour, and a stream of them reads as a ribbon. The hue runs on the clock,
 * so it is the same colour on every machine watching the shot.
 */
export function packedTracer(time = 0) {
  const hue = Math.round(((time * 210) % 360 + 360) % 360);
  return `hsl(${hue}, 88%, 62%)`;
}

/** Weapon stats for `id`, upgraded if it has been through the machine. */
export function defFor(id, packed = false) {
  return packed ? (PACKED[id] ?? WEAPONS[id]) : WEAPONS[id];
}
