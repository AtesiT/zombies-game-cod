# Map, vehicle and environment documentation (Phases 1–3)

## Playing

Run `npm start`, open port 8080, choose **SOLO**, then a map. Mouse/touch selects a row; arrows/W/S and Enter/Space use the existing canvas menu. Escape/Back returns to the front menu. Nacht and the test range remain available. Terminal Transit now includes its drivable armored bus and stations. Neon Night Market and Blackwood Logging Camp now include their environmental mechanics and raised escape positions.

Registry fetch is lazy on first opening SOLO. Failed loads show an error and retry entry; the original campaign remains playable offline. Refresh starts a fresh session; selection is deliberately not persisted. R restarts using the selected configuration. Multiplayer stays on Nacht until custom dynamic state synchronization is implemented.

## Adding a map without code changes

Add an entry to `assets/maps/registry.json` (`version: 1`) and add its referenced assets. Required strings: `id` (unique), `name`, `scene` (`tile-grid`), `music`, `background`, `thumbnail`, `description`. `mechanics` contains descriptors (currently informational, not a runtime mechanic implementation).

`level.rows` is 50 strings of 72 characters. Supported Phase 1 tiles: `.`/`@` floor, space exterior, `#` wall, `c` crate, `r` rubble, `T` tree, `F` fence, `V` static vehicle. Doors (`D`) and windows (`W`) require matching `level.doors` and `level.barricades` entries (see Phase 2 schema below). `level.start` and nonempty `level.spawns` contain integer `{x,y}` walkable tile coordinates inside the boundary. Keep all spawn points reachable from the player. Use enclosing boundary walls. Tile size is 24 world pixels. Layouts are deliberately fixed-size to preserve the existing renderer/collision pipeline.

Music/background/thumbnail references are catalog metadata in this phase; the existing procedural ambient soundtrack and renderer remain in use. SVG thumbnail assets are provided, but the canvas selector currently displays names/descriptions rather than image cards.

## Public modules

- `MapManager extends EventBus`: `load(url?, fetcher?)` validates an entire registry atomically and returns success; request generations prevent stale fetch completion from overwriting newer state. `maps`, `status`, `error`, `current` are exposed. `get(id)` throws on an unknown id; `select(id|null)` publishes `map:loaded`. `dispose()` invalidates loads and removes subscriptions.
- Events: `status` (loading), `ready` (definitions), `error` (message), `map:loaded` (selected definition or null). Subscribe with `on(type, callback)`; call the returned unsubscribe function when releasing a consumer. Read `status` for the latest terminal load state.
- `validateRegistry(data)` checks version, metadata, duplicate IDs, supported layout symbols/dimensions and start/spawn tile validity. It does not certify arbitrary layout reachability.
- `mapSelectionRows(manager)` adapts catalog state to the existing canvas menu/hit-testing pipeline.
- `Game.playMap(id)` constructs the configured GameMap, resets session state, commits the manager selection and starts wave one. `GameMap(mode, definition?)` retains its original defaults without a definition.
- Console: `GAME.mapManager.current`, `GAME.mapManager.maps`; after opening SOLO, `GAME.playMap('terminal-transit')` starts that map.

## Tests

```sh
npm install --prefix tools/harness --ignore-scripts
node --test tests/maps.test.mjs
node tools/harness/boot.mjs
node tools/harness/frontmenu.mjs
node tools/harness/menu.mjs
node tools/harness/range.mjs
```

Node canvas integration checks all three maps via menu input, powered rendering without machines, zombie spawning and restart. It is not a substitute for browser GPU/memory profiling.

## Phase 2: Terminal Transit / armored bus

### Controls and balance

