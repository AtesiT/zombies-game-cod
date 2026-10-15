# Phase 2 report — Terminal Transit + drivable bus

Date: 2026-10-15. Implementation and automated verification complete; manual browser/audio/performance verification pending. Read AGENT_PHASE1_REPORT.md and AGENT_DEVIATIONS.md before continuing.

## Implemented

### Data-driven Terminal Transit

Expanded the existing configured floor with labeled subway/tunnel, depot, avenue and plaza regions, interior tunnel spawns behind rebuildable windows, two purchasable doors, two power locations, three functioning Pack-a-Punch locations, two wall weapons, a Mystery Box and repair/refuel stations. New generic object arrays are validated and adapted by GameMap. No map-ID conditional activates the vehicle or layout mechanics.

### Armored bus

- Inertia-based acceleration, forward/reverse limits, smoothed steering, lateral slip and braking; 120 Hz collision substeps within the existing fixed simulation.
- Oriented footprint collision against static tiles and furniture; oriented circle resolution for people, with alternate safe faces near walls.
- E entry at driver seat; walking/shooting/grenades/world interactions suppressed while driving; safe low-speed exit with blocked-landing refusal. Intact bus shields the driver. Destruction attempts emergency exit and disables thrust/entry.
- Moving impacts kill small zombies, damage larger ones, apply velocity knockback and pass kills through existing rewards/wave bookkeeping. Stationary contact damages armor with per-zombie cooldowns.
- Durability/fuel HUD, passive/active occupied fuel consumption, paid repair/refuel service with affordability/full-state/speed checks.
- Smooth camera velocity lead, body rendering, explored minimap markers and landmark/service labels.
- Speed-pitched reusable WebAudio engine voice, throttled impact sounds, explicit disconnect on exit/pause/reset/game over/map replacement.

### Dynamic navigation

Sparse footprint updates identify old/new occupancy changes, including rotation. Shared cached local A* detours overlay the existing long-distance flow field. Queries are bounded to a local radius and 320 expansions; the entire simulation tick is capped at 1,200. Budget exhaustion returns a hold waypoint, not direct steering through the bus. Footprint changes clear only the local-route cache; bus movement requests no full-field rebuild. Existing 0.22-second target-driven Dijkstra refresh remains unchanged. Oriented body collision is the final physical authority.

New navigation nodes, contact cooldown records and bus impact particles use bounded reusable ObjectPool storage. Legacy zombie/projectile/general-particle allocation is unchanged (see remaining work).

## Files created

- src/entities/Bus.js
- src/systems/vehicle/{VehicleController,BusController,VehicleInput,VehicleAudio}.js
- src/systems/pathfinding/{PathfindingManager,DynamicObstacle}.js
- src/utils/ObjectPool.js
- tests/vehicle.test.mjs
- tools/harness/transit.mjs
- AGENT_BLOCKERS.md and this report

## Files modified this phase

- assets/maps/registry.json — Terminal Transit layout, objects, vehicle and station configuration.
- src/systems/map/MapSchema.js — object/weapon/vehicle validation, including initial body footprint.
- src/map.js — generic object arrays, optional multi-power/multi-upgrade accessors, local navigation integration.
- src/game.js — session vehicle ownership, input arbitration, interactions, camera, presentation, disposal.
- src/entities.js — occupied intact bus shields the local player.
- src/hud.js — bus/service minimap markers.
- README.md, AGENT_DOCUMENTATION.md, AGENT_DEVIATIONS.md — controls, API/schema, scope and architecture decisions.

Phase 1 changes remain in the cumulative working tree; existing phase reports preserve that distinction.

## Verification actually run

### Automated tests

`node --test tests/*.test.mjs`: **15/15 pass** (4 map tests + 11 vehicle tests), covering:

