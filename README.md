# Nacht der Untoten — top-down CoD zombies

A 2D top-down survival wave shooter in the spirit of the very first *Call of Duty: World at War*
zombies map, **Nacht der Untoten**. Hand-written vanilla JavaScript + HTML5 Canvas — no build
step, no dependencies, no asset files (all pixel art and all sound are generated in code).

> **Кратко по-русски.** 2D-игра с видом сверху в стиле режима «Zombies» из Call of Duty
> (первая карта Nacht der Untoten). 15 видов оружия, 8 перков, Mystery Box с wonder-оружием,
> пауэр-апы, 26 типов врагов (тотемы, могилы, призраки с саблей, снеговик, рыцарь, молнии),
> погода с грозой и туманом, говорящий громкоговоритель, генератор электричества, верстак с крафтом, пасхальное яйцо,
> радиособытия с ящиками снабжения, радиостанция на крыше (починил за скрап — ящики каждые
> два раунда), финал с вертолётом (раунд 25 + 4 маяка, зелёный фальшфейер, 2 минуты до посадки,
> в кооперативе — голосование большинства, экран EVACUATED с особой отметкой в рекордах),
> навыки забега (после каждого пятого раунда — одна из трёх карт), достижения и таблица
> рекордов. Вся графика — процедурный пиксель-арт, весь звук — синтез
> через WebAudio, сборка не нужна.
> Запуск: `python3 -m http.server 8080` или `node server.mjs`, затем открыть `http://localhost:8080/`.

---

## Run it

```bash
# any static file server works; the game is plain ES modules
python3 -m http.server 8080          # or:  node server.mjs 8080
# open http://localhost:8080/
```

Nothing to install, nothing to compile. (A server is required because the game uses
ES modules — opening `index.html` from `file://` will not work.)

## Multiplayer over the local network

The bundled server doubles as a relay, so co-op needs no extra software:

```bash
node server.mjs 8080
# it prints the addresses it is listening on, e.g.
#   on your network:  http://192.168.1.5:8080/   (multiplayer ready)
```

1. Whoever runs the server picks **MULTIPLAYER → HOST A GAME** and starts playing.
2. Everybody else — laptops, phones, tablets on the same wi-fi — opens that address
   and picks **MULTIPLAYER → JOIN A GAME**, then the room.
3. **You can join mid-round.** Latecomers are dropped in next to the host with 500
   points and whatever the round has left to throw at them.

Up to **twelve** players, and every hosted room draws a fresh five-letter code.
The host simulates the world and the rest draw snapshots of it 20 times a second,
so a phone makes a perfectly good second player. Going down is not going out: a
downed player bleeds for **60 s** and only the clock can finish them — teeth
cannot hurry it. Any team-mate, host or guest, stands over the body and holds
`F`: revival is a **10 s channel** (5 s with Quick Revive), shown as a ring on
every screen. A body that bleeds out comes back at the top of the next round
with its sidearm only. Guests fight with the same hands as the host: `G` throws
whatever is in their one throwing hand -- frag, molotov or gas -- through the
host's physics. Buying a different kind replaces what is in it.
Points are per player, rounds are shared, and the horde grows by 32 % for every
extra body in the building. If the host quits, the relay hands the room to the
longest-standing guest.

Joining is watched from the guest's side: it asks the host in, retries once after
2.5 s if the welcome never comes, and after 9 s says **HOST DID NOT LET YOU IN**
plainly and returns to the room list instead of spinning forever. A repeated ask
makes the host resend the welcome, never build a second body. And everything the
snapshot carries — grenades, power-ups, monkey bombs, fires, rifts, gas — is
rebuilt on the guest into the exact shape its renderer reads: one wrong shape off
the wire is not a cosmetic bug, it is a frozen picture.

## Phone / touch controls

On any touch screen the panel appears by itself (`SETTINGS → ON-SCREEN CONTROLS`,
`AUTO` by default): a stick to walk with on the left, a stick to aim with and the
FIRE / F / R / Q / dash / throw / medkit / knife buttons on the right, plus a
pause button in the **top left** corner — the map owns the right one — parked off
the physical corner of the glass, clear of notches and rounded edges, and big
enough for a thumb. A tap anywhere else reaches the game underneath, so the
menus work with a thumb; a *flick* that scrolls one of them is a scroll and not
a press, so nothing is chosen until the finger comes down again. `AIM ASSIST`
points the barrel at the nearest walker while you are not touching the aim
stick, and no mouse pointer is drawn on a touch screen at all.

