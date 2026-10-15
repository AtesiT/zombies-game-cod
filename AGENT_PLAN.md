# Implementation plan

Date: 2026-10-15. Approval gate: awaiting user confirmation and current phase selection.
Recommended next run: Phase 1. Each phase ends with AGENT_PHASE<N>_REPORT.md; read previous reports before continuing.

## Technical decisions

- Preserve Canvas 2D, native ES modules and the existing zero-dependency Node server. No Phaser, Vite or general physics engine migration.
- Use a JSON registry with inline or referenced validated level definitions: id, name, scene/level reference, mechanics descriptors, music reference, background, thumbnail, floors/layout, spawn points, interactions, environment defaults. Generic mechanic types, never checks against map IDs.
- Preserve Nacht campaign and shooting range. GameMap accepts optional configuration via an adapter; omitted configuration retains current behavior. Adding a map of supported mechanic types requires only a registry entry and assets/config, not imports or switch statements.
- Lightweight EventBus with unsubscribe/dispose; per-session ownership. Public APIs receive JSDoc. Loading uses validated fetch, cancellation/stale-request protection and explicit loading/error UI.
- Custom inertia-based vehicle physics at existing fixed step, swept/substepped oriented collision, steering-rate smoothing, lateral friction and knockback. Reuse WebAudio for a bounded engine voice.
- Extend existing heap-backed navigation: sparse dynamic tile occupancy, footprint symmetric-difference updates only after cell/rotation changes; incremental g/rhs-style consistency repair with per-tick work limits. Retain existing static flow algorithm as baseline; never rebuild the entire grid because the bus moved. Test removals, corners and blocked targets. Initial map loads/target changes may require budgeted global work.
- Generic environmental mechanic dispatcher driven by JSON; reuse collision, damage, economy and interaction hooks.
- Weather/time managers publish state and interpolated modifiers, support snapshots, seeded schedules and force/debug APIs. Rendering suppression must never disable gameplay modifiers.
- Shared reusable pools with complete reset/release contracts for zombies, particles and projectiles; preserve existing constructors/public behavior. Bounded footprints and effect caches.
- Host owns authoritative vehicle/weather/time/hazard simulation. Guests receive map id and state; same-origin URLs only. Preserve logical viewport/DPR behavior.

## Ordered file work and complexity

Exact splits may adjust after approval; these are responsibilities, not a mandate to duplicate existing entities.

