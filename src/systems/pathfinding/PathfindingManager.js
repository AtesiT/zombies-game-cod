import { ObjectPool } from '../../utils/ObjectPool.js';
/** Budgeted, shared local A* detours over an unchanged static Dijkstra field. */
export class PathfindingManager {
  constructor(map, obstacle) {
    this.map = map;
    this.obstacle = obstacle;
    this.cache = new Map();
    this.budget = 0;
    this.expansions = 0;
    this.revision = -1;
    this.nodes = new ObjectPool(
      () => ({}),
      (n, i, g, f, parent) => Object.assign(n, { i, g, f, parent }),
      2048,
    );
  }
  /** One shared expansion budget for every zombie in a simulation tick. */
  begin() {
    this.budget = 1200;
    this.expansions = 0;
    if (this.revision !== this.obstacle.revision) {
      this.cache.clear();
      this.revision = this.obstacle.revision;
    }
  }
  /** Return a detour/hold waypoint near the obstacle, or undefined for baseline routing. */
  step(x, y) {
    const m = this.map,
      o = this.obstacle,
      start = m.tileIdxAt(x, y);
    let near = false;
    const tx = Math.floor(x / 24),
      ty = Math.floor(y / 24);
    for (let dy = -6; dy <= 6 && !near; dy++)
      for (let dx = -6; dx <= 6; dx++)
        if (o.cells.has((ty + dy) * m.w + tx + dx)) {
          near = true;
          break;
        }
    if (!near) return undefined;
    let goal = start,
      best = -1;
    // Follow the static route beyond the moving obstacle; stop at a safe perimeter if occupied target.
    for (let k = 0; k < 22; k++) {
      const next = m.next[goal];
      if (next < 0) break;
      goal = next;
      if (!o.cells.has(goal)) best = goal;
    }
    if (best < 0) return { x, y, ti: start };
    goal = best;
    const key = start + ':' + goal;
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.budget <= 0) return { x, y, ti: start };
    const pass = (i) =>
      i >= 0 && i < m.n && !o.cells.has(i) && !m.solidAt(i % m.w, Math.floor(i / m.w));
    const heuristic = (i) =>
      Math.hypot((i % m.w) - (goal % m.w), Math.floor(i / m.w) - Math.floor(goal / m.w));
    const open = [],
      all = [],
      seen = new Map();
    const add = (i, g, parent) => {
      const n = this.nodes.acquire(i, g, g + heuristic(i), parent);
      open.push(n);
      all.push(n);
      seen.set(i, g);
    };
    add(start, 0, null);
    let result = null,
      limit = 320;
    while (open.length && this.budget > 0 && limit-- > 0) {
      this.budget--;
      this.expansions++;
      let bi = 0;
      for (let j = 1; j < open.length; j++) if (open[j].f < open[bi].f) bi = j;
      const n = open.splice(bi, 1)[0];
      if (n.g !== seen.get(n.i)) continue;
      if (n.i === goal) {
        let p = n;
        while (p.parent && p.parent.parent) p = p.parent;
        result = { x: ((p.i % m.w) + 0.5) * 24, y: (Math.floor(p.i / m.w) + 0.5) * 24, ti: p.i };
        break;
      }
      const cx = n.i % m.w,
        cy = Math.floor(n.i / m.w);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx,
            ny = cy + dy,
            i = ny * m.w + nx;
          if (
            Math.abs(nx - tx) > 14 ||
            Math.abs(ny - ty) > 14 ||
            nx < 0 ||
            nx >= m.w ||
            ny < 0 ||
            ny >= m.h ||
            !pass(i)
          )
            continue;
          if (dx && dy && (!pass(cy * m.w + nx) || !pass(ny * m.w + cx))) continue;
          const g = n.g + (dx && dy ? 1.414 : 1);
          if (g < (seen.get(i) ?? Infinity)) add(i, g, n);
        }
    }
    for (const n of all) this.nodes.release(n);
    if (result) {
      if (this.cache.size > 512) this.cache.clear();
      this.cache.set(key, result);
    }
    return result ?? { x, y, ti: start };
  }
  /** Drop all retained search records and routes. */
  dispose() {
    this.cache.clear();
    this.nodes.clear();
  }
}
