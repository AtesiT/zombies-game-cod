#!/usr/bin/env python3
"""
Generates src/mapData.js  -- the expanded "Nacht der Untoten" style level.

Layout (72 x 50 tiles):

     0        12                    45   50        62 66        71
  0  +--------------------------------------------------------------+
     |  north field / forest ....... [RADIO ROOM 50..62 x 2..9]     |
  8  |        +-- MAIN BUNKER 12..45 x 8..30 --+   [SHED 52..60]    |
     |        |  A        |        B           |    x 14..20        |
 19  |        +-----------+-----------+--------+                    |
     |        |  C        |        D           |   [SECRET 63..70]  |
 30  |        +-----------+-----------+--------+    x 17..23        |
     |  west yard / field ........ east field (trees, wrecked truck)|
 33  |   [CELLAR 5..14 x 33..42]                                    |
 44  +--------------------------------------------------------------+
        south field / forest

Legend used in the emitted ASCII:
  ' ' exterior ground      '.' interior floor     '#' wall
  'W' window / barricade   'D' buyable door       'c' crate (solid)
  'r' rubble (walkable)    'T' tree (solid)       'F' fence (solid, shoot-through)
  'V' wrecked vehicle      'S' stairwell (teleport pair, walkable)
  '*' secret door (solid until the three fuses are found)
  '@' player start
"""
import collections
import os
import random

W, H = 72, 50
g = [[' '] * W for _ in range(H)]
rnd = random.Random(0xC0FFEE)


def fill(x0, y0, x1, y1, ch):
    for y in range(max(0, y0), min(H, y1 + 1)):
        for x in range(max(0, x0), min(W, x1 + 1)):
            g[y][x] = ch


def outline(x0, y0, x1, y1, ch):
    for x in range(x0, x1 + 1):
        g[y0][x] = ch
        g[y1][x] = ch
    for y in range(y0, y1 + 1):
        g[y][x0] = ch
        g[y][x1] = ch


def put(x, y, ch):
    g[y][x] = ch


# =========================================================== MAIN BUNKER ===
BX0, BY0, BX1, BY1 = 12, 8, 45, 30
outline(BX0, BY0, BX1, BY1, '#')
fill(BX0 + 1, BY0 + 1, BX1 - 1, BY1 - 1, '.')
for y in range(BY0 + 1, BY1):
    g[y][28] = '#'                      # vertical partition  A|B   C|D
for x in range(BX0 + 1, BX1):
    g[19][x] = '#'                      # horizontal partition A|C  B|D

DOORS = [
    (28, 13, 750),    # A <-> B
    (28, 25, 1000),   # C <-> D
    (20, 19, 500),    # A <-> C
    (36, 19, 750),    # B <-> D
    (12, 24, 750),    # room C  -> west yard
    (45, 24, 1000),   # room D  -> east field
]
for x, y, _ in DOORS:
    put(x, y, 'D')

WINDOWS = []
for c in (15, 21, 32, 38):
    WINDOWS += [(c, BY0), (c + 1, BY0)]
    WINDOWS += [(c, BY1), (c + 1, BY1)]
for r in (10, 15, 27):
    WINDOWS += [(BX0, r), (BX0, r + 1)]
for r in (10, 15, 21, 27):
    WINDOWS += [(BX1, r), (BX1, r + 1)]
for x, y in WINDOWS:
    if g[y][x] == '#':
        put(x, y, 'W')

# interior cover
for (x, y) in [(16, 11), (17, 11), (25, 16), (33, 11), (41, 16),
               (16, 26), (24, 22), (33, 26), (41, 22), (20, 13), (37, 27)]:
    put(x, y, 'c')
for (x, y) in [(22, 17), (31, 12), (39, 17), (18, 22), (35, 23), (14, 17), (43, 12)]:
    put(x, y, 'r')

PLAYER_START = (20, 14)

# ============================================================= RADIO ROOM ===
# the "upstairs" eyrie -- only reachable via the stairwell from room B
outline(50, 2, 62, 9, '#')
fill(51, 3, 61, 8, '.')
put(54, 9, 'W'); put(55, 9, 'W')
put(58, 2, 'W'); put(59, 2, 'W')
put(52, 5, 'c')
put(60, 7, 'r')

# ================================================================== SHED ====
# the help room: workbench + a perk machine, out in the west yard
outline(52, 14, 60, 20, '#')
fill(53, 15, 59, 19, '.')
put(54, 14, 'W'); put(55, 14, 'W')
put(56, 20, 'D')                      # buyable door out to the yard
put(58, 17, 'c')