| Order / phase | Create or modify | Work | Complexity / dependency |
| --- | --- | --- | --- |
| 1 / P1 | src/utils/EventBus.js, src/utils/ObjectPool.js; tests/system utilities | Events, disposal and pool contracts | Low; foundation |
| 2 / P1 | assets/maps/registry.json; assets/maps/*/map.json, thumbnails; src/systems/map/MapSchema.js | Schema, metadata for all three new maps, validated generic layout format | Medium; before loader |
| 3 / P1 | src/systems/map/MapManager.js, MapSelectionUI.js | Async load/select/current data/events, keyboard/pointer UI and errors | Medium; 1–2 |
| 4 / P1 | src/map.js, src/game.js, src/main.js, src/hud.js, styles.css, src/net.js | Config adapter, lifecycle and menu integration; preserve campaign/range; propagate map identity | High; 2–3 |
| 5 / P1 | tests/map*.test.mjs; tools/harness map integration probes; AGENT_PHASE1_REPORT.md | Validate registry, distinct basic scenes, refresh/loading/reset and legacy regressions | Medium; 4 |
| 6 / P2 | terminal-transit/map.json; src/systems/pathfinding/PathfindingManager.js, DynamicObstacle.js; src/map.js | Full terminal/depot/streets/plaza layout, two power and three upgrade stations; incremental occupancy/repair | High; working data adapter |
| 7 / P2 | src/systems/vehicle/VehicleController.js, BusController.js, VehicleInput.js; src/entities/Bus.js | Accel/brake/drift, crush, HP/fuel, safe entry/exit, repair/refuel | High; 6, pools |
| 8 / P2 | src/game.js, entities.js, audio.js, hud.js, net.js, touch.js | Bus control arbitration, camera lead, damage rewards, pitch/audio lifecycle, multiplayer and controls | High; 7 |
| 9 / P2 | vehicle/pathfinding tests, stress probes; AGENT_PHASE2_REPORT.md | Moving footprint tests, collision/crush ten zombies, fuel/repair, navigation timing | High; 6–8 |
| 10 / P3 | neon-night-market/map.json, blackwood-logging-camp/map.json; src/systems/environment/EnvironmentManager.js and mechanic modules | Signs/electrical DOT, fire escapes/slow climbing/accuracy, main interactable; traps/root, falling cover, mud ×0.6, zipline | High; data adapter, navigation, hit hooks |
| 11 / P3 | game.js, entities.js, map.js, net.js; environment tests; AGENT_PHASE3_REPORT.md | Generic shootable/interaction hooks, reversible state lifecycle and synchronization | High; 10 |
| 12 / P4 | src/systems/weather/WeatherManager.js, WeatherState.js, effects/{Rain,Fog,Storm,Snow}Effect.js | State machine, 5–10s lerp, timed/wave schedules, serializable force state; bounded particles/footprints | Medium–high; utilities/environment |
| 13 / P4 | entities.js, game.js, audio.js, net.js; weather tests; AGENT_PHASE4_REPORT.md | Rain accuracy ×0.85/drift ×1.1/muffling; fog visibility ×0.4/spawn distance ×0.7; storm 150 damage at 10–20s intervals in configured open areas; snow speed ×0.75 for all moving entities | High; 12, combat/vehicle hooks |
| 14 / P5 | src/systems/time/TimeOfDayManager.js, FlashlightController.js, NightStalkerAI.js | Real-time hour = 180s, day/dusk/night; smooth grade, flashlight cone/battery/toggle, variant AI, pause/force | High; weather, lighting and spawn integration |
| 15 / P5 | lighting.js, game.js, entities.js, net.js, hud.js, main.js | Dusk spawn frequency ×1.1, night ×1.5, night-only stalkers; combine modifiers without permanent base-stat mutation; ambient/visibility integration | High; 14 |
| 16 / P5 | README.md, AGENT_DOCUMENTATION.md, AGENT_COMPLETION_REPORT.md, AGENT_PHASE5_REPORT.md; full tests | Controls/schema/debug docs, regression suite, cross-browser checks and 10-minute 100+ soak/performance/memory evidence | High; all phases |

## Phase scope and dependencies

P1 produces selection and distinct playable basic configured levels, not finished bus/hazard/weather mechanics. Metadata must clearly distinguish planned mechanics from playable capabilities. P2 completes Terminal Transit; P3 completes both environmental maps; P4 completes gameplay weather; P5 completes time and final verification. Ship final acceptance only after all phases, not after the selector.

Map load → session creation → environment/navigation → vehicles → weather/time modifiers → combat/spawn/render integration. Reset/dispose tears down audio voices, subscriptions, pooled entities and caches. JSON is validated before touching the running session; failed loads retain a usable menu or current level.

## Verification gates

- Unit tests via Node built-in test runner: schema, stale/failed loads, events/disposal, pool reuse/reset, incremental routing insert/remove/rotation, vehicle dynamics, hazards, modifiers, serialization and time boundaries.
- Extend existing @napi-rs/canvas harness for menu/map resets, campaign/range/weapon/stair/perk/network regressions, 60/120 Hz collision and no NaN checks.
- Run dev server; browser-check every map, entry/exit, crush ten zombies, repair/refuel, hazard interactions and forced weather/time. Watch console and reload from scratch.
- Profile navigation work, frame times, active pool sizes and cache bounds with 100+ zombies. Stress mode bypasses the normal 40-body cap explicitly.
- Ten real minutes of active gameplay, DevTools Performance + Memory snapshots (post-GC retained counts), repeated map switching and audio disposal. Record browser/hardware/DPR/quality; do not assert 60 FPS or no leaks from a short Node probe.
- Chrome/Firefox/Edge/Safari and touch/resize/DPR checks require available browser environments; document unavailable checks as pending, not passed.
- Add AGENT_BLOCKERS.md / AGENT_DEVIATIONS.md only when actual blockers or spec deviations arise. Mark acceptance checkboxes complete only with supporting verification.

## Approval requested

Confirm Phase 1 (recommended), or specify another phase/scope. No production code has been written during discovery.

## Execution tracking (2026-10-15)

- Phase 1: selector/registry/basic layouts implemented; automated checks passed. See AGENT_PHASE1_REPORT.md.
- Phase 2: Terminal Transit objects and bus implemented; 15 combined tests and legacy regression probes passed; 60-second/100-zombie software-render stress passed. See AGENT_PHASE2_REPORT.md.
- Chosen local A* overlay differs from the initially proposed g/rhs global repair; rationale and staged scope are in AGENT_DEVIATIONS.md.
- Phases 3–5, custom-map networking, legacy entity pooling and real-browser final verification remain pending.
- Phase 3: both environmental maps implemented; 27 combined tests passed, including actual shots/elevation/quest/cover/zipline and map-cache isolation. Headless 100-zombie probes for both maps pass; see AGENT_PHASE3_REPORT.md. Phases 4–5 remain pending.
