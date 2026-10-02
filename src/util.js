// Small maths / helper grab-bag.

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);

/** Frame-rate independent exponential smoothing. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export function approach(cur, target, delta) {
  if (cur < target) return Math.min(cur + delta, target);
  if (cur > target) return Math.max(cur - delta, target);
  return target;
}

export const dist2 = (ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
};
export const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));

/** Shortest signed delta between two angles, in (-PI, PI]. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Deterministic PRNG (mulberry32). */
export function makeRng(seed = 1) {
  let s = seed >>> 0;
  const fn = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  fn.range = (a, b) => a + fn() * (b - a);
  fn.int = (a, b) => Math.floor(a + fn() * (b - a + 1));
  fn.pick = (arr) => arr[Math.floor(fn() * arr.length)];
  fn.chance = (p) => fn() < p;
  return fn;
}

export const rand = makeRng((Math.random() * 1e9) | 0);
export const randRange = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];

/**
 * Distance from point p to segment ab, plus the parametric position along it.
 * Returns { d2, t, cx, cy }.
 */
export function pointSegDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + dx * t, cy = ay + dy * t;
  const ox = px - cx, oy = py - cy;
  return { d2: ox * ox + oy * oy, t, cx, cy };
}

/** Binary min-heap over integer keys (used by the dijkstra flow field). */
export class MinHeap {
  constructor(cap = 1024) {
    this.k = new Int32Array(cap);
    this.v = new Int32Array(cap);
    this.n = 0;
  }
  clear() { this.n = 0; }
  _grow() {
    const k = new Int32Array(this.k.length * 2);
    const v = new Int32Array(this.v.length * 2);
    k.set(this.k); v.set(this.v);
    this.k = k; this.v = v;
  }
  push(key, val) {
    if (this.n === this.k.length) this._grow();
    let i = this.n++;
    this.k[i] = key; this.v[i] = val;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= this.k[i]) break;
      [this.k[p], this.k[i]] = [this.k[i], this.k[p]];
      [this.v[p], this.v[i]] = [this.v[i], this.v[p]];
      i = p;
    }
  }
  pop() {
    const top = this.v[0];
    this.n--;
    if (this.n > 0) {
      this.k[0] = this.k[this.n]; this.v[0] = this.v[this.n];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.n && this.k[l] < this.k[m]) m = l;
        if (r < this.n && this.k[r] < this.k[m]) m = r;
        if (m === i) break;
        [this.k[m], this.k[i]] = [this.k[i], this.k[m]];
        [this.v[m], this.v[i]] = [this.v[i], this.v[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Simple object pool for particles / tracers. */
export class Pool {
  constructor(factory, cap = 512) {
    this.factory = factory;
    this.items = [];
    this.cap = cap;
  }
  spawn() {
    let it = null;
    for (const i of this.items) if (!i.alive) { it = i; break; }
    if (!it) {
      if (this.items.length >= this.cap) return null;
      it = this.factory();
      this.items.push(it);
    }
    it.alive = true;
    return it;
  }
  get active() { return this.items.filter((i) => i.alive); }
  clear() { for (const i of this.items) i.alive = false; }
}
