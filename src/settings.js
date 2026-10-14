// Player-facing settings. Persisted in localStorage, edited from an overlay
// that opens with O (or from the pause screen), applied live.
//
// Every entry is either a `range` (arrow keys nudge it) or a `toggle`
// (enter flips it). `apply` is what actually pokes the engine when a value
// changes -- the settings object itself knows nothing about the game.

const KEY = 'ndu.settings.v1';

export const SETTING_DEFS = [
  {
    id: 'master', label: 'MASTER VOLUME', type: 'range',
    min: 0, max: 100, step: 5, def: 85,
    fmt: (v) => (v === 0 ? 'MUTED' : `${v}%`),
  },
  {
    id: 'sfx', label: 'EFFECTS VOLUME', type: 'range',
    min: 0, max: 100, step: 5, def: 100,
    fmt: (v) => (v === 0 ? 'OFF' : `${v}%`),
  },
  {
    id: 'ambient', label: 'AMBIENCE VOLUME', type: 'range',
    min: 0, max: 100, step: 5, def: 100,
    fmt: (v) => (v === 0 ? 'OFF' : `${v}%`),
  },
  {
    id: 'music', label: 'MUSIC VOLUME', type: 'range',
    min: 0, max: 100, step: 5, def: 70,
    fmt: (v) => (v === 0 ? 'OFF' : `${v}%`),
  },
  {
    id: 'shake', label: 'SCREEN SHAKE', type: 'range',
    min: 0, max: 150, step: 10, def: 100,
    fmt: (v) => (v === 0 ? 'OFF' : `${v}%`),
  },
  {
    id: 'blood', label: 'BLOOD DECALS', type: 'toggle', def: true,
    hint: 'Corpse stains stay on the floor',
  },
  {
    id: 'flash', label: 'MUZZLE FLASH', type: 'toggle', def: true,
    hint: 'Muzzle and explosion light bursts',
  },
  {
    id: 'weather', label: 'WEATHER & LEAVES', type: 'toggle', def: true,
    hint: 'Wind, drifting leaves and ground mist',
  },
  {
    id: 'crosshair', label: 'CROSSHAIR HIGHLIGHT', type: 'toggle', def: true,
    hint: 'Sight tightens and reddens over a target',
  },
  {
    id: 'fps', label: 'SHOW FPS', type: 'toggle', def: false,
    hint: 'Frame counter in the top-right',
  },
  {
    id: 'lighting', label: 'LIGHTING QUALITY', type: 'range',
    min: 0, max: 2, step: 1, def: 2,
    fmt: (v) => ['LOW', 'MEDIUM', 'HIGH'][v] ?? 'HIGH',
    hint: 'How finely shadows are cut — high is sharpest, low is fastest',
  },
  {
    id: 'dlss', label: 'DLSS5', type: 'toggle', def: false,
    hint: 'Supersamples the frame and adds a cinematic grade \u2014 smoother edges, glowing lights, film grain, deeper shadows. Needs a faster machine',
  },
  {
    id: 'autoQuality', label: 'AUTO PERFORMANCE', type: 'toggle', def: true,
    hint: 'Eases lighting and weather down by itself if the frame rate sags',
  },
  {
    id: 'simRate', label: 'SIMULATION RATE', type: 'range',
    min: 0, max: 1, step: 1, def: 0,
    fmt: (v) => (v ? 'HIGH 120' : 'NORMAL 60'),
    hint: 'Steps per second — high only matters when frames are already slow',
  },
  {
    id: 'touch', label: 'ON-SCREEN CONTROLS', type: 'range',
    min: 0, max: 2, step: 1, def: 0,
    fmt: (v) => ['AUTO', 'OFF', 'ON'][v] ?? 'AUTO',
    hint: 'Show the touch stick and buttons — AUTO puts them on any touch screen',
  },
  {
    id: 'touchAssist', label: 'AIM ASSIST', type: 'toggle', def: true,
    hint: 'With a touch stick held empty, the barrel finds the nearest walker',
  },
  {
    id: 'screen', label: 'SCREEN', type: 'range',
    min: 0, max: 1, step: 1, def: 0,
    fmt: (v) => (v === 1 ? 'FILL' : 'FIT'),
    hint: 'FILL crops the edges to use every pixel of the screen; FIT keeps the whole picture in view',
  },
  {
    id: 'touchSize', label: 'CONTROL SIZE', type: 'range',
    min: 0, max: 2, step: 1, def: 1,
    fmt: (v) => ['SMALL', 'NORMAL', 'LARGE'][v] ?? 'NORMAL',
    hint: 'How big the on-screen stick and buttons are drawn',
  },
  {
    id: 'reset', label: 'RESTORE DEFAULTS', type: 'action', def: false,
    hint: 'Put everything back the way it shipped',
  },
];

export class Settings {
  constructor() {
    this.values = {};
    for (const d of SETTING_DEFS) this.values[d.id] = d.type === 'action' ? false : d.def;
    this.listeners = [];
    this.load();
  }

  def(id) { return SETTING_DEFS.find((d) => d.id === id); }
  get(id) { return this.values[id]; }

  /** Fires every listener so the engine picks the change up immediately. */
  set(id, v) {
    const d = this.def(id);
    if (!d) return;
    if (d.type === 'action') return;
    if (d.type === 'range') v = Math.max(d.min, Math.min(d.max, v));
    else v = !!v;
    if (this.values[id] === v) return;
    this.values[id] = v;
    for (const fn of this.listeners) fn(id, v, this);
    this.save();
  }

  /** Ranges wrap around; toggles just flip. */
  nudge(id, dir) {
    const d = this.def(id);
    if (!d) return;
    if (d.type === 'range') {
      let v = this.values[id] + dir * d.step;
      if (v < d.min) v = d.max;
      if (v > d.max) v = d.min;
      this.set(id, v);
    } else {
      this.set(id, !this.values[id]);
    }
  }

  activate(id) {
    const d = this.def(id);
    if (!d) return;
    if (d.type === 'toggle') this.set(id, !this.values[id]);
    else if (d.type === 'range') this.nudge(id, 1);
  }

  onChange(fn) { this.listeners.push(fn); }

  reset() {
    for (const d of SETTING_DEFS) {
      if (d.type === 'action') continue;
      this.values[d.id] = d.def;
      for (const fn of this.listeners) fn(d.id, d.def, this);
    }
    this.save();
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const got = JSON.parse(raw);
      for (const d of SETTING_DEFS) {
        if (d.type === 'action' || !(d.id in got)) continue;
        const v = got[d.id];
        this.values[d.id] = d.type === 'range'
          ? Math.max(d.min, Math.min(d.max, Number(v) || 0))
          : !!v;
      }
    } catch { /* corrupt or unavailable storage: keep the defaults */ }
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.values)); } catch { /* private mode */ }
  }
}

export const settings = new Settings();
