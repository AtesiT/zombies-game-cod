// Local-network co-op.
//
// The shape of it: the host runs the whole simulation and owns every number
// that matters; everybody else runs a *view* of it. A guest sends the same
// handful of things a keyboard sends -- where he is walking, where he is
// aiming, which keys are down -- and receives, twenty times a second, enough
// of the world to draw it. Nothing is predicted and nothing is reconciled:
// on a LAN the round trip is a couple of milliseconds, and a game that never
// argues with itself is worth more than one that guesses well.
//
// The server (see server.mjs) is a relay with rooms. It knows nothing about
// zombies. Whoever opened the room is the host; if he quits, the longest-
// standing guest is handed the room by the relay.
import { Player, ENEMY_TYPES } from './entities.js';
import { PERKS } from './perks.js';
import { audio } from './audio.js';
import { clamp, damp, dist } from './util.js';
import { T } from './art.js';

const SNAP_HZ = 20;         // world updates per second, host -> guests
const INPUT_HZ = 30;        // how often a guest reports its hands
const TIMEOUT = 6;          // seconds of silence before a peer is dropped
export const MAX_PLAYERS = 4;

/** The only keys a phone or a laptop gets to send. Short, bounded, obvious. */
export const NET_KEYS = [
  'KeyR', 'KeyQ', 'KeyV', 'KeyG', 'KeyH', 'KeyE', 'KeyF', 'ShiftLeft', 'Digit1', 'Digit2',
];

const Z_TYPES = Object.keys(ENEMY_TYPES);
const PERK_IDS = Object.keys(PERKS);

const r0 = (v) => Math.round(v);
const r2 = (v) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------
//  An Input stand-in, driven by the wire instead of by a keyboard. The Player
//  class reads `mouse` for its aim and the usual isDown/wasPressed for the
//  rest, so this is all a remote body needs to look exactly like a local one.
// ---------------------------------------------------------------------------
export class RemoteInput {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouse = { x: 0, y: 0, cx: 0, cy: 0, down: false, pressed: false, released: false, rdown: false };
    this.wheel = 0;
    this.anyInput = false;
    this.stick = { x: 0, y: 0 };
    this.aim = 0;
  }

  /** Put the virtual cursor out along the aim angle so Player computes the
   *  same facing it would for somebody sitting at the host's own screen. */
  placeAim(game, p) {
    this.mouse.x = (p.pos.x - game.cam.x) + Math.cos(this.aim) * 90;
    this.mouse.y = (p.pos.y - game.cam.y) + Math.sin(this.aim) * 90;
  }

  apply(msg) {
    if (!msg) return;
    this.stick.x = clamp(msg.mx ?? 0, -1, 1);
    this.stick.y = clamp(msg.my ?? 0, -1, 1);
    if (typeof msg.a === 'number') this.aim = msg.a;
    const fire = !!msg.f;
    if (fire && !this.mouse.down) this.mouse.pressed = true;
    if (!fire && this.mouse.down) this.mouse.released = true;
    this.mouse.down = fire;
    if (msg.fp) this.mouse.pressed = true;      // a tap too short to catch as held

    const held = new Set(msg.k ?? []);
    for (const c of held) if (!this.keys.has(c)) this.pressed.add(c);
    for (const c of [...this.keys]) if (!held.has(c)) { this.keys.delete(c); this.released.add(c); }
    for (const c of held) this.keys.add(c);
    for (const c of (msg.kp ?? [])) this.pressed.add(c);
    this.wheel = msg.w ?? 0;
    if (this.wheel) this.anyInput = true;
  }

  isDown(...c) { return c.some((k) => this.keys.has(k)); }
  wasPressed(...c) { return c.some((k) => this.pressed.has(k)); }
  wasReleased(...c) { return c.some((k) => this.released.has(k)); }

  moveVector() {
    let x = 0, y = 0;
    if (this.isDown('KeyA', 'ArrowLeft')) x -= 1;
    if (this.isDown('KeyD', 'ArrowRight')) x += 1;
    if (this.isDown('KeyW', 'ArrowUp')) y -= 1;
    if (this.isDown('KeyS', 'ArrowDown')) y += 1;
    if (x && y) { const k = Math.SQRT1_2; x *= k; y *= k; }
    const st = this.stick;
    if (st && (st.x || st.y)) {
      x += st.x; y += st.y;
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
    }
    return { x, y };
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouse.pressed = false;
    this.mouse.released = false;
    this.wheel = 0;
    this.anyInput = false;
  }
}

