const TYPES = new Set([
  'neon-sign',
  'support-beam',
  'bear-trap',
  'mud',
  'platform',
  'zipline',
  'relay-quest',
]);
/** Validate generic environment descriptors, references and clear landings. */
export function validateEnvironment(level) {
  const configs = level.environment ?? [];
  if (!Array.isArray(configs) || configs.length > 128) throw new Error('Invalid environment list');
  const ids = new Set();
  const finite = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
  const point = (p) => p && finite(p.x, 24, 1703) && finite(p.y, 24, 1175);
  const clear = (p) =>
    point(p) && '. @r'.includes(level.rows[Math.floor(p.y / 24)][Math.floor(p.x / 24)]);
  const fail = (c) => {
    throw new Error(`Invalid environment: ${c?.id ?? 'unnamed'}`);
  };
  for (const c of configs) {
    if (!c || typeof c.id !== 'string' || !c.id || ids.has(c.id) || !TYPES.has(c.type)) fail(c);
    ids.add(c.id);
    if (!['zipline', 'relay-quest'].includes(c.type) && !clear(c)) fail(c);
    if (
      ['neon-sign', 'support-beam'].includes(c.type) &&
      (!finite(c.hp, 1, 10000) ||
        !finite(c.radius, 4, 60) ||
        !finite(c.fallSeconds, 0.1, 5) ||
        !finite(c.damage, 1, 1000))
    )
      fail(c);
    if (
      c.type === 'neon-sign' &&
      (!finite(c.hazardRadius, 10, 180) ||
        !finite(c.duration, 1, 120) ||
        typeof c.name !== 'string' ||
        !/^#[0-9a-f]{6}$/i.test(c.color))
    )
      fail(c);
    if (c.type === 'support-beam') {
      if (!Array.isArray(c.cells) || !c.cells.length || c.cells.length > 32) fail(c);
      for (const t of c.cells)
        if (
          !Number.isInteger(t.x) ||
          !Number.isInteger(t.y) ||
          !clear({ x: (t.x + 0.5) * 24, y: (t.y + 0.5) * 24 }) ||
          level.spawns?.some((p) => p.x === t.x && p.y === t.y)
        )
          fail(c);
    }
    if (
      c.type === 'bear-trap' &&
      (!finite(c.radius, 4, 30) ||
        !finite(c.damage, 1, 1000) ||
        !finite(c.rootSeconds, 0.1, 10) ||
        !finite(c.rearmSeconds, c.rootSeconds + 1, 120))
    )
      fail(c);
    if (
      ['mud', 'platform'].includes(c.type) &&
      (!finite(c.width, 32, 400) || !finite(c.height, 32, 400))
    )
      fail(c);
    if (c.type === 'platform') {
      if (!clear(c.entry) || typeof c.name !== 'string' || !finite(c.climbSeconds, 1, 15)) fail(c);
      for (let x = -c.width / 2; x <= c.width / 2; x += 12)
        for (let y = -c.height / 2; y <= c.height / 2; y += 12)
          if (!clear({ x: c.x + x, y: c.y + y })) fail(c);
    }
    if (c.type === 'relay-quest') {
      if (
        !Array.isArray(c.switches) ||
        c.switches.length < 2 ||
        c.switches.length > 8 ||
        !c.switches.every((s) => clear(s) && typeof s.name === 'string') ||
        !clear(c.finale) ||
        !finite(c.holdSeconds, 1, 60) ||
        !finite(c.defendRadius, 40, 180) ||
        !finite(c.reward, 0, 20000) ||
        !Number.isInteger(c.requiredSigns) ||
        c.requiredSigns < 1 ||
        c.requiredSigns > configs.filter((p) => p.type === 'neon-sign').length ||
        typeof c.message !== 'string'
      )
        fail(c);
    }
  }
  const platforms = configs.filter((c) => c.type === 'platform');
  for (const c of configs)
    if (
      c.type === 'zipline' &&
      (!platforms.some((p) => p.id === c.from) ||
        !platforms.some((p) => p.id === c.to) ||
        c.from === c.to ||
        !finite(c.radius, 15, 80) ||
        !finite(c.duration, 0.3, 5))
    )
      fail(c);
}