Menus are drawn through a scale that grows as the screen narrows (`src/ui.js`):
a phone gets the same layout 1.5× bigger, a desktop gets exactly the 800 × 500
design, and every hit-test divides the pointer by the same factor, so the row
you press is the row you see. The settings list scrolls by dragging it (a drag
that scrolls does not also flip the toggle it started on), and on a narrow panel
a row puts its slider on a second line under its label instead of printing the
two on top of each other.

Every full-screen panel — settings, controls, the debug list, achievements,
statistics, the wardrobe — carries a **BACK / X** chip in the top-right corner,
because a phone has no ESC and "O / ESC — back" was a sentence it could not act
on. The wheel moves one row a notch (in the settings, the achievements and the
debug list alike), and every list answers to all four arrows. The debug panel is
reachable without knowing any shortcut: `PAUSE → DEBUG PANEL`.

The picture is not a fixed 800 × 500 box any more. The canvas takes the shape of
whatever it is sitting in — a phone held upright, a laptop, an ultrawide — and
keeps the same *amount* of world on screen by trading width for height, so a tall
screen sees more of the corridor above you instead of black bars top and bottom.
`SETTINGS → PICTURE SIZE` then zooms the whole picture (SMALLER / NORMAL / BIGGER
/ BIGGEST): on a phone **BIGGER** is usually the difference between reading a
zombie and guessing at one, and the touch panel is measured from the same view,
so the buttons keep their place at the bottom of the glass.

The panel belongs to the round, not to the screen: the moment a menu, the
pause, the crafting bench, the controls page, the debug panel, the card draft
or the death screen is up, every stick and button goes away, any held key is
let go and a tap becomes a plain click. That is what makes the front page and
the full-page lists usable under a thumb — and it stops a tap on the death
screen pulling the trigger. `ACHIEVEMENTS` scrolls by dragging and closes with
a tap that did not drag (there is no `Esc` on a phone); `STATISTICS` fits on one
page and closes on any tap.

## Controls

| Input | Action |
| --- | --- |
| `WASD` / arrows | Move |
| `Shift` | Dash — a step of about one tile in the direction you are walking (or facing), then five seconds before the next. The clock and your armour share the two thin bars above the health |
| Mouse | Aim |
| Left click | Fire (hold for automatic weapons) |
| `R` | Reload |
| `1` / `2` | Pick a carried weapon slot (while skill cards are up, digits take a card) |
| `Q` | Flip between your two carried guns (0.35 s) |
| wheel / `[` `]` | Dig through the whole armoury (0.9 s swap) |
| `E` | … · **arm a trap** · pack-a-punch the gun in your hands |
| `V` | Knife — short range, big points, never runs out |
| `G` | Throw what is in your one throwing hand — a frag grenade, a molotov (fire that knows its thrower) or a gas bomb (a cloud that slows and bites). Buying another kind replaces it; `X` and `B` still work as aliases |
| `H` | Use a medkit |
| `E` | Buy weapon / ammo · open a door · drink a perk · spin the box · throw the power switch · open the workbench · arm a trap · pack-a-punch · **hold** to rebuild a barricade |
| `ArrowLeft` / `Right` + `Enter` | Browse and take a skill card (a click or tap works too) |
| `M` | Mute · `P` / `Esc` pause (also on the touch panel) · `R` restart after death |
| `F` | Same as `E` — and how you revive a downed team-mate in co-op (**hold**: 10 s, or 5 s with Quick Revive) |

The pause screen is a menu you can click (or thumb): five rows — resume, settings,
controls, restart the run, return to the front page — each with its old shortcut
printed on the right, because the keyboard way still works.

Leaving is never a way to lose a night: **RESTART** (or `R`) writes the run into
the all-time diary before it wipes it, and **QUIT TO MENU** resets the world, so
the next SOLO starts with 500 points and an empty ledger instead of the last
run's wallet. On the death screen, `Esc` (or `Backspace`) goes back to the front
page without starting another run — a tap still starts one, because that is what
a thumb wants there.

