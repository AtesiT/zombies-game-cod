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
const port = Number(process.argv[2] || process.env.PORT || 8080);

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

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/index.html';
  if (url === '/net/rooms') {                 // tiny discovery endpoint
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
    res.end(JSON.stringify(listRooms()));
    return;
  }
  const file = path.join(root, path.normalize(url).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(root)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  });
});

// ---------------------------------------------------------------------------
//  WebSocket: just enough of RFC 6455 to move JSON around a living room.
// ---------------------------------------------------------------------------
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';   // RFC 6455 magic string
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
  }

  send(obj) {
    if (!this.alive) return;
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
    try { this.sock.destroy(); } catch { /* already gone */ }
    if (this.room) leaveRoom(this);
  }

  /** Feed raw bytes; calls onMessage with whole payloads. */
  feed(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0F;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7F, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      const mask = masked ? this.buf.subarray(off, off + 4) : null;
      if (masked) off += 4;
      if (this.buf.length < off + len) return;
      let payload = this.buf.subarray(off, off + len);
      if (mask) { payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]; }
      this.buf = this.buf.subarray(off + len);

      if (op === 0x8) { this.close(); return; }
      if (op === 0x9) { /* ping: answer with a pong and move on */ this.pong(payload); continue; }
      if (op === 0xA) continue;
      if (op === 0x0) { this.frag = (this.frag ?? '') + payload.toString('utf8'); }
      else this.frag = payload.toString('utf8');
      if (!fin) continue;
      const msg = this.frag;
      this.frag = null;
      let parsed = null;
      try { parsed = JSON.parse(msg); } catch { continue; }
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

server.on('upgrade', (req, socket) => {
  const url = (req.url || '').split('?')[0];
  if (url !== '/net') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n'
    + 'Upgrade: websocket\r\nConnection: Upgrade\r\n'
    + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  socket.setNoDelay(true);

  const s = new Sock(socket);
  s.onMessage = (msg) => {
    // looking at the list of rooms must not put you in one -- a browser that
    // only wanted to browse used to end up as the host of an empty room
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
      if (m && m.host === s.id) { m.round = msg.round ?? m.round; m.name = msg.name ?? m.name; }
      return;
    }
    if (msg.t === 'to') {                       // directed: leave it to the pair
      const set = ROOMS.get(s.room);
      if (!set) return;
      for (const o of set) if (o.id === msg.to) { const { t, to, ...rest } = msg; o.send({ ...rest, from: s.id }); return; }
      return;
    }
    if (msg.t === 'b') {                        // broadcast to the rest of the room
      const { t, ...rest } = msg;
      broadcast(s.room, { ...rest, from: s.id });
    }
  };

  socket.on('data', (chunk) => { try { s.feed(chunk); } catch { s.close(); } });
  socket.on('close', () => s.close());
  socket.on('error', () => s.close());
  socket.on('end', () => s.close());
});

server.listen(port, '0.0.0.0', () => {
  const nets = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list ?? []) if (n.family === 'IPv4' && !n.internal) nets.push(n.address);
  }
  console.log(`zombies running at http://localhost:${port}/`);
  for (const ip of nets) console.log(`  on your network:  http://${ip}:${port}/   (multiplayer ready)`);
});

// a dead room (everybody closed the tab) should not linger in the list
setInterval(() => {
  for (const [id, set] of [...ROOMS]) if (set.size === 0) { ROOMS.delete(id); META.delete(id); }
}, 30000).unref();
