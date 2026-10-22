// Outfits: what the soldier in the middle of the screen is wearing.
//
// Ten of them, and every one is earned the same way -- by doing the thing its
// badge asks for (see src/achievements.js). An outfit is two things at once:
// a palette the player sprite is rebuilt from (art.js does that once per
// outfit, at boot), and a small, flat bonus to one stat. The bonuses are the
// size of a run skill, not a perk: they are meant to make a night feel a
// little different, never to replace something you can buy.
//
// The choice lives in localStorage and travels on the wire, so the other
// people in a co-op room see the coat they are standing next to.
//
// Nothing here imports the game: this is data plus two tiny storage helpers,
// which is what keeps art.js able to build the sprites from it.

export const SKIN_KEY = 'ndu.skin.v1';

/**
 * Ten outfits. `pal` overrides palette keys from src/spriteData.js PAL for the
 * walking body only -- skin, guns and boots stay where they are, because a
 * soldier whose hands change colour with his coat looks like a bug.
 *
 * `fx` is folded into the same stat block the perks and run skills use (see
 * Player.applyPerks), and every field is a multiplier unless it says otherwise:
 *   speedMul, reloadMul, regenRateMul, headMul, knifeMul, dashMul, salvageMul
 *   bonusHp, refillBonus, startArmor   (flat values)
 */
export const SKIN_ORDER = [
  'scout', 'medic', 'speedloader', 'marksman', 'blademan',
  'juggernaut', 'hoarder', 'ghost', 'scavenger', 'veteran',
];

export const SKINS = {
  scout: {
    id: 'scout', name: 'THE SCOUT', ach: 'round_10', colour: '#9aa86a',
    buff: 'Walks 8% faster', short: '+8% SPEED',
    fx: { speedMul: 1.08 },
    pal: {
      h: '#66743f', H: '#8a9a5b', J: '#a3b070',
      U: '#7d8a52', u: '#5f6a3c', I: '#9aa86a',
      L: '#6a7446', K: '#7c8852', b: '#3a3524',
    },
  },
  medic: {
    id: 'medic', name: 'FIELD MEDIC', ach: 'field_medic', colour: '#e6e1d2',
    buff: 'Health comes back 30% faster', short: '+30% REGEN',
    fx: { regenRateMul: 1.3 },
    pal: {
      h: '#a8a496', H: '#d8d4c8', J: '#efece2',
      U: '#cfcab9', u: '#a9a494', I: '#e6e1d2',
      L: '#b9b4a3', K: '#cdc8b7', b: '#7c2a2a',
    },
  },
  speedloader: {
    id: 'speedloader', name: 'SPEED LOADER', ach: 'packed', colour: '#5b83b8',
    buff: 'Reloads 15% faster', short: '-15% RELOAD',
    fx: { reloadMul: 0.85 },
    pal: {
      h: '#22374f', H: '#2f4a6b', J: '#456a94',
      U: '#37557a', u: '#28405d', I: '#4d7099',
      L: '#2c4560', K: '#3a587a', b: '#1b2a3a',
    },
  },
  marksman: {
    id: 'marksman', name: 'THE MARKSMAN', ach: 'marksman', colour: '#7d9455',
    buff: 'Headshots hit 25% harder', short: '+25% HEAD',
    fx: { headMul: 1.25 },
    pal: {
      h: '#2c3720', H: '#3c4a2e', J: '#57683f',
      U: '#42502f', u: '#32402a', I: '#5b6b45',
      L: '#39452c', K: '#4a5738', b: '#26301c',
    },
  },
  blademan: {
    id: 'blademan', name: 'THE BLADE', ach: 'knife_work', colour: '#c0605a',
    buff: 'The knife hits 50% harder', short: '+50% KNIFE',
    fx: { knifeMul: 1.5 },
    pal: {
      h: '#1d1d20', H: '#2a2a2e', J: '#3f3f45',
      U: '#31313a', u: '#232329', I: '#43434d',
      L: '#26262c', K: '#33333b', b: '#7c1f22',
    },
  },
  juggernaut: {
    id: 'juggernaut', name: 'THE HEAVY', ach: 'round_20', colour: '#8b9298',
    buff: '15 more maximum health', short: '+15 HP',
    fx: { bonusHp: 15 },
    pal: {
      h: '#4e5257', H: '#6a6f74', J: '#868b90',
      U: '#5d6368', u: '#444a4f', I: '#767c82',
      L: '#4f545a', K: '#5f656b', b: '#33373b',
    },
  },
  hoarder: {
    id: 'hoarder', name: 'THE HOARDER', ach: 'care_package', colour: '#d0a83c',
    buff: 'One more throwable every round', short: '+1 THROW',
    fx: { refillBonus: 1 },
    pal: {
      h: '#8a6a1e', H: '#b08a2a', J: '#d0a83c',
      U: '#9a7c2a', u: '#7a6220', I: '#b89438',
      L: '#6a5a28', K: '#7d6b30', b: '#4a3c18',
    },
  },
  ghost: {
    id: 'ghost', name: 'THE GHOST', ach: 'untouchable', colour: '#8a7ab0',
    buff: 'The dash comes back in 3 seconds', short: 'FAST DASH',
    fx: { dashMul: 0.6 },
    pal: {
      h: '#221d2c', H: '#332d40', J: '#554a68',
      U: '#332d40', u: '#24202e', I: '#4a4159',
      L: '#2b2636', K: '#3a3348', b: '#7a5aa0',
    },
  },
  scavenger: {
    id: 'scavenger', name: 'THE SCAVENGER', ach: 'big_spender', colour: '#c47a3c',
    buff: 'Kills drop scrap 50% more often', short: '+50% SCRAP',
    fx: { salvageMul: 1.5 },
    pal: {
      h: '#7c4320', H: '#a25a2a', J: '#c47a3c',
      U: '#8c4e26', u: '#6d3b1c', I: '#a96232',
      L: '#5c3a22', K: '#6d452a', b: '#3f2814',
    },
  },
  veteran: {
    id: 'veteran', name: 'THE VETERAN', ach: 'round_30', colour: '#c8a54a',
    buff: 'Starts every night with 25 armour', short: '+25 ARMOUR',
    fx: { startArmor: 25 },
    pal: {
      h: '#43431f', H: '#5a5a2e', J: '#7d7a3c',
      U: '#4f4f28', u: '#3d3d1e', I: '#c8a54a',
      L: '#43431f', K: '#565632', b: '#2e2e14',
    },
  },
};