- Walk to the orange driver-side door at the front right of the bus; **E** enters. The player starts beside it.
- **W/S** accelerate forward/reverse; **A/D** steer. Arrow keys also work. **Space** brakes with extra slip. Heading and velocity remain independent so turns visibly drift. The existing touch stick drives/steers; touch interaction enters/exits (desktop Space and Shift are the primary brake/service controls).
- **E** exits only below 35 px/s and only if a tested landing is clear. Destroyed buses attempt an emergency exit. Weapons/grenades and ordinary world interactions are suppressed while driving; an intact bus shields the driver.
- Camera damped-follow gains a velocity-based look-ahead. HUD displays HP, fuel, speed and controls while driving. Bus/service icons appear in explored minimap areas.
- Bus: 2,000 HP, 100 fuel units, 250 px/s max forward, 100 reverse. Idle/driving consumes fuel only while occupied. Empty fuel stops engine thrust, not inertia. Zero HP disables entry/thrust.
- Contact faster than 45 px/s instantly kills small zombies (radius ≤12, excluding brutes), damages heavier enemies, and applies velocity knockback. Normal kill rewards/wave bookkeeping apply. Slow contact attacks damage the bus every second; crushing also wears armor. Contact cooldowns prevent damage every physics substep.
- **Repair** (orange depot console, 500 points) restores HP; **refuel** (cyan console, 250) fills the tank. Stop within the outlined station's service range. While driving, **Shift+E** services; on foot, **E** within 40 px of its console services a nearby bus. Full service does not charge. If the bus is disabled/empty far from a station, continue on foot or restart; no towing is implemented.
- Two power consoles share the existing global power grid; either enables all three upgrade machines. Upgrade and wall-weapon prices/effects reuse the existing economy. Two purchasable doors and two rebuildable subway windows are configured.

### JSON schema extensions

All mechanics are activated by configuration, not map ID:

- `level.vehicle`: `{type:'armored-bus', x,y,angle,length,width,hp,fuel,acceleration,maxSpeed}`. Positions and body dimensions are **world pixels**, angle is radians. Physics defaults/balance are explicit in JSON; numeric bounds and initial footprint are validated.
- `level.stations`: `{type:'repair'|'refuel', x,y,radius,price}` in world pixels.
- `level.landmarks`: `{name,x,y}` in world pixels; generic floor labels.
- `level.powerSwitches`, `level.upgrades`, `level.boxSpots`: arrays of **tile** `{x,y}` coordinates.
- `level.wallBuys`: tile `{x,y,wx,wy,weapon}`; wx/wy identify wall mounting. Weapon IDs are validated against the existing table.
- `level.doors`: tile `{x,y,price,horizontal?}` matching each `D` glyph.
- `level.barricades`: tile `{x,y}` matching each `W` glyph; six repairable planks per window.

### Modules / lifecycle

`Bus` owns body geometry/state and drawing. `VehicleController.update(dt, controls, onStep?)` runs 120 Hz substeps inside the existing simulation step, sampling the full oriented body against static tiles/props. `VehicleInput` maps existing inputs. `BusController` owns safe entry/exit, damage, services, sound and effects, and is disposed on reset/map replacement. `VehicleAudio` reuses one oscillator/gain pair, adjusts pitch with speed, and disconnects on exit, pause, game over or disposal. Crush one-shots are throttled to 12.5 Hz.

`DynamicObstacle.update(body,map)` touches only a small bounding region and returns the old/new footprint symmetric difference. Rotation changes matter only when occupied cells actually change. `PathfindingManager` keeps the existing long-distance Dijkstra field and adds local A* detours near the footprint (14-tile search radius, ≤320 expansions per query, ≤1,200 total per simulation tick, ≤513 cached waypoints). It never triggers a full-field rebuild because the bus moved. Existing periodic target-driven flow refresh (0.22 s) remains unchanged. Budget exhaustion produces a hold waypoint, never a direct fallback through the bus. Footprint changes invalidate local detours; physical oriented-body collision remains authoritative. This is bounded local replanning, not a full LPA*/D* replacement.

New search nodes, contact cooldown records and vehicle impact particles use bounded `ObjectPool` instances; routes and references clear on disposal. Existing legacy zombie/projectile/general-particle allocation remains unchanged in this phase.

Events on `GAME.mapManager`: `vehicle:enter`, `vehicle:exit` (body), `vehicle:crush` (zombie), `vehicle:damage` (HP), `vehicle:service` (station). Existing map events remain unchanged.

### Debug / tests

`GAME.bus.body` exposes HP/fuel/velocity, `GAME.bus.navigation.expansions` exposes the current tick's bounded work. Start Terminal Transit first. Set HP/fuel directly for testing; production defaults still come from JSON.

```sh
node --test tests/*.test.mjs
node tools/harness/transit.mjs 60
```

