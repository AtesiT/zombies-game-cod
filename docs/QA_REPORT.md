# Game QA and security audit — 2026-10-16

## Executive summary

**11 finding groups fixed**, spanning relay security, malformed input, transport lifecycle, multi-floor combat, co-op revival, persistence, focus handling, kill accounting and unreliable test fixtures.

Final verification:

- **20/20 new regression tests pass** (`npm test`).
- **48/48 selected historical harness suites pass** (`npm run test:regression`). The runner checks output as well as exit status because some old tests print FAIL but exit successfully.
- An additional decal-rendering suite passes.
- **10 selected new tests fail against the original source** in an independent extraction of the starting commit, confirming the tests detect the original defects rather than only exercising the fixes. The transport-race test was excluded from that comparison because the original leaked interval prevents clean exit.
- A 90-second simulation/render soak reports **0 exceptions and no non-finite state**. Sampled JS heap: 15, 20, 16 and 25 MB at 20/40/60/80 simulated seconds; final heap 31 MB. This is a short observation, not proof that all memory is leak-free.
- A separate 40-second lighting-cache run settles at **0 new canvases/frame and 0 gradients/frame** after warmup; its allocation counter stabilizes at about 47.1 MB and JS heap at 18 MB. That counter measures canvas allocation activity, not measured retained memory.
- Round-20 native software-canvas median frame times: HIGH **11.24 ms**, MEDIUM **9.66 ms**, LOW **8.73 ms**. Simulation cost per simulated second: 60 Hz **16.37 ms**, 120 Hz **17.10 ms**. These are environment-specific diagnostics, not browser/GPU performance guarantees.
- ESLint `no-undef`, `no-unreachable`, and `no-constant-condition` checks pass on runtime modules, server and sprite-preview tool with browser/Node globals declared. `git diff --check` passes. Harness dependency audit reports **0 known vulnerabilities**.

## Architecture and review scope

The project has roughly 22,600 lines across runtime code, documentation and top-level tooling, in addition to the historical harness.

| Area | Entry points / responsibilities | Review and verification |
|---|---|---|
| Boot/input | `index.html`, `styles.css`, `main.js`, `input.js`, `touch.js` | Logical/backing-store scaling, fixed-step loop, focus lifecycle, desktop/touch/menu harnesses |
| Simulation | `game.js`, `entities.js` | Rounds, combat, movement, interactions, revival, damage, cleanup; repeated targeted review of changed paths |
| World | `map.js`, `mapData.js` | Collision, DDA raycasts, flow fields, stairs, floor ownership; openings/reachability/stress suites |
| Mechanics | `weapons.js`, `perks.js`, `powerups.js`, `crafting.js`, `mysterybox.js`, `traps.js`, `haunts.js` | State transitions, money/usefulness checks, bounds, floor isolation, rendering and co-op tests |
| Presentation | `art.js`, `spriteData.js`, `lighting.js`, `hud.js`, `audio.js` | Static checks and render/audio-mock harnesses; cache/load measurements |
| Persistence | `settings.js`, `achievements.js` | Malformed JSON shapes, invalid values, unavailable storage behavior and score submission |
| Network | `net.js`, `server.mjs` | Peer authority, input fuzzing, framing, fragmented UTF-8, HTTP access, timeout/reconnect cleanup, live relay tests |
| Tooling/docs | `package.json`, `.gitignore`, `tools/genmap.py`, `tools/preview.mjs`, README, docs, harness manifests/scripts | Tool contracts and documented caveats; deterministic fixtures and repeatable test runner |

Critical paths mapped: boot → menu → begin/reset → round progression; input → player → combat/interactions → rewards; floor links → collision/flow/effects; guest input → relay → host simulation → snapshots/events → guest rendering; localStorage → settings/leaderboard; connection → admission → timeout/close/reconnect.

Risk-led iterations: baseline gameplay suites; network/filesystem review and adversarial regressions; cross-reference floor-context usage throughout combat; re-examine changed code and fixtures; run broad regressions and soak/load diagnostics; final diff/static checks. This is a scoped multi-pass audit, **not a claim of the requested multi-hour schedule or twice reading every line of every file**.

## Detailed findings

### [BUG #1] Severity: HIGH

**Location:** `server.mjs:36` (HTTP handler)

**Type:** Security / Availability

**Description:** The HTTP server exposed repository files, including `.git/HEAD`, and malformed percent escapes could throw outside an error boundary and terminate the server.

**Reproduction Steps:** Request `/.git/HEAD` or `/server.mjs`; separately request `/%` over raw HTTP, then try to load the game again.

**Root Cause:** The repository root doubled as the public document root; URL decoding ran without a catch.

**Fix Applied:** Explicit allowlist for `index.html`, `styles.css`, and direct runtime `src/*.js` assets; reject traversal, backslashes, NULs and noncanonical/symlink paths. Malformed decoding returns 400. Unsupported methods return 405; HEAD and `nosniff` are handled. Port configuration is validated, including ephemeral port 0.

**Tests Added:** Private-file/traversal/NUL/malformed-path requests, public-file availability, methods and post-error server liveness in `tests/relay.test.mjs`.

