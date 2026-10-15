# Phase 1 report — map selection

Date: 2026-10-15. Implementation and automated checks complete; manual browser verification pending.

## Implemented

- JSON registry with three distinct basic playable maps and metadata/descriptors/thumbnail assets.
- MapManager with validation, events, current selection, loading/error/retry state and stale-response protection.
- Canvas selector using existing keyboard/mouse/touch menu behavior; original campaign accessible even if registry loading fails.
- Generic configured GameMap floor adapter, map-aware session reset, normal zombie waves/spawn navigation.
- Null-safe Mystery Box interaction, lighting, rendering and minimap for maps with no box.
- Legacy campaign/range preserved; multiplayer explicitly retains original campaign.

## Files

Created src/utils/EventBus.js; src/systems/map/{MapManager,MapSchema,MapSelectionUI}.js; assets/maps/registry.json; three assets/maps/*/thumbnail.svg; tests/maps.test.mjs; AGENT_DOCUMENTATION.md; AGENT_DEVIATIONS.md; this report.
Modified src/{game,map,hud}.js; tools/harness/{boot,frontmenu}.mjs. Discovery and plan documents were created in the prior turn.

## Verification actually run

- `node --test tests/maps.test.mjs`: 4/4 passed. Includes schema/duplicate/invalid-coordinate checks, failed load recovery, event unsubscribe, stale fetch rejection, all maps selected through keyboard menu input, six simulation seconds per map, zombies spawned, powered render, reset, original range and campaign.
- boot.mjs: PASS; frontmenu.mjs: PASS; menu.mjs: PASS; range.mjs: PASS (31 racks, 18 creature buttons).
- `git diff --check`: clean.
- npm start: server bound to 0.0.0.0:8080; registry fetched successfully over HTTP. Live preview left running.
- No browser DevTools or 10-minute memory/performance verification performed; not claimed passed.

## Acceptance status (Phase 1 only)

- [x] External JSON map data and required catalog fields.
- [x] Selection UI lists and loads the three configured scenes in integration tests.
- [x] Additional maps using supported tile schema require only a JSON entry/assets.
- [x] Current map data and subscription events exposed by MapManager.
- [ ] Manual browser verification across all maps and evergreen browsers.

## Next phase / known limitations

Phase 2 must expand Terminal Transit beyond its basic depot/street/plaza geometry, add subway/barriers, data-driven object/interaction tables, two power switches and three upgrades, wall buys/doors and stations; implement vehicle/controller/input/audio/crushing/fuel/HP and sparse dynamic navigation repair. Existing normal zombie cap stays 40. Other unique mechanics, weather/time and entity pooling remain future phases.

All maps currently use one 72×50 floor; metadata references are informational. No bus or hazards exist yet. Extend the schema and generic adapter rather than checking IDs. Add reachability validation and map authoring feedback. Preserve null safety for optional objects. Update co-op protocol before enabling custom maps for network sessions. See AGENT_DEVIATIONS.md for staged scope decisions.
