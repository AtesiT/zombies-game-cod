// Level logic: tile grid, collision, stairwell portals, dijkstra flow field.
import { T, TILE, paintLevel } from './art.js';
import {
  MAP_W, MAP_H, MAP_ROWS, PLAYER_START, SPAWN_POINTS, WALL_BUYS, GRENADE_CRATES,
  PERK_SPOTS, BOX_SPOTS, STAIRS, POWER_SWITCH, WORKBENCH, SECRET_SWITCHES,
  SECRET_DOOR, SECRET_LOOT, DOOR_PRICES,
} from './mapData.js';
import { MinHeap } from './util.js';

const INF = 0x3fffffff;

// dijkstra tile costs (scaled x100 so they stay integers)
const COST_FLOOR = 100;
const COST_DIAG = 141;
const COST_WINDOW = 4000;   // zombies would rather walk round than chew boards
const COST_STAIR = 300;     // stairwells are a shortcut, not an obstacle

const MAX_PLANKS = 6;

const N8 = [
  [1, 0, COST_FLOOR], [-1, 0, COST_FLOOR], [0, 1, COST_FLOOR], [0, -1, COST_FLOOR],
  [1, 1, COST_DIAG], [1, -1, COST_DIAG], [-1, 1, COST_DIAG], [-1, -1, COST_DIAG],
];

const CHAR_TO_TILE = {
  ' ': TILE.EXTERIOR, '.': TILE.FLOOR, '#': TILE.WALL, W: TILE.WINDOW,
  D: TILE.DOOR, c: TILE.CRATE, r: TILE.RUBBLE, T: TILE.TREE,
  F: TILE.FENCE, V: TILE.VEHICLE, S: TILE.STAIR, '*': TILE.SECRET_DOOR,
  '@': TILE.FLOOR,
};

export class GameMap {
  constructor() {
    this.w = MAP_W;
    this.h = MAP_H;
    const n = MAP_W * MAP_H;
    this.tiles = new Uint8Array(n);
    this.barricadeOf = new Int16Array(n).fill(-1);
    this.doorOf = new Int16Array(n).fill(-1);
    this.stairOf = new Int16Array(n).fill(-1);
    this.seen = new Uint8Array(n);
    this.barricades = [];
    this.doors = [];
    this.stairs = [];
    this.wallBuys = [];
    this.grenadeCrates = [];
    this.perkSpots = [];
    this.boxSpots = [];
    this.secretSwitches = [];
    this.secretLoot = [];
    this.playerStart = { x: (PLAYER_START.x + 0.5) * T, y: (PLAYER_START.y + 0.5) * T };

    this._parse();
    this.staticCanvas = paintLevel(this.tiles, MAP_W, MAP_H, 20240917);
    this.dist = new Int32Array(n);
    this.next = new Int32Array(n);
    this._heap = new MinHeap(n);
  }

  idx(tx, ty) { return ty * this.w + tx; }
  inside(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h; }
  tileAt(tx, ty) { return this.inside(tx, ty) ? this.tiles[ty * this.w + tx] : TILE.WALL; }
  tileIdxAt(x, y) {
    const tx = Math.floor(x / T), ty = Math.floor(y / T);
    return this.inside(tx, ty) ? this.idx(tx, ty) : -1;
  }

