# Nacht der Untoten — top-down CoD zombies

A 2D top-down survival wave shooter in the spirit of the very first *Call of Duty: World at War*
zombies map, **Nacht der Untoten**. Hand-written vanilla JavaScript + HTML5 Canvas — no build
step, no dependencies, no asset files (all pixel art and all sound are generated in code).

> **Кратко по-русски.** 2D-игра с видом сверху в стиле режима «Zombies» из Call of Duty
> (первая карта Nacht der Untoten). Волны зомби, очки за попадания/убийства, покупка оружия
> со стен, починка баррикад, двери за очки, здоровье с регенерацией, HUD. Вся графика —
> процедурный пиксель-арт, весь звук — синтез через WebAudio, сборка не нужна.
> Запуск: `python3 -m http.server 8080` или `node server.mjs`, затем открыть `http://localhost:8080/`.

---

## Run it

```bash
# any static file server works; the game is plain ES modules
python3 -m http.server 8080          # or:  node server.mjs 8080
# open http://localhost:8080/
```

Nothing to install, nothing to compile. (A server is required because the game uses
ES modules — opening `index.html` from `file://` will not work.)

## Controls

| Input | Action |
| --- | --- |
| `WASD` / arrows | Move |
| Mouse | Aim |
| Left click | Fire (hold for automatic weapons) |
| `R` | Reload |
| `1`–`5` / mouse wheel | Swap weapon |
| `V` | Knife — short range, **130 points** per kill, never runs out |
| `G` | Throw a frag grenade |
| `E` | Buy weapon / ammo · open a door · **hold** to rebuild a barricade |
| `M` | Mute · `P` / `Esc` pause · `R` restart after death |

## Mechanics

**Rounds.** Each round spawns `6 + round × 3.5` zombies, up to ~34 of them alive at once.
Zombies get tougher and faster every round (`hp = 120 + 46·(round−1)`, capped at 2600;
speed ramps from 44 to 88 px/s). Six seconds of breathing room between rounds.

**Spawning & pathing.** Zombies appear in the yard *outside* the bunker and walk to you.
Every 0.22 s the level rebuilds a Dijkstra flow field toward the player, where floor costs 1,
a boarded window costs 40 and a locked door costs 60 — so the horde prefers to run around the
building and break in through *your* windows rather than queue at a door. A zombie that
genuinely cannot reach you claws at the obstacle for 7 s and then despawns and re-enters
elsewhere (exactly like the real game), so the round can never soft-lock.

**Points.** +10 per bullet that connects, +60 per kill, +40 extra for a headshot, +130 for a
knife kill, +10 per plank you nail back onto a barricade. Repairing barricades is *free* and
*pays* you — that is the authentic CoD economy and your safety net when you run dry.

**Weapons.** M1911 (start, and an ammo wall-buy in the spawn room), MP40 (1000), Thompson
(1200), M1897 Trench Gun (1200), Kar98k (1500, penetrates 3 zombies). Buying ammo costs half
the weapon price. Frag grenades are 250 for a set of four.

**Health.** 100 HP, 34 damage per zombie swipe → **three hits** before you go down. Health
regenerates at 30 HP/s but only after **5 seconds** without taking damage, so chip damage
matters. Low health brings a red vignette and a heartbeat.

**The map.** A four-room bunker (rooms A/B up top, C/D below) ringed by a dark yard.
All four interior doors are bought with points and are indestructible — the windows are not.
16 barricaded windows, 18 zombie spawn points, 5 wall-buys, 2 grenade crates. There is a
minimap in the top-right corner with fog-of-war.

## Look & sound

- Pixel art is defined as ASCII + palette in `src/spriteData.js` and baked into canvases at
  load time (`src/art.js`). Tiles (concrete, brick, dirt, crates) are painted procedurally with
  a seeded RNG into one big offscreen canvas, so the level costs a single `drawImage` per frame.
- Lighting is a half-resolution darkness layer with holes punched out per light: flickering
  ceiling lamps, a torch cone in your aim direction, muzzle flashes, explosions and cold
  moonlight bleeding through broken windows. Zombie eyes have a faint additive glow.
- Every sound is synthesised at runtime with WebAudio oscillators + filtered noise — gunshots,
  reload clicks, growls, gore impacts, plank knocks, the round-start sting and a wind bed.

## Layout

```
index.html          shell + canvas
styles.css          crisp upscaling, letterboxing
server.mjs          zero-dependency dev server
src/
  main.js           boot, fixed-step loop, integer-ish canvas upscaling
  game.js           rounds, spawning, interactions, camera, frame renderer
  map.js            tile grid, collision, dijkstra flow field, barricades, doors
  mapData.js        AUTO-GENERATED level layout (see tools/genmap.py)
  entities.js       player, zombies, grenades, particles, score popups
  weapons.js        weapon table
  art.js            sprite baking + procedural level painting
  spriteData.js     ASCII pixel art + palette (pure data)
  lighting.js       darkness layer + vignette
  hud.js            HUD, minimap, banners, title / pause / game-over screens
  audio.js          procedural WebAudio SFX
  input.js          keyboard + mouse
  util.js           maths, RNG, min-heap
tools/
  genmap.py         regenerates src/mapData.js from a room spec
  preview.mjs       renders the ASCII sprites to a PNG sheet (node, no deps)
```

## Tuning

Most balance numbers live in one place:

- `src/game.js` → `roundPlan()` (counts, HP, speed, spawn rate), `POINTS_*` constants,
  `LAMPS` (light positions), intermission length.
- `src/entities.js` → `Player` (speed, HP, regen delay/rate, knife reach & damage),
  `Zombie` (attack range/cooldown, separation, stuck timeout).
- `src/art.js` → tile colours, `T` (tile size).
- `src/lighting.js` → ambient darkness level.

To change the level, edit the room/window/door tables at the top of `tools/genmap.py` and run
`python3 tools/genmap.py` — it validates connectivity and rewrites `src/mapData.js`.

## Roadmap

See [`docs/IDEAS.md`](docs/IDEAS.md) for a long list of ideas to push the gameplay and the
atmosphere further (perks, Mystery Box, new enemy types, map expansion, secrets, …).
