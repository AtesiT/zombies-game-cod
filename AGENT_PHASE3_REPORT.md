# Phase 3 report — two environmental maps

Date: 2026-10-15. Feature implementation and automated verification complete; manual browser and final performance/memory gates remain pending.

Read AGENT_PHASE1_REPORT.md, AGENT_PHASE2_REPORT.md and AGENT_DEVIATIONS.md before subsequent phases.

## Implemented

### Neon Night Market

- Dense building/stall alleys, narrow passages and central relay district.
- Three shootable neon plates with HP, falling animation, timed electrical zones, damage to player/zombies and light effects. Hitscan handles nearer walls/zombies before destructible targets.
- Two E-accessible fire escapes: constrained raised decks, 35% less player shot spread, four-second enemy climbs with movement penalty, and no ground melee until climbing finishes.
- Main relay quest: activate three numbered terminals in order, destroy at least two signs, initiate the broadcast and defend within its radius for five seconds. Leaving interrupts; completion rewards points/healing/current ammo once.
- Power, wall weapons, Mystery Box and upgrade location use the existing economy.

### Blackwood Logging Camp

- Forest exterior art/trees, lumber mill with door/windows/interior spawns, log yard and lookouts.
- Three bear traps: damage/root either player or zombies, visible closed state and twelve-second auto-rearm. Roots stop knockback movement and cannot be bypassed through climbing/zipline interaction.
- Three shootable supports: animated falling lumber, landing damage, local permanent solid tile cover, bullet occlusion, clear-center displacement of impacted actors and route invalidation. All supplied spawns remain navigable after every log falls.
- Two mud patches apply a 0.6 ground speed multiplier without changing base stats.
- Raised lookout endpoints and a bidirectional 1.8-second zipline, with suspended walking/shooting, protected travel and clear elevated landing. E uses the line near its anchor; moving away on the deck allows descent.
- Power, upgrade, Mystery Box and wall weapons remain usable.

### Shared architecture / fixes

- Generic JSON environment descriptor schema and modular EnvironmentManager, HazardSystem, ElevationSystem, DestructibleSystem and RelayQuest. No map-ID branches enable mechanics.
- Shared events through MapManager. Weak actor state ownership; bounded pooled zones/impact effects; explicit reset/disposal.
- Bounded text and electrical arc sprite caches, fixed-color lighting and offscreen hazard culling. Existing resize/DPR pipeline retained.
- Discovered and fixed configured-map base-art cache collision: paintLevel caches by seed, and every configured map previously used one seed. Stable ID/layout-derived seeds now keep their rendered floors distinct. Added a regression assertion.

## Files created

- src/systems/environment/{EnvironmentManager,HazardSystem,ElevationSystem,DestructibleSystem,RelayQuest,EnvironmentSchema,EnvironmentRenderer}.js
- tests/environment.test.mjs
- tools/harness/environment.mjs
- AGENT_PHASE3_REPORT.md

## Files modified this phase

- assets/maps/registry.json — both maps' layouts, economy objects and generic mechanic definitions.
- src/systems/map/MapSchema.js — validates environment descriptors.
- src/game.js — lifecycle, hitscan occlusion/damage, E actions, transit control arbitration, environment tick/draw/light hooks.
- src/entities.js — movement/spread composition, elevated melee gating and transit protection.
- src/map.js — rooted collision guard and distinct configured paint-cache keys.
- src/hud.js — environment prompts and explored platform/quest minimap markers.
- tests/maps.test.mjs — distinct base-canvas regression assertion.
- README.md, AGENT_DOCUMENTATION.md, AGENT_DEVIATIONS.md, AGENT_PLAN.md — controls, schema/APIs, decisions and progress.

Phase 1/2 files remain in the cumulative uncommitted working tree; these lists distinguish this phase's work.

## Verification actually run

### Automated integration tests

`node --test tests/*.test.mjs`: **27/27 pass** (12 environment, 4 map, 11 vehicle).

Environment coverage includes:

- unknown/duplicate descriptor rejection, invalid zipline references and blocked decks;
- actual hitscan damage/fall/one-shot destruction, DOT against both actor types and zone expiry/pool return;
- wall and nearer-zombie shot occlusion;
- real player-shot spread reduction, deck constraints and delayed zombie melee;
- quest prerequisites, wrong-order handling, interruption and exactly one reward;
- trap damage/root for both actor types, frozen pause timers and released movement;
- mud modifier/base-stat preservation;
- cover solidity/bullet blocking, impacted actor evacuation, one-shot topology event and path refresh;
- line travel in both directions, no walking/shooting during travel and legal landing;
- reset/disposal restores original cover/quest/hazard state and releases retained actor/effect arrays;
- roots cannot be bypassed by deck movement; all camp spawns remain reachable after all supports fall;
- distinct configured base canvases for all three maps.