// The uniform you were given, worn by anybody who has not chosen an outfit.
// It is not in SKIN_ORDER: there is nothing to earn and nothing to wear out.
export const DEFAULT_SKIN = null;

const NO_FX = Object.freeze({
  id: null,
  speedMul: 1, reloadMul: 1, regenRateMul: 1, headMul: 1, knifeMul: 1,
  dashMul: 1, salvageMul: 1, bonusHp: 0, refillBonus: 0, startArmor: 0,
});

/** The flat stat block for an outfit id. Unknown / missing ids are neutral. */
export function skinEffects(id) {
  const skin = id ? SKINS[id] : null;
  if (!skin) return NO_FX;
  return { ...NO_FX, ...skin.fx, id };
}

/** Is this outfit's badge on the wall? `achievements` is the Achievements object. */
export function skinOwned(id, achievements) {
  const skin = SKINS[id];
  if (!skin) return false;
  return !!achievements?.has?.(skin.ach);
}

/** Everything the player owns, in catalogue order. */
export function ownedSkins(achievements) {
  return SKIN_ORDER.filter((id) => skinOwned(id, achievements));
}

/** Read the chosen outfit. Anything unknown (or a badge that is not earned) is discarded. */
export function loadSkin(achievements = null) {
  let id = null;
  try { id = localStorage.getItem(SKIN_KEY); } catch { id = null; }
  if (!id || !SKINS[id]) return DEFAULT_SKIN;
  if (achievements && !skinOwned(id, achievements)) return DEFAULT_SKIN;
  return id;
}

/** Remember the chosen outfit. `null` puts the standard kit back on. */
export function saveSkin(id) {
  const clean = id && SKINS[id] ? id : '';
  try {
    if (clean) localStorage.setItem(SKIN_KEY, clean);
    else localStorage.removeItem(SKIN_KEY);
  } catch { /* private mode: the outfit lasts the session */ }
  return clean || DEFAULT_SKIN;
}
