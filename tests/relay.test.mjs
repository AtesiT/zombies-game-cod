import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { once } from 'node:events';

let child, port;
before(async () => {
  child = spawn(process.execPath, ['server.mjs', '0'], { cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'] });
  port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server startup timeout')), 4000);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}`)); });
    child.stdout.on('data', (d) => { const m = String(d).match(/localhost:(\d+)/); if (m) { clearTimeout(timer); resolve(+m[1]); } });
  });
});
after(() => child?.kill());
const request = (path, method = 'GET') => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path, method }, (res) => {
    let body = ''; res.on('data', (d) => body += d); res.on('end', () => resolve({ status: res.statusCode, body }));
  });
  req.setTimeout(3000, () => req.destroy(new Error('HTTP timeout'))); req.on('error', reject); req.end();
});

function frame(data, { op = 1, fin = true, masked = true, declared } = {}) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const n = declared ?? payload.length;
  const base = n < 126 ? 2 : n < 65536 ? 4 : 10;
  const head = Buffer.alloc(base + (masked ? 4 : 0));
  head[0] = (fin ? 128 : 0) | op;
  head[1] = (masked ? 128 : 0) | (n < 126 ? n : n < 65536 ? 126 : 127);
  if (base === 4) head.writeUInt16BE(n, 2);
  if (base === 10) head.writeBigUInt64BE(BigInt(n), 2);
  const mask = Buffer.from([1, 7, 12, 31]);
  if (masked) mask.copy(head, base);
  const encoded = Buffer.from(payload);
  if (masked) for (let i = 0; i < encoded.length; i++) encoded[i] ^= mask[i % 4];
  return Buffer.concat([head, encoded]);
}
async function raw(t, { origin, head = Buffer.alloc(0), version = '13' } = {}) {
  const socket = net.connect(port, '127.0.0.1');
  socket.on('error', () => {});
  t.after(() => socket.destroy());
  await once(socket, 'connect');
  let bytes = Buffer.alloc(0), upgraded = false;
  const messages = [], waiters = [];
  socket.on('data', (d) => {
    bytes = Buffer.concat([bytes, d]);
    if (!upgraded) { const i = bytes.indexOf('\r\n\r\n'); if (i < 0) return; upgraded = true; bytes = bytes.subarray(i + 4); }
    while (bytes.length >= 2) {
      let len = bytes[1] & 127, off = 2;
      if (len === 126) { if (bytes.length < 4) return; len = bytes.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (bytes.length < 10) return; len = Number(bytes.readBigUInt64BE(2)); off = 10; }
      if (bytes.length < off + len) return;
      if ((bytes[0] & 15) === 1) { const msg = JSON.parse(bytes.subarray(off, off + len)); if (waiters.length) waiters.shift()(msg); else messages.push(msg); }
      bytes = bytes.subarray(off + len);
    }
  });
  socket.write(Buffer.concat([Buffer.from(`GET /net HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: ${version}\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\n${origin ? `Origin: ${origin}\r\n` : ''}\r\n`), head]));
  const next = () => new Promise((resolve, reject) => {
    if (messages.length) { resolve(messages.shift()); return; }
    const timer = setTimeout(() => reject(new Error('message timeout')), 2000);
    waiters.push((msg) => { clearTimeout(timer); resolve(msg); });
  });
  return { socket, next, send: (msg) => socket.write(frame(JSON.stringify(msg))) };
}
async function joined(t, room, want = 'join') {
  const c = await raw(t); c.send({ t: 'hello', room, name: want, want });
  c.info = await c.next(); assert.equal(c.info.t, 'joined'); return c;
}

test('HTTP blocks private files and malformed URLs without taking server down', async () => {
  for (const p of ['/.git/HEAD', '/server.mjs', '/package.json', '/tools/harness/package-lock.json', '/src/../.git/HEAD', '/%2e%2e/.git/HEAD', '/src/%00.js']) {
    assert.equal((await request(p)).status, 403, p);
  }
  for (const p of ['/%', '/%E0%A4%A']) assert.equal((await request(p)).status, 400);
  assert.equal((await request('/')).status, 200);
  assert.equal((await request('/src/main.js')).status, 200);
  assert.equal((await request('/', 'POST')).status, 405);
  assert.equal((await request('/', 'HEAD')).body, '');
});

