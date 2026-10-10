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
  { id: 'first_blood', name: 'First Blood', desc: 'Kill your first zombie.', icon: 'K' },
  { id: 'round_10', name: 'Ten Deep', desc: 'Reach round 10.', icon: '10' },
  { id: 'round_20', name: 'Twenty Deep', desc: 'Reach round 20.', icon: '20' },
  { id: 'round_30', name: 'The Long Night', desc: 'Reach round 30.', icon: '30' },
  { id: 'power_on', name: 'Let There Be Light', desc: 'Restore the power.', icon: 'P' },
  { id: 'perk_fiend', name: 'Perk Fiend', desc: 'Hold four perks at once.', icon: '4' },
  { id: 'wonder_seeker', name: 'Wonder Seeker', desc: 'Pull a wonder weapon from the box.', icon: 'W' },
  { id: 'headhunter', name: 'Headhunter', desc: '100 headshots in one run.', icon: 'H' },
  { id: 'handy', name: 'Handy Andy', desc: 'Nail back 50 planks.', icon: 'C' },
  { id: 'recluse', name: 'Locked Down', desc: 'Reach round 10 with every door still shut.', icon: 'D' },
  { id: 'monkey_business', name: 'Monkey Business', desc: 'Ten kills with a single Monkey Bomb.', icon: 'M' },
  { id: 'egg_hunter', name: 'Something on the Radio', desc: 'Complete the easter egg.', icon: 'E' },
  { id: 'walking_armoury', name: 'Walking Armoury', desc: 'Carry six weapons at once.', icon: '6' },
  { id: 'frostbite', name: 'Frostbite', desc: 'Freeze ten zombies at once.', icon: 'F' },
  { id: 'untouchable', name: 'Untouchable', desc: 'Clear a whole round without a scratch.', icon: 'U' },
  { id: 'packed', name: 'Punched', desc: 'Run a weapon through the Pack-a-Punch.', icon: 'P' },
  { id: 'trap_master', name: 'Home Alone', desc: 'Kill 15 zombies with traps in one run.', icon: 'T' },
  { id: 'daily_dogged', name: 'Daily Grind', desc: 'Finish a daily challenge run.', icon: 'D' },
  { id: 'upstairs', name: 'Upstairs', desc: 'Take the stairs to the second floor.', icon: '2' },
  { id: 'up_on_the_roof', name: 'Up On The Roof', desc: 'Climb the attic ladder and step out onto the roof.', icon: '3' },
  { id: 'cache_raider', name: 'Cache Raider', desc: 'Crack open the supply cache in the attic.', icon: 'C' },
];

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

export class Achievements {
  constructor() {
    this.unlocked = new Set(safeGet(ACH_KEY, []));
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

  reset() { this.unlocked.clear(); safeSet(ACH_KEY, []); }
}

// ---------------------------------------------------------------------------
//  Leaderboard
// ---------------------------------------------------------------------------
export const MAX_SCORES = 10;

export function loadBoard() {
  const b = safeGet(BOARD_KEY, []);
  return Array.isArray(b) ? b : [];
}

export function submitScore(entry) {
  const board = loadBoard();
  board.push({
    round: entry.round, kills: entry.kills, headshots: entry.headshots,
    points: entry.points, time: entry.time, date: Date.now(),
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
