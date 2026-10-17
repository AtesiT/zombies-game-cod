#!/usr/bin/env node
// Zero-dependency server for local development and LAN co-op.
//   node server.mjs [port]
//
// It does two jobs:
//   1. serves the game over HTTP, on the whole network (0.0.0.0) so a phone
//      or a laptop on the same wi-fi can open it;
//   2. relays multiplayer traffic over WebSocket at /net. The relay knows
//      nothing about zombies -- it only knows rooms and who is in them. The
//      first player into a room is the host and runs the simulation; everyone
//      else talks to the host. That keeps the server dumb and the game honest.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] ?? process.env.PORT ?? 8080);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Only ship runtime assets, never repository metadata, tooling or dependencies.
const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end(); return;
  }
  let url;
  try { url = decodeURIComponent((req.url || '/').split('?')[0]); }
  catch { res.writeHead(400).end('bad URL'); return; }
  if (url === '/') url = '/index.html';
  if (url === '/net/rooms') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify(listRooms()));
    return;
  }
  const parts = url.split('/');
  const publicFile = url === '/index.html' || url === '/styles.css'
    || (/^\/src\/[a-zA-Z0-9_-]+\.js$/.test(url));
  if (!publicFile || parts.some((p) => p === '..' || p.startsWith('.')) || url.includes('\\') || url.includes('\0')) {
    res.writeHead(403).end('forbidden'); return;
  }
  const file = path.resolve(root, '.' + url);
  // realpath also excludes symlinks pointing outside the public tree.
  fs.realpath(file, (err, real) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    if (real !== file) { res.writeHead(403).end('forbidden'); return; }
    fs.readFile(real, (err, data) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
});

// ---------------------------------------------------------------------------
//  WebSocket: just enough of RFC 6455 to move JSON around a living room.
// ---------------------------------------------------------------------------
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';   // RFC 6455 magic string
const MAX_MESSAGE = 1024 * 1024;
const MAX_PENDING = 2 * MAX_MESSAGE;
const MAX_SOCKETS = 256;
let sockets = 0;
const ROOMS = new Map();          // room id -> Set<Socket>
const META = new Map();           // room id -> { name, host, round, players, since }
let nextId = 1;

function listRooms() {
  const out = [];
  for (const [id, set] of ROOMS) {
    const m = META.get(id) ?? {};
    out.push({ id, name: m.name ?? id, players: set.size, round: m.round ?? 0, since: m.since ?? 0 });
  }
  return out;
}

class Sock {
  constructor(socket) {
    this.sock = socket;
    this.id = nextId++;
    this.room = null;
    this.name = null;
    this.alive = true;
    this.buf = Buffer.alloc(0);
    this.frag = null;
    this.fragBytes = 0;
  }

  send(obj) {
    if (!this.alive) return;
    if (this.sock.writableLength > MAX_PENDING) { this.close(); return; }
    const payload = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8');
    const len = payload.length;
    // a server frame is never masked, so the top bit of byte 1 stays clear
    let head;
    if (len < 126) head = Buffer.from([0x81, len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    try { this.sock.write(Buffer.concat([head, payload])); } catch { this.close(); }
  }

  close() {
    if (!this.alive) return;
    this.alive = false;
    sockets--;
    this.buf = Buffer.alloc(0);
    this.frag = null;
    this.fragBytes = 0;
    try { this.sock.destroy(); } catch { /* already gone */ }
    if (this.room) leaveRoom(this);
  }

  /** Feed raw bytes; calls onMessage with whole payloads. */
  feed(chunk) {
    if (!this.alive) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0F;
      const masked = (b1 & 0x80) !== 0;
      if (!masked || (b0 & 0x70) || ![0, 1, 8, 9, 10].includes(op)) { this.close(); return; }
      let len = b1 & 0x7F, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (!Number.isSafeInteger(len) || len > MAX_MESSAGE
        || (op >= 8 && (!fin || len > 125))
        || (op === 0 && !this.frag) || (op === 1 && this.frag)) { this.close(); return; }
      if (op < 8 && this.fragBytes + len > MAX_MESSAGE) { this.close(); return; }
      const mask = masked ? this.buf.subarray(off, off + 4) : null;
      if (masked) off += 4;
      if (this.buf.length < off + len) return;
      let payload = this.buf.subarray(off, off + len);
      if (mask) { payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]; }
      this.buf = this.buf.subarray(off + len);

      if (op === 0x8) { this.close(); return; }
      if (op === 0x9) { /* ping: answer with a pong and move on */ this.pong(payload); continue; }
      if (op === 0xA) continue;
      if (op === 1) this.frag = [];
      if (this.frag.length >= 4096) { this.close(); return; }
      this.frag.push(Buffer.from(payload));
      this.fragBytes += payload.length;
      if (!fin) continue;
      const bytes = Buffer.concat(this.frag, this.fragBytes);
      this.frag = null;
      this.fragBytes = 0;
      let parsed;
      try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { continue; }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      this.onMessage?.(parsed);
    }
  }

  pong(payload) {
    const p = payload ?? Buffer.alloc(0);
    const head = Buffer.from([0x8A, p.length & 0x7F]);
    try { this.sock.write(Buffer.concat([head, p])); } catch { /* gone */ }
  }
}

/**
 * Join a room. `want` is what the player actually pressed: whoever says
 * "host" is the host, whoever says "join" is not -- no matter who connected
 * first. Getting this wrong used to mean the phone that only wanted to *look*
 * at the room list became the host, and then nobody could join anybody.
 */