Legacy probes passed: boot.mjs, frontmenu.mjs, range.mjs (31 racks/18 creature buttons), weapons.mjs, step60.mjs (campaign movement/stairs/creatures at 60/120 Hz) and net.mjs (real relay/co-op). Boot rerun after final layout/cache changes. `git diff --check` clean.

### 100-zombie software stress

`node tools/harness/environment.mjs 10`: **PASS** on the final layouts. The probe maintains 100 walkers by replacing removed/dead ones, forces every sign/support destruction, renders each simulated frame, checks finite coordinates, actual circle penetration against solids/cover and bounded effects, then verifies disposal. Player uses debug god mode to keep the scenario running. It does not emulate a complete ten-minute real play session or the browser frame governor.

Final recorded run:

| Metric | Neon Night Market | Blackwood Logging Camp |
| --- | --- | --- |
| Simulated duration | 10 seconds | 10 seconds |
| Living walkers at end | 100 | 100 |
| Median software frame work | 3.79 ms | 3.59 ms |
| p95 software frame work | 9.22 ms | 9.87 ms |
| p95 update | 1.70 ms | 2.02 ms |
| p95 draw | 7.88 ms | 7.10 ms |
| Maximum active impact effects | 3 / cap 64 | 3 / cap 64 |
| Maximum electrical zones | 3 / cap 32 | 0 / cap 32 |
| End Node heap | 15 MB | 20 MB |

Multiple earlier 10/15-second probes also passed functionality/collision assertions. Earlier render-tail measurements reached ~50–78 ms; rendering ablations, bounded text/arc caching, culling and the map-art cache fix were performed before the final run. Results are short-run and variable: not a browser FPS guarantee or retained-memory certification. GPU/browser profiling remains mandatory for the final phase.

### Preview / visual inspection

Dev server started on 0.0.0.0:8080 and left running. HTTP module retrieval succeeded. Node-rendered market and camp screenshots were inspected: distinct floors, neon plate lighting, quest console, platforms, mud, trap markers and support prompts visible. These are not browser screenshots. Generated preview PNGs remain ignored scratch artifacts.

## Feature 3 acceptance status

- [x] Dense market alleys/tight corners.
- [x] Shot neon signs fall into electrical zones damaging player and zombies.
- [x] Fire escapes provide raised shoot-down positions, accuracy bonus and slow zombie climbs.
- [x] Multi-step main quest interactable with one-shot completion.
- [x] Forest/lumber mill setting.
- [x] Bear traps damage and root both players and zombies.
- [x] Shot supports drop logs that create collision/bullet cover and block paths.
- [x] Mud reduces ground player/zombie movement speed by 40%.
- [x] Zipline connects two elevated lookout points for fast escape.
- [ ] Manual browser/touch/cross-browser validation and ten-minute DevTools Performance/Memory check.

## Known limitations / next phases

1. Custom maps remain solo-only. Environment state has not been added to the multiplayer protocol; hosting/joining continues on Nacht.
2. Elevation is pseudo-elevation on the shared world plane. Ranged enemies can still attack decks; only ground melee is gated by climb completion. Electrical zones affect actors at the same x/y regardless of deck height; mud/traps are ground-only. Zipline travel is protected.
3. Shockwave/splash secondary effects do not currently damage sign/support HP; ordinary weapon hitscan/pellets do. Requirement for shooting the objects is implemented through primary bullets.
4. Arbitrary custom layouts must be authored with alternative routes around falling cover; schema validation checks legal footprints/landings, not general future-topology connectivity. The supplied camp has explicit post-fall reachability tests.
5. New hazard/impact records are pooled; legacy zombies/projectiles/general particles still require ownership-safe pooling before overall final acceptance.
6. Weather/time features are not implemented yet. Phase 4 must compose weather movement/spread with environment multipliers, and must not disable hazards when visual effects are reduced. Preserve bounded lighting RGB/cache keys.
7. Time/night logic must respect raised melee and line input arbitration. Environment elapsed time intentionally pauses independently of Game.time, which currently advances before menu/pause returns.
8. Final browser gameplay/audio, hard refresh, evergreen compatibility, sustained 100+ load and retained-memory checks remain pending as documented in AGENT_BLOCKERS.md.
