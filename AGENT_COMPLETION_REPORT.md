# Completion report

**Status: five phase implementations delivered; final browser/performance acceptance
is incomplete.** Do not interpret this as an unconditional production sign-off.

## Delivered
1. Data-driven map selection/registry/manager — see Phase 1 report.
2. Terminal Transit and drivable armored bus — see Phase 2 report.
3. Neon Night Market / Blackwood environmental mechanics — see Phase 3 report.
4. Weather states, gameplay/effects/audio/debug/snapshots — see Phase 4 report.
5. Day/night, batteries/flashlight, Night Stalker and final software checks — see
   Phase 5 report.

## Final available evidence
- 41 automated tests PASS; actual main-module boot PASS.
- Relay multiplayer and procedural audio mock probes PASS.
- Bus crush/navigation regression and 100-zombie transit probe PASS.
- Three maps × five weathers at night exercised with 100 actors.
- 600 simulated seconds per map with 100 actors, weather changes, day/night clock,
  bounded effects and snapshot restoration PASS, rendered at 1Hz only.
- Long soak discovered a negative pending storm timer; fixed and regression-tested.
- Working HTTP preview responds 200; no whitespace errors in tracked diff.

## Unverified / unresolved
Continuous 60 FPS, ten-minute browser DevTools retained-memory, evergreen browsers,
hard refresh and visual/audio/input/DPR acceptance are not certified. Night matrix
has p95 spikes up to 121.83ms in software Canvas. Existing general legacy pooling
limitations and custom environmental-map multiplayer restriction remain (previous
phase reports). Snow does not slow projectile ballistics or scripted zipline timing.
Detailed individual weather gameplay scenario measurements and real-browser co-op
torch/time review also remain pending.

## Manual final acceptance procedure
1. Serve with `npm start` or use the live preview. Hard-refresh, start each map,
   verify no console/network errors, correct resize/DPR and map-specific mechanics.
2. Terminal: enter/drive bus, crush ten walkers, check repair/fuel, drift/lead camera,
   sparse route behavior and sound. Neon: signs, electrical zones, elevation/quest.
   Blackwood: traps, tree cover/routes, mud and zipline.
3. Force each weather with F6/console; verify transitions last 5–10s, clear restores
   baseline, rain accuracy/drift/muffle, fog sight and safe closer spawning, outdoor
   storm warning/150 damage/10–20s cadence, snow actor/bus speed and fading tracks.
   Repeat with cosmetics off: fog/lightning mechanics must remain.
4. Force `GAME.dayNight.force(12)`, `(18)`, `(22)`; verify smooth light easing,
   baseline/+10%/+50% spawn rates and new-round counts. Use L to exhaust/recharge
   battery, verify cones and purple Night Stalkers. Test main pause and clock resume.
5. Join a second browser via relay: compare time/weather, per-player torches/battery,
   transition/strike deduplication and late-join state. Custom maps remain solo.
6. On each target evergreen browser, create/maintain 100+ live zombies on valid spawn
   points; record **ten continuous minutes of full-frame gameplay** in DevTools.
   Measure frame p95/long frames, capture heap snapshots before/after GC at intervals,
   inspect detached canvases/listeners and repeated map reset cycles. Resolve spikes
   and prove a memory plateau before marking the 60 FPS/memory gate complete.
7. Record browser versions, hardware, map/settings, performance trace/heap artifacts,
   screenshots/audio notes, actual pass/fail outcomes in this report. Never replace
   this evidence with Node Canvas timing or sparse-render simulations.

See `AGENT_BLOCKERS.md` for environment limitations and `AGENT_DOCUMENTATION.md`
for APIs, controls, defaults and reproduction commands.
