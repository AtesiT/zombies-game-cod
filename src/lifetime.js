// All-time statistics for this machine.
//
// Every finished run -- a death, an evacuation, or quitting to the front page
// mid-night -- is banked here once, and the totals survive reloads in
// localStorage. The menu has a STATISTICS screen built on this, and the front
// page carries the one-line summary: runs, best round, kills.
//
// The numbers are deliberately the *run* totals already collected by
// roundReport.js (`runMetrics`), so there is exactly one definition of a kill
// in the game. Nothing here is authoritative for gameplay: it is a diary.

export const LIFETIME_KEY = 'ndu.lifetime.v1';
const KEY = LIFETIME_KEY;

/** Every counter this screen knows about, and what it starts at. */
export const LIFETIME_KEYS = Object.freeze([
  'runs', 'evacs', 'deaths', 'clearedRounds',
  'bestRound', 'bestKills', 'bestPoints', 'bestTime',
  'kills', 'headshots', 'specialKills', 'knifeKills', 'trapKills',
  'points', 'salvage', 'damage', 'planks', 'doors', 'crafted',
  'throws', 'medkits', 'revives', 'downs', 'seconds',
]);

export const EMPTY_LIFETIME = Object.freeze(Object.fromEntries(LIFETIME_KEYS.map((k) => [k, 0])));

const clean = (v) => (Number.isFinite(+v) && +v > 0 ? +v : 0);

/** Read the diary, ignoring anything a browser or an older version left behind. */
export function loadLifetime() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch { raw = null; }
  if (!raw) return { ...EMPTY_LIFETIME };
  let saved = null;
  try { saved = JSON.parse(raw); } catch { saved = null; }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { ...EMPTY_LIFETIME };
  const out = { ...EMPTY_LIFETIME };
  for (const k of LIFETIME_KEYS) out[k] = Math.round(clean(saved[k]));
  // a best is a maximum, never a sum: an old file cannot claim a best round
  // higher than a run it also recorded
  out.bestRound = Math.max(out.bestRound, 0);
  return out;
}

export function saveLifetime(life) {
  try { localStorage.setItem(KEY, JSON.stringify(life)); } catch { /* private mode */ }
  return life;
}

export function resetLifetime() {
  const life = { ...EMPTY_LIFETIME };
  saveLifetime(life);
  return life;
}

/**
 * Add one finished run. Returns the new diary (and writes it).
 *
 * `run.metrics` is `game.runMetrics`; `run.round` is the wave reached;
 * `cleared` is how many waves were actually completed -- a death on round 9
 * cleared eight, an evacuation on 25 cleared all twenty-five.
 */
export function bankRun(life, run = {}) {
  const prev = { ...EMPTY_LIFETIME, ...(life ?? {}) };
  const m = run.metrics ?? {};
  const round = Math.max(0, Math.round(clean(run.round)));
  const evac = !!run.evac;
  const cleared = evac ? round : Math.max(0, round - 1);
  const add = (k, v) => Math.round(prev[k] + clean(v));
  const next = {
    ...prev,
    runs: add('runs', 1),
    evacs: add('evacs', evac ? 1 : 0),
    deaths: add('deaths', evac ? 0 : 1),
    clearedRounds: add('clearedRounds', cleared),
    kills: add('kills', m.kills),
    headshots: add('headshots', m.headshots),
    specialKills: add('specialKills', m.specialKills),
    knifeKills: add('knifeKills', m.knifeKills),
    trapKills: add('trapKills', m.trapKills),
    points: add('points', m.points),
    salvage: add('salvage', m.salvage),
    damage: add('damage', m.damage),
    planks: add('planks', m.planks),
    doors: add('doors', m.doors),
    crafted: add('crafted', m.crafted),
    throws: add('throws', m.throws),
    medkits: add('medkits', m.medkits),
    revives: add('revives', m.revives),
    downs: add('downs', m.downs),
    seconds: add('seconds', m.seconds),
    bestRound: Math.max(prev.bestRound, round),
    bestKills: Math.max(prev.bestKills, Math.round(clean(m.kills))),
    bestPoints: Math.max(prev.bestPoints, Math.round(clean(m.points))),
    bestTime: Math.max(prev.bestTime, Math.round(clean(m.seconds))),
  };
  return saveLifetime(next);
}

/** The one-liner on the front page: "14 RUNS · BEST ROUND 23 · 4 802 KILLS". */
export function lifetimeSummary(life) {
  const l = { ...EMPTY_LIFETIME, ...(life ?? {}) };
  if (!l.runs) return 'NO RUNS YET — THE NIGHT IS WAITING';
  const n = (v) => Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${n(l.runs)} ${l.runs === 1 ? 'RUN' : 'RUNS'}  ·  BEST ROUND ${n(l.bestRound)}`
    + `  ·  ${n(l.kills)} ${l.kills === 1 ? 'KILL' : 'KILLS'}`;
}

/**
 * The two lines under the menu title. The first is the number a player brags
 * about; the second is the one that makes the first one mean something.
 */
export function lifetimeMenuLines(life) {
  const l = { ...EMPTY_LIFETIME, ...(life ?? {}) };
  if (!l.runs) return ['NO NIGHTS YET \u2014 THE DARK IS WAITING', null];
  const n = (v) => Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return [
    lifetimeSummary(l),
    `${n(l.evacs)} ${l.evacs === 1 ? 'EVACUATION' : 'EVACUATIONS'}  \u00b7  `
      + `${n(l.clearedRounds)} ROUNDS CLEARED  \u00b7  ${clock(l.seconds)} PLAYED`,
  ];
}

function clock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

/** Rows for the all-time screen: [label, value, group]. */
export function lifetimeRows(life) {
  const l = { ...EMPTY_LIFETIME, ...(life ?? {}) };
  const n = (v) => Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const pct = l.runs ? Math.round(100 * l.evacs / l.runs) : 0;
  return [
    ['RUNS FINISHED', n(l.runs), 0],
    ['EVACUATIONS', `${n(l.evacs)} (${pct}%)`, 0],
    ['DEATHS', n(l.deaths), 0],
    ['ROUNDS CLEARED', n(l.clearedRounds), 0],
    ['BEST ROUND', n(l.bestRound), 0],
    ['BEST RUN KILLS', n(l.bestKills), 0],
    ['BEST RUN POINTS', n(l.bestPoints), 0],
    ['LONGEST RUN', clock(l.bestTime), 0],
    ['TOTAL KILLS', n(l.kills), 1],
    ['HEADSHOT KILLS', n(l.headshots), 1],
    ['SPECIAL KILLS', n(l.specialKills), 1],
    ['KNIFE KILLS', n(l.knifeKills), 1],
    ['TRAP KILLS', n(l.trapKills), 1],
    ['POINTS EARNED', n(l.points), 1],
    ['SCRAP COLLECTED', n(l.salvage), 1],
    ['HEALTH LOST', n(l.damage), 1],
    ['PLANKS REBUILT', n(l.planks), 1],
    ['DOORS OPENED', n(l.doors), 1],
    ['ITEMS CRAFTED', n(l.crafted), 1],
    ['THROWABLES USED', n(l.throws), 1],
    ['MEDKITS USED', n(l.medkits), 1],
    ['TEAMMATES REVIVED', n(l.revives), 1],
    ['TIMES DOWNED', n(l.downs), 1],
    ['TIME PLAYED', clock(l.seconds), 1],
  ];
}