The stress probe creates 100 walkers around an invulnerable stationary armored target, renders every simulated frame in Node software canvas and reports bounded navigation/cache/contact counts. It is a short integration/performance probe, not a ten-minute browser leak certification or a 60 FPS guarantee.

## Phase 3: Neon Night Market and Blackwood Logging Camp

### Playing Neon Night Market

- Narrow stall alleys surround the central relay district. Shoot the neon plates labeled RAMEN, ARCADE and RADIO: each takes 80–100 damage, visibly falls, then electrifies a 65–70 px radius for 24–30 seconds. Damage applies to player and zombies at 0.75-second intervals, using existing armor/damage/kill accounting. Hazards are friendly-fire areas; keep clear after shooting.
- Press **E** at a fire-escape ladder to climb. The deck visibly raises the player, constrains walking to the deck, and reduces weapon spread by **35%**. Ground zombies near the deck take four seconds to finish climbing and move slowly during that climb. They cannot melee the elevated player until they finish; ranged attacks are not blocked by elevation. Press **E** on the deck to descend.
- Main quest: break at least two signs, activate numbered relays **1 RAMEN → 2 ARCADE → 3 RADIO**, then press E at the central broadcast console. A wrong future relay resets the sequence. Stay within 90 px and defend for five seconds; leaving interrupts and requires restarting the broadcast. Completion grants 2,000 points, healing, and current-weapon ammo once per run.
- Power, an upgrade machine, a Mystery Box and wall weapons remain available through existing interactions.

### Playing Blackwood Logging Camp

- Forest dirt/grass and trees surround the lumber mill and log yard. Orange bear traps deal 45–60 damage and root either player or zombie for 2.5–3 seconds. A closed trap rearms after twelve seconds. Root stops movement/knockback but does not disable shooting. Ladder/zipline movement cannot bypass a root. Pausing freezes trap/root and hazard timers.
- Brown mud patches reduce ground player/zombie movement speed by **40%**. Base speed values are never overwritten; leaving restores normal speed. Raised decks are above the mud/traps.
- Shoot the labeled support beams (100 HP). After a 0.8-second animated fall, their logs become permanent collision and bullet-blocking cover for that run. Actors in the landing footprint take damage and are moved to the nearest tested clear center. Alternative routes remain available for configured spawns. Reset restores the original geometry.
- E climbs a lookout ladder. E at the raised anchor rides a **bidirectional 1.8-second zipline** to the other lookout. Walking/shooting are suspended during transit; the player is protected during the ride and lands elevated on a clear deck. Move away from the center anchor on a deck and press E to descend instead of taking the line again.
- The mill has a purchasable door, rebuildable windows, interior spawns and wall weapons; power, upgrades and a Mystery Box use existing systems.

### Data-driven environment schema

`level.environment` is an optional array (maximum 128 entries), using unique `id` strings and generic `type` values. All positions/dimensions below are **world pixels**, except support `cells`, which are tile coordinates. Adding these mechanics to another configured map needs JSON/assets only.

| Type | Required configuration |
| --- | --- |
| `neon-sign` | `x,y,name,color` (hex RGB), `radius,hp,fallSeconds,hazardRadius,damage` (DPS), `duration` |
| `support-beam` | `x,y,radius,hp,fallSeconds,damage`, nonempty `cells:[{x,y},…]` tile landing footprint |
| `bear-trap` | `x,y,radius,damage,rootSeconds,rearmSeconds` |
| `mud` | `x,y,width,height` rectangle (fixed gameplay multiplier 0.6) |
| `platform` | `x,y,name,width,height,entry:{x,y},climbSeconds`; entire deck and ladder landing must be clear |
| `zipline` | `from,to` platform IDs, `radius` for anchor use, `duration`; distinct valid endpoints |
| `relay-quest` | ordered `switches:[{name,x,y},…]`, `finale:{x,y}`, `requiredSigns,holdSeconds,defendRadius,reward,message` |

Validation rejects unknown types, duplicate IDs, out-of-range physics/damage values, invalid platform references and blocked platform landings. Authors must retain alternate routes around permanent cover; the supplied Logging Camp is tested after all supports fall. Arbitrary custom layouts are not automatically certified for connectivity.

