# Nacht der Untoten — top-down CoD zombies

A 2D top-down survival wave shooter in the spirit of the very first *Call of Duty: World at War*
zombies map, **Nacht der Untoten**. Hand-written vanilla JavaScript + HTML5 Canvas — no build
step, no dependencies, no asset files (all pixel art and all sound are generated in code).

> **Кратко по-русски.** 2D-игра с видом сверху в стиле режима «Zombies» из Call of Duty
> (первая карта Nacht der Untoten). 15 видов оружия, 8 перков, Mystery Box с wonder-оружием,
> пауэр-апы, 26 типов врагов (тотемы, могилы, призраки с саблей, снеговик, рыцарь, молнии),
> погода с грозой и туманом, говорящий громкоговоритель, генератор электричества, верстак с крафтом, пасхальное яйцо,
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

## Multiplayer over the local network

The bundled server doubles as a relay, so co-op needs no extra software:

```bash
node server.mjs 8080
# it prints the addresses it is listening on, e.g.
#   on your network:  http://192.168.1.5:8080/   (multiplayer ready)
```

1. Whoever runs the server picks **MULTIPLAYER → HOST A GAME** and starts playing.
2. Everybody else — laptops, phones, tablets on the same wi-fi — opens that address
   and picks **MULTIPLAYER → JOIN A GAME**, then the room.
3. **You can join mid-round.** Latecomers are dropped in next to the host with 500
   points and whatever the round has left to throw at them.

Up to four players. The host simulates the world and the rest draw snapshots of it
20 times a second, so a phone makes a perfectly good second player. Going down is
not going out: a downed player crawls for 32 s and any team-mate can stand over
them and hold `F` for 1.3 s. Points are per player, rounds are shared, and the
horde grows by 32 % for every extra body in the building. If the host quits, the
relay hands the room to the longest-standing guest.

Joining is watched from the guest's side: it asks the host in, retries once after
2.5 s if the welcome never comes, and after 9 s says **HOST DID NOT LET YOU IN**
plainly and returns to the room list instead of spinning forever. A repeated ask
makes the host resend the welcome, never build a second body. And everything the
snapshot carries — grenades, power-ups, monkey bombs, fires, rifts, gas — is
rebuilt on the guest into the exact shape its renderer reads: one wrong shape off
the wire is not a cosmetic bug, it is a frozen picture.

## Phone / touch controls

On any touch screen the panel appears by itself (`SETTINGS → ON-SCREEN CONTROLS`,
`AUTO` by default): a stick to walk with on the left, a stick to aim with and the
FIRE / F / R / Q / sprint / frag / medkit / knife buttons on the right, plus a
pause button in the corner. A tap anywhere else reaches the game underneath, so
the menus work with a thumb. `AIM ASSIST` points the barrel at the nearest walker
while you are not touching the aim stick.

## Controls

| Input | Action |
| --- | --- |
| `WASD` / arrows | Move |
| `Shift` | Sprint |
| Mouse | Aim |
| Left click | Fire (hold for automatic weapons) |
| `R` | Reload |
| `1` / `2` | Pick a carried weapon slot |
| `Q` | Flip between your two carried guns (0.35 s) |
| wheel / `[` `]` | Dig through the whole armoury (0.9 s swap) |
| `E` | … · **arm a trap** · pack-a-punch the gun in your hands |
| `V` | Knife — short range, big points, never runs out |
| `G` | Throw a frag grenade |
| `H` | Use a medkit |
| `E` | Buy weapon / ammo · open a door · drink a perk · spin the box · throw the power switch · open the workbench · arm a trap · pack-a-punch · **hold** to rebuild a barricade |
| `M` | Mute · `P` / `Esc` pause (also on the touch panel) · `R` restart after death |
| `F` | Same as `E` — and how you revive a downed team-mate in co-op |

## The map (72 × 50 tiles)

