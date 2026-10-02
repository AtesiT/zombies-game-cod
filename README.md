# Nacht der Untoten — top-down CoD zombies

A 2D top-down survival wave shooter in the spirit of the very first *Call of Duty: World at War*
zombies map, **Nacht der Untoten**. Hand-written vanilla JavaScript + HTML5 Canvas — no build
step, no dependencies, no asset files (all pixel art and all sound are generated in code).

> **Кратко по-русски.** 2D-игра с видом сверху в стиле режима «Zombies» из Call of Duty
> (первая карта Nacht der Untoten). 15 видов оружия, 8 перков, Mystery Box с wonder-оружием,
> пауэр-апы, четыре типа врагов, генератор электричества, верстак с крафтом, пасхальное яйцо,
> достижения и таблица рекордов. Вся графика — процедурный пиксель-арт, весь звук — синтез
> через WebAudio, сборка не нужна.
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
| `Shift` | Sprint |
| Mouse | Aim |
| Left click | Fire (hold for automatic weapons) |
| `R` | Reload |
| `1`–`0` / wheel / `[` `]` | Swap weapon (slots follow your owned list) |
| `V` | Knife — short range, big points, never runs out |
| `G` | Throw a frag grenade |
| `H` | Use a medkit |
| `E` | Buy weapon / ammo · open a door · drink a perk · spin the box · throw the power switch · open the workbench · **hold** to rebuild a barricade |
| `M` | Mute · `P` / `Esc` pause · `R` restart after death |

## The map (72 × 50 tiles)

One big level instead of a second map:

- **Bunker** — four rooms (A/B up, C/D down) split by a central cross-wall, 20 barricaded
  windows, six buyable doors including two that let you **walk outside**.
- **Radio room** (north-east) — reached by a stairwell from room B.
- **Shed** (east) — holds the **workbench**.
- **Cellar** (south-west) — holds the **power switch**; reached by a stairwell from room C.
- **Secret vault** — behind a bricked-up arch in the east wall, only opens after the easter egg.
- **Outside** — forest belts, copses, picket fences, a wrecked truck, an open field to the south.
  You can leave the bunker and fight in the open; zombies spawn out here and path in.

Stairwells are real portals: step on the tile, walk to its centre, and you pop out at the other
end (the flow field charges a small cost for it, so zombies use them too).

## Mechanics

**Power.** Until you throw the switch in the cellar, the bunker is dark, perk machines are dead
and the Mystery Box will not open. The generator turns on 20 ceiling lamps, every machine glow
and the vault light.

**Perks.** Eight machines, six per run:
Juggernog (×2 health) · Speed Cola (½ reload) · Double Tap (−33 % shot delay) ·
Quick Revive (faster regen) · Stamin-Up (+25 % speed, sprint) · PhD Flopper (immune to your own
explosions) · Deadshot Daiquiri (aim drifts to the head) · Widow's Wine (knife and frags leave
slowing webs).

**Mystery Box.** 950 points, five possible locations, spins for ~2.6 s, offers the weapon for
6.5 s. Pull too many times and the teddy bear steals it — the box relocates. Fire Sale moves it
and drops the price to 10.

**Wonder weapons** (box only): Ray Gun (plasma splash) · Wunderwaffe DG-2 (chains to four
targets) · Thunder Gun (a cone that throws a whole hallway away) · Winter's Howl (freezes a
cluster solid) · Monkey Bomb (wind it up, throw it, watch the horde pile on, then leave).

**Wall buys.** M1911 (start) · MP40 · Thompson · M1897 Trench Gun · PPSh-41 · Kar98k · FG 42 ·
M1918 BAR · MG 42 · PTRS-41. Ammo costs a fraction of the gun.

**Workbench.** Kills drop **scrap**. Spend it at the shed: Medkit (+55 HP, stackable, `H`),
Plank Bundle (two planks on every window at once), Frag Bundle, Ammo Crate (refills everything),
Armour Plate (+60 absorb), Barricade Spikes (windows bite back for three rounds).

**Enemies.** Walkers, **Runners** (fast, frail, from round 6), **Brutes** (2.7× HP, smashes three
planks at a time, from round 10) and **Hellhounds**. Every fifth round is a dog round.

**Power-ups.** Max Ammo · Insta-Kill · Double Points · Nuke · Carpenter · Fire Sale ·
Death Machine. Dropped roughly every 22–34 kills.