## Run skills: one card every five rounds (switched off for now)

> **Off at the moment.** The pool, the draft, the effects, the co-op wire and
> the tests all stay in the tree, behind one switch: `SKILLS_ENABLED` in
> `src/skills.js`. While it is `false` no cards are dealt, the HUD draws no
> skill chips and a run carries no skills. Everything below describes what
> happens the moment it is switched back on.

Rounds 5, 10, 15 and so on end with three cards and one choice. Sixteen cards are
in the pool; a run collects six or seven of them, so no two nights turn you into
the same character:

| Card | Effect |
| --- | --- |
| **Deadeye** | +15% damage, +25% more on headshots |
| **Fast Hands** | reload 20% faster |
| **Hair Trigger** | automatic fire 10% faster |
| **Cold Blood** | stand still 0.6 s: the next shot does +30% |
| **Last Stand** | +25% damage below 35% health |
| **Long Stride** | walk 8%, sprint 6% faster |
| **Second Wind** | below 30% health: +20% speed for 2 s, once a round |
| **Iron Hide** | +30 maximum health |
| **Survivor** | regeneration starts sooner and runs faster |
| **Hardened** | take 12% less damage |
| **Field Medic** | medkits heal 45% more |
| **Engineer** | planks go back on 35% faster |
| **Scavenger** | every point you earn counts 15% higher |
| **Demolitionist** | frags blast 20% wider and 15% harder |
| **Strong Arm** | throwables fly 25% faster, so they land farther |
| **Pack Mule** | one extra throwable in every between-round refill |

Pick with `1` `2` `3`, `←` `→` + `Enter`, or a click/tap on the card. The next wave
waits while the cards are on the table, and a twenty-second clock picks for you if
you walk away. A skill is not a perk: nothing is bought, it multiplies with the
machines rather than replacing them, and it lasts exactly one run. In co-op every
player is dealt their own three cards; the host applies the effects and the choice
rides the snapshot back to the guest.

**The per-wave statistics panel is gone.** A cleared round is just `ROUND N CLEARED`.
The full ledger — round reached, kills, headshot rate, accuracy, points, scrap,
damage, planks, crafts, revives, skills taken and the best-runs table — is on the
game-over / EVACUATED screen, where there is time to read it.

## All-time statistics

Every finished night — a death, an evacuation, or quitting to the front page
mid-run — is added to a diary kept in `localStorage` (`ndu.lifetime.v1`). The
front page carries the headline under the title: **runs, best round, total
kills**, plus evacuations, rounds cleared and time played. The **STATISTICS**
row opens the whole page: eight numbers about the nights themselves on the
left (runs, evacuations, deaths, rounds cleared, best round, best run kills,
points and time) and sixteen about what happened in them on the right (kills,
headshots, special/knife/trap kills, points, scrap, health lost, planks, doors,
crafts, throwables, medkits, revives, downs, time played). The best three
single runs sit under the left column. The page fits without scrolling, so a
phone can read all of it and a tap closes it; a range run is practice and is
never banked. One run is banked exactly once, whichever way it ends.

## Outfits: ten coats, ten badges, ten small edges

The soldier in the middle of the screen is *yours*. **OUTFITS** on the front page
opens the wardrobe: a list of ten outfits and the standard kit you were issued.
Every outfit is locked behind one achievement — walk into the wardrobe and the
row tells you which badge it wants, in the same words the achievements page
uses:

| Outfit | Badge | What it does |
| --- | --- | --- |
| **The Scout** | Ten Deep — reach round 10 | walk 8 % faster |
| **Field Medic** | Field Medic — craft a medkit | health comes back 30 % faster |
| **Speed Loader** | Punched — run a weapon through the Pack-a-Punch | reload 15 % faster |
| **The Marksman** | Marksman — land half your shots over a hundred fired | headshots hit 25 % harder |
| **The Blade** | Knife Work — take down twenty-five with the knife | the knife hits 50 % harder |
| **The Heavy** | Twenty Deep — reach round 20 | 15 more maximum health |
| **The Hoarder** | Care Package — pick up a crate the radio dropped for you | one more throwable every round |
| **The Ghost** | Untouchable — clear a round without a scratch | the dash returns in 3 s |
| **The Scavenger** | Big Spender — hold 10 000 points | kills drop scrap 50 % more often |
| **The Veteran** | The Long Night — reach round 30 | 25 armour at the start of every night |