### Public modules / lifecycle

- `EnvironmentManager` owns the active map's environment. `beforeUpdate(dt)` advances mechanics before movement; `afterUpdate(dt)` handles damage and deck constraints. `speedMultiplier(entity)` and `accuracyMultiplier(entity)` are compositional, not permanent stat edits. `interaction(player)`/`interact(player,action)` integrate with existing E prompts.
- `HazardSystem` pools timed zones and uses WeakMap root ownership; `rooted(entity)` is queryable. Electrical damage respects existing armor, immunity and debug god mode. New impact effects (64 max) and zones (32 max) are pooled.
- `ElevationSystem` owns deck/climb and line travel state in a WeakMap; `platform(entity)`, `isElevated`, `inTransit` and `canMelee` expose current status. This is pseudo-elevation on the shared map plane, not a new campaign storey. `Game` offsets raised sprites and suspends controls in transit.
- `DestructibleSystem.raycast(x,y,dx,dy,limit)` uses normalized ray directions and respects wall distance supplied by hitscan; targets stop non-piercing shots after any nearer zombie. `hit(item,damage)` is one-shot destruction; delayed falls resolve in `update`.
- `placeCover(cells,damage)` writes only changed tiles, clears local bus routes if present, and requests one normal target-field refresh; it does not repaint/rebuild a grid every frame. Fallen logs are drawn separately over the immutable cached base map.
- `RelayQuest` handles ordered switches and its one-shot timed reward. `EnvironmentRenderer` caches up to 256 text sprites; electrical arc sprites cache up to eight radii; all caches dispose on map replacement. Lights reuse existing baked layers and a bounded fixed RGB palette.
- Configured base-level cache keys now hash the map ID/layout, preventing different maps from sharing one painted level image. The existing six-entry static-level cache remains bounded.

Events on `GAME.mapManager`: `environment:destroyed` (ID), `environment:trap` (`{id,entity}`), `environment:elevation` (`{entity,platform}`), `environment:zipline` (ID), `environment:topology` (`{cells}`), `environment:quest-stage` (stage), `environment:quest-complete` (ID).

Console inspection: `GAME.environment.configs`, `.destructibles.items`, `.hazards.zones`, `.elevation.platform(GAME.player)`, `.quests`. For debug destruction: `GAME.environment.destructibles.hit(GAME.environment.destructibles.items[0], 10000)`.

```sh
node --test tests/*.test.mjs
node tools/harness/environment.mjs 15
# Probe rendering components without disabling their gameplay effects:
ABLATE_ENV=zones node tools/harness/environment.mjs 10
```

The probe keeps 100 walkers by replacing removed/dead ones, applies all sign/support destruction, checks finite coordinates and actual circle penetration against walls/cover, and reports update/draw work separately. It uses Node software Canvas without the real browser frame loop/governor; measurements cannot certify browser FPS, cross-browser behavior or retained memory over ten minutes.

