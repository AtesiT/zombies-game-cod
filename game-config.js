// Optional deployment settings. `null` uses the detected same-origin relay;
// GitHub Pages and packaged Capacitor apps default to no relay. For a separately
// hosted Node relay, set relay to its WebSocket URL, e.g. `wss://play.example.com/net`.
globalThis.ZOMBIES_GAME_CONFIG ??= {
  relay: null,
};