// ---------------------------------------------------------------------------
//  The net itself.
// ---------------------------------------------------------------------------
export class Net {
  constructor(game, opts = {}) {
    this.game = game;
    this.role = 'off';             // 'off' | 'host' | 'guest'
    this.state = 'idle';           // 'idle' | 'connecting' | 'open' | 'closed' | 'error'
    this.error = null;
    this.room = opts.room ?? 'NACHT';
    this.name = opts.name ?? 'PLAYER';
    this.url = null;
    this.you = 0;
    this.hostId = 0;
    this.isHost = false;
    this.peers = new Map();        // host side: id -> { id, name, player, input, seen, edge }
    this.roster = [];              // both sides: [{ id, name, host, you }]
    this.roomList = [];            // join screen
    this.transport = null;
    this.events = [];              // host: things worth telling the guests about
    this._snapT = 0;
    this._inT = 0;
    this._edge = new Set();        // keys tapped since the last input report
    this._fireEdge = false;
    this._buffer = null;           // guest: newest snapshot waiting to be applied
    this._evq = [];                // guest: everything worth seeing, in order
    this._targets = new Map();     // guest: entity id -> interpolation target
    this.onStatus = opts.onStatus ?? (() => {});
    // a few lines of what the net is doing: a lobby that will not let you in
    // is unbearable without them
    this.logLines = [];
    this._status();
  }

  /** One line of on-screen breadcrumb, newest last, eight lines deep. */
  log(line) {
    const t = new Date().toLocaleTimeString([], { minute: '2-digit', second: '2-digit' });
    this.logLines.push(`${t}  ${line}`);
    if (this.logLines.length > 8) this.logLines.shift();
  }

  get active() { return this.state === 'open'; }
  get playing() { return this.active && this.role !== 'off'; }

  _status() { this.onStatus(this); }

  // ------------------------------------------------------------- transport --
  /** Real play: a WebSocket to the relay. Tests: anything with send/close. */
  open(url) {
    this.url = url;
    this.state = 'connecting';
    this.error = null;
    this._status();
    const WS = typeof WebSocket !== 'undefined' ? WebSocket : null;
    if (!WS) { this.state = 'error'; this.error = 'NO WEBSOCKET'; this._status(); return false; }
    let ws;
    try { ws = new WS(url); } catch (e) { this.state = 'error'; this.error = 'BAD ADDRESS'; this._status(); return false; }
    const t = {
      send: (o) => { try { ws.send(JSON.stringify(o)); } catch { /* closed */ } },
      close: () => { try { ws.close(); } catch { /* closed */ } },
    };
    ws.onopen = () => {
      this._attach(t);
      // nothing is said until the player picks HOST or JOIN: connecting only
      // to read the room list must never make you the host of a room
      if (this._pending) { const w = this._pending; this._pending = null; this._sayHello(w); }
      this.log('linked');
    };
    ws.onmessage = (e) => {
      let m = null;
      try { m = JSON.parse(typeof e.data === 'string' ? e.data : ''); } catch { return; }
      if (m) this._onMessage(m);
    };
    ws.onclose = () => this._closed(this.state === 'open' ? 'DISCONNECTED' : 'CANNOT REACH');
    ws.onerror = () => { this.state = 'error'; this.error = 'CANNOT REACH'; this._status(); };
    clearTimeout(this._openT);
    this._openT = setTimeout(() => {
      if (this.state === 'connecting') { this.state = 'error'; this.error = 'CANNOT REACH'; this._status(); }
    }, 4000);
    // keep the tab's own timeout from dropping an idle lobby
    this._ping = setInterval(() => { if (this.active) t.send({ t: 'ping' }); }, 15000);
    return true;
  }

  _attach(t) { this.transport = t; this.state = 'open'; this._status(); }

  /** Used by the harness: two Nets wired straight to each other. */
  attach(fake) { this._attach(fake); return this; }

  /**
   * Announce yourself, and say which side of the table you sat down on. The
   * relay used to decide who the host was by who connected first, which meant
   * a phone that only opened the room list ended up running the room.
   */
  _sayHello(want) {
    if (!this.transport) { this._pending = want; return; }
    this.transport.send({ t: 'hello', room: this.room, name: this.name, want });
    this.log(want === 'host' ? 'hosting...' : 'joining...');
  }

  hostGame(room, name) {
    this.room = room || 'NACHT';
    this.name = name || this.name;
    this.role = 'host';
    this.isHost = true;
    this._sayHello('host');
    this._status();
  }

  joinGame(room, name) {
    this.room = room || 'NACHT';
    this.name = name || this.name;
    this.role = 'guest';
    this.isHost = false;
    this._sayHello('join');
    this._status();
  }

  askForRooms() { this.transport?.send({ t: 'rooms' }); }

  close() {
    if (this.transport) { try { this.transport.send({ t: 'b', m: 'bye' }); } catch { /* gone */ } this.transport.close(); }
    this.transport = null;
    clearInterval(this._ping);
    clearTimeout(this._openT);
    this._closed('CLOSED');
  }

  _closed(why) {
    if (this.state === 'closed' && this.role === 'off') return;
    this.state = 'closed';
    this.error = why === 'CLOSED' ? null : why;
    this.role = 'off';
    this.peers.clear();
    this.roster = [];
    this._status();
  }

  send(to, msg) {
    if (!this.transport) return;
    // the envelope goes LAST: nothing inside a message may rewrite how it is
    // routed, whatever it happens to be called
    if (to == null) this.transport.send({ ...msg, t: 'b' });
    else this.transport.send({ ...msg, to, t: 'to' });
  }