Wear one with a click (or `Enter`), take the standard kit back off the same way,
`Esc` backs out. The buff is folded into the same stat block perks and run skills
use, so it stacks with them and is capped where they are capped — an outfit is
the size of a run skill, never a replacement for a perk. The choice is stored in
`localStorage` (`ndu.skin.v1`), remembered across runs, checked against the
achievement wall on load (a hand-edited save cannot wear a coat it did not earn)
and **sent over the wire**, so the other player in a co-op room sees the coat
standing next to them — including a swap made in the middle of a round.

For testing, `DEBUG → OUTFITS` grants each badge by name (and `GRANT EVERY OUTFIT`
grants all ten), wears the outfit, and marks the row so you can see what is
granted; `DEBUG → CHEATS` still has the broader handy switches.

## The map (72 × 50 tiles)

**Three storeys, one building.** The bunker has a second floor and an attic that opens onto the
roof; all three share the same 72 × 50 grid and are stitched together by vertical links that
share tile coordinates, so "up" is literally above you:

| Link | Connects |
| --- | --- |
| West stair | ground (18,11) ↔ second floor (18,11) |
| East stair | ground (41,15) ↔ second floor (41,15) |
| Attic ladder | second floor (26,15) ↔ attic & roof (26,15) |

Walk onto a link to climb. The horde follows: every storey keeps its own flow field, so zombies
on another floor walk to the staircase that leads towards you, climb it, and carry on hunting.
From round 8 some of them spawn upstairs, from round 13 some on the roof. Each storey hides its
own **supply cache**. The open air around the upper footprints is solid `VOID` (painted as night
sky) — fall off the parapet and there is nothing there.

The second floor is not the ground plan again. Downstairs is a four-room cross filling the whole
bunker; upstairs is an **L** — a north range with a corridor down the middle and cubicles off it,
plus a south-west leg — because the south-east corner of the floor caved in years ago. It is also
built differently: laid boards underfoot and stud-and-plaster partitions, against the concrete
and brick downstairs. Same building, unmistakably another floor.

One big level instead of a second map:

- **Bunker** — four rooms (A/B up, C/D down) split by a central cross-wall, 20 barricaded
  windows, six buyable doors including two that let you **walk outside**.
- **Radio room** (north-east) — reached by a stairwell from room B. Holds the **Pack-a-Punch**.
- **Shed** (east) — tools and sandbags; the workbench it used to hold moved upstairs.
- **Roof** — the west terrace wears a painted **H**: the helipad, on the deck from
  the very first night, bird or no bird.
- **Attic** — the board shack on the roof holds the **workbench**: anything you
  want built, you carry the scrap up three storeys for.
- **Roof radio** (east roof block) — a dead set with a bent mast from night one.
  **25 scrap** straightens the mast: from then on, every second round a supply
  crate drops onto the pad (points, salvage, every magazine topped up).
- **Cellar** (south-west) — holds the **power switch**; reached by a stairwell from room C.- **Secret vault** — behind a bricked-up arch in the east wall, only opens after the easter egg.
- **Outside** — forest belts, copses, picket fences, a wrecked truck, an open field to the south.
  A burnt-out car sits at the bottom of the field and a gutted tank at the bottom
  right — both at twice their old size, each sunk in its own wide patch of mud,
  wheel ruts and thrown track. You can leave the bunker and
  fight in the open; zombies spawn out here and path in.

Stairwells are real portals: step on the tile, walk to its centre, and you pop out at the other
end (the flow field charges a small cost for it, so zombies use them too).

## Mechanics

**Power.** Until you throw the switch in the cellar, the bunker is dark, perk machines are dead
and the Mystery Box will not open. The generator turns on 20 ceiling lamps, every machine glow
and the vault light.

**Perks.** Eight machines, six per run:
Juggernog (×2 health) · Speed Cola (½ reload) · Double Tap (−33 % shot delay) ·
Quick Revive (faster regen) · Stamin-Up (dash every 3 s instead of 5) · PhD Flopper (immune to your own
explosions) · Deadshot Daiquiri (aim drifts to the head) · Widow's Wine (knife and frags leave
slowing webs).

