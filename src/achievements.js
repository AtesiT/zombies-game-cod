// Achievements, the radio easter egg and the local high-score table.
// Everything lives in localStorage, so it survives a reload.

const ACH_KEY = 'ndu.achievements.v1';
const BOARD_KEY = 'ndu.leaderboard.v1';

function safeGet(k, fallback) {
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch { return fallback; }
}

function safeSet(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ }
}

export const ACHIEVEMENTS = [
  { id: 'first_blood', name: 'First Blood', desc: 'Kill your first zombie.', icon: 'blood' },
  { id: 'round_10', name: 'Ten Deep', desc: 'Reach round 10.', icon: 'round_10' },
  { id: 'round_20', name: 'Twenty Deep', desc: 'Reach round 20.', icon: 'round_20' },
  { id: 'round_30', name: 'The Long Night', desc: 'Reach round 30.', icon: 'round_30' },
  { id: 'power_on', name: 'Let There Be Light', desc: 'Restore the power.', icon: 'power' },
  { id: 'perk_fiend', name: 'Perk Fiend', desc: 'Hold four perks at once.', icon: 'perks' },
  { id: 'wonder_seeker', name: 'Wonder Seeker', desc: 'Pull a wonder weapon from the box.', icon: 'wonder' },
  { id: 'headhunter', name: 'Headhunter', desc: '100 headshots in one run.', icon: 'headshot' },
  { id: 'handy', name: 'Handy Andy', desc: 'Nail back 50 planks.', icon: 'hammer' },
  { id: 'recluse', name: 'Locked Down', desc: 'Reach round 10 with every door still shut.', icon: 'door' },
  { id: 'monkey_business', name: 'Monkey Business', desc: 'Ten kills with a single Monkey Bomb.', icon: 'monkey' },
  { id: 'egg_hunter', name: 'Something on the Radio', desc: 'Complete the easter egg.', icon: 'radio' },
  { id: 'walking_armoury', name: 'Arms Runner', desc: 'Take 8 weapons from the mystery box in one game.', icon: 'armoury' },
  { id: 'frostbite', name: 'Frostbite', desc: 'Freeze ten zombies at once.', icon: 'frost' },
  { id: 'untouchable', name: 'Untouchable', desc: 'Clear a whole round without a scratch.', icon: 'shield' },
  { id: 'packed', name: 'Punched', desc: 'Run a weapon through the Pack-a-Punch.', icon: 'packed' },
  { id: 'trap_master', name: 'Home Alone', desc: 'Kill 15 zombies with traps in one run.', icon: 'trap' },
  { id: 'upstairs', name: 'Upstairs', desc: 'Take the stairs to the second floor.', icon: 'stairs' },
  { id: 'up_on_the_roof', name: 'Up On The Roof', desc: 'Climb the attic ladder and step out onto the roof.', icon: 'roof' },
  { id: 'cache_raider', name: 'Cache Raider', desc: 'Crack open the supply cache in the attic.', icon: 'cache' },
  // ---- creature shortlist --------------------------------------------------
  { id: 'bone_collector', name: 'Bone Collector', desc: 'Put the Bonewright down before its skeletons walk.', icon: 'bone' },
  { id: 'swarm_season', name: 'Swarm Season', desc: 'Burst a Swarmling before it sheds.', icon: 'swarm' },
  { id: 'off_the_air', name: 'Off The Air', desc: 'Silence a Jammer.', icon: 'jammer' },
  { id: 'skeleton_key', name: 'Skeleton Key', desc: 'Break ten of the Bonewright\u2019s skeletons.', icon: 'skull' },
  // ---- the rest of the house ----------------------------------------------
  { id: 'tourist', name: 'Grand Tour', desc: 'Set foot on all three storeys in one run.', icon: 'map' },
  // Back with the bench: it went bare for a while and took these two with it.
  { id: 'master_crafter', name: 'Master Crafter', desc: 'Craft five things at the workbench.', icon: 'craft' },
  { id: 'field_medic', name: 'Field Medic', desc: 'Craft a medkit.', icon: 'medic' },
  { id: 'big_spender', name: 'Big Spender', desc: 'Hold 10,000 points at once.', icon: 'coins' },
  { id: 'marksman', name: 'Marksman', desc: 'Land half your shots over a hundred fired.', icon: 'target' },
  { id: 'knife_work', name: 'Knife Work', desc: 'Take down twenty-five with the knife.', icon: 'knife' },
  { id: 'frag_out', name: 'Frag Out', desc: 'Take five with one grenade.', icon: 'grenade' },
  { id: 'round_40', name: 'Forty Deep', desc: 'Reach round 40.', icon: 'round_40' },
  { id: 'lucky_pull', name: 'Lucky Pull', desc: 'Get a wonder weapon without ever drawing the teddy.', icon: 'luck' },
  { id: 'lights_out', name: 'Lights Out', desc: 'Fight a whole round in the dark before the power.', icon: 'dark' },
  // ---- the ending, and the night's small kindnesses -------------------------
  { id: 'leaving_tonight', name: 'Leaving Tonight', desc: 'Light all four beacons, reach round 25, burn the green flare and board the bird.', icon: 'heli' },
  { id: 'care_package', name: 'Care Package', desc: 'Pick up a crate the radio dropped for you.', icon: 'supply' },
];

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

