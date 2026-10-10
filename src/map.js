// Level logic: tile grid, collision, stairwell portals, dijkstra flow field.
import { T, TILE, paintLevel } from './art.js';
import {
  MAP_W, MAP_H, FLOORS, LEVEL_LINKS, PLAYER_START, SPAWN_POINTS, WALL_BUYS, GRENADE_CRATES,
  PERK_SPOTS, BOX_SPOTS, STAIRS, POWER_SWITCH, WORKBENCH, WORKBENCH_ROOF, SECRET_SWITCHES,
  SECRET_DOOR, SECRET_LOOT, DOOR_PRICES, PAP_SPOT,
} from './mapData.js';
import { MinHeap } from './util.js';

const INF = 0x3fffffff;

// dijkstra tile costs (scaled x100 so they stay integers)
const COST_FLOOR = 100;
const COST_DIAG = 141;
const COST_WINDOW = 4000;   // zombies would rather walk round than chew boards
const COST_PROP = 3000;     // ...and rather walk round a crate than lean on one
const COST_STAIR = 300;     // stairwells are a shortcut, not an obstacle

const MAX_PLANKS = 6;

// Tiles the flow field refuses to route through. Kept in one place, next to
// solidTileOn, because the hand-written list that used to live inside
// buildFlow went stale the moment furniture went in upstairs -- and then the
// horde cheerfully tried to walk through bunks and jammed itself on them.
const FLOOR_ROOF = 2;      // the top storey: attic and roof, where the bench is

const BLOCKS_FLOW = new Set([
  TILE.WALL, TILE.CRATE, TILE.TREE, TILE.VEHICLE, TILE.VOID, TILE.FENCE,
  TILE.BUNK, TILE.LOCKER, TILE.TABLE, TILE.SECRET_DOOR,
]);

const N8 = [
  [1, 0, COST_FLOOR], [-1, 0, COST_FLOOR], [0, 1, COST_FLOOR], [0, -1, COST_FLOOR],
  [1, 1, COST_DIAG], [1, -1, COST_DIAG], [-1, 1, COST_DIAG], [-1, -1, COST_DIAG],
];

// Tiles that are simply there, whatever the barricades and doors are doing:
// the parse-time solidity of the raw map, used to decide whether an opening
// really is one. Windows and doors are deliberately not in here -- they are
// openings, even while they are boarded up.
const TILE_SOLID = new Set([
  TILE.WALL, TILE.CRATE, TILE.TREE, TILE.FENCE, TILE.VEHICLE,
  TILE.VOID, TILE.BUNK, TILE.LOCKER, TILE.TABLE,
]);

const CHAR_TO_TILE = {
  ' ': TILE.EXTERIOR, '.': TILE.FLOOR, '#': TILE.WALL, W: TILE.WINDOW,
  D: TILE.DOOR, c: TILE.CRATE, r: TILE.RUBBLE, T: TILE.TREE,
  F: TILE.FENCE, V: TILE.VEHICLE, S: TILE.STAIR, '*': TILE.SECRET_DOOR,
  '@': TILE.FLOOR,
  R: TILE.ROOF, '~': TILE.VOID,
  b: TILE.BUNK, k: TILE.LOCKER, t: TILE.TABLE,
};

/**
 * Which way the gun's wall runs, seen from the tile you stand on to buy it --
 * the same convention the old two-way version used, where 'up' meant the wall
 * was above you. A weapon bought off a side wall was drawn lying flat across
 * it, which looks like it is floating: it has to hang along the wall instead.
 */