# ================================================================ CELLAR ====
# holds the power switch; reached by the stairwell from room C
outline(5, 33, 14, 42, '#')
fill(6, 34, 13, 41, '.')
put(8, 33, 'W'); put(9, 33, 'W')
put(12, 42, 'W'); put(13, 42, 'W')
put(7, 39, 'c')
put(11, 35, 'r')

# =========================================================== SECRET ROOM ===
outline(63, 17, 70, 23, '#')
fill(64, 18, 69, 22, '.')
put(63, 20, '*')                      # bricked-up doorway, opens with 3 fuses

# ============================================================ STAIRWELLS ===
STAIRS = [
    {'a': (41, 10), 'b': (56, 6), 'name': 'up'},      # room B  <-> radio room
    {'a': (16, 28), 'b': (8, 38), 'name': 'down'},    # room C  <-> cellar
]
for s in STAIRS:
    put(*s['a'], 'S')
    put(*s['b'], 'S')

# ============================================================== PROPS =======
def tree_cluster(cx, cy, rx, ry, density):
    for y in range(cy - ry, cy + ry + 1):
        for x in range(cx - rx, cx + rx + 1):
            if not (0 <= x < W and 0 <= y < H):
                continue
            if g[y][x] != ' ':
                continue
            d = ((x - cx) / max(1, rx)) ** 2 + ((y - cy) / max(1, ry)) ** 2
            if rnd.random() < density * (1 - d):
                g[y][x] = 'T'


# forest belts along the map edge
for cx, cy, rx, ry, dens in [
    (6, 2, 8, 3, 0.75), (22, 1, 10, 2, 0.70), (40, 1, 10, 2, 0.70),
    (68, 3, 4, 4, 0.80), (70, 14, 3, 8, 0.75), (70, 36, 3, 10, 0.80),
    (52, 47, 12, 3, 0.75), (30, 48, 16, 2, 0.75), (8, 47, 8, 3, 0.75),
    (1, 20, 2, 12, 0.80), (1, 40, 2, 6, 0.75),
    (30, 24, 0, 0, 0),
]:
    tree_cluster(cx, cy, rx, ry, dens)

# a few lone trees / copses so the yard isn't a blank field
for cx, cy, rx, ry, dens in [
    (8, 14, 3, 2, 0.45), (8, 30, 3, 2, 0.45),
    (49, 34, 4, 3, 0.40), (64, 30, 4, 3, 0.40), (40, 40, 5, 3, 0.35),
    (24, 38, 4, 2, 0.35), (56, 26, 3, 2, 0.35), (18, 8, 3, 2, 0.30),
]:
    tree_cluster(cx, cy, rx, ry, dens)

# wrecked truck + hay bales in the east field
fill(60, 30, 62, 31, 'V')
for (x, y) in [(55, 33), (56, 33), (55, 34), (58, 36), (59, 36), (57, 25), (58, 25)]:
    if g[y][x] == ' ':
        put(x, y, 'c')

# fences: a low picket line you can shoot over but not walk through
FENCES = []
for x in range(16, 31):
    FENCES.append((x, 6))
for x in range(46, 58):
    FENCES.append((x, 2))
for y in range(33, 40):
    FENCES.append((50, y))
for (x, y) in FENCES:
    if g[y][x] == ' ':
        put(x, y, 'F')

# scattered rubble everywhere for texture
for _ in range(90):
    x, y = rnd.randrange(W), rnd.randrange(H)
    if g[y][x] == ' ':
        g[y][x] = 'r'

put(*PLAYER_START, '@')

# ============================================================== HOTSPOTS ===
WALL_BUYS = [
    # x, y,  wallX, wallY, weapon
    (18, 9, 18, 8, 'm1911'),
    (24, 9, 24, 8, 'thompson'),
    (30, 9, 30, 8, 'mp40'),
    (36, 9, 36, 8, 'trenchgun'),
    (42, 9, 42, 8, 'ppsh'),
    (18, 29, 18, 30, 'kar98k'),
    (24, 29, 24, 30, 'fg42'),
    (30, 29, 30, 30, 'bar'),
    (36, 29, 36, 30, 'mg42'),
    (42, 29, 42, 30, 'ptrs41'),
]

GRENADE_CRATES = [(26, 17), (34, 27), (57, 16)]

