# Agent discovery

Date: 2026-10-15. Branch: `arena/e11298c7-zombies-game-cod`.
Status: mandatory inspection completed; production code unchanged; awaiting plan/phase confirmation.
No previous `AGENT_PHASE*_REPORT.md` files were found.

## Architecture findings

| Area | Existing implementation / evidence |
| --- | --- |
| Rendering | HTML5 Canvas 2D, procedural pixel art (`src/art.js`, `spriteData.js`), cached floor rendering, layered darkness/glows (`lighting.js`), decals and canvas HUD. No engine or WebGL library. |
| Modules | Native ES modules: package.json `type: module`, index.html module script loading `src/main.js`. No bundler or runtime dependencies. |
| Boot / loop | main.js creates Input, Game, TouchControls. Fixed simulation defaults to 60 Hz (optional 120), max six catch-up steps; requestAnimationFrame render. Exposes window.GAME, TOUCH, INPUT for debugging. |
| Map / scenes | Game owns menu/play/debug/range lifecycle and reset/begin. GameMap defaults to campaign or builds a synthetic shooting range. Campaign data is generated JS in mapData.js by tools/genmap.py. Three aligned 72×50 storeys; portals/stairs, per-floor state, collision and cached level art. No external map registry or selector. |
| Waves | game.js roundPlan/startRound/spawnZombie/rollEnemyType handle escalating health, speed, interval, total and special archetypes; dog rounds every fifth round. Normal concurrent population capped at 40, not 100+. Spawn selection checks reachability. |
| Player / input | Player in entities.js uses velocity acceleration/friction, tile collision, sprint, mouse aim, weapons, melee, grenades, perks and downed state. Input uses key codes, pressed/released sets, logical canvas mouse coordinates; touch controls already exist. |
| Camera | Game.cam in world coordinates; screen/world conversions; damped follow and bounds clamp in game.js. 800×500 logical viewport. Vehicle follow/lead not present. |
| Pathfinding | Custom heap-backed weighted Dijkstra flow fields in map.js (`buildFlow`, `buildFlowOn`, util.js MinHeap), eight neighbors and diagonal costs, expensive barricade/prop traversal, blocked static tiles. game.js rebuildFlow routes through storey links and lures; scheduled every 0.22 seconds plus interaction-triggered updates. No moving-obstacle occupancy or incremental repair. |
| Weather | game.js weather object and drawWeather: wind, leaves and associated visual effects. Settings/performance governor can suppress rendering. No gameplay weather state machine. |
| Lighting / time | lighting.js cached light layers, ambient setter, torch/flashlight-style lighting and postgrade. No progressing hour, time phases, battery or night-exclusive stalker system. |
| Entities / allocation | Player, Zombie, Particles, Popups, MonkeyBomb, Grenade share entities.js. Zombies constructed through new Zombie; particles use capped arrays and new records, not reusable pools. New pooling must carefully reset combat/AI/network state. |
| Audio | Existing procedural WebAudio in audio.js with gesture unlock in main.js. Extend its routing/lifecycle for engine/crush and weather muffling; no external audio dependency required. |
| Multiplayer | server.mjs WebSocket relay at /net; net.js host-authoritative simulation and state snapshots. Map/environment/vehicle state must be synchronized rather than independently randomized on guests. |
| Resize / DPR | main.js keeps logical 800×500, CSS fits window, logical input coordinates, optional devicePixelRatio-aware adaptive supersampling ('DLSS5'). Preserve this pipeline. |

## Run / verification pipeline

- `npm start`: `node server.mjs 8080`; binds 0.0.0.0, serves same-origin assets/JSON with no-cache, relays co-op. Suitable for Arena preview without Vite changes.
- `npm run map`: Python map generator. `npm run sprites`: preview utility.
- tools/harness/package.json depends on @napi-rs/canvas; install there to run existing Node canvas harnesses.
- Existing probes include boot, menu, range, spawnreach, step60, atmosphere, quality, weapons, net, leak, perf and soak.
- docs/PERF.md records prior lighting cache leaks and software-render profiling. Preserve bounded color keys, baked effects, quality scaling and bounded decal caches. Recorded timings are historical, not measurements from this run.
- Browser DevTools is still needed for real GPU frame performance, evergreen browser compatibility and ten-minute retained-memory verification. Node canvas tests cannot certify these.

## Risks / integration boundaries

1. GameMap imports many static campaign constants; adding a registry alone will not load distinct layouts. Introduce a validated level definition adapter, retaining campaign/range defaults.
2. Existing Dijkstra rebuild is periodic, not incremental. Bus movement must not trigger additional full rebuilds; add sparse footprint updates and budgeted field repair, including both obstacle insertion and removal.
3. Existing interactions assume one power/PAP location in places; support arrays while retaining legacy accessors.
4. Existing 40-body wave cap does not fulfill a 100+ stress scenario; add a debug stress mode without silently changing campaign difficulty.
5. Network snapshots and reset flows must include map identity and deterministic environment state.
6. Features and benchmarks have not been run or claimed complete during discovery.