function wallFacing(b) {
  const dx = (b.wx ?? 0) - (b.x ?? 0), dy = (b.wy ?? 0) - (b.y ?? 0);
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

export class GameMap {
  constructor() {
    this.w = MAP_W;
    this.h = MAP_H;
    this.n = MAP_W * MAP_H;

    // Whether the bricked-up cache has been opened. Whole-map state: it is
    // checked from solidTileOn, which is asked about storeys the player is
    // not standing on, so it cannot live on a storey.
    this.secretDoorOpen = false;

    // --- vertical links ----------------------------------------------------
    // `a` and `b` deliberately share tile coordinates, so climbing the west
    // stair leaves you standing directly above where you were.
    this.links = LEVEL_LINKS.map((l, i) => ({
      id: i, kind: l.kind, name: l.name,
      a: { floor: l.a.floor, tx: l.a.x, ty: l.a.y },
      b: { floor: l.b.floor, tx: l.b.x, ty: l.b.y },
      cx: (l.a.x + 0.5) * T, cy: (l.a.y + 0.5) * T,
    }));
    // floor -> links that touch it, for the cross-floor pathing search
    this.linksByFloor = FLOORS.map(() => []);
    for (const l of this.links) {
      this.linksByFloor[l.a.floor].push(l);
      this.linksByFloor[l.b.floor].push(l);
    }

    // --- one parsed storey each --------------------------------------------
    this.floors = FLOORS.map((def, i) => this._parseFloor(def, i));

    this.floor = -1;
    this.playerStart = { x: (PLAYER_START.x + 0.5) * T, y: (PLAYER_START.y + 0.5) * T };
    this.setFloor(0);
  }

  // ------------------------------------------------------------- storeys ---
  /**
   * Swap the whole map over to another storey. Everything downstream --
   * collision, flow field, rendering, decals -- reads through `this`, so
   * this one call is all the moving between floors there is.
   */
  setFloor(n) {
    n = Math.max(0, Math.min(this.floors.length - 1, n));
    if (n === this.floor) return false;
    this.floor = n;
    const F = this.floors[n];
    this.tiles = F.tiles;
    this.barricadeOf = F.barricadeOf;
    this.doorOf = F.doorOf;
    this.stairOf = F.stairOf;
    this.seen = F.seen;
    this.barricades = F.barricades;
    this.doors = F.doors;
    this.stairs = F.stairs;
    this.spawnPoints = F.spawnPoints;
    this.wallBuys = F.wallBuys;
    this.grenadeCrates = F.grenadeCrates;
    this.boxSpots = F.boxSpots;
    this.cacheSpots = F.cacheSpots;
    this.lamps = F.lamps;
    this.floorDef = F.def;
    this.staticCanvas = F.staticCanvas;
    this.dist = F.dist;
    this.next = F.next;
    this._heap = F._heap;
    this.secretDoorIdx = F.secretDoorIdx;
    // NB: secretDoorOpen is deliberately *not* copied from the storey. The
    // cache is one thing for the whole map, and copying it here meant every
    // flow rebuild (which hops storeys) reset a door the player had already
    // opened straight back to shut.
    for (const k of ['perkSpots', 'powerSwitch', 'workbench', 'papSpot',
      'secretSwitches', 'secretLoot']) this[k] = F[k];
    this.flowDirty = true;
    return true;
  }

  get floorName() { return this.floorDef?.name ?? ''; }
  get floorShort() { return this.floorDef?.short ?? ''; }
  get isRoof() { return this.floorDef?.key === 'roof'; }

  /** Storeys that can be reached from `from`, nearest link first. */
  linksOn(floor) { return this.linksByFloor[floor] ?? []; }

  /**
   * Which link on `from` should a zombie head for in order to reach `to`?
   * Breadth-first over the storey graph -- three floors, so it is trivial.
   */
  hopTowards(from, to) {
    if (from === to) return null;
    const prev = new Map([[from, null]]);
    const q = [from];
    while (q.length) {
      const f = q.shift();
      if (f === to) break;
      for (const l of this.linksOn(f)) {
        const other = l.a.floor === f ? l.b : l.a;
        if (prev.has(other.floor)) continue;
        prev.set(other.floor, { link: l, from: f });
        q.push(other.floor);
      }
    }
    if (!prev.has(to)) return null;
    // walk the chain back until we find the hop that leaves `from`
    let cur = to;
    let step = prev.get(to);
    while (step && step.from !== from) { cur = step.from; step = prev.get(cur); }
    return step ? { link: step.link, toFloor: cur } : null;
  }

  /** The landing tile (world pixels) of `link` on `floor`. */
  linkPos(link, floor) {
    const end = link.a.floor === floor ? link.a : link.b;
    return { x: (end.tx + 0.5) * T, y: (end.ty + 0.5) * T, tx: end.tx, ty: end.ty };
  }

  idx(tx, ty) { return ty * this.w + tx; }
  inside(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h; }
  tileAt(tx, ty) { return this.inside(tx, ty) ? this.tiles[ty * this.w + tx] : TILE.WALL; }
  tileIdxAt(x, y) {
    const tx = Math.floor(x / T), ty = Math.floor(y / T);
    return this.inside(tx, ty) ? this.idx(tx, ty) : -1;
  }

  /** Parses one storey out of the generated ASCII + object tables. */
  _parseFloor(def, index) {
    const F = {
      def, index,
      tiles: new Uint8Array(this.n),
      barricadeOf: new Int16Array(this.n).fill(-1),
      doorOf: new Int16Array(this.n).fill(-1),
      stairOf: new Int16Array(this.n).fill(-1),
      seen: new Uint8Array(this.n),
      barricades: [], doors: [], stairs: [], spawnPoints: [], wallBuys: [],
      grenadeCrates: [], boxSpots: [], cacheSpots: [], lamps: [],
      solidProps: [],
      secretDoorIdx: -1, secretDoorOpen: false,
      dist: new Int32Array(this.n),
      next: new Int32Array(this.n),
    };
    F._heap = new MinHeap(this.n);
    const tiles = F.tiles;

    for (let y = 0; y < MAP_H; y++) {
      const row = def.rows[y];
      for (let x = 0; x < MAP_W; x++) {
        tiles[y * MAP_W + x] = CHAR_TO_TILE[row[x]] ?? TILE.EXTERIOR;
      }
    }

    // --- honest openings ---------------------------------------------------
    // A window tile with a wall on every side of it, and a door standing in
    // the middle of a room with nothing walled off either side of it, are not
    // openings: they are boards painted into the masonry, and they look like
    // a bug because they are one. Solidity here is the tile's own, not the
    // barricade's -- a window with planks up is solid, but it is still a way
    // through, and a neighbour's planks must not count as a wall.
    const idx = (x, y) => y * MAP_W + x;
    const hardTile = (x, y) => (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H)
      || TILE_SOLID.has(tiles[idx(x, y)]);

    // --- group contiguous window tiles into barricade objects --------------
    const seen = new Uint8Array(this.n);
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const i = idx(x, y);
        if (tiles[i] !== TILE.WINDOW || seen[i]) continue;
        const group = [];
        const stack = [[x, y]];
        seen[i] = 1;
        while (stack.length) {
          const [cx, cy] = stack.pop();
          group.push(idx(cx, cy));
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
            const ni = idx(nx, ny);
            if (tiles[ni] === TILE.WINDOW && !seen[ni]) { seen[ni] = 1; stack.push([nx, ny]); }
          }
        }
        const xs = group.map((g) => g % MAP_W);
        const ys = group.map((g) => (g / MAP_W) | 0);
        // a window nobody can reach from either side is just a boarded patch
        // of wall: make it wall and have done with it
        let openSides = 0;
        for (const g of group) {
          const gx = g % MAP_W, gy = (g / MAP_W) | 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = gx + dx, ny = gy + dy;
            if (group.includes(idx(nx, ny))) continue;
            if (!hardTile(nx, ny)) openSides++;
          }
        }
        if (openSides === 0) {
          for (const g of group) tiles[g] = TILE.WALL;
          continue;
        }
        const b = {
          id: F.barricades.length,
          tiles: group,
          // the run of tiles says which way the wall goes; a single tile has
          // to be told by what is solid on either side of it
          horizontal: new Set(ys).size === 1,
          opening: openSides,
          planks: MAX_PLANKS,
          maxPlanks: MAX_PLANKS,
          hurt: 0,
          cx: (Math.min(...xs) + Math.max(...xs) + 1) * T / 2,
          cy: (Math.min(...ys) + Math.max(...ys) + 1) * T / 2,
        };
        F.barricades.push(b);
        for (const g of group) F.barricadeOf[g] = b.id;
      }
    }

    // --- doors -------------------------------------------------------------
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const i = idx(x, y);
        if (tiles[i] !== TILE.DOOR) continue;
        // Which way does the wall this door is cut into run? Walls above and
        // below means it runs east-west, and the boards lie east-west too.
        // (It used to be taken from the *other* axis, which laid every board
        // across the opening and nailed the ends into the masonry -- the
        // "barrier inside the wall" you could see on every storey.)
        const walledUD = hardTile(x, y - 1) && hardTile(x, y + 1);
        const walledLR = hardTile(x - 1, y) && hardTile(x + 1, y);
        if (!walledUD && !walledLR) {
          // no wall to be a doorway in: standing boards in an open room
          tiles[i] = TILE.FLOOR;
          continue;
        }
        const d = {
          id: F.doors.length, tx: x, ty: y, i,
          horizontal: walledUD,
          open: false,
          price: DOOR_PRICES[`${x},${y}`] ?? 750,
          hurt: 0,
          cx: (x + 0.5) * T, cy: (y + 0.5) * T,
        };
        F.doors.push(d);
        F.doorOf[i] = d.id;
      }
    }

    // --- stairwells (same-storey teleport pairs) ---------------------------
    if (index === 0) {
      for (const s of STAIRS) {
        const ai = idx(s.ax, s.ay), bi = idx(s.bx, s.by);
        const st = { id: F.stairs.length, a: ai, b: bi, dir: s.dir };
        F.stairs.push(st);
        F.stairOf[ai] = st.id;
        F.stairOf[bi] = st.id;
      }
      F.secretDoorIdx = idx(SECRET_DOOR.x, SECRET_DOOR.y);
      F.perkSpots = PERK_SPOTS.map((p) => ({
        id: p.id, x: (p.x + 0.5) * T, y: (p.y + 0.5) * T, tx: p.x, ty: p.y,
      }));
      F.powerSwitch = { x: (POWER_SWITCH.x + 0.5) * T, y: (POWER_SWITCH.y + 0.5) * T };
      // the bench used to live in the shed down here; it is on the top floor
      // now, which is what the top floor is for -- and it means carrying your
      // scrap up three flights while the dead are coming in behind you
      F.workbench = null;
      F.papSpot = { x: (PAP_SPOT.x + 0.5) * T, y: (PAP_SPOT.y + 0.5) * T };
      F.secretSwitches = SECRET_SWITCHES.map((s, i) => ({
        id: i, x: (s.x + 0.5) * T, y: (s.y + 0.5) * T, found: false,
      }));
      F.secretLoot = SECRET_LOOT.map((s) => ({ x: (s.x + 0.5) * T, y: (s.y + 0.5) * T, taken: false }));
    } else {
      F.perkSpots = [];
      F.powerSwitch = null;
      // the top storey is the only one with a bench
      F.workbench = index === FLOOR_ROOF
        ? { x: (WORKBENCH_ROOF.x + 0.5) * T, y: (WORKBENCH_ROOF.y + 0.5) * T }
        : null;
      F.papSpot = null;
      F.secretSwitches = [];
      F.secretLoot = [];
    }

    // --- per-storey object tables -------------------------------------------
    const objs = def.objects;
    F.spawnPoints = objs.spawns.map((s) => ({ x: (s.x + 0.5) * T, y: (s.y + 0.5) * T, tx: s.x, ty: s.y }));
    if (index === 0) {
      F.spawnPoints = SPAWN_POINTS.map((s) => ({ x: (s.x + 0.5) * T, y: (s.y + 0.5) * T, tx: s.x, ty: s.y }));
      F.wallBuys = WALL_BUYS.map((b) => ({
        x: (b.x + 0.5) * T, y: (b.y + 0.5) * T,
        wx: b.wx, wy: b.wy, weapon: b.weapon,
        wallCX: (b.wx + 0.5) * T, wallCY: (b.wy + 0.5) * T,
        facing: wallFacing(b),
      }));
      F.grenadeCrates = GRENADE_CRATES.map((g) => ({ x: (g.x + 0.5) * T, y: (g.y + 0.5) * T }));
      F.boxSpots = BOX_SPOTS.map((b) => ({ x: (b.x + 0.5) * T, y: (b.y + 0.5) * T, tx: b.x, ty: b.y }));
      F.cacheSpots = [];
      F.lamps = null;                     // the ground floor uses the hand-placed LAMPS table
    } else {
      F.wallBuys = objs.wallbuys.map((b) => ({
        x: (b.x + 0.5) * T, y: (b.y + 0.5) * T,
        wx: b.wx, wy: b.wy, weapon: b.weapon,
        wallCX: (b.wx + 0.5) * T, wallCY: (b.wy + 0.5) * T,
        facing: wallFacing(b),
      }));
      F.grenadeCrates = objs.crates.map((g) => ({ x: (g.x + 0.5) * T, y: (g.y + 0.5) * T }));
      F.boxSpots = objs.box.map((b) => ({ x: (b.x + 0.5) * T, y: (b.y + 0.5) * T, tx: b.x, ty: b.y }));
      F.cacheSpots = objs.cache.map((c) => ({
        x: (c.x + 0.5) * T, y: (c.y + 0.5) * T, taken: false,
      }));
      // `always` marks the fittings that run off their own battery -- three
      // of them upstairs, so the barracks is never a black box while the
      // generator is still off
      F.lamps = objs.lamps.map((l) => ({
        x: (l.x + 0.5) * T, y: (l.y + 0.5) * T, mains: !l.always,
        // phase too, or the flicker update turns the lamp's brightness into
        // NaN on the very first frame and it never burns at all
        phase: (l.x * 7 + l.y * 13) % 6.283, flick: 1,
      }));
    }

    // A link tile is the one tile in the building that has to be standable on
    // both of the storeys it joins. A bunk parked on the west stair landing
    // upstairs turned it into a one-way trip: you could climb out of the spawn
    // room and never get back down. Clear anything solid off them.
    for (const l of this.links) {
      for (const end of [l.a, l.b]) {
        if (end.floor !== index) continue;
        const i = end.ty * MAP_W + end.tx;
        if (BLOCKS_FLOW.has(tiles[i]) && tiles[i] !== TILE.VOID) tiles[i] = TILE.FLOOR;
      }
    }

    F.staticCanvas = paintLevel(tiles, MAP_W, MAP_H, 20240917 + index * 7919, index);
    return F;
  }

  // ------------------------------------------------------------ collision --
  /** Blocks movement? */
  solidAt(tx, ty) {
    return this.solidTileOn(this.floor, tx, ty);
  }

  /**
   * The same question, asked about a storey the player may not be standing on.
   * Everything that used to be a bare `solidAt` on a creature that can be on
   * another floor now comes through here -- and it must answer about *barred
   * windows and shut doors* too, not just the tile type, or the horde walks
   * straight through the barricades.
   */
  solidTileOn(floor, tx, ty) {
    if (!this.inside(tx, ty)) return true;
    const F = floor === this.floor ? this : this.floors[floor];
    if (!F) return true;
    const i = ty * this.w + tx;
    switch (F.tiles[i]) {
      case TILE.WALL: case TILE.CRATE: case TILE.TREE:
      case TILE.FENCE: case TILE.VEHICLE: case TILE.VOID:
      case TILE.BUNK: case TILE.LOCKER: case TILE.TABLE: return true;
      case TILE.SECRET_DOOR: return !this.secretDoorOpen;   // whole-map state, not per storey
      case TILE.WINDOW: {
        const b = F.barricades[F.barricadeOf[i]];
        return b ? b.planks > 0 : false;
      }
      case TILE.DOOR: {
        const d = F.doors[F.doorOf[i]];
        return d ? !d.open : false;
      }
      default: return false;
    }
  }

  blocksBullets(tx, ty) {
    if (!this.inside(tx, ty)) return true;
    const i = ty * this.w + tx;
    if (this.tiles[i] === TILE.FENCE) return false;
    return this.solidAt(tx, ty);
  }

  /** Move a circle by (dx,dy), sliding along walls. Mutates pos {x,y}. */
  moveCircle(pos, dx, dy, r, floor = this.floor) {
    pos.x += dx;
    this._resolveAxis(pos, r, true, floor);
    this._resolveProps(pos, r, floor);
    pos.y += dy;
    this._resolveAxis(pos, r, false, floor);
    this._resolveProps(pos, r, floor);
  }

  /**
   * Furniture. The tiles know nothing about the mystery box standing in the
   * middle of the room, so you could walk straight through it; the game
   * pushes the list in every frame and this shoves circles back out of them.
   */
  _resolveProps(pos, r, floor) {
    for (const p of this.solidProps) {
      if ((p.floor ?? 0) !== floor) continue;
      const nx = pos.x < p.x0 ? p.x0 : pos.x > p.x1 ? p.x1 : pos.x;
      const ny = pos.y < p.y0 ? p.y0 : pos.y > p.y1 ? p.y1 : pos.y;
      const dx = pos.x - nx, dy = pos.y - ny;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      const ox = pos.x, oy = pos.y;
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        pos.x += (dx / d) * (r - d);
        pos.y += (dy / d) * (r - d);
      } else {
        // swallowed whole: leave by the nearest face
        const l = pos.x - p.x0, rr = p.x1 - pos.x, u = pos.y - p.y0, dn = p.y1 - pos.y;
        const m = Math.min(l, rr, u, dn);
        if (m === l) pos.x = p.x0 - r;
        else if (m === rr) pos.x = p.x1 + r;
        else if (m === u) pos.y = p.y0 - r;
        else pos.y = p.y1 + r;
      }
      // A crate in a tight spot can shove you somewhere the tiles do not
      // allow. Being inside a wall is worse than being inside a crate, so
      // when that happens the push is undone and you simply stop.
      if (this._inSolid(pos, r, floor)) { pos.x = ox; pos.y = oy; }
    }
  }

  /**
   * Is this tile the only way through? Two open sides facing each other and
   * two walls facing each other: a corridor one tile wide.
   *
   * Furniture is not a tile, so the flow field has no idea it is there. A
   * crate in the middle of a room is fine -- there is all round it -- but a
   * machine standing in a one-tile gap seals the passage and the horde piles
   * up against it forever. Those ones do not get a body.
   */
  pinchTile(tx, ty, floor = this.floor) {
    const open = (x, y) => !this.solidTileOn(floor, x, y);
    const n = open(tx, ty - 1), s = open(tx, ty + 1);
    const w = open(tx - 1, ty), e = open(tx + 1, ty);
    return (n && s && !w && !e) || (w && e && !n && !s);
  }

  /** Does this box sit on any tile that is the only way through? */
  propsWouldSeal(x0, y0, x1, y1, floor = this.floor) {
    for (let ty = Math.floor(y0 / T); ty <= Math.floor(y1 / T); ty++) {
      for (let tx = Math.floor(x0 / T); tx <= Math.floor(x1 / T); tx++) {
        if (this.pinchTile(tx, ty, floor)) return true;
      }
    }
    return false;
  }

  /**
   * Solid for a circle of radius r sitting at (x,y): the tiles and the
   * furniture both. The flow field only knows about tiles, so this is how
   * anybody steering round a crate asks whether the way is clear.
   */
  blockedAt(x, y, r = 0, floor = this.floor) {
    if (this.solidTileOn(floor, Math.floor(x / T), Math.floor(y / T))) return true;
    for (const p of this.solidProps) {
      if ((p.floor ?? 0) !== floor) continue;
      if (x > p.x0 - r && x < p.x1 + r && y > p.y0 - r && y < p.y1 + r) return true;
    }
    return false;
  }

  /** Is any of this circle's four corners inside a solid tile? */
  _inSolid(pos, r, floor) {
    for (const dx of [-r, r]) {
      for (const dy of [-r, r]) {
        if (this.solidTileOn(floor, Math.floor((pos.x + dx) / T), Math.floor((pos.y + dy) / T))) return true;
      }
    }
    return false;
  }

  _resolveAxis(pos, r, horizontal, floor = this.floor) {
    const t0x = Math.floor((pos.x - r) / T), t1x = Math.floor((pos.x + r) / T);
    const t0y = Math.floor((pos.y - r) / T), t1y = Math.floor((pos.y + r) / T);
    for (let ty = t0y; ty <= t1y; ty++) {
      for (let tx = t0x; tx <= t1x; tx++) {
        if (!this.solidTileOn(floor, tx, ty)) continue;
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
  /** Builds the flow field on a storey the player is not currently on. */
  buildFlowOn(floorIdx, targetX, targetY) {
    if (floorIdx === this.floor) { this.buildFlow(targetX, targetY); return; }
    const prev = this.floor;
    this.setFloor(floorIdx);
    this.buildFlow(targetX, targetY);
    this.setFloor(prev);
  }

  buildFlow(targetX, targetY) {
    const { w, h, tiles, dist, next } = this;
    // tiles the flow field has to steer around even though they are not walls:
    // the mystery box and the machines, which the horde cannot walk through
    const blocked = this._flowBlocked?.get(this.floor);
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
        if (BLOCKS_FLOW.has(t)) continue;
        // Not a wall, just furniture: a route through it is allowed but costs
        // the earth, so the horde walks round the box whenever it can. Making
        // it impassable instead strands anybody standing on that tile.
        let propCost = 0;
        if (blocked && blocked.has(ni)) propCost = COST_PROP;
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
        const nd = cd + base + extra + propCost;
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
  /** `floor` lets a zombie read the flow field of the storey it is on. */
  flowStep(x, y, floor = this.floor) {
    const F = floor === this.floor ? this : this.floors[floor];
    if (!F) return null;
    const tx = Math.floor(x / T), ty = Math.floor(y / T);
    if (!this.inside(tx, ty)) return null;
    const i = this.idx(tx, ty);
    if (F.dist[i] === INF) return null;
    const n = F.next[i];
    if (n < 0) return null;
    const nx = n % this.w, ny = (n / this.w) | 0;
    if (Math.abs(nx - tx) > 1 || Math.abs(ny - ty) > 1) {
      // non-adjacent => stairwell portal; step onto this tile's centre first
      return { x: (tx + 0.5) * T, y: (ty + 0.5) * T, ti: i, portal: n };
    }
    return { x: (nx + 0.5) * T, y: (ny + 0.5) * T, ti: n, portal: -1 };
  }

  /** Tile-only solidity check on a storey, without swapping the map over. */
  tileOn(floor, tx, ty) {
    const F = floor === this.floor ? this : this.floors[floor];
    if (!F || tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return TILE.VOID;
    return F.tiles[ty * this.w + tx];
  }

  /** A boarded window or a shut door sitting on that tile of that storey. */
  blockerOn(floor, ti) {
    const F = floor === this.floor ? this : this.floors[floor];
    if (!F) return null;
    const t = F.tiles[ti];
    if (t === TILE.WINDOW) {
      const b = F.barricades[F.barricadeOf[ti]];
      if (b && b.planks > 0) return { kind: 'window', obj: b };
    } else if (t === TILE.DOOR) {
      const d = F.doors[F.doorOf[ti]];
      if (d && !d.open) return { kind: 'door', obj: d };
    }
    return null;
  }

  reachable(x, y, floor = this.floor) {
    const F = floor === this.floor ? this : this.floors[floor];
    if (!F) return false;
    const tx = Math.floor(x / T), ty = Math.floor(y / T);
    if (!this.inside(tx, ty)) return false;
    return F.dist[this.idx(tx, ty)] < INF;
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