**Mystery Box.** 950 points, five possible locations, spins for ~2.6 s, offers the weapon for
6.5 s. Pull too many times and the teddy bear steals it — the box relocates. Fire Sale moves it
and drops the price to 10. There is exactly **one** crate in the whole map: all five
homes are on the ground floor, and upstairs it neither answers nor shows.

**Wonder weapons** (box only): Ray Gun (plasma splash) · Wunderwaffe DG-2 (chains to four
targets) · Thunder Gun (a cone that throws a whole hallway away) · Winter's Howl (freezes a
cluster solid) · Monkey Bomb (wind it up, throw it, watch the horde pile on, then leave).

**Wall buys.** M1911 (start) · MP40 · Thompson · M1897 Trench Gun · PPSh-41 · Kar98k · FG 42 ·
M1918 BAR · MG 42 · PTRS-41. Ammo costs a fraction of the gun.

**Workbench.** Kills drop **scrap**, and the bench in the attic spends it. On the bench today:
**Medkit** (8 scrap, +55 HP, up to three carried), **Armour Plate** (14 scrap + 1500 points,
absorbs the next 60 damage, up to 120 — its meter sits under the dash clock above the health
bar, where your eye already is after being bitten) and **Steel Shutters** (30 scrap + 2500 points, once per
house: every window on every floor takes two more planks — the cap itself rises, and the boards
come with it). The original six recipes were flat vending-machine buttons with nothing behind
them; they were rewritten onto a new recipe contract, and the four not on the bench yet (Plank
Bundle, Frag Bundle, Ammo Crate, Barricade Spikes) live in `src/crafting.js` as
`SHELVED_RECIPES` — hanging one back on is one line. Every recipe owes the bench a `useful()`
check: a purchase that would change nothing is refused with the reason on the row, so nobody
ever pays for air again. In co-op every body has its own bench and its own purse; a guest
builds with its own scrap over the wire, and house-wide buys (the shutters) are shared — the
deepened caps ride along in the snapshot, so a guest who joins later sees them too.

**Pack-a-Punch.** 5000 points, needs the generator on, one upgrade per weapon per run. It more
than doubles the damage (×2.2), gives +50 % magazine, double the reserve ammo, an extra point of
penetration, a tighter spread and green tracers — and renames the gun the way CoD always has:
M1911 → *Mustang & Sally*, MP40 → *Afterburner*, Ray Gun → *Porter's X2 Ray Gun*. Held weapons
carry the upgrade, so both of your slots keep their own state.

**Two carried slots.** You carry two guns, not a backpack full of fifteen. `1` / `2` pick one,
`Q` flips between them in a third of a second. The wheel and `[` / `]` still reach everything you
own, but digging through the armoury costs a slow 0.9 s swap — so the choice of what you carry
actually matters.

**Traps.** 500 points arms one for 8 seconds, then it recharges for 22–26.
*Flame Trap* on the ledge under room C's south windows (115 dps + afterburn), *Electric Barrier*
under room A's north windows (80 dps, shocks them rigid) and a *Steam Vent* at the mouth of the
room B → D doorway (75 dps, scalds, slows and shoves them back out through the door). Only ever
hurts zombies — and 15 trap kills in one run is an achievement.

**Enemies — 44 types**, nine of which are the wardens below. Walkers, **Runners**
(fast, frail, round 6), **Brutes** (2.7× HP, smashes three planks at a time,
round 10), **Crawlers**, **Shriekers** (rally scream, round 12),
**Hellhounds** (every fifth round is a dog round — a 26 × 16 dog, drawn at 1:1,
about one tile nose to tail), **Helmeted** (a steel pot with a brim, a riveted
band and a chin strap, plates on both shoulders), **Napalm**, **Gasbags**,
**Miners** (come up through the floor), **Mimics**, **Field Medics**, **Bonewrights**,
**Swarmlings**, **Jammers**, and **Amalgams**.

The second wave, each arriving on its own round so the early game stays quiet:

