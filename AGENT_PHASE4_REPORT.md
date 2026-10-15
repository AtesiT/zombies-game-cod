# Phase 4 report — Weather system

## Scope and handoff
Read Phase 1–3 reports before implementation. Phase 5/day-night is untouched. Implemented modular weather with gameplay, render, audio, debug, JSON schedule and network snapshot integration. No commit/push required; work remains on the session branch.

## Files
New: `src/systems/weather/WeatherState.js`, `WeatherManager.js`, `effects/{ParticleEffect,RainEffect,FogEffect,SnowEffect,StormEffect}.js`, `tests/weather.test.mjs`, `tools/harness/weather.mjs`.
Updated: `src/game.js`, `src/entities.js`, `src/systems/vehicle/VehicleController.js`, `src/audio.js`, `src/net.js`, `src/hud.js`, `src/settings.js`, `src/systems/map/MapSchema.js`, `assets/maps/registry.json`, documentation and this report. Prior phase files/changes are preserved.

## Verified
- [x] All 34 automated tests pass (27 previous regression tests + 7 weather tests).
- [x] Actual entry point harness boot passes; SOLO starts and renders.
- [x] Smooth eight-second transition, interruption continuity, exact weather modifier values, clear restoration, timer/wave scheduling, debug lock and host pause behavior tested.
- [x] Snapshot roundtrip, atomic malformed-vector rejection and guest no-strike scheduling tested.
- [x] Rain quality budgets, cosmetics-independent modifiers, track cap/expiry, outdoor-only 150 damage and warning/timer logic tested.
- [x] Fog culling and always-on drawing with cosmetics disabled tested.
- [x] Software Canvas probe ran all five modes on all three maps with 100 zombies; positions finite and effect counts bounded.

## Performance findings — NOT acceptance certification
Two 3-second-per-mode probes had typical medians ~2.5–4.4ms, but serious inconsistent p95 spikes. First run: Terminal snow p95 113.16ms, other modes 4.36–14.03ms. After batching footprint rendering into four age bands: Terminal snow 6.28ms, but Blackwood storm/snow p95 117.31/118.08ms; remaining modes 4.23–14.73ms. This does not establish a causal footprint fix or sustained 60 FPS. Probe reports frame timings/counts for reproducibility. Browser profiling is needed to separate Canvas/harness/environment/GC costs and verify actual target-device performance.

## Pending / issues
- [ ] Browser visual/input/audio review, true multiplayer host/guest weather latency test, hard refresh/resize/DPR evergreen browser acceptance.
- [ ] Ten-minute 100+ zombie browser DevTools performance and retained-memory gate. Existing no-browser/download blocker still applies; performance gate is explicitly unresolved.
- [ ] Dedicated end-to-end weapon spread, bus drift/snow travel, mud+snow and fog legal closer-spawn scenario measurements (integration hooks present; exact scalar/unit tests and broad regression probes pass, but these acceptance scenarios are not individually certified).
- Lightning uses procedural explosion audio as thunder; subjective sound review pending. Default outdoor classification is tile-based; maps can refine safe outdoor areas via JSON rectangles. Current rectangle bounds intentionally match existing fixed grid schema.
- Snow slows locomotion/vehicle drive, not projectile ballistics or scripted zipline timing; clarify if “all movement” is intended to include those special cases before expanding scope.
- Next phase must retain these pending gates and continue Phase 5 only when requested.