function joinRoom(s, id, info = {}) {
  leaveRoom(s);
  if (!ROOMS.has(id)) {
    ROOMS.set(id, new Set());
    META.set(id, { name: info.name ?? id, since: Date.now(), host: 0, round: 0, players: 0 });
  }
  const set = ROOMS.get(id);
  set.add(s);
  s.room = id;
  s.name = String(info.name || '').slice(0, 12) || `PLAYER ${s.id % 100}`;
  const m = META.get(id);
  const hostAlive = [...set].some((o) => o.id === m.host);
  const wants = info.want === 'host';
  // somebody else is already running this room: you can watch, you cannot run
  const busy = wants && hostAlive && m.host !== s.id;
  if (!busy && (!hostAlive || wants)) m.host = s.id;
  m.players = set.size;
  const youHost = m.host === s.id;
  s.send({ t: 'joined', you: s.id, host: youHost, busy, room: id, name: s.name, peers: peerList(id, s) });
  broadcast(id, { t: 'peer', peer: { id: s.id, name: s.name, host: youHost } }, s);
}

function leaveRoom(s) {
  if (!s.room) return;
  const set = ROOMS.get(s.room);
  if (!set) { s.room = null; return; }
  set.delete(s);
  const m = META.get(s.room);
  broadcast(s.room, { t: 'gone', id: s.id });
  if (set.size === 0) { ROOMS.delete(s.room); META.delete(s.room); s.room = null; return; }
  if (m && m.host === s.id) {
    const next = [...set].sort((a, b) => a.id - b.id)[0];
    m.host = next.id;
    broadcast(s.room, { t: 'host', id: next.id });
  }
  if (m) m.players = set.size;
  s.room = null;
}

function peerList(id, except) {
  const set = ROOMS.get(id);
  if (!set) return [];
  const m = META.get(id);
  return [...set].filter((s) => s !== except)
    .map((s) => ({ id: s.id, name: s.name, host: m?.host === s.id }));
}

function broadcast(id, msg, except) {
  const set = ROOMS.get(id);
  if (!set) return;
  for (const s of set) if (s !== except) s.send(msg);
}

server.on('upgrade', (req, socket, head) => {
  const url = (req.url || '').split('?')[0];
  if (url !== '/net') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (req.method !== 'GET' || req.headers.upgrade?.toLowerCase() !== 'websocket'
    || req.headers['sec-websocket-version'] !== '13'
    || typeof key !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(key)
    || sockets >= MAX_SOCKETS) { socket.destroy(); return; }
  // Do not let an unrelated website drive a player's LAN relay.
  if (req.headers.origin) {
    let origin;
    try { origin = new URL(req.headers.origin); } catch { socket.destroy(); return; }
    if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) { socket.destroy(); return; }
  }
  sockets++;
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n'
    + 'Upgrade: websocket\r\nConnection: Upgrade\r\n'
    + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  socket.setNoDelay(true);
  socket.setTimeout(45000, () => s.close());

  const s = new Sock(socket);
  s.onMessage = (msg) => {
    // looking at the list of rooms must not put you in one -- a browser that
    // only wanted to browse used to end up as the host of an empty room
    if (msg.t === 'ping') { s.send({ t: 'pong' }); return; }
    if (msg.t === 'rooms') { s.send({ t: 'rooms', rooms: listRooms() }); return; }
    if (msg.t === 'hello') {
      joinRoom(s, String(msg.room || 'NACHT').slice(0, 24), {
        name: String(msg.name || '').slice(0, 12),
        want: msg.want === 'host' ? 'host' : 'join',
      });
      return;
    }
    if (!s.room) return;
    if (msg.t === 'state') {                    // the host advertises its room
      const m = META.get(s.room);
      if (m && m.host === s.id) {
        if (Number.isSafeInteger(msg.round) && msg.round >= 0) m.round = Math.min(msg.round, 1000000);
        if (typeof msg.name === 'string') m.name = msg.name.slice(0, 48);
      }
      return;
    }
    if (msg.t === 'to') {                       // directed: leave it to the pair
      const set = ROOMS.get(s.room);
      if (!set) return;
      for (const o of set) if (o.id === msg.to && (META.get(s.room)?.host === s.id || META.get(s.room)?.host === o.id)) { const { t, to, ...rest } = msg; o.send({ ...rest, from: s.id }); return; }
      return;
    }
    if (msg.t === 'b') {                        // broadcast to the rest of the room
      const { t, to, ...rest } = msg;
      if (META.get(s.room)?.host === s.id) broadcast(s.room, { ...rest, from: s.id });
      return;
    }
    // Unknown envelopes are ignored without retaining attacker-controlled keys.

  };

  socket.on('data', (chunk) => { try { s.feed(chunk); } catch { s.close(); } });
  socket.on('close', () => s.close());
  socket.on('error', () => s.close());
  socket.on('end', () => s.close());
  if (head.length) { try { s.feed(head); } catch { s.close(); } }
});

server.listen(port, '0.0.0.0', () => {
  const nets = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list ?? []) if (n.family === 'IPv4' && !n.internal) nets.push(n.address);
  }
  const boundPort = server.address().port;
  console.log(`zombies running at http://localhost:${boundPort}/`);
  for (const ip of nets) console.log(`  on your network:  http://${ip}:${boundPort}/   (multiplayer ready)`);
});

// a dead room (everybody closed the tab) should not linger in the list
setInterval(() => {
  for (const [id, set] of [...ROOMS]) if (set.size === 0) { ROOMS.delete(id); META.delete(id); }
}, 30000).unref();