**Three storeys, one building.** The bunker has a second floor and an attic that opens onto the
roof; all three share the same 72 × 50 grid and are stitched together by vertical links that
share tile coordinates, so "up" is literally above you:

| Link | Connects |
| --- | --- |
| West stair | ground (18,11) ↔ second floor (18,11) |
| East stair | ground (41,15) ↔ second floor (41,15) |
| Attic ladder | second floor (26,15) ↔ attic & roof (26,15) |

Walk onto a link to climb. The horde follows: every storey keeps its own flow field, so zombies
on another floor walk to the staircase that leads towards you, climb it, and carry on hunting.
From round 8 some of them spawn upstairs, from round 13 some on the roof. Each storey hides its
own **supply cache**. The open air around the upper footprints is solid `VOID` (painted as night
sky) — fall off the parapet and there is nothing there.

The second floor is not the ground plan again. Downstairs is a four-room cross filling the whole
bunker; upstairs is an **L** — a north range with a corridor down the middle and cubicles off it,
plus a south-west leg — because the south-east corner of the floor caved in years ago. It is also
built differently: laid boards underfoot and stud-and-plaster partitions, against the concrete
and brick downstairs. Same building, unmistakably another floor.

One big level instead of a second map:

- **Bunker** — four rooms (A/B up, C/D down) split by a central cross-wall, 20 barricaded
  windows, six buyable doors including two that let you **walk outside**.
- **Radio room** (north-east) — reached by a stairwell from room B. Holds the **Pack-a-Punch**.
- **Shed** (east) — tools and sandbags; the workbench it used to hold moved upstairs.
- **Roof** — the **workbench** stands on the open deck: anything you want built,
  you carry the scrap up three storeys for.
- **Cellar** (south-west) — holds the **power switch**; reached by a stairwell from room C.- **Secret vault** — behind a bricked-up arch in the east wall, only opens after the easter egg.
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

**Workbench.** Kills drop **scrap**, and the bench on the roof spends it. On the bench today:
**Medkit** (8 scrap, +55 HP, up to three carried), **Armour Plate** (14 scrap + 1500 points,
absorbs the next 60 damage, up to 120) and **Steel Shutters** (30 scrap + 2500 points, once per
house: every window on every floor takes two more planks — the cap itself rises, and the boards
come with it). The original six recipes were flat vending-machine buttons with nothing behind
them; they were rewritten onto a new recipe contract, and the four not on the bench yet (Plank
Bundle, Frag Bundle, Ammo Crate, Barricade Spikes) live in `src/crafting.js` as
`SHELVED_RECIPES` — hanging one back on is one line. Every recipe owes the bench a `useful()`
check: a purchase that would change nothing is refused with the reason on the row, so nobody
ever pays for air again. In co-op every body has its own bench and its own purse; a guest
builds with its own scrap over the wire, and house-wide buys (the shutters) are shared — the
deepened caps ride along in the snapshot, so a guest who joins later sees them too.

**Pack-a-Punch.** 5000 points, needs the generator on, one upgrade per weapon per run. It more
than doubles the damage (×2.2), gives +50 % magazine, double the reserve ammo, an extra point of
penetration, a tighter spread and green tracers — and renames the gun the way CoD always has:
M1911 → *Mustang & Sally*, MP40 → *Afterburner*, Ray Gun → *Porter's X2 Ray Gun*. Held weapons
carry the upgrade, so both of your slots keep their own state.

**Two carried slots.** You carry two guns, not a backpack full of fifteen. `1` / `2` pick one,
`Q` flips between them in a third of a second. The wheel and `[` / `]` still reach everything you
own, but digging through the armoury costs a slow 0.9 s swap — so the choice of what you carry
actually matters.

**Traps.** 500 points arms one for 8 seconds, then it recharges for 22–26.
*Flame Trap* on the ledge under room C's south windows (115 dps + afterburn), *Electric Barrier*
under room A's north windows (80 dps, shocks them rigid) and a *Steam Vent* at the mouth of the
room B → D doorway (75 dps, scalds, slows and shoves them back out through the door). Only ever
hurts zombies — and 15 trap kills in one run is an achievement.