  _parse() {
    for (let y = 0; y < MAP_H; y++) {
      const row = MAP_ROWS[y];
      for (let x = 0; x < MAP_W; x++) {
        this.tiles[y * MAP_W + x] = CHAR_TO_TILE[row[x]] ?? TILE.EXTERIOR;
      }
    }

    // --- group contiguous window tiles into barricade objects --------------
    const seen = new Uint8Array(MAP_W * MAP_H);
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const i = this.idx(x, y);
        if (this.tiles[i] !== TILE.WINDOW || seen[i]) continue;
        const group = [];
        const stack = [[x, y]];
        seen[i] = 1;
        while (stack.length) {
          const [cx, cy] = stack.pop();
          group.push(this.idx(cx, cy));
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx, ny = cy + dy;
            if (!this.inside(nx, ny)) continue;
            const ni = this.idx(nx, ny);
            if (this.tiles[ni] === TILE.WINDOW && !seen[ni]) { seen[ni] = 1; stack.push([nx, ny]); }
          }
        }
        const xs = group.map((g) => g % MAP_W);
        const ys = group.map((g) => (g / MAP_W) | 0);
        const b = {
          id: this.barricades.length,
          tiles: group,
          horizontal: new Set(ys).size === 1,
          planks: MAX_PLANKS,
          maxPlanks: MAX_PLANKS,
          hurt: 0,
          cx: (Math.min(...xs) + Math.max(...xs) + 1) * T / 2,
          cy: (Math.min(...ys) + Math.max(...ys) + 1) * T / 2,
        };
        this.barricades.push(b);
        for (const g of group) this.barricadeOf[g] = b.id;
      }
    }

    // --- doors -------------------------------------------------------------
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const i = this.idx(x, y);
        if (this.tiles[i] !== TILE.DOOR) continue;
        const d = {
          id: this.doors.length, tx: x, ty: y, i,
          horizontal: this.tileAt(x - 1, y) === TILE.WALL && this.tileAt(x + 1, y) === TILE.WALL,
          open: false,
          price: DOOR_PRICES[`${x},${y}`] ?? 750,
          hurt: 0,
          cx: (x + 0.5) * T, cy: (y + 0.5) * T,
        };
        this.doors.push(d);
        this.doorOf[i] = d.id;
      }
    }

    // --- stairwells (teleport pairs) --------------------------------------
    for (const s of STAIRS) {
      const ai = this.idx(s.ax, s.ay), bi = this.idx(s.bx, s.by);
      const st = { id: this.stairs.length, a: ai, b: bi, dir: s.dir };
      this.stairs.push(st);
      this.stairOf[ai] = st.id;
      this.stairOf[bi] = st.id;
    }
    this.secretDoorIdx = this.idx(SECRET_DOOR.x, SECRET_DOOR.y);
    this.secretDoorOpen = false;

    this.spawnPoints = SPAWN_POINTS.map((s) => ({ x: (s.x + 0.5) * T, y: (s.y + 0.5) * T, tx: s.x, ty: s.y }));
    this.wallBuys = WALL_BUYS.map((b) => ({
      x: (b.x + 0.5) * T, y: (b.y + 0.5) * T,
      wx: b.wx, wy: b.wy, weapon: b.weapon,
      wallCX: (b.wx + 0.5) * T, wallCY: (b.wy + 0.5) * T,
      facing: b.wy < b.y ? 'up' : 'down',
    }));
    this.grenadeCrates = GRENADE_CRATES.map((g) => ({ x: (g.x + 0.5) * T, y: (g.y + 0.5) * T }));
    this.perkSpots = PERK_SPOTS.map((p) => ({
      id: p.id, x: (p.x + 0.5) * T, y: (p.y + 0.5) * T, tx: p.x, ty: p.y,
    }));
    this.boxSpots = BOX_SPOTS.map((b) => ({ x: (b.x + 0.5) * T, y: (b.y + 0.5) * T, tx: b.x, ty: b.y }));
    this.powerSwitch = { x: (POWER_SWITCH.x + 0.5) * T, y: (POWER_SWITCH.y + 0.5) * T };
    this.workbench = { x: (WORKBENCH.x + 0.5) * T, y: (WORKBENCH.y + 0.5) * T };
    this.secretSwitches = SECRET_SWITCHES.map((s, i) => ({
      id: i, x: (s.x + 0.5) * T, y: (s.y + 0.5) * T, found: false,
    }));
    this.secretLoot = SECRET_LOOT.map((s) => ({ x: (s.x + 0.5) * T, y: (s.y + 0.5) * T }));
  }

  // ------------------------------------------------------------ collision --
  /** Blocks movement? */
  solidAt(tx, ty) {
    if (!this.inside(tx, ty)) return true;
    const i = ty * this.w + tx;
    switch (this.tiles[i]) {
      case TILE.WALL: case TILE.CRATE: case TILE.TREE:
      case TILE.FENCE: case TILE.VEHICLE: return true;
      case TILE.SECRET_DOOR: return !this.secretDoorOpen;
      case TILE.WINDOW: {
        const b = this.barricades[this.barricadeOf[i]];
        return b ? b.planks > 0 : false;
      }
      case TILE.DOOR: {
        const d = this.doors[this.doorOf[i]];
        return d ? !d.open : false;
      }
      default: return false;
    }
  }

  /** Blocks bullets? (low fences do not) */
  blocksBullets(tx, ty) {
    if (!this.inside(tx, ty)) return true;
    const i = ty * this.w + tx;
    if (this.tiles[i] === TILE.FENCE) return false;
    return this.solidAt(tx, ty);
  }

  /** Move a circle by (dx,dy), sliding along walls. Mutates pos {x,y}. */
  moveCircle(pos, dx, dy, r) {
    pos.x += dx;
    this._resolveAxis(pos, r, true);
    pos.y += dy;
    this._resolveAxis(pos, r, false);
  }

  _resolveAxis(pos, r, horizontal) {
    const t0x = Math.floor((pos.x - r) / T), t1x = Math.floor((pos.x + r) / T);
    const t0y = Math.floor((pos.y - r) / T), t1y = Math.floor((pos.y + r) / T);
    for (let ty = t0y; ty <= t1y; ty++) {
      for (let tx = t0x; tx <= t1x; tx++) {
        if (!this.solidAt(tx, ty)) continue;
        const left = tx * T, top = ty * T, right = left + T, bottom = top + T;
        const cx = pos.x < left ? left : pos.x > right ? right : pos.x;
        const cy = pos.y < top ? top : pos.y > bottom ? bottom : pos.y;
        const ox = pos.x - cx, oy = pos.y - cy;
        const d2 = ox * ox + oy * oy;
        if (d2 >= r * r) continue;
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = r - d;
          pos.x += (ox / d) * push;
          pos.y += (oy / d) * push;
        } else if (horizontal) pos.x = pos.x < left + T / 2 ? left - r : right + r;
        else pos.y = pos.y < top + T / 2 ? top - r : bottom + r;
      }
    }
  }

  lineBlocked(x0, y0, x1, y1) { return !!this.rayWall(x0, y0, x1, y1); }

  /** DDA raycast against bullet-blocking tiles. */
  rayWall(x0, y0, x1, y1, maxLen = Infinity) {
    let dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return null;
    const lim = Math.min(len, maxLen);
    dx /= len; dy /= len;

    let tx = Math.floor(x0 / T), ty = Math.floor(y0 / T);
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
    const tDeltaX = Math.abs(dx) < 1e-9 ? Infinity : Math.abs(T / dx);
    const tDeltaY = Math.abs(dy) < 1e-9 ? Infinity : Math.abs(T / dy);
    let tMaxX = Math.abs(dx) < 1e-9 ? Infinity : ((dx > 0 ? (tx + 1) * T - x0 : x0 - tx * T) / Math.abs(dx));
    let tMaxY = Math.abs(dy) < 1e-9 ? Infinity : ((dy > 0 ? (ty + 1) * T - y0 : y0 - ty * T) / Math.abs(dy));

    let t = 0, nx = 0, ny = 0, guard = 0;
    if (this.blocksBullets(tx, ty)) return { t: 0, x: x0, y: y0, nx: -dx, ny: -dy };
    while (t <= lim && guard++ < 4096) {
      if (tMaxX < tMaxY) { tx += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; }
      else { ty += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; }
      if (t > lim) break;
      if (this.blocksBullets(tx, ty)) return { t, x: x0 + dx * t, y: y0 + dy * t, nx, ny };
    }
    return null;
  }

  // ---------------------------------------------------------- stairwells --
  /** Partner tile index for a stairwell tile, or -1. */
  stairPartner(tileIdx) {
    if (tileIdx < 0) return -1;
    const s = this.stairs[this.stairOf[tileIdx]];
    if (!s) return -1;
    return s.a === tileIdx ? s.b : s.a;
  }

  stairCentre(tileIdx) {
    return { x: ((tileIdx % this.w) + 0.5) * T, y: (((tileIdx / this.w) | 0) + 0.5) * T };
  }

  // ----------------------------------------------------------- flow field --
  buildFlow(targetX, targetY) {
    const { w, h, tiles, dist, next } = this;
    dist.fill(INF);
    next.fill(-1);
    const heap = this._heap;
    heap.clear();

    let stx = Math.floor(targetX / T), sty = Math.floor(targetY / T);
    stx = Math.max(0, Math.min(w - 1, stx));
    sty = Math.max(0, Math.min(h - 1, sty));
    if (this.solidAt(stx, sty)) {
      outer: for (let r = 1; r <= 3; r++) {
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (this.inside(stx + dx, sty + dy) && !this.solidAt(stx + dx, sty + dy)) {
            stx += dx; sty += dy; break outer;
          }
        }
      }
    }
    const start = this.idx(stx, sty);
    dist[start] = 0;
    heap.push(0, start);

    while (heap.n > 0) {
      const cur = heap.pop();
      const cd = dist[cur];
      const cx = cur % w, cy = (cur / w) | 0;

      for (let k = 0; k < 8; k++) {
        const [dx, dy, base] = N8[k];
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (dist[ni] <= cd) continue;
        const t = tiles[ni];
        if (t === TILE.WALL || t === TILE.CRATE || t === TILE.TREE || t === TILE.VEHICLE) continue;
        if (t === TILE.FENCE || t === TILE.SECRET_DOOR) continue;
        if (dx && dy && (this.solidAt(cx + dx, cy) || this.solidAt(cx, cy + dy))) continue;
        let extra = 0;
        if (t === TILE.WINDOW) extra = COST_WINDOW;
        else if (t === TILE.DOOR) {
          // A shut door is simply not a way through. That is the whole point of
          // buying them: the horde has to break a window and run the long way
          // round, while you get a shortcut. (Zombies therefore never queue at
          // a locked door -- they can't path through one at all.)
          const d = this.doors[this.doorOf[ni]];
          if (!d || !d.open) continue;
        }
        const nd = cd + base + extra;
        if (nd < dist[ni]) { dist[ni] = nd; next[ni] = cur; heap.push(nd, ni); }
      }

      // stairwell shortcut -- `next` will point at a non-adjacent tile, which
      // flowStep() reports as a portal hop
      const partner = this.stairPartner(cur);
      if (partner >= 0) {
        const nd = cd + COST_STAIR;
        if (nd < dist[partner]) { dist[partner] = nd; next[partner] = cur; heap.push(nd, partner); }
      }
    }
  }

  /**
   * Next tile centre to walk toward from a world position.
   * Returns { x, y, ti, portal } -- `portal` is set when the step is a
   * stairwell hop: walk to (x,y) first, then teleport to `portal`.
   */
  flowStep(x, y) {
    const tx = Math.floor(x / T), ty = Math.floor(y / T);
    if (!this.inside(tx, ty)) return null;
    const i = this.idx(tx, ty);
    if (this.dist[i] === INF) return null;
    const n = this.next[i];
    if (n < 0) return null;
    const nx = n % this.w, ny = (n / this.w) | 0;
    if (Math.abs(nx - tx) > 1 || Math.abs(ny - ty) > 1) {
      // non-adjacent => stairwell portal; step onto this tile's centre first
      return { x: (tx + 0.5) * T, y: (ty + 0.5) * T, ti: i, portal: n };
    }
    return { x: (nx + 0.5) * T, y: (ny + 0.5) * T, ti: n, portal: -1 };
  }

  reachable(x, y) {
    const tx = Math.floor(x / T), ty = Math.floor(y / T);
    if (!this.inside(tx, ty)) return false;
    return this.dist[this.idx(tx, ty)] < INF;
  }

  nearestBarricade(x, y, maxDist = 90, requirePlanks = true) {
    let best = null, bd = maxDist * maxDist;
    for (const b of this.barricades) {
      if (requirePlanks && b.planks <= 0) continue;
      const d = (b.cx - x) ** 2 + (b.cy - y) ** 2;
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
}

export { MAX_PLANKS };