PERKS = [
    ('juggernog', 25, 17),
    ('doubletap', 33, 16),
    ('speedcola', 40, 27),
    ('phdflopper', 17, 27),
    ('quickrevive', 55, 18),
    ('staminup', 11, 39),
    ('deadshot', 57, 7),
    ('widowswine', 53, 35),
]

BOX_SPOTS = [(30, 4), (6, 20), (57, 29), (9, 38), (40, 43)]

POWER_SWITCH = (7, 35)
WORKBENCH = (58, 16)
# Pack-a-Punch lives in the radio room, up the stairs from room B
PAP_SPOT = (53, 7)
SECRET_SWITCHES = [(14, 10), (43, 28), (66, 41), (52, 4)]
SECRET_DOOR = (63, 20)
SECRET_LOOT = [(66, 19), (68, 21)]     # where the goodies appear

SPAWN_POINTS = [
    # ring around the bunker
    (20, 5), (28, 3), (36, 5), (10, 10), (10, 20), (10, 30),
    (48, 6), (48, 14), (48, 20), (48, 30), (20, 33), (28, 33), (36, 33),
    # the field / forest edges
    (16, 38), (24, 44), (34, 45), (44, 44), (52, 44), (60, 38),
    (66, 24), (66, 16), (58, 12), (44, 2), (36, 2), (24, 2),
    # annexes
    (54, 12), (62, 22), (3, 36), (17, 36), (3, 44), (64, 6),
]

# ============================================================ VALIDATION ===
WALKABLE = set(' .WDSr')
PASSABLE_FOR_CHECK = set('.WDSr c')     # crates are props, not floor

seen = {PLAYER_START}
q = collections.deque([PLAYER_START])
while q:
    x, y = q.popleft()
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, ny = x + dx, y + dy
        if 0 <= nx < W and 0 <= ny < H and (nx, ny) not in seen and g[ny][nx] in WALKABLE:
            seen.add((nx, ny))
            q.append((nx, ny))

problems = []
for (x, y) in SPAWN_POINTS:
    if g[y][x] in '#TFVc':
        problems.append(f'spawn inside a solid: {(x, y)} = {g[y][x]!r}')
    elif (x, y) not in seen:
        problems.append(f'spawn unreachable (needs an open door?): {(x, y)}')
checks = (
    [(x, y) for x, y, *_ in WALL_BUYS] +
    GRENADE_CRATES + [(x, y) for _, x, y in PERKS] + BOX_SPOTS +
    [POWER_SWITCH, WORKBENCH, PAP_SPOT] + SECRET_SWITCHES +
    [s['a'] for s in STAIRS] + [s['b'] for s in STAIRS]
)
for (x, y) in checks:
    if g[y][x] in '#TFVc':
        problems.append(f'object inside a solid: {(x, y)} = {g[y][x]!r}')
    elif (x, y) not in seen:
        problems.append(f'object unreachable (needs an open door): {(x, y)}')

# the bricked-up secret door is solid on purpose: check that the yard side of
# it is reachable, that the vault behind it is sealed, and that it has floor.
sx, sy = SECRET_DOOR[0] - 1, SECRET_DOOR[1]
if (sx, sy) not in seen:
    problems.append(f'outside face of the secret door unreachable: {(sx, sy)}')
if g[SECRET_DOOR[1]][SECRET_DOOR[0] + 1] != '.':
    problems.append('nothing behind the secret door')
for (x, y) in SECRET_LOOT:
    if g[y][x] != '.':
        problems.append(f'secret loot not on floor: {(x, y)} = {g[y][x]!r}')

for row in g:
    assert len(row) == W
assert len(g) == H

if problems:
    print('!! PROBLEMS:')
    for p in problems:
        print('  -', p)
    raise SystemExit(1)

# stats
counts = collections.Counter(ch for row in g for ch in row)
print('map', W, 'x', H, dict(counts))
print('reachable tiles from spawn (all doors open):', len(seen))


# ======================================================== UPPER STOREYS =====
# The bunker is three storeys tall. Floor 1 is everything built above; the
# upper floors reuse the same 72x50 grid so code, coordinates and the camera
# all keep working -- the footprint simply sits inside the ground walls and
# everything outside it is VOID (open air).
#
# Vertical links use the SAME tile coordinates on both floors, so climbing
# the west stair puts you literally directly above where you were standing.

def blank(ch):
    return [[ch] * W for _ in range(H)]


