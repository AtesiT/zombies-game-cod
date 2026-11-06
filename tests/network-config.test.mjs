import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultRelay, relayURL } from '../src/net.js';

const originalLocation = globalThis.location;
const originalConfig = globalThis.ZOMBIES_GAME_CONFIG;
const originalCapacitor = globalThis.Capacitor;
const hadLocation = Object.hasOwn(globalThis, 'location');
const hadConfig = Object.hasOwn(globalThis, 'ZOMBIES_GAME_CONFIG');
const hadCapacitor = Object.hasOwn(globalThis, 'Capacitor');

test.after(() => {
  if (hadLocation) globalThis.location = originalLocation;
  else delete globalThis.location;
  if (hadConfig) globalThis.ZOMBIES_GAME_CONFIG = originalConfig;
  else delete globalThis.ZOMBIES_GAME_CONFIG;
  if (hadCapacitor) globalThis.Capacitor = originalCapacitor;
  else delete globalThis.Capacitor;
});

function setPage({ protocol = 'https:', hostname = 'game.example.com', host = hostname } = {}, relay = null) {
  globalThis.location = { protocol, hostname, host };
  globalThis.ZOMBIES_GAME_CONFIG = { relay };
}

test('static hosts and bundled mobile apps do not assume a local WebSocket relay', () => {
  setPage({ hostname: 'player.github.io', host: 'player.github.io' });
  assert.equal(defaultRelay(), '');
  assert.equal(relayURL(defaultRelay()), '');

  setPage({ protocol: 'capacitor:', hostname: 'localhost', host: 'localhost' });
  assert.equal(defaultRelay(), '');

  setPage({ protocol: 'https:', hostname: 'localhost', host: 'localhost' });
  globalThis.Capacitor = { isNativePlatform: () => true };
  assert.equal(defaultRelay(), '', 'Android WebView should not treat its local localhost origin as the relay');
  delete globalThis.Capacitor;

  setPage({ protocol: 'file:', hostname: '', host: '' });
  assert.equal(defaultRelay(), '');
});

test('same-origin relay defaults remain available on the local game server', () => {
  setPage({ protocol: 'http:', hostname: 'localhost', host: 'localhost:8080' });
  assert.equal(defaultRelay(), 'localhost:8080');
  assert.equal(relayURL(defaultRelay()), 'ws://localhost:8080/net');

  setPage({ protocol: 'https:', hostname: 'game.example.com', host: 'game.example.com' });
  assert.equal(defaultRelay(), 'game.example.com');
  assert.equal(relayURL(defaultRelay()), 'wss://game.example.com/net');
});

test('deployment config accepts a remote WSS endpoint or explicitly disables networking', () => {
  setPage({ hostname: 'player.github.io', host: 'player.github.io' }, 'wss://play.example.com/socket');
  assert.equal(defaultRelay(), 'wss://play.example.com/socket');
  assert.equal(relayURL(defaultRelay()), 'wss://play.example.com/socket');
  assert.equal(relayURL('play.example.com:8443'), 'wss://play.example.com:8443/net');
  assert.equal(relayURL('https://play.example.com'), 'wss://play.example.com/net');

  setPage({ protocol: 'https:', hostname: 'game.example.com', host: 'game.example.com' }, false);
  assert.equal(defaultRelay(), '');
  assert.equal(relayURL(defaultRelay()), '');
});