  // -------------------------------------------------------------- messages --
  _onMessage(m) {
    if (m.t === 'joined') {
      this.you = m.you;
      this.isHost = !!m.host;
      this.hostId = m.host ? m.you : (m.peers?.find((p) => p.host)?.id ?? 0);
      this.roster = [{ id: m.you, name: m.name, host: !!m.host, you: true }, ...(m.peers ?? [])];
      this.state = 'open';
      this.log(m.host ? 'you are the host' : m.busy ? 'room already hosted' : `joined, host is ${m.peers?.[0]?.name ?? '?'}`);
      if (m.busy) { this.error = 'SOMEBODY ELSE IS HOSTING'; this.role = 'guest'; this.isHost = false; }
      // the local body takes the id the relay just handed us, so it never
      // collides with the id a guest arrives under
      if (this.game?.player) { this.game.player.netId = m.you; this.game.player.name = m.name; }
      // a guest announces himself to the host; the host lets him straight in,
      // whatever the round counter says
      if (!this.isHost && this.role === 'guest') {
        this.log('asking the host in');
        this.send(this.hostId, { m: 'hi', name: this.name });
      }
      this._status();
      return;
    }
    if (m.t === 'peer') {
      this.roster = this.roster.filter((p) => p.id !== m.peer.id);
      this.roster.push({ ...m.peer, you: m.peer.id === this.you });
      if (this.isHost && m.peer.id !== this.you) this.send(m.peer.id, { m: 'who', host: this.you });
      this._status();
      return;
    }
    if (m.t === 'gone') {
      this.roster = this.roster.filter((p) => p.id !== m.id);
      if (this.isHost) this._dropPeer(m.id);
      this._status();
      return;
    }
    if (m.t === 'host') {                       // the relay handed us the room
      const isYou = m.id === this.you;
      this.hostId = m.id;
      if (isYou && this.role === 'guest') {
        // the old host vanished: keep the world, become the authority for it
        this.role = 'host';
        this.isHost = true;
        this.peers.clear();
        this.game?.bannerShow?.('HOST LEFT', 'you are running the round now', { dur: 3, colour: '#9fd0e0' });
      }
      this._status();
      return;
    }
    if (m.t === 'rooms') { this.roomList = m.rooms ?? []; this._status(); return; }
    if (m.t === 'ping') return;
    if (m.t === 'pong') return;

    // ---- client to client --------------------------------------------------
    if (this.isHost) this._hostMsg(m);
    else this._guestMsg(m);
  }

  // ------------------------------------------------------------- host side --
  _hostMsg(m) {
    const from = m.from;
    if (!from) return;
    if (m.m === 'hi') { this.log(`${m.name ?? 'somebody'} is joining`); return this._admit(from, m.name); }
    if (m.m === 'who') { this.send(from, { m: 'hostis', host: this.you }); return; }
    const peer = this.peers.get(from);
    if (!peer) return;
    if (m.m === 'in') { peer.input.apply(m); peer.seen = 0; return; }
    if (m.m === 'bye') { this._dropPeer(from); return; }
  }

  /** Let somebody into a round that is already running. */
  _admit(id, rawName) {
    const g = this.game;
    if (!g) return;
    // a room only exists once somebody has opened one, which starts a game --
    // but if the host is somehow still on the menu, get him moving
    if (!g.started) g.begin();
    if (this.peers.size >= MAX_PLAYERS - 1) { this.send(id, { m: 'full' }); return; }
    const name = String(rawName || 'PLAYER').slice(0, 10).toUpperCase() || 'PLAYER';
    const spot = this._spawnSpot();
    const p = new Player(g.map, spot.x, spot.y);
    p.game = g;
    p.netId = id;
    p.name = name;
    p.points = 500;
    p.floor = g.map.floor;
    p.salvage = 0;
    p.medkits = 0;
    p.armor = 0;
    p.crafted = {};
    g.players.push(p);

    const peer = {
      id, name, player: p, input: new RemoteInput(), seen: 0,
      linkOn: false, linkCd: 0, reviveT: 0,
    };
    this.peers.set(id, peer);
    this.send(id, {
      m: 'welcome', you: id, host: this.you, round: g.round,
      names: this.roster.map((r) => ({ id: r.id, name: r.name })),
      snap: this.snapshot(),
    });
    this.send(null, { m: 'peerlist', list: [...this.peers.values()].map((q) => ({ id: q.id, name: q.name })) });
    this.emit('join', { name, x: spot.x, y: spot.y });
    g.bannerShow?.(`${name} JOINED`, g.roundActive ? 'mid-round, and they came in swinging' : 'good timing, for once',
      { dur: 2.6, colour: '#9fd0e0' });
    g.popups?.add?.(spot.x, spot.y - 30, name, '#9fd0e0', 11);
    this._status();
  }

  _dropPeer(id) {
    const g = this.game;
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    const i = g.players.indexOf(peer.player);
    if (i >= 0) g.players.splice(i, 1);
    g.bannerShow?.(`${peer.name} LEFT`, null, { dur: 2, colour: '#8a8371' });
    this.send(null, { m: 'peerlist', list: [...this.peers.values()].map((q) => ({ id: q.id, name: q.name })) });
    this._status();
  }