**Easter egg.** Four hidden dials are scattered across the map. Turn them all in one run and the
radio starts transmitting — when the broadcast ends, a wall gives way.

**Rounds.** `6 + round × 3.5` zombies (dog rounds: `10 + 1.6·round`), up to ~34 alive.
HP `120 + 46·(round−1)` capped at 2600, speed ramps 44 → 88 px/s. Six seconds between rounds.

**Points.** +10 per hit, +60 per kill, +40 extra for a headshot, +130 for a knife kill, +10 per
plank. Repairing barricades pays *you* — that is the authentic CoD safety net.

**Health.** 100 HP (200 with Juggernog), 34 damage per swipe → three hits. Regen 30 HP/s after
5 s without damage (2.4 s / 58 HP/s with Quick Revive).

## Look & sound

- Pixel art is ASCII + palette (`src/spriteData.js`) baked into canvases at load (`src/art.js`).
  Gun sprites are generated parametrically from a spec table, so all fifteen stay consistent.
  Tiles are painted procedurally with a seeded RNG into one big offscreen canvas → a single
  `drawImage` per frame.
- Lighting is a half-resolution darkness layer with holes punched out per light: flickering
  ceiling lamps, a torch cone, muzzle flashes, explosions, cold moonlight through broken
  windows, coloured glow from every perk machine. Radial masks are baked once and blitted, not
  rebuilt per frame.
- Weather: a wind field drives drifting leaves across the whole map.
- Deliberately **not** oppressively dark — the night is moody but readable (≈5 % near-black
  pixels in lit areas). Ambient level lives in `src/lighting.js`.
- Every sound is synthesised at runtime with WebAudio: gunshots per weapon class, wonder-weapon
  voices, reload clicks, growls, dog howls, the generator spooling up, the box rumble, the
  easter-egg broadcast, plank knocks, the round-start sting and a wind bed.

## Layout

```
index.html          shell + canvas
styles.css          crisp upscaling, letterboxing
server.mjs          zero-dependency dev server
src/
  main.js           boot, fixed-step loop, integer-ish canvas upscaling
  game.js           rounds, spawning, interactions, camera, frame renderer
  map.js            tile grid, collision, stairwell portals, dijkstra flow field
  mapData.js        AUTO-GENERATED level layout (see tools/genmap.py)
  entities.js       player, zombies (4 archetypes), grenades, monkey bombs, particles
  weapons.js        the 15-weapon table + Mystery Box roll
  perks.js          perk definitions and derived stat effects
  powerups.js       power-up table, drop roll, floating pickup
  mysterybox.js     the box: spin, teddy bear, relocation, fire sale
  crafting.js       workbench recipes
  achievements.js   achievements, localStorage leaderboard, easter-egg state machine
  art.js            sprite baking, parametric gun builder, procedural level painting
  spriteData.js     ASCII pixel art + palette (pure data)
  lighting.js       baked-mask darkness layer + vignette
  hud.js            HUD, cached minimap, craft menu, banners, title / pause / game-over
  audio.js          procedural WebAudio SFX
  input.js          keyboard + mouse
  util.js           maths, RNG, min-heap
tools/
  genmap.py         regenerates src/mapData.js from a room spec
  preview.mjs       renders the ASCII sprites to a PNG sheet (node, no deps)
```

## Tuning

- `src/game.js` → `roundPlan()` (counts, HP, speed, spawn rate), `POINTS_*`, `LAMPS`,
  `DOG_ROUND_EVERY`, `SALVAGE_DROP`, intermission length.
- `src/weapons.js` → the whole weapon table (damage, mag, delay, spread, pierce, specials).
- `src/entities.js` → `Player` (speed, HP, regen), `Zombie`, `ENEMY_TYPES` (archetype multipliers).
- `src/perks.js` → prices and `perkEffects()`.
- `src/crafting.js` → `RECIPES`.
- `src/lighting.js` → ambient darkness.

To change the level, edit the room/window/door/object tables at the top of `tools/genmap.py` and
run `python3 tools/genmap.py` — it validates connectivity (nothing solid spawns inside a wall,
everything is reachable from the player start) and rewrites `src/mapData.js`.

## Roadmap

See [`docs/IDEAS.md`](docs/IDEAS.md) — it tracks what is already in (items 1–7) and carries a
fresh list of proposals: Pack-a-Punch, crawlers and helmet zombies, breakable crates, traps, a
roof, daily challenges, gamepad support and proper smoke tests.