| round | who | what it does |
| --- | --- | --- |
| 7 | **Beekeeper** | kneels once and leaves a hive you can shoot down; its bees come out of the box and never count towards the round |
| 8 | **Weaver** | leaves knots of silk that take your legs — shoot them, cut them, or dash through one that starts outside it |
| 9 | **Bone Archer** | a telegraphed three-arrow fan, then a long reload |
| 11 | **Bulwark** | a plank shield turned towards you: shots on it do a fifth of their damage, and it re-aims with a third of a second of lag — go round it, do not feed it bullets |
| 12 | **Widow** | one bite, nine seconds of venom that runs its own clock and stops at a fifth of the bar |
| 13 | **Drummer** | beats every two seconds: everything within 300 units walks and bites a fifth faster; the aura is drawn, so you can see where it comes from |
| 14 | **Sapper** | a crawler with a bundle of charges: 260 damage inside 96 units, and it takes the rest of the round with it — shoot it early, and never let it reach you |
| 16 | **Porter** | slow, fat, and carrying a sac of brood: it sets a handful of swarmlets down every few seconds, and the sac bursts when it dies |
| 18 | **The First** | gets up again — twice, quicker and angrier each time |

**Wardens.** Every fifth round from ten — 10, 15, 20 … 50 — belongs to one of
nine, in this order; on round 55 the cycle starts again with every warden 35 %
heavier: **The Warden** (plated, and it calls the walkers in),
**The Organist** (keeps its distance and screams — the ring staggers you and
hastes the rest), **The Butcher** (plants its feet, then crosses the room in a
straight line with a cleaver; the line is the telegraph), **The First**
(reassembles twice), **The Mother** (broods swarmlets), **The Queen** (two hives at
once), **The Gravedigger** (two graves, and the bells do not stop while it
stands), **The Bellringer** (its bell is the bolt, and every ring brings the horde
with it) and **The Colonel** (plate, a cap that used to mean something, and a
whistle that brings the knights). A warden round is an escort, not an army: half
the bodies, and never more than 22 alive at once.

The haunt roster arrives from round 12 up: **Snowmen** lob snowballs (badly — on purpose) that
chill your legs for three seconds, and roll double in a storm; **Arsonists** throw fire bottles
that break into burning pools; **Witches** throw potion bottles that burst into gas; a **Totem
Bearer** kneels once per life and raises a totem you can shoot down — while it hums, the map
sinks into a purple dusk and the whole horde gets faster, bolder and hungrier for planks; a
**Mourner** digs a grave that rings a bell every few seconds and lets out half-seen **Wraiths**
with a sabre of cold light (they fade when the grave is broken, and they never count towards the
round); **Shockers** gather for three quarters of a second and throw lightning along their line
of sight — it hurts, and for a moment your legs and your trigger both forget how to work; and
the **Knight** walks in from round 20: big, slow, 3.6× HP, body shots ring off its plate for
half damage, and the head is the only honest way in.

**Weather.** From round 3 every round rolls the sky: a storm (slanted rain across the glass,
lightning flashes with late thunder, the screen stays wet and dries slowly, snowmen come twice
as often), fog (a veil with a hole of visibility around you), or nothing.

**The loudspeaker.** From round 10 somebody talks — lines tied to events, not timers: a first
sighting of a new horror, a totem rising, a grave being dug, a storm rolling in, a door you are
about to buy ("that one leads nowhere good"). And at rounds 25/30/35 the voice is no longer the
loudspeaker: survivors outside the wire, a helicopter that wants a lit pad and two minutes, and a
"look up" over the roof.

**The ending — EVACUATED.** The night can actually be left, and it no longer asks you to
stand around counting rounds. The four secret dials double as roof beacons: every switch you
throw lights one of four corner lamps up on the roof (red and green, blinking, visible from
the deck). Reach **round 25** with all four lit — in whatever order, the pad notices on its
own — and the crew gives you a bearing and a green flare in a locker at the centre of the H.
Press E/F on it and a green smoke column goes up: the smoke is what the bird homes on, and
the clock starts. Two minutes later the smoke thins, the rotor comes in over the west
trees — shadow, searchlight, chop — and the bird sets down on the pad. Walk up and press
E/F and the run ends on a golden **EVACUATED** screen to its own music, written to the
leaderboard with its own **EVAC** mark (and a *Leaving Tonight* badge). Four dials finished
after round 25 arm it just the same; fewer than four at round 30 and the radio simply
apologises — the night goes on exactly as before. In co-op the ending is a **vote**: E at
the landed bird raises (or lowers) your hand, more than half of the bodies alive have to
agree, and once they do everybody still standing flies.