  /**
   * Somewhere near the host, and actually standing room: a body dropped into
   * a wall spends the round vibrating against it, which is not multiplayer,
   * it is a bug with witnesses.
   */
  _spawnSpot() {
    const g = this.game;
    const m = g.map;
    const f = g.map.floor;
    const base = g.player?.pos ?? m.playerStart;
    const free = (x, y) => {
      const r = 11;                       // the body's own radius, plus a hair
      for (const [dx, dy] of [[0, 0], [-r, -r], [r, -r], [-r, r], [r, r]]) {
        const tx = Math.floor((x + dx) / T), ty = Math.floor((y + dy) / T);
        if (!m.inside(tx, ty)) return false;
        if (m.solidTileOn(f, tx, ty)) return false;
      }
      return true;
    };
    for (let ring = 0; ring < 8; ring++) {
      for (let k = 0; k < 12; k++) {
        const a = Math.random() * Math.PI * 2;
        const dd = 20 + ring * 12 + Math.random() * 10;
        const x = base.x + Math.cos(a) * dd;
        const y = base.y + Math.sin(a) * dd;
        if (free(x, y)) return { x, y };
      }
    }
    return { x: m.playerStart.x, y: m.playerStart.y };
  }

  // ------------------------------------------------------------ guest side --
  _guestMsg(m) {
    const g = this.game;
    if (!g) return;
    if (m.m === 'welcome') {
      this.you = m.you;
      this.hostId = m.host ?? this.hostId;
      this.log('you are in');
      this._names = m.names ?? [];
      this._apply(m.snap, true);
      g.started = true;
      g.scene = null;
      g.round = m.round ?? g.round;
      g.bannerShow?.(`ROUND ${m.round ?? g.round}`, 'you are in', { dur: 2.4, big: true });
      this._status();
      return;
    }
    if (m.m === 'full') { this.error = 'ROOM FULL'; this.close(); return; }
    if (m.m === 'hostis') { this.hostId = m.host; return; }
    if (m.m === 'peerlist') { this._names = m.list ?? []; this._status(); return; }
    if (m.m === 'bye') { this.close(); return; }
    if (m.m === 'snap') {
      // Events are queued, not buffered: a snapshot only keeps the newest
      // world state, and anything riding on the one it replaced -- a shot, a
      // kill, a door -- used to be thrown away with it whenever two arrived
      // between two frames of the guest's own loop.
      if (m.ev?.length) {
        this._evq.push(...m.ev);
        if (this._evq.length > 200) this._evq.splice(0, this._evq.length - 200);
      }
      this._buffer = m;
      return;
    }
    if (m.m === 'ev') { this._event(m); return; }
  }

  // ------------------------------------------------------------------ step --
  /** Called once per simulation step, from Game.update. */
  step(dt) {
    if (!this.active) return;
    if (this.isHost) this._hostStep(dt);
    else this._guestStep(dt);
  }

  _hostStep(dt) {
    const g = this.game;
    for (const peer of this.peers.values()) {
      const p = peer.player;
      peer.seen += dt;
      if (peer.seen > TIMEOUT) { this._dropPeer(peer.id); continue; }
      if (p.dead) {
        peer.input.endFrame();
        continue;
      }
      peer.input.placeAim(g, p);
      p.update(dt, g, peer.input);
      // the stair cooldown must actually cool, or a guest gets exactly one
      // hatch ride per game and then walks on the stairs forever
      g.checkLinksFor?.(p, peer, dt);
      this._remoteInteract(peer, dt);
      peer.input.endFrame();
      if (p.dead && !p._deathTold) {
        p._deathTold = 1;
        this.emit('out', { id: p.netId, name: p.name });
      }
      if (p.downed && !p._downTold) {
        p._downTold = 1;
        this.emit('down', { id: p.netId, name: p.name, x: p.pos.x, y: p.pos.y });
      }
    }

    this._snapT -= dt;
    if (this._snapT <= 0) {
      // accumulate rather than reset: resetting loses the remainder and a
      // "20 Hz" net quietly becomes a 15 Hz one
      this._snapT += 1 / SNAP_HZ;
      if (this._snapT <= 0) this._snapT = 1 / SNAP_HZ;
      const snap = this.snapshot();
      const evs = this.events;
      this.events = [];
      const msg = { m: 'snap', ...snap };
      if (evs.length) msg.ev = evs;
      this.send(null, msg);
    }
  }

  /** A remote body still has to be able to open a door and buy a gun. */
  _remoteInteract(peer, dt) {
    const g = this.game;
    const p = peer.player;
    const inp = peer.input;
    if (p.dead) return;

    // reviving a downed team-mate comes first: it is the one thing you cannot
    // do for yourself
    const downed = g.players.find((o) => o !== p && o.downed && !o.dead
      && dist(p.pos.x, p.pos.y, o.pos.x, o.pos.y) < 40);
    if (downed && inp.isDown('KeyF')) {
      peer.reviveT += dt;
      if (peer.reviveT >= 1.3) {
        peer.reviveT = 0;
        g.revive(downed, p);
      }
      return;
    }
    peer.reviveT = 0;

    const it = g.interactionFor?.(p) ?? null;
    if (inp.wasPressed('KeyF', 'KeyE')) g.doInteraction?.(p, it);
    if (inp.isDown('KeyE')) g.rebuildTick?.(dt, p, it); else p._rebuildT = 0;
    if (inp.wasPressed('KeyG')) g.throwFor?.(p);
    if (inp.wasPressed('KeyH')) g.medkitFor?.(p);
    if (inp.wasPressed('KeyQ')) p.swapActive();
    if (inp.wasPressed('Digit1')) p.setSlot(0);
    if (inp.wasPressed('Digit2')) p.setSlot(1);
    if (inp.wheel) p.cycle(inp.wheel > 0 ? 1 : -1);
  }