**Enemies — 26 types.** Walkers, **Runners** (fast, frail, round 6), **Brutes** (2.7× HP, smashes
three planks at a time, round 10), **Crawlers**, **Shriekers** (rally scream, round 12),
**Hellhounds** (every fifth round is a dog round), **Helmeted**, **Napalm**, **Gasbags**,
**Miners** (come up through the floor), **Mimics**, **Field Medics**, **Bonewrights**,
**Swarmlings**, **Jammers**, and **Amalgams**.

The haunt roster arrives from round 12 up: **Snowmen** lob snowballs (badly — on purpose) that
chill your legs for three seconds, and roll double in a storm; **Arsonists** throw fire bottles
that break into burning pools; **Witches** throw potion bottles that burst into gas; a **Totem
Bearer** kneels once per life and raises a totem you can shoot down — while it hums, the map
sinks into a purple dusk and the whole horde gets faster, bolder and hungrier for planks; a
**Mourner** digs a grave that rings a bell every few seconds and lets out half-seen **Wraiths**
with a sabre of cold light (they fade when the grave is broken, and they never count towards the
round); **Shockers** gather for three quarters of a second and throw lightning along their line
of sight — it hurts, and for a moment your legs and your trigger both forget how to work; and
the **Knight** walks in from round 20: big, slow, 3.6× HP, body shots ring off its plate for
half damage, and the head is the only honest way in.

**Weather.** From round 3 every round rolls the sky: a storm (slanted rain across the glass,
lightning flashes with late thunder, the screen stays wet and dries slowly, snowmen come twice
as often), fog (a veil with a hole of visibility around you), or nothing.

**The loudspeaker.** From round 10 somebody talks — lines tied to events, not timers: a first
sighting of a new horror, a totem rising, a grave being dug, a storm rolling in, a door you are
about to buy ("that one leads nowhere good"). And at rounds 25/30/35 the voice is no longer the
loudspeaker: survivors outside the wire, a helicopter that wants thirty quiet minutes, and a
"look up" over the roof.

A blast does not always take the head — sometimes it takes the legs. Grenades, monkey bombs and
Ray Gun splashes will drop a zombie onto its elbows instead: a **Crawler** keeps coming at 70 %
speed with a third of its health and a much smaller silhouette, so it is easy to miss and annoying
to leave alive. Worth more points for the trouble.

From round 12 the horde starts including **Shriekers**: pale wretches that hang back at their own
preferred distance and scream. The scream rings out in a visible purple wave and *rallies*
everything in earshot — +35 % speed and +25 % damage for five seconds. They never close on you,
which is exactly the problem: leave them alone and the whole horde stays angry.

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
  crafting.js       the workbench: recipe contract, three shipped recipes, four shelved
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
everything is reachable from the player start, the roof bench included) and rewrites `src/mapData.js`.

> **Before you run it:** `src/mapData.js` has drifted from the generator. The traps, the
> hand-placed second-floor lamps, the extra box spots upstairs and a few upper-floor doors
> were edited into the emitted file directly, so regenerating today drops them and the game
> loses its flame trap, its electric barrier, its steam vent and half the barracks lighting.
> Port those tables into `genmap.py` first (the warning at the top of the file lists them),
> or diff and keep them: `git diff src/mapData.js` right after a run is the check.

## Roadmap

See [`docs/IDEAS.md`](docs/IDEAS.md) — it tracks what is already in (items 1–7 plus the
Pack-a-Punch / two-slot / trap / Crawler / Shrieker batch, the helmet / napalm / gas zombies, the
second floor and the roof, settings and the last-zombie sound) and carries a large fresh backlog:
wearable gizmos, a second crafting bench, teleporters and rooftop escapes, a story told through a
keeper's diary and radio chatter, a full rooftop evacuation finale, weapon mods, daily challenges,
gamepad support and proper smoke tests.