**The radio's night.** From round 9, every 5–7 rounds the receiver catches a broadcast:
sitreps ("sector D is lost"), the numbers station, a minute of silence for the ones who did
not reach morning, a roll call that uses *your* name, a careful hint at one of the dials you
have not found — a storm forecast that the next round's sky actually honours, and a real
supply drop: a crate comes down on a parachute by the mystery-box spots, smokes and blinks a
red flare for ~100 s, and pays 1500 points, 12 salvage and full magazines (*Care Package*).
Broadcasts never repeat back to back, and rounds 25/30/35 belong to the survivors.

A blast does not always take the head — sometimes it takes the legs. Grenades, monkey bombs and
Ray Gun splashes will drop a zombie onto its elbows instead: a **Crawler** keeps coming at 70 %
speed with a third of its health and a much smaller silhouette, so it is easy to miss and annoying
to leave alive. Worth more points for the trouble.

From round 12 the horde starts including **Shriekers**: pale wretches that hang back at their own
preferred distance and scream. The scream rings out in a visible purple wave and *rallies*
everything in earshot — +35 % speed and +25 % damage for five seconds. They never close on you,
which is exactly the problem: leave them alone and the whole horde stays angry.

**Power-ups.** Max Ammo · Insta-Kill · Double Points · Nuke · Carpenter · Fire Sale ·
Death Machine. Dropped roughly every 22–34 kills.

**Easter egg.** Four hidden dials are scattered across the map. Turn them all in one run and the
radio starts transmitting — when the broadcast ends, a wall gives way.

**Rounds.** `6 + round × 3.5` zombies (dog rounds: `10 + 1.6·round`), up to ~34 alive.
HP `120 + 46·(round−1)` capped at 2600, speed ramps 44 → 88 px/s. Six seconds between rounds.

**Points.** +10 per hit, +60 per kill, +40 extra for a headshot, +130 for a knife kill, +10 per
plank. Repairing barricades pays *you* — that is the authentic CoD safety net.

**Health.** 100 HP (200 with Juggernog), 34 damage per swipe → three hits. Regen 30 HP/s after
5 s without damage (2.4 s / 58 HP/s with Quick Revive).

## Look & sound

- Pixel art is ASCII + palette (`src/spriteData.js`) baked into canvases at load (`src/art.js`).
  Gun sprites are generated parametrically from a spec table, so all fifteen stay consistent.
  Tiles are painted procedurally with a seeded RNG into one big offscreen canvas → a single
  `drawImage` per frame.
- Lighting is a half-resolution darkness layer with holes punched out per light: flickering
  ceiling lamps, a torch cone, muzzle flashes, explosions, cold moonlight through broken
  windows, coloured glow from every perk machine. Radial masks are baked once and blitted, not
  rebuilt per frame.
- Weather: a wind field drives drifting leaves across the whole map.
- Deliberately **not** oppressively dark — the night is moody but readable (≈5 % near-black
  pixels in lit areas). Ambient level lives in `src/lighting.js`.
- Every sound is synthesised at runtime with WebAudio: gunshots per weapon class, wonder-weapon
  voices, reload clicks, growls, dog howls, the generator spooling up, the box rumble, the
  easter-egg broadcast, plank knocks, the round-start sting and a wind bed.

## Layout