## Phase 4 — Weather
- `WeatherManager` owns canonical clear/rain/fog/storm/snow states and smoothstep transitions (default 8 seconds, schema accepts 5–10). Active-game scheduling defaults to 180 seconds or every four waves. Pause/menu/game-over do not advance host weather.
- Map `level.weather` JSON: `initial`, `transitionSeconds`, `intervalSeconds`, `waveEvery`, `seed`, optional `openAreas` array of pixel rectangles `{x,y,width,height,floor}`. Current schema targets the existing 72×50 grid. Without rectangles, exterior/roof tiles with clear neighborhoods are outdoor strike candidates; selection has 32 attempts, not a grid scan. All three maps have explicit default schedules.
- Rain divides weapon spread by .85, multiplies vehicle drift by 1.10, and low-pass filters SFX/ambience (music volume/mute remain independent). Snow multiplies actor speed, vehicle acceleration/top speed by .75, composed with environment modifiers. Footprints are pooled, capped at 256, expire after eight seconds, and use four batched age bands.
- Fog uses .40 of baseline viewport-radius visibility and .70 spawn distance. Invalid, blocked, unreachable or visible adjusted spawns fall back safely. Actor/minimap visibility and the always-on fog veil share a radius.
- Storm chooses clear outdoor points, telegraphs a 48px strike radius for 1.2 seconds, deals 150 damage, then waits 8.8–18.8 seconds before the next warning (10–20 seconds between committed strikes, plus frame quantization). Lightning bypasses ordinary temporary player invulnerability/travel/driver protection, but preserves armor, dead checks and debug god mode. Roofed/interior ground is not targeted by fallback classification.
- Debug: F6 cycles weather and locks automatic changes. `?weather=snow` (also rain/fog/storm/clear) forces immediately. Console: `GAME.weatherManager.force('rain')`, `.force('clear',{immediate:true})`, `.resumeAutomatic()`, `.serialize()`, `.restore(snapshot)`. Invalid state/snapshot input is rejected before mutation. `.paused` supports independently freezing weather for tools.
- Events: `weather:change`, `weather:modifiers` (4Hz), `weather:warning`, `weather:strike`, on both manager and MapManager hub. Host snapshots include timers, RNG and transitions; guests interpolate and render but never schedule/damage. Existing custom-map networking restriction remains.
- Weather cosmetics toggle and device/frame-governor caps affect precipitation/tracks/flashes only; fog and lightning warnings/damage remain. Max rain 160, snow 120; medium 96/72, low 48/36. Gameplay RNG is independent from visual RNG. Session/map changes dispose pools, fog/text canvases, events and audio filtering.
- Automated checks: `node --test tests/*.test.mjs`; `node tools/harness/boot.mjs`; `node tools/harness/weather.mjs 3`. Software Canvas timing is not browser FPS. Browser audio, multiplayer latency, evergreen browser visual review and ten-minute DevTools memory/performance acceptance are still pending.

## Phase 5 — Day/night
`src/systems/time/DayNightCycle.js` is an ES-module event hub. The host clock starts
at noon, wraps every 720 active-game seconds, and uses exact intervals: day
[06,17), dusk [17,19), night [19,24) and [00,06). Main pause/menu/game-over stop
updates. Its independent `paused` flag freezes clock advance only; lights still ease
and batteries still operate during gameplay. `force(hour,{pause:true})` validates
[0,24), `resume()` restarts time. F7 cycles 18 → 22 → 12 and freezes; URL `hour`
forces/fixes time on reset. `time:change` publishes to the local and map event hubs.

Day retains the baseline ambient darkness. Dusk/night darken the existing light
pass and reduce the large personal visibility bubble; darkness eases exponentially
with a five-second time constant, without rebuilding masks or gradients each frame.
Spawn interval divides by 1.1 at dusk / 1.5 at night; new rounds snapshot the same
multiplier into total population (rounded up). Existing round totals do not change
mid-round, and the original concurrent-actor safety cap is preserved.

Night Stalker is a separate `ENEMY_TYPES['night-stalker']` definition: 1.55× walker
speed, 1.4× damage, 1.2× HP, runner artwork with violet ring/eye markers. It has an
18% night spawn chance, excluding dog rounds; ordinary daytime rolls never select
it. Existing spawned stalkers survive dawn; debug explicit spawning remains allowed.

Flashlight uses existing cached cone rendering, not a new renderer. L toggles per
player; capacity 100%, drains over 90 seconds, recharges while off at 2%/second by
day or .4%/second otherwise. Dead players do not project a cone. Batteries/toggles
serialize by network ID, and guest L input passes through the existing relay input
protocol; only authority drains inventory. Client clocks interpolate between host
snapshots. Restoring clock inventory occurs after snapshot player reconciliation.
Clock and battery snapshots validate atomically. Reset/map swaps release event
subscriptions; batteries belong to players, with no global retained-player cache.

### Reproducible verification
```
node --test tests/*.test.mjs
node tools/harness/boot.mjs
node tools/harness/webaudio.mjs
node tools/harness/net.mjs
node tools/harness/transit.mjs 10
node tools/harness/weather.mjs 3 22
node tools/harness/final-soak.mjs 600
```
The final soak simulates ten minutes **per map**, 100 actors, all weather modes and
clock wrap, rendering only at **1Hz**. It checks finite positions, bounded effects,
and repeated snapshot restores. It is not a 60Hz rendering benchmark, browser
memory inspection, or ten-minute real-time DevTools acceptance.
