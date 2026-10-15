# Phase 5 — Day/Night Cycle + Final verification

## Implementation
Read all Phase 1–4 reports. Added modular `DayNightCycle` with exact day/dusk/night
boundaries, smooth darkness, automatic clock wrap, pause/force tools, events and
validated host snapshots. Added per-player battery flashlight, L input forwarding,
F7/URL forcing, clock HUD/controls and distinct Night Stalker. Spawn rates and newly
started round populations use day 1 / dusk 1.1 / night 1.5 multipliers. Preserved
existing wave/pathfinding/render systems and concurrent spawn cap.

New files: `src/systems/time/DayNightCycle.js`, `tests/time.test.mjs`,
`tools/harness/final-soak.mjs`, this report, `AGENT_COMPLETION_REPORT.md`.
Updated: game/entities/net/HUD; weather manager and weather regression test;
weather matrix harness, README, documentation/deviations/blockers.

## Verification outcomes
- [x] `node --test tests/*.test.mjs`: **41/41 PASS**, including seven time tests,
  seven weather tests and all 27 previous map/environment/vehicle tests.
- [x] Exact period boundaries/multipliers, clock wrap, forced pause, smooth light
  state, batteries/depletion/recharge, per-player cone eligibility, invalid snapshot
  rejection, round population changes, stalker strengths, L/F7 and reset tested.
- [x] Actual entry-point boot PASS; procedural WebAudio mock script exits 0.
- [x] Relay integration PASS: mid-round join, shared world, wallets, last stand,
  revival and real relay. Dedicated real-browser clock/torch latency still pending.
- [x] Terminal bus ten-walker crush is covered by passing vehicle regression;
  100-zombie 10-second transit probe PASS, median 2.94ms / p95 8.11ms,
  max navigation expansions 128, cached routes 54, contact records 19.
- [x] All maps × all five weather states at forced 22:00 ran with 100 actors;
  finite positions and bounded particles/tracks checked.
- [x] Ten **simulated** minutes per map at 100 actors, rendered 1Hz, PASS after fix.
  Terminal max tracks 163, heap sample 27.4MB; Neon 94/24.8MB;
  Blackwood 58/18.6MB. All max rain/snow 48/36 under harness quality policy.
  Heap samples are raw Node heap, not retained memory or leak-proof evidence.
- [x] Existing live HTTP endpoint responds 200; `git diff --check` clean.

## Bug found and resolved
The first long soak failed on Blackwood: storm countdown briefly left a negative
`stormTimer` while warning pending, so the system rejected its own serialized state.
Clamp timer to zero when committing a pending warning; added pending-warning
roundtrip assertion. Re-ran all 41 tests and full three-map 600-second simulation:
PASS. No failures were hidden or treated as successful verification.

## Performance: unresolved acceptance gate
Night matrix medians 3.06–4.22ms. p95 Terminal 6.54–15.17ms; Neon clear/storm
60.46/110.12ms, other Neon modes 4.95–10.01ms; Blackwood clear/storm/snow
57.81/121.75/121.83ms, rain/fog 7.75/6.52ms. Existing variable Canvas stress spikes
persist. Neither the median nor sparse-render soak establishes sustained 60 FPS.

## Pending acceptance
- [ ] Browser DevTools ten-minute continuous 60Hz-render, 100+ actors performance
  and retained-memory test. No installed browser / browser download permission.
- [ ] Evergreen browser, hard-refresh, resize/DPR, real input and audible review.
- [ ] Dedicated browser bus drift/snow/mud composition, measured weapon accuracy,
  closer legal fog spawn and daylight/torch legibility scenarios.
- [ ] Real-browser multiplayer battery synchronization/clock latency review.
- [ ] Resolve stress p95 spikes and certify performance on target devices.

See completion report for the manual final-gate procedure. Work is preserved on
`arena/e11298c7-zombies-game-cod`; no commit or push performed. All five phase
implementations are present, but full production acceptance is **not** claimed.