def _mk():
    """Local grid helpers so the storey builders never touch the ground map."""
    grid = [['~'] * W for _ in range(H)]

    def fl(x0, y0, x1, y1, ch):
        for y in range(max(0, y0), min(H, y1 + 1)):
            for x in range(max(0, x0), min(W, x1 + 1)):
                grid[y][x] = ch

    def ol(x0, y0, x1, y1, ch):
        for x in range(x0, x1 + 1):
            grid[y0][x] = ch
            grid[y1][x] = ch
        for y in range(y0, y1 + 1):
            grid[y][x0] = ch
            grid[y][x1] = ch

    def pt(x, y, ch):
        grid[y][x] = ch

    return grid, fl, ol, pt


def build_upper():
    u, fill, outline, put = _mk()
    X0, Y0, X1, Y1 = 13, 8, 44, 30       # inside the ground-floor walls

    outline(X0, Y0, X1, Y1, '#')
    fill(X0 + 1, Y0 + 1, X1 - 1, Y1 - 1, '.')

    # partitions with wide openings -- upstairs is a training loop, not a lockbox
    for y in range(Y0 + 1, Y1):
        if 12 <= y <= 13 or 18 <= y <= 20 or 25 <= y <= 26:
            continue
        put(28, y, '#')
    for x in range(X0 + 1, X1):
        if 19 <= x <= 21 or 27 <= x <= 29 or 36 <= x <= 38:
            continue
        put(x, 19, '#')

    # barricaded windows: this is how they get up here
    win = []
    for c in (16, 24, 33, 41):
        win += [(c, Y0), (c + 1, Y0), (c, Y1), (c + 1, Y1)]
    for r in (12, 25):
        win += [(X0, r), (X0, r + 1), (X1, r), (X1, r + 1)]
    for x, y in win:
        put(x, y, 'W')

    # furniture: bunks, a machine room, storage
    for (x, y) in [(15, 10), (17, 10), (15, 16), (17, 16),
                   (22, 10), (22, 16),
                   (31, 10), (33, 10), (31, 16), (33, 16),
                   (40, 10), (42, 10),
                   (15, 22), (17, 22), (15, 28), (17, 28),
                   (24, 22), (24, 28),
                   (31, 22), (33, 22), (31, 28), (33, 28),
                   (40, 22), (42, 22), (40, 28), (42, 28)]:
        put(x, y, 'c')
    for (x, y) in [(20, 14), (35, 12), (20, 27), (38, 26), (26, 11)]:
        put(x, y, 'r')

    return u, {
        'spawns': [(16, 9), (24, 9), (33, 9), (41, 9),
                   (16, 29), (24, 29), (33, 29), (41, 29),
                   (14, 12), (14, 25), (43, 12), (43, 25)],
        'wallbuys': [(30, 12, 30, 11, 'mg42')],
        'box': [(28, 19)],
        'crates': [(20, 19)],
        'lamps': [(16, 12), (24, 12), (33, 12), (41, 12),
                  (16, 27), (24, 27), (33, 27), (41, 27), (28, 19)],
    }


def build_roof():
    r, fill, outline, put = _mk()
    X0, Y0, X1, Y1 = 13, 8, 44, 30

    # the roof deck, ringed by a parapet you cannot walk off
    fill(X0, Y0, X1, Y1, 'R')            # 'R' = roof deck, walkable
    outline(X0, Y0, X1, Y1, '#')

    # the attic sits on the roof: a low, junk-lined room, one door south
    AX0, AY0, AX1, AY1 = 22, 13, 35, 22
    outline(AX0, AY0, AX1, AY1, '#')
    fill(AX0 + 1, AY0 + 1, AX1 - 1, AY1 - 1, '.')
    put(28, AY1, 'D')                    # attic door, opens onto the roof

    # beams and junk up here
    for (x, y) in [(24, 15), (30, 14), (24, 20), (31, 15), (33, 15), (31, 20),
                   (17, 12), (19, 26), (38, 12), (41, 27), (29, 27), (21, 21)]:
        put(x, y, 'c')
    for (x, y) in [(27, 18), (29, 17), (25, 19), (33, 10), (16, 22)]:
        put(x, y, 'r')
    # a vent stack and the base of the antenna mast
    for y in range(9, 13):
        put(37, y, 'c')

    return r, {
        'spawns': [(15, 9), (26, 9), (42, 9), (15, 29), (26, 29), (42, 29),
                   (14, 19), (43, 19)],
        'wallbuys': [],
        'box': [(20, 25)],
        'crates': [],
        'lamps': [],
        # one-per-run cache: worth the climb
        'cache': [(28, 17), (27, 18), (30, 17)],
    }