- malformed vehicle/weapon data rejection;
- real E entry, acceleration, turning/slip, fuel consumption, braking and exit;
- zero-fuel no-thrust behavior, repair/refuel charging and stationary enemy damage;
- ten crush kills and normal game rewards;
- local detour reaching the opposite side of the bus without occupied waypoints;
- footprint removal/insertion, bounded search budget, no bus-triggered full rebuild;
- static body collision, finite physics, pooled reset/capacity;
- both power switches, all three upgrades, doors and wall purchases;
- destruction/ejection, blocked exit refusal and heavy-enemy damage/knockback;
- mocked WebAudio reuse, speed pitch and stop/disconnect lifecycle;
- end-to-end entered bus driving through ten walkers, preserving driver health/ammo, camera lead and complete render.

Legacy probes passed: boot.mjs, frontmenu.mjs, range.mjs (31 racks/18 creature buttons), step60.mjs (campaign movement, stairs and creature checks at 60/120 Hz), weapons.mjs, net.mjs (including real relay). Latest boot/frontmenu tests rerun after integration changes. `git diff --check` clean.

### Stress probe

`node tools/harness/transit.mjs 60`: **PASS**, 60 simulated seconds at 60 Hz with 100 walkers and a stationary armored target, HP replenished by the probe to retain the crowd. Every simulated frame rendered in Node software canvas.

Recorded run:

| Metric | Result |
| --- | --- |
| Walkers retained at end | 100 |
| Median software frame work | 3.26 ms |
| p95 software frame work | 5.90 ms |
| Maximum navigation expansions/tick | 114 / 1,200 cap |
| Maximum cached routes | 54 |
| Maximum contact records | 19 |
| Final Node heap | 13 MB |

These are one-run headless measurements, not GPU/browser FPS or proof of no retained-memory growth. An earlier 10-second probe also passed. No ten-minute DevTools inspection was performed.

### Preview

Existing live server remains available on 0.0.0.0:8080. HTTP checks for index and the vehicle module succeeded. A Node-rendered entry screenshot was inspected; player, bus, services and prompts are visible. It is not a browser screenshot.

## Phase 2 acceptance status

- [x] Top-down acceleration, braking, steering and visible inertia/drift implemented and tested.
- [x] Moving bus is a physical and dynamic navigation obstacle; bounded local replanning tested.
- [x] Crushing, small-enemy instant kills, larger-enemy damage/knockback and rewards tested.
- [x] HP, enemy contact damage, repair, fuel consumption and refueling tested.
- [x] Entry/exit, player/bus control arbitration and camera lead tested.
- [x] Engine pitch and crush sound implementation; node reuse/disposal tested with audio mocks.
- [x] Data-driven region layout, two power locations, three upgrades, doors and wall weapons.
- [x] No bus-motion full-grid recomputation; 100-zombie headless stress probe passes.
- [ ] Audible playback and manual real-browser driving/feel check.
- [ ] Browser DevTools Performance/Memory, ten-minute leak check and cross-browser verification.

## Known limitations / next phases

1. Custom maps remain solo-only; co-op restores Nacht. Network serialization of new dynamic systems must precede custom-map multiplayer.
2. No towing or field repair: an empty/disabled bus away from stations may be abandoned; the run continues on foot or can be restarted.
3. Desktop Space/Shift controls are primary for brake/service. Existing touch stick and interaction are reused, without dedicated new service/brake buttons.
4. Retrofitting legacy zombies/projectiles/general particles to pooling is still required before the overall pooling acceptance can be marked complete. New vehicle/navigation transient records are pooled now.
5. Both power consoles activate the shared existing grid; they are not separate power districts.
6. Local A* is not a general dynamic-global-topology solver. Phase 3 falling cover must invalidate relevant navigation caches when static geometry changes, and test blocked corridors, target reachability and reopening paths.
7. Phase 3 should implement generic sign/electricity/elevation/easter-egg and trap/falling-log/mud/zipline modules driven by configuration. Do not put mechanics in map-ID branches.
8. Phase 4 should integrate weather drift via `bus.physics.driftMultiplier`, and apply gameplay modifiers independently of visual-quality suppression. Vehicle speed/entity modifiers must be composed without permanently mutating base values.
9. Weather/day-night, Night Stalkers, flashlight battery and final browser verification remain future phases; no overall completion report is claimed yet.