export class Achievements {
  constructor() {
    // Anything on disk that is no longer on the list gets dropped here: a
    // badge that was retired mid-life would otherwise sit in the set forever
    // and make the screen read "34 / 33".
    const saved = safeGet(ACH_KEY, []);
    this.unlocked = new Set(Array.isArray(saved) ? saved.filter((id) => BY_ID.has(id)) : []);
    this.pending = [];      // queued toasts
    this.banner = null;
    this.bannerT = 0;
  }

  has(id) { return this.unlocked.has(id); }

  /** Unlock (no-op if already owned). Returns the def when it is new. */
  unlock(id) {
    if (this.unlocked.has(id) || !BY_ID.has(id)) return null;
    this.unlocked.add(id);
    safeSet(ACH_KEY, [...this.unlocked]);
    const def = BY_ID.get(id);
    this.pending.push(def);
    return def;
  }

  get count() { return this.unlocked.size; }
  get total() { return ACHIEVEMENTS.length; }

  update(dt) {
    if (this.banner) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.banner = null;
      return;
    }
    if (this.pending.length) {
      this.banner = this.pending.shift();
      this.bannerT = 3.4;
    }
  }

  reset() {
    this.unlocked.clear();
    // a toast already queued for a badge that no longer exists would still
    // flash on screen after the wipe
    this.pending.length = 0;
    this.banner = null;
    this.bannerT = 0;
    safeSet(ACH_KEY, []);
  }
}

// ---------------------------------------------------------------------------
//  Leaderboard
// ---------------------------------------------------------------------------
export const MAX_SCORES = 10;

export function loadBoard() {
  const b = safeGet(BOARD_KEY, []);
  if (!Array.isArray(b)) return [];
  const fields = ['round', 'kills', 'headshots', 'points', 'time', 'date'];
  return b.filter((e) => e && typeof e === 'object'
    && fields.every((k) => Number.isFinite(e[k]) && e[k] >= 0))
    .map((e) => ({ ...Object.fromEntries(fields.map((k) => [k, e[k]])), evac: !!e.evac }))
    .sort((a, b) => b.round - a.round || b.points - a.points || b.kills - a.kills)
    .slice(0, MAX_SCORES);
}

export function submitScore(entry) {
  const board = loadBoard();
  board.push({
    round: entry.round, kills: entry.kills, headshots: entry.headshots,
    points: entry.points, time: entry.time, date: entry.date ?? Date.now(),
    evac: !!entry.evac,          // left the night alive, aboard the bird
  });
  board.sort((a, b) => b.round - a.round || b.points - a.points || b.kills - a.kills);
  const trimmed = board.slice(0, MAX_SCORES);
  safeSet(BOARD_KEY, trimmed);
  return trimmed;
}

export function bestRound() {
  const b = loadBoard();
  return b.length ? b[0].round : 0;
}

export function clearBoard() { safeSet(BOARD_KEY, []); }

// ---------------------------------------------------------------------------
//  Radio easter egg
// ---------------------------------------------------------------------------
export class EasterEgg {
  constructor(switches) {
    this.switches = switches;        // [{x, y, found}]
    this.found = 0;
    this.state = 'idle';             // idle | playing | done
    this.timer = 0;
    this.roundOfStart = -1;
  }

  activate(sw) {
    if (sw.found) return false;
    sw.found = true;
    this.found++;
    return true;
  }

  get complete() { return this.found >= this.switches.length; }

  /** Call when all switches have been thrown. Starts the broadcast. */
  start() {
    if (this.state !== 'idle') return false;
    this.state = 'playing';
    this.timer = 4.5;
    return true;
  }

  update(dt, game) {
    if (this.state !== 'playing') return;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.state = 'done';
      game.onEasterEggComplete();
    }
  }
}