UPPER, UPPER_OBJ = build_upper()
ROOF, ROOF_OBJ = build_roof()

# vertical links. `a`/`b` are [floor, x, y]; same coordinates on both sides
# so "up" really means "up".
LEVEL_LINKS = [
    {'a': [0, 14, 11], 'b': [1, 14, 11], 'kind': 'stair', 'name': 'WEST STAIR'},
    {'a': [0, 42, 27], 'b': [1, 42, 27], 'kind': 'stair', 'name': 'EAST STAIR'},
    {'a': [1, 26, 15], 'b': [2, 26, 15], 'kind': 'ladder', 'name': 'ATTIC LADDER'},
]

FLOORS = [
    {'key': 'ground', 'name': 'GROUND FLOOR', 'short': 'G', 'grid': g,
     'obj': {'spawns': SPAWN_POINTS, 'wallbuys': [list(wb) for wb in WALL_BUYS],
             'box': [list(b) for b in BOX_SPOTS], 'crates': [list(c) for c in GRENADE_CRATES],
             'lamps': None, 'cache': []}},
    {'key': 'upper', 'name': 'SECOND FLOOR', 'short': '2', 'grid': UPPER, 'obj': UPPER_OBJ},
    {'key': 'roof', 'name': 'ATTIC & ROOF', 'short': '3', 'grid': ROOF, 'obj': ROOF_OBJ},
]

# ------------------------------------------------------------- validation ---
def walkable_tiles(grid, legend_solid, start=None):
    seen = set()
    start = start or PLAYER_START
    stack = [start]
    seen.add(start)
    while stack:
        x, y = stack.pop()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if not (0 <= nx < W and 0 <= ny < H):
                continue
            if (nx, ny) in seen:
                continue
            if grid[ny][nx] in legend_solid:
                continue
            seen.add((nx, ny))
            stack.append((nx, ny))
    return seen


SOLIDISH = set('#TFV*c*~')
for f in FLOORS[1:]:
    grid = f['grid']
    # flood from the landing you actually arrive at
    entry = (LEVEL_LINKS[0]['b'][1], LEVEL_LINKS[0]['b'][2]) if f['key'] == 'upper' \
        else (LEVEL_LINKS[2]['b'][1], LEVEL_LINKS[2]['b'][2])
    reach = walkable_tiles(grid, SOLIDISH, start=entry)
    assert entry in reach, f"{f['key']}: stair landing {entry} is not walkable"
    for s in f['obj']['spawns']:
        t = tuple(s)
        assert t in reach, f"{f['key']}: spawn {t} is not a walkable tile"
    for wb in f['obj']['wallbuys']:
        assert (wb[0], wb[1]) in reach, f"{f['key']}: wall buy {wb[:2]} unreachable"
    for b in f['obj']['box']:
        assert tuple(b) in reach, f"{f['key']}: box spot {b} unreachable"
    if f['obj'].get('cache'):
        for c in f['obj']['cache']:
            assert tuple(c) in reach, f"{f['key']}: cache {c} unreachable"
    print(f"floor {f['key']}: {len(reach)} reachable tiles from {entry}")

# the ground-floor tiles the staircases land on must be walkable too
for lk in LEVEL_LINKS:
    for side in ('a', 'b'):
        fl, x, y = lk[side]
        ch = FLOORS[fl]['grid'][y][x]
        assert ch not in SOLIDISH, f"link {lk['name']} side {side} lands on '{ch}'"
print('vertical links validated')


# ================================================================ EMIT =======
here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, '..', 'src', 'mapData.js')
rows_js = ",\n  ".join('"%s"' % "".join(r) for r in g)


def pts(lst):
    return ",\n".join("  { x: %d, y: %d }" % p for p in lst)


def grid_js(grid):
    return ",\n    ".join('"%s"' % "".join(r) for r in grid)


def obj_js(obj):
    parts = []
    sp_js = ",\n".join("      { x: %d, y: %d }" % tuple(p) for p in obj['spawns'])
    parts.append("spawns: [" + (("\n" + sp_js + "\n    ]") if sp_js else "]"))
    wb_js = ",\n".join("      { x: %d, y: %d, wx: %d, wy: %d, weapon: '%s' }" % tuple(wb) for wb in obj['wallbuys'])
    parts.append("wallbuys: [" + (("\n" + wb_js + "\n    ]") if wb_js else "]"))
    box_js = ",\n".join("      { x: %d, y: %d }" % tuple(b) for b in obj['box'])
    parts.append("box: [" + (("\n" + box_js + "\n    ]") if box_js else "]"))
    cr_js = ",\n".join("      { x: %d, y: %d }" % tuple(c) for c in obj['crates'])
    parts.append("crates: [" + (("\n" + cr_js + "\n    ]") if cr_js else "]"))
    parts.append("lamps: [%s]" % ",".join("{ x: %d, y: %d }" % tuple(l) for l in (obj['lamps'] or [])))
    ca_js = ",\n".join("      { x: %d, y: %d }" % tuple(c) for c in (obj.get('cache') or []))
    parts.append("cache: [" + (("\n" + ca_js + "\n    ]") if ca_js else "]"))
    return ",\n    ".join(parts)