  _guestStep(dt) {
    const g = this.game;
    // ---- our hands, thirty times a second -------------------------------
    this._inT -= dt;
    const inp = g.input;
    if (inp) {
      for (const k of NET_KEYS) if (inp.wasPressed?.(k)) this._edge.add(k);
      if (inp.mouse?.pressed) this._fireEdge = true;
      if (this._inT <= 0) {
        this._inT = 1 / INPUT_HZ;
        const p = g.player;
        // Aim is the one thing you must not wait for: it is read straight off
        // the local cursor (or the local aim stick) rather than out of the
        // snapshot, or every shot would land a round trip late.
        // the whole move vector, not just the stick: a guest on a keyboard
        // presses WASD, and those keys used to stop at the edge of the wire
        const walk = inp.moveVector?.() ?? { x: 0, y: 0 };
        const mw = inp.mouse ? g.screenToWorld(inp.mouse.x, inp.mouse.y) : null;
        const aim = (p && mw)
          ? Math.atan2(mw.y - p.pos.y, mw.x - p.pos.x)
          : (p?.aim ?? 0);
        this._localAim = aim;
        this.send(this.hostId, {
          m: 'in',
          mx: r2(walk.x ?? 0), my: r2(walk.y ?? 0),
          a: r2(aim),
          f: inp.mouse?.down ? 1 : 0,
          fp: this._fireEdge ? 1 : 0,
          k: NET_KEYS.filter((k) => inp.keys?.has(k)),
          kp: [...this._edge],
          w: inp.wheel ?? 0,
        });
        this._edge.clear();
        this._fireEdge = false;
      }
    }
    // ---- the world -------------------------------------------------------
    if (this._buffer) { this._apply(this._buffer, false); this._buffer = null; }
    while (this._evq.length) this._event(this._evq.shift());
    this._interp(dt);
  }

  // ------------------------------------------------------------- snapshots --
  snapshot() {
    const g = this.game;
    const z = [];
    for (const zb of g.zombies) {
      if (zb.remove) continue;
      z.push([
        zb.id, Z_TYPES.indexOf(zb.type), r0(zb.pos.x), r0(zb.pos.y), zb.floor ?? 0,
        r0(zb.hp), zb.state ?? 0, zb.facing ?? 1, r2(zb.walkPhase ?? 0),
        zb.dead ? 1 : 0, r2(zb.deadT ?? 0),
        (zb.state === 5 /* BURIED */ ? 1 : 0) + (zb.hidden ? 2 : 0),
        r0(zb.maxHp ?? 0),
      ]);
    }
    const p = [];
    for (const pl of (g.players ?? [g.player])) {
      let flags = 0;
      if (pl.dead) flags |= 1;
      if (pl.downed) flags |= 2;
      if (pl.muzzleFlash || pl._muzzle) flags |= 4;
      if (pl.sprinting) flags |= 8;
      if (pl.reloading) flags |= 16;
      let perkMask = 0;
      for (let i = 0; i < PERK_IDS.length; i++) if (pl.perks?.has(PERK_IDS[i])) perkMask |= (1 << i);
      p.push([
        pl.netId ?? 0, r0(pl.pos.x), r0(pl.pos.y), r2(pl.aim ?? 0), r0(pl.hp),
        r0(pl.maxHp ?? 100), pl.floor ?? g.map.floor, flags, pl.current ?? 'm1911',
        pl.slot?.mag ?? 0, pl.slot?.reserve ?? 0, r0(pl.points ?? 0),
        pl.grenades ?? 0, pl.medkits ?? 0, pl.salvage ?? 0, r0(pl.armor ?? 0),
        perkMask, r2(pl.bleedT ?? 0), pl.name ?? '',
      ]);
    }
    const floors = g.map.floors.map((F) => F.barricades.map((b) => b.planks));
    const doors = g.map.floors.map((F) => F.doors.map((d) => (d.open ? 1 : 0)));
    return {
      tm: r2(g.time), r: g.round, ra: g.roundActive ? 1 : 0, im: r2(g.intermission ?? 0),
      zk: g.zombiesKilled, zt: g.zombiesTotal, pw: g.powerOn ? 1 : 0, dg: g.dogRound ? 1 : 0,
      sd: g.map.secretDoorOpen ? 1 : 0,
      ti: r2(g.timers?.instakill ?? 0), tp: r2(g.timers?.doublepoints ?? 0),
      dm: r2(g.timers?.deathmachine ?? 0),
      // where the box is standing, what it is doing, and what it is holding
      bx: [g.box.current ?? 0, typeof g.box.state === 'string'
        ? ['closed', 'spinning', 'offering', 'leaving', 'gone'].indexOf(g.box.state) : 0,
      r2(g.box.timer ?? 0), g.box.weapon ?? ''],
      z, p, b: floors, d: doors,
      pu: g.powerups.map((u) => [r0(u.x), r0(u.y), u.id, r2(u.life ?? 0)]),
      gr: g.grenades.map((n) => [r0(n.x ?? n.pos?.x ?? 0), r0(n.y ?? n.pos?.y ?? 0), n.floor ?? 0]),
      mk: g.monkeys.map((n) => [r0(n.pos?.x ?? 0), r0(n.pos?.y ?? 0), n.floor ?? 0]),
      go: g.gameOver ? 1 : 0,
      you: g.player?.netId ?? 0,
    };
  }