```
index.html          shell + canvas
styles.css          crisp upscaling, no fixed game box (the canvas fills the frame)
server.mjs          zero-dependency dev server
src/
  main.js           boot, fixed-step loop, viewport sized to the device, supersampling
  game.js           rounds, spawning, interactions, camera, frame renderer
  map.js            tile grid, collision, stairwell portals, dijkstra flow field
  mapData.js        AUTO-GENERATED level layout (see tools/genmap.py)
  entities.js       player, zombies (4 archetypes), grenades, monkey bombs, particles
  weapons.js        the 15-weapon table + Mystery Box roll
  perks.js          perk definitions and derived stat effects
  powerups.js       power-up table, drop roll, floating pickup
  mysterybox.js     the box: spin, teddy bear, relocation, fire sale
  crafting.js       the workbench: recipe contract, three shipped recipes, four shelved
  skins.js          ten outfits: palettes, buffs, achievement gates, saved choice
  achievements.js   achievements, localStorage leaderboard, easter-egg state machine
  art.js            sprite baking, parametric gun builder, procedural level painting
  spriteData.js     ASCII pixel art + palette (pure data)
  lighting.js       baked-mask darkness layer + vignette
  hud.js            HUD, cached minimap, craft menu, banners, title / pause / game-over
  audio.js          procedural WebAudio SFX
  input.js          keyboard + mouse
  util.js           maths, RNG, min-heap
tools/
  genmap.py         regenerates src/mapData.js from a room spec
  preview.mjs       renders the ASCII sprites to a PNG sheet (node, no deps)
```

## Tuning

- `src/game.js` → `roundPlan()` (counts, HP, speed, spawn rate), `POINTS_*`, `LAMPS`,
  `DOG_ROUND_EVERY`, `SALVAGE_DROP`, intermission length.
- `src/weapons.js` → the whole weapon table (damage, mag, delay, spread, pierce, specials).
- `src/entities.js` → `Player` (speed, HP, regen), `Zombie`, `ENEMY_TYPES` (archetype multipliers).
- `src/perks.js` → prices and `perkEffects()`.
- `src/crafting.js` → `RECIPES`.
- `src/lighting.js` → ambient darkness.

To change the level, edit the room/window/door/object tables at the top of `tools/genmap.py` and
run `python3 tools/genmap.py` — it validates connectivity (nothing solid spawns inside a wall,
everything is reachable from the player start, the roof bench included) and rewrites `src/mapData.js`.

> **Before you run it:** `src/mapData.js` has drifted from the generator. The traps, the
> hand-placed second-floor lamps, the extra box spots upstairs and a few upper-floor doors
> were edited into the emitted file directly, so regenerating today drops them and the game
> loses its flame trap, its electric barrier, its steam vent and half the barracks lighting.
> Port those tables into `genmap.py` first (the warning at the top of the file lists them),
> or diff and keep them: `git diff src/mapData.js` right after a run is the check.

## Roadmap

See [`docs/IDEAS.md`](docs/IDEAS.md) — it tracks what is already in (items 1–7 plus the
Pack-a-Punch / two-slot / trap / Crawler / Shrieker batch, the helmet / napalm / gas zombies, the
second floor and the roof, settings, the last-zombie sound, the haunt roster and the loudspeaker,
and now the rooftop evacuation finale with the radio's night) and carries a large fresh backlog:
wearable gizmos, a second crafting bench, teleporters, a story told through a keeper's diary,
weapon mods, daily challenges, gamepad support and proper smoke tests.

## QA regression tests

Use Node 22+ for the live WebSocket harness, then run:

```sh
npm ci --prefix tools/harness
npm test                       # adversarial relay/input and gameplay regressions
npm run test:regression         # 48 existing assertion suites (~2 minutes)
```

See [the QA/security report](docs/QA_REPORT.md) for reproductions, fixes,
measurements and untested areas. The relay is intended for trusted LAN play,
not unauthenticated public hosting. Its HTTP server intentionally serves only
runtime assets; repository metadata and developer tools are not public files.

## Music listening room and round reports

Open debug (backquote, or five taps on the round counter while paused on a
phone), then select the fourth **MUSIC** tab (CHEATS · ZOMBIES · OUTFITS · MUSIC). It contains **20 original procedural
scores, 5–9 minutes each** (~2 h 22 min total), repeat/playlist/once modes, volume,
minute-seeking and an evacuation-fanfare preview. Closing debug keeps the chosen
score playing; STOP returns to the adaptive score. Selection is local in co-op.

A completed wave is announced as `ROUND N CLEARED` and nothing else: the
twenty-metric panel that used to open on every intermission is gone. All of it —
round reached, kills, headshot rate, accuracy, points, scrap, damage, planks,
crafts, revives, the skills taken — is on the end-of-run screen, together with
the best-runs table. Successful evacuation gets a major-key celebration on both
host and guest.
See [the listening guide and catalogue](docs/MUSIC.md) for controls, track moods,
stat definitions and technical/testing limitations.