FLOORS_JS = ",\n".join(
    "  {\n    key: '%s',\n    name: '%s',\n    short: '%s',\n    rows: [\n    %s\n    ],\n"
    "    objects: {\n    %s\n    },\n  }"
    % (f['key'], f['name'], f['short'], grid_js(f['grid']), obj_js(f['obj']))
    for f in FLOORS
)

LINKS_JS = ",\n".join(
    "  { a: { floor: %d, x: %d, y: %d }, b: { floor: %d, x: %d, y: %d }, kind: '%s', name: '%s' }"
    % (lk['a'][0], lk['a'][1], lk['a'][2], lk['b'][0], lk['b'][1], lk['b'][2], lk['kind'], lk['name'])
    for lk in LEVEL_LINKS
)

js = f'''// AUTO-GENERATED by tools/genmap.py -- do not edit by hand.
// Legend: ' ' exterior | '.' floor | '#' wall | 'W' window/barricade
//         'D' buyable door | 'c' crate (solid) | 'r' rubble (walkable)
//         'T' tree (solid) | 'F' fence (solid, bullets pass) | 'V' vehicle (solid)
//         'S' stairwell tile | '*' bricked-up secret door | '@' player start
//         'R' roof deck (walkable) | '~' void -- open air, solid
//
// Three storeys share one 72x50 grid. FLOORS[0] is the ground; the upper
// floors reuse the same coordinates so "upstairs" is literally above you.

export const MAP_W = {W};
export const MAP_H = {H};

export const MAP_ROWS = [
  {rows_js}
];

export const PLAYER_START = {{ x: {PLAYER_START[0]}, y: {PLAYER_START[1]} }};

export const SPAWN_POINTS = [
{pts(SPAWN_POINTS)}
];

// [standX, standY, wallX, wallY, weaponId]
export const WALL_BUYS = [
{",".join(chr(10) + "  { x: %d, y: %d, wx: %d, wy: %d, weapon: '%s' }" % wb for wb in WALL_BUYS)}
];

export const GRENADE_CRATES = [
{pts(GRENADE_CRATES)}
];

// [perkId, tileX, tileY]
export const PERK_SPOTS = [
{",".join(chr(10) + "  { id: '%s', x: %d, y: %d }" % p for p in PERKS)}
];

export const BOX_SPOTS = [
{pts(BOX_SPOTS)}
];

// stairwell teleport pairs
export const STAIRS = [
{",".join(chr(10) + "  { ax: %d, ay: %d, bx: %d, by: %d, dir: '%s' }" % (s['a'][0], s['a'][1], s['b'][0], s['b'][1], s['name']) for s in STAIRS)}
];

export const POWER_SWITCH = {{ x: {POWER_SWITCH[0]}, y: {POWER_SWITCH[1]} }};
export const WORKBENCH = {{ x: {WORKBENCH[0]}, y: {WORKBENCH[1]} }};
export const PAP_SPOT = {{ x: {PAP_SPOT[0]}, y: {PAP_SPOT[1]} }};

export const SECRET_SWITCHES = [
{pts(SECRET_SWITCHES)}
];

export const SECRET_DOOR = {{ x: {SECRET_DOOR[0]}, y: {SECRET_DOOR[1]} }};

export const SECRET_LOOT = [
{pts(SECRET_LOOT)}
];

// door prices keyed by "x,y"
export const DOOR_PRICES = {{
{",".join(chr(10) + "  '%d,%d': %d" % d for d in DOORS)},
  '28,22': 500
}};

// ---------------------------------------------------------------- storeys ---
export const FLOORS = [
{FLOORS_JS}
];

// vertical links: 'a' and 'b' share tile coordinates on purpose
export const LEVEL_LINKS = [
{LINKS_JS}
];
'''

with open(out, 'w') as f:
    f.write(js)
print('wrote', os.path.abspath(out))