  /** Paint a snapshot onto a game that is not simulating anything. */
  _apply(s, immediate) {
    const g = this.game;
    if (!s) return;
    g.round = s.r;
    g.roundActive = !!s.ra;
    g.intermission = s.im ?? 0;
    g.zombiesKilled = s.zk ?? 0;
    g.zombiesTotal = s.zt ?? 0;
    g.powerOn = !!s.pw;
    g.dogRound = !!s.dg;
    g.gameOver = !!s.go;
    if (g.timers) { g.timers.instakill = s.ti ?? 0; g.timers.doublepoints = s.tp ?? 0; g.timers.deathmachine = s.dm ?? 0; }
    if (g.map.secretDoorOpen !== undefined) g.map.secretDoorOpen = !!s.sd;

    for (let f = 0; f < g.map.floors.length; f++) {
      const F = g.map.floors[f];
      const bp = s.b?.[f] ?? [];
      for (let i = 0; i < F.barricades.length; i++) F.barricades[i].planks = bp[i] ?? 0;
      const dp = s.d?.[f] ?? [];
      for (let i = 0; i < F.doors.length; i++) F.doors[i].open = !!dp[i];
    }
    if (s.bx && g.box) {
      g.box.current = Math.max(0, Math.min(g.box.spots.length - 1, s.bx[0] ?? 0));
      g.box.state = ['closed', 'spinning', 'offering', 'leaving', 'gone'][s.bx[1]] ?? 'closed';
      g.box.timer = s.bx[2] ?? 0;
      g.box.weapon = s.bx[3] || null;
    }

    // ---- zombies: make the ones we have not met, move the rest -------------
    const live = new Set();
    for (const e of s.z ?? []) {
      const id = e[0];
      live.add(id);
      let zb = g.zombies.find((o) => o.id === id);
      if (!zb) {
        zb = g.makeZombie({ x: e[2], y: e[3], floor: e[4] }, Z_TYPES[e[1]] ?? 'walker');
        zb.id = id;
        zb.floor = e[4];
        g.zombies.push(zb);
      }
      const t = this._targets.get(id) ?? {};
      t.x = e[2]; t.y = e[3]; t.floor = e[4]; t.hp = e[5]; t.state = e[6];
      t.facing = e[7]; t.walkPhase = e[8]; t.dead = !!e[9]; t.deadT = e[10];
      t.buried = !!(e[11] & 1); t.hidden = !!(e[11] & 2); t.maxHp = e[12] || zb.maxHp;
      t.type = Z_TYPES[e[1]] ?? 'walker';
      this._targets.set(id, t);
      if (immediate) this._snapTo(zb, t);
    }
    for (let i = g.zombies.length - 1; i >= 0; i--) {
      const zb = g.zombies[i];
      if (!live.has(zb.id)) {
        if (zb.dead) { g.zombies.splice(i, 1); this._targets.delete(zb.id); }
        else { zb.dead = true; zb.deadT = 99; zb.remove = true; }
      }
    }

    // ---- players -----------------------------------------------------------
    const seenP = new Set();
    for (const e of s.p ?? []) {
      const id = e[0];
      seenP.add(id);
      let pl = g.players.find((o) => o.netId === id);
      if (!pl) {
        pl = new Player(g.map, e[1], e[2]);
        pl.game = g;
        pl.netId = id;
        pl.name = e[18] || 'PLAYER';
        g.players.push(pl);
      }
      pl.name = e[18] || pl.name || 'PLAYER';
      const t = this._targets.get(`p${id}`) ?? {};
      t.x = e[1]; t.y = e[2]; t.aim = e[3]; t.hp = e[4]; t.maxHp = e[5]; t.floor = e[6];
      t.dead = !!(e[7] & 1); t.downed = !!(e[7] & 2); t.muzzle = !!(e[7] & 4);
      t.sprinting = !!(e[7] & 8); t.reloading = !!(e[7] & 16);
      t.weapon = e[8]; t.mag = e[9]; t.reserve = e[10]; t.points = e[11];
      t.grenades = e[12]; t.medkits = e[13]; t.salvage = e[14]; t.armor = e[15];
      t.perkMask = e[16]; t.bleedT = e[17];
      this._targets.set(`p${id}`, t);
      if (immediate) this._snapPlayer(pl, t);
      if (id === this.you && g.player !== pl) { g.player = pl; pl.game = g; }
    }
    for (let i = g.players.length - 1; i >= 0; i--) {
      const pl = g.players[i];
      if (!seenP.has(pl.netId) && pl.netId !== this.you) {
        g.players.splice(i, 1);
        this._targets.delete(`p${pl.netId}`);
      }
    }

    // ---- loose objects -----------------------------------------------------
    g.powerups = (s.pu ?? []).map((e) => ({ x: e[0], y: e[1], id: e[2], life: e[3], dead: false, update(dt) { this.life -= dt; } }));
    g.grenades = (s.gr ?? []).map((e) => ({ x: e[0], y: e[1], floor: e[2], remove: false, update() {}, draw: null }));
    g.monkeys = (s.mk ?? []).map((e) => ({ pos: { x: e[0], y: e[1] }, floor: e[2], remove: false, update() {}, luring: false }));
    this._snapT = 0;
  }

