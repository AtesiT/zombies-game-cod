# Staged implementation decisions

## Phase 1 — 2026-10-15

- The registry embeds each layout in one JSON file rather than fetching one file per map, as allowed by the registry option. This makes validation atomic and avoids snapshot/loading races.
- Configured layouts currently retain the engine's 72×50 dimensions. Variable dimensions and generic interaction tables are deferred; this avoids rewriting collision/render code during selection work.
- Custom map selection is solo-only for now. Hosting/joining explicitly restores Nacht, protecting existing co-op from mismatched geometry. Map identity and dynamic state synchronization remain future work; no custom multiplayer support is claimed.
- Catalog music/background/thumbnail references exist, but do not replace the current procedural soundtrack/background or render image cards yet.
- ObjectPool is deferred to the entity/vehicle implementation. Phase 1 introduces no new per-frame entities or effects and does not claim existing zombie/projectile/particle allocations are pooled.
- Real browser interaction, cross-browser checks and DevTools performance/memory profiling are not available through the provided tools in this run. Node canvas and HTTP checks are reported separately and not marked as browser verification.

## Phase 2 — 2026-10-15

- Chose bounded local A* detours on top of existing Dijkstra rather than the plan's proposed g/rhs incremental global-field repair. This preserves campaign path costs/stairs and limits bus-specific work to local footprints and small search queries. Moving the bus never requests a full rebuild. The existing 0.22-second target-driven flow rebuild remains.
- Added generic object-table support (doors/windows, wall weapons, arrays of power/upgrade spots) and a configured bus. Phase 1's object-table restriction is superseded. Layout dimensions and solo-only custom maps remain unchanged.
- New navigation/contact/effect records are pooled. Retrofitting legacy zombies, grenade/projectile and generic particle ownership remains deferred; it risks stale AI/network references and should receive separate lifecycle tests before final verification. No claim that all existing entity allocation is pooled.
- Both configured power locations operate the existing shared grid, rather than introducing separately powered districts.
- No towing: a disabled/out-of-fuel bus away from services can be abandoned while the run continues on foot. Desktop keyboard provides braking and Shift+E service; touch steering/interaction reuse existing controls, without new dedicated brake/service buttons.
- Art remains procedural Canvas, consistent with the repository, with labeled terminal/depot/avenue/plaza regions and tunnel spawns rather than imported tilesets. Manual browser/audio feel and cross-browser profiling remain unverified.

## Phase 3 — 2026-10-15

- Fire escapes/lookouts use explicit raised actor states and deck constraints within the existing single-floor configured maps, rather than adding campaign storeys. Sprites rise 18 px; ground melee is gated until a slow climb finishes; reduced spread applies to player shots. This retains shoot-down behavior without changing original multi-floor visibility/pathing.
- Blackwood logs alter only their configured tile footprint and trigger one scheduled static-field refresh per fall. No full geometry repaint or per-frame grid recomputation. Bus detour cache is invalidated when present.
- Mud changes ground movement multipliers; elevated decks bypass ground mud/traps. Traps auto-rearm after twelve seconds. Electrical DOT uses 0.75-second pulses to cooperate with existing player hurt-immunity/armor semantics.
- The market's main interactable is a generic ordered relay/defend-console quest, with one-shot points/healing/ammo rewards, rather than a separate cinematic or campaign EasterEgg rewrite.
- New zones/effects are pooled and root/elevation ownership is weak. Legacy zombie/projectile/general-particle pooling remains deferred. Custom map networking and browser final verification remain pending.
- Fixed a discovered Phase 1 static-art cache collision: configured maps shared one paint seed despite different geometry. Layout-derived seeds and a regression assertion now keep their base canvases distinct.
- Performance work added bounded label/electrical sprite caches and offscreen hazard culling. Early software stress profiles showed high render tail times; final short profiles improved, but no browser FPS/ten-minute memory claim is made.

## Phase 4
- Adaptive low precipitation budget is 48 rain/36 snow (rather than the initially proposed 60/45). Tracks use four age batches; pools remain hard bounded.
- Storm thunder reuses procedural explosion sound; no sampled assets. Snow modifies locomotion and vehicle drive, not projectile ballistics/scripted zipline timing.
- Software Canvas performance probes showed variable >100ms p95 spikes; sustained 60 FPS cannot be marked verified. Browser profiling/ten-minute acceptance remains pending, as recorded in Phase 4 report.

## Phase 5
- Default full day is 720 active-game seconds; batteries last 90 seconds, recharge
  off at 2%/s in daylight or .4%/s otherwise. These are explicit tunable defaults.
- Dusk/night affect spawn cadence and new-round population; mid-round totals and
  original concurrent actor safety cap are preserved. Stalkers have 18% night chance.
- Available long soak simulates 600 seconds per map at 100 actors and renders 1Hz;
  this does not satisfy continuous real-browser ten-minute FPS/retained-memory gate.