test('upgrade head is processed and split UTF-8 survives continuation frames', async (t) => {
  const c = await raw(t, { head: frame(JSON.stringify({ t: 'rooms' })) });
  assert.equal((await c.next()).t, 'rooms');
  const payload = Buffer.from(JSON.stringify({ t: 'hello', room: 'UTF8', name: 'Жук', want: 'host' }));
  const split = payload.indexOf(Buffer.from('Ж')) + 1;
  c.socket.write(frame(payload.subarray(0, split), { fin: false }));
  c.socket.write(frame('ping', { op: 9 }));
  c.socket.write(frame(payload.subarray(split), { op: 0 }));
  assert.equal((await c.next()).name, 'Жук');
});

test('malformed and oversized WebSocket frames are closed, including fragmented totals', async (t) => {
  const cases = [
    [frame('{}', { masked: false })],
    [frame('{}', { op: 0 })],
    [frame('{}', { op: 2 })],
    [frame('x', { op: 9, fin: false })],
    [frame('x'.repeat(126), { op: 9 })],
    [frame('', { declared: 1024 * 1024 + 1 })],
    [Buffer.concat([frame('', { fin: false }), ...Array.from({ length: 4096 }, () => frame('', { op: 0, fin: false }))])],
    [frame('x'.repeat(600000), { fin: false }), frame('x'.repeat(500000), { op: 0 })],
  ];
  for (const parts of cases) {
    const c = await raw(t);
    const closed = new Promise((resolve) => c.socket.once('close', resolve));
    for (const p of parts) c.socket.write(p);
    await Promise.race([closed, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('invalid frame not closed')), 2000); timer.unref(); })]);
  }
  assert.equal((await request('/')).status, 200);
});

test('null JSON is ignored and cannot eject a valid client', async (t) => {
  const c = await raw(t);
  for (const msg of ['null', '[]', '3', 'false', '"string"', '{']) c.socket.write(frame(msg));
  c.send({ t: 'rooms' }); assert.equal((await c.next()).t, 'rooms');
});

test('guest cannot impersonate host to another guest; normal host routing works', async (t) => {
  const host = await joined(t, 'AUTH', 'host');
  const a = await joined(t, 'AUTH'); await host.next();
  const b = await joined(t, 'AUTH'); await host.next(); await a.next();
  a.send({ t: 'to', to: b.info.you, m: 'full', from: host.info.you });
  a.send({ t: 'b', m: 'full' });
  a.send({ t: 'ping' }); assert.equal((await a.next()).t, 'pong');
  host.send({ t: 'to', to: b.info.you, m: 'sentinel' });
  assert.equal((await b.next()).m, 'sentinel');
  a.send({ t: 'to', to: host.info.you, m: 'in', mx: 1 });
  assert.equal((await host.next()).from, a.info.you);
});

test('cross-site origin and unsupported handshake version are rejected', async (t) => {
  for (const opts of [{ origin: 'https://unrelated.example' }, { version: '12' }]) {
    const c = await raw(t, opts);
    await once(c.socket, 'close');
  }
  const c = await raw(t, { origin: `http://127.0.0.1:${port}` });
  c.send({ t: 'rooms' }); assert.equal((await c.next()).t, 'rooms');
});


test('rapid coalesced messages and byte-split frames preserve ordering', async (t) => {
  const c = await raw(t);
  const ping = frame(JSON.stringify({ t: 'ping' }));
  for (const byte of ping) c.socket.write(Buffer.from([byte]));
  assert.equal((await c.next()).t, 'pong');
  c.socket.write(Buffer.concat(Array.from({ length: 500 }, () => ping)));
  for (let i = 0; i < 500; i++) assert.equal((await c.next()).t, 'pong');
  assert.equal((await request('/')).status, 200);
});