  _snapTo(zb, t) {
    zb.pos.x = t.x; zb.pos.y = t.y; zb.floor = t.floor;
    zb.hp = t.hp ?? zb.hp; zb.state = t.state ?? zb.state;
    zb.facing = t.facing ?? 1; zb.walkPhase = t.walkPhase ?? 0;
    zb.dead = t.dead; zb.deadT = t.deadT ?? 0;
    zb.maxHp = t.maxHp || zb.maxHp;
    if (t.hidden) zb.hidden = true;
  }

  _snapPlayer(pl, t) {
    pl.pos.x = t.x; pl.pos.y = t.y; pl.aim = t.aim; pl.hp = t.hp;
    pl.maxHp = t.maxHp || pl.maxHp; pl.floor = t.floor;
    pl.dead = t.dead; pl.downed = t.downed; pl.bleedT = t.bleedT ?? 0;
    pl.points = t.points; pl.grenades = t.grenades; pl.medkits = t.medkits;
    pl.salvage = t.salvage; pl.armor = t.armor; pl.sprinting = t.sprinting;
    if (t.weapon && pl.slots && pl.slots[pl.active] !== t.weapon) { pl.slots[pl.active] = t.weapon; }
    const slot = pl.loadout?.[pl.slots?.[pl.active]] ?? pl.slot;
    if (slot) { slot.mag = t.mag; slot.reserve = t.reserve; slot.owned = true; }
    if (pl.perks) {
      pl.perks.clear();
      for (let i = 0; i < PERK_IDS.length; i++) if (t.perkMask & (1 << i)) pl.perks.add(PERK_IDS[i]);
      pl.applyPerks?.();
    }
  }

  /** Ease everything towards its target so 20 Hz looks like 60. */
  _interp(dt) {
    const g = this.game;
    const k = 22;
    for (const zb of g.zombies) {
      const t = this._targets.get(zb.id);
      if (!t) continue;
      zb.pos.x = damp(zb.pos.x, t.x, k, dt);
      zb.pos.y = damp(zb.pos.y, t.y, k, dt);
      zb.floor = t.floor;
      zb.hp = t.hp ?? zb.hp;
      zb.state = t.state ?? zb.state;
      zb.facing = t.facing ?? zb.facing;
      zb.walkPhase = t.walkPhase ?? zb.walkPhase;
      zb.dead = t.dead;
      zb.deadT = t.deadT ?? zb.deadT;
      if (t.hidden && !zb.hidden) zb.hidden = true;
      if (!t.hidden) zb.hidden = false;
    }
    for (const pl of g.players) {
      const t = this._targets.get(`p${pl.netId}`);
      if (!t) continue;
      pl.pos.x = damp(pl.pos.x, t.x, k, dt);
      pl.pos.y = damp(pl.pos.y, t.y, k, dt);
      pl.aim = t.aim;
      pl.hp = t.hp; pl.maxHp = t.maxHp || pl.maxHp;
      pl.floor = t.floor; pl.dead = t.dead; pl.downed = t.downed;
      pl.bleedT = t.bleedT ?? 0;
      pl.sprinting = t.sprinting; pl.points = t.points;
      pl.grenades = t.grenades; pl.medkits = t.medkits; pl.salvage = t.salvage;
      pl.armor = t.armor;
      if (t.weapon && pl.slots && pl.slots[pl.active] !== t.weapon) pl.slots[pl.active] = t.weapon;
      const slot = pl.loadout?.[pl.slots?.[pl.active]] ?? pl.slot;
      if (slot) { slot.mag = t.mag; slot.reserve = t.reserve; slot.owned = true; }
      if (pl.perks) {
        let changed = false;
        for (let i = 0; i < PERK_IDS.length; i++) {
          const has = pl.perks.has(PERK_IDS[i]);
          const want = !!(t.perkMask & (1 << i));
          if (has !== want) { changed = true; if (want) pl.perks.add(PERK_IDS[i]); else pl.perks.delete(PERK_IDS[i]); }
        }
        if (changed) pl.applyPerks?.();
      }
      if (t.muzzle) { pl.muzzleFlash = 0.05; pl._muzzle = 1; } else pl._muzzle = 0;
      // our own barrel points where we are pointing *now*
      if (pl === g.player && typeof this._localAim === 'number') pl.aim = this._localAim;
    }
  }