**Similar Issues Found:** The custom WebSocket parser also needed explicit resource and protocol bounds (BUG #9).

### [BUG #2] Severity: HIGH

**Location:** `src/net.js:67`, `src/net.js:532`, `server.mjs:278`

**Type:** Security / Input validation / Simulation integrity

**Description:** A guest could send another guest host-only application messages such as `full`, `welcome` or `snap`. Malformed input arrays could throw in the host, nonnumeric movement could introduce NaN, and a huge finite aim angle could make repeated angle-normalization loops effectively nonterminating.

**Reproduction Steps:** With three room members, direct `{m:'full'}` from one guest to another. Send an input message with `k:{}`, `mx:'bad'`, or an aim of `1e300` followed by melee against a nearby enemy.

**Root Cause:** Guest messages were not authenticated against the relay-assigned host ID; host input accepted iterable/numeric assumptions without bounds. Finite alone is insufficient for angles later normalized using repeated addition/subtraction.

**Fix Applied:** Relay restricts guest-directed traffic to the host and reserves broadcasts for the host. Guest accepts application messages only from its assigned host; peer traffic cannot be interpreted as relay control. Movement/wheel require finite numbers; keys use bounded arrays filtered to the supported key set; aim is reduced modulo 2π. Right Shift is included in supported sprint input.

**Tests Added:** Third-peer authority rejection, live relay routing and forged-sender checks; malformed-type/numeric/key fuzzing including huge finite aim and movement vectors.

**Similar Issues Found:** Incoming server JSON also needed to reject null/arrays (BUG #9). The original relay already stripped routing envelopes; no claim of a confirmed relay-envelope overwrite vulnerability is made.

### [BUG #3] Severity: HIGH

**Location:** `src/game.js:1913`, `src/game.js:2047`, `src/game.js:2702`, `src/game.js:2729`, `src/game.js:3563`; `src/entities.js:733`, `src/entities.js:2535`; `src/map.js:549`

**Type:** Logic / Multiplayer / Floor isolation

**Description:** Shared view-floor context was used as simulation-floor context. Fire/gas/rifts could damage enemies on the host's floor instead of their own floor; hazards omitted remote players. Remote gunfire used the host's collision map and targets. Melee, shockwaves and frost could affect enemies across floors. Monkey movement/blasts and remote-floor pickups also used the host view. Decals from offscreen events landed on the host's current floor.

**Reproduction Steps:** Keep host on floor 0; place a guest, hazard or attacker on floor 1, with enemies at matching coordinates on both floors. Fire, knife, freeze or detonate; put both players in a hazard's XY footprint; try collecting a drop upstairs.

**Root Cause:** Calls read mutable `map.floor` or `game.player` instead of the acting body/hazard's floor. Raycast APIs exposed no explicit floor argument. Effect context was not set while stepping remote players.

**Fix Applied:** Floor-aware raycast/bullet-blocking API; attacker floor and perks used for hitscan; explicit filters for melee/shock/frost; hazard-floor targeting and damage for every eligible player; remote-floor pickup processing; monkey-floor collision/blast with owner propagation; check blast floor before crawler mutation; per-floor decal canvas selection. Remote simulation sets its effect context and restores host context afterward.

**Tests Added:** Identically positioned cross-floor targets for hitscan, shock, frost, melee, fire/gas/rifts, pickups and blast; remote hazard damage; monkey collision independent of host map view; per-floor decal storage. Historical stairs, guest walk, combat, light-floor, decals and native render suites also pass.

**Similar Issues Found:** Revival independently used XY-only proximity (BUG #4). Less consequential presentation paths still merit a future full floor-ownership audit; this fix does not claim every offscreen particle/audio event has been isolated.

### [BUG #4] Severity: MEDIUM

**Location:** `src/game.js:658`, `src/game.js:3362`, `src/game.js:4187`; `src/net.js:638`

**Type:** Logic / State transitions

**Description:** Co-op revival could reach through ceilings, and progress accumulated for one patient could complete on another.

**Reproduction Steps:** Put a downed player upstairs at the reviver's XY position and hold F. Alternatively, channel most of a revive, switch to a different nearby downed player, and continue holding F.

**Root Cause:** Range checks ignored floors and channel progress was not tied to patient identity.

**Fix Applied:** Shared same-floor/range/eligibility query; defensive checks at actual revival; reset channel progress whenever the target changes in host, remote-host and guest-display paths.

**Tests Added:** Cross-floor refusal and remote patient-switch reset/completion; historical co-op revival suite.

**Similar Issues Found:** General combat/hazard floor errors (BUG #3).

### [BUG #5] Severity: MEDIUM

**Location:** `src/net.js:167`, `src/net.js:269`

**Type:** Async / Resource lifecycle / UI errors

**Description:** Canceling a connection before it opened did not close the pending WebSocket. Stale callbacks could reopen or overwrite a replacement connection. Reconnects could leave intervals alive. Join rejection text was erased during teardown.

**Reproduction Steps:** Open connection A, cancel/reconnect to B, then deliver A's delayed open/close callback. Reject a join as full or let its welcome timer expire.

**Root Cause:** Only attached transport was retained; callbacks had no connection identity check. Error assignment preceded a close routine that cleared it.

**Fix Applied:** Track and retire raw sockets, invalidate callbacks before close, clear timers and pending queues, ignore stale events and close timed-out attempts. Preserve rejection reasons after teardown.

**Tests Added:** Fake transport delivers saved late open/close callbacks after replacement/cancel; assertions cover selected socket, closed state and destroyed ping timer. Host-only rejection test also checks the error text. Existing real-wire/admission/retry suites pass.

**Similar Issues Found:** Idle relay sockets and outbound backlog needed server-side bounds (BUG #9).

### [BUG #6] Severity: MEDIUM

**Location:** `src/settings.js:117`, `src/settings.js:128`, `src/settings.js:169`

**Type:** Data / Configuration validation

**Description:** Fractional enum values and nonnumeric settings could reach array-indexed rendering/control configuration. A stored string `"false"` enabled toggles.

**Reproduction Steps:** Store `{"lighting":0.5,"touchSize":1.5,"dlss":"false","music":"broken"}` under `ndu.settings.v1`, then reload; or call `set('lighting', NaN)`.

**Root Cause:** Clamping did not enforce finite numeric types or integer indices; boolean coercion treated any nonempty string as true.

**Fix Applied:** One validator for load and set, strict boolean/numeric types, finite numbers, integer rounding and bounds. Invalid persisted values retain defaults.

**Tests Added:** Malformed types, NaN/Infinity, fractional indices, out-of-range clamping and default preservation; settings mouse, quality and performance governor regressions.

**Similar Issues Found:** Leaderboard trusted nested persisted entries (BUG #7).

### [BUG #7] Severity: MEDIUM

**Location:** `src/achievements.js:113`

**Type:** Data / Crash recovery

**Description:** Valid JSON containing invalid leaderboard rows could crash sorting/rendering or corrupt the best-round display.

**Reproduction Steps:** Store `[null,{},"bad"]` under `ndu.leaderboard.v1`, then submit a score/open the board.

**Root Cause:** Only the outer array shape was checked.

**Fix Applied:** Filter entries to finite nonnegative fields, retain only supported fields, normalize evac, sort and cap to ten rows before use.

**Tests Added:** Mixed null/object/string/string-number/valid rows followed by submission and ranking checks.

**Similar Issues Found:** Settings validation (BUG #6); achievement IDs already had an allowlist.

### [BUG #8] Severity: MEDIUM

**Location:** `src/input.js:41`, `src/touch.js:70`, `src/touch.js:535`

**Type:** Input / Focus lifecycle

**Description:** Focus loss cleared left-button/key holds but retained right-button aiming, edge presses and stick state. Touch controls could retain held intent after a tab switch.

**Reproduction Steps:** Hold aim/movement/fire or tap a grenade just before switching tabs; return without receiving the original release event.

**Root Cause:** Blur cleanup covered only part of input state; touch had no blur lifecycle cleanup. Hidden/zero-sized canvas coordinates could divide by zero.

**Fix Applied:** Clear keyboard edges, both mouse holds/edges, wheel and stick on blur; touch clears held controls on blur and unregisters the blur listener on dispose. Zero-sized coordinate conversion is ignored; touch-device probing tolerates missing navigator.

**Tests Added:** Synthetic blur and zero-size coordinates; historical touch, touch-context, boot and settings input suites. Diff review caught and removed an over-broad intermediate edit that would have stopped firing when releasing the movement stick.

**Similar Issues Found:** Connection teardown also omitted pending state (BUG #5).

### [BUG #9] Severity: HIGH

**Location:** `server.mjs:76`, `server.mjs:130`, `server.mjs:238`

**Type:** Security / Resource exhaustion / Protocol correctness

**Description:** WebSocket declared frame sizes, aggregate fragments, fragment count and outbound queued bytes were unbounded. Invalid/unmasked/control frames were accepted. UTF-8 characters split between continuation frames were decoded incorrectly. Upgrade `head` bytes were dropped. Cross-site WebSocket connections could drive a LAN relay from an unrelated site.

**Reproduction Steps:** Send a length header declaring a huge frame without completing it; send many empty fragments; split a Cyrillic player's name between UTF-8 bytes across fragments; coalesce the first message with the HTTP upgrade. Attempt a browser upgrade with a different Origin.

**Root Cause:** Custom framing omitted resource/protocol validation and decoded each fragment separately; upgrade handling ignored Node's buffered bytes.

**Fix Applied:** 1 MiB frame/message limit, 4096-fragment cap, 2 MiB slow-client backlog threshold, 256-socket cap and 45-second idle timeout. Require masking and supported opcodes, validate control frames/handshake version/key, preserve fragment bytes until complete UTF-8 decoding, ignore non-object JSON, process upgrade head, validate supplied browser Origin against the serving host. Ping/pong and metadata are bounded/validated; unknown types no longer accumulate in a global warning-key set.

**Tests Added:** Oversized headers and aggregate fragments, empty-fragment exhaustion, unsupported/unmasked/control frames, interleaved ping with fragmented UTF-8, upgrade head, null/malformed JSON, cross-site/version rejection, same-origin success and 500 rapidly coalesced messages plus byte-split input.

**Similar Issues Found:** HTTP exceptions and private-file exposure (BUG #1). This remains a LAN development relay, not a hardened authenticated public service.

### [BUG #10] Severity: LOW

**Location:** `tools/harness/specials.mjs`, `tools/harness/haunts.mjs`, `tools/harness/net.mjs`; new `tools/harness/regression.mjs`

**Type:** Test reliability / False negatives and false positives

**Description:** Special-enemy fixtures immediately started a new round, invalidating their state assumptions; the mix assertion encoded an obsolete balance threshold. The storm test could reuse an already-flashing storm and require an impossible flash increase. Shot-routing fixtures sometimes aimed through a wall because admission placement is random. Some harness scripts returned success despite printing failures.

**Reproduction Steps:** Run specials on the original code; run the broad suite repeatedly and inspect storm/shot-routing failures and exit statuses.

**Root Cause:** Fixtures leaked live round/weather/random-world state into tests of unrelated behaviors; output and process exit status were inconsistent.

**Fix Applied:** Keep fixture intermission open; assert the current documented contract that walker is the largest individual group rather than changing gameplay balance; start weather from clear sky; find a physically clear lane for shot-routing assertions. Specials now returns failing exit status; the new 48-suite runner checks output, status and timeout.

**Tests Added:** Broad runner passes 48/48; the formerly flaky net suite also passed three consecutive isolated runs after lane isolation. No production balance was changed to satisfy tests.

**Similar Issues Found:** New combat regression fixtures also explicitly remove spawn jitter so a floor-isolation test cannot randomly miss its target.

### [BUG #11] Severity: MEDIUM

**Location:** `src/game.js:1780`

**Type:** Logic / Round and score accounting

**Description:** A nuke counted buried, immune miners as killed even though they survived, causing ghost kills and inaccurate round/stat accounting.

**Reproduction Steps:** Put a miner into `ZSTATE.BURIED`, collect a nuke and compare its alive state with `zombiesKilled`/kill stats.

**Root Cause:** The nuke ignored `hurt()`'s result and unconditionally called the death-accounting callback.

**Fix Applied:** Only account a nuke kill when damage returns the killed result. Existing buried immunity is preserved, rather than silently changing damage design.

**Tests Added:** Buried miner survives without increasing either kill counter; all historical gameplay suites re-run after the fix.

**Similar Issues Found:** Blast floor checks previously occurred after crawler mutation (BUG #3).

## Reproduction commands

Use Node 22 or newer for the built-in WebSocket used by the historical live-network tests.

```sh
npm ci --prefix tools/harness
npm test                       # new adversarial + gameplay regressions
npm run test:regression         # 48 selected historical suites, fail-output aware
node tools/harness/decals.mjs
node tools/harness/soak.mjs 90
node tools/harness/leak.mjs
node tools/harness/qualityperf.mjs 20
npm audit --prefix tools/harness
```

Generated screenshots and detailed diagnostic logs were kept out of Git. The report records observed results, not an assertion that random simulation outcomes or timings will be byte-for-byte identical elsewhere.

## Checklist and remaining limitations

| Requested area | Status |
|---|---|
| Input validation | Tested malformed remote controls, keys, values, URLs, JSON and frame headers; not every possible host snapshot schema |
| Error handling | Tested malformed URLs/frames/storage, disconnects and stale transport events; real OS disk-full and browser device failures not simulated |
| Async races | Connection replacement/cancel and existing synchronous admission/retry regressions verified; arbitrary network schedules not exhaustively explored |
| State transitions | Existing rounds, special enemies, crafting, box, stairs, menus, ending and revival suites pass; not a formal state-space proof |
| External APIs | No third-party HTTP gameplay API found; WebSocket open timeout/close and server idle timeout handled; browser WebAudio rejection behavior still needs device testing |
| User data/security | No eval/innerHTML injection sink found in runtime review; canvas/textContent-based UI. Relay input, HTTP exposure and browser Origin improved; trusted host snapshots and debug privileges remain trust boundaries |
| Resources/cleanup | Transport timers/sockets and input blur fixes verified; short soak and bounded lighting-cache allocations observed; no universal leak-free claim |
| Configuration | Settings types/enums and server port validation tested; all internal developer constructors were not fuzzed |
| Load/performance | 500-message burst, fragmented framing, existing 12-player cap checks, 60/120 Hz movement, late-round and native-canvas measurements exercised; no public-internet denial-of-service capacity claim |
| Logs | Selected tests checked for exceptions/FAIL/THREW; static checks clean. Browser console could not be inspected without an installed browser |
| Browser compatibility | Native canvas and WebAudio mock only. Real Chromium/Firefox/Safari, iOS suspension/autoplay and multitouch hardware remain unverified |
| Accessibility | Flagged: canvas-only menus lack semantic screen-reader controls; touch controls are div-based; viewport disables zoom, pointer is hidden and visual/audio cues need accessible alternatives. Not remediated by this bug-fix patch |

Additional retained risks / follow-up:

1. The relay intentionally lacks accounts/passwords and allows room members to use debug actions. Do not expose it directly to the public internet. Origin checks are browser protection, not client authentication. Per-IP/message-rate limiting and authenticated admission require a separate deployment design.
2. Host migration, long background suspension, sustained slow clients, disconnect during every interaction and hostile host snapshots need additional end-to-end browser testing. Output backlog/socket caps reduce resource risk but are not a full rate limiter.
3. `tools/genmap.py` explicitly warns that generation overwrites hand-maintained map changes; that existing content/tooling drift was not resolved. Do not run `npm run map` on the live map without reviewing/merging the output.
4. Residual offscreen cosmetic event/particle/audio floor context and full WebAudio resource disposal deserve dedicated follow-up. This audit fixed demonstrated simulation errors, not every possible presentation ownership issue.
5. The 48-suite runner intentionally selects executable assertion suites. Historical screenshot/benchmark utilities were not all run, and no claim is made that every source line/file received two complete manual reads.

## Follow-up: doors, supplies and combat readability — 2026-10-17

- Closed doors now face the fixed camera consistently. Open-door leaves park on the adjacent wall tile; the middle of the aperture is left clear. Collision still follows the actual doorway axis.
- All six upstairs supply caches remain on their original reachable floor tiles. Added case artwork and battery-lit markings above the lighting layer. Taken state now synchronizes to guests, including when the host is downstairs.
- Preserved throwable shop kinds in map construction; upstairs shops offer Molotovs and gas bombs. Purchases cannot overfill the four-item pocket.
- Capped throw launch speed at 280 world units/second for local and remote throws. Together with existing friction/fuse this keeps unobstructed frag travel below 180 world units, irrespective of far cursor position.
- Fixed screen-to-world aim conversion, refreshed target detection for guests and changed target crosshair colors to red. Other-floor, dead and wall-occluded enemies do not light it up.
- Expanded authored vehicle collision tiles to match the enlarged wreck artwork: car `(28..33,45..47)`, tank `(61..67,42..45)`. These masks affect movement, bullets and navigation.
- Removed only upstairs TABLE tiles; crates, bunks and lockers remain.

Validation: `npm test` **28/28**, including eight new scene/gameplay tests in `tools/harness/scene.test.mjs`. Historical regression runner **48/48**. The first regression run exposed two harness assumptions: old pre-enlargement wreck bounds and radio crates leaking into an isolated supply test; updated those fixtures. Music assertions passed but its live piano scheduler held the test process open; the fixture now stops that timer on completion. After the final aim-head flag cleanup, reran `npm test` (28/28) and the crosshair harness (pass). `git diff --check` is clean.

Inspected a native headless render of the second floor with generator power off. This verifies the cache markings/render path, not browser/GPU behavior or an end-to-end multiplayer play session. Browser play remains a manual check; the local relay/preview can be started with `npm start`.

## Follow-up: pixel achievement badges — 2026-10-17

- Added 37 distinct hand-pixelled achievement badges in `src/achievementIcons.js`.
  Artwork uses integer-aligned canvas rectangles, no fonts or external images.
  Every achievement has its own mapped sprite; round medals use pixel digits.
- List badges use the same silhouette in a muted locked palette and a coloured
  unlocked palette. Unlock notifications reuse the sprite at 3x scale, with
  wrapped descriptions. Achievement IDs, conditions and persistent storage keys
  are unchanged; existing earned progress is preserved.
- Added future-only run skills and optional field assignments to `docs/IDEAS.md`.
  No XP, skill effects, new objectives or reward balance were implemented.

Validation: `npm test` **33/33**, including five new badge tests (coverage and
unique sprites, pixel bounds/scaling/state, locked colours/fallback, saved progress,
list/toast rendering and complete description wrapping). Targeted harnesses:
`ach`, `overlay`, `boot`, `touchctx` — pass. Inspected native renders of all 37
badges, mixed locked/unlocked list and the longest evacuation unlock toast.
Full historical regression suite and real-browser/device rendering were not rerun
for this visual-only follow-up. Native canvas quantizes restored alpha and has a
stale fillStyle getter; tests verify tolerance and actual restored paint instead.

## Follow-up: music listening room, telemetry and evacuation — 2026-10-17

- Third debug tab MUSIC: 20 original procedural scores, 128 bars / eight sections
  each, 5:20–8:49 per score, ~2 h 22 min total. Different keys, instrumentation,
  tempos, rhythms, development and codas; no downloaded/licensed audio assets.
  Local play/stop, repeat/playlist/once, music volume, minute seeking and a victory
  preview. Playback continues with debug closed; reset restores adaptive music.
- Look-ahead AudioContext scheduling avoids long buffers, skips stale backlog,
  disconnects ended voices and cancels old timers/sources on switches. Short
  output fades avoid hard track cuts. Music/master/mute controls are respected.
- Independent team telemetry: 20 wave metrics and cumulative run totals. The
  per-wave report panel has been removed on request — a cleared wave says
  `ROUND N CLEARED` and nothing else. The whole ledger is on the end-of-run
  screen, with a 12-second intermission and no paused combat time; nothing is
  farmable in the range. Accuracy counts rays that hit at least one target,
  not contacts per piercing bullet. Health loss excludes armour and overkill.
  Run totals are transmitted by the host; guests use team labels.
- Run skills: 16 cards, one draft every fifth cleared wave (three cards, one
  pick, `1`/`2`/`3`, arrows + Enter, click, or a 20-second auto-pick). Stats are
  folded into the same block perks use (`perkFx`), multiplicatively; guests get
  the skill mask and the open draft in the snapshot and send their pick back to
  the host, which validates it against the cards it dealt. Tested for damage,
  medkits, points, plank speed, throw refills, blast radius, panel geometry, the
  next-wave freeze and the wire round trip (`tools/harness/skills.test.mjs`).
- Major-key ~18-second evacuation melody, bells and warm final chord replace the
  sad score. Guest and late-snapshot playback is guarded once per run; repeated
  snapshots do not replay the cue. Auditioning it does not alter evacuation state.

Validation: `npm test` **63/63**, including the new skills suite;
full historical regression **48/48** before the final small cleanup (counting monkey
throws, report-hide reset and removing redundant per-frame once-mode restoration).
After those edits, reran the main suite. New coverage: all 20 complete arrangements,
valid audio scheduling for every score, one complete ~9-minute simulated score
with <100 live voices, repeat/playlist/wrap/once, seeking/fast switching/cleanup,
third-tab geometry/input and guest-local controls, faders/major cue, report/reset/
intermission isolation, real armour/damage/throws/points and piercing accuracy,
guest snapshot totals, once-only evacuation and report dismissal without firing.
Native renders of the music tab, wave report and final evacuation totals inspected.
`git diff --check` and changed-module syntax checks pass.

Not claimed: real-browser acoustic listening, mobile-speaker mix evaluation,
background-tab timer behavior across browsers, or a live two-browser audio session.
The WebAudio stand-in validates scheduling/routing/state, not musical taste or
real-world loudness. The listening room is deliberately provided for user audition.
Guide/catalogue: `docs/MUSIC.md`.

## Follow-up: skills off, bigger hounds, all-time diary, phone pass — 2026-10-17

- **Run skills are switched off, not removed.** `SKILLS_ENABLED = false` in
  `src/skills.js` is read once per reset into `game.skillsEnabled`; `endRound`
  skips the draft and `_offerSkillDrafts` refuses early. Nothing is dealt, no
  chips are drawn, no run carries skills; the pool, effects, co-op mask/draft
  wire, HUD panel and 12 tests stay in the tree. Turning it back on is one line.
  A new test pins the default-off contract; the existing machinery tests enable
  it explicitly on the game they build.
- **Hellhounds are big animals now.** `scale` 1 → 1.7 and the collision radius
  6.0 → 8.6; `hitScale: 1.6` scales both the aim-assist head/body circles and
  the hitscan boxes, so a bigger body is a bigger target. The dog is the only
  sprite drawn in its own 18×12 frame (`framed: false`, never read before); it
  was hanging from the human 20×22 shoulder line and floating ~9 px above its
  own shadow. Unframed bodies are now centred on the entity, which puts the
  paws on the ground line. Verified against a 4× native render beside the
  walker (20×22 @1) and brute (20×22 @1.32).
- **All-time statistics.** New `src/lifetime.js` (`ndu.lifetime.v1`, 24
  counters, sums for totals and maxima for bests, tolerant of a corrupt or
  older file). One bank per run, guarded by `_banked`, on death (solo and the
  last co-op body), evacuation and *quit to menu*; range runs are never banked.
  The front page shows runs / best round / total kills plus evacs, rounds
  cleared and time played under the title. The new `STATISTICS` row (index 4)
  opens a two-column page that fits without scrolling: 8 run-level figures,
  16 cumulative ones, best three runs, `ESC` or tap to close. Backed by a new
  `tools/harness/lifetime.test.mjs` (5 tests) and reachable from the menu in
  the touch tests.
- **Phone pass.** `touch._menuOpen()` knew only about the front door, settings,
  pause and the bench: the death screen, controls page, debug panel, card
  draft, achievements and statistics were all "playing". Consequences fixed:
  - the whole panel (sticks, 8 buttons, pause) is hidden whenever a menu, pause,
    death screen, controls/debug/craft page or draft is up, and every held key
    is released on the way in; it returns on the first frame of a round;
  - the aim stick and aim assist no longer move the cursor while a menu is
    open -- it used to be dragged onto the nearest zombie, so a tap on a row
    clicked wherever that zombie was on screen;
  - a tap is a click in any menu now, not a trigger pull (the death screen no
    longer fires the gun);
  - `ACHIEVEMENTS` scrolls by drag and closes on a tap that did not drag
    (`ESC` still works); `STATISTICS` closes on any tap. Previously the
    achievements page was a trap on a phone: no wheel, no keyboard, no way out.

Validation: `npm test` **73/73** (63 before; +5 lifetime, +4 touch, +1
skills-off default) and full historical regression **48/48**, including the
touch harness with its new hide/show, menu-cursor and drag-scroll assertions.
Native renders inspected: front page with the diary headline and seven rows,
the statistics page with best nights, and a 4× crop of walker/hound/brute.
Not claimed: a real phone or browser run (none in this sandbox); iOS safe-area
and momentum scrolling remain covered only by geometry and stubs.

## Review pass: no lost inputs, no lost progress — 2026-10-17

A full read of the tree with one rule for the fixes: an input the game asked for
must land exactly once, and a night that ended must be written down exactly
once.

- **A new run after QUIT TO MENU inherited the old one.** `_quitToMenu` banked
  the night but left the world on the table (`started = false`, `_banked =
  true`). Choosing SOLO then walked back into the half-played map: doors, guns,
  points and tallies from the previous run, and because `_banked` was still
  set, the *next* night was never written to the all-time diary at all. The
  probe read `{banked: true, round: 1, kills: 42, points: 3000}` on a fresh
  SOLO. A quit is now a full stop: it banks, closes the wire and calls
  `reset()`. `begin()` also clears `runMetrics`/`_banked`, so any door into a
  run starts with an empty ledger.
- **RESTART erased the night that QUIT would have banked.** One row apart in
  the same pause menu, two different outcomes for the same decision. `_restartRun`
  now banks first and is the single path used by the pause row, the `R` key and
  the death screen.
- **The death screen had no way back to the front door.** `Esc`/`Backspace`
  now leaves the run (banked, same as QUIT) and the prompt says so; a tap still
  starts a new night, which is what a thumb expects.
- **ESC in the room list could be swallowed.** Leaving was handled *after* the
  row under the cursor, so ESC on REFRESH re-asked for rooms and ESC on the
  "no rooms" notice did nothing. ESC is now handled first and always returns
  to the front page, with the cursor on MULTIPLAYER; BACK does the same (it
  used to land on TEST RANGE because the index was written down as `1`).
  Closing ACHIEVEMENTS or STATISTICS finds its row by id (`_menuRowIndex`).
- **RESTORE DEFAULTS wiped every setting on one press.** It is the only
  destructive row in the panel and a thumb can land on it while scrolling. It
  now asks twice: the first press arms the row for four seconds (`SURE?`, an
  amber hint line), the second on the same row resets; closing the panel or
  waiting disarms it.
- **One mouse click on the touch panel was two presses.** The panel sits above
  the canvas and Input listens on the window: pressing FIRE fired the button
  *and* a second shot at the pointer. `_onMouseDown` now prevents the event
  from reaching the window, and the window drag/release handlers are stored so
  `dispose()` removes them.
- **Losing focus left a solo round running.** The window keeps drawing while
  another app has the focus. `pauseForFocusLoss()` pauses a solo round, declines
  in co-op (the world belongs to the host), and does nothing on menus, drafts or
  the death screen; `src/main.js` wires it to `blur` and `visibilitychange`.
- **One badge could never be earned.** `daily_dogged` ("finish a daily
  challenge") shipped before daily challenges existed, so the wall showed a
  badge no code awarded. It is retired, following the precedent already in
  `docs/IDEAS.md`; `Achievements.reset()` now also clears queued toasts. A new
  test scrapes `src/` for literal `unlock('id')` calls and fails if a badge has
  no award site (or an award names a badge that is not on the list).
- **Smaller corrections.** The achievements page advanced `game.time` a second
  time per frame (all menu blinking ran double speed after a visit); the
  multiplayer hint said "up to four" while `MAX_PLAYERS` is 12; the skills
  catalogue still described sixteen ✅ cards as live when `SKILLS_ENABLED` is
  false; the one-line "pause menu's last row" comment sat above the wrong
  function.

Validation: `npm test` **90/90** (73 before; +4 menu navigation, +3 focus,
+3 settings reset, +3 run lifecycle, +3 achievements, +1 touch mouse press)
and the full historical regression **48/48**. Native renders inspected: the
front page with its diary headline, SETTINGS scrolled to the armed row
(`SURE?` + hint), the pause menu, and the death screen with the new
`ESC — FRONT DOOR` line. `git diff --check` clean, `node --check` on every
changed module.

Not claimed: a real browser or phone run (none in this sandbox); window blur
and `visibilitychange` firing order across browsers is covered by the method's
own rule, not by a live window.

## Pass: the roster, the wardens and a phone UI that can be left — 2026-10-22

Found by playing the build on a 430 × 930 layout, by reading the tables, and by
turning the panels into numbers.

- **The widow's venom did nothing.** Regen healed 30 a second straight through a
  4-a-second bleed, so nine seconds of poison left the bar exactly where it
  started: the one thing the bite was meant to cost — the next few seconds —
  cost nothing. Regen now holds while `venomT > 0`, and the bleed stops at a
  fifth of the bar (`hp > floor` rather than a clamp: the clamp version healed a
  body already under the floor back up to it, which is the worst possible bug in
  a poison). The HUD shows the clock as a green strip under the health bar and
  `VENOM Ns` where `RECOVERING` would be, because a held regen with no
  explanation reads as a bug.
- **The First had no `boss` flag** while `bossForRound(25)` handed it a warden
  round. That is deliberate — it also walks in the ordinary horde from round 18
  — so `_spawnBoss` sets `z.boss` on the body it spawns, and the bar, the revive
  pips and the banner read the flag on the zombie rather than the type. The
  roster test asserts the eight warden-only types carry `boss: true`.
- **Every warden round hid the warden's name.** `_spawnBoss` puts the name up for
  four seconds; `startRound` then showed `ROUND N — something is out there` in
  the same frame (every warden round is also a fifth round, so every one of them
  is a dog round), and on most of them the radio's `THE RADIO` banner followed a
  few lines later. The one thing a warden round is about was the one thing never
  said. `bannerShow` now takes `queue: true` for quiet banners, which wait
  behind whatever is being read (three at most), the round banner stands down on
  a warden round, and a `reset()` empties the queue so a waiting banner cannot
  walk into the front door.
- **The pause menu did not fit a phone.** Its rows were a fixed 268 × 38 and
  inherited the menu scale, so on a 360-pixel screen they came out 402 pixels
  wide and hung off both edges; the list also ran down into the health bar. The
  width is clamped to the panel and the pitch to the room above the HUD.
- **The controls list cut its answers.** On a narrow panel the *key* column was
  the one that got clipped ("WHEEL O…", "ARROWS + ENT…"), which is worse than a
  clipped label: a key you cannot read is a wrong answer. Rows now carry a short
  form for narrow panels, the key column is never cut, and the title no longer
  runs into "ESC OR CLICK TO CLOSE" (that line moves to the footer when the head
  has no room for it).
- **The music tab's second line ran under its own scroll counter** ("1-12 / 26")
  on a phone; the header is taller and the line is cut to the room.
- **A landscape phone had no readable front page, pause menu or statistics
  page.** At 640 x 360 the menu scale is 1.39, so the page is 460 x 259 units:
  the wordmark alone took 100 of them, the eight rows and the diary and the
  footer needed more than were left, and the rows were printed over the
  wordmark at one end and over the footer at the other. The front page now
  measures itself (a compact wordmark, the diary tucked under it, no
  best-round line) and lays its rows out from the room that is actually left.
  The pause menu turns into two columns of three when six rows would only fit
  at 15 pixels each, and the statistics page turns its long column into two
  when the panel is wide and short. The title screen's key list falls back to
  short lines rather than running 500 pixels wide on a 360-pixel screen.
- **The Knight was a helm on a black shape.** The helm was redrawn a pass ago,
  but its body was drawn mostly as outline: at the scale the game draws it
  (three to five pixels per sprite pixel) the chest and legs came out dark and
  the "knight" read as a helmet floating over a shadow. The plate is now a
  filled V with a lit near edge, a belt in shadow under it and greaves on the
  legs -- drawn *on* the three-pixel leg, not around it, or the knight stands
  like a tripod.
- **The achievement card was printed over the warden's health bar.** Both sit in
  the top band of the screen, and the card is drawn last, so a warden round that
  also unlocked an achievement had a 72-unit card over the name and half the
  health of the thing you were fighting. The card now steps below the bar (and
  below the round banner behind it).
- **The way-out chip was printed over the corner of the panel under it.** It
  lives in the top-right of the *screen*, in screen units; the panels are drawn
  in menu units and centered, so on any screen where a panel is nearly as wide
  as the glass its header lands underneath. That was every phone: the
  achievements counter ("0 / 36"), the outfits counter ("0 / 10 EARNED"), the
  debug title and "THIS MACHINE" all had the chip across their last letters.
  Those panels now stack the counter under the title when their corner is under
  the chip, and the debug title is measured down to a shorter one
  ("DEBUG PANEL" on a phone). A test walks each panel and fails on any label
  inside the chip.
- **The menus told a phone to press keys it does not have.** "ARROWS + ENTER
  WORK HERE" on the pause menu, "` / ESC: CLOSE" and "W/S: PICK  ENTER: DO" in
  the debug panel, "W S PICK · A D CHANGE" in settings -- and the one key that
  mattered, the backtick that opens DEBUG, was invisible on glass. A touch
  device now reads "TAP A ROW TO PICK", "TAP A ROW · TAP A TAB",
  "× IN THE CORNER CLOSES" and "TAP A ROW · DRAG A SLIDER", and the per-row key
  letters are not drawn at all.
- **The Colonel was the Warden's helm with a cap drawn on top.** Two wardens,
  a hundred rounds apart, in the same silhouette and the same green -- and
  because the helm covers the zombie's own head, the cap had nothing to sit on.
  (This is the "something on its head" complaint about the Knight line, in its
  last form.) He has a head of his own now: a bare jaw under a peaked cap, a
  cuirass with its buttons, braid on the shoulder, a sabre. The Warden keeps
  the helm and the lantern. The README's "35 % heavier per cycle" was checked
  against the code and pinned by a test: it is 35 % more *health* on round 55
  and 70 % on round 100, and the wording said "heavier", which reads like
  damage too.
- **The achievement card was printed over the corner of the screen.** It was
  a fixed 360 x 72 rectangle whose left edge was `w - 374`: on a phone with 360
  units of drawing space the card *started* outside the glass, and on a laptop
  it covered the bottom of the minimap, the SOUND IS OFF chip and the floor
  tag. The card now measures itself, sits under the map and the chip, steps
  under a live round banner rather than printing through it, and the floor tag
  steps under *it*. A round banner's title is measured down to the glass too:
  THE BELLRINGER at 46 px is 386 units on a 360-unit phone.
- **The death screen ran off the bottom of a small phone.** At MAX PICTURE SIZE
  on a 360 x 560 canvas the one-column ledger (22 rows at a fixed 15) went
  through the prompt and the last six rows were painted off the glass, and the
  40 px "YOU DIED" was wider than the screen. The pitch is now measured against
  the room above the prompt, the ledger is cut rather than spilled (and says how
  many rows it left for the all-time page), the headline shrinks to fit, and the
  prompt picks the longest form of itself that fits. The all-time page had the
  same trouble the other way up -- a short panel squeezed the long column into
  the footer and "LONGEST RUN" was cut to "LONG..." -- so its rows are measured
  too, and every label has a ladder of true short names before an ellipsis.
- **The archer carried a walking stick and the drummer a box.** The bow was a
  straight stick with a gap beside it and the drum hung off the right hip. The
  bow is now a curve with a string across it and a nocked shaft; the drum is
  slung across the belly with its rope over the shoulder. Both were checked at
  12× and in a live render.
- **A beekeeper's hive was reachable only if the keeper was close enough to kneel
  in the 60–520 px band**; the test that spawned it 200 px away across a wall
  never saw a box in 20 s. The rule is right (it has to arrive to place it); the
  test was wrong, and now spawns one keeper at 70 px for 45 s.
- Phone, from the previous pass and still covered: every panel has a visible way
  out, DEBUG sits in the pause menu, the pause chip is top left, flick-scroll
  never counts as a press, and one wheel notch is one row
  (`tools/harness/phoneexit.test.mjs`, 9 tests).

### The four things a player found in one evening

Reported in the same breath as the roster work, all four with a root cause that
was nobody's guess:

- **The skeletons did not look like skeletons.** Four white bodies under a black
  outline read, at three pixels per sprite pixel, as men in dark caps. They are
  drawn from bone now: a skull with two deep sockets and a tooth row in shadow,
  a spine, four ribs with gaps between them, a pelvis, and one-pixel limbs. The
  old versions are gone; there is no white walker with a skull printed on it.
- **The debug list could not be scrolled or used with the mouse.** It was not
  the layout: hover re-picked the row under the pointer on *every* frame, so an
  arrow key moved the selection and the pointer put it back before the frame
  ended. Hover now picks only while the pointer moves, and a press always lands
  on the row under it.
- **SETTINGS and TEST RANGE were slow the first time and off centre.** Two
  separate defects. The panel was inset 44 px to dodge the BACK chip and so sat
  18 px low on every screen there is -- it is centred now, and the panel's
  height already lives inside the chip's band. The slowness was the first
  `new GameMap('range')` of a page: 3 800 tiles painted by hand, 124 ms, once.
  The map is built during menu idle now: the first press costs 7 ms instead of
  124, and nothing else in the panel was ever slow (opening SETTINGS costs a
  11 ms worst frame).
- **The sound went missing.** Two real ways to silence an engine that looks
  healthy: a context that is built but never starts (the old code waited for a
  *second* gesture, which is indistinguishable from no sound at all -- the clock
  is now asked to start again for two seconds), and a reverb send that was open
  with a null impulse for the whole menu, because the convolver was filled
  before the engine claimed to be ready.
- Along the way: the range HUD printed `SCRAP undefined` (a fresh body now
  starts with scrap and medkits), and the arrow keys lost to a resting mouse in
  the front door, the wardrobe and the skill cards, exactly as they had in the
  debug list.

### The second report: three things that were still wrong

- **The pause highlight flew to the first plate and came back.** The pause
  screen is painted in design units and the pointer arrives in screen units;
  the painter handed the raw pointer to the hit test with the raw design size,
  so on any screen whose scale is not exactly 1 the test landed *between* the
  rows and the highlight fell back to whatever the keyboard had selected. The
  hit test happens in screen space now and the result is handed to the painter;
  a pointer in a gutter lights nothing, and a pointer outside the menu lights
  nothing either. The wardrobe had the same defect and the same fix.
- **The first press of anything stalled.** Three separate one-time costs were
  being paid inside the player's click: the audio context was created there
  (which starts the browser's audio service -- seconds of it on a machine with
  a Bluetooth output), 1 500 sprites became textures on the first gameplay
  frame (a browser only uploads a canvas the first time it is drawn), and the
  first range of a session painted 3 800 tiles. The context is built at load,
  the sprites are drawn once into a scratch canvas in idle slices while the
  menu is up, and the range map is built in the same idle window. A frame over
  450 ms is now named on screen and in the console, so the next freeze can be
  identified instead of guessed at.
- **The sound.** Rendered through a real Web Audio implementation the engine
  is not silent: every effect has a non-zero path to the output (measured
  peaks 0.19-0.89), and the ambient bed and elegy sit under them. What is left
  is the environment, so the game now diagnoses it instead of shrugging:
  the settings footer carries one line -- NOT STARTED / MUTED / BLOCKED BY THIS
  FRAME / PAUSED / MASTER 0 / EFFECTS 0 / RUNNING, with both faders -- and the
  line is a button that puts the faders back, unmutes, starts the clock and
  plays a shot, a reload and a purchase so the answer is heard rather than
  read. The corner chip says the same thing, is a button too, and a title
  screen inside a preview frame carries a line across the menu explaining that
  the frame blocks audio and the game has to be opened in its own tab. One
  fader at zero used to have a clean bill of health; it no longer does.

Validation: `npm test` **167/167** and the historical regression **48/48**.
Thirty-two of the tests are new, including
`tools/harness/regressions.test.mjs` (4 -- the settings panel centred within a
pixel at eight screen sizes, the arrows moving the front door, the wardrobe and
the debug list with a mouse parked on them, the range HUD printing numbers and
never `undefined`, and the prewarmed range being handed over rather than built
on the press), and `tools/harness/roster.test.mjs` (14 — the warden
line from 10 to 55 and its wrap, the second-cycle health bonus, no two wardens
sharing a sprite set, escort sizing, every arrival round, four
sprites per body, the verb table, the hive and its bees, shootable silk, the
venom's clock and its place on the HUD, the warden's banner, the banner queue)
and `tools/harness/menutext.test.mjs` (8 — every label on every panel turned
into a box, 1:1 sprite or scaled `fillText`, failing on any overlap or any label
off screen at eight screen sizes -- the two a phone gets at MAX PICTURE SIZE
and a phone held sideways -- plus a state-by-state sweep of the HUD's two edge
bands, a check that the all-time page never has to cut a label, and a
landscape-phone pass that walks every menu and pause row through its own hit
test: the row that is drawn is the row that is pressed, no label under the
way-out chip, and a faked touch device checking that the menus stop naming
keys), and
`tools/harness/toast.test.mjs` (3 -- the achievement card and the round banner
stay on the glass and off the map, the sound chip, the floor tag and a warden's
health bar). A label is
off screen when any of its letters is: a wordmark clipped at the top of the
glass is the same bug as a row printed through the footer. The menutext sweep was written
against the bugs above and was checked against the old behaviour twice:
restoring the fixed 268-wide pause rows fails it with "row 0 is 402 wide on a
360 screen", and moving the all-time footer up into its own table fails it with
"TIME over NO NIGHTS YET".

Native renders inspected at 800 × 500, 430 × 930, 390 × 844, 360 × 640,
360 × 560 (the last two at MAX PICTURE SIZE), 640 × 360 and 568 × 320 (a phone
on its side): the venom strip and label under the health bar, the
controls list with its short-form key column and its footer, the pause menu
fitting inside a phone, the DEBUG zoo list with its scroll rail and counter, the
boss bar clear of the sound chip and the map, the pause chip and the map in
their corners, the death screen's cut-down ledger, the all-time page with no cut
labels, the achievement card clear of the minimap, the sound chip and the
round banner on a phone, a laptop and a phone on its side, and the new archer
and drummer sprites at gameplay scale.

Not claimed: a real phone or browser run; drag physics on real glass; audio
output.