  // ---------------------------------------------------------------- events --
  /** Host: tell the guests something worth seeing or hearing. */
  emit(kind, data = {}) {
    if (!this.isHost || !this.active) return;
    this.events.push({ k: kind, ...data });
    if (this.events.length > 60) this.events.shift();
  }

  _event(m) {
    const g = this.game;
    if (!g) return;
    switch (m.k) {
      case 'shot':
        // The host simulated the shot and drew its own tracer, so it must not
        // draw the echo as well -- but a guest has no simulation at all, and
        // without this line fires into silence.
        if (this.isHost) break;
        g.tracers?.push?.({
          x0: m.x0, y0: m.y0, x1: m.x1, y1: m.y1,
          life: 0.075, max: 0.075, colour: m.c ?? '#d9c27a',
          packed: m.p ? 1 : (String(m.c ?? '').startsWith('hsl') ? 1 : 0),
        });
        if (m.w !== 'knife') audio.shot?.(m.w ?? 'm1911', 1);
        break;
      case 'hit':
        g.particles?.blood?.(m.x, m.y, m.a ?? 0, m.head ? 8 : 5);
        // the marker belongs to the hands that squeezed the trigger, not to
        // whoever happens to own the screen
        if (m.by === g.player?.netId) g.hud?.hit(!!m.head);
        break;
      case 'kill':
        g.splat?.(m.x, m.y, 10, 0.5);
        g.particles?.chunk?.(m.x, m.y, Math.random() * 6.28, 7);
        if (m.pts) g.popups?.add?.(m.x, m.y - 24, `+${m.pts}`, m.head ? '#f0d98a' : '#e6dcc2', 11);
        break;
      case 'boom':
        g.shake?.(6, 0.3);
        g.explosionLights?.push?.({ x: m.x, y: m.y, r: m.r ?? 120, life: 0.3, max: 0.3, colour: '#f0a040' });
        g.particles?.smoke?.(m.x, m.y, 12);
        audio.explode?.();
        break;
      case 'banner':
        g.bannerShow?.(m.title, m.sub, { dur: m.dur ?? 2.4, colour: m.colour });
        break;
      case 'door': audio.door?.(); break;
      case 'perk': audio.perk?.(); break;
      case 'power': audio.powerUp?.(); break;
      case 'down':
        g.bannerShow?.(`${m.name} IS DOWN`, 'get to him', { dur: 2.6, colour: '#c4463a' });
        break;
      case 'revive':
        g.bannerShow?.(`${m.name} IS UP`, null, { dur: 2, colour: '#7fd75a' });
        break;
      case 'join':
        audio.chime?.();
        break;
      default: break;
    }
  }

  // ------------------------------------------------------------------ misc --
  nameOf(id) {
    if (id === this.you) return this.name;
    return this.roster.find((r) => r.id === id)?.name
      ?? this._names?.find((n) => n.id === id)?.name
      ?? 'PLAYER';
  }
}

// ---------------------------------------------------------------------------
//  A one-line text field, for the address of the machine running the game.
//  Canvas text entry is a novelty; a real input is a 30-second job and it
//  gets you the phone keyboard for free.
// ---------------------------------------------------------------------------
export function textEntry(mount, opts = {}) {
  if (typeof document === 'undefined' || !mount || !mount.appendChild) {
    const v = opts.value ?? '';
    opts.onDone?.(v);
    return { close() {} };
  }
  const el = document.createElement('input');
  el.value = opts.value ?? '';
  el.placeholder = opts.placeholder ?? '';
  el.maxLength = 64;
  el.spellcheck = false;
  Object.assign(el.style, {
    position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
    width: '70%', padding: '10px 12px', background: 'rgba(10,12,16,0.94)',
    border: '2px solid #6d7f96', borderRadius: '4px', color: '#e8eef6',
    font: 'bold 15px "Courier New", monospace', textAlign: 'center',
    textTransform: 'uppercase', outline: 'none', zIndex: '60',
  });
  mount.appendChild(el);
  let done = false;
  const finish = (ok2) => {
    if (done) return;
    done = true;
    const v = el.value;
    try { el.parentNode?.removeChild(el); } catch { /* already gone */ }
    if (ok2) opts.onDone?.(v.trim());
    else opts.onCancel?.();
  };
  el.addEventListener('keydown', (e) => {
    e.stopPropagation?.();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  el.addEventListener('blur', () => finish(true));
  setTimeout(() => el.focus?.(), 30);
  return { close: () => finish(false) };
}

/** Where the relay lives, when the page itself was served by it. */
export function defaultRelay() {
  if (typeof location === 'undefined') return '';
  if (location.protocol === 'file:') return '';
  return `${location.host}`;
}

export function relayURL(host) {
  if (!host) return '';
  const h = host.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const secure = typeof location !== 'undefined' && location.protocol === 'https:';
  return `${secure ? 'wss' : 'ws'}://${h}/net`;
}
